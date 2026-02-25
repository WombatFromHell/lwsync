/**
 * Core sync engine with conflict resolution
 * Handles bidirectional sync between Linkwarden and browser bookmarks
 */

import type { LinkwardenAPI } from "./api";
import type { LinkwardenCollection, LinkwardenLink } from "./types/api";
import type { Mapping, PendingChange, SyncMetadata } from "./types/storage";
import type { BookmarkNode } from "./types/bookmarks";
import type {
  SyncResult,
  ConflictResult,
  MoveToken,
  ChecksumItem,
} from "./types/sync";
import { parseFolderPath as parsePath } from "./utils/path";
import { createLogger } from "./utils/logger";
import { now } from "./utils/id";
import * as storage from "./storage";
import * as bookmarks from "./bookmarks";

const logger = createLogger("LWSync");

// Re-export for backward compatibility with tests
export { parseFolderPath } from "./utils/path";

/**
 * Compute checksum for a Linkwarden item (for change detection)
 */
export function computeChecksum(item: ChecksumItem): string {
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
 * Move token helpers for folder move tracking via description field
 * Token format: "{LW:MOVE:{"to":parentId,"ts":timestamp}}"
 */
const MOVE_TOKEN_PREFIX = "{LW:MOVE:";
const MOVE_TOKEN_SUFFIX = "}";

/**
 * Append move token to collection description
 */
export function appendMoveToken(
  description: string | undefined,
  parentId: number
): string {
  const token: MoveToken = { to: parentId, ts: now() };
  const tokenStr = `${MOVE_TOKEN_PREFIX}${JSON.stringify(token)}${MOVE_TOKEN_SUFFIX}`;
  if (!description) return tokenStr;
  return `${description} ${tokenStr}`;
}

/**
 * Extract move token from description if present
 */
export function extractMoveToken(
  description: string | undefined
): MoveToken | null {
  if (!description) return null;

  // Match {LW:MOVE:{...}} pattern - handles nested JSON
  const match = description.match(/\{LW:MOVE:(\{[^}]+\})\}/);
  if (!match) return null;

  try {
    return JSON.parse(match[1]);
  } catch {
    return null;
  }
}

/**
 * Remove move token from description
 */
export function removeMoveToken(description: string | undefined): string {
  if (!description) return "";
  return description.replace(/\s*\{LW:MOVE:\{[^}]+\}\}/g, "").trim();
}

/**
 * Check if a folder is a descendant of another folder (prevent circular moves)
 * Traverses up the parent chain to see if targetParentId is an ancestor
 */
