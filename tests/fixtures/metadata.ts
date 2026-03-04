/**
 * Test data factories for SyncMetadata objects
 *
 * Default target collection ID is 114 ("Unorganized") for consistency.
 */

import type { SyncMetadata, Settings } from "../../src/storage";

/**
 * Create SyncMetadata with sensible defaults
 * Default target collection is 114 ("Unorganized")
 */
export function createSyncMetadata(
  overrides: Partial<SyncMetadata> = {}
): SyncMetadata {
  return {
    id: "sync_state",
    lastSyncTime: Date.now(),
    syncDirection: "bidirectional",
    targetCollectionId: 114,
    browserRootFolderId: "1",
    ...overrides,
  };
}

/**
 * Create SyncMetadata for initial sync (no lastSyncTime)
 */
export function createInitialSyncMetadata(
  overrides: Partial<SyncMetadata> = {}
): SyncMetadata {
  return createSyncMetadata({
    lastSyncTime: undefined,
    ...overrides,
  }) as SyncMetadata;
}

/**
 * Create Settings with sensible defaults
 */
export function createSettings(overrides: Partial<Settings> = {}): Settings {
  return {
    serverUrl: "https://test.example.com",
    accessToken: "test-token",
    syncInterval: 5,
    targetCollectionId: undefined,
    targetCollectionName: "Bookmarks",
    browserFolderName: "",
    ...overrides,
  };
}
