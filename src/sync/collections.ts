/**
 * Collection Sync
 * Handles synchronization of collections (folders) between Linkwarden and browser
 *
 * Supports:
 * - Path-based matching for duplicate folder names
 * - Move token processing for folder moves
 * - Server-side move detection
 */

import * as storage from "../storage";
import * as bookmarks from "../bookmarks";
import type { LinkwardenAPI } from "../api";
import type { LinkwardenCollection } from "../types/api";
import type { Mapping } from "../types/storage";
import type { BookmarkNode } from "../types/bookmarks";
import type { SyncStatsObject } from "./engine";
import type { SyncStats } from "./engine";
import { SyncErrorReporter, createErrorContext } from "./errorReporter";
import { extractMoveToken, removeMoveToken, isDescendantOf } from "./moves";
import {
  buildPath,
  buildBrowserPath,
  findFolderByPath,
  findOrCreateNestedFolder,
} from "./mappings";
import { createLogger } from "../utils";

const logger = createLogger("LWSync collections");

export interface CollectionCaches {
  collections: Map<number, LinkwardenCollection>;
  bookmarks: Map<string, BookmarkNode>;
}

export interface CollectionSyncDeps {
  api: LinkwardenAPI;
  errorReporter?: SyncErrorReporter;
}

export class CollectionSync {
  private api: LinkwardenAPI;
  private errors: SyncErrorReporter;

  constructor(
    apiOrDeps: LinkwardenAPI | CollectionSyncDeps,
    errorReporter?: SyncErrorReporter
  ) {
    if (apiOrDeps instanceof Object && "api" in apiOrDeps) {
      this.api = apiOrDeps.api;
      this.errors = apiOrDeps.errorReporter || new SyncErrorReporter();
    } else {
      this.api = apiOrDeps;
      this.errors = errorReporter || new SyncErrorReporter();
    }
  }

  /**
   * Sync a collection and its subcollections
   * @param collection - The collection to sync
   * @param parentBrowserId - The browser folder ID to sync into
   * @param caches - Collection and bookmark caches
   * @param stats - Sync statistics
   * @param isRootCollection - If true, don't create a folder for this collection (sync links directly to parent)
   * @param lastSyncTime - The time of the previous sync (for detecting user reorders)
   */
  async syncCollection(
    collection: LinkwardenCollection,
    parentBrowserId: string,
    caches: CollectionCaches,
    stats: SyncStats,
    isRootCollection: boolean = false,
    lastSyncTime?: number
  ): Promise<void> {
    try {
      // Sync the collection folder itself (skip for root collection)
      const folderId = isRootCollection
        ? parentBrowserId // Root collection: sync links directly to browser root
        : await this.syncCollectionFolder(
            collection,
            parentBrowserId,
            caches,
            stats
          );

      // Sync links in this collection
      if (collection.links && collection.links.length > 0) {
        for (const link of collection.links) {
          // Delegate to links module (imported dynamically to avoid circular deps)
          // For now, inline the sync logic
          await this.syncLinkInline(link, folderId, stats);
        }

        // Restore bookmark order after all links are synced
        await this.restoreOrder(folderId, stats, "link", lastSyncTime);
      }

      // Sync subcollections
      if (collection.collections && collection.collections.length > 0) {
        for (const subCollection of collection.collections) {
          await this.syncSubCollection(
            subCollection,
            folderId,
            caches,
            stats,
            lastSyncTime
          );
        }

        // Restore folder order after all subcollections are synced
        await this.restoreOrder(folderId, stats, "collection", lastSyncTime);
      }
    } catch (error) {
      this.errors.collect(
        error as Error,
        createErrorContext("syncCollection", {
          itemId: collection.id,
          itemName: collection.name,
        })
      );
    }
  }

  /**
   * Sync a subcollection (recursive)
   */
  private async syncSubCollection(
    subCollection: LinkwardenCollection,
    parentBrowserId: string,
    caches: CollectionCaches,
    stats: SyncStats,
    lastSyncTime?: number
  ): Promise<void> {
    await this.syncCollection(
      subCollection,
      parentBrowserId,
      caches,
      stats,
      false,
      lastSyncTime
    );
  }

