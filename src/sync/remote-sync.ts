/**
 * Remote Sync
 * Handles synchronization from Linkwarden (server) to browser
 *
 * Orchestrates the fetch and sync of collection trees from the server.
 */

import type { LinkwardenAPI } from "../api";
import type { LinkwardenCollection } from "../types/api";
import type { SyncMetadata } from "../types/storage";
import * as storage from "../storage";
import * as bookmarks from "../bookmarks";
import type { SyncStatsObject } from "./engine";
import { SyncStats } from "./engine";
import { SyncErrorReporter, createErrorContext } from "./errorReporter";
import { CollectionSync, CollectionCaches } from "./collections";
import { buildCollectionsCache, buildBookmarksCache } from "./mappings";
import { createLogger } from "../utils";

const logger = createLogger("LWSync remote-sync");

export class RemoteSync {
  private api: LinkwardenAPI;
  private errors: SyncErrorReporter;
  private collectionSync: CollectionSync;

  constructor(api: LinkwardenAPI, errorReporter?: SyncErrorReporter) {
    this.api = api;
    this.errors = errorReporter || new SyncErrorReporter();
    this.collectionSync = new CollectionSync(this.api, this.errors);
  }

  /**
   * Sync from Linkwarden to browser
   */
  async syncFromLinkwarden(metadata: SyncMetadata): Promise<SyncStats> {
    const stats = new SyncStats();

    try {
      // Fetch collection tree from Linkwarden
      const collection = await this.fetchCollectionTree(
        metadata.targetCollectionId
      );

      if (!collection) {
        throw new Error(
          `Collection ID ${metadata.targetCollectionId} not found on server`
        );
      }

      logger.info("Fetched collection:", {
        id: collection.id,
        name: collection.name,
        linksCount: collection.links?.length || 0,
      });

      // Ensure root folder exists in browser
      const rootFolderId = await this.ensureRootFolder(
        metadata.browserRootFolderId
      );

      logger.info("Browser root folder:", {
        id: metadata.browserRootFolderId,
        exists: !!rootFolderId,
      });

      // Build caches for path-based matching
      const caches = await this.buildCaches(collection, rootFolderId);

      // Sync collection structure and links
      await this.collectionSync.syncCollection(
        collection,
        rootFolderId,
        caches,
        stats
      );

      // Collect all remote IDs for orphan cleanup
      const remoteCollectionIds = this.collectCollectionIds(collection);
      const remoteLinkIds = this.collectLinkIds(collection);

      // Cleanup orphaned mappings
      await this.cleanupOrphans(
        remoteLinkIds,
        remoteCollectionIds,
        rootFolderId
      );

      logger.info("Remote sync complete:", stats.toString());
    } catch (error) {
      this.errors.collect(
        error as Error,
        createErrorContext("syncFromLinkwarden")
      );
      throw error;
    }

    return stats;
  }

  /**
   * Fetch collection tree from server
   */
  private async fetchCollectionTree(
    collectionId: number
  ): Promise<LinkwardenCollection> {
    try {
      return await this.api.getCollectionTree(collectionId);
    } catch (error) {
      this.errors.collect(
        error as Error,
        createErrorContext("fetchCollectionTree", {
          itemId: collectionId,
        })
      );
      throw error;
    }
  }

  /**
   * Ensure root folder exists in browser
   */
  private async ensureRootFolder(browserRootFolderId: string): Promise<string> {
    try {
      let rootFolder = await bookmarks.get(browserRootFolderId);

      if (!rootFolder) {
        // Root folder doesn't exist - create fallback
        const otherBookmarks = await bookmarks.getOtherBookmarksFolder();
        rootFolder = await bookmarks.create({
          parentId: otherBookmarks?.id,
          title: "LWSync Root",
        });

        // Update metadata with new root folder ID
        const metadata = await storage.getSyncMetadata();
        if (metadata) {
          metadata.browserRootFolderId = rootFolder.id;
          await storage.saveSyncMetadata(metadata);
        }
      }

      return rootFolder.id;
    } catch (error) {
      this.errors.collect(
        error as Error,
        createErrorContext("ensureRootFolder", {
          itemId: browserRootFolderId,
        })
      );
      throw error;
    }
  }

  /**
   * Build caches for path-based matching
   */
  private async buildCaches(
    rootCollection: LinkwardenCollection,
    rootFolderId: string
  ): Promise<CollectionCaches> {
    try {
      const collectionsCache = await buildCollectionsCache(
        this.api,
        rootCollection.id
      );

      const bookmarksCache = await buildBookmarksCache(rootFolderId);

      return {
        collections: collectionsCache,
        bookmarks: bookmarksCache,
      };
    } catch (error) {
      this.errors.collect(error as Error, createErrorContext("buildCaches"));
      throw error;
    }
  }

  /**
   * Collect all collection IDs from tree
   */
  private collectCollectionIds(collection: LinkwardenCollection): Set<number> {
    const ids = new Set<number>([collection.id]);
    if (collection.collections) {
      for (const sub of collection.collections) {
        const subIds = this.collectCollectionIds(sub);
        subIds.forEach((id) => ids.add(id));
      }
    }
    return ids;
  }

  /**
   * Collect all link IDs from tree
   */
  private collectLinkIds(collection: LinkwardenCollection): Set<number> {
    const ids = new Set<number>();
    if (collection.links) {
      for (const link of collection.links) {
        ids.add(link.id);
      }
    }
    if (collection.collections) {
      for (const sub of collection.collections) {
        const subIds = this.collectLinkIds(sub);
        subIds.forEach((id) => ids.add(id));
      }
    }
    return ids;
  }

  /**
   * Cleanup orphaned mappings
   */
  private async cleanupOrphans(
    remoteLinkIds: Set<number>,
    remoteCollectionIds: Set<number>,
    browserRootFolderId: string
  ): Promise<void> {
    const orphanCleanup = new (await import("./orphans")).OrphanCleanup(
      this.errors
    );
    await orphanCleanup.cleanupOrphanedMappings(
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
