/**
 * Browser Change Applier
 * Handles applying browser-originated changes to Linkwarden
 *
 * Processes create, update, delete, and move operations from browser events.
 */

import * as storage from "../storage";
import * as bookmarks from "../bookmarks";
import type { LinkwardenAPI } from "../api";
import type { Mapping, PendingChange, SyncMetadata } from "../types/storage";
import { SyncErrorReporter, createErrorContext } from "./errorReporter";
import { computeChecksum } from "./conflict";
import { appendMoveToken, isDescendantOf } from "./moves";
import { createLogger } from "../utils";

const logger = createLogger("LWSync browser-changes");

export class BrowserChangeApplier {
  private api: LinkwardenAPI;
  private errors: SyncErrorReporter;

  constructor(api: LinkwardenAPI, errorReporter?: SyncErrorReporter) {
    this.api = api;
    this.errors = errorReporter || new SyncErrorReporter();
  }

  /**
   * Apply a pending change from browser to Linkwarden
   */
  async apply(change: PendingChange): Promise<void> {
    const metadata = await storage.getSyncMetadata();
    if (!metadata) {
      logger.warn("No sync metadata, skipping browser change");
      return;
    }

    try {
      switch (change.type) {
        case "create":
        case "update":
          await this.handleCreateOrUpdate(change, metadata);
          break;
        case "delete":
          await this.handleDelete(change);
          break;
        case "move":
          await this.handleMove(change, metadata);
          break;
      }
    } catch (error) {
      this.errors.collect(
        error as Error,
        createErrorContext("applyBrowserChange", {
          itemId: change.browserId || change.linkwardenId,
          data: { type: change.type, source: change.source },
        })
      );
      throw error;
    }
  }

