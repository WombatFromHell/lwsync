/**
 * Storage Types
 * Type definitions for chrome.storage.local schema
 */

// Re-export storage keys from config for backward compatibility
export { StorageKey, getAllStorageKeys } from "../config";

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
  browserIndex?: number; // Track position in parent folder for order restoration
}

export interface PendingChange {
  id: string;
  type: "create" | "update" | "delete" | "move";
  source: "linkwarden" | "browser";
  linkwardenId?: number;
  browserId?: string;
  parentId?: number | string;
  index?: number; // Position in parent (for reorder operations)
  oldParentId?: number | string; // Previous parent (to detect reorder vs move)
  oldIndex?: number; // Previous position (for reorder operations)
  data?: { url?: string; title?: string };
  timestamp: number;
  resolved: boolean;
}

export interface LogEntry {
  timestamp: number;
  type: "info" | "success" | "error" | "warning";
  message: string;
}

export interface Settings {
  serverUrl: string;
  accessToken: string;
  syncInterval: number;
  /** Collection ID (preferred - unique and unambiguous) */
  targetCollectionId?: number;
  /** Collection name (fallback if ID not provided) */
  targetCollectionName?: string;
  browserFolderName: string;
}

export interface SectionState {
  [key: string]: boolean; // sectionId: isExpanded
}

export interface StorageData {
  sync_metadata: SyncMetadata | null;
  mappings: Mapping[];
  pending_changes: PendingChange[];
  settings: Settings | null;
  sync_log: LogEntry[];
  section_state: SectionState | null;
}
