/**
 * Unit tests for storage wrapper
 * Tests chrome.storage.local abstraction layer
 *
 * Run with: bun test tests/storage.test.ts
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import * as storage from "../src/storage";

// Mock chrome.storage.local
const mockStorage: Record<string, unknown> = {};

// @ts-expect-error - Mock for testing
globalThis.chrome = {
  storage: {
    local: {
      get: (
        keys: string[],
        callback: (result: Record<string, unknown>) => void
      ) => {
        const result: Record<string, unknown> = {};
        for (const key of keys) {
          result[key] = mockStorage[key];
        }
        setTimeout(() => callback(result), 0);
      },
      set: (items: Record<string, unknown>, callback?: () => void) => {
        Object.assign(mockStorage, items);
        if (callback) setTimeout(() => callback(), 0);
      },
      getBytesInUse: (callback: (bytes: number) => void) => {
        setTimeout(() => callback(0), 0);
      },
    },
  },
  runtime: {
    lastError: null,
  },
};

beforeEach(() => {
  Object.keys(mockStorage).forEach((key) => delete mockStorage[key]);
});

afterEach(() => {
  Object.keys(mockStorage).forEach((key) => delete mockStorage[key]);
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
      sync_metadata: {
        id: "sync_state" as const,
        lastSyncTime: 1234567890,
        syncDirection: "bidirectional" as const,
        targetCollectionId: 42,
        browserRootFolderId: "folder-1",
      },
      mappings: [
        {
          id: "mapping-1",
          linkwardenType: "link" as const,
          linkwardenId: 1,
          browserId: "bookmark-1",
          linkwardenUpdatedAt: 1000,
          browserUpdatedAt: 2000,
          lastSyncedAt: 1500,
          checksum: "abc123",
        },
      ],
      pending_changes: [],
      settings: {
        serverUrl: "https://example.com",
        accessToken: "token123",
        syncInterval: 5,
      },
      sync_log: [
        {
          timestamp: 1234567890,
          type: "info" as const,
          message: "Test log entry",
        },
      ],
    };

    await storage.saveAll(testData);
    const retrieved = await storage.getAll();

    expect(retrieved.sync_metadata).toEqual(testData.sync_metadata);
    expect(retrieved.mappings).toEqual(testData.mappings);
    expect(retrieved.settings).toEqual(testData.settings);
    expect(retrieved.sync_log).toEqual(testData.sync_log);
  });
});

describe("Storage: Sync Metadata", () => {
  test("should save and retrieve sync metadata", async () => {
    const metadata = {
      id: "sync_state" as const,
      lastSyncTime: 1234567890,
      syncDirection: "bidirectional" as const,
      targetCollectionId: 42,
      browserRootFolderId: "folder-1",
    };

    await storage.saveSyncMetadata(metadata);
    const retrieved = await storage.getSyncMetadata();

    expect(retrieved).toEqual(metadata);
  });

  test("should return null when no metadata exists", async () => {
    const metadata = await storage.getSyncMetadata();
    expect(metadata).toBeNull();
  });

  test("should update existing metadata", async () => {
    const initial = {
      id: "sync_state" as const,
      lastSyncTime: 1000,
      syncDirection: "bidirectional" as const,
      targetCollectionId: 42,
      browserRootFolderId: "folder-1",
    };

    await storage.saveSyncMetadata(initial);

    const updated = {
      ...initial,
      lastSyncTime: 2000,
    };

    await storage.saveSyncMetadata(updated);
    const retrieved = await storage.getSyncMetadata();

    expect(retrieved?.lastSyncTime).toBe(2000);
    expect(retrieved?.targetCollectionId).toBe(42); // Unchanged
  });
});

describe("Storage: Mappings", () => {
  test("should return empty array when no mappings exist", async () => {
    const mappings = await storage.getMappings();
    expect(mappings).toEqual([]);
  });

  test("should add and retrieve a mapping", async () => {
    const mapping = {
      id: "mapping-1",
      linkwardenType: "link" as const,
      linkwardenId: 1,
      browserId: "bookmark-1",
      linkwardenUpdatedAt: 1000,
      browserUpdatedAt: 2000,
      lastSyncedAt: 1500,
      checksum: "abc123",
    };

    await storage.upsertMapping(mapping);
    const mappings = await storage.getMappings();

    expect(mappings.length).toBe(1);
    expect(mappings[0]).toEqual(mapping);
  });

  test("should update existing mapping (upsert)", async () => {
    const mapping1 = {
      id: "mapping-1",
      linkwardenType: "link" as const,
      linkwardenId: 1,
      browserId: "bookmark-1",
      linkwardenUpdatedAt: 1000,
      browserUpdatedAt: 2000,
      lastSyncedAt: 1500,
      checksum: "abc123",
    };

    const mapping2 = {
      ...mapping1,
      checksum: "updated",
      lastSyncedAt: 3000,
    };

    await storage.upsertMapping(mapping1);
    await storage.upsertMapping(mapping2);
    const mappings = await storage.getMappings();

    expect(mappings.length).toBe(1); // Should not duplicate
    expect(mappings[0].checksum).toBe("updated");
    expect(mappings[0].lastSyncedAt).toBe(3000);
  });

  test("should find mapping by Linkwarden ID", async () => {
    await storage.upsertMapping({
      id: "mapping-1",
      linkwardenType: "link" as const,
      linkwardenId: 1,
      browserId: "bookmark-1",
      linkwardenUpdatedAt: 1000,
      browserUpdatedAt: 2000,
      lastSyncedAt: 1500,
      checksum: "abc",
    });

    await storage.upsertMapping({
      id: "mapping-2",
      linkwardenType: "collection" as const,
      linkwardenId: 2,
      browserId: "folder-1",
      linkwardenUpdatedAt: 1000,
      browserUpdatedAt: 2000,
      lastSyncedAt: 1500,
      checksum: "def",
    });

    const found = await storage.getMappingByLinkwardenId(1, "link");
    expect(found).toBeDefined();
    expect(found?.linkwardenId).toBe(1);
  });

  test("should find mapping by browser ID", async () => {
    await storage.upsertMapping({
      id: "mapping-1",
      linkwardenType: "link" as const,
      linkwardenId: 1,
      browserId: "bookmark-1",
      linkwardenUpdatedAt: 1000,
      browserUpdatedAt: 2000,
      lastSyncedAt: 1500,
      checksum: "abc",
    });

    const found = await storage.getMappingByBrowserId("bookmark-1");
    expect(found).toBeDefined();
    expect(found?.browserId).toBe("bookmark-1");
  });

  test("should remove mapping by Linkwarden ID", async () => {
    await storage.upsertMapping({
      id: "mapping-1",
      linkwardenType: "link" as const,
      linkwardenId: 1,
      browserId: "bookmark-1",
      linkwardenUpdatedAt: 1000,
      browserUpdatedAt: 2000,
      lastSyncedAt: 1500,
      checksum: "abc",
    });

    await storage.removeMapping(1, "link");
    const mappings = await storage.getMappings();

    expect(mappings.length).toBe(0);
  });

  test("should handle multiple mappings", async () => {
    const mappings = [
      {
        id: "mapping-1",
        linkwardenType: "link" as const,
        linkwardenId: 1,
        browserId: "bookmark-1",
        linkwardenUpdatedAt: 1000,
        browserUpdatedAt: 2000,
        lastSyncedAt: 1500,
        checksum: "abc",
      },
      {
        id: "mapping-2",
        linkwardenType: "link" as const,
        linkwardenId: 2,
        browserId: "bookmark-2",
        linkwardenUpdatedAt: 1000,
        browserUpdatedAt: 2000,
        lastSyncedAt: 1500,
        checksum: "def",
      },
      {
        id: "mapping-3",
        linkwardenType: "collection" as const,
        linkwardenId: 3,
        browserId: "folder-1",
        linkwardenUpdatedAt: 1000,
        browserUpdatedAt: 2000,
        lastSyncedAt: 1500,
        checksum: "ghi",
      },
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
    const change = {
      id: "change-1",
      type: "create" as const,
      source: "browser" as const,
      browserId: "bookmark-1",
      timestamp: Date.now(),
      resolved: false,
    };

    await storage.addPendingChange(change);
    const changes = await storage.getPendingChanges();

    expect(changes.length).toBe(1);
    expect(changes[0]).toEqual(change);
  });

  test("should mark change as resolved", async () => {
    const change = {
      id: "change-1",
      type: "update" as const,
      source: "browser" as const,
      browserId: "bookmark-1",
      timestamp: Date.now(),
      resolved: false,
    };

    await storage.addPendingChange(change);
    await storage.resolvePendingChange("change-1");

    const changes = await storage.getPendingChanges();
    expect(changes[0].resolved).toBe(true);
  });

  test("should cleanup resolved changes", async () => {
    await storage.addPendingChange({
      id: "change-1",
      type: "create" as const,
      source: "browser" as const,
      browserId: "bookmark-1",
      timestamp: Date.now(),
      resolved: false,
    });

    await storage.addPendingChange({
      id: "change-2",
      type: "delete" as const,
      source: "browser" as const,
      browserId: "bookmark-2",
      timestamp: Date.now(),
      resolved: true, // Already resolved
    });

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
      targetCollectionName: "Bookmarks",
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
    await storage.saveSyncMetadata({
      id: "sync_state",
      lastSyncTime: 1234567890,
      syncDirection: "bidirectional",
      targetCollectionId: 42,
      browserRootFolderId: "folder-1",
    });

    await storage.upsertMapping({
      id: "mapping-1",
      linkwardenType: "link",
      linkwardenId: 1,
      browserId: "bookmark-1",
      linkwardenUpdatedAt: 1000,
      browserUpdatedAt: 2000,
      lastSyncedAt: 1500,
      checksum: "abc",
    });

    await storage.saveSettings({
      serverUrl: "https://example.com",
      accessToken: "token",
      syncInterval: 5,
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
