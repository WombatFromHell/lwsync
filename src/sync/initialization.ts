/**
 * Sync Initialization
 * Handles first-time sync setup and configuration
 *
 * Creates/ finds collections and browser folders,
 * then performs initial sync.
 */

import type { LinkwardenAPI } from "../api";
import type { LinkwardenCollection } from "../types/api";
import type { SyncMetadata } from "../types/storage";
import * as storage from "../storage";
import * as bookmarks from "../bookmarks";
import { SyncErrorReporter, createErrorContext } from "./errorReporter";
import { RemoteSync } from "./remote-sync";
import { parseFolderPath as parsePath } from "../utils";
import { findOrCreateNestedFolder } from "./mappings";
import { createLogger } from "../utils";

const logger = createLogger("LWSync initialization");

export interface InitializationResult {
  success: boolean;
  error?: string;
  collectionId?: number;
}

export type SyncDirection = "bidirectional" | "to-browser" | "to-linkwarden";

export class SyncInitializer {
  private api: LinkwardenAPI;
  private errors: SyncErrorReporter;

  constructor(api: LinkwardenAPI, errorReporter?: SyncErrorReporter) {
    this.api = api;
    this.errors = errorReporter || new SyncErrorReporter();
  }

  /**
   * Initialize sync for a specific Linkwarden collection
   */
  async initialize(
    collectionName: string,
    browserFolderName: string,
    syncDirection: SyncDirection = "bidirectional"
  ): Promise<InitializationResult> {
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
      const rootFolder = await bookmarks.get(browserRootFolderId);

      if (!rootFolder) {
        throw new Error(
          `Failed to get browser root folder (ID: ${browserRootFolderId})`
        );
      }

      // Parse the browser folder name as a path and find/create nested folders
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

      // Perform initial sync
      const remoteSync = new RemoteSync(this.api, this.errors);
      const stats = await remoteSync.syncFromLinkwarden(metadata);

      logger.info("Initialization complete:", stats.toString());

      return {
        success: true,
        collectionId: collection.id,
      };
    } catch (error) {
      this.errors.collect(error as Error, createErrorContext("initialize"));
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
  async findOrCreateCollection(
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

      for (const c of collections) {
        collectionMap.set(c.id, c);
      }

      let parentId: number | undefined;
      let targetCollection: LinkwardenCollection | undefined;

      // Traverse/create each level of the path
      for (let i = 0; i < pathParts.length; i++) {
        const partName = pathParts[i];
        targetCollection = undefined; // Reset for each level

        // Find collection with this name under current parent
        const matches = Array.from(collectionMap.values()).filter((c) => {
          if (c.name !== partName) return false;
          if (parentId === undefined) {
            // Root level: match collections with no parent
            return c.parentId === null || c.parentId === undefined;
          }
          // Nested level: match specific parentId
          return c.parentId === parentId;
        });

        if (matches.length > 0) {
          // Use first match (could be improved to handle duplicates)
          targetCollection = matches[0];
          parentId = targetCollection.id;
        } else {
          // Create new collection
          logger.info("Creating collection:", {
            name: partName,
            parentId,
          });

          targetCollection = await this.api.createCollection(
            partName,
            parentId
          );

          // Add to map for subsequent iterations
          collectionMap.set(targetCollection.id, targetCollection);
          parentId = targetCollection.id;
        }
      }

      if (!targetCollection) {
        return null;
      }

      logger.info("Collection ready:", {
        id: targetCollection.id,
        name: targetCollection.name,
      });

      return {
        id: targetCollection.id,
        name: targetCollection.name,
      };
    } catch (error) {
      this.errors.collect(
        error as Error,
        createErrorContext("findOrCreateCollection", {
          data: { name },
        })
      );
      return null;
    }
  }

  /**
   * Get the error reporter for this instance
   */
  getErrorReporter(): SyncErrorReporter {
    return this.errors;
  }
}
