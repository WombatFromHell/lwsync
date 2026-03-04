/**
 * Background Service Worker
 * Handles sync scheduling, browser event listeners, and message passing
 */

import { LinkwardenAPI } from "./api";
import { SyncEngine } from "./sync";
import * as storage from "./storage";
import * as bookmarks from "./bookmarks";
import {
  createLogger,
  generateId,
  now,
  debounce,
  setLogCollector,
} from "./utils";
import { SyncLogCollector } from "./utils/logCollector";
import { getDefaultCollectionName } from "./browser";
import { CONFIG } from "./config";
import { createMessageRouter } from "./utils/messageRouter";
import type {
  ChromeMessage,
  MessageType,
  SaveSettingsMessage,
  TestConnectionMessage,
  UpdateSyncIntervalMessage,
  UpdateTargetCollectionMessage,
  UpdateBrowserFolderMessage,
} from "./types/background";

// Initialize global log collector
const logCollector = new SyncLogCollector();
setLogCollector(logCollector);

const logger = createLogger("LWSync");

let syncEngine: SyncEngine | null = null;

/**
 * Debounced sync trigger
 * Triggers sync 2 seconds after the last bookmark change
 * This provides near-immediate feedback without flooding the server
 */
const debouncedSync = debounce(() => {
  logger.info("Auto-sync triggered by bookmark change");
  void performSync();
}, 2000); // 2 second debounce

/**
 * Add entry to sync log (persistent storage)
 */
async function addLogEntry(
  type: "info" | "success" | "error" | "warning",
  message: string
): Promise<void> {
  await storage.addLogEntry(type, message);
}

/**
 * Clear sync log
 */
async function clearLog(): Promise<void> {
  await storage.clearSyncLog();
}

/**
 * Initialize the sync engine with current settings
 */
async function initSyncEngine(): Promise<void> {
  const settings = await storage.getSettings();

  if (!settings?.serverUrl || !settings?.accessToken) {
    logger.info("Not configured, skipping initialization");
    return;
  }

  const api = new LinkwardenAPI(settings.serverUrl, settings.accessToken);
  syncEngine = new SyncEngine(api);

  // Set up sync alarm
  void chrome.alarms.create("lwsync-sync", {
    delayInMinutes: 1, // First sync after 1 minute
    periodInMinutes: settings.syncInterval,
  });

  // Resolve collection identifier (ID preferred, then name, then default)
  const collectionIdentifier = resolveCollectionIdentifier(settings);
  const browserFolderName = settings.browserFolderName || "";

  logger.info("Initializing sync:", {
    collection: collectionIdentifier,
    browserFolder: browserFolderName,
    interval: settings.syncInterval,
  });

  await addLogEntry(
    "info",
    `Initialized - Collection: "${collectionIdentifier}", Browser Folder: "${browserFolderName}", Interval: ${settings.syncInterval} min`
  );

  // Auto-initialize sync if not already configured
  const metadata = await storage.getSyncMetadata();
  if (!metadata) {
    await addLogEntry(
      "info",
      `Initializing sync for collection: ${collectionIdentifier}, browser folder: ${browserFolderName}...`
    );
    const result = await syncEngine.initialize(
      collectionIdentifier,
      browserFolderName
    );
    if (result.success) {
      await addLogEntry(
        "success",
        `Sync initialized for collection ID: ${result.collectionId}`
      );
    } else {
      await addLogEntry("error", `Failed to initialize sync: ${result.error}`);
    }
  } else {
    await addLogEntry(
      "info",
      `Using existing metadata - Collection ID: ${metadata.targetCollectionId}`
    );
  }
}

/**
 * Resolve collection identifier from settings
 * Priority: 1) ID, 2) Name, 3) Default "Bookmarks"
 */
function resolveCollectionIdentifier(settings: {
  targetCollectionId?: number | null;
  targetCollectionName?: string | null;
}): string {
  if (settings.targetCollectionId) {
    return settings.targetCollectionId.toString();
  }
  if (settings.targetCollectionName && settings.targetCollectionName.trim()) {
    return settings.targetCollectionName;
  }
  return getDefaultCollectionName();
}

/**
 * Perform a sync operation
 */
