/**
 * Background Service Worker
 * Handles sync scheduling, browser event listeners, and message passing
 */

import { LinkwardenAPI } from "./api";
import { SyncEngine } from "./sync";
import * as storage from "./storage";
import * as bookmarks from "./bookmarks";
import { createLogger } from "./logger";
import { getDefaultCollectionName } from "./browser";

const logger = createLogger("LWSync");

let syncEngine: SyncEngine | null = null;

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
  await chrome.alarms.create("lwsync-sync", {
    delayInMinutes: 1, // First sync after 1 minute
    periodInMinutes: settings.syncInterval,
  });

  const collectionName =
    settings.targetCollectionName || getDefaultCollectionName();
  const browserFolderName = settings.browserFolderName || "";

  await addLogEntry(
    "info",
    `Initialized - Collection: "${collectionName}", Browser Folder: "${browserFolderName}", Interval: ${settings.syncInterval} min`
  );

  // Auto-initialize sync if not already configured
  const metadata = await storage.getSyncMetadata();
  if (!metadata) {
    await addLogEntry(
      "info",
      `Initializing sync for collection: ${collectionName}, browser folder: ${browserFolderName}...`
    );
    const result = await syncEngine.initialize(
      collectionName,
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
  }
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
    chrome.runtime
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
    if (!syncEngine) return;

    // Ignore if it's our sync folder
    const metadata = await storage.getSyncMetadata();
    if (metadata && id === metadata.browserRootFolderId) return;

    logger.info("Bookmark created:", id);

    // Queue as pending change
    await storage.addPendingChange({
      id: crypto.randomUUID(),
      type: "create",
      source: "browser",
      browserId: id,
      parentId: node.parentId,
      data: {
        title: node.title,
        url: node.url,
      },
      timestamp: Date.now(),
      resolved: false,
    });
  });

  // Bookmark changed (title or URL)
  chrome.bookmarks.onChanged.addListener(async (id, changes) => {
    if (!syncEngine) return;

    // Find mapping to get Linkwarden ID
    const mapping = await storage.getMappingByBrowserId(id);

    // Queue as pending change
    await storage.addPendingChange({
      id: crypto.randomUUID(),
      type: "update",
      source: "browser",
      linkwardenId: mapping?.linkwardenId,
      browserId: id,
      data: {
        title: changes.title,
        url: changes.url,
      },
      timestamp: Date.now(),
      resolved: false,
    });
  });

  // Bookmark removed
  chrome.bookmarks.onRemoved.addListener(async (id) => {
    if (!syncEngine) return;

    logger.info("Bookmark removed:", id);

    // Find mapping to get Linkwarden ID
    const mapping = await storage.getMappingByBrowserId(id);
    if (mapping) {
      await storage.addPendingChange({
        id: crypto.randomUUID(),
        type: "delete",
        source: "browser",
        linkwardenId: mapping.linkwardenId,
        browserId: id,
        timestamp: Date.now(),
        resolved: false,
      });
    }
  });

  // Bookmark moved
  chrome.bookmarks.onMoved.addListener(async (id, moveInfo) => {
    if (!syncEngine) return;

    // Find mapping to get Linkwarden ID and type
    const mapping = await storage.getMappingByBrowserId(id);
    if (!mapping) return; // Not a synced item

    // Get the node to determine if it's a folder or link
    const node = await bookmarks.get(id);
    const isFolder = !node?.url;

    logger.info("Bookmark moved:", {
      id,
      isFolder,
      title: node?.title,
      oldParentId: moveInfo.oldParentId,
      newParentId: moveInfo.parentId,
    });

    // Queue as pending change with full context
    await storage.addPendingChange({
      id: crypto.randomUUID(),
      type: "move",
      source: "browser",
      linkwardenId: mapping.linkwardenId,
      browserId: id,
      parentId: moveInfo.parentId,
      data: {
        title: node?.title,
        url: node?.url,
      },
      timestamp: Date.now(),
      resolved: false,
    });
  });
}

/**
 * Handle messages from popup or other parts of extension
 */
