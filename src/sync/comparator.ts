/**
 * Sync Comparator
 * Compares browser bookmarks with server links to determine sync actions
 *
 * Provides detailed diff report showing:
 * - What needs to be uploaded (browser → server)
 * - What needs to be downloaded (server → browser)
 * - What's already synced
 * - What conflicts exist
 */

import * as storage from "../storage";
import { getTree } from "../bookmarks";
import type { LinkwardenAPI, LinkwardenLink } from "../api";
import type { SyncMetadata, Mapping } from "../types/storage";
import type { BookmarkNode } from "../types/bookmarks";
import type {
  SyncComparison,
  SyncedPair,
  BookmarkToUpload,
  LinkToDownload,
  Conflict,
  ComparisonOptions,
  ComparisonSummary,
  SyncRecommendationResult,
  SyncRecommendation,
} from "../types/comparator";
import { SyncErrorReporter, createErrorContext } from "./errorReporter";
import { computeChecksum, generateId, now } from "../utils";
import { createLogger } from "../utils";
import { buildPath } from "./mappings";

const logger = createLogger("LWSync comparator");

interface BookmarkWithMetadata extends BookmarkNode {
  checksum: string;
  path: string;
}

interface LinkWithMetadata {
  id: number;
  name: string;
  url: string;
  collectionId: number;
  parentId?: number;
  checksum: string;
  path: string;
  createdAt: string;
  updatedAt: string;
}

export class SyncComparator {
  private api: LinkwardenAPI;
  private errors: SyncErrorReporter;

  constructor(api: LinkwardenAPI, errorReporter?: SyncErrorReporter) {
    this.api = api;
    this.errors = errorReporter || new SyncErrorReporter();
  }