async function performSync(): Promise<void> {
  if (!syncEngine) {
    logger.info("Sync engine not initialized");
    return;
  }

  if (syncEngine.syncing) {
    logger.info("Sync already in progress");
    return;
  }

  await addLogEntry("info", "Starting sync...");

  try {
    const result = await syncEngine.sync();

    const summary = `${result.created} created, ${result.updated} updated, ${result.deleted} deleted, ${result.skipped} skipped`;
    await addLogEntry("success", summary);

    if (result.errors.length > 0) {
      for (const err of result.errors) {
        await addLogEntry("error", err);
      }
    }

    // Notify popup of sync completion
    void chrome.runtime
      .sendMessage({
        type: "SYNC_COMPLETE",
        payload: result,
      })
      .catch(() => {
        // Popup might not be open, ignore error
      });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    await addLogEntry("error", `Sync failed: ${errorMessage}`);
  }
}

/**
 * Handle browser bookmark events
 */
function setupBookmarkListeners(): void {
  // Bookmark created
  chrome.bookmarks.onCreated.addListener(async (id, node) => {
    if (!syncEngine) {
      logger.warn("Sync engine not initialized, ignoring bookmark created");
      return;
    }

    // Ignore if it's our sync folder
    const metadata = await storage.getSyncMetadata();
    if (metadata && id === metadata.browserRootFolderId) {
      logger.info("Ignoring sync folder creation:", id);
      return;
    }

    logger.info("Bookmark created:", {
      id,
      title: node.title,
      url: node.url,
      parentId: node.parentId,
    });

    // Queue as pending change
    await storage.addPendingChange({
      id: generateId(),
      type: "create",
      source: "browser",
      browserId: id,
      parentId: node.parentId,
      data: {
        title: node.title,
        url: node.url,
      },
      timestamp: now(),
      resolved: false,
    });

    // Trigger debounced sync (will sync 2s after last change)
    debouncedSync();
  });

  // Bookmark changed (title or URL)
  chrome.bookmarks.onChanged.addListener(async (id, changes) => {
    if (!syncEngine) {
      logger.warn("Sync engine not initialized, ignoring bookmark changed");
      return;
    }

    logger.info("Bookmark changed:", {
      id,
      title: changes.title,
      url: changes.url,
    });

    // Find mapping to get Linkwarden ID
    const mapping = await storage.getMappingByBrowserId(id);

    // Queue as pending change
    await storage.addPendingChange({
      id: generateId(),
      type: "update",
      source: "browser",
      linkwardenId: mapping?.linkwardenId,
      browserId: id,
      data: {
        title: changes.title,
        url: changes.url,
      },
      timestamp: now(),
      resolved: false,
    });

    // Trigger debounced sync
    debouncedSync();
  });

  // Bookmark removed
  chrome.bookmarks.onRemoved.addListener(async (id, removeInfo) => {
    if (!syncEngine) {
      logger.warn("Sync engine not initialized, ignoring bookmark removed");
      return;
    }

    logger.info("Bookmark removed:", {
      id,
      parentId: removeInfo.parentId,
    });

    // Find mapping to get Linkwarden ID
    const mapping = await storage.getMappingByBrowserId(id);
    if (mapping) {
      await storage.addPendingChange({
        id: generateId(),
        type: "delete",
        source: "browser",
        linkwardenId: mapping.linkwardenId,
        browserId: id,
        timestamp: now(),
        resolved: false,
      });

      // Trigger debounced sync
      debouncedSync();
    } else {
      logger.info("No mapping found for removed bookmark, skipping:", id);
    }
  });

  // Bookmark moved (includes reorder within same folder)
  chrome.bookmarks.onMoved.addListener(async (id, moveInfo) => {
    if (!syncEngine) {
      logger.warn("Sync engine not initialized, ignoring bookmark moved");
      return;
    }

    // Find mapping to get Linkwarden ID and type
    const mapping = await storage.getMappingByBrowserId(id);
    if (!mapping) {
      logger.info("No mapping found for moved bookmark, skipping:", id);
      return; // Not a synced item
    }

    // Get the node to determine if it's a folder or link
    const node = await bookmarks.get(id);
    const isFolder = !node?.url;

    const isReorder = moveInfo.oldParentId === moveInfo.parentId;

    logger.info("Bookmark moved:", {
      id,
      isFolder,
      isReorder,
      title: node?.title,
      fromIndex: moveInfo.oldIndex,
      toIndex: moveInfo.index,
      oldParentId: moveInfo.oldParentId,
      newParentId: moveInfo.parentId,
    });

    // Queue as pending change with full context
    await storage.addPendingChange({
      id: generateId(),
      type: "move",
      source: "browser",
      linkwardenId: mapping.linkwardenId,
      browserId: id,
      parentId: moveInfo.parentId,
      index: moveInfo.index, // Capture new index
      oldParentId: moveInfo.oldParentId, // Capture old parent for reorder detection
      oldIndex: moveInfo.oldIndex, // Capture old index
      data: {
        title: node?.title,
        url: node?.url,
      },
      timestamp: now(),
      resolved: false,
    });

    // Update mapping's browserUpdatedAt to track user reorder
    // This allows restoreOrder to detect that browser was modified after last sync
    // Note: Don't update browserIndex here - it's updated by restoreOrder() when capturing sibling order
    mapping.browserUpdatedAt = Date.now();
    await storage.upsertMapping(mapping);

    // Trigger debounced sync
    debouncedSync();
  });
}