function setupMessageListener(): void {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    logger.info("Received message:", message.type);

    switch (message.type) {
      case "GET_STATUS":
        Promise.all([
          storage.getAll(),
          storage.getStorageUsage(),
          storage.getSyncLog(),
        ]).then(([data, bytes, syncLog]) => {
          sendResponse({
            configured: !!data.settings?.serverUrl,
            syncing: syncEngine?.syncing || false,
            lastSyncTime: data.sync_metadata?.lastSyncTime,
            mappingsCount: data.mappings.length,
            pendingChangesCount: data.pending_changes.filter((c) => !c.resolved)
              .length,
            storageBytes: bytes,
            syncLog: syncLog,
          });
        });
        return true; // Async response

      case "START_SYNC":
        performSync().then(() => {
          sendResponse({ success: true });
        });
        return true;

      case "SAVE_SETTINGS":
        logger.info("Saving settings:", message.payload);
        storage
          .saveSettings(message.payload)
          .then(() => {
            // Clear metadata to force re-initialization with new settings
            return storage.saveSyncMetadata(null);
          })
          .then(() => {
            return initSyncEngine();
          })
          .then(() => {
            addLogEntry("info", "Settings saved");
            sendResponse({ success: true });
          });
        return true;

      case "GET_SETTINGS":
        storage.getSettings().then((settings) => {
          sendResponse(settings);
        });
        return true;

      case "TEST_CONNECTION":
        new LinkwardenAPI(message.payload.serverUrl, message.payload.token)
          .testConnection()
          .then((success) => {
            if (success) {
              addLogEntry("success", "Connection test passed");
            } else {
              addLogEntry("error", "Connection test failed");
            }
            sendResponse({ success });
          })
          .catch((err) => {
            addLogEntry("error", `Connection test error: ${err.message}`);
            sendResponse({ success: false });
          });
        return true;

      case "RESET_SYNC":
        syncEngine
          ?.reset()
          .then(() => {
            addLogEntry("info", "Sync reset by user");
            // Reset in-memory state
            syncEngine = null;
            // Clear sync alarm
            chrome.alarms.clear("lwsync-sync");
            sendResponse({ success: true });
          })
          .catch((error) => {
            addLogEntry("error", `Reset failed: ${error.message}`);
            sendResponse({ success: false, error: error.message });
          });
        return true;

      case "GET_STORAGE_USAGE":
        storage.getStorageUsage().then((bytes) => {
          sendResponse({ bytes });
        });
        return true;

      case "CLEAR_LOG":
        clearLog().then(() => {
          sendResponse({ success: true });
        });
        return true;

      case "UPDATE_SYNC_INTERVAL":
        storage
          .getSettings()
          .then((settings) => {
            if (!settings) {
              sendResponse({ success: false, error: "Settings not found" });
              return;
            }
            return storage.saveSettings({
              ...settings,
              syncInterval: message.payload.syncInterval,
            });
          })
          .then(() => {
            // Update the alarm with new interval
            return chrome.alarms.create("lwsync-sync", {
              periodInMinutes: message.payload.syncInterval,
            });
          })
          .then(() => {
            addLogEntry(
              "info",
              `Sync interval updated to ${message.payload.syncInterval} minutes`
            );
            sendResponse({ success: true });
          })
          .catch((error) => {
            addLogEntry(
              "error",
              `Update sync interval failed: ${error.message}`
            );
            sendResponse({ success: false, error: error.message });
          });
        return true;

      case "UPDATE_TARGET_COLLECTION":
        storage
          .getSettings()
          .then((settings) => {
            if (!settings) {
              sendResponse({ success: false, error: "Settings not found" });
              return;
            }
            return storage.saveSettings({
              ...settings,
              targetCollectionName: message.payload.targetCollectionName,
            });
          })
          .then(() => {
            // Clear sync metadata to force re-initialization on next sync
            return storage.saveSyncMetadata(null);
          })
          .then(() => {
            // Re-initialize sync engine with new collection name
            return initSyncEngine();
          })
          .then(() => {
            addLogEntry(
              "info",
              `Target collection updated to "${message.payload.targetCollectionName}"`
            );
            sendResponse({ success: true });
          })
          .catch((error) => {
            addLogEntry(
              "error",
              `Update target collection failed: ${error.message}`
            );
            sendResponse({ success: false, error: error.message });
          });
        return true;

      case "UPDATE_BROWSER_FOLDER":
        storage
          .getSettings()
          .then((settings) => {
            if (!settings) {
              sendResponse({ success: false, error: "Settings not found" });
              return;
            }
            return storage.saveSettings({
              ...settings,
              browserFolderName: message.payload.browserFolderName,
            });
          })
          .then(() => {
            // Clear sync metadata to force re-initialization on next sync
            return storage.saveSyncMetadata(null);
          })
          .then(() => {
            // Re-initialize sync engine with new browser folder
            return initSyncEngine();
          })
          .then(() => {
            addLogEntry(
              "info",
              `Browser folder updated to "${message.payload.browserFolderName}"`
            );
            sendResponse({ success: true });
          })
          .catch((error) => {
            addLogEntry(
              "error",
              `Update browser folder failed: ${error.message}`
            );
            sendResponse({ success: false, error: error.message });
          });
        return true;
    }

    return false;
  });
}

// Initialize on service worker startup
logger.info("Service worker starting...");

// Listen for sync alarm
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "lwsync-sync") {
    logger.info("Sync alarm triggered");
    performSync();
  }
});

initSyncEngine();
setupBookmarkListeners();
setupMessageListener();

logger.info("Service worker initialized");
