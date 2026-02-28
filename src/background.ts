/**
 * Background Service Worker
 * Handles sync scheduling, browser event listeners, and message passing
 */

import { LinkwardenAPI } from "./api";
import { SyncEngine } from "./sync";
import * as storage from "./storage";
import * as bookmarks from "./bookmarks";
import { createLogger, generateId, now } from "./utils";
import { getDefaultCollectionName } from "./browser";
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
  void chrome.alarms.create("lwsync-sync", {
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
    if (!syncEngine) return;

    // Ignore if it's our sync folder
    const metadata = await storage.getSyncMetadata();
    if (metadata && id === metadata.browserRootFolderId) return;

    logger.info("Bookmark created:", id);

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
  });

  // Bookmark changed (title or URL)
  chrome.bookmarks.onChanged.addListener(async (id, changes) => {
    if (!syncEngine) return;

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
  });

  // Bookmark removed
  chrome.bookmarks.onRemoved.addListener(async (id) => {
    if (!syncEngine) return;

    logger.info("Bookmark removed:", id);

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
      id: generateId(),
      type: "move",
      source: "browser",
      linkwardenId: mapping.linkwardenId,
      browserId: id,
      parentId: moveInfo.parentId,
      data: {
        title: node?.title,
        url: node?.url,
      },
      timestamp: now(),
      resolved: false,
    });
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

  router.register("GET_SETTINGS", () => storage.getSettings());

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
