/**
 * Background Service Worker Types
 * Message types for type-safe message passing between background and popup
 */

export interface SaveSettingsMessage {
  serverUrl: string;
  accessToken: string;
  syncInterval: number;
  targetCollectionName?: string;
  browserFolderName?: string;
}

export interface UpdateSyncIntervalMessage {
  syncInterval: number;
}

export interface UpdateTargetCollectionMessage {
  targetCollectionName: string;
}

export interface UpdateBrowserFolderMessage {
  browserFolderName: string;
}

export interface TestConnectionMessage {
  serverUrl: string;
  token: string;
}

export interface MessageMap {
  GET_STATUS: never;
  START_SYNC: never;
  SAVE_SETTINGS: SaveSettingsMessage;
  GET_SETTINGS: never;
  TEST_CONNECTION: TestConnectionMessage;
  RESET_SYNC: never;
  GET_STORAGE_USAGE: never;
  CLEAR_LOG: never;
  EXPORT_LOGS: never;
  UPDATE_SYNC_INTERVAL: UpdateSyncIntervalMessage;
  UPDATE_TARGET_COLLECTION: UpdateTargetCollectionMessage;
  UPDATE_BROWSER_FOLDER: UpdateBrowserFolderMessage;
  COMPARE_SYNC: never;
  GET_DIAGNOSTICS: never;
}

export type MessageType = keyof MessageMap;

export interface ChromeMessage<T extends MessageType> {
  type: T;
  payload?: MessageMap[T];
}

export interface DiagnosticsResult {
  settings: {
    serverUrl: string;
    targetCollectionName: string;
    browserFolderName: string;
    syncInterval: number;
  };
  metadata:
    | {
        targetCollectionId: number;
        browserRootFolderId: string;
        lastSyncTime: string;
      }
    | string;
  issue: string;
}
