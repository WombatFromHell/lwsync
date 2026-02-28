/**
 * Browser Change Applier
 * Handles applying browser-originated changes to Linkwarden
 *
 * Processes create, update, delete, and move operations from browser events.
 */

import * as storage from "../storage";
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

    // Check if URL already exists in target collection (prevent duplicates)
    const existingLinks = await this.api.getCollectionLinks(
      metadata.targetCollectionId
    );
    const existingLink = existingLinks.find((l) => l.url === url);

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
        url,
        metadata.targetCollectionId,
        title
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
        const existingLink = links.find((l) => l.url === change.data!.url);
        if (existingLink) {
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

    // Find mapping for the moved item
    const itemMapping = await storage.getMappingByLinkwardenId(
      change.linkwardenId,
      "link"
    );

    if (itemMapping) {
      // Link move - update collection on Linkwarden
      await this.handleLinkMove(change, parentMapping, itemMapping);
    } else {
      // Might be a folder move
      await this.handleFolderMove(change, parentMapping);
    }
  }

  /**
   * Handle link move between collections
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

      await this.api.updateLink(change.linkwardenId!, {
        collectionId: parentMapping.linkwardenId,
      });

      // Update mapping timestamp
      itemMapping.browserUpdatedAt = Date.now();
      itemMapping.lastSyncedAt = Date.now();
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
}
