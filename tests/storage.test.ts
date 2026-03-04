/**
 * Unit tests for storage wrapper
 * Tests chrome.storage.local abstraction layer
 *
 * Run with: bun test tests/storage.test.ts
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import * as storage from "../src/storage";
import { setupBrowserMocks, cleanupBrowserMocks } from "./mocks/browser";
import { createMapping, createCollectionMapping } from "./fixtures/mapping";
import { createSyncMetadata } from "./fixtures/metadata";
import { createPendingChange } from "./fixtures/change";
import { getTestCollectionName } from "./utils/config";

let mocks: ReturnType<typeof setupBrowserMocks>;

beforeEach(() => {
  mocks = setupBrowserMocks();
});

afterEach(() => {
  cleanupBrowserMocks();
});

describe("Storage: getAll/saveAll", () => {
  test("should return default values when storage is empty", async () => {
    const data = await storage.getAll();

    expect(data.sync_metadata).toBeNull();
    expect(data.mappings).toEqual([]);
    expect(data.pending_changes).toEqual([]);
    expect(data.settings).toBeNull();
  });

  test("should save and retrieve all data", async () => {
    const testData = {
      sync_metadata: createSyncMetadata({
        lastSyncTime: 1234567890,
        targetCollectionId: 42,
        browserRootFolderId: "folder-1",
      }),
      mappings: [
        createMapping({
          linkwardenId: 1,
          browserId: "bookmark-1",
          checksum: "abc123",
        }),
      ],
      pending_changes: [],
      settings: {
        serverUrl: "https://example.com",
        accessToken: "token123",
        syncInterval: 5,
        targetCollectionName: getTestCollectionName(),
        browserFolderName: "Other Bookmarks",
      },
      sync_log: [
        {
          timestamp: 1234567890,
          type: "info" as const,
          message: "Test log entry",
        },
      ],
      section_state: {
        "server-config": true,
        "common-settings": false,
      },
    };

    await storage.saveAll(testData);
    const retrieved = await storage.getAll();

    expect(retrieved.sync_metadata).toEqual(testData.sync_metadata);
    expect(retrieved.mappings).toEqual(testData.mappings);
    expect(retrieved.settings).toEqual(testData.settings);
    expect(retrieved.sync_log).toEqual(testData.sync_log);
    expect(retrieved.section_state).toEqual(testData.section_state);
  });
});

describe("Storage: Sync Metadata", () => {
  test("should save and retrieve sync metadata", async () => {
    const metadata = createSyncMetadata({
      lastSyncTime: 1234567890,
      targetCollectionId: 42,
      browserRootFolderId: "folder-1",
    });

    await storage.saveSyncMetadata(metadata);
    const retrieved = await storage.getSyncMetadata();

    expect(retrieved).toEqual(metadata);
  });

  test("should return null when no metadata exists", async () => {
    const metadata = await storage.getSyncMetadata();
    expect(metadata).toBeNull();
  });

  test("should update existing metadata", async () => {
    const initial = createSyncMetadata({ lastSyncTime: 1000 });

    await storage.saveSyncMetadata(initial);

    const updated = createSyncMetadata({ lastSyncTime: 2000 });

    await storage.saveSyncMetadata(updated);
    const retrieved = await storage.getSyncMetadata();

    expect(retrieved?.lastSyncTime).toBe(2000);
    expect(retrieved?.targetCollectionId).toBe(initial.targetCollectionId); // Unchanged
  });
});

describe("Storage: Mappings", () => {
  test("should return empty array when no mappings exist", async () => {
    const mappings = await storage.getMappings();
    expect(mappings).toEqual([]);
  });

  test("should add and retrieve a mapping", async () => {
    const mapping = createMapping({
      linkwardenId: 1,
      browserId: "bookmark-1",
      checksum: "abc123",
    });

    await storage.upsertMapping(mapping);
    const mappings = await storage.getMappings();

    expect(mappings.length).toBe(1);
    expect(mappings[0]).toEqual(mapping);
  });

  test("should update existing mapping (upsert)", async () => {
    const mapping1 = createMapping({
      linkwardenId: 1,
      browserId: "bookmark-1",
      checksum: "abc123",
    });

    const mapping2 = createMapping({
      id: mapping1.id,
      linkwardenId: mapping1.linkwardenId,
      browserId: mapping1.browserId,
      checksum: "updated",
      lastSyncedAt: 3000,
    });

    await storage.upsertMapping(mapping1);
    await storage.upsertMapping(mapping2);
    const mappings = await storage.getMappings();

    expect(mappings.length).toBe(1); // Should not duplicate
    expect(mappings[0].checksum).toBe("updated");
    expect(mappings[0].lastSyncedAt).toBe(3000);
  });

  test("should find mapping by Linkwarden ID", async () => {
    await storage.upsertMapping(
      createMapping({
        linkwardenId: 1,
        browserId: "bookmark-1",
        checksum: "abc",
      })
    );

    await storage.upsertMapping(
      createCollectionMapping({
        linkwardenId: 2,
        browserId: "folder-1",
        checksum: "def",
      })
    );

    const found = await storage.getMappingByLinkwardenId(1, "link");
    expect(found).toBeDefined();
    expect(found?.linkwardenId).toBe(1);
  });

  test("should find mapping by browser ID", async () => {
    const mapping = createMapping({
      linkwardenId: 1,
      browserId: "bookmark-1",
      checksum: "abc",
    });

    await storage.upsertMapping(mapping);

    const found = await storage.getMappingByBrowserId("bookmark-1");
    expect(found).toBeDefined();
    expect(found?.browserId).toBe("bookmark-1");
  });

  test("should remove mapping by Linkwarden ID", async () => {
    const mapping = createMapping({
      linkwardenId: 1,
      browserId: "bookmark-1",
      checksum: "abc",
    });

    await storage.upsertMapping(mapping);
    await storage.removeMapping(1, "link");
    const mappings = await storage.getMappings();

    expect(mappings.length).toBe(0);
  });

  test("should handle multiple mappings", async () => {
    const mappings = [
      createMapping({
        linkwardenId: 1,
        browserId: "bookmark-1",
        checksum: "abc",
      }),
      createMapping({
        linkwardenId: 2,
        browserId: "bookmark-2",
        checksum: "def",
      }),
      createCollectionMapping({
        linkwardenId: 3,
        browserId: "folder-1",
        checksum: "ghi",
      }),
    ];

    for (const mapping of mappings) {
      await storage.upsertMapping(mapping);
    }

    const retrieved = await storage.getMappings();
    expect(retrieved.length).toBe(3);
  });
});

describe("Storage: Pending Changes", () => {
  test("should return empty array when no pending changes", async () => {
    const changes = await storage.getPendingChanges();
    expect(changes).toEqual([]);
  });

  test("should add pending change", async () => {
    const change = createPendingChange({
      type: "create",
      source: "browser",
      browserId: "bookmark-1",
    });

    await storage.addPendingChange(change);
    const changes = await storage.getPendingChanges();

    expect(changes.length).toBe(1);
    expect(changes[0]).toEqual(change);
  });

  test("should mark change as resolved", async () => {
    const change = createPendingChange({
      type: "update",
      source: "browser",
      browserId: "bookmark-1",
    });

    await storage.addPendingChange(change);
    await storage.resolvePendingChange(change.id);

    const changes = await storage.getPendingChanges();
    expect(changes[0].resolved).toBe(true);
  });

  test("should cleanup resolved changes", async () => {
    await storage.addPendingChange(
      createPendingChange({
        id: "change-1",
        type: "create",
        source: "browser",
        browserId: "bookmark-1",
        resolved: false,
      })
    );

    await storage.addPendingChange(
      createPendingChange({
        id: "change-2",
        type: "delete",
        source: "browser",
        browserId: "bookmark-2",
        resolved: true, // Already resolved
      })
    );

    await storage.cleanupResolvedChanges();
    const changes = await storage.getPendingChanges();

    expect(changes.length).toBe(1);
    expect(changes[0].id).toBe("change-1");
  });
});

describe("Storage: Settings", () => {
  test("should return null when no settings exist", async () => {
    const settings = await storage.getSettings();
    expect(settings).toBeNull();
  });

  test("should save and retrieve settings", async () => {
    const settings = {
      serverUrl: "https://linkwarden.example.com",
      accessToken: "secret-token-123",
      syncInterval: 10,
      targetCollectionName: getTestCollectionName(),
      browserFolderName: "Other Bookmarks",
    };

    await storage.saveSettings(settings);
    const retrieved = await storage.getSettings();

    expect(retrieved).toEqual(settings);
  });

  test("should update existing settings", async () => {
    const initial = {
      serverUrl: "https://original.com",
      accessToken: "token1",
      syncInterval: 5,
      targetCollectionName: getTestCollectionName(),
      browserFolderName: "Other Bookmarks",
    };

    await storage.saveSettings(initial);

    const updated = {
      ...initial,
      syncInterval: 15,
    };

    await storage.saveSettings(updated);
    const retrieved = await storage.getSettings();

    expect(retrieved?.syncInterval).toBe(15);
    expect(retrieved?.serverUrl).toBe("https://original.com");
  });
});

describe("Storage: Clear All", () => {
  test("should reset storage to default state", async () => {
    await storage.saveSyncMetadata(
      createSyncMetadata({
        lastSyncTime: 1234567890,
        targetCollectionId: 42,
        browserRootFolderId: "folder-1",
      })
    );

    await storage.upsertMapping(
      createMapping({
        linkwardenId: 1,
        browserId: "bookmark-1",
        checksum: "abc",
      })
    );

    await storage.saveSettings({
      serverUrl: "https://example.com",
      accessToken: "token",
      syncInterval: 5,
      targetCollectionName: getTestCollectionName(),
      browserFolderName: "Other Bookmarks",
    });

    await storage.clearAll();
    const data = await storage.getAll();

    expect(data.sync_metadata).toBeNull();
    expect(data.mappings).toEqual([]);
    expect(data.pending_changes).toEqual([]);
    expect(data.settings).toBeNull();
  });
});

describe("Storage: Storage Usage", () => {
  test("should return bytes in use", async () => {
    const bytes = await storage.getStorageUsage();
    expect(typeof bytes).toBe("number");
    expect(bytes).toBeGreaterThanOrEqual(0);
  });
});