export async function isDescendantOf(
  folderBrowserId: string,
  targetParentId: string,
  bookmarksCache?: Map<string, BookmarkNode>
): Promise<boolean> {
  // Build cache if not provided
  if (!bookmarksCache) {
    bookmarksCache = new Map();
    async function traverse(node: BookmarkNode) {
      bookmarksCache!.set(node.id, node);
      if (node.children) {
        for (const child of node.children) {
          await traverse(child);
        }
      }
    }
    const tree = await bookmarks.getTree();
    for (const root of tree) {
      await traverse(root);
    }
  }

  // Traverse up from folder to see if we reach targetParentId
  let currentId: string | undefined = folderBrowserId;
  while (currentId) {
    const node = bookmarksCache.get(currentId);
    if (!node) break;

    // If parent is the target, it's a descendant
    if (node.parentId === targetParentId) {
      return true;
    }

    // If we've reached the target itself
    if (currentId === targetParentId) {
      return true;
    }

    currentId = node.parentId;
  }

  return false;
}

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
export async function buildBrowserPath(
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
export async function findFolderByPath(
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
 * Parse a folder path string into an array of folder names
 * Supports Unix-style paths with / delimiter
 * E.g., "Bookmarks Menu/Linkwarden" -> ["Bookmarks Menu", "Linkwarden"]
 * Re-exported from utils/path for backward compatibility
 */

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
      logger.info(
        `Creating folder: "${partName}" under parent ${currentFolderId}`
      );
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

/**
 * Resolve conflicts between Linkwarden and browser bookmark
 * Strategy: Last-Write-Wins with checksum validation
 */
export function resolveConflict(
  local: Mapping,
  remote: { name?: string; url?: string; updatedAt: string }
): ConflictResult {
  const remoteUpdatedAt = new Date(remote.updatedAt).getTime();

  // 1. If checksums match, no conflict
  const remoteChecksum = computeChecksum(remote);
  if (local.checksum === remoteChecksum) {
    return "no-op";
  }

  // 2. Last-write-wins based on updatedAt timestamp
  if (remoteUpdatedAt > local.browserUpdatedAt) {
    return "use-remote"; // Linkwarden wins
  } else if (local.browserUpdatedAt > remoteUpdatedAt) {
    return "use-local"; // Browser wins
  }

  // 3. Exact timestamp tie: prefer browser (user's immediate action)
  return "use-local";
}

/**
 * Sync engine class
 */
export class SyncEngine {
  private api: LinkwardenAPI;
  private isSyncing = false;

  constructor(api: LinkwardenAPI) {
    this.api = api;
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
    const errors: string[] = [];
    const stats = { created: 0, updated: 0, deleted: 0, skipped: 0 };

    logger.info("Starting sync...");

    try {
      const metadata = await storage.getSyncMetadata();

      if (!metadata) {
        // First run - need to initialize
        throw new Error("Sync not configured. Please set up in popup UI.");
      }

      return await this.syncWithMetadata(metadata, errors, stats);
    } catch (error) {
      logger.error("Sync failed:", error);
      errors.push(error instanceof Error ? error.message : String(error));
      return { ...stats, errors };
    }
  }

  /**
   * Perform sync with provided metadata (avoids storage read)
   * Used internally by sync() and initialize()
   */
  private async syncWithMetadata(
    metadata: SyncMetadata,
    errors: string[],
    stats: {
      created: number;
      updated: number;
      deleted: number;
      skipped: number;
    }
  ): Promise<SyncResult> {
    if (this.isSyncing) {
      throw new Error("Sync already in progress");
    }

    this.isSyncing = true;

    try {
      // Step 1: Process pending changes from browser events FIRST
      await this.processPendingChanges(errors);

      // Step 2: Sync from Linkwarden to browser
      await this.syncFromLinkwarden(metadata, errors, stats);

      // Step 3: Update last sync time
      metadata.lastSyncTime = Date.now();
      await storage.saveSyncMetadata(metadata);

      // Step 4: Final cleanup
      await storage.cleanupResolvedChanges();

      logger.info("Sync complete:", {
        created: stats.created,
        updated: stats.updated,
        deleted: stats.deleted,
        skipped: stats.skipped,
        errors: errors.length,
      });
    } catch (error) {
      logger.error("Sync failed:", error);
      errors.push(error instanceof Error ? error.message : String(error));
    } finally {
      this.isSyncing = false;
    }

    return { ...stats, errors };
  }

  /**
   * Process pending changes from browser event listeners
   */
  private async processPendingChanges(errors: string[]): Promise<void> {
    const pending = await storage.getPendingChanges();
    const unresolved = pending.filter((c) => !c.resolved);

    if (unresolved.length === 0) return;

    for (const change of unresolved) {
      try {
        if (change.source === "browser") {
          await this.applyBrowserChange(change);
        }
        await storage.resolvePendingChange(change.id);
      } catch (error) {
        logger.error("Failed to process change:", change.id, error);
        errors.push(
          `Failed to apply change ${change.id}: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }

    await storage.cleanupResolvedChanges();
  }

  /**
   * Apply a change from browser to Linkwarden
   */
  private async applyBrowserChange(change: PendingChange): Promise<void> {
    const metadata = await storage.getSyncMetadata();
    if (!metadata) {
      logger.warn("No sync metadata, skipping browser change");
      return;
    }

    switch (change.type) {
      case "create":
      case "update": {
        // First check if we have a link mapping (for renames where URL might not be provided)
        if (change.linkwardenId) {
          const linkMapping = await storage.getMappingByLinkwardenId(
            change.linkwardenId,
            "link"
          );
          if (linkMapping) {
            // It's an existing link - update name and/or URL
            const updates: { name?: string; url?: string } = {};
            if (change.data?.title) updates.name = change.data.title;
            if (change.data?.url) updates.url = change.data.url;

            if (Object.keys(updates).length > 0) {
              await this.api.updateLink(change.linkwardenId, updates);
            }
            return;
          }
        }

        if (change.data?.url) {
          // It's a new link (no linkwardenId yet)
          // Check if URL already exists in target collection (prevent duplicates)
          const existingLinks = await this.api.getCollectionLinks(
            metadata.targetCollectionId
          );
          const existingLink = existingLinks.find(
            (l) => l.url === change.data!.url
          );

          if (existingLink) {
            // Link exists on server - create mapping instead of duplicate
            const mapping: Mapping = {
              id: crypto.randomUUID(),
              linkwardenType: "link",
              linkwardenId: existingLink.id,
              browserId: change.browserId!,
              linkwardenUpdatedAt: new Date(existingLink.updatedAt).getTime(),
              browserUpdatedAt: change.timestamp,
              lastSyncedAt: Date.now(),
              checksum: computeChecksum(existingLink),
            };
            await storage.upsertMapping(mapping);
            return;
          }

          // Create new in target collection
          try {
            const link = await this.api.createLink(
              change.data.url,
              metadata.targetCollectionId,
              change.data.title
            );

            // CRITICAL: Create mapping immediately with correct IDs
            const mapping: Mapping = {
              id: crypto.randomUUID(),
              linkwardenType: "link",
              linkwardenId: link.id,
              browserId: change.browserId!,
              linkwardenUpdatedAt: new Date(link.updatedAt).getTime(),
              browserUpdatedAt: change.timestamp,
              lastSyncedAt: Date.now(),
              checksum: computeChecksum(link),
            };
            await storage.upsertMapping(mapping);
          } catch (error) {
            // Handle 409 Conflict - link already exists
            if (error instanceof Error && error.message.includes("409")) {
              // Try to find the existing link and create mapping
              const links = await this.api.getCollectionLinks(
                metadata.targetCollectionId
              );
              const existingLink = links.find(
                (l) => l.url === change.data!.url
              );
              if (existingLink) {
                const mapping: Mapping = {
                  id: crypto.randomUUID(),
                  linkwardenType: "link",
                  linkwardenId: existingLink.id,
                  browserId: change.browserId!,
                  linkwardenUpdatedAt: new Date(
                    existingLink.updatedAt
                  ).getTime(),
                  browserUpdatedAt: change.timestamp,
                  lastSyncedAt: Date.now(),
                  checksum: computeChecksum(existingLink),
                };
                await storage.upsertMapping(mapping);
              }
              return; // Don't throw error - this is expected behavior
            }
            throw error; // Re-throw other errors
          }
        } else if (change.linkwardenId) {
          // It's a folder (no URL) and we have a Linkwarden ID - update collection name
          const mapping = await storage.getMappingByLinkwardenId(
            change.linkwardenId,
            "collection"
          );

          if (mapping && change.data?.title) {
            await this.api.updateCollection(change.linkwardenId, {
              name: change.data.title,
            });
            mapping.browserUpdatedAt = Date.now();
            mapping.lastSyncedAt = Date.now();
            await storage.upsertMapping(mapping);
          }
        }
        break;
      }

      case "delete": {
        if (change.linkwardenId) {
          await this.api.deleteLink(change.linkwardenId);
        }
        await storage.removeMapping(change.linkwardenId!, "link");
        break;
      }

      case "move": {
        // Handle move operations (bookmark moved to different folder)
        if (!change.linkwardenId || !change.parentId) {
          logger.warn("Move operation missing required info:", {
            linkwardenId: change.linkwardenId,
            parentId: change.parentId,
          });
          return;
        }

        const metadata = await storage.getSyncMetadata();
        if (!metadata) {
          logger.warn("No sync metadata, skipping move");
          return;
        }

        // Find mapping for the new parent folder
        const parentMapping = await storage.getMappingByBrowserId(
          change.parentId as string
        );

        if (!parentMapping || parentMapping.linkwardenType !== "collection") {
          // Parent is not a synced collection, skip
          logger.warn("Move target is not a synced collection, skipping:", {
            parentId: change.parentId,
            parentMappingType: parentMapping?.linkwardenType,
          });
          return;
        }

        // Get the mapping for the moved item
        const itemMapping = await storage.getMappingByLinkwardenId(
          change.linkwardenId,
          "link"
        );

        if (!itemMapping) {
          // Item not found in mappings, might be a folder
          const folderMapping = await storage.getMappingByLinkwardenId(
            change.linkwardenId,
            "collection"
          );

          if (folderMapping) {
            // Folder move - validate to prevent circular moves
            // Check if trying to move folder into itself or its descendants
            const isCircular = await isDescendantOf(
              change.parentId as string,
              folderMapping.browserId
            );

            if (isCircular) {
              logger.warn("Circular folder move detected, skipping:", {
                folderId: change.linkwardenId,
                targetParentId: change.parentId,
              });
              return;
            }

            // Folder move - append move token to description
            // This signals to the server that the folder should be moved
            logger.info("Folder move detected, appending move token:", {
              folderId: change.linkwardenId,
              folderName: change.data?.title,
              newParentId: change.parentId,
              newParentCollectionId: parentMapping.linkwardenId,
            });

            try {
              // Get current collection to preserve description
              const currentCollection = await this.api.getCollection(
                change.linkwardenId
              );
              const newDescription = appendMoveToken(
                currentCollection.description,
                parentMapping.linkwardenId
              );

              // Update collection with move token in description
              await this.api.updateCollection(change.linkwardenId, {
                description: newDescription,
              });

              logger.info(
                "Move token appended to collection:",
                change.linkwardenId
              );
            } catch (error) {
              logger.error("Failed to append move token:", error);
              // Fall back to just updating mapping if token append fails
            }

            // Update mapping to track new browser parent
            folderMapping.browserUpdatedAt = Date.now();
            await storage.upsertMapping(folderMapping);
          }
          return;
        }

        // Link move - update collection on Linkwarden
        try {
          const oldParentId = itemMapping.browserId;
          const newItemName = change.data?.title || "Unknown";

          logger.info("Moving link:", {
            linkId: change.linkwardenId,
            linkName: newItemName,
            fromParentId: oldParentId,
            toParentId: change.parentId,
            toCollectionId: parentMapping.linkwardenId,
          });

          await this.api.updateLink(change.linkwardenId, {
            collectionId: parentMapping.linkwardenId,
          });

          // Update mapping timestamp
          itemMapping.browserUpdatedAt = Date.now();
          itemMapping.lastSyncedAt = Date.now();
          await storage.upsertMapping(itemMapping);

          logger.info("Link move completed:", newItemName);
        } catch (error) {
          logger.error("Failed to move link:", error);
          throw error;
        }
        break;
      }
    }
  }

  /**
   * Sync from Linkwarden to browser
   */
  private async syncFromLinkwarden(
    metadata: SyncMetadata,
    errors: string[],
    stats: {
      created: number;
      updated: number;
      deleted: number;
      skipped: number;
    }
  ): Promise<void> {
    try {
      // Fetch collection tree from Linkwarden
      const collection = await this.api.getCollectionTree(
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
      let rootFolder = await bookmarks.get(metadata.browserRootFolderId);

      logger.info("Browser root folder:", {
        id: metadata.browserRootFolderId,
        exists: !!rootFolder,
        title: rootFolder?.title,
      });

      if (!rootFolder) {
        // Root folder doesn't exist - this shouldn't happen if browserRootFolderId is valid
        // Create it under Other Bookmarks as a fallback
        const otherBookmarks = await bookmarks.getOtherBookmarksFolder();
        rootFolder = await bookmarks.create({
          parentId: otherBookmarks?.id,
          title: "LWSync Root",
        });
        metadata.browserRootFolderId = rootFolder.id;
        await storage.saveSyncMetadata(metadata);
      }

      // Build caches for path-based matching (handles duplicate names)
      const collectionsCache = await buildCollectionsCache(
        this.api,
        metadata.targetCollectionId
      );
      const bookmarksCache = await buildBookmarksCache(rootFolder.id);

      // Sync collection structure and links with caches
      await this.syncCollectionWithCache(
        collection,
        rootFolder.id,
        collectionsCache,
        bookmarksCache,
        errors,
        stats
      );
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error("Sync from Linkwarden failed:", errorMsg);
      errors.push(`Sync from Linkwarden failed: ${errorMsg}`);
    }
  }

  /**
   * Recursively sync a collection and its contents
   */
  private async syncCollection(
    collection: LinkwardenCollection,
    parentBrowserId: string,
    errors: string[],
    stats: {
      created: number;
      updated: number;
      deleted: number;
      skipped: number;
    }
  ): Promise<void> {
    // Sync links in this collection
    if (collection.links && collection.links.length > 0) {
      for (const link of collection.links) {
        await this.syncLink(link, parentBrowserId, errors, stats);
      }
    }

    // Sync subcollections
    if (collection.collections && collection.collections.length > 0) {
      for (const subCollection of collection.collections) {
        await this.syncSubCollection(
          subCollection,
          parentBrowserId,
          errors,
          stats
        );
      }
    }
  }

  /**
   * Recursively sync a collection with caches for path-based matching
   */
  private async syncCollectionWithCache(
    collection: LinkwardenCollection,
    parentBrowserId: string,
    collectionsCache: Map<number, LinkwardenCollection>,
    bookmarksCache: Map<string, BookmarkNode>,
    errors: string[],
    stats: {
      created: number;
      updated: number;
      deleted: number;
      skipped: number;
    }
  ): Promise<void> {
    // Sync links in this collection
    if (collection.links && collection.links.length > 0) {
      for (const link of collection.links) {
        await this.syncLink(link, parentBrowserId, errors, stats);
      }
    }

    // Sync subcollections with path-based matching
    if (collection.collections && collection.collections.length > 0) {
      for (const subCollection of collection.collections) {
        await this.syncSubCollectionWithPathMatching(
          subCollection,
          parentBrowserId,
          collectionsCache,
          bookmarksCache,
          errors,
          stats
        );
      }
    }
  }

  /**
   * Sync a single link
   */
  private async syncLink(
    link: LinkwardenLink,
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
      const existing = await storage.getMappingByLinkwardenId(link.id, "link");

      if (existing) {
        // Check for updates (url, name changes)
        const result = resolveConflict(existing, link);

        if (result === "use-remote") {
          // Check if link was moved to a different folder on server
          const currentNode = await bookmarks.get(existing.browserId);
          const wasMoved = currentNode?.parentId !== parentBrowserId;

          if (wasMoved) {
            // Move bookmark to correct folder
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
          const currentNode = await bookmarks.get(existing.browserId);
          const wasMoved = currentNode?.parentId !== parentBrowserId;

          if (wasMoved) {
            // Move bookmark to correct folder
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
      } else {
        // No mapping exists - check if bookmark already exists by URL
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
    } catch (error) {
      errors.push(
        `Failed to sync link ${link.id}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Sync a subcollection (folder)
   */
  private async syncSubCollection(
    collection: LinkwardenCollection,
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
      const existing = await storage.getMappingByLinkwardenId(
        collection.id,
        "collection"
      );

      let folderId: string;

      if (existing) {
        folderId = existing.browserId;

        // Check for updates
        if (collection.name) {
          const remoteUpdatedAt = new Date(collection.updatedAt).getTime();
          if (remoteUpdatedAt > existing.browserUpdatedAt) {
            await bookmarks.update(folderId, { title: collection.name });
            existing.browserUpdatedAt = Date.now();
            existing.lastSyncedAt = Date.now();
            await storage.upsertMapping(existing);
            stats.updated++;
          }
        }
      } else {
        // No mapping exists - check if folder already exists by name
        const children = await bookmarks.getChildren(parentBrowserId);
        const existingFolder = children.find(
          (child) => child.title === collection.name && !child.url
        );

        if (existingFolder) {
          // Folder exists but has no mapping - create mapping (don't duplicate)
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
          folderId = existingFolder.id;
        } else {
          // Create new folder
          const folder = await bookmarks.create({
            parentId: parentBrowserId,
            title: collection.name,
          });
          folderId = folder.id;

          const mapping: Mapping = {
            id: crypto.randomUUID(),
            linkwardenType: "collection",
            linkwardenId: collection.id,
            browserId: folder.id,
            linkwardenUpdatedAt: new Date(collection.updatedAt).getTime(),
            browserUpdatedAt: folder.dateAdded || Date.now(),
            lastSyncedAt: Date.now(),
            checksum: computeChecksum({ name: collection.name }),
          };
          await storage.upsertMapping(mapping);
          stats.created++;
        }
      }

      // Recursively sync contents
      await this.syncCollection(collection, folderId, errors, stats);
    } catch (error) {
      errors.push(
        `Failed to sync collection ${collection.id}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Sync a subcollection (folder) with path-based matching for duplicate names
   * Uses three-tier strategy:
   * 1. Mapping table (primary)
   * 2. Name matching under known parent (fallback)
   * 3. Path-based matching (recovery for duplicate names)
   */
  private async syncSubCollectionWithPathMatching(
    collection: LinkwardenCollection,
    parentBrowserId: string,
    collectionsCache: Map<number, LinkwardenCollection>,
    bookmarksCache: Map<string, BookmarkNode>,
    errors: string[],
    stats: {
      created: number;
      updated: number;
      deleted: number;
      skipped: number;
    }
  ): Promise<void> {
    try {
      const existing = await storage.getMappingByLinkwardenId(
        collection.id,
        "collection"
      );

      let folderId: string;

      if (existing) {
        // Strategy 1: Mapping table (primary)
        folderId = existing.browserId;

        // Check for move token in description (browser → server move signal)
        const moveToken = extractMoveToken(collection.description);

        // Track if we processed a move token (to avoid conflicting server-side move detection)
        let moveTokenProcessed = false;

        if (moveToken) {
          // Find the target parent folder mapping
          const targetParentMapping = await storage.getMappingByLinkwardenId(
            moveToken.to,
            "collection"
          );

          if (targetParentMapping) {
            logger.info("Move token detected, moving folder:", {
              folderId: collection.id,
              folderName: collection.name,
              fromParentId: existing.browserId,
              toParentId: targetParentMapping.browserId,
              toCollectionId: moveToken.to,
            });

            try {
              // Move browser folder to new parent
              await bookmarks.move(existing.browserId, {
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

              // Mark that we processed a move token
              moveTokenProcessed = true;
            } catch (error) {
              logger.error("Failed to process move token:", error);
              errors.push(
                `Failed to move folder ${collection.id}: ${error instanceof Error ? error.message : String(error)}`
              );
            }
          } else {
            logger.warn("Move token target not found:", moveToken.to);
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
            stats.updated++;
          }
        }

        // Check for server-side folder move (parentId changed without move token)
        // Skip this check if we just processed a move token (to avoid conflicts)
        if (collection.parentId !== undefined && !moveTokenProcessed) {
          // Get the current browser node to check its actual parent
          const currentNode = await bookmarks.get(existing.browserId);
          const actualBrowserParentId = currentNode?.parentId;

          const currentParentMapping = await storage.getMappingByLinkwardenId(
            collection.parentId,
            "collection"
          );

          // Check if browser folder parent doesn't match expected parent from server
          if (
            currentParentMapping &&
            actualBrowserParentId !== parentBrowserId
          ) {
            logger.info("Server folder move detected (parentId changed):", {
              folderId: collection.id,
              folderName: collection.name,
              fromParentId: actualBrowserParentId,
              toParentId: currentParentMapping.browserId,
              toCollectionId: collection.parentId,
            });

            try {
              // Move browser folder to match server
              await bookmarks.move(existing.browserId, {
                parentId: currentParentMapping.browserId,
              });

              existing.browserUpdatedAt = Date.now();
              existing.lastSyncedAt = Date.now();
              await storage.upsertMapping(existing);

              logger.info("Server folder move completed:", collection.name);
            } catch (error) {
              logger.error("Failed to process server folder move:", error);
              errors.push(
                `Failed to move folder ${collection.id} (server move): ${error instanceof Error ? error.message : String(error)}`
              );
            }
          }
        }
      } else {
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
          folderId = existingFolder.id;
        } else {
          // Strategy 3: Path-based matching for duplicate names
          const collectionPath = buildPath(collection.id, collectionsCache);
          const browserFolderId = await findFolderByPath(
            collectionPath,
            parentBrowserId
          );

          if (browserFolderId) {
            // Found folder by path - create mapping
            const mapping: Mapping = {
              id: crypto.randomUUID(),
              linkwardenType: "collection",
              linkwardenId: collection.id,
              browserId: browserFolderId,
              linkwardenUpdatedAt: new Date(collection.updatedAt).getTime(),
              browserUpdatedAt: Date.now(),
              lastSyncedAt: Date.now(),
              checksum: computeChecksum({ name: collection.name }),
            };
            await storage.upsertMapping(mapping);
            folderId = browserFolderId;
          } else {
            // No existing folder found - create new
            const folder = await bookmarks.create({
              parentId: parentBrowserId,
              title: collection.name,
            });
            folderId = folder.id;

            const mapping: Mapping = {
              id: crypto.randomUUID(),
              linkwardenType: "collection",
              linkwardenId: collection.id,
              browserId: folder.id,
              linkwardenUpdatedAt: new Date(collection.updatedAt).getTime(),
              browserUpdatedAt: folder.dateAdded || Date.now(),
              lastSyncedAt: Date.now(),
              checksum: computeChecksum({ name: collection.name }),
            };
            await storage.upsertMapping(mapping);
            stats.created++;
          }
        }
      }

      // Recursively sync contents with caches
      await this.syncCollectionWithCache(
        collection,
        folderId,
        collectionsCache,
        bookmarksCache,
        errors,
        stats
      );
    } catch (error) {
      errors.push(
        `Failed to sync collection ${collection.id}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
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
    try {
      // Find or create the target collection
      const collection = await this.findOrCreateCollection(collectionName);

      if (!collection) {
        return {
          success: false,
          error: `Failed to find or create collection: ${collectionName}`,
        };
      }

      // Get browser root folder
      const browserRootFolderId = bookmarks.getBrowserRootFolderId();
      logger.info("Getting browser root folder:", { browserRootFolderId });
      const rootFolder = await bookmarks.get(browserRootFolderId);

      logger.info("Got browser root folder:", {
        browserRootFolderId,
        exists: !!rootFolder,
        title: rootFolder?.title,
        id: rootFolder?.id,
      });

      if (!rootFolder) {
        throw new Error(
          `Failed to get browser root folder (ID: ${browserRootFolderId})`
        );
      }

      // Parse the browser folder name as a path and find/create nested folders
      // If browserFolderName is empty, use the root folder directly
      let targetFolderId = browserRootFolderId;
      if (browserFolderName && browserFolderName.trim()) {
        const pathParts = parsePath(browserFolderName);
        targetFolderId = await findOrCreateNestedFolder(
          pathParts,
          browserRootFolderId
        );
      }

      // Save metadata
      const metadata: SyncMetadata = {
        id: "sync_state",
        lastSyncTime: 0,
        syncDirection,
        targetCollectionId: collection.id,
        browserRootFolderId: targetFolderId,
      };
      await storage.saveSyncMetadata(metadata);

      // Perform initial sync with metadata directly (avoid storage race condition)
      const errors: string[] = [];
      const stats = { created: 0, updated: 0, deleted: 0, skipped: 0 };
      await this.syncWithMetadata(metadata, errors, stats);

      return { success: true, collectionId: collection.id };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Find existing collection or create if it doesn't exist
   * Supports nested paths like "Parent Collection/Subcollection"
   */
  private async findOrCreateCollection(
    name: string
  ): Promise<{ id: number; name: string } | null> {
    try {
      // Parse the name as a path to support nested collections
      const pathParts = parsePath(name);

      if (pathParts.length === 0) {
        return null;
      }

      // Get all collections to build a lookup map
      const collections = await this.api.getCollections();
      logger.info(
        "Found collections:",
        collections.map((c) => ({
          id: c.id,
          name: c.name,
          parentId: c.parentId,
        }))
      );

      const collectionMap = new Map<number, LinkwardenCollection>();
      const nameToCollection = new Map<string, LinkwardenCollection>();

      for (const c of collections) {
        collectionMap.set(c.id, c);
        // Use name as key (note: doesn't handle duplicate names at same level)
        nameToCollection.set(c.name, c);
      }

      let parentId: number | undefined;
      let targetCollection: LinkwardenCollection | undefined;

      // Traverse/create each level of the path
      for (let i = 0; i < pathParts.length; i++) {
        const partName = pathParts[i];
        targetCollection = undefined; // Reset for each level

        // Find collection with this name under current parent
        // For root level (parentId === undefined), match collections with parentId === null
        const matches = Array.from(collectionMap.values()).filter((c) => {
          if (c.name !== partName) return false;
          if (parentId === undefined) {
            // Root level: match collections with no parent (null or undefined)
            return c.parentId === null || c.parentId === undefined;
          }
          // Nested level: match specific parentId
          return c.parentId === parentId;
        });

        if (matches.length > 0) {
          // Prefer collection with most links (likely the original)
          targetCollection = matches.reduce((max, c) =>
            (c.links?.length || 0) > (max.links?.length || 0) ? c : max
          );
          logger.info(
            `Found ${matches.length} matches for "${partName}", using ID ${targetCollection.id} with ${targetCollection.links?.length || 0} links`
          );
        } else {
          logger.info(
            `Looking for "${partName}" under parentId ${parentId}: not found`
          );
        }

        // Create if doesn't exist
        if (!targetCollection) {
          logger.info(
            `Creating collection: "${partName}"${parentId ? ` under parent ${parentId}` : ""}`
          );
          const created = await this.api.createCollection(
            partName,
            parentId,
            i === 0
              ? `Synced from browser - ${new Date().toLocaleDateString()}`
              : undefined
          );
          collectionMap.set(created.id, created);
          targetCollection = created;
        }

        // Move to next level
        parentId = targetCollection!.id;
      }

      if (!targetCollection) {
        return null;
      }

      return { id: targetCollection.id, name: targetCollection.name };
    } catch (error) {
      logger.error("Failed to find/create collection:", error);
      return null;
    }
  }

  /**
   * Reset sync state (clear all mappings and metadata)
   */
  async reset(): Promise<void> {
    await storage.clearAll();
  }

  /**
   * Recover mappings using path-based matching
   * Useful when mappings are lost or corrupted
   * Attempts to rebuild mappings by matching collection paths to browser folder paths
   */
  async recoverMappings(): Promise<{
    recovered: number;
    errors: string[];
  }> {
    const errors: string[] = [];
    let recovered = 0;

    try {
      const metadata = await storage.getSyncMetadata();
      if (!metadata) {
        throw new Error("Sync not configured. Please set up in popup UI.");
      }

      // Build caches
      const collectionsCache = await buildCollectionsCache(
        this.api,
        metadata.targetCollectionId
      );

      // Get existing mappings to avoid duplicates
      const existingMappings = await storage.getMappings();
      const existingLinkwardenIds = new Set(
        existingMappings.map((m) => `${m.linkwardenType}:${m.linkwardenId}`)
      );

      // Recover collection mappings
      for (const [id, collection] of collectionsCache.entries()) {
        const key = `collection:${id}`;
        if (existingLinkwardenIds.has(key)) {
          continue; // Already mapped
        }

        const collectionPath = buildPath(id, collectionsCache);
        const browserFolderId = await findFolderByPath(
          collectionPath,
          metadata.browserRootFolderId
        );

        if (browserFolderId) {
          const mapping: Mapping = {
            id: crypto.randomUUID(),
            linkwardenType: "collection",
            linkwardenId: id,
            browserId: browserFolderId,
            linkwardenUpdatedAt: new Date(collection.updatedAt).getTime(),
            browserUpdatedAt: Date.now(),
            lastSyncedAt: Date.now(),
            checksum: computeChecksum({ name: collection.name }),
          };
          await storage.upsertMapping(mapping);
          recovered++;
        } else {
          errors.push(`Collection not found in browser: ${collectionPath}`);
        }
      }

      // Recover link mappings
      for (const [id, collection] of collectionsCache.entries()) {
        if (!collection.links) continue;

        for (const link of collection.links) {
          const key = `link:${link.id}`;
          if (existingLinkwardenIds.has(key)) {
            continue; // Already mapped
          }

          // Get parent folder mapping
          const parentMapping = existingMappings.find(
            (m) => m.linkwardenType === "collection" && m.linkwardenId === id
          );

          if (!parentMapping) {
            errors.push(`Parent collection not mapped for link: ${link.name}`);
            continue;
          }

          // Search for link under parent folder
          const children = await bookmarks.getChildren(parentMapping.browserId);
          const matchingBookmark = children.find(
            (child) => child.url === link.url && child.title === link.name
          );

          if (matchingBookmark) {
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
            recovered++;
          } else {
            errors.push(
              `Link not found in browser: ${link.name} (${link.url})`
            );
          }
        }
      }
    } catch (error) {
      errors.push(
        `Recovery failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }

    return { recovered, errors };
  }
}
