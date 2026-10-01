/**
 * Collection Link Sync
 * Link (bookmark) sync and order restoration for collections,
 * extracted from collections.ts to keep each file focused.
 */

import * as storage from "../storage";
import * as bookmarks from "../bookmarks";
import type { LinkwardenAPI } from "../api";
import type { LinkwardenLink } from "../types/api";
import type { Mapping } from "../types/storage";
import type { SyncStats } from "./engine";
import { SyncErrorReporter, createErrorContext } from "./errorReporter";
import { computeChecksum, createLogger } from "../utils";
import { generateOrderHash, getTokenInfo } from "./item-order-token";
import type { MappingMap } from "./collections";

const logger = createLogger("LWSync collection-links");

export class CollectionLinkSync {
  private api: LinkwardenAPI;
  private errors: SyncErrorReporter;
  private cache: MappingMap;

  constructor(
    api: LinkwardenAPI,
    errorReporter: SyncErrorReporter,
    cache: MappingMap
  ) {
    this.api = api;
    this.errors = errorReporter;
    this.cache = cache;
  }

  /**
   * Sync a single link from Linkwarden to browser (no order restore - that's separate)
   */
  async syncLinkInline(
    link: LinkwardenLink,
    parentBrowserId: string,
    stats: SyncStats
  ): Promise<void> {
    try {
      const existing = this.cache.getMappingByLinkwardenId(link.id, "link");

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
        }
        // Update cached name/hash for order token
        existing.cachedName = link.name;
        existing.cachedNameHash = generateOrderHash(link.name);

        // CRITICAL: Always capture current browser index (source of truth)
        const currentNode = await bookmarks.get(existing.browserId);
        if (currentNode && currentNode.index !== undefined) {
          existing.browserIndex = currentNode.index;
        } else if (link.description && existing.browserIndex === undefined) {
          // FALLBACK: Browser index unavailable - use server token
          // This handles edge cases like corrupted mappings or import scenarios
          const tokenInfo = getTokenInfo(link.description, link.name);
          if (tokenInfo?.hasToken && tokenInfo.index !== undefined) {
            existing.browserIndex = tokenInfo.index;
            logger.debug(
              "Using server order token as fallback (browser index unavailable):",
              {
                linkId: link.id,
                index: tokenInfo.index,
              }
            );
          }
        }

        await storage.upsertMapping(existing);
        stats.increment("updated");
      } else {
        // Check if bookmark already exists
        const existingBookmarks = await bookmarks.search(link.url);
        const matchingBookmark = existingBookmarks.find(
          (b) => b.parentId === parentBrowserId && b.title === link.name
        );

        if (matchingBookmark) {
          // Create mapping for existing bookmark
          // Browser index is source of truth - capture it
          // BUT: If server has order token, use it as initial order (fresh sync scenario)
          let browserIndex = matchingBookmark.index;

          if (link.description) {
            const tokenInfo = getTokenInfo(link.description, link.name);
            if (tokenInfo?.hasToken && tokenInfo.index !== undefined) {
              // Server has order token - use it for initial ordering
              // This ensures consistent order across devices when bookmark exists locally
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

          // Browser index is source of truth - capture it
          // BUT: If server has order token, use it as initial order (fresh sync scenario)
          let browserIndex = node.index;

          if (link.description) {
            const tokenInfo = getTokenInfo(link.description, link.name);
            if (tokenInfo?.hasToken && tokenInfo.index !== undefined) {
              // Server has order token - use it for initial ordering
              // This ensures consistent order across devices on first sync
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
   * Restore bookmark/folder order based on browserIndex mappings
   * Called after all items are synced to reorder efficiently
   * Also detects and captures user reorders (when browser is newer than last sync)
   * @param lastSyncTime - The time of the previous sync (from metadata), used to detect user reorders
   */
  async restoreOrder(
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
  async pushOrderTokensToServer(
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
}
