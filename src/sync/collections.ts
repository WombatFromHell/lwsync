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
import { LinkwardenAPI } from "../api";
import type { LinkwardenCollection } from "../types/api";
import type { Mapping, SyncPreference } from "../types/storage";
import type { BookmarkNode } from "../types/bookmarks";
import type { SyncStatsObject } from "./engine";
import type { SyncStats } from "./engine";
import { SyncErrorReporter, createErrorContext } from "./errorReporter";
import { extractMoveToken, removeMoveToken, isDescendantOf } from "./moves";
import { resolveConflict } from "./conflict";
import { createLogger } from "../utils";
import { generateOrderHash, getTokenInfo } from "./item-order-token";

const logger = createLogger("LWSync collections");

/**
 * Simple mapping map interface for dependency injection
 * Matches the inline MappingMap class in engine.ts
 */
export interface MappingMap {
  size: number;
  load(): Promise<void>;
  getMappingByLinkwardenId(
    id: number,
    type: "link" | "collection"
  ): Mapping | undefined;
  getMappingByBrowserId(browserId: string): Mapping | undefined;
  upsert(mapping: Mapping): void;
  delete(linkwardenId: number, type: "link" | "collection"): boolean;
}

export interface CollectionCaches {
  collections: Map<number, LinkwardenCollection>;
  bookmarks: Map<string, BookmarkNode>;
}

export interface CollectionSyncDeps {
  api: LinkwardenAPI;
  errorReporter?: SyncErrorReporter;
  cache?: MappingMap;
}

/**
 * Mock MappingMap for backward compatibility when no cache is provided
 */
class MappingMapMock implements MappingMap {
  get size(): number {
    return 0;
  }

  async load(): Promise<void> {}

  getMappingByLinkwardenId(
    _id: number,
    _type: "link" | "collection"
  ): Mapping | undefined {
    return undefined;
  }

  getMappingByBrowserId(_browserId: string): Mapping | undefined {
    return undefined;
  }

  upsert(_mapping: Mapping): void {}

  delete(_linkwardenId: number, _type: "link" | "collection"): boolean {
    return false;
  }
}

export class CollectionSync {
  private api: LinkwardenAPI;
  private errors: SyncErrorReporter;
  private cache: MappingMap;
  /** Set by RemoteSync before each sync cycle; defaults to "prefer-remote". */
  syncPreference: SyncPreference = "prefer-remote";

