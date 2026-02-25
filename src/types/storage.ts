/**
 * Storage Types
 * Type definitions for chrome.storage.local schema
 */

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

export interface Settings {
  serverUrl: string;
  accessToken: string;
  syncInterval: number;
  targetCollectionName: string;
  browserFolderName: string;
}

export interface StorageData {
  sync_metadata: SyncMetadata | null;
  mappings: Mapping[];
  pending_changes: PendingChange[];
  settings: Settings | null;
  sync_log: LogEntry[];
}