  /**
   * Compare browser bookmarks with server links
   * Returns detailed report of what needs to sync
   */
  async compare(options: ComparisonOptions = {}): Promise<SyncComparison> {
    const {
      includeDebug = false,
      compareChecksums = true,
      detectConflicts = true,
    } = options;

    const startTime = Date.now();

    try {
      // Get sync metadata
      const metadata = await storage.getSyncMetadata();
      if (!metadata) {
        logger.warn("No sync metadata, returning empty comparison");
        return this.createEmptyComparison();
      }

      // Fetch browser bookmarks
      const browserBookmarks = await this.fetchBrowserBookmarks(
        metadata.browserRootFolderId
      );

      // Fetch server links
      const serverLinks = await this.fetchServerLinks(
        metadata.targetCollectionId
      );

      // Get all mappings
      const allMappings = await storage.getMappings();
      const linkMappings = allMappings.filter(
        (m) => m.linkwardenType === "link"
      );

      logger.info("Fetched data for comparison:", {
        browserCount: browserBookmarks.length,
        serverCount: serverLinks.length,
        mappingsCount: linkMappings.length,
      });

      // Compare and categorize
      const toUpload: BookmarkToUpload[] = [];
      const toDownload: LinkToDownload[] = [];
      const synced: SyncedPair[] = [];
      const conflicts: Conflict[] = [];

      // Create lookup maps
      const mappingsByBrowser = new Map<string, Mapping>();
      const mappingsByLinkwarden = new Map<number, Mapping>();
      for (const mapping of linkMappings) {
        mappingsByBrowser.set(mapping.browserId, mapping);
        mappingsByLinkwarden.set(mapping.linkwardenId, mapping);
      }

      const bookmarksByUrl = new Map<string, BookmarkWithMetadata>();
      for (const bm of browserBookmarks) {
        if (bm.url) {
          bookmarksByUrl.set(bm.url, bm);
        }
      }

      const linksByUrl = new Map<string, LinkWithMetadata>();
      for (const link of serverLinks) {
        linksByUrl.set(link.url, link);
      }

      // Process browser bookmarks (only those with URLs)
      for (const bookmark of browserBookmarks) {
        if (!bookmark.url) continue; // Skip folders

        const mapping = mappingsByBrowser.get(bookmark.id);
        const serverLink = linksByUrl.get(bookmark.url);

        if (mapping && serverLink) {
          // Has mapping and exists on server - check for conflicts
          if (detectConflicts) {
            const conflict = this.checkForConflict(
              bookmark,
              serverLink,
              mapping
            );
            if (conflict) {
              conflicts.push(conflict);
              continue;
            }
          }

          // Check if checksums match
          const checksumMatch = compareChecksums
            ? bookmark.checksum === serverLink.checksum
            : true;

          synced.push({
            browserId: bookmark.id,
            browserPath: bookmark.path,
            linkwardenId: mapping.linkwardenId,
            linkwardenPath: serverLink.path,
            title: bookmark.title || "",
            url: bookmark.url,
            lastSyncedAt: mapping.lastSyncedAt,
            checksumMatch,
            browserChecksum: bookmark.checksum,
            serverChecksum: serverLink.checksum,
          });
        } else if (serverLink && !mapping) {
          // Exists on server but no mapping - needs mapping (not download)
          // This is actually a "synced" item that lost its mapping
          synced.push({
            browserId: bookmark.id,
            browserPath: bookmark.path,
            linkwardenId: serverLink.id,
            linkwardenPath: serverLink.path,
            title: bookmark.title || "",
            url: bookmark.url,
            lastSyncedAt: 0,
            checksumMatch: bookmark.checksum === serverLink.checksum,
            browserChecksum: bookmark.checksum,
            serverChecksum: serverLink.checksum,
          });
        } else if (!serverLink && !mapping) {
          // No mapping and not on server - needs upload
          toUpload.push({
            browserId: bookmark.id,
            browserPath: bookmark.path,
            browserParentId: bookmark.parentId || "",
            title: bookmark.title || "",
            url: bookmark.url,
            reason: "unmapped",
            checksum: bookmark.checksum,
            dateAdded: bookmark.dateAdded,
            dateModified: bookmark.dateGroupModified,
          });
        } else if (!serverLink && mapping) {
          // Has mapping but not on server - might be deleted or wrong mapping
          // Check if it's a modification
          toUpload.push({
            browserId: bookmark.id,
            browserPath: bookmark.path,
            browserParentId: bookmark.parentId || "",
            title: bookmark.title || "",
            url: bookmark.url,
            reason: "modified",
            checksum: bookmark.checksum,
            dateAdded: bookmark.dateAdded,
            dateModified: bookmark.dateGroupModified,
          });
        }
      }

      // Process server links (find downloads)
      for (const link of serverLinks) {
        const mapping = mappingsByLinkwarden.get(link.id);
        const browserBookmark = bookmarksByUrl.get(link.url);

        if (!mapping && !browserBookmark) {
          // No mapping and not in browser - needs download
          toDownload.push({
            linkwardenId: link.id,
            linkwardenPath: link.path,
            linkwardenParentId: link.parentId,
            title: link.name,
            url: link.url,
            reason: "unmapped",
            checksum: link.checksum,
            createdAt: link.createdAt,
            updatedAt: link.updatedAt,
          });
        } else if (!mapping && browserBookmark) {
          // In browser but no mapping - will be handled above as synced
          // (already added to synced list)
        }
      }

      // Build summary
      const summary: ComparisonSummary = {
        browserTotal: browserBookmarks.length,
        serverTotal: serverLinks.length,
        toUploadCount: toUpload.length,
        toDownloadCount: toDownload.length,
        syncedCount: synced.length,
        conflictCount: conflicts.length,
        skippedCount: 0,
        estimatedSyncTime: this.estimateSyncTime(
          toUpload.length,
          toDownload.length
        ),
      };

      // Get collection name
      let serverCollectionName: string | undefined;
      try {
        const collection = await this.api.getCollection(
          metadata.targetCollectionId
        );
        serverCollectionName = collection.name;
      } catch (error) {
        logger.warn("Failed to get collection name:", error as Error);
      }

      // Build result
      const result: SyncComparison = {
        timestamp: startTime,
        browserRootId: metadata.browserRootFolderId,
        serverCollectionId: metadata.targetCollectionId,
        serverCollectionName,
        toUpload,
        toDownload,
        synced,
        conflicts,
        summary,
      };

      // Add debug data if requested
      if (includeDebug) {
        result.debug = {
          allBrowserBookmarks: browserBookmarks
            .filter((b) => b.url) // Only include bookmarks with URLs
            .map((b) => ({
              id: b.id,
              url: b.url!,
              title: b.title || "",
            })),
          allServerLinks: serverLinks.map((l) => ({
            id: l.id,
            url: l.url,
            name: l.name,
          })),
          allMappings: linkMappings.map((m) => ({
            browserId: m.browserId,
            linkwardenId: m.linkwardenId,
            checksum: m.checksum,
          })),
        };
      }

      logger.info("Comparison complete:", {
        upload: toUpload.length,
        download: toDownload.length,
        synced: synced.length,
        conflicts: conflicts.length,
        duration: Date.now() - startTime,
      });

      return result;
    } catch (error) {
      this.errors.collect(error as Error, createErrorContext("compare"));
      throw error;
    }
  }