  /**
   * Sync a collection folder (create/update/move)
   */
  private async syncCollectionFolder(
    collection: LinkwardenCollection,
    parentBrowserId: string,
    caches: CollectionCaches,
    stats: SyncStats
  ): Promise<string> {
    // Strategy 1: Check mapping table first (O(1) lookup)
    const existing = await storage.getMappingByLinkwardenId(
      collection.id,
      "collection"
    );

    if (existing) {
      return this.updateExistingFolder(
        collection,
        parentBrowserId,
        existing,
        caches,
        stats
      );
    }

    // Strategy 2: Name matching under known parent
    const children = await bookmarks.getChildren(parentBrowserId);
    const existingFolder = children.find(
      (child) => child.title === collection.name && !child.url
    );

    if (existingFolder) {
      // Folder exists with matching name under expected parent
      const mapping: Mapping = {
        id: crypto.randomUUID(),
        linkwardenType: "collection",
        linkwardenId: collection.id,
        browserId: existingFolder.id,
        linkwardenUpdatedAt: new Date(collection.updatedAt).getTime(),
        browserUpdatedAt:
          existingFolder.dateGroupModified ||
          existingFolder.dateAdded ||
          Date.now(),
        lastSyncedAt: Date.now(),
        checksum: computeChecksum({ name: collection.name }),
      };
      await storage.upsertMapping(mapping);
      return existingFolder.id;
    }

    // Strategy 3: Path-based matching (handles duplicate names)
    if (collection.id !== undefined) {
      const path = buildPath(collection.id, caches.collections);
      const folderId = await findFolderByPath(path, parentBrowserId);

      if (folderId) {
        // Found folder by path - create mapping
        const mapping: Mapping = {
          id: crypto.randomUUID(),
          linkwardenType: "collection",
          linkwardenId: collection.id,
          browserId: folderId,
          linkwardenUpdatedAt: new Date(collection.updatedAt).getTime(),
          browserUpdatedAt: Date.now(),
          lastSyncedAt: Date.now(),
          checksum: computeChecksum({ name: collection.name }),
        };
        await storage.upsertMapping(mapping);
        return folderId;
      }
    }

    // Strategy 4: Create new folder
    return this.createNewFolder(collection, parentBrowserId, stats);
  }

  /**
   * Update an existing folder (check for moves/renames)
   */
  private async updateExistingFolder(
    collection: LinkwardenCollection,
    parentBrowserId: string,
    existing: Mapping,
    caches: CollectionCaches,
    stats: SyncStats
  ): Promise<string> {
    const folderId = existing.browserId;
    let moveTokenProcessed = false;

    // Check for move token in description (browser → server move)
    if (collection.description) {
      const moveToken = extractMoveToken(collection.description);

      if (moveToken && moveToken.to) {
        const targetParentMapping = await storage.getMappingByLinkwardenId(
          moveToken.to,
          "collection"
        );

        if (targetParentMapping) {
          logger.info("Move token detected, moving folder:", {
            folderId: collection.id,
            folderName: collection.name,
            newParentId: moveToken.to,
          });

          try {
            // Move browser folder
            await bookmarks.move(folderId, {
              parentId: targetParentMapping.browserId,
            });

            // Remove move token from description on server
            const cleanDescription = removeMoveToken(collection.description);
            await this.api.updateCollection(collection.id, {
              description: cleanDescription,
              parentId: moveToken.to,
            });

            // Update mapping with new parent
            existing.browserUpdatedAt = Date.now();
            existing.lastSyncedAt = Date.now();
            await storage.upsertMapping(existing);

            logger.info("Folder move completed:", collection.name);
            moveTokenProcessed = true;
          } catch (error) {
            this.errors.collect(
              error as Error,
              createErrorContext("processMoveToken", {
                itemId: collection.id,
                itemName: collection.name,
              })
            );
          }
        } else {
          logger.warn("Move token target not found:", moveToken.to);
        }
      }
    }

    // Check for name updates
    if (collection.name) {
      const remoteUpdatedAt = new Date(collection.updatedAt).getTime();
      if (remoteUpdatedAt > existing.browserUpdatedAt) {
        await bookmarks.update(folderId, { title: collection.name });
        existing.browserUpdatedAt = Date.now();
        existing.lastSyncedAt = Date.now();
        await storage.upsertMapping(existing);
        stats.increment("updated");
      }
    }
    // Note: Order restoration is done separately in restoreOrder()

    // Check for server-side folder move (parentId changed without move token)
    if (collection.parentId !== undefined && !moveTokenProcessed) {
      const currentNode = await bookmarks.get(existing.browserId);
      const actualBrowserParentId = currentNode?.parentId;

      const currentParentMapping = await storage.getMappingByLinkwardenId(
        collection.parentId,
        "collection"
      );

      if (currentParentMapping && actualBrowserParentId !== parentBrowserId) {
        logger.info("Server folder move detected (parentId changed):", {
          folderId: collection.id,
          folderName: collection.name,
          fromParentId: actualBrowserParentId,
          toParentId: currentParentMapping.browserId,
        });

        try {
          await bookmarks.move(existing.browserId, {
            parentId: currentParentMapping.browserId,
          });

          existing.browserUpdatedAt = Date.now();
          existing.lastSyncedAt = Date.now();
          await storage.upsertMapping(existing);

          logger.info("Server folder move completed:", collection.name);
        } catch (error) {
          this.errors.collect(
            error as Error,
            createErrorContext("serverFolderMove", {
              itemId: collection.id,
              itemName: collection.name,
            })
          );
        }
      }
    }

    return folderId;
  }

