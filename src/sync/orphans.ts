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
   */
  async cleanupOrphanedMappings(
    remoteLinkIds: Set<number>,
    remoteCollectionIds: Set<number>,
    browserRootFolderId: string
  ): Promise<void> {
    try {
      // Find orphaned link mappings
      const orphanedLinks = await this.findOrphanedMappings(
        remoteLinkIds,
        "link"
      );

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
}