  /**
   * Fetch all bookmarks from browser root folder
   */
  private async fetchBrowserBookmarks(
    rootFolderId: string
  ): Promise<BookmarkWithMetadata[]> {
    const bookmarks: BookmarkWithMetadata[] = [];

    const tree = await getTree();
    if (!tree || tree.length === 0) {
      return bookmarks;
    }

    // Find root folder and traverse
    const rootFolder = this.findNodeById(tree[0], rootFolderId);
    if (!rootFolder) {
      logger.warn("Root folder not found:", rootFolderId);
      return bookmarks;
    }

    // Traverse and collect bookmarks (not folders)
    this.traverseBookmarks(rootFolder, bookmarks, rootFolderId);

    return bookmarks;
  }

  /**
   * Traverse bookmark tree and collect bookmarks
   */
  private traverseBookmarks(
    node: chrome.bookmarks.BookmarkTreeNode | BookmarkNode,
    bookmarks: BookmarkWithMetadata[],
    rootFolderId: string,
    pathParts: string[] = []
  ): void {
    // Skip root folder itself
    if (node.id === rootFolderId) {
      if (node.children) {
        for (const child of node.children) {
          this.traverseBookmarks(child, bookmarks, rootFolderId, pathParts);
        }
      }
      return;
    }

    const currentPath = [...pathParts, node.title || ""];
    const path = "/" + currentPath.join("/");

    // If it's a bookmark (has URL), add it
    if (node.url) {
      bookmarks.push({
        id: node.id,
        parentId: node.parentId,
        title: node.title || "",
        url: node.url,
        dateAdded: node.dateAdded,
        dateGroupModified: node.dateGroupModified,
        checksum: computeChecksum({
          name: node.title || "",
          url: node.url,
        }),
        path,
      });
    }

    // Traverse children
    if (node.children) {
      for (const child of node.children) {
        this.traverseBookmarks(child, bookmarks, rootFolderId, currentPath);
      }
    }
  }

  /**
   * Fetch all links from server collection
   * Uses optimized getLinksByCollection() endpoint instead of getCollectionTree()
   */
  private async fetchServerLinks(
    collectionId: number
  ): Promise<LinkWithMetadata[]> {
    try {
      const links: LinkWithMetadata[] = [];

      // Fetch links using optimized search endpoint
      const collectionLinks = await this.api.getLinksByCollection(collectionId);
      logger.debug(
        "Fetched links for collection:",
        collectionId,
        "count:",
        collectionLinks.length
      );

      // Get collection metadata for path building
      const collection = await this.api.getCollection(collectionId);

      // Process main collection links (async to handle subcollections)
      await this.collectLinksFromCollection(
        {
          id: collection.id,
          name: collection.name,
          parentId: collection.parentId,
          links: collectionLinks,
          collections: collection.collections || [],
        },
        links
      );

      logger.info("Fetched server links:", links.length);
      return links;
    } catch (error) {
      logger.error("Failed to fetch server links:", error as Error);
      return [];
    }
  }

