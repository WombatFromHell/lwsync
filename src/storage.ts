/**
 * Storage wrapper using chrome.storage.local with unlimitedStorage permission
 * Provides a simple key-value interface for sync state, mappings, and pending changes
 */

import { createLogger } from "./logger";
import { getDefaultCollectionName } from "./browser";

const logger = createLogger("LWSync storage");

export interface SyncMetadata {
  id: "sync_state";
  lastSyncTime: number;
  syncDirection: "bidirectional" | "to-browser" | "to-linkwarden";
  targetCollectionId: number;
  browserRootFolderId: string;
}

export interface Mapping {
  id: string;
  linkwardenType: "link" | "collection";
  linkwardenId: number;
  browserId: string;
  linkwardenUpdatedAt: number;
  browserUpdatedAt: number;
  lastSyncedAt: number;
  checksum: string;
}

export interface PendingChange {
  id: string;
  type: "create" | "update" | "delete" | "move";
  source: "linkwarden" | "browser";
  linkwardenId?: number;
  browserId?: string;
  parentId?: number | string;
  data?: { url?: string; title?: string };
  timestamp: number;
  resolved: boolean;
}

export interface LogEntry {
  timestamp: number;
  type: "info" | "success" | "error" | "warning";
  message: string;
}

export interface StorageData {
  sync_metadata: SyncMetadata | null;
  mappings: Mapping[];
  pending_changes: PendingChange[];
  settings: {
    serverUrl: string;
    accessToken: string;
    syncInterval: number; // minutes
    targetCollectionName: string; // case-sensitive Linkwarden collection name (supports paths)
    browserFolderName: string; // browser bookmark folder name (supports paths)
  } | null;
  sync_log: LogEntry[];
}

const DEFAULT_STORAGE: StorageData = {
  sync_metadata: null,
  mappings: [],
  pending_changes: [],
  settings: null,
  sync_log: [],
};

/**
 * Get all storage data
 */
export async function getAll(): Promise<StorageData> {
  return new Promise((resolve) => {
    chrome.storage.local.get(
      ["sync_metadata", "mappings", "pending_changes", "settings", "sync_log"],
      (result) => {
        resolve({
          sync_metadata: result.sync_metadata || null,
          mappings: result.mappings || [],
          pending_changes: result.pending_changes || [],
          settings: result.settings || null,
          sync_log: result.sync_log || [],
        });
      }
    );
  });
}

/**
 * Save all storage data
 */
export async function saveAll(data: StorageData): Promise<void> {
  return new Promise((resolve, reject) => {
    logger.debug("Saving:", {
      hasMetadata: !!data.sync_metadata,
      mappingsCount: data.mappings.length,
      hasSettings: !!data.settings,
      syncLogCount: data.sync_log.length,
    });

    chrome.storage.local.set(
      {
        sync_metadata: data.sync_metadata,
        mappings: data.mappings,
        pending_changes: data.pending_changes,
        settings: data.settings,
        sync_log: data.sync_log,
      },
      () => {
        if (chrome.runtime.lastError) {
          logger.error("Save error:", chrome.runtime.lastError);
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          logger.debug("Save successful");
          resolve();
        }
      }
    );
  });
}

/**
 * Get sync metadata
 */
export async function getSyncMetadata(): Promise<SyncMetadata | null> {
  const data = await getAll();
  return data.sync_metadata;
}

/**
 * Save sync metadata
 */
export async function saveSyncMetadata(metadata: SyncMetadata): Promise<void> {
  const data = await getAll();
  data.sync_metadata = metadata;
  await saveAll(data);
}

/**
 * Get all mappings
 */
export async function getMappings(): Promise<Mapping[]> {
  const data = await getAll();
  return data.mappings;
}

/**
 * Find mapping by Linkwarden ID
 */
export async function getMappingByLinkwardenId(
  linkwardenId: number,
  type?: "link" | "collection"
): Promise<Mapping | undefined> {
  const mappings = await getMappings();
  return mappings.find(
    (m) =>
      m.linkwardenId === linkwardenId && (!type || m.linkwardenType === type)
  );
}

