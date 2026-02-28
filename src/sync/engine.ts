/**
 * Sync Engine
 * Main orchestration class for bidirectional sync
 *
 * Coordinates between:
 * - BrowserChangeApplier (browser → server)
 * - RemoteSync (server → browser)
 * - SyncInitializer (first-time setup)
 * - OrphanCleanup (remove deleted items)
 */

import type { LinkwardenAPI } from "../api";
import type { SyncMetadata } from "../types/storage";
import type { SyncResult } from "../types/sync";
import * as storage from "../storage";
import { SyncErrorReporter, createErrorContext } from "./errorReporter";
import { BrowserChangeApplier } from "./browser-changes";
import { RemoteSync } from "./remote-sync";
import { SyncInitializer } from "./initialization";
import { OrphanCleanup } from "./orphans";
import { createLogger } from "../utils";

const logger = createLogger("LWSync engine");

/**
 * Sync statistics tracker
 */
export interface SyncStatsObject {
  created: number;
  updated: number;
  deleted: number;
  skipped: number;
}

export type SyncStatType = keyof SyncStatsObject;

export class SyncStats {
  private counts: SyncStatsObject = {
    created: 0,
    updated: 0,
    deleted: 0,
    skipped: 0,
  };

  increment(type: SyncStatType, amount: number = 1): void {
    this.counts[type] += amount;
  }

  addAll(other: SyncStats): void {
    this.counts.created += other.counts.created;
    this.counts.updated += other.counts.updated;
    this.counts.deleted += other.counts.deleted;
    this.counts.skipped += other.counts.skipped;
  }

  toObject(): SyncStatsObject {
    return { ...this.counts };
  }

  toString(): string {
    return `${this.counts.created} created, ${this.counts.updated} updated, ${this.counts.deleted} deleted, ${this.counts.skipped} skipped`;
  }
}

export class SyncEngine {
  private api: LinkwardenAPI;
  private isSyncing = false;
  private errors: SyncErrorReporter;

  // Module instances
  private browserChanges: BrowserChangeApplier;
  private remoteSync: RemoteSync;
  private initializer: SyncInitializer;
  private orphans: OrphanCleanup;

  constructor(api: LinkwardenAPI) {
    this.api = api;
    this.errors = new SyncErrorReporter();

    // Initialize module instances
    this.browserChanges = new BrowserChangeApplier(this.api, this.errors);
    this.remoteSync = new RemoteSync(this.api, this.errors);
    this.initializer = new SyncInitializer(this.api, this.errors);
    this.orphans = new OrphanCleanup(this.errors);
  }

  /**
   * Check if sync is currently running
   */
  get syncing(): boolean {
    return this.isSyncing;
  }

  /**
   * Perform a full sync
   */
  async sync(): Promise<SyncResult> {
    const stats = new SyncStats();

    logger.info("Starting sync...");

    try {
      const metadata = await storage.getSyncMetadata();

      if (!metadata) {
        // First run - need to initialize
        throw new Error("Sync not configured. Please set up in popup UI.");
      }

      return await this.syncWithMetadata(metadata, stats);
    } catch (error) {
      this.errors.collect(error as Error, createErrorContext("sync"));
      return {
        ...stats.toObject(),
        errors: this.errors.getErrors(),
      };
    }
  }

  /**
   * Perform sync with provided metadata
   */
  private async syncWithMetadata(
    metadata: SyncMetadata,
    stats: SyncStats
  ): Promise<SyncResult> {
    if (this.isSyncing) {
      throw new Error("Sync already in progress");
    }

    this.isSyncing = true;

    try {
      // Step 1: Process pending changes from browser events FIRST
      await this.processPendingChanges();

      // Step 2: Sync from Linkwarden to browser
      const remoteStats = await this.remoteSync.syncFromLinkwarden(metadata);
      stats.addAll(remoteStats);

      // Step 3: Update last sync time
      metadata.lastSyncTime = Date.now();
      await storage.saveSyncMetadata(metadata);

      // Step 4: Final cleanup
      await storage.cleanupResolvedChanges();

      logger.info("Sync complete:", stats.toString());
    } catch (error) {
      this.errors.collect(
        error as Error,
        createErrorContext("syncWithMetadata")
      );
    } finally {
      this.isSyncing = false;
    }

    return {
      ...stats.toObject(),
      errors: this.errors.getErrors(),
    };
  }

  /**
   * Process pending changes from browser event listeners
   */
  private async processPendingChanges(): Promise<void> {
    const pending = await storage.getPendingChanges();
    const unresolved = pending.filter((c) => !c.resolved);

    if (unresolved.length === 0) return;

    for (const change of unresolved) {
      try {
        if (change.source === "browser") {
          await this.browserChanges.apply(change);
        }
        await storage.resolvePendingChange(change.id);
      } catch (error) {
        this.errors.collect(
          error as Error,
          createErrorContext("processPendingChange", {
            itemId: change.id,
          })
        );
        // Still resolve the change to prevent infinite retry loop
        await storage.resolvePendingChange(change.id);
      }
    }

    await storage.cleanupResolvedChanges();
  }

  /**
   * Initialize sync for a specific Linkwarden collection
   */
  async initialize(
    collectionName: string,
    browserFolderName: string,
    syncDirection:
      | "bidirectional"
      | "to-browser"
      | "to-linkwarden" = "bidirectional"
  ): Promise<{ success: boolean; error?: string; collectionId?: number }> {
    return await this.initializer.initialize(
      collectionName,
      browserFolderName,
      syncDirection
    );
  }

  /**
   * Find or create a collection (used by tests)
   */
  async findOrCreateCollection(
    name: string
  ): Promise<{ id: number; name: string } | null> {
    return await this.initializer.findOrCreateCollection(name);
  }

  /**
   * Reset all sync data
   */
  async reset(): Promise<void> {
    logger.info("Starting sync reset...");
    await storage.clearAll();
    await chrome.alarms.clear("lwsync-sync");
    logger.info("Sync reset complete");
  }

  /**
   * Cleanup orphaned mappings
   */
  async cleanupOrphans(
    remoteLinkIds: Set<number>,
    remoteCollectionIds: Set<number>,
    browserRootFolderId: string
  ): Promise<void> {
    await this.orphans.cleanupOrphanedMappings(
      remoteLinkIds,
      remoteCollectionIds,
      browserRootFolderId
    );
  }

  /**
   * Get the error reporter for this instance
   */
  getErrorReporter(): SyncErrorReporter {
    return this.errors;
  }
}