  /**
   * Recursively collect links from collection tree
   * Fetches links for each collection using optimized endpoint
   */
  private async collectLinksFromCollection(
    collection: {
      id: number;
      name: string;
      parentId?: number;
      links?: Array<{
        id: number;
        name: string;
        url: string;
        createdAt: string;
        updatedAt: string;
      }>;
      collections?: unknown[];
    },
    links: LinkWithMetadata[],
    pathParts: string[] = []
  ): Promise<void> {
    const currentPath = [...pathParts, collection.name];
    const path = "/" + currentPath.join("/");

    // Add links from this collection
    if (collection.links) {
      for (const link of collection.links) {
        links.push({
          id: link.id,
          name: link.name,
          url: link.url,
          collectionId: collection.id,
          parentId: collection.parentId,
          checksum: computeChecksum({
            name: link.name,
            url: link.url,
          }),
          path,
          createdAt: link.createdAt,
          updatedAt: link.updatedAt,
        });
      }
    }

    // Process subcollections recursively
    if (collection.collections && Array.isArray(collection.collections)) {
      for (const sub of collection.collections) {
        if (typeof sub === "object" && sub !== null && "id" in sub) {
          const subCollection = sub as typeof collection;

          // Fetch links for subcollection using optimized endpoint
          try {
            const subLinks = await this.api.getLinksByCollection(
              subCollection.id
            );
            subCollection.links = subLinks;
          } catch (error) {
            logger.warn(
              `Failed to fetch links for subcollection ${subCollection.id}:`,
              error as Error
            );
            subCollection.links = [];
          }

          await this.collectLinksFromCollection(
            subCollection,
            links,
            currentPath
          );
        }
      }
    }
  }

  /**
   * Check if there's a conflict between browser and server versions
   */
  private checkForConflict(
    bookmark: BookmarkWithMetadata,
    link: LinkWithMetadata,
    mapping: Mapping
  ): Conflict | null {
    // Skip if bookmark has no URL (shouldn't happen, but be safe)
    if (!bookmark.url) {
      return null;
    }

    // No conflict if checksums match
    if (bookmark.checksum === link.checksum) {
      return null;
    }

    const browserTime = bookmark.dateGroupModified || bookmark.dateAdded || 0;
    const serverTime = new Date(link.updatedAt).getTime();

    // Determine winner using LWW (Last Write Wins)
    let winner: "browser" | "server" = "browser";
    let reason = "";

    if (serverTime > browserTime) {
      winner = "server";
      reason = "Server modified more recently";
    } else if (browserTime > serverTime) {
      winner = "browser";
      reason = "Browser modified more recently";
    } else {
      // Tie - browser wins
      winner = "browser";
      reason = "Timestamp tie, browser wins by default";
    }

    return {
      browserId: bookmark.id,
      linkwardenId: link.id,
      url: bookmark.url,
      browserTitle: bookmark.title || "",
      serverTitle: link.name,
      browserModifiedAt: browserTime,
      serverModifiedAt: serverTime,
      browserChecksum: bookmark.checksum,
      serverChecksum: link.checksum,
      winner,
      reason,
    };
  }

  /**
   * Estimate sync time based on item counts
   */
  private estimateSyncTime(uploadCount: number, downloadCount: number): number {
    // Rough estimates:
    // - Upload: ~500ms per item (API call + archival)
    // - Download: ~200ms per item (API call + bookmark creation)
    const uploadTime = uploadCount * 500;
    const downloadTime = downloadCount * 200;
    return uploadTime + downloadTime;
  }

  /**
   * Create empty comparison result
   */
  private createEmptyComparison(): SyncComparison {
    return {
      timestamp: Date.now(),
      browserRootId: "",
      serverCollectionId: 0,
      toUpload: [],
      toDownload: [],
      synced: [],
      conflicts: [],
      summary: {
        browserTotal: 0,
        serverTotal: 0,
        toUploadCount: 0,
        toDownloadCount: 0,
        syncedCount: 0,
        conflictCount: 0,
        skippedCount: 0,
      },
    };
  }

  /**
   * Find node by ID in tree
   */
  private findNodeById(
    node: chrome.bookmarks.BookmarkTreeNode | BookmarkNode,
    targetId: string
  ): chrome.bookmarks.BookmarkTreeNode | BookmarkNode | null {
    if (node.id === targetId) {
      return node;
    }
    if (node.children) {
      for (const child of node.children) {
        const found = this.findNodeById(child, targetId);
        if (found) return found;
      }
    }
    return null;
  }