  /**
   * Create a new folder
   */
  private async createNewFolder(
    collection: LinkwardenCollection,
    parentBrowserId: string,
    stats: SyncStats
  ): Promise<string> {
    logger.info("Creating folder:", {
      name: collection.name,
      parentId: parentBrowserId,
    });

    const node = await bookmarks.create({
      parentId: parentBrowserId,
      title: collection.name,
    });

    const mapping: Mapping = {
      id: crypto.randomUUID(),
      linkwardenType: "collection",
      linkwardenId: collection.id,
      browserId: node.id,
      linkwardenUpdatedAt: new Date(collection.updatedAt).getTime(),
      browserUpdatedAt: node.dateAdded || Date.now(),
      lastSyncedAt: Date.now(),
      checksum: computeChecksum({ name: collection.name }),
    };
    await storage.upsertMapping(mapping);

    return node.id;
  }

  /**
   * Inline link sync (to avoid circular dependency with links.ts)
   * Syncs a single link, but does NOT restore order - that's done separately
   */
  private async syncLinkInline(
    link: { id: number; name: string; url: string; updatedAt: string },
    parentBrowserId: string,
    stats: SyncStats
  ): Promise<void> {
    try {
      const existing = await storage.getMappingByLinkwardenId(link.id, "link");

      if (existing) {
        // Check for updates
        const remoteUpdatedAt = new Date(link.updatedAt).getTime();
        if (remoteUpdatedAt > existing.browserUpdatedAt) {
          await bookmarks.update(existing.browserId, {
            title: link.name,
            url: link.url,
          });
          existing.browserUpdatedAt = Date.now();
          existing.lastSyncedAt = Date.now();
          await storage.upsertMapping(existing);
          stats.increment("updated");
        }
        // Note: Order restoration is done separately in restoreOrder()
      } else {
        // Check if bookmark already exists
        const existingBookmarks = await bookmarks.search(link.url);
        const matchingBookmark = existingBookmarks.find(
          (b) => b.parentId === parentBrowserId && b.title === link.name
        );

        if (matchingBookmark) {
          // Create mapping for existing bookmark
          const mapping: Mapping = {
            id: crypto.randomUUID(),
            linkwardenType: "link",
            linkwardenId: link.id,
            browserId: matchingBookmark.id,
            linkwardenUpdatedAt: new Date(link.updatedAt).getTime(),
            browserUpdatedAt:
              matchingBookmark.dateGroupModified ||
              matchingBookmark.dateAdded ||
              Date.now(),
            lastSyncedAt: Date.now(),
            checksum: computeChecksum(link),
            browserIndex: matchingBookmark.index, // Capture existing index
          };
          await storage.upsertMapping(mapping);
        } else {
          // Create new bookmark
          const node = await bookmarks.create({
            parentId: parentBrowserId,
            title: link.name,
            url: link.url,
          });

          const mapping: Mapping = {
            id: crypto.randomUUID(),
            linkwardenType: "link",
            linkwardenId: link.id,
            browserId: node.id,
            linkwardenUpdatedAt: new Date(link.updatedAt).getTime(),
            browserUpdatedAt: node.dateAdded || Date.now(),
            lastSyncedAt: Date.now(),
            checksum: computeChecksum(link),
            browserIndex: node.index, // Capture initial index
          };
          await storage.upsertMapping(mapping);
          stats.increment("created");
        }
      }
    } catch (error) {
      this.errors.collect(
        error as Error,
        createErrorContext("syncLinkInline", {
          itemId: link.id,
          itemName: link.name,
        })
      );
    }
  }

