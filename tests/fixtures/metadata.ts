/**
 * Test data factories for SyncMetadata objects
 */

import type { SyncMetadata } from "../../src/storage";

/**
 * Create SyncMetadata with sensible defaults
 */
export function createSyncMetadata(
  overrides: Partial<SyncMetadata> = {}
): SyncMetadata {
  return {
    id: "sync_state",
    lastSyncTime: Date.now(),
    syncDirection: "bidirectional",
    targetCollectionId: 1,
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