  constructor(
    apiOrDeps: LinkwardenAPI | CollectionSyncDeps,
    errorReporter?: SyncErrorReporter,
    cache?: MappingMap
  ) {
    if (apiOrDeps instanceof Object && "api" in apiOrDeps) {
      this.api = apiOrDeps.api;
      this.errors = apiOrDeps.errorReporter || new SyncErrorReporter();
      this.cache = apiOrDeps.cache || cache || new MappingMapMock();
    } else {
      this.api = apiOrDeps;
      this.errors = errorReporter || new SyncErrorReporter();
      this.cache = cache || new MappingMapMock();
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
    const existing = this.cache.getMappingByLinkwardenId(
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
      this.cache.upsert(mapping);
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
        this.cache.upsert(mapping);
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
        const targetParentMapping = this.cache.getMappingByLinkwardenId(
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
      let currentNode: BookmarkNode | undefined;
      try {
        currentNode = await bookmarks.get(existing.browserId);
      } catch {
        // Folder deleted externally — skip move check
        currentNode = undefined;
      }
      const actualBrowserParentId = currentNode?.parentId;

      const currentParentMapping = this.cache.getMappingByLinkwardenId(
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
    link: {
      id: number;
      name: string;
      url: string;
      updatedAt: string;
      description?: string;
    },
    parentBrowserId: string,
    stats: SyncStats
  ): Promise<void> {
    try {
      const existing = this.cache.getMappingByLinkwardenId(link.id, "link");
      let needsCreate = !existing;

      if (existing) {
        // Verify bookmark still exists — mapping may be stale (deleted externally)
        // bookmarks.get() throws when the ID doesn't exist in Chrome's bookmark tree
        let currentNode: BookmarkNode | undefined;
        try {
          currentNode = await bookmarks.get(existing.browserId);
        } catch {
          currentNode = undefined;
        }
        if (!currentNode) {
          logger.info("Stale mapping, cleaning up:", {
            linkId: link.id,
            browserId: existing.browserId,
          });
          await storage.removeMapping(link.id, "link");
          this.cache.delete(link.id, "link");
          needsCreate = true;
        } else {
          // Check for updates using conflict resolution (checksum + timestamp)
          const result = resolveConflict(existing, link, this.syncPreference);
          if (result === "use-remote") {
            await bookmarks.update(existing.browserId, {
              title: link.name,
              url: link.url,
            });
            existing.browserUpdatedAt = Date.now();
            existing.checksum = computeChecksum(link);
            existing.lastSyncedAt = Date.now();
          }
          // Update cached name/hash for order token
          existing.cachedName = link.name;
          existing.cachedNameHash = generateOrderHash(link.name);

          // CRITICAL: Always capture current browser index (source of truth)
          if (currentNode.index !== undefined) {
            existing.browserIndex = currentNode.index;
          } else if (link.description && existing.browserIndex === undefined) {
            // FALLBACK: Browser index unavailable - use server token
            const tokenInfo = getTokenInfo(link.description, link.name);
            if (tokenInfo?.hasToken && tokenInfo.index !== undefined) {
              existing.browserIndex = tokenInfo.index;
              logger.debug(
                "Using server order token as fallback (browser index unavailable):",
                { linkId: link.id, index: tokenInfo.index }
              );
            }
          }

          await storage.upsertMapping(existing);
          stats.increment("updated");
        }
      }

      if (needsCreate) {
        // Check if bookmark already exists
        const existingBookmarks = await bookmarks.search(link.url);
        const matchingBookmark = existingBookmarks.find(
          (b) => b.parentId === parentBrowserId && b.title === link.name
        );

        if (matchingBookmark) {
          // Create mapping for existing bookmark
          let browserIndex = matchingBookmark.index;

          if (link.description) {
            const tokenInfo = getTokenInfo(link.description, link.name);
            if (tokenInfo?.hasToken && tokenInfo.index !== undefined) {
              browserIndex = tokenInfo.index;
              logger.debug("Using server order token for existing bookmark:", {
                linkId: link.id,
                index: tokenInfo.index,
              });
            }
          }

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
            browserIndex,
            cachedName: link.name,
            cachedNameHash: generateOrderHash(link.name),
          };
          await storage.upsertMapping(mapping);
          this.cache.upsert(mapping);
        } else {
          // Create new bookmark
          const node = await bookmarks.create({
            parentId: parentBrowserId,
            title: link.name,
            url: link.url,
          });

          let browserIndex = node.index;

          if (link.description) {
            const tokenInfo = getTokenInfo(link.description, link.name);
            if (tokenInfo?.hasToken && tokenInfo.index !== undefined) {
              browserIndex = tokenInfo.index;
              logger.debug("Using server order token for initial order:", {
                linkId: link.id,
                index: tokenInfo.index,
              });
            }
          }

          const mapping: Mapping = {
            id: crypto.randomUUID(),
            linkwardenType: "link",
            linkwardenId: link.id,
            browserId: node.id,
            linkwardenUpdatedAt: new Date(link.updatedAt).getTime(),
            browserUpdatedAt: node.dateAdded || Date.now(),
            lastSyncedAt: Date.now(),
            checksum: computeChecksum(link),
            browserIndex,
            cachedName: link.name,
            cachedNameHash: generateOrderHash(link.name),
          };
          await storage.upsertMapping(mapping);
          this.cache.upsert(mapping);
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
   * Sync a single link from Linkwarden to browser
   * Standalone version with error collection support
   */
  async syncLink(
    link: {
      id: number;
      name: string;
      url: string;
      updatedAt: string;
      description?: string;
    },
    parentBrowserId: string,
    errors: string[],
    stats: {
      created: number;
      updated: number;
      deleted: number;
      skipped: number;
    }
  ): Promise<void> {
    try {
      const existing = this.cache.getMappingByLinkwardenId(link.id, "link");

      if (existing) {
        await this.updateExistingLink(link, parentBrowserId, existing, stats);
      } else {
        await this.createNewLink(link, parentBrowserId, stats);
      }
    } catch (error) {
      errors.push(
        `Failed to sync link ${link.id}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Update an existing linked bookmark
   */
  private async updateExistingLink(
    link: {
      id: number;
      name: string;
      url: string;
      updatedAt: string;
      description?: string;
    },
    parentBrowserId: string,
    existing: Mapping,
    stats: {
      created: number;
      updated: number;
      deleted: number;
      skipped: number;
    }
  ): Promise<void> {
    const result = resolveConflict(existing, link, this.syncPreference);

    if (result === "use-remote") {
      // Check if link was moved to a different folder on server
      let currentNode: BookmarkNode | undefined;
      try {
        currentNode = await bookmarks.get(existing.browserId);
      } catch {
        // Bookmark deleted externally — skip move check, update will recreate
        logger.info("Bookmark gone during update, skipping move check:", {
          linkId: link.id,
        });
        stats.updated++;
        return;
      }
      const wasMoved = currentNode?.parentId !== parentBrowserId;

      if (wasMoved) {
        logger.info("Link moved on server, updating browser:", {
          linkId: link.id,
          linkName: link.name,
          fromParentId: currentNode?.parentId,
          toParentId: parentBrowserId,
        });

        await bookmarks.move(existing.browserId, {
          parentId: parentBrowserId,
        });

        logger.info("Link move completed in browser:", link.name);
      }

      // Update browser bookmark title and URL
      await bookmarks.update(existing.browserId, {
        title: link.name,
        url: link.url,
      });

      existing.browserUpdatedAt = Date.now();
      existing.checksum = computeChecksum(link);
      existing.lastSyncedAt = Date.now();
      await storage.upsertMapping(existing);
      stats.updated++;
    } else if (result === "no-op") {
      // Check if link was moved on server (even if no content change)
      let currentNode: BookmarkNode | undefined;
      try {
        currentNode = await bookmarks.get(existing.browserId);
      } catch {
        // Bookmark deleted externally — skip move check
        return;
      }
      const wasMoved = currentNode?.parentId !== parentBrowserId;

      if (wasMoved) {
        logger.info("Link moved on server (no content change):", {
          linkId: link.id,
          linkName: link.name,
          fromParentId: currentNode?.parentId,
          toParentId: parentBrowserId,
        });

        await bookmarks.move(existing.browserId, {
          parentId: parentBrowserId,
        });

        logger.info("Link move completed in browser:", link.name);
      }

      // Just update last synced time
      existing.lastSyncedAt = Date.now();
      await storage.upsertMapping(existing);
    }
    // "use-local" - browser changes win, do nothing
  }

  /**
   * Create a new browser bookmark for a Linkwarden link
   */
  private async createNewLink(
    link: {
      id: number;
      name: string;
      url: string;
      updatedAt: string;
      description?: string;
    },
    parentBrowserId: string,
    stats: {
      created: number;
      updated: number;
      deleted: number;
      skipped: number;
    }
  ): Promise<void> {
    // Check if bookmark already exists by URL
    const existingBookmarks = await bookmarks.search(link.url);
    const matchingBookmark = existingBookmarks.find(
      (b) => b.parentId === parentBrowserId && b.title === link.name
    );

    if (matchingBookmark) {
      // Bookmark exists but has no mapping - create mapping (don't duplicate)
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
      };
      await storage.upsertMapping(mapping);
      stats.created++;
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
          let bookmark: BookmarkNode | undefined;
          try {
            bookmark = await bookmarks.get(mapping.browserId);
          } catch {
            bookmark = undefined;
          }
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

          // Push order tokens to server for links (not collections)
          if (type === "link") {
            await this.pushOrderTokensToServer(
              orderedMappings,
              parentBrowserId
            );
          }
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
   * Push order tokens to server for reordered links
   * Updates link descriptions with order token: [LW:O:{"hash":"index"}]
   */
  private async pushOrderTokensToServer(
    mappings: Mapping[],
    parentBrowserId: string
  ): Promise<void> {
    try {
      // Get current bookmark details for names
      const children = await bookmarks.getChildren(parentBrowserId);
      const bookmarkMap = new Map(children.map((child) => [child.id, child]));

      // Build order updates
      const orderUpdates = mappings
        .filter((m) => m.linkwardenType === "link" && m.cachedName)
        .map((mapping) => {
          const bookmark = bookmarkMap.get(mapping.browserId);
          if (!bookmark) return null;

          return {
            linkId: mapping.linkwardenId,
            name: mapping.cachedName!,
            index: mapping.browserIndex || 0,
          };
        })
        .filter((u): u is NonNullable<typeof u> => u !== null);

      if (orderUpdates.length === 0) {
        logger.debug("No order tokens to push");
        return;
      }

      logger.info("Pushing order tokens to server:", {
        count: orderUpdates.length,
      });

      // Push each order token (could be batched in future)
      for (const update of orderUpdates) {
        try {
          await this.api.updateLinkOrder(
            update.linkId,
            update.name,
            update.index
          );
          logger.debug("Order token pushed:", {
            linkId: update.linkId,
            index: update.index,
          });
        } catch (error) {
          this.errors.collect(
            error as Error,
            createErrorContext("pushOrderToken", {
              itemId: update.linkId,
            })
          );
          // Don't fail entire sync for order token failure
        }
      }

      logger.info("Order tokens pushed to server:", {
        pushed: orderUpdates.length,
      });
    } catch (error) {
      this.errors.collect(
        error as Error,
        createErrorContext("pushOrderTokensToServer", {
          itemId: parentBrowserId,
        })
      );
      // Don't fail entire sync for order token failure
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

/**
 * Standalone syncLink function for backward compatibility
 * Creates a temporary CollectionSync instance to sync a single link
 */
export async function syncLink(
  link: {
    id: number;
    name: string;
    url: string;
    updatedAt: string;
    description?: string;
  },
  parentBrowserId: string,
  errors: string[],
  stats: { created: number; updated: number; deleted: number; skipped: number }
): Promise<void> {
  // Create a minimal API client just to satisfy the constructor
  // Note: This is a backward-compatibility wrapper - consider using CollectionSync directly
  const envUrl =
    typeof process !== "undefined" && process.env?.ENDPOINT
      ? process.env.ENDPOINT
      : "http://localhost:3000";
  const envToken =
    typeof process !== "undefined" && process.env?.API_KEY
      ? process.env.API_KEY
      : "dummy-token";

  const api = new LinkwardenAPI(envUrl, envToken);
  const instance = new CollectionSync(api);
  await instance.syncLink(link, parentBrowserId, errors, stats);
}

// ============================================================================
// Path Helpers (moved from mappings.ts for better encapsulation)
// ============================================================================

/**
 * Build a path string from hierarchy for path-based matching
 * E.g., "/Root Collection/Subcollection/Grandchild"
 */
export function buildPath(
  collectionId: number,
  collectionsCache: Map<number, LinkwardenCollection>
): string {
  const parts: string[] = [];
  let currentId: number | undefined = collectionId;

  while (currentId !== undefined) {
    const collection = collectionsCache.get(currentId);
    if (!collection) break;

    parts.unshift(collection.name);

    // Find parent by checking if any collection contains this as a subcollection
    const parentCollection = Array.from(collectionsCache.values()).find((c) =>
      c.collections?.some((sc: LinkwardenCollection) => sc.id === currentId)
    );

    if (!parentCollection) break;
    currentId = parentCollection.id;
  }

  return `/${parts.join("/")}`;
}

/**
 * Build a browser folder path from hierarchy
 * E.g., "/Other Bookmarks/Root Collection/Subcollection"
 */
async function buildBrowserPath(
  browserId: string,
  bookmarksCache: Map<string, BookmarkNode>
): Promise<string> {
  const parts: string[] = [];
  let currentId: string | undefined = browserId;

  while (currentId !== undefined) {
    const node = bookmarksCache.get(currentId);
    if (!node) break;

    parts.unshift(node.title || "");

    currentId = node.parentId;
  }

  return `/${parts.join("/")}`;
}

/**
 * Find a browser folder by path
 * Returns the folder ID if found, undefined otherwise
 */
async function findFolderByPath(
  targetPath: string,
  rootFolderId: string
): Promise<string | undefined> {
  // Normalize path - remove leading slash for splitting
  const pathParts = targetPath.replace(/^\//, "").split("/");

  // Start from root folder
  let currentFolderId = rootFolderId;

  // Traverse path parts (skip first if it matches root folder name)
  let rootFolder: BookmarkNode | undefined;
  try {
    rootFolder = await bookmarks.get(rootFolderId);
  } catch {
    rootFolder = undefined;
  }
  const rootName = rootFolder?.title;

  let startIndex = 0;
  if (pathParts[0] === rootName) {
    startIndex = 1;
  }

  for (let i = startIndex; i < pathParts.length; i++) {
    const partName = pathParts[i];
    const children = await bookmarks.getChildren(currentFolderId);

    // Find folder with matching name (folders have no URL)
    const matchingFolder = children.find(
      (child) => child.title === partName && !child.url
    );

    if (!matchingFolder) {
      return undefined; // Path doesn't exist
    }

    currentFolderId = matchingFolder.id;
  }

  return currentFolderId;
}

/**
 * Find or create a nested folder structure based on path parts
 * Starts from the browser root folder and traverses/creates folders as needed
 * Returns the ID of the deepest (final) folder in the path
 */
export async function findOrCreateNestedFolder(
  pathParts: string[],
  rootFolderId: string
): Promise<string> {
  if (pathParts.length === 0) {
    return rootFolderId;
  }

  let currentFolderId = rootFolderId;

  for (const partName of pathParts) {
    const children = await bookmarks.getChildren(currentFolderId);

    // Find existing folder with matching name (folders have no URL)
    let matchingFolder = children.find(
      (child) => child.title === partName && !child.url
    );

    // Create folder if it doesn't exist
    if (!matchingFolder) {
      matchingFolder = await bookmarks.create({
        parentId: currentFolderId,
        title: partName,
      });
    }

    currentFolderId = matchingFolder.id;
  }

  return currentFolderId;
}

/**
 * Cache all Linkwarden collections for path-based lookup
 */
export async function buildCollectionsCache(
  api: LinkwardenAPI,
  rootCollectionId: number
): Promise<Map<number, LinkwardenCollection>> {
  const cache = new Map<number, LinkwardenCollection>();

  // Fetch all collections
  const allCollections = await api.getCollections();

  // Build parent-child relationships
  for (const collection of allCollections) {
    cache.set(collection.id, { ...collection });
  }

  // Fetch full tree to get complete hierarchy
  const rootCollection = await api.getCollectionTree(rootCollectionId);

  // Update cache with full tree data
  function updateCache(collection: LinkwardenCollection) {
    cache.set(collection.id, collection);
    if (collection.collections) {
      for (const sub of collection.collections) {
        updateCache(sub);
      }
    }
  }

  updateCache(rootCollection);

  return cache;
}

/**
 * Cache browser bookmark tree for path-based lookup
 */
export async function buildBookmarksCache(
  rootFolderId: string
): Promise<Map<string, BookmarkNode>> {
  const cache = new Map<string, BookmarkNode>();

  async function traverse(node: BookmarkNode) {
    cache.set(node.id, node);
    if (node.children) {
      for (const child of node.children) {
        await traverse(child);
      }
    }
  }

  let root: BookmarkNode | undefined;
  try {
    root = await bookmarks.get(rootFolderId);
  } catch {
    root = undefined;
  }
  if (root) {
    await traverse(root);
  }

  return cache;
}