  /**
   * Restore bookmark/folder order based on browserIndex mappings
   * Called after all items are synced to reorder efficiently
   * Also detects and captures user reorders (when browser is newer than last sync)
   * @param lastSyncTime - The time of the previous sync (from metadata), used to detect user reorders
   */
  private async restoreOrder(
    parentBrowserId: string,
    stats: SyncStats,
    type: "link" | "collection" = "link",
    lastSyncTime?: number
  ): Promise<void> {
    try {
      // Get current order in the folder first
      const currentChildren = await bookmarks.getChildren(parentBrowserId);

      if (currentChildren.length === 0) {
        return; // Nothing in folder
      }

      // Get all mappings and filter to only those in this parent folder
      const allMappings = await storage.getMappings();
      const currentIds = new Set(currentChildren.map((child) => child.id));
      const parentMappings = allMappings.filter(
        (m) =>
          m.linkwardenType === type &&
          m.browserId &&
          currentIds.has(m.browserId)
      );

      if (parentMappings.length === 0) {
        return; // No items to restore order for
      }

      // Build map of current browser order
      const currentOrderMap = new Map<string, number>();
      currentChildren.forEach((child, index) => {
        currentOrderMap.set(child.id, index);
      });

      // Check if current browser order matches stored browserIndex
      let hasMismatch = false;
      let hasStoredOrder = false;
      let browserIsNewer = false;

      for (const mapping of parentMappings) {
        if (mapping.browserIndex !== undefined) {
          hasStoredOrder = true;
        }
        const currentPos = currentOrderMap.get(mapping.browserId);
        if (currentPos !== undefined && mapping.browserIndex !== currentPos) {
          hasMismatch = true;
        }
        // Check if browser was modified after last sync (user reorder)
        // Use the bookmark's dateGroupModified field for accurate detection
        // Note: lastSyncTime can be 0 for first sync, so use >= 0 check
        if (lastSyncTime !== undefined && lastSyncTime >= 0) {
          const bookmark = await bookmarks.get(mapping.browserId);
          if (bookmark && bookmark.dateGroupModified) {
            logger.debug("Checking reorder:", {
              bookmarkId: mapping.browserId,
              dateGroupModified: bookmark.dateGroupModified,
              lastSyncTime,
              isNewer: bookmark.dateGroupModified > lastSyncTime,
            });
            if (bookmark.dateGroupModified > lastSyncTime) {
              browserIsNewer = true;
            }
          }
        } else if (lastSyncTime === undefined) {
          // No lastSyncTime available - assume browser is newer (first sync scenario)
          browserIsNewer = true;
        }
      }

      logger.debug("Order check result:", {
        hasMismatch,
        hasStoredOrder,
        browserIsNewer,
        lastSyncTime,
      });

      if (hasMismatch) {
        // Mismatch detected - decide whether to capture or restore
        if (browserIsNewer && hasStoredOrder) {
          // Browser was modified after last sync - user reordered, capture new order
          for (let i = 0; i < currentChildren.length; i++) {
            const child = currentChildren[i];
            const mapping = parentMappings.find(
              (m) => m.browserId === child.id
            );
            if (mapping) {
              mapping.browserIndex = i;
              await storage.upsertMapping(mapping);
            }
          }
          logger.debug("Captured user reorder (browser newer):", {
            parentId: parentBrowserId,
            type,
            count: currentChildren.length,
          });
        } else if (hasStoredOrder) {
          // Browser not newer - restore stored order (LWW: stored order wins)
          const orderedMappings = parentMappings
            .filter((m) => m.browserIndex !== undefined)
            .sort((a, b) => a.browserIndex! - b.browserIndex!);

          const currentOrder = currentChildren.map((child) => child.id);
          const targetOrder = orderedMappings.map((m) => m.browserId);

          // Check if reordering is actually needed
          const needsReorder = currentOrder.some(
            (id, index) => id !== targetOrder[index]
          );

          if (!needsReorder) {
            logger.debug("Order already correct:", {
              parentId: parentBrowserId,
              type,
            });
            return;
          }

          // Build reorder operations
          const reorderOps = orderedMappings.map((mapping, targetIndex) => ({
            id: mapping.browserId,
            targetIndex,
          }));

          logger.info("Restoring order:", {
            parentId: parentBrowserId,
            type,
            count: reorderOps.length,
          });

          // Execute batch reorder
          await bookmarks.reorderWithinFolder(reorderOps, parentBrowserId);

          stats.increment("updated");
          logger.debug("Order restored:", {
            parentId: parentBrowserId,
            type,
            targetOrder: targetOrder,
          });
        } else {
          // No stored order - capture current browser order
          for (let i = 0; i < currentChildren.length; i++) {
            const child = currentChildren[i];
            const mapping = parentMappings.find(
              (m) => m.browserId === child.id
            );
            if (mapping) {
              mapping.browserIndex = i;
              await storage.upsertMapping(mapping);
            }
          }
          logger.debug("Captured initial order:", {
            parentId: parentBrowserId,
            type,
            count: currentChildren.length,
          });
        }
        return;
      }

      // No mismatch - order is already correct
      logger.debug("Order already correct:", {
        parentId: parentBrowserId,
        type,
      });
    } catch (error) {
      this.errors.collect(
        error as Error,
        createErrorContext("restoreOrder", {
          itemId: parentBrowserId,
          data: { type },
        })
      );
    }
  }

  /**
   * Get the error reporter for this instance
   */
  getErrorReporter(): SyncErrorReporter {
    return this.errors;
  }
}

// Helper function for checksum computation
function computeChecksum(item: { name?: string; url?: string }): string {
  const str = `${item.name || ""}|${item.url || ""}`;
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(16);
}
