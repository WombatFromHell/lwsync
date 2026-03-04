/**
 * Storage wrapper using chrome.storage.local with unlimitedStorage permission
 * Provides a simple key-value interface for sync state, mappings, and pending changes
 */

import { createLogger } from "../utils";
import { getDefaultCollectionName } from "../browser";
import { CONFIG, getAllStorageKeys } from "../config";
import type {
  SyncMetadata,
  Mapping,
  PendingChange,
  LogEntry,
  Settings,
  StorageData,
  SectionState,
} from "../types/storage";
export type {
  SyncMetadata,
  Mapping,
  PendingChange,
  LogEntry,
  Settings,
  StorageData,
  SectionState,
} from "../types/storage";

const logger = createLogger("LWSync storage");

const DEFAULT_STORAGE: StorageData = {
  sync_metadata: null,
  mappings: [],
  pending_changes: [],
  settings: null,
  sync_log: [],
  section_state: {},
};

/**
 * Get all storage data
 */
export async function getAll(): Promise<StorageData> {
  return new Promise((resolve) => {
    chrome.storage.local.get(getAllStorageKeys(), (result) => {
      resolve({
        sync_metadata:
          (result[CONFIG.storage.KEY_SYNC_METADATA] as SyncMetadata) || null,
        mappings: (result[CONFIG.storage.KEY_MAPPINGS] as Mapping[]) || [],
        pending_changes:
          (result[CONFIG.storage.KEY_PENDING_CHANGES] as PendingChange[]) || [],
        settings: (result[CONFIG.storage.KEY_SETTINGS] as Settings) || null,
        sync_log: (result[CONFIG.storage.KEY_SYNC_LOG] as LogEntry[]) || [],
        section_state:
          (result[CONFIG.storage.KEY_SECTION_STATE] as SectionState) || {},
      });
    });
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
        [CONFIG.storage.KEY_SYNC_METADATA]: data.sync_metadata,
        [CONFIG.storage.KEY_MAPPINGS]: data.mappings,
        [CONFIG.storage.KEY_PENDING_CHANGES]: data.pending_changes,
        [CONFIG.storage.KEY_SETTINGS]: data.settings,
        [CONFIG.storage.KEY_SYNC_LOG]: data.sync_log,
        [CONFIG.storage.KEY_SECTION_STATE]: data.section_state,
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
export async function getSettings(): Promise<Settings | null> {
  const data = await getAll();
  return data.settings;
}

/**
 * Save settings
 */
export async function saveSettings(settings: Settings): Promise<void> {
  const data = await getAll();
  data.settings = {
    serverUrl: settings.serverUrl,
    accessToken: settings.accessToken,
    syncInterval: settings.syncInterval,
    // Preserve both ID and name - ID takes precedence
    targetCollectionId: settings.targetCollectionId,
    targetCollectionName: settings.targetCollectionName,
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

const MAX_LOG_ENTRIES = CONFIG.sync.MAX_LOG_ENTRIES;

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

/**
 * Get section collapse/expand state
 */
export async function getSectionState(): Promise<SectionState> {
  const data = await getAll();
  return data.section_state || {};
}

/**
 * Save section collapse/expand state
 */
export async function saveSectionState(state: SectionState): Promise<void> {
  const data = await getAll();
  data.section_state = state;
  await saveAll(data);
}

/**
 * Toggle section expand/collapse state
 */
export async function toggleSection(sectionId: string): Promise<boolean> {
  const data = await getAll();
  const currentState = data.section_state || {};
  const newState = !currentState[sectionId];
  currentState[sectionId] = newState;
  data.section_state = currentState;
  await saveAll(data);
  return newState;
}