/**
 * Find mapping by browser ID
 */
export async function getMappingByBrowserId(
  browserId: string
): Promise<Mapping | undefined> {
  const mappings = await getMappings();
  return mappings.find((m) => m.browserId === browserId);
}

/**
 * Add or update a mapping
 */
export async function upsertMapping(mapping: Mapping): Promise<void> {
  const data = await getAll();
  const existingIndex = data.mappings.findIndex(
    (m) =>
      m.linkwardenId === mapping.linkwardenId &&
      m.linkwardenType === mapping.linkwardenType
  );

  if (existingIndex >= 0) {
    data.mappings[existingIndex] = mapping;
  } else {
    data.mappings.push(mapping);
  }

  await saveAll(data);
}

/**
 * Remove a mapping by Linkwarden ID
 */
export async function removeMapping(
  linkwardenId: number,
  type?: "link" | "collection"
): Promise<void> {
  const data = await getAll();
  data.mappings = data.mappings.filter(
    (m) =>
      !(m.linkwardenId === linkwardenId && (!type || m.linkwardenType === type))
  );
  await saveAll(data);
}

/**
 * Get all pending changes
 */
export async function getPendingChanges(): Promise<PendingChange[]> {
  const data = await getAll();
  return data.pending_changes;
}

/**
 * Add a pending change
 */
export async function addPendingChange(change: PendingChange): Promise<void> {
  const data = await getAll();
  data.pending_changes.push(change);
  await saveAll(data);
}

/**
 * Mark a pending change as resolved
 */
export async function resolvePendingChange(id: string): Promise<void> {
  const data = await getAll();
  const change = data.pending_changes.find((c) => c.id === id);
  if (change) {
    change.resolved = true;
    await saveAll(data);
  }
}

/**
 * Remove resolved pending changes
 */
export async function cleanupResolvedChanges(): Promise<void> {
  const data = await getAll();
  data.pending_changes = data.pending_changes.filter((c) => !c.resolved);
  await saveAll(data);
}

/**
 * Get settings
 */
export async function getSettings(): Promise<{
  serverUrl: string;
  accessToken: string;
  syncInterval: number;
  targetCollectionName: string;
} | null> {
  const data = await getAll();
  return data.settings;
}

/**
 * Save settings
 */
export async function saveSettings(settings: {
  serverUrl: string;
  accessToken: string;
  syncInterval: number;
  targetCollectionName?: string;
  browserFolderName?: string;
}): Promise<void> {
  const data = await getAll();
  data.settings = {
    serverUrl: settings.serverUrl,
    accessToken: settings.accessToken,
    syncInterval: settings.syncInterval,
    targetCollectionName:
      settings.targetCollectionName || getDefaultCollectionName(),
    browserFolderName: settings.browserFolderName || "",
  };
  await saveAll(data);
}

/**
 * Clear all storage data (for reset)
 */
export async function clearAll(): Promise<void> {
  await saveAll(DEFAULT_STORAGE);
}

/**
 * Get storage usage in bytes
 */
export async function getStorageUsage(): Promise<number> {
  return new Promise((resolve) => {
    chrome.storage.local.getBytesInUse((bytes) => {
      resolve(bytes);
    });
  });
}

const MAX_LOG_ENTRIES = 100;

/**
 * Get sync log
 */
export async function getSyncLog(): Promise<LogEntry[]> {
  const data = await getAll();
  return data.sync_log;
}

/**
 * Add entry to sync log
 */
export async function addLogEntry(
  type: "info" | "success" | "error" | "warning",
  message: string
): Promise<void> {
  const data = await getAll();
  data.sync_log.push({
    timestamp: Date.now(),
    type,
    message,
  });

  // Trim to max entries
  if (data.sync_log.length > MAX_LOG_ENTRIES) {
    data.sync_log = data.sync_log.slice(data.sync_log.length - MAX_LOG_ENTRIES);
  }

  await saveAll(data);
}

/**
 * Clear sync log
 */
export async function clearSyncLog(): Promise<void> {
  const data = await getAll();
  data.sync_log = [];
  await saveAll(data);
}