  /**
   * Handle create or update operations
   */
  private async handleCreateOrUpdate(
    change: PendingChange,
    metadata: SyncMetadata
  ): Promise<void> {
    // Check if we have a link mapping (for renames where URL might not be provided)
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
      await this.handleNewLink(change, metadata);
    } else if (change.linkwardenId) {
      // It's a folder (no URL) and we have a Linkwarden ID - update collection name
      if (change.data?.title) {
        await this.handleFolderUpdate(change);
      }
    }
  }

  /**
   * Handle new link creation
   */
  private async handleNewLink(
    change: PendingChange,
    metadata: SyncMetadata
  ): Promise<void> {
    // Guard: change.data must exist with url for new links
    const url = change.data?.url;
    const title = change.data?.title;

    if (!url) {
      return;
    }

    logger.info("Creating new link:", {
      url,
      title,
      targetCollectionId: metadata.targetCollectionId,
      browserId: change.browserId,
    });

    // Check if URL already exists in target collection (prevent duplicates)
    const existingLinks = await this.api.getLinksByCollection(
      metadata.targetCollectionId
    );
    const existingLink = existingLinks.find((l) => l.url === url);

    if (existingLink) {
      // Link exists on server - create mapping instead of duplicate
      logger.info("Link already exists in collection, creating mapping:", {
        linkId: existingLink.id,
        collectionId: metadata.targetCollectionId,
      });
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
        url,
        metadata.targetCollectionId,
        title
      );

      logger.info("Link created successfully:", {
        linkId: link.id,
        collectionId: metadata.targetCollectionId,
      });

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
        const links = await this.api.getLinksByCollection(
          metadata.targetCollectionId
        );
        const existingLink = links.find((l) => l.url === change.data!.url);
        if (existingLink) {
          logger.info("Link already exists (409), creating mapping:", {
            linkId: existingLink.id,
            collectionId: metadata.targetCollectionId,
          });
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
        }
        return; // Don't throw error - this is expected behavior
      }
      logger.error("Failed to create link:", {
        error: error instanceof Error ? error.message : String(error),
        collectionId: metadata.targetCollectionId,
      });
      throw error; // Re-throw other errors
    }
  }

  /**
   * Handle folder name update
   */
  private async handleFolderUpdate(change: PendingChange): Promise<void> {
    const mapping = await storage.getMappingByLinkwardenId(
      change.linkwardenId!,
      "collection"
    );

    if (mapping && change.data?.title) {
      await this.api.updateCollection(change.linkwardenId!, {
        name: change.data.title,
      });
      mapping.browserUpdatedAt = Date.now();
      mapping.lastSyncedAt = Date.now();
      await storage.upsertMapping(mapping);
    }
  }

  /**
   * Handle delete operation
   */
  private async handleDelete(change: PendingChange): Promise<void> {
    if (change.linkwardenId) {
      await this.api.deleteLink(change.linkwardenId);
    }
    await storage.removeMapping(change.linkwardenId!, "link");
  }

  /**
   * Handle move operation
   */
  private async handleMove(
    change: PendingChange,
    metadata: SyncMetadata
  ): Promise<void> {
    if (!change.linkwardenId || !change.parentId) {
      logger.warn("Move operation missing required info:", {
        linkwardenId: change.linkwardenId,
        parentId: change.parentId,
      });
      return;
    }

    // Find mapping for the moved item
    const itemMapping = await storage.getMappingByBrowserId(change.browserId!);

    if (!itemMapping) {
      logger.warn("No mapping found for moved item:", {
        browserId: change.browserId,
      });
      return;
    }

    // Capture index in mapping (for both reorders and moves)
    if (change.index !== undefined) {
      itemMapping.browserIndex = change.index;
      itemMapping.browserUpdatedAt = Date.now();
      await storage.upsertMapping(itemMapping);
      logger.debug("Captured bookmark index:", {
        browserId: change.browserId,
        index: change.index,
      });
    }

    // Check if it's a reorder (same parent) or actual move (different parent)
    const isReorder = change.oldParentId === change.parentId;

    if (isReorder) {
      // Just a reorder within same folder - index already captured above
      logger.info("Bookmark reordered within same folder:", {
        browserId: change.browserId,
        newIndex: change.index,
      });

      // Capture indices for ALL siblings to maintain accurate order
      // When one bookmark moves, others shift positions
      await this.captureSiblingIndices(change.parentId as string);
      return;
    }

    // It's a move to different parent - need to verify parent is a synced collection
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

    // Handle link/folder move to different parent
    if (itemMapping.linkwardenType === "link") {
      await this.handleLinkMove(change, parentMapping, itemMapping);
    } else {
      await this.handleFolderMove(change, parentMapping);
    }
  }

  /**
   * Handle link move between collections
   * Uses bulk API for efficiency, preserves browserIndex for order restoration
   */
  private async handleLinkMove(
    change: PendingChange,
    parentMapping: Mapping,
    itemMapping: Mapping
  ): Promise<void> {
    try {
      logger.info("Moving link:", {
        linkId: change.linkwardenId,
        linkName: change.data?.title,
        fromParentId: change.parentId,
        toCollectionId: parentMapping.linkwardenId,
      });

      // Use individual update API (supported operation)
      await this.api.updateLink(change.linkwardenId!, {
        collectionId: parentMapping.linkwardenId,
      });

      // Update mapping timestamp and preserve browserIndex
      itemMapping.browserUpdatedAt = Date.now();
      itemMapping.lastSyncedAt = Date.now();
      // browserIndex is preserved - order will be restored on next sync
      await storage.upsertMapping(itemMapping);

      logger.info("Link move completed:", change.data?.title);
    } catch (error) {
      logger.error("Failed to move link:", error);
      throw error;
    }
  }

  /**
   * Handle folder move with move token
   */
  private async handleFolderMove(
    change: PendingChange,
    parentMapping: Mapping
  ): Promise<void> {
    const folderMapping = await storage.getMappingByLinkwardenId(
      change.linkwardenId!,
      "collection"
    );

    if (!folderMapping) return;

    // Validate to prevent circular moves
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

    logger.info("Folder move detected, appending move token:", {
      folderId: change.linkwardenId,
      folderName: change.data?.title,
      newParentId: change.parentId,
      newParentCollectionId: parentMapping.linkwardenId,
    });

    try {
      // Get current collection to preserve description
      const currentCollection = await this.api.getCollection(
        change.linkwardenId!
      );
      const newDescription = appendMoveToken(
        currentCollection.description,
        parentMapping.linkwardenId
      );

      // Update collection with move token in description
      await this.api.updateCollection(change.linkwardenId!, {
        description: newDescription,
      });

      logger.info("Move token appended to collection:", change.linkwardenId);

      // Update mapping to track new browser parent
      folderMapping.browserUpdatedAt = Date.now();
      await storage.upsertMapping(folderMapping);
    } catch (error) {
      logger.error("Failed to append move token:", error);
      // Fall back to just updating mapping if token append fails
    }
  }

  /**
   * Get the error reporter for this instance
   */
  getErrorReporter(): SyncErrorReporter {
    return this.errors;
  }

  /**
   * Batch process multiple link moves to same collection
   * More efficient than individual moves when multiple links are moved together
   */
  async batchProcessLinkMoves(
    changes: PendingChange[],
    metadata: SyncMetadata
  ): Promise<void> {
    // Group moves by target collection
    const movesByCollection = new Map<
      number,
      Array<{ change: PendingChange; mapping: Mapping }>
    >();

    for (const change of changes) {
      if (change.type !== "move" || change.source !== "browser") continue;
      if (!change.linkwardenId || !change.parentId) continue;

      // Find mapping for the moved item
      const itemMapping = await storage.getMappingByBrowserId(
        change.browserId!
      );
      if (!itemMapping || itemMapping.linkwardenType !== "link") continue;

      // Find mapping for the target parent
      const parentMapping = await storage.getMappingByBrowserId(
        change.parentId as string
      );
      if (!parentMapping || parentMapping.linkwardenType !== "collection")
        continue;

      // Group by target collection
      const collection =
        movesByCollection.get(parentMapping.linkwardenId) || [];
      collection.push({ change, mapping: itemMapping });
      movesByCollection.set(parentMapping.linkwardenId, collection);
    }

    // Process each group with individual operations (supported)
    for (const [collectionId, moves] of movesByCollection.entries()) {
      const linkIds = moves.map((m) => m.change.linkwardenId!);

      logger.info("Moving links:", {
        count: linkIds.length,
        toCollection: collectionId,
      });

      // Move each link individually (supported operation)
      for (const { mapping, change } of moves) {
        try {
          await this.api.updateLink(mapping.linkwardenId, {
            collectionId,
          });
          mapping.browserUpdatedAt = Date.now();
          mapping.lastSyncedAt = Date.now();
          // Don't overwrite browserIndex when moving to different collection
          // The browserIndex represents order within a folder, not across folders
          // Only update if this is a reorder within same folder (oldParentId === parentId)
          if (
            change.index !== undefined &&
            change.oldParentId === change.parentId
          ) {
            mapping.browserIndex = change.index;
          }
          // browserIndex is preserved - order will be restored on next sync
          await storage.upsertMapping(mapping);
        } catch (error) {
          logger.error("Failed to move link:", error as Error);
        }
      }

      logger.info("Link moves completed:", {
        moved: linkIds.length,
        toCollection: collectionId,
      });
    }
  }

  /**
   * Batch process multiple link deletes
   * Uses individual DELETE operations (bulk DELETE not documented in API spec)
   */
  async batchProcessLinkDeletes(changes: PendingChange[]): Promise<void> {
    const linkIds: number[] = [];
    const changesById = new Map<number, PendingChange>();

    for (const change of changes) {
      if (change.type !== "delete" || change.source !== "browser") continue;
      if (!change.linkwardenId) continue;

      linkIds.push(change.linkwardenId);
      changesById.set(change.linkwardenId, change);
    }

    if (linkIds.length === 0) return;

    logger.info("Deleting links:", {
      count: linkIds.length,
    });

    // Delete each link individually (supported operation)
    for (const linkId of linkIds) {
      try {
        await this.api.deleteLink(linkId);
        await storage.removeMapping(linkId, "link");
      } catch (error) {
        logger.error("Failed to delete link:", error as Error);
      }
    }

    logger.info("Link deletes completed:", {
      deleted: linkIds.length,
    });
  }

  /**
   * Capture indices for all bookmarks in a folder
   * Called after reorder to update all affected siblings
   */
  private async captureSiblingIndices(parentBrowserId: string): Promise<void> {
    try {
      const children = await bookmarks.getChildren(parentBrowserId);
      for (const child of children) {
        const mapping = await storage.getMappingByBrowserId(child.id);
        if (mapping) {
          mapping.browserIndex = child.index;
          await storage.upsertMapping(mapping);
        }
      }
      logger.debug("Captured sibling indices:", {
        parentId: parentBrowserId,
        count: children.length,
      });
    } catch (error) {
      logger.warn("Failed to capture sibling indices:", error as Error);
    }
  }
}