  /**
   * Generate sync recommendation based on comparison
   */
  generateRecommendation(comparison: SyncComparison): SyncRecommendationResult {
    const { toUpload, toDownload, conflicts, summary } = comparison;

    const actions: SyncRecommendationResult["actions"] = [];

    if (toUpload.length > 0) {
      actions.push({
        type: "upload",
        count: toUpload.length,
        description: `Upload ${toUpload.length} bookmark${toUpload.length > 1 ? "s" : ""} to server`,
      });
    }

    if (toDownload.length > 0) {
      actions.push({
        type: "download",
        count: toDownload.length,
        description: `Download ${toDownload.length} link${toDownload.length > 1 ? "s" : ""} from server`,
      });
    }

    if (conflicts.length > 0) {
      actions.push({
        type: "resolve_conflict",
        count: conflicts.length,
        description: `Resolve ${conflicts.length} conflict${conflicts.length > 1 ? "s" : ""}`,
      });
    }

    // Determine direction
    let direction: SyncRecommendation = "none";
    let confidence: "high" | "medium" | "low" = "low";
    let explanation = "Already in sync";

    if (actions.length === 0) {
      direction = "none";
      confidence = "high";
      explanation = "All items are synced, no action needed";
    } else if (toUpload.length > toDownload.length * 2) {
      direction = "upload";
      confidence = toUpload.length > 10 ? "high" : "medium";
      explanation = `Mostly browser changes (${toUpload.length} to upload vs ${toDownload.length} to download)`;
    } else if (toDownload.length > toUpload.length * 2) {
      direction = "download";
      confidence = toDownload.length > 10 ? "high" : "medium";
      explanation = `Mostly server changes (${toDownload.length} to download vs ${toUpload.length} to upload)`;
    } else if (actions.length > 0) {
      direction = "bidirectional";
      confidence = "medium";
      explanation = `Changes on both sides (${summary.toUploadCount} upload, ${summary.toDownloadCount} download, ${summary.conflictCount} conflicts)`;
    }

    return {
      direction,
      confidence,
      explanation,
      actions,
    };
  }

  /**
   * Scan browser bookmarks and queue unmapped ones for sync
   * This is the merged functionality from the old BookmarkScanner
   */
  async scanAndQueueUnmapped(): Promise<{
    scanned: number;
    queued: number;
    skipped: number;
  }> {
    const result = { scanned: 0, queued: 0, skipped: 0 };

    try {
      const metadata = await storage.getSyncMetadata();
      if (!metadata) {
        logger.warn("No sync metadata, skipping scan");
        return result;
      }

      const browserBookmarks = await this.fetchBrowserBookmarks(
        metadata.browserRootFolderId
      );
      const serverLinks = await this.fetchServerLinks(
        metadata.targetCollectionId
      );

      // Build lookup map for server links (use local interface)
      const linksByUrl = new Map<string, LinkWithMetadata>();
      for (const link of serverLinks) {
        linksByUrl.set(link.url, link);
      }

      // Scan each bookmark
      for (const bookmark of browserBookmarks) {
        if (!bookmark.url) continue;

        result.scanned++;

        // Check if already mapped
        const existingMapping = await storage.getMappingByBrowserId(
          bookmark.id
        );
        if (existingMapping) {
          result.skipped++;
          continue;
        }

        // Check if URL exists on server
        const existingLink = linksByUrl.get(bookmark.url);
        if (existingLink) {
          // Create mapping instead of duplicate
          logger.info("Bookmark exists on server, creating mapping:", {
            url: bookmark.url,
            linkId: existingLink.id,
          });
          const mapping: Mapping = {
            id: generateId(),
            linkwardenType: "link",
            linkwardenId: existingLink.id,
            browserId: bookmark.id,
            linkwardenUpdatedAt: new Date(existingLink.updatedAt).getTime(),
            browserUpdatedAt:
              bookmark.dateGroupModified || bookmark.dateAdded || now(),
            lastSyncedAt: now(),
            checksum: computeChecksum({
              name: bookmark.title || "",
              url: bookmark.url,
            }),
          };
          await storage.upsertMapping(mapping);
          result.skipped++;
          continue;
        }

        // Queue for upload
        logger.info("Queuing unmapped bookmark:", {
          url: bookmark.url,
          title: bookmark.title,
        });
        await storage.addPendingChange({
          id: generateId(),
          type: "create",
          source: "browser",
          browserId: bookmark.id,
          parentId: bookmark.parentId || "",
          data: {
            title: bookmark.title || "",
            url: bookmark.url,
          },
          timestamp: now(),
          resolved: false,
        });
        result.queued++;
      }

      logger.info("Scan complete:", result);
    } catch (error) {
      this.errors.collect(
        error as Error,
        createErrorContext("scanAndQueueUnmapped")
      );
      throw error;
    }

    return result;
  }
}
