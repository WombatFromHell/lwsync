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
      // IMPORTANT: isRootCollection=true means the root collection's links sync directly
      // to the browser root folder, without creating a folder named after the collection
      await this.collectionSync.syncCollection(
        collection,
        rootFolderId,
        caches,
        stats,
        true, // isRootCollection = true
        metadata.lastSyncTime // Pass lastSyncTime for user reorder detection
      );

      // Collect all remote IDs for orphan cleanup
      const remoteCollectionIds = this.collectCollectionIds(collection);
      const remoteLinkIds = this.collectLinkIds(collection);

      logger.info("Collected remote IDs for orphan cleanup:", {
        collectionCount: remoteCollectionIds.size,
        linkCount: remoteLinkIds.size,
      });

      // SAFETY CHECK: Don't cleanup orphans if we got NOTHING from server
      // This prevents accidental deletion when API fetch fails completely
      const hasAnyRemoteData =
        remoteLinkIds.size > 0 || remoteCollectionIds.size > 0;

      if (!hasAnyRemoteData) {
        logger.warn(
          "Skipping orphan cleanup - server returned 0 collections and 0 links. " +
            "This indicates an API failure. Check connection and collection ID."
        );
      } else {
        // CRITICAL: Only cleanup link orphans if we actually fetched links from server
        // This prevents deleting ALL bookmarks when link fetch fails but collection
        // fetch succeeds (e.g., API error returns 0 links)
        if (remoteLinkIds.size > 0) {
          // Cleanup orphaned link mappings
          await this.cleanupOrphanedMappings(
            remoteLinkIds,
            "link",
            rootFolderId
          );
        } else {
          logger.warn(
            "Skipping link orphan cleanup - API returned 0 links. " +
              "This indicates an API failure or empty collection. " +
              "Existing bookmarks will NOT be deleted to prevent data loss."
          );
        }

        // Cleanup orphaned collection mappings (if we have any remote collections)
        if (remoteCollectionIds.size > 0) {
          await this.cleanupOrphanedMappings(
            remoteCollectionIds,
            "collection",
            rootFolderId
          );
        }
      }

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
   * Cleanup orphaned mappings for a specific type (link or collection)
   */
  private async cleanupOrphanedMappings(
    remoteIds: Set<number>,
    type: "link" | "collection",
    browserRootFolderId: string
  ): Promise<void> {
    const orphanCleanup = new (await import("./orphans")).OrphanCleanup(
      this.errors
    );

    // Pass IDs to appropriate parameter based on type
    if (type === "link") {
      await orphanCleanup.cleanupOrphanedMappings(
        remoteIds,
        new Set<number>(), // No collection orphans
        browserRootFolderId
      );
    } else {
      await orphanCleanup.cleanupOrphanedMappings(
        new Set<number>(), // No link orphans
        remoteIds,
        browserRootFolderId
      );
    }

    // Normalize indices after deletions
    await orphanCleanup.normalizeIndices(browserRootFolderId);
  }

  /**
   * Get the error reporter for this instance
   */
  getErrorReporter(): SyncErrorReporter {
    return this.errors;
  }
}