/**
 * Handle messages from popup or other parts of extension
 */
function setupMessageListener(): void {
  const router = createMessageRouter();

  // Register message handlers
  router.register("GET_STATUS", () =>
    Promise.all([
      storage.getAll(),
      storage.getStorageUsage(),
      storage.getSyncLog(),
    ]).then(([data, bytes, syncLog]) => ({
      configured: !!data.settings?.serverUrl,
      syncing: syncEngine?.syncing || false,
      lastSyncTime: data.sync_metadata?.lastSyncTime,
      mappingsCount: data.mappings.length,
      pendingChangesCount: data.pending_changes.filter(
        (c: { resolved: boolean }) => !c.resolved
      ).length,
      storageBytes: bytes,
      syncLog,
    }))
  );

  router.register("START_SYNC", () =>
    performSync().then(() => ({ success: true }))
  );

  router.register("SAVE_SETTINGS", (payload: SaveSettingsMessage) => {
    logger.info("Saving settings:", payload);
    // Ensure required fields have defaults
    const settingsWithDefaults = {
      serverUrl: payload.serverUrl,
      accessToken: payload.accessToken,
      syncInterval: payload.syncInterval,
      targetCollectionName:
        payload.targetCollectionName || getDefaultCollectionName(),
      browserFolderName: payload.browserFolderName || "",
    };
    return storage
      .saveSettings(settingsWithDefaults)
      .then(() => {
        // Clear metadata to force re-initialization with new settings
        storage.saveSyncMetadata(null as never);
      })
      .then(() => initSyncEngine())
      .then(() => {
        void addLogEntry("info", "Settings saved");
        return { success: true };
      });
  });

  router.register("GET_SETTINGS", () =>
    storage.getSettings().then((settings) => {
      if (!settings) {
        return {
          serverUrl: "",
          accessToken: "",
          syncInterval: CONFIG.sync.DEFAULT_SYNC_INTERVAL,
          targetCollectionId: undefined,
          targetCollectionName: getDefaultCollectionName(),
          browserFolderName: "",
        };
      }
      return {
        ...settings,
        targetCollectionName:
          settings.targetCollectionName || getDefaultCollectionName(),
      };
    })
  );

  router.register("TEST_CONNECTION", (payload: TestConnectionMessage) =>
    new LinkwardenAPI(payload.serverUrl, payload.token)
      .testConnection()
      .then((success) => {
        if (success) {
          void addLogEntry("success", "Connection test passed");
        } else {
          void addLogEntry("error", "Connection test failed");
        }
        return { success };
      })
      .catch((err: Error) => {
        void addLogEntry("error", `Connection test error: ${err.message}`);
        return { success: false };
      })
  );

  router.register("RESET_SYNC", () =>
    syncEngine
      ?.reset()
      .then(() => {
        void addLogEntry("info", "Sync reset by user");
        // Reset in-memory state
        syncEngine = null;
        // Clear sync alarm
        void chrome.alarms.clear("lwsync-sync");
        return { success: true };
      })
      .catch((error: Error) => {
        void addLogEntry("error", `Reset failed: ${error.message}`);
        return { success: false, error: error.message };
      })
  );

  router.register("GET_STORAGE_USAGE", () =>
    storage.getStorageUsage().then((bytes) => ({ bytes }))
  );

  router.register("CLEAR_LOG", () =>
    clearLog().then(() => ({ success: true }))
  );

  router.register("EXPORT_LOGS", () => ({
    success: true,
    logs: logCollector.getEntries(),
    json: logCollector.toJSON(),
  }));

  router.register("COMPARE_SYNC", () =>
    syncEngine
      ?.compare({ includeDebug: true })
      .then((comparison) => {
        return { success: true, comparison };
      })
      .catch((error: Error) => {
        void addLogEntry("error", `Comparison failed: ${error.message}`);
        return { success: false, error: error.message };
      })
  );

  router.register("GET_DIAGNOSTICS", () =>
    Promise.all([storage.getSettings(), storage.getSyncMetadata()]).then(
      ([settings, metadata]) => {
        const hasId =
          settings?.targetCollectionId !== undefined &&
          settings?.targetCollectionId !== null;
        const hasName =
          settings?.targetCollectionName &&
          settings.targetCollectionName.trim() !== "";

        const diagnostics = {
          settings: {
            serverUrl: settings?.serverUrl || "(not set)",
            targetCollectionId: hasId
              ? settings?.targetCollectionId
              : "(not set)",
            targetCollectionName: hasName
              ? settings?.targetCollectionName
              : "(not set)",
            browserFolderName: settings?.browserFolderName || "(not set)",
            syncInterval: settings?.syncInterval || 5,
          },
          metadata: metadata
            ? {
                targetCollectionId: metadata.targetCollectionId,
                browserRootFolderId: metadata.browserRootFolderId,
                lastSyncTime: metadata.lastSyncTime
                  ? new Date(metadata.lastSyncTime).toISOString()
                  : "never",
              }
            : "(not initialized)",
          configMethod: hasId
            ? "✅ ID (preferred - unique)"
            : hasName
              ? "⚠️ Name (can have duplicates)"
              : "❌ Not set (will use default 'Bookmarks')",
          recommendation:
            !hasId && hasName
              ? "💡 Tip: Use collection ID instead of name for more reliable sync. Find the ID in your Linkwarden URL or API response."
              : !hasId && !hasName
                ? "⚠️ Warning: No collection configured. Please set targetCollectionId or targetCollectionName."
                : "✅ Configuration looks good!",
        };
        return diagnostics;
      }
    )
  );

  router.register(
    "UPDATE_SYNC_INTERVAL",
    (payload: UpdateSyncIntervalMessage) =>
      storage
        .getSettings()
        .then((settings) => {
          if (!settings) {
            throw new Error("Settings not found");
          }
          return storage.saveSettings({
            ...settings,
            syncInterval: payload.syncInterval,
          });
        })
        .then(() =>
          chrome.alarms.create("lwsync-sync", {
            periodInMinutes: payload.syncInterval,
          })
        )
        .then(() => {
          void addLogEntry(
            "info",
            `Sync interval updated to ${payload.syncInterval} minutes`
          );
          return { success: true };
        })
  );

  router.register(
    "UPDATE_TARGET_COLLECTION",
    (payload: UpdateTargetCollectionMessage) =>
      storage
        .getSettings()
        .then((settings) => {
          if (!settings) {
            throw new Error("Settings not found");
          }
          return storage.saveSettings({
            ...settings,
            targetCollectionName: payload.targetCollectionName,
          });
        })
        .then(() => {
          // Clear sync metadata to force re-initialization on next sync
          storage.saveSyncMetadata(null as never);
        })
        .then(() => initSyncEngine())
        .then(() => {
          void addLogEntry(
            "info",
            `Target collection updated to "${payload.targetCollectionName}"`
          );
          return { success: true };
        })
  );

  router.register(
    "UPDATE_BROWSER_FOLDER",
    (payload: UpdateBrowserFolderMessage) =>
      storage
        .getSettings()
        .then((settings) => {
          if (!settings) {
            throw new Error("Settings not found");
          }
          return storage.saveSettings({
            ...settings,
            browserFolderName: payload.browserFolderName,
          });
        })
        .then(() => {
          // Clear sync metadata to force re-initialization on next sync
          storage.saveSyncMetadata(null as never);
        })
        .then(() => initSyncEngine())
        .then(() => {
          void addLogEntry(
            "info",
            `Browser folder updated to "${payload.browserFolderName}"`
          );
          return { success: true };
        })
  );

  // Set up the message listener with the router
  chrome.runtime.onMessage.addListener(
    (message: ChromeMessage<MessageType>, _sender, sendResponse) => {
      logger.info("Received message:", message.type);

      router
        .handle(message)
        .then((response) => {
          sendResponse(response);
        })
        .catch((error: Error) => {
          logger.error(`Message handler error: ${message.type}`, error);
          sendResponse({ success: false, error: error.message });
        });

      return true; // Async response
    }
  );
}

// Initialize on service worker startup
logger.info("Service worker starting...");

// Clear sync log on startup (it's for debugging recent sessions only)
void clearLog();

// Listen for sync alarm
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "lwsync-sync") {
    logger.info("Sync alarm triggered");
    void performSync();
  }
});

initSyncEngine();
setupBookmarkListeners();
setupMessageListener();

logger.info("Service worker initialized");
