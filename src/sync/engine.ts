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
import type { PendingChange } from "../types/storage";
import type { SyncResult } from "../types/sync";
import type { SyncComparison, ComparisonOptions } from "../types/comparator";
import * as storage from "../storage";
import { SyncErrorReporter, createErrorContext } from "./errorReporter";
import { BrowserChangeApplier } from "./browser-changes";
import { RemoteSync } from "./remote-sync";
import { SyncInitializer } from "./initialization";
import { OrphanCleanup } from "./orphans";
import { SyncComparator } from "./comparator";
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
  private comparator: SyncComparator;

  constructor(api: LinkwardenAPI) {
    this.api = api;
    this.errors = new SyncErrorReporter();

    // Initialize module instances
    this.browserChanges = new BrowserChangeApplier(this.api, this.errors);
    this.remoteSync = new RemoteSync(this.api, this.errors);
    this.initializer = new SyncInitializer(this.api, this.errors);
    this.orphans = new OrphanCleanup(this.errors);
    this.comparator = new SyncComparator(this.api, this.errors);
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
      logger.info("Starting sync:", {
        targetCollectionId: metadata.targetCollectionId,
        browserRootFolderId: metadata.browserRootFolderId,
        lastSyncTime: metadata.lastSyncTime,
      });

      // Step 0: Scan for unmapped bookmarks (catch bookmarks created before extension loaded)
      await this.scanForUnmappedBookmarks();

      // Step 1: Process pending changes from browser events FIRST
      await this.processPendingChanges();

      // Wait for Linkwarden search index to update after creating links
      // This prevents false "orphan" detection due to eventual consistency
      const pending = await storage.getPendingChanges();
      const hasCreates = pending.some(
        (c) => c.type === "create" && c.source === "browser"
      );
      if (hasCreates) {
        logger.info(
          "Waiting for search index to update after link creation (2.5 seconds)..."
        );
        await new Promise((resolve) => setTimeout(resolve, 2500));
      }

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
   * Scan for unmapped bookmarks and queue them for sync
   * This catches bookmarks created before the extension was loaded
   */
  private async scanForUnmappedBookmarks(): Promise<void> {
    try {
      const result = await this.comparator.scanAndQueueUnmapped();
      if (result.queued > 0) {
        logger.info("Found unmapped bookmarks:", {
          queued: result.queued,
          scanned: result.scanned,
          skipped: result.skipped,
        });
      }
    } catch (error) {
      // Don't fail the entire sync if scan fails
      this.errors.collect(
        error as Error,
        createErrorContext("scanForUnmappedBookmarks")
      );
      logger.warn(
        "Bookmark scan failed, continuing with sync:",
        error as Error
      );
    }
  }

  /**
   * Process pending changes from browser event listeners
   * Batches link moves and deletes for efficiency
   */
  private async processPendingChanges(): Promise<void> {
    const pending = await storage.getPendingChanges();
    const unresolved = pending.filter((c) => !c.resolved);

    if (unresolved.length === 0) return;

    const metadata = await storage.getSyncMetadata();
    if (!metadata) {
      logger.warn("No sync metadata, skipping pending changes");
      return;
    }

    // Separate link moves and deletes from other changes for batch processing
    const linkMoves: PendingChange[] = [];
    const linkDeletes: PendingChange[] = [];
    const otherChanges: PendingChange[] = [];

    for (const change of unresolved) {
      if (
        change.type === "move" &&
        change.source === "browser" &&
        change.linkwardenId !== undefined
      ) {
        // Check if it's a link (not a folder)
        const mapping = await storage.getMappingByBrowserId(change.browserId!);
        if (mapping?.linkwardenType === "link") {
          // Only batch moves to different collections, not reorders within same folder
          const isReorder = change.oldParentId === change.parentId;
          if (!isReorder) {
            linkMoves.push(change);
            continue;
          }
        }
      }

      // Collect delete operations
      if (
        change.type === "delete" &&
        change.source === "browser" &&
        change.linkwardenId !== undefined
      ) {
        const mapping = await storage.getMappingByBrowserId(change.browserId!);
        if (mapping?.linkwardenType === "link") {
          linkDeletes.push(change);
          continue;
        }
      }

      otherChanges.push(change);
    }

    // Process link moves in batches (more efficient)
    if (linkMoves.length > 0) {
      try {
        await this.browserChanges.batchProcessLinkMoves(linkMoves, metadata);
        // Mark link moves as resolved
        for (const change of linkMoves) {
          await storage.resolvePendingChange(change.id);
        }
      } catch (error) {
        this.errors.collect(
          error as Error,
          createErrorContext("batchProcessLinkMoves")
        );
        // Still resolve to prevent infinite retry
        for (const change of linkMoves) {
          await storage.resolvePendingChange(change.id);
        }
      }
    }

    // Process link deletes in batches (more efficient)
    if (linkDeletes.length > 0) {
      try {
        await this.browserChanges.batchProcessLinkDeletes(linkDeletes);
        // Mark link deletes as resolved
        for (const change of linkDeletes) {
          await storage.resolvePendingChange(change.id);
        }
      } catch (error) {
        this.errors.collect(
          error as Error,
          createErrorContext("batchProcessLinkDeletes")
        );
        // Still resolve to prevent infinite retry
        for (const change of linkDeletes) {
          await storage.resolvePendingChange(change.id);
        }
      }
    }

    // Process other changes individually
    for (const change of otherChanges) {
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
   * Compare browser bookmarks with server links
   * Returns detailed report of sync status
   */
  async compare(options: ComparisonOptions = {}): Promise<SyncComparison> {
    logger.info("Starting sync comparison...");
    const result = await this.comparator.compare(options);
    logger.info("Comparison complete:", result.summary);
    return result;
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

    // Normalize indices after deletions
    await this.orphans.normalizeIndices(browserRootFolderId);
  }

  /**
   * Get the error reporter for this instance
   */
  getErrorReporter(): SyncErrorReporter {
    return this.errors;
  }
}
