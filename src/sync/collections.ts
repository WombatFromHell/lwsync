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
import type { Mapping } from "../types/storage";
import type { BookmarkNode } from "../types/bookmarks";
import type { SyncStats } from "./engine";
import { SyncErrorReporter, createErrorContext } from "./errorReporter";
import { extractMoveToken, removeMoveToken, isDescendantOf } from "./moves";
import { computeChecksum, createLogger } from "../utils";
import { CollectionLinkSync } from "./collection-links";

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
}

export interface CollectionCaches {
  collections: Map<number, LinkwardenCollection>;
  bookmarks: Map<string, BookmarkNode>;
}

export class CollectionSync {
  private api: LinkwardenAPI;
  private errors: SyncErrorReporter;
  private cache: MappingMap;
  private links: CollectionLinkSync;

  constructor(
    api: LinkwardenAPI,
    errorReporter: SyncErrorReporter,
    cache: MappingMap
  ) {
    this.api = api;
    this.errors = errorReporter;
    this.cache = cache;
    this.links = new CollectionLinkSync(api, errorReporter, cache);
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
          await this.links.syncLinkInline(link, folderId, stats);
        }

        // Restore bookmark order after all links are synced
        await this.links.restoreOrder(folderId, stats, "link", lastSyncTime);
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
        await this.links.restoreOrder(
          folderId,
          stats,
          "collection",
          lastSyncTime
        );
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
      const currentNode = await bookmarks.get(existing.browserId);
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
  const rootFolder = await bookmarks.get(rootFolderId);
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

  const root = await bookmarks.get(rootFolderId);
  if (root) {
    await traverse(root);
  }

  return cache;
}
