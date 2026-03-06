/**
 * Orphan Cleanup
 * Handles detection and cleanup of orphaned mappings
 *
 * Orphans are mappings that exist locally but not on the server.
 * This happens when items are deleted from Linkwarden.
 */

import * as storage from "../storage";
import * as bookmarks from "../bookmarks";
import { SyncErrorReporter, createErrorContext } from "./errorReporter";
import type { Mapping } from "../types/storage";
import { createLogger } from "../utils";

const logger = createLogger("LWSync orphans");

export class OrphanCleanup {
  private errors: SyncErrorReporter;

  constructor(errorReporter?: SyncErrorReporter) {
    this.errors = errorReporter || new SyncErrorReporter();
  }

  /**
   * Cleanup orphaned mappings
   * Removes mappings and browser bookmarks for items deleted from Linkwarden
   * @param remoteLinkIds - Set of link IDs from server (empty Set means API failure, skip link cleanup)
   */
  async cleanupOrphanedMappings(
    remoteLinkIds: Set<number>,
    remoteCollectionIds: Set<number>,
    browserRootFolderId: string
  ): Promise<void> {
    try {
      // CRITICAL: Skip link orphan cleanup if remoteLinkIds is empty
      // An empty Set indicates API failure, not an empty collection
      // Cleaning up in this case would delete ALL bookmarks
      const orphanedLinks =
        remoteLinkIds.size > 0
          ? await this.findOrphanedMappings(remoteLinkIds, "link")
          : [];

      // Find orphaned collection mappings
      const orphanedCollections = await this.findOrphanedMappings(
        remoteCollectionIds,
        "collection"
      );

      // Delete orphaned browser bookmarks
      await this.deleteOrphanedBrowserBookmarks(
        [...orphanedLinks, ...orphanedCollections],
        browserRootFolderId
      );

      // Remove orphaned mappings from storage
      await this.removeOrphanedMappingsFromStorage([
        ...orphanedLinks,
        ...orphanedCollections,
      ]);

      if (orphanedLinks.length > 0 || orphanedCollections.length > 0) {
        logger.info(
          `Cleaned up ${orphanedLinks.length} orphaned links and ${orphanedCollections.length} orphaned collections`
        );
      }
    } catch (error) {
      this.errors.collect(
        error as Error,
        createErrorContext("cleanupOrphanedMappings")
      );
    }
  }

  /**
   * Find mappings that don't have corresponding remote items
   */
  private async findOrphanedMappings(
    remoteIds: Set<number>,
    type: "link" | "collection"
  ): Promise<Mapping[]> {
    const allMappings = await storage.getMappings();
    return allMappings.filter(
      (m) => m.linkwardenType === type && !remoteIds.has(m.linkwardenId)
    );
  }

  /**
   * Delete browser bookmarks for orphaned mappings
   */
  private async deleteOrphanedBrowserBookmarks(
    orphanedMappings: Mapping[],
    browserRootFolderId: string
  ): Promise<void> {
    for (const mapping of orphanedMappings) {
      try {
        // Verify the bookmark still exists before trying to delete
        const node = await bookmarks.get(mapping.browserId);
        if (node) {
          // Only delete if the bookmark is within the sync root folder
          const isInsideRoot = await this.isDescendantOf(
            mapping.browserId,
            browserRootFolderId
          );
          if (isInsideRoot || mapping.browserId === browserRootFolderId) {
            await bookmarks.remove(mapping.browserId);
            logger.info(
              `Deleted orphaned browser bookmark: ${mapping.browserId}`
            );
          } else {
            logger.info(
              `Skipping orphaned bookmark outside sync root: ${mapping.browserId}`
            );
          }
        }
      } catch (error) {
        this.errors.collect(
          error as Error,
          createErrorContext("deleteOrphanedBookmark", {
            itemId: mapping.browserId,
            itemName: mapping.linkwardenId.toString(),
          })
        );
      }
    }
  }

  /**
   * Check if a node is a descendant of another node
   */
  private async isDescendantOf(
    nodeId: string,
    potentialAncestorId: string
  ): Promise<boolean> {
    let current = await bookmarks.get(nodeId);
    while (current && current.parentId) {
      if (current.parentId === potentialAncestorId) {
        return true;
      }
      current = await bookmarks.get(current.parentId);
    }
    return false;
  }

  /**
   * Remove orphaned mappings from storage
   */
  private async removeOrphanedMappingsFromStorage(
    orphanedMappings: Mapping[]
  ): Promise<void> {
    for (const mapping of orphanedMappings) {
      try {
        await storage.removeMapping(
          mapping.linkwardenId,
          mapping.linkwardenType
        );
        logger.info(
          `Removed orphaned mapping: ${mapping.linkwardenType} ${mapping.linkwardenId}`
        );
      } catch (error) {
        this.errors.collect(
          error as Error,
          createErrorContext("removeOrphanedMapping", {
            itemId: mapping.linkwardenId,
            data: { type: mapping.linkwardenType },
          })
        );
      }
    }
  }

  /**
   * Get the error reporter for this instance
   */
  getErrorReporter(): SyncErrorReporter {
    return this.errors;
  }

  /**
   * Normalize browserIndex values after deletions
   * Ensures indices are sequential (0, 1, 2, ...) within each parent folder
   */
  async normalizeIndices(browserRootFolderId: string): Promise<void> {
    try {
      const allMappings = await storage.getMappings();

      // Group mappings by parent folder
      const byParent = new Map<string, Mapping[]>();

      for (const mapping of allMappings) {
        // Get the bookmark to find its parent
        const node = await bookmarks.get(mapping.browserId);
        if (!node) continue; // Bookmark was deleted or doesn't exist

        const parentId = node.parentId || "unknown";
        const group = byParent.get(parentId) || [];
        group.push(mapping);
        byParent.set(parentId, group);
      }

      // Normalize indices within each parent
      for (const [parentId, group] of byParent.entries()) {
        if (group.length === 0) continue;

        // Get current order in the folder
        let children: import("../types/bookmarks").BookmarkNode[];
        try {
          children = await bookmarks.getChildren(parentId);
        } catch (error) {
          // Parent folder doesn't exist or can't be accessed - skip
          logger.debug(
            `Skipping normalizeIndices for parent ${parentId}: folder not accessible`
          );
          continue;
        }

        if (children.length === 0) {
          // Empty folder - clear all indices
          for (const mapping of group) {
            if (mapping.browserIndex !== undefined) {
              mapping.browserIndex = undefined;
              await storage.upsertMapping(mapping);
            }
          }
          continue;
        }

        const childOrder = new Map<string, number>();
        children.forEach((child, index) => {
          childOrder.set(child.id, index);
        });

        // Sort mappings by current position in folder
        group.sort((a, b) => {
          const aIndex = childOrder.get(a.browserId) ?? 999;
          const bIndex = childOrder.get(b.browserId) ?? 999;
          return aIndex - bIndex;
        });

        // Assign sequential indices based on current order
        let hasChanges = false;
        for (let i = 0; i < group.length; i++) {
          if (group[i].browserIndex !== i) {
            group[i].browserIndex = i;
            hasChanges = true;
          }
        }

        // Save updated mappings
        if (hasChanges) {
          for (const mapping of group) {
            await storage.upsertMapping(mapping);
          }
          logger.debug("Normalized indices in folder:", {
            parentId,
            count: group.length,
          });
        }
      }
    } catch (error) {
      this.errors.collect(
        error as Error,
        createErrorContext("normalizeIndices")
      );
    }
  }
}
