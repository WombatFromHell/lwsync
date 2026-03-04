/**
 * Comparison Test Fixtures
 * Factories for creating sync comparison test data
 */

import type {
  BookmarkToUpload,
  LinkToDownload,
  SyncedPair,
  Conflict,
  SyncComparison,
  ComparisonSummary,
} from "../../src/types/comparator";
import { uniqueUrl, uniqueTitle, timestamp } from "../utils/generators";

/**
 * Create a BookmarkToUpload fixture
 */
export function createBookmarkToUpload(
  overrides?: Partial<BookmarkToUpload>
): BookmarkToUpload {
  return {
    browserId: `bookmark-${timestamp()}`,
    browserPath: `/Bookmarks/${uniqueTitle("Folder")}`,
    browserParentId: "1",
    title: uniqueTitle("Bookmark"),
    url: uniqueUrl(),
    reason: "unmapped",
    checksum: `checksum-${timestamp()}`,
    dateAdded: timestamp(),
    dateModified: timestamp(),
    ...overrides,
  };
}

/**
 * Create a LinkToDownload fixture
 */
export function createLinkToDownload(
  overrides?: Partial<LinkToDownload>
): LinkToDownload {
  return {
    linkwardenId: Math.floor(Math.random() * 10000),
    linkwardenPath: `/Favorites/${uniqueTitle("Subcollection")}`,
    linkwardenParentId: 1,
    title: uniqueTitle("Link"),
    url: uniqueUrl(),
    reason: "unmapped",
    checksum: `checksum-${timestamp()}`,
    createdAt: new Date(timestamp()).toISOString(),
    updatedAt: new Date(timestamp()).toISOString(),
    ...overrides,
  };
}

/**
 * Create a SyncedPair fixture
 */
export function createSyncedPair(overrides?: Partial<SyncedPair>): SyncedPair {
  return {
    browserId: `bookmark-${timestamp()}`,
    browserPath: `/Bookmarks/${uniqueTitle("Folder")}`,
    linkwardenId: Math.floor(Math.random() * 10000),
    linkwardenPath: `/Favorites/${uniqueTitle("Subcollection")}`,
    title: uniqueTitle("Synced"),
    url: uniqueUrl(),
    lastSyncedAt: timestamp(-60000), // 1 minute ago
    checksumMatch: true,
    browserChecksum: `checksum-${timestamp()}`,
    serverChecksum: `checksum-${timestamp()}`,
    ...overrides,
  };
}

/**
 * Create a Conflict fixture
 */
export function createConflict(overrides?: Partial<Conflict>): Conflict {
  const browserTime = timestamp(-30000); // 30 seconds ago
  const serverTime = timestamp(-60000); // 1 minute ago

  return {
    browserId: `bookmark-${timestamp()}`,
    linkwardenId: Math.floor(Math.random() * 10000),
    url: uniqueUrl(),
    browserTitle: uniqueTitle("Browser"),
    serverTitle: uniqueTitle("Server"),
    browserModifiedAt: browserTime,
    serverModifiedAt: serverTime,
    browserChecksum: `checksum-browser-${timestamp()}`,
    serverChecksum: `checksum-server-${timestamp()}`,
    winner: "browser",
    reason: "Browser modified more recently",
    ...overrides,
  };
}

/**
 * Create a SyncComparison fixture
 */
export function createSyncComparison(
  overrides?: Partial<SyncComparison>
): SyncComparison {
  const toUpload = overrides?.toUpload || [];
  const toDownload = overrides?.toDownload || [];
  const synced = overrides?.synced || [];
  const conflicts = overrides?.conflicts || [];

  const summary: ComparisonSummary = {
    browserTotal: toUpload.length + synced.length + conflicts.length,
    serverTotal: toDownload.length + synced.length + conflicts.length,
    toUploadCount: toUpload.length,
    toDownloadCount: toDownload.length,
    syncedCount: synced.length,
    conflictCount: conflicts.length,
    skippedCount: 0,
    estimatedSyncTime: toUpload.length * 500 + toDownload.length * 200,
    ...overrides?.summary,
  };

  return {
    timestamp: timestamp(),
    browserRootId: "1",
    serverCollectionId: 1,
    serverCollectionName: "Favorites",
    toUpload,
    toDownload,
    synced,
    conflicts,
    summary,
    ...overrides,
  };
}

/**
 * Create a scenario with browser having extra bookmarks
 */
export function createBrowserExtraScenario(): SyncComparison {
  const sharedUrl = uniqueUrl();
  const sharedTitle = uniqueTitle("Shared");

  return createSyncComparison({
    toUpload: [
      createBookmarkToUpload({
        title: uniqueTitle("Browser Only 1"),
        url: uniqueUrl(),
      }),
      createBookmarkToUpload({
        title: uniqueTitle("Browser Only 2"),
        url: uniqueUrl(),
      }),
    ],
    synced: [
      createSyncedPair({
        title: sharedTitle,
        url: sharedUrl,
        checksumMatch: true,
      }),
    ],
  });
}

/**
 * Create a scenario with server having extra links
 */
export function createServerExtraScenario(): SyncComparison {
  const sharedUrl = uniqueUrl();
  const sharedTitle = uniqueTitle("Shared");

  return createSyncComparison({
    toDownload: [
      createLinkToDownload({
        title: uniqueTitle("Server Only 1"),
        url: uniqueUrl(),
      }),
      createLinkToDownload({
        title: uniqueTitle("Server Only 2"),
        url: uniqueUrl(),
      }),
    ],
    synced: [
      createSyncedPair({
        title: sharedTitle,
        url: sharedUrl,
        checksumMatch: true,
      }),
    ],
  });
}

/**
 * Create a scenario with conflicts
 */
export function createConflictScenario(): SyncComparison {
  return createSyncComparison({
    conflicts: [
      createConflict({
        browserTitle: "Browser Version",
        serverTitle: "Server Version",
        winner: "browser",
      }),
      createConflict({
        browserTitle: "Newer Browser",
        serverTitle: "Older Server",
        winner: "browser",
      }),
    ],
    synced: [
      createSyncedPair({
        title: uniqueTitle("No Conflict"),
        checksumMatch: true,
      }),
    ],
  });
}

/**
 * Create a scenario with all categories
 */
export function createMixedScenario(): SyncComparison {
  return createSyncComparison({
    toUpload: [
      createBookmarkToUpload(),
      createBookmarkToUpload(),
      createBookmarkToUpload(),
    ],
    toDownload: [createLinkToDownload(), createLinkToDownload()],
    synced: [
      createSyncedPair(),
      createSyncedPair(),
      createSyncedPair(),
      createSyncedPair(),
    ],
    conflicts: [createConflict()],
  });
}

/**
 * Create an empty/in-sync scenario
 */
export function createInSyncScenario(): SyncComparison {
  return createSyncComparison({
    toUpload: [],
    toDownload: [],
    conflicts: [],
    synced: [createSyncedPair(), createSyncedPair(), createSyncedPair()],
  });
}
