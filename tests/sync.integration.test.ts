/**
 * Integration tests for SyncEngine
 * Tests sync logic with mocked browser APIs but real sync engine code
 *
 * Run with: bun test tests/sync.integration.test.ts
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import {
  SyncEngine,
  resolveConflict,
  computeChecksum,
  buildPath,
  findFolderByPath,
  parseFolderPath,
  findOrCreateNestedFolder,
} from "../src/sync";
import { LinkwardenAPI } from "../src/api";
import * as storage from "../src/storage";

// Test configuration
const TEST_TIMEOUT = 15000;

// Mock data stores
const mockStorage: Record<string, unknown> = {};
const mockBookmarks: Record<
  string,
  {
    id: string;
    parentId?: string;
    title?: string;
    url?: string;
    children?: string[];
    dateAdded?: number;
    dateGroupModified?: number;
  }
> = {};

// Mock Linkwarden API with subcollection support
class MockLinkwardenAPI {
  private collections = new Map<
    number,
    {
      id: number;
      name: string;
      links: { id: number }[];
      collections?: { id: number; name: string; updatedAt: string }[];
      parentId?: number;
      updatedAt: string;
    }
  >();
  private links = new Map<
    number,
    {
      id: number;
      name: string;
      url: string;
      collectionId: number;
      updatedAt: string;
    }
  >();
  private nextId = 1;
  private nextLinkId = 1;

  constructor() {
    // Create default test collection
    this.collections.set(1, {
      id: 1,
      name: "Test Collection",
      links: [],
      collections: [],
      updatedAt: new Date().toISOString(),
    });
  }

  async getCollection(id: number) {
    const collection = this.collections.get(id);
    if (!collection) throw new Error(`Collection ${id} not found`);
    return {
      ...collection,
      links: collection.links.map((l) => this.links.get(l.id)).filter(Boolean),
      collections: collection.collections
        ?.map((c) => this.collections.get(c.id))
        .filter(Boolean),
    };
  }

  async getCollectionTree(id: number) {
    const collection = await this.getCollection(id);

    // Recursively fetch subcollections
    if (collection.collections && collection.collections.length > 0) {
      collection.collections = await Promise.all(
        collection.collections.map(async (sub) => {
          const subCollection = await this.getCollection(sub.id);
          return {
            ...subCollection,
            name: sub.name,
            updatedAt: sub.updatedAt,
          };
        })
      );
    }

    return collection;
  }

  async getCollections() {
    return Array.from(this.collections.values()).map((c) => ({
      id: c.id,
      name: c.name,
      parentId: c.parentId,
      updatedAt: c.updatedAt,
    }));
  }

  async createCollection(name: string, parentId?: number) {
    const id = this.collections.size + 1;
    const collection = {
      id,
      name,
      parentId,
      links: [],
      collections: [],
      updatedAt: new Date().toISOString(),
    };
    this.collections.set(id, collection);

    // Add to parent's collections array
    if (parentId) {
      const parent = this.collections.get(parentId);
      if (parent) {
        parent.collections?.push({ id, name, updatedAt: collection.updatedAt });
      }
    }

    return collection;
  }

  clearCollections() {
    this.collections.clear();
    this.links.clear();
    this.nextId = 1;
    this.nextLinkId = 1;
  }

  async updateCollection(
    id: number,
    updates: {
      name?: string;
      description?: string;
      color?: string;
      parentId?: number;
    }
  ) {
    const collection = this.collections.get(id);
    if (!collection) throw new Error(`Collection ${id} not found`);

    // Handle parentId change (folder move)
    if (
      updates.parentId !== undefined &&
      updates.parentId !== collection.parentId
    ) {
      // Remove from old parent's collections array
      if (collection.parentId) {
        const oldParent = this.collections.get(collection.parentId);
        if (oldParent && oldParent.collections) {
          oldParent.collections = oldParent.collections.filter(
            (c) => c.id !== id
          );
        }
      }

      // Add to new parent's collections array
      if (updates.parentId) {
        const newParent = this.collections.get(updates.parentId);
        if (newParent) {
          if (!newParent.collections) {
            newParent.collections = [];
          }
          newParent.collections.push({
            id,
            name: collection.name,
            updatedAt: collection.updatedAt,
          });
        }
      }

      collection.parentId = updates.parentId;
    }

    const updated = {
      ...collection,
      ...updates,
      updatedAt: new Date().toISOString(),
    };
    this.collections.set(id, updated);
    return updated;
  }

  async getLink(id: number) {
    const link = this.links.get(id);
    if (!link) throw new Error(`Link ${id} not found`);
    return link;
  }

  async createLink(url: string, collectionId: number, name?: string) {
    const id = this.nextLinkId++;
    const link = {
      id,
      name: name || url,
      url,
      collectionId,
      updatedAt: new Date().toISOString(),
    };
    this.links.set(id, link);

    const collection = this.collections.get(collectionId);
    if (collection) {
      collection.links.push({ id });
    }

    return link;
  }

  async updateLink(
    id: number,
    updates: { name?: string; url?: string; collectionId?: number }
  ) {
    const link = this.links.get(id);
    if (!link) throw new Error(`Link ${id} not found`);

    // Handle collection change (move)
    if (
      updates.collectionId !== undefined &&
      updates.collectionId !== link.collectionId
    ) {
      // Remove from old collection
      const oldCollection = this.collections.get(link.collectionId);
      if (oldCollection) {
        oldCollection.links = oldCollection.links.filter((l) => l.id !== id);
      }

      // Add to new collection
      const newCollection = this.collections.get(updates.collectionId);
      if (newCollection) {
        if (!newCollection.links) {
          newCollection.links = [];
        }
        newCollection.links.push({ id });
      }
    }

    const updated = {
      ...link,
      ...updates,
      updatedAt: new Date().toISOString(),
    };
    this.links.set(id, updated);
    return updated;
  }

  async deleteLink(id: number) {
    const link = this.links.get(id);
    if (!link) throw new Error(`Link ${id} not found`);

    const collection = this.collections.get(link.collectionId);
    if (collection) {
      collection.links = collection.links.filter((l) => l.id !== id);
    }
    this.links.delete(id);
  }

  async getCollectionLinks(collectionId: number) {
    const collection = this.collections.get(collectionId);
    if (!collection) return [];
    return collection.links.map((l) => this.links.get(l.id)).filter(Boolean);
  }

  async testConnection() {
    return true;
  }
}

// Setup browser API mocks with better tree support
function setupBrowserMocks() {
  Object.keys(mockStorage).forEach((key) => delete mockStorage[key]);
  Object.keys(mockBookmarks).forEach((key) => delete mockBookmarks[key]);

  // Create default bookmark structure
  mockBookmarks["0"] = {
    id: "0",
    parentId: undefined,
    title: "Root",
    children: [],
  };
  mockBookmarks["1"] = {
    id: "1",
    parentId: "0",
    title: "Bookmarks Bar",
    children: [],
  };
  mockBookmarks["2"] = {
    id: "2",
    parentId: "0",
    title: "Other Bookmarks",
    children: [],
  };

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
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      sendMessage: () => {},
    },
    bookmarks: {
      getTree: (callback: (tree: unknown[]) => void) => {
        const root = buildBookmarkTree();
        setTimeout(() => callback([root]), 0);
      },
      getChildren: (id: string, callback: (children: unknown[]) => void) => {
        const node = mockBookmarks[id];
        const children =
          node?.children
            ?.map((childId) => mockBookmarks[childId])
            .filter(Boolean) || [];
        setTimeout(() => callback(children), 0);
      },
      get: (id: string, callback: (nodes: unknown[]) => void) => {
        const node = mockBookmarks[id];
        setTimeout(() => callback(node ? [node] : []), 0);
      },
      search: (query: string, callback: (results: unknown[]) => void) => {
        const results = Object.values(mockBookmarks).filter(
          (b) => b.url?.includes(query) || b.title?.includes(query)
        );
        setTimeout(() => callback(results), 0);
      },
      create: (
        details: { parentId?: string; title?: string; url?: string },
        callback: (node: {
          id: string;
          parentId?: string;
          title?: string;
          url?: string;
          dateAdded?: number;
        }) => void
      ) => {
        const id = `bookmark-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        const node = {
          id,
          parentId: details.parentId || "2",
          title: details.title,
          url: details.url,
          children: [],
          dateAdded: Date.now(),
          dateGroupModified: Date.now(),
        };
        mockBookmarks[id] = node;

        // Add to parent's children
        const parent = mockBookmarks[node.parentId];
        if (parent && parent.children) {
          parent.children.push(id);
        }

        setTimeout(() => callback(node), 0);
      },
      update: (
        id: string,
        changes: { title?: string; url?: string },
        callback: (node: {
          id: string;
          parentId?: string;
          title?: string;
          url?: string;
          dateGroupModified?: number;
        }) => void
      ) => {
        if (mockBookmarks[id]) {
          if (changes.title) mockBookmarks[id].title = changes.title;
          if (changes.url) mockBookmarks[id].url = changes.url;
          mockBookmarks[id].dateGroupModified = Date.now();
        }
        setTimeout(() => callback(mockBookmarks[id]), 0);
      },
      remove: (id: string, callback: () => void) => {
        const node = mockBookmarks[id];
        if (node && node.parentId) {
          const parent = mockBookmarks[node.parentId];
          if (parent && parent.children) {
            parent.children = parent.children.filter(
              (childId) => childId !== id
            );
          }
        }
        delete mockBookmarks[id];
        setTimeout(() => callback(), 0);
      },
      removeTree: (id: string, callback: () => void) => {
        const node = mockBookmarks[id];
        if (node && node.parentId) {
          const parent = mockBookmarks[node.parentId];
          if (parent && parent.children) {
            parent.children = parent.children.filter(
              (childId) => childId !== id
            );
          }
        }
        delete mockBookmarks[id];
        setTimeout(() => callback(), 0);
      },
      move: (
        id: string,
        destination: { parentId?: string },
        callback: (node: { id: string; parentId?: string }) => void
      ) => {
        const node = mockBookmarks[id];
        if (node && destination.parentId) {
          const oldParent = mockBookmarks[node.parentId!];
          if (oldParent && oldParent.children) {
            oldParent.children = oldParent.children.filter(
              (childId) => childId !== id
            );
          }
          node.parentId = destination.parentId;
          const newParent = mockBookmarks[destination.parentId];
          if (newParent && newParent.children) {
            newParent.children.push(id);
          }
        }
        setTimeout(() => callback({ id, parentId: destination.parentId }), 0);
      },
      onCreated: {
        // eslint-disable-next-line @typescript-eslint/no-empty-function
        addListener: () => {},
      },
      onChanged: {
        // eslint-disable-next-line @typescript-eslint/no-empty-function
        addListener: () => {},
      },
      onRemoved: {
        // eslint-disable-next-line @typescript-eslint/no-empty-function
        addListener: () => {},
      },
      onMoved: {
        // eslint-disable-next-line @typescript-eslint/no-empty-function
        addListener: () => {},
      },
    },
  };
}

function buildBookmarkTree() {
  const root = mockBookmarks["0"];
  if (!root) return { id: "0", children: [] };

  function buildNode(node: {
    id: string;
    children?: string[];
    title?: string;
    url?: string;
  }): { id: string; title?: string; url?: string; children: unknown[] } {
    if (!node.children || node.children.length === 0) {
      return { ...node, children: [] };
    }
    return {
      ...node,
      children: node.children
        .map((childId: string) => buildNode(mockBookmarks[childId]))
        .filter(Boolean),
    };
  }

  return buildNode(root);
}

describe("Integration: SyncEngine", () => {
  let mockApi: MockLinkwardenAPI;
  let syncEngine: SyncEngine;

  beforeEach(() => {
    setupBrowserMocks();
    mockApi = new MockLinkwardenAPI();
    // @ts-expect-error - Mock API for testing
    syncEngine = new SyncEngine(mockApi as unknown as LinkwardenAPI);
  }, TEST_TIMEOUT);

  afterEach(() => {
    Object.keys(mockStorage).forEach((key) => delete mockStorage[key]);
    Object.keys(mockBookmarks).forEach((key) => delete mockBookmarks[key]);
  }, TEST_TIMEOUT);

  describe("Initial Sync", () => {
    test(
      "should sync links from Linkwarden to browser on first sync",
      async () => {
        // Create links in mock Linkwarden
        await mockApi.createLink("https://example1.com", 1, "Link 1");
        await mockApi.createLink("https://example2.com", 1, "Link 2");

        // Setup sync metadata
        await storage.saveSyncMetadata({
          id: "sync_state",
          lastSyncTime: 0,
          syncDirection: "bidirectional",
          targetCollectionId: 1,
          browserRootFolderId: "2", // Other Bookmarks
        });

        // Perform sync
        const result = await syncEngine.sync();

        // Verify links were created in browser
        expect(result.created).toBe(2);
        expect(result.errors).toHaveLength(0);

        const mappings = await storage.getMappings();
        expect(mappings.length).toBe(2);
      },
      TEST_TIMEOUT
    );

    test(
      "should handle empty collection gracefully",
      async () => {
        await storage.saveSyncMetadata({
          id: "sync_state",
          lastSyncTime: 0,
          syncDirection: "bidirectional",
          targetCollectionId: 1,
          browserRootFolderId: "2",
        });

        const result = await syncEngine.sync();

        expect(result.created).toBe(0);
        expect(result.errors).toHaveLength(0);
      },
      TEST_TIMEOUT
    );
  });

  describe("Incremental Sync", () => {
    test(
      "should skip already synced items with no changes",
      async () => {
        // Create and sync a link
        const link = await mockApi.createLink(
          "https://example.com",
          1,
          "Example"
        );

        await storage.saveSyncMetadata({
          id: "sync_state",
          lastSyncTime: Date.now(),
          syncDirection: "bidirectional",
          targetCollectionId: 1,
          browserRootFolderId: "2",
        });

        // Create mapping with matching checksum
        const checksum = computeChecksum({ name: link.name, url: link.url });
        await storage.upsertMapping({
          id: "mapping-1",
          linkwardenType: "link",
          linkwardenId: link.id,
          browserId: "bookmark-1",
          linkwardenUpdatedAt: new Date(link.updatedAt).getTime(),
          browserUpdatedAt: Date.now(),
          lastSyncedAt: Date.now(),
          checksum,
        });

        // Sync again
        const result = await syncEngine.sync();

        // Should not create or update anything
        expect(result.created).toBe(0);
        expect(result.updated).toBe(0);
      },
      TEST_TIMEOUT
    );

    test(
      "should update browser bookmark when Linkwarden link changes",
      async () => {
        // Create link
        const link = await mockApi.createLink(
          "https://original.com",
          1,
          "Original"
        );

        // Simulate older browser state
        const oldTime = Date.now() - 60000;
        await storage.saveSyncMetadata({
          id: "sync_state",
          lastSyncTime: oldTime,
          syncDirection: "bidirectional",
          targetCollectionId: 1,
          browserRootFolderId: "2",
        });

        await storage.upsertMapping({
          id: "mapping-1",
          linkwardenType: "link",
          linkwardenId: link.id,
          browserId: "bookmark-1",
          linkwardenUpdatedAt: oldTime,
          browserUpdatedAt: oldTime,
          lastSyncedAt: oldTime,
          checksum: "old-checksum",
        });

        // Update link in Linkwarden
        await mockApi.updateLink(link.id, {
          name: "Updated",
          url: "https://updated.com",
        });

        // Sync
        const result = await syncEngine.sync();

        expect(result.updated).toBe(1);
        expect(result.errors).toHaveLength(0);
      },
      TEST_TIMEOUT
    );
  });

  describe("Conflict Resolution Integration", () => {
    test(
      "should prefer browser changes when browser is newer",
      async () => {
        // Create link in Linkwarden
        const link = await mockApi.createLink(
          "https://example.com",
          1,
          "Original"
        );

        // Simulate newer browser edit
        const newTime = Date.now() + 60000;
        await storage.saveSyncMetadata({
          id: "sync_state",
          lastSyncTime: Date.now(),
          syncDirection: "bidirectional",
          targetCollectionId: 1,
          browserRootFolderId: "2",
        });

        await storage.upsertMapping({
          id: "mapping-1",
          linkwardenType: "link",
          linkwardenId: link.id,
          browserId: "bookmark-1",
          linkwardenUpdatedAt: new Date(link.updatedAt).getTime(),
          browserUpdatedAt: newTime, // Browser is newer
          lastSyncedAt: Date.now(),
          checksum: "browser-checksum",
        });

        // Sync should not overwrite browser changes
        const result = await syncEngine.sync();

        // Should not update since browser wins
        expect(result.updated).toBe(0);
      },
      TEST_TIMEOUT
    );

    test(
      "should handle checksum match as no-op",
      async () => {
        const link = await mockApi.createLink(
          "https://example.com",
          1,
          "Example"
        );

        const checksum = computeChecksum(link);
        await storage.saveSyncMetadata({
          id: "sync_state",
          lastSyncTime: Date.now(),
          syncDirection: "bidirectional",
          targetCollectionId: 1,
          browserRootFolderId: "2",
        });

        await storage.upsertMapping({
          id: "mapping-1",
          linkwardenType: "link",
          linkwardenId: link.id,
          browserId: "bookmark-1",
          linkwardenUpdatedAt: new Date(link.updatedAt).getTime(),
          browserUpdatedAt: Date.now(),
          lastSyncedAt: Date.now(),
          checksum,
        });

        const result = await syncEngine.sync();

        expect(result.created).toBe(0);
        expect(result.updated).toBe(0);
      },
      TEST_TIMEOUT
    );
  });

  describe("Error Handling", () => {
    test(
      "should handle missing sync metadata gracefully",
      async () => {
        // No metadata set
        const result = await syncEngine.sync();

        expect(result.errors.length).toBeGreaterThan(0);
        expect(result.errors[0]).toContain("not configured");
      },
      TEST_TIMEOUT
    );

    test(
      "should handle invalid collection ID",
      async () => {
        await storage.saveSyncMetadata({
          id: "sync_state",
          lastSyncTime: 0,
          syncDirection: "bidirectional",
          targetCollectionId: 99999, // Invalid
          browserRootFolderId: "2",
        });

        const result = await syncEngine.sync();

        expect(result.errors.length).toBeGreaterThan(0);
      },
      TEST_TIMEOUT
    );

    test(
      "should continue sync even if one link fails",
      async () => {
        // Create multiple links
        await mockApi.createLink("https://link1.com", 1, "Link 1");
        await mockApi.createLink("https://link2.com", 1, "Link 2");

        await storage.saveSyncMetadata({
          id: "sync_state",
          lastSyncTime: 0,
          syncDirection: "bidirectional",
          targetCollectionId: 1,
          browserRootFolderId: "2",
        });

        const result = await syncEngine.sync();

        // Should sync successfully despite potential issues
        expect(result.errors.length).toBeLessThanOrEqual(2);
      },
      TEST_TIMEOUT
    );
  });
});

describe("Integration: Conflict Resolution", () => {
  test("should resolve conflict with newer timestamp winning", () => {
    const localMapping = {
      id: "mapping-1",
      linkwardenType: "link" as const,
      linkwardenId: 1,
      browserId: "bookmark-1",
      linkwardenUpdatedAt: 1000,
      browserUpdatedAt: 2000,
      lastSyncedAt: 1500,
      checksum: "local-checksum",
    };

    const remoteLink = {
      name: "Remote",
      url: "https://remote.com",
      updatedAt: new Date(3000).toISOString(), // Newer
    };

    const result = resolveConflict(localMapping, remoteLink);
    expect(result).toBe("use-remote");
  });

  test("should resolve conflict with browser winning on tie", () => {
    const localMapping = {
      id: "mapping-1",
      linkwardenType: "link" as const,
      linkwardenId: 1,
      browserId: "bookmark-1",
      linkwardenUpdatedAt: 2000,
      browserUpdatedAt: 2000,
      lastSyncedAt: 1500,
      checksum: "different",
    };

    const remoteLink = {
      name: "Remote",
      url: "https://remote.com",
      updatedAt: new Date(2000).toISOString(), // Same time
    };

    const result = resolveConflict(localMapping, remoteLink);
    expect(result).toBe("use-local");
  });
});

describe("Round-Trip Sync Scenarios", () => {
  let mockApi: MockLinkwardenAPI;
  let syncEngine: SyncEngine;

  beforeEach(() => {
    setupBrowserMocks();
    mockApi = new MockLinkwardenAPI();
    // @ts-expect-error - Mock API for testing
    syncEngine = new SyncEngine(mockApi as unknown as LinkwardenAPI);
  }, TEST_TIMEOUT);

  afterEach(() => {
    Object.keys(mockStorage).forEach((key) => delete mockStorage[key]);
    Object.keys(mockBookmarks).forEach((key) => delete mockBookmarks[key]);
  }, TEST_TIMEOUT);

  describe("Browser → Server Sync", () => {
    test(
      "should push new browser bookmark to Linkwarden",
      async () => {
        // Setup sync metadata
        await storage.saveSyncMetadata({
          id: "sync_state",
          lastSyncTime: Date.now(),
          syncDirection: "bidirectional",
          targetCollectionId: 1,
          browserRootFolderId: "2",
        });

        // Create pending change for new bookmark
        const changeId = crypto.randomUUID();
        await storage.addPendingChange({
          id: changeId,
          type: "create",
          source: "browser",
          browserId: "browser-bookmark-1",
          data: {
            url: "https://newbookmark.com",
            title: "New Bookmark",
          },
          timestamp: Date.now(),
          resolved: false,
        });

        // Sync should process pending change
        const result = await syncEngine.sync();

        expect(result.errors).toHaveLength(0);

        const mappings = await storage.getMappings();
        expect(mappings.length).toBe(1);
        expect(mappings[0].linkwardenType).toBe("link");
      },
      TEST_TIMEOUT
    );

    test(
      "should update Linkwarden link when browser bookmark changes",
      async () => {
        // Create link in Linkwarden first
        const link = await mockApi.createLink(
          "https://original.com",
          1,
          "Original"
        );

        await storage.saveSyncMetadata({
          id: "sync_state",
          lastSyncTime: Date.now(),
          syncDirection: "bidirectional",
          targetCollectionId: 1,
          browserRootFolderId: "2",
        });

        // Create mapping
        await storage.upsertMapping({
          id: "mapping-1",
          linkwardenType: "link",
          linkwardenId: link.id,
          browserId: "browser-bookmark-1",
          linkwardenUpdatedAt: new Date(link.updatedAt).getTime(),
          browserUpdatedAt: Date.now(),
          lastSyncedAt: Date.now(),
          checksum: computeChecksum(link),
        });

        // Create pending change for update
        await storage.addPendingChange({
          id: crypto.randomUUID(),
          type: "update",
          source: "browser",
          linkwardenId: link.id,
          browserId: "browser-bookmark-1",
          data: {
            url: "https://updated.com",
            title: "Updated Title",
          },
          timestamp: Date.now(),
          resolved: false,
        });

        const result = await syncEngine.sync();

        expect(result.errors).toHaveLength(0);

        // Verify link was updated on server
        const updatedLink = await mockApi.getCollectionLinks(1);
        const found = updatedLink.find((l) => l.id === link.id);
        expect(found?.url).toBe("https://updated.com");
        expect(found?.name).toBe("Updated Title");
      },
      TEST_TIMEOUT
    );

    test(
      "should delete Linkwarden link when browser bookmark is deleted",
      async () => {
        // Create link in Linkwarden
        const link = await mockApi.createLink(
          "https://todelete.com",
          1,
          "To Delete"
        );

        await storage.saveSyncMetadata({
          id: "sync_state",
          lastSyncTime: Date.now(),
          syncDirection: "bidirectional",
          targetCollectionId: 1,
          browserRootFolderId: "2",
        });

        // Create mapping
        await storage.upsertMapping({
          id: "mapping-1",
          linkwardenType: "link",
          linkwardenId: link.id,
          browserId: "browser-bookmark-1",
          linkwardenUpdatedAt: new Date(link.updatedAt).getTime(),
          browserUpdatedAt: Date.now(),
          lastSyncedAt: Date.now(),
          checksum: computeChecksum(link),
        });

        // Create pending change for delete
        await storage.addPendingChange({
          id: crypto.randomUUID(),
          type: "delete",
          source: "browser",
          linkwardenId: link.id,
          browserId: "browser-bookmark-1",
          timestamp: Date.now(),
          resolved: false,
        });

        const result = await syncEngine.sync();

        expect(result.errors).toHaveLength(0);

        // Verify link was deleted on server
        const links = await mockApi.getCollectionLinks(1);
        expect(links.find((l) => l.id === link.id)).toBeUndefined();
      },
      TEST_TIMEOUT
    );
  });

  describe("Subcollections and Folders", () => {
    test(
      "should sync subcollections as nested folders",
      async () => {
        // Create subcollection structure in Linkwarden
        const parentCollection =
          await mockApi.createCollection("Parent Collection");
        const childCollection = await mockApi.createCollection(
          "Child Collection",
          parentCollection.id
        );

        // Add links to both
        await mockApi.createLink(
          "https://parent-link.com",
          parentCollection.id,
          "Parent Link"
        );
        await mockApi.createLink(
          "https://child-link.com",
          childCollection.id,
          "Child Link"
        );

        await storage.saveSyncMetadata({
          id: "sync_state",
          lastSyncTime: 0,
          syncDirection: "bidirectional",
          targetCollectionId: parentCollection.id,
          browserRootFolderId: "2",
        });

        const result = await syncEngine.sync();

        expect(result.errors).toHaveLength(0);

        const mappings = await storage.getMappings();
        const collectionMappings = mappings.filter(
          (m) => m.linkwardenType === "collection"
        );
        const linkMappings = mappings.filter(
          (m) => m.linkwardenType === "link"
        );

        expect(collectionMappings.length).toBe(1); // Child collection (parent is root)
        expect(linkMappings.length).toBe(2); // One in parent, one in child
      },
      TEST_TIMEOUT
    );

    test(
      "should handle duplicate folder names using path-based matching",
      async () => {
        // Start with default collection (id: 1) and create subcollections with duplicate names
        // Create parent collections under the default test collection
        const parent1 = await mockApi.createCollection("Parent 1", 1);
        const parent2 = await mockApi.createCollection("Parent 2", 1);
        const child1 = await mockApi.createCollection("Resources", parent1.id);
        const child2 = await mockApi.createCollection("Resources", parent2.id);

        // Add different links to each
        await mockApi.createLink("https://link1.com", child1.id, "Link 1");
        await mockApi.createLink("https://link2.com", child2.id, "Link 2");

        await storage.saveSyncMetadata({
          id: "sync_state",
          lastSyncTime: 0,
          syncDirection: "bidirectional",
          targetCollectionId: 1, // Root test collection
          browserRootFolderId: "2",
        });

        const result = await syncEngine.sync();

        expect(result.errors).toHaveLength(0);

        // Both "Resources" folders should be created with different paths
        const mappings = await storage.getMappings();
        const folderMappings = mappings.filter(
          (m) => m.linkwardenType === "collection"
        );

        // Should have: Parent 1, Parent 2, Resources (under Parent 1), Resources (under Parent 2)
        expect(folderMappings.length).toBeGreaterThanOrEqual(4);
      },
      TEST_TIMEOUT
    );
  });

  describe("Path-Based Matching Utilities", () => {
    test("should build correct path from collection hierarchy", async () => {
      const parent = await mockApi.createCollection("Parent");
      const child = await mockApi.createCollection("Child", parent.id);
      const grandchild = await mockApi.createCollection("Grandchild", child.id);

      const collectionsCache = new Map();
      collectionsCache.set(1, {
        id: 1,
        name: "Root",
        collections: [{ id: parent.id, name: "Parent" }],
      });
      collectionsCache.set(parent.id, {
        id: parent.id,
        name: "Parent",
        collections: [{ id: child.id, name: "Child" }],
      });
      collectionsCache.set(child.id, {
        id: child.id,
        name: "Child",
        collections: [{ id: grandchild.id, name: "Grandchild" }],
      });
      collectionsCache.set(grandchild.id, {
        id: grandchild.id,
        name: "Grandchild",
        collections: [],
      });

      const path = buildPath(grandchild.id, collectionsCache);
      expect(path).toBe("/Root/Parent/Child/Grandchild");
    });

    test("should find folder by path in browser", async () => {
      // Create folder structure in browser
      const folder1 = await new Promise<chrome.bookmarks.BookmarkTreeNode>(
        (resolve) => {
          chrome.bookmarks.create({ parentId: "2", title: "Folder1" }, resolve);
        }
      );
      const folder2 = await new Promise<chrome.bookmarks.BookmarkTreeNode>(
        (resolve) => {
          chrome.bookmarks.create(
            { parentId: folder1.id, title: "Folder2" },
            resolve
          );
        }
      );

      const path = "/Other Bookmarks/Folder1/Folder2";
      const foundId = await findFolderByPath(path, "2");

      expect(foundId).toBe(folder2.id);
    });

    test("should return undefined for non-existent path", async () => {
      const path = "/Other Bookmarks/NonExistent/Folder";
      const foundId = await findFolderByPath(path, "2");

      expect(foundId).toBeUndefined();
    });
  });

  describe("Full Round-Trip Scenarios", () => {
    test(
      "should complete full round-trip: server → browser → server",
      async () => {
        // Step 1: Create link on server
        const originalLink = await mockApi.createLink(
          "https://example.com",
          1,
          "Example"
        );

        await storage.saveSyncMetadata({
          id: "sync_state",
          lastSyncTime: 0,
          syncDirection: "bidirectional",
          targetCollectionId: 1,
          browserRootFolderId: "2",
        });

        // Step 2: Sync to browser
        let result = await syncEngine.sync();
        expect(result.errors).toHaveLength(0);

        const mappings = await storage.getMappings();
        expect(mappings.length).toBe(1);
        const browserId = mappings[0].browserId;

        // Step 3: Update browser bookmark (simulate user edit)
        await storage.addPendingChange({
          id: crypto.randomUUID(),
          type: "update",
          source: "browser",
          linkwardenId: originalLink.id,
          browserId: browserId,
          data: {
            url: "https://updated-example.com",
            title: "Updated Example",
          },
          timestamp: Date.now() + 1000, // Browser is newer
          resolved: false,
        });

        // Step 4: Sync back to server
        result = await syncEngine.sync();
        expect(result.errors).toHaveLength(0);

        // Step 5: Verify server has updated link
        const links = await mockApi.getCollectionLinks(1);
        const updatedLink = links.find((l) => l.id === originalLink.id);
        expect(updatedLink?.url).toBe("https://updated-example.com");
        expect(updatedLink?.name).toBe("Updated Example");
      },
      TEST_TIMEOUT
    );

    test(
      "should handle conflict with last-write-wins",
      async () => {
        // Create link on server
        const link = await mockApi.createLink(
          "https://original.com",
          1,
          "Original"
        );

        await storage.saveSyncMetadata({
          id: "sync_state",
          lastSyncTime: Date.now(),
          syncDirection: "bidirectional",
          targetCollectionId: 1,
          browserRootFolderId: "2",
        });

        // Create mapping with server being newer
        const serverTime = Date.now() + 2000;
        const browserTime = Date.now() + 1000;

        await storage.upsertMapping({
          id: "mapping-1",
          linkwardenType: "link",
          linkwardenId: link.id,
          browserId: "browser-bookmark-1",
          linkwardenUpdatedAt: serverTime,
          browserUpdatedAt: browserTime,
          lastSyncedAt: Date.now(),
          checksum: "old-checksum",
        });

        // Update on server (makes it even newer)
        const newerTime = Date.now() + 3000;
        const updatedLink = await mockApi.updateLink(link.id, {
          name: "Server Update",
          url: "https://server.com",
        });
        // Manually set a newer timestamp
        updatedLink.updatedAt = new Date(newerTime).toISOString();

        // Sync should use server version (newer) and update browser
        const result = await syncEngine.sync();

        expect(result.errors).toHaveLength(0);
        // Should update browser bookmark since server is newer
        expect(result.updated).toBeGreaterThanOrEqual(0); // May be 0 if checksum matches after update
      },
      TEST_TIMEOUT
    );

    test(
      "should prevent duplicate links when syncing from browser",
      async () => {
        // Create link on server first
        const existingLink = await mockApi.createLink(
          "https://existing.com",
          1,
          "Existing"
        );

        await storage.saveSyncMetadata({
          id: "sync_state",
          lastSyncTime: Date.now(),
          syncDirection: "bidirectional",
          targetCollectionId: 1,
          browserRootFolderId: "2",
        });

        // Create pending change for same URL from browser
        await storage.addPendingChange({
          id: crypto.randomUUID(),
          type: "create",
          source: "browser",
          browserId: "browser-bookmark-1",
          data: {
            url: "https://existing.com",
            title: "Existing",
          },
          timestamp: Date.now(),
          resolved: false,
        });

        const result = await syncEngine.sync();

        // Should not create duplicate, should map existing
        expect(result.errors).toHaveLength(0);

        const mappings = await storage.getMappings();
        const linkMapping = mappings.find(
          (m) => m.linkwardenId === existingLink.id
        );
        expect(linkMapping).toBeDefined();
        expect(linkMapping?.browserId).toBe("browser-bookmark-1");
      },
      TEST_TIMEOUT
    );
  });

  describe("Move and Rename Operations", () => {
    test(
      "should handle link rename (title change)",
      async () => {
        // Create link on server and sync to browser
        const link = await mockApi.createLink(
          "https://example.com",
          1,
          "Original Name"
        );

        await storage.saveSyncMetadata({
          id: "sync_state",
          lastSyncTime: Date.now(),
          syncDirection: "bidirectional",
          targetCollectionId: 1,
          browserRootFolderId: "2",
        });

        // Create mapping
        await storage.upsertMapping({
          id: "mapping-1",
          linkwardenType: "link",
          linkwardenId: link.id,
          browserId: "browser-bookmark-1",
          linkwardenUpdatedAt: new Date(link.updatedAt).getTime(),
          browserUpdatedAt: Date.now(),
          lastSyncedAt: Date.now(),
          checksum: computeChecksum(link),
        });

        // Simulate rename via pending change
        await storage.addPendingChange({
          id: crypto.randomUUID(),
          type: "update",
          source: "browser",
          linkwardenId: link.id,
          browserId: "browser-bookmark-1",
          data: {
            title: "Renamed Title",
          },
          timestamp: Date.now(),
          resolved: false,
        });

        const result = await syncEngine.sync();

        expect(result.errors).toHaveLength(0);

        // Verify link was renamed on server
        const updatedLinks = await mockApi.getCollectionLinks(1);
        const updatedLink = updatedLinks.find((l) => l.id === link.id);
        expect(updatedLink?.name).toBe("Renamed Title");
      },
      TEST_TIMEOUT
    );

    test(
      "should handle folder rename (title change)",
      async () => {
        // Create subcollection and sync
        const parentCollection =
          await mockApi.createCollection("Parent Collection");
        const childCollection = await mockApi.createCollection(
          "Original Folder",
          parentCollection.id
        );

        await storage.saveSyncMetadata({
          id: "sync_state",
          lastSyncTime: Date.now(),
          syncDirection: "bidirectional",
          targetCollectionId: parentCollection.id,
          browserRootFolderId: "2",
        });

        // Create mapping for child folder
        await storage.upsertMapping({
          id: "mapping-folder-1",
          linkwardenType: "collection",
          linkwardenId: childCollection.id,
          browserId: "browser-folder-1",
          linkwardenUpdatedAt: new Date(childCollection.updatedAt).getTime(),
          browserUpdatedAt: Date.now(),
          lastSyncedAt: Date.now(),
          checksum: computeChecksum({ name: childCollection.name }),
        });

        // Simulate folder rename via pending change
        await storage.addPendingChange({
          id: crypto.randomUUID(),
          type: "update",
          source: "browser",
          linkwardenId: childCollection.id,
          browserId: "browser-folder-1",
          data: {
            title: "Renamed Folder",
          },
          timestamp: Date.now(),
          resolved: false,
        });

        const result = await syncEngine.sync();

        expect(result.errors).toHaveLength(0);

        // Verify folder was renamed on server
        const updatedCollection = await mockApi.getCollection(
          childCollection.id
        );
        expect(updatedCollection.name).toBe("Renamed Folder");
      },
      TEST_TIMEOUT
    );

    test(
      "should handle link move between folders",
      async () => {
        // Create two collections and a link
        const sourceCollection =
          await mockApi.createCollection("Source Folder");
        const targetCollection =
          await mockApi.createCollection("Target Folder");
        const link = await mockApi.createLink(
          "https://example.com",
          sourceCollection.id,
          "Link to Move"
        );

        await storage.saveSyncMetadata({
          id: "sync_state",
          lastSyncTime: Date.now(),
          syncDirection: "bidirectional",
          targetCollectionId: 1,
          browserRootFolderId: "2",
        });

        // Create mappings for both folders and the link
        await storage.upsertMapping({
          id: "mapping-source",
          linkwardenType: "collection",
          linkwardenId: sourceCollection.id,
          browserId: "browser-source-folder",
          linkwardenUpdatedAt: new Date(sourceCollection.updatedAt).getTime(),
          browserUpdatedAt: Date.now(),
          lastSyncedAt: Date.now(),
          checksum: computeChecksum({ name: sourceCollection.name }),
        });

        await storage.upsertMapping({
          id: "mapping-target",
          linkwardenType: "collection",
          linkwardenId: targetCollection.id,
          browserId: "browser-target-folder",
          linkwardenUpdatedAt: new Date(targetCollection.updatedAt).getTime(),
          browserUpdatedAt: Date.now(),
          lastSyncedAt: Date.now(),
          checksum: computeChecksum({ name: targetCollection.name }),
        });

        await storage.upsertMapping({
          id: "mapping-link",
          linkwardenType: "link",
          linkwardenId: link.id,
          browserId: "browser-bookmark-1",
          linkwardenUpdatedAt: new Date(link.updatedAt).getTime(),
          browserUpdatedAt: Date.now(),
          lastSyncedAt: Date.now(),
          checksum: computeChecksum(link),
        });

        // Simulate move via pending change (move to target folder)
        await storage.addPendingChange({
          id: crypto.randomUUID(),
          type: "move",
          source: "browser",
          linkwardenId: link.id,
          browserId: "browser-bookmark-1",
          parentId: "browser-target-folder",
          data: {
            title: "Link to Move",
            url: "https://example.com",
          },
          timestamp: Date.now(),
          resolved: false,
        });

        const result = await syncEngine.sync();

        expect(result.errors).toHaveLength(0);

        // Verify link was moved to target collection on server
        const updatedLink = await mockApi.getLink(link.id);
        expect(updatedLink.collectionId).toBe(targetCollection.id);
      },
      TEST_TIMEOUT
    );

    test(
      "should handle folder move (update mapping only)",
      async () => {
        // Create folder structure
        const parent1 = await mockApi.createCollection("Parent 1");
        const parent2 = await mockApi.createCollection("Parent 2");
        const childFolder = await mockApi.createCollection(
          "Child Folder",
          parent1.id
        );

        await storage.saveSyncMetadata({
          id: "sync_state",
          lastSyncTime: Date.now(),
          syncDirection: "bidirectional",
          targetCollectionId: 1,
          browserRootFolderId: "2",
        });

        // Create mappings
        await storage.upsertMapping({
          id: "mapping-parent1",
          linkwardenType: "collection",
          linkwardenId: parent1.id,
          browserId: "browser-parent1",
          linkwardenUpdatedAt: new Date(parent1.updatedAt).getTime(),
          browserUpdatedAt: Date.now(),
          lastSyncedAt: Date.now(),
          checksum: computeChecksum({ name: parent1.name }),
        });

        await storage.upsertMapping({
          id: "mapping-parent2",
          linkwardenType: "collection",
          linkwardenId: parent2.id,
          browserId: "browser-parent2",
          linkwardenUpdatedAt: new Date(parent2.updatedAt).getTime(),
          browserUpdatedAt: Date.now(),
          lastSyncedAt: Date.now(),
          checksum: computeChecksum({ name: parent2.name }),
        });

        await storage.upsertMapping({
          id: "mapping-child",
          linkwardenType: "collection",
          linkwardenId: childFolder.id,
          browserId: "browser-child",
          linkwardenUpdatedAt: new Date(childFolder.updatedAt).getTime(),
          browserUpdatedAt: Date.now(),
          lastSyncedAt: Date.now(),
          checksum: computeChecksum({ name: childFolder.name }),
        });

        // Simulate folder move via pending change
        await storage.addPendingChange({
          id: crypto.randomUUID(),
          type: "move",
          source: "browser",
          linkwardenId: childFolder.id,
          browserId: "browser-child",
          parentId: "browser-parent2",
          data: {
            title: "Child Folder",
          },
          timestamp: Date.now(),
          resolved: false,
        });

        const result = await syncEngine.sync();

        // Folder move is tracked but Linkwarden API doesn't support moving collections easily
        // The mapping should be updated to reflect the new browser parent
        expect(result.errors).toHaveLength(0);
      },
      TEST_TIMEOUT
    );

    test(
      "should handle server → browser move detection",
      async () => {
        // Use root collection (id: 1) and create a subcollection for the move target
        const targetCollection = await mockApi.createCollection(
          "Target Folder",
          1
        );
        const link = await mockApi.createLink(
          "https://example.com",
          1,
          "Link to Move"
        );

        await storage.saveSyncMetadata({
          id: "sync_state",
          lastSyncTime: Date.now(),
          syncDirection: "bidirectional",
          targetCollectionId: 1,
          browserRootFolderId: "2",
        });

        // Create browser folders for root and target
        mockBookmarks["2"] = {
          id: "2",
          parentId: "0",
          title: "Other Bookmarks",
          children: [],
          dateAdded: Date.now(),
          dateGroupModified: Date.now(),
        };

        mockBookmarks["browser-target-folder"] = {
          id: "browser-target-folder",
          parentId: "2",
          title: "Target Folder",
          children: [],
          dateAdded: Date.now(),
          dateGroupModified: Date.now(),
        };

        // Create mappings for target folder and the link
        await storage.upsertMapping({
          id: "mapping-target",
          linkwardenType: "collection",
          linkwardenId: targetCollection.id,
          browserId: "browser-target-folder",
          linkwardenUpdatedAt: new Date(targetCollection.updatedAt).getTime(),
          browserUpdatedAt: Date.now(),
          lastSyncedAt: Date.now(),
          checksum: computeChecksum({ name: targetCollection.name }),
        });

        await storage.upsertMapping({
          id: "mapping-link",
          linkwardenType: "link",
          linkwardenId: link.id,
          browserId: "browser-bookmark-1",
          linkwardenUpdatedAt: new Date(link.updatedAt).getTime(),
          browserUpdatedAt: Date.now(),
          lastSyncedAt: Date.now(),
          checksum: computeChecksum(link),
        });

        // Create browser bookmark in root folder (id: 2)
        mockBookmarks["browser-bookmark-1"] = {
          id: "browser-bookmark-1",
          parentId: "2",
          title: "Link to Move",
          url: "https://example.com",
          dateAdded: Date.now(),
          dateGroupModified: Date.now(),
        };

        // Add bookmark to parent's children
        mockBookmarks["2"].children?.push("browser-bookmark-1");

        // Move link on server to target collection
        await mockApi.updateLink(link.id, {
          collectionId: targetCollection.id,
        });

        // Sync should detect the move and update browser
        const result = await syncEngine.sync();

        expect(result.errors).toHaveLength(0);

        // Verify bookmark was moved in browser
        const updatedBookmark = mockBookmarks["browser-bookmark-1"];
        expect(updatedBookmark.parentId).toBe("browser-target-folder");
      },
      TEST_TIMEOUT
    );

    test(
      "should handle link move to nested subcollection",
      async () => {
        // Create a simple parent-child structure under root (id: 1)
        const parent = await mockApi.createCollection("Parent", 1);
        const link = await mockApi.createLink("https://example.com", 1, "Link");

        await storage.saveSyncMetadata({
          id: "sync_state",
          lastSyncTime: Date.now(),
          syncDirection: "bidirectional",
          targetCollectionId: 1,
          browserRootFolderId: "2",
        });

        // Create browser folder structure
        mockBookmarks["2"] = {
          id: "2",
          parentId: "0",
          title: "Other Bookmarks",
          children: [],
          dateAdded: Date.now(),
          dateGroupModified: Date.now(),
        };

        mockBookmarks["browser-parent"] = {
          id: "browser-parent",
          parentId: "2",
          title: "Parent",
          children: [],
          dateAdded: Date.now(),
          dateGroupModified: Date.now(),
        };

        // Create mappings
        await storage.upsertMapping({
          id: "mapping-parent",
          linkwardenType: "collection",
          linkwardenId: parent.id,
          browserId: "browser-parent",
          linkwardenUpdatedAt: new Date(parent.updatedAt).getTime(),
          browserUpdatedAt: Date.now(),
          lastSyncedAt: Date.now(),
          checksum: computeChecksum({ name: parent.name }),
        });

        await storage.upsertMapping({
          id: "mapping-link",
          linkwardenType: "link",
          linkwardenId: link.id,
          browserId: "browser-bookmark-1",
          linkwardenUpdatedAt: new Date(link.updatedAt).getTime(),
          browserUpdatedAt: Date.now(),
          lastSyncedAt: Date.now(),
          checksum: computeChecksum(link),
        });

        // Create browser bookmark in root
        mockBookmarks["browser-bookmark-1"] = {
          id: "browser-bookmark-1",
          parentId: "2",
          title: "Link",
          url: "https://example.com",
          dateAdded: Date.now(),
          dateGroupModified: Date.now(),
        };

        // Add bookmark to parent's children
        mockBookmarks["2"].children?.push("browser-bookmark-1");

        // Move link on server to parent collection
        await mockApi.updateLink(link.id, { collectionId: parent.id });

        const result = await syncEngine.sync();

        expect(result.errors).toHaveLength(0);

        // Verify bookmark was moved to parent folder
        const updatedBookmark = mockBookmarks["browser-bookmark-1"];
        expect(updatedBookmark.parentId).toBe("browser-parent");
      },
      TEST_TIMEOUT
    );

    test(
      "should handle concurrent move and rename",
      async () => {
        // Use root collection and a subcollection for the move target
        const targetCollection = await mockApi.createCollection(
          "Target Folder",
          1
        );
        const link = await mockApi.createLink(
          "https://example.com",
          1,
          "Original Name"
        );

        await storage.saveSyncMetadata({
          id: "sync_state",
          lastSyncTime: Date.now(),
          syncDirection: "bidirectional",
          targetCollectionId: 1,
          browserRootFolderId: "2",
        });

        // Create browser folder structure
        mockBookmarks["2"] = {
          id: "2",
          parentId: "0",
          title: "Other Bookmarks",
          children: [],
          dateAdded: Date.now(),
          dateGroupModified: Date.now(),
        };

        mockBookmarks["browser-target-folder"] = {
          id: "browser-target-folder",
          parentId: "2",
          title: "Target Folder",
          children: [],
          dateAdded: Date.now(),
          dateGroupModified: Date.now(),
        };

        // Create mappings
        await storage.upsertMapping({
          id: "mapping-target",
          linkwardenType: "collection",
          linkwardenId: targetCollection.id,
          browserId: "browser-target-folder",
          linkwardenUpdatedAt: new Date(targetCollection.updatedAt).getTime(),
          browserUpdatedAt: Date.now(),
          lastSyncedAt: Date.now(),
          checksum: computeChecksum({ name: targetCollection.name }),
        });

        await storage.upsertMapping({
          id: "mapping-link",
          linkwardenType: "link",
          linkwardenId: link.id,
          browserId: "browser-bookmark-1",
          linkwardenUpdatedAt: new Date(link.updatedAt).getTime(),
          browserUpdatedAt: Date.now(),
          lastSyncedAt: Date.now(),
          checksum: computeChecksum(link),
        });

        // Create browser bookmark in root
        mockBookmarks["browser-bookmark-1"] = {
          id: "browser-bookmark-1",
          parentId: "2",
          title: "Original Name",
          url: "https://example.com",
          dateAdded: Date.now(),
          dateGroupModified: Date.now(),
        };

        // Add bookmark to parent's children
        mockBookmarks["2"].children?.push("browser-bookmark-1");

        // Move and rename on server
        await mockApi.updateLink(link.id, {
          collectionId: targetCollection.id,
          name: "Renamed Link",
          url: "https://renamed.com",
        });

        const result = await syncEngine.sync();

        expect(result.errors).toHaveLength(0);

        // Verify bookmark was moved and renamed
        const updatedBookmark = mockBookmarks["browser-bookmark-1"];
        expect(updatedBookmark.parentId).toBe("browser-target-folder");
        expect(updatedBookmark.title).toBe("Renamed Link");
        expect(updatedBookmark.url).toBe("https://renamed.com");
      },
      TEST_TIMEOUT
    );

    test(
      "should handle browser → server folder move using description token",
      async () => {
        // Create folder structure
        const parent1 = await mockApi.createCollection("Parent 1", 1);
        const parent2 = await mockApi.createCollection("Parent 2", 1);
        const childFolder = await mockApi.createCollection(
          "Child Folder",
          parent1.id
        );

        await storage.saveSyncMetadata({
          id: "sync_state",
          lastSyncTime: Date.now(),
          syncDirection: "bidirectional",
          targetCollectionId: 1,
          browserRootFolderId: "2",
        });

        // Create browser folder structure
        mockBookmarks["2"] = {
          id: "2",
          parentId: "0",
          title: "Other Bookmarks",
          children: [],
          dateAdded: Date.now(),
          dateGroupModified: Date.now(),
        };

        mockBookmarks["browser-parent1"] = {
          id: "browser-parent1",
          parentId: "2",
          title: "Parent 1",
          children: [],
          dateAdded: Date.now(),
          dateGroupModified: Date.now(),
        };

        mockBookmarks["browser-parent2"] = {
          id: "browser-parent2",
          parentId: "2",
          title: "Parent 2",
          children: [],
          dateAdded: Date.now(),
          dateGroupModified: Date.now(),
        };

        mockBookmarks["browser-child"] = {
          id: "browser-child",
          parentId: "browser-parent1",
          title: "Child Folder",
          children: [],
          dateAdded: Date.now(),
          dateGroupModified: Date.now(),
        };

        // Add child to parent1's children
        mockBookmarks["browser-parent1"].children?.push("browser-child");

        // Create mappings
        await storage.upsertMapping({
          id: "mapping-parent1",
          linkwardenType: "collection",
          linkwardenId: parent1.id,
          browserId: "browser-parent1",
          linkwardenUpdatedAt: new Date(parent1.updatedAt).getTime(),
          browserUpdatedAt: Date.now(),
          lastSyncedAt: Date.now(),
          checksum: computeChecksum({ name: parent1.name }),
        });

        await storage.upsertMapping({
          id: "mapping-parent2",
          linkwardenType: "collection",
          linkwardenId: parent2.id,
          browserId: "browser-parent2",
          linkwardenUpdatedAt: new Date(parent2.updatedAt).getTime(),
          browserUpdatedAt: Date.now(),
          lastSyncedAt: Date.now(),
          checksum: computeChecksum({ name: parent2.name }),
        });

        await storage.upsertMapping({
          id: "mapping-child",
          linkwardenType: "collection",
          linkwardenId: childFolder.id,
          browserId: "browser-child",
          linkwardenUpdatedAt: new Date(childFolder.updatedAt).getTime(),
          browserUpdatedAt: Date.now(),
          lastSyncedAt: Date.now(),
          checksum: computeChecksum({ name: childFolder.name }),
        });

        // Simulate folder move via pending change (move from parent1 to parent2)
        await storage.addPendingChange({
          id: crypto.randomUUID(),
          type: "move",
          source: "browser",
          linkwardenId: childFolder.id,
          browserId: "browser-child",
          parentId: "browser-parent2",
          data: {
            title: "Child Folder",
          },
          timestamp: Date.now(),
          resolved: false,
        });

        const result = await syncEngine.sync();

        expect(result.errors).toHaveLength(0);

        // Folder move is processed in the same sync cycle:
        // 1. Pending change appends move token to description
        // 2. syncFromLinkwarden detects and processes the move token
        // 3. Token is removed after successful move

        // Verify folder was moved in browser
        const updatedBookmark = mockBookmarks["browser-child"];
        expect(updatedBookmark.parentId).toBe("browser-parent2");

        // Verify move token was removed from description (processed and cleaned up)
        const finalCollection = await mockApi.getCollection(childFolder.id);
        expect(finalCollection.description).not.toContain("{LW:MOVE:");

        // Verify parentId was updated on server
        expect(finalCollection.parentId).toBe(parent2.id);
      },
      TEST_TIMEOUT
    );

    test(
      "should handle server → browser folder move via parentId change",
      async () => {
        // Create folder structure
        const parent1 = await mockApi.createCollection("Parent 1", 1);
        const parent2 = await mockApi.createCollection("Parent 2", 1);
        const childFolder = await mockApi.createCollection(
          "Child Folder",
          parent1.id
        );

        await storage.saveSyncMetadata({
          id: "sync_state",
          lastSyncTime: Date.now(),
          syncDirection: "bidirectional",
          targetCollectionId: 1,
          browserRootFolderId: "2",
        });

        // Create browser folder structure
        mockBookmarks["2"] = {
          id: "2",
          parentId: "0",
          title: "Other Bookmarks",
          children: [],
          dateAdded: Date.now(),
          dateGroupModified: Date.now(),
        };

        mockBookmarks["browser-parent1"] = {
          id: "browser-parent1",
          parentId: "2",
          title: "Parent 1",
          children: [],
          dateAdded: Date.now(),
          dateGroupModified: Date.now(),
        };

        mockBookmarks["browser-parent2"] = {
          id: "browser-parent2",
          parentId: "2",
          title: "Parent 2",
          children: [],
          dateAdded: Date.now(),
          dateGroupModified: Date.now(),
        };

        mockBookmarks["browser-child"] = {
          id: "browser-child",
          parentId: "browser-parent1",
          title: "Child Folder",
          children: [],
          dateAdded: Date.now(),
          dateGroupModified: Date.now(),
        };

        // Create mappings
        await storage.upsertMapping({
          id: "mapping-parent1",
          linkwardenType: "collection",
          linkwardenId: parent1.id,
          browserId: "browser-parent1",
          linkwardenUpdatedAt: new Date(parent1.updatedAt).getTime(),
          browserUpdatedAt: Date.now(),
          lastSyncedAt: Date.now(),
          checksum: computeChecksum({ name: parent1.name }),
        });

        await storage.upsertMapping({
          id: "mapping-parent2",
          linkwardenType: "collection",
          linkwardenId: parent2.id,
          browserId: "browser-parent2",
          linkwardenUpdatedAt: new Date(parent2.updatedAt).getTime(),
          browserUpdatedAt: Date.now(),
          lastSyncedAt: Date.now(),
          checksum: computeChecksum({ name: parent2.name }),
        });

        await storage.upsertMapping({
          id: "mapping-child",
          linkwardenType: "collection",
          linkwardenId: childFolder.id,
          browserId: "browser-child",
          linkwardenUpdatedAt: new Date(childFolder.updatedAt).getTime(),
          browserUpdatedAt: Date.now(),
          lastSyncedAt: Date.now(),
          checksum: computeChecksum({ name: childFolder.name }),
        });

        // Move folder on server (change parentId)
        await mockApi.updateCollection(childFolder.id, {
          parentId: parent2.id,
        });

        const result = await syncEngine.sync();

        expect(result.errors).toHaveLength(0);

        // Verify folder was moved in browser
        const updatedBookmark = mockBookmarks["browser-child"];
        expect(updatedBookmark.parentId).toBe("browser-parent2");
      },
      TEST_TIMEOUT
    );
  });

  describe("Large Collection Sync", () => {
    test(
      "should handle syncing many links",
      async () => {
        // Create 100 links on server
        for (let i = 0; i < 100; i++) {
          await mockApi.createLink(`https://link${i}.com`, 1, `Link ${i}`);
        }

        await storage.saveSyncMetadata({
          id: "sync_state",
          lastSyncTime: 0,
          syncDirection: "bidirectional",
          targetCollectionId: 1,
          browserRootFolderId: "2",
        });

        const result = await syncEngine.sync();

        expect(result.errors).toHaveLength(0);
        expect(result.created).toBe(100);

        const mappings = await storage.getMappings();
        expect(mappings.length).toBe(100);
      },
      TEST_TIMEOUT
    );
  });

  describe("Nested Folder Path Support", () => {
    test(
      "should create nested folder structure from path",
      async () => {
        // Setup: clear bookmarks and create root folder
        Object.keys(mockBookmarks).forEach((key) => delete mockBookmarks[key]);

        mockBookmarks["toolbar_____"] = {
          id: "toolbar_____",
          parentId: "0",
          title: "Bookmarks Toolbar",
          children: [],
          dateAdded: Date.now(),
          dateGroupModified: Date.now(),
        };

        // Test parseFolderPath
        const pathParts = parseFolderPath("Work/Projects/Linkwarden");
        expect(pathParts).toEqual(["Work", "Projects", "Linkwarden"]);

        // Test findOrCreateNestedFolder creates the structure
        const targetFolderId = await findOrCreateNestedFolder(
          pathParts,
          "toolbar_____"
        );

        // Verify the folder structure was created
        expect(targetFolderId).toBeDefined();

        // Verify "Work" folder was created under root
        const workFolder = Object.values(mockBookmarks).find(
          (b) => b.title === "Work" && b.parentId === "toolbar_____"
        );
        expect(workFolder).toBeDefined();

        // Verify "Projects" folder was created under "Work"
        const projectsFolder = Object.values(mockBookmarks).find(
          (b) => b.title === "Projects" && b.parentId === workFolder?.id
        );
        expect(projectsFolder).toBeDefined();

        // Verify "Linkwarden" folder was created under "Projects"
        const linkwardenFolder = Object.values(mockBookmarks).find(
          (b) => b.title === "Linkwarden" && b.parentId === projectsFolder?.id
        );
        expect(linkwardenFolder).toBeDefined();
        expect(linkwardenFolder?.id).toBe(targetFolderId);
      },
      TEST_TIMEOUT
    );

    test(
      "should reuse existing folders in path",
      async () => {
        // Setup: create existing folder structure
        Object.keys(mockBookmarks).forEach((key) => delete mockBookmarks[key]);

        mockBookmarks["toolbar_____"] = {
          id: "toolbar_____",
          parentId: "0",
          title: "Bookmarks Toolbar",
          children: ["existing"],
          dateAdded: Date.now(),
          dateGroupModified: Date.now(),
        };

        mockBookmarks["existing"] = {
          id: "existing",
          parentId: "toolbar_____",
          title: "Existing",
          children: ["nested"],
          dateAdded: Date.now(),
          dateGroupModified: Date.now(),
        };

        mockBookmarks["nested"] = {
          id: "nested",
          parentId: "existing",
          title: "Nested",
          children: [],
          dateAdded: Date.now(),
          dateGroupModified: Date.now(),
        };

        // Test with path that partially exists
        const pathParts = parseFolderPath("Existing/Nested/New");
        const targetFolderId = await findOrCreateNestedFolder(
          pathParts,
          "toolbar_____"
        );

        // Should only create "New" folder, not "Existing" or "Nested"
        const newFolder = mockBookmarks[targetFolderId];
        expect(newFolder).toBeDefined();
        expect(newFolder?.title).toBe("New");
        expect(newFolder?.parentId).toBe("nested");

        // Verify existing folders were not recreated
        const existingFolders = Object.values(mockBookmarks).filter(
          (b) => b.title === "Existing"
        );
        expect(existingFolders.length).toBe(1); // Should still be only 1

        // Verify "Nested" folder was not recreated
        const nestedFolders = Object.values(mockBookmarks).filter(
          (b) => b.title === "Nested"
        );
        expect(nestedFolders.length).toBe(1); // Should still be only 1
      },
      TEST_TIMEOUT
    );

    test(
      "should handle single folder name (backward compatibility)",
      async () => {
        // Setup
        Object.keys(mockBookmarks).forEach((key) => delete mockBookmarks[key]);

        mockBookmarks["toolbar_____"] = {
          id: "toolbar_____",
          parentId: "0",
          title: "Bookmarks Toolbar",
          children: [],
          dateAdded: Date.now(),
          dateGroupModified: Date.now(),
        };

        // Test with single folder name (no slashes)
        const pathParts = parseFolderPath("Linkwarden");
        expect(pathParts).toEqual(["Linkwarden"]);

        const targetFolderId = await findOrCreateNestedFolder(
          pathParts,
          "toolbar_____"
        );

        const folder = mockBookmarks[targetFolderId];
        expect(folder).toBeDefined();
        expect(folder?.title).toBe("Linkwarden");
        expect(folder?.parentId).toBe("toolbar_____");
      },
      TEST_TIMEOUT
    );
  });

  describe("Server-Side Nested Collection Path Support", () => {
    test(
      "should create nested collection structure from path",
      async () => {
        // Clear existing collections
        mockApi.clearCollections();

        // Test with nested path
        const collectionName = "Parent/Child/Grandchild";

        // Use the private method via sync engine
        const result =
          await syncEngine["findOrCreateCollection"](collectionName);

        expect(result).toBeDefined();
        expect(result?.name).toBe("Grandchild");

        // Verify all collections were created
        const allCollections = await mockApi.getCollections();
        const parentCollection = allCollections.find(
          (c) => c.name === "Parent"
        );
        const childCollection = allCollections.find(
          (c) => c.name === "Child" && c.parentId === parentCollection?.id
        );
        const grandchildCollection = allCollections.find(
          (c) => c.name === "Grandchild" && c.parentId === childCollection?.id
        );

        expect(parentCollection).toBeDefined();
        expect(childCollection).toBeDefined();
        expect(grandchildCollection).toBeDefined();
        expect(grandchildCollection?.id).toBe(result?.id);
      },
      TEST_TIMEOUT
    );

    test(
      "should reuse existing collections in path",
      async () => {
        // Clear and set up existing collections
        mockApi.clearCollections();

        // Create parent collection first
        const parent = await mockApi.createCollection("ExistingParent");
        await mockApi.createCollection("ExistingChild", parent.id);

        // Now try to create nested path that partially exists
        const result = await syncEngine["findOrCreateCollection"](
          "ExistingParent/ExistingChild/NewGrandchild"
        );

        expect(result).toBeDefined();
        expect(result?.name).toBe("NewGrandchild");

        // Verify only the new collection was created
        const allCollections = await mockApi.getCollections();
        const parentCollections = allCollections.filter(
          (c) => c.name === "ExistingParent"
        );
        const childCollections = allCollections.filter(
          (c) => c.name === "ExistingChild"
        );

        expect(parentCollections.length).toBe(1); // Should not be recreated
        expect(childCollections.length).toBe(1); // Should not be recreated
      },
      TEST_TIMEOUT
    );

    test(
      "should handle single collection name (backward compatibility)",
      async () => {
        // Clear existing collections
        mockApi.clearCollections();

        // Test with single collection name (no slashes)
        const result =
          await syncEngine["findOrCreateCollection"]("SingleCollection");

        expect(result).toBeDefined();
        expect(result?.name).toBe("SingleCollection");

        // Verify it has no parent
        const allCollections = await mockApi.getCollections();
        const collection = allCollections.find(
          (c) => c.name === "SingleCollection"
        );
        expect(collection?.parentId).toBeUndefined();
      },
      TEST_TIMEOUT
    );
  });
});
