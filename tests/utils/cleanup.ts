/**
 * Cleanup utility functions for test teardown
 */

/**
 * Clear all data from mock storage
 */
export function clearStorage(mockStorage: Record<string, unknown>): void {
  Object.keys(mockStorage).forEach((key) => {
    delete mockStorage[key];
  });
}

/**
 * Clear all data from mock bookmarks
 */
export function clearBookmarks(mockBookmarks: Record<string, unknown>): void {
  Object.keys(mockBookmarks).forEach((key) => {
    delete mockBookmarks[key];
  });
}

/**
 * Clear all data from mock Linkwarden API
 */
export function clearLinkwardenAPI(mockApi: {
  clear?: () => void;
  clearCollections?: () => void;
}): void {
  if (mockApi.clear) {
    mockApi.clear();
  } else if (mockApi.clearCollections) {
    mockApi.clearCollections();
  }
}

/**
 * Delete global chrome object
 */
export function cleanupChromeGlobal(): void {
  delete (globalThis as Record<string, unknown>).chrome;
}

/**
 * Full cleanup for all mocks
 */
export function fullCleanup(cleanupTargets: {
  mockStorage?: Record<string, unknown>;
  mockBookmarks?: Record<string, unknown>;
  mockApi?: { clear?: () => void; clearCollections?: () => void };
}): void {
  if (cleanupTargets.mockStorage) {
    clearStorage(cleanupTargets.mockStorage);
  }
  if (cleanupTargets.mockBookmarks) {
    clearBookmarks(cleanupTargets.mockBookmarks);
  }
  if (cleanupTargets.mockApi) {
    clearLinkwardenAPI(cleanupTargets.mockApi);
  }
}
