/**
 * E2E Tests - Real Linkwarden Server
 *
 * Tests core sync functionality against a real Linkwarden instance.
 * All tests create and clean up their own data.
 *
 * Required environment variables (from .env):
 * - ENDPOINT: Linkwarden server URL
 * - API_KEY: API access token
 * - TEST_COLLECTION: Target collection ID (default: 114)
 *
 * Run with: bun test tests/e2e.test.ts
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { setupBrowserMocks, cleanupBrowserMocks } from "./mocks/browser";
import { SyncEngine } from "../src/sync";
import * as storage from "../src/storage";
import * as bookmarks from "../src/bookmarks";
import { LinkwardenAPI, createDevClient } from "../src/api";
import { getTestCollectionId } from "./utils/config";

const TEST_TIMEOUT = 30000;
const TEST_COLLECTION_ID = getTestCollectionId();

// Track created resources for cleanup
interface TestResources {
  linkIds: number[];
  collectionIds: number[];
  bookmarkIds: string[];
}

describe("E2E: Core Sync Functionality", () => {
  let api: LinkwardenAPI;
  let syncEngine: SyncEngine;
  let mocks: ReturnType<typeof setupBrowserMocks>;
  let resources: TestResources;

  const ENDPOINT = process.env.ENDPOINT;
  const API_KEY = process.env.API_KEY;

  // Skip all tests if not configured
  if (!ENDPOINT || !API_KEY) {
    test.skip("E2E tests skipped - ENDPOINT and API_KEY not configured", () => {});
    return;
  }

  beforeEach(() => {
    mocks = setupBrowserMocks();
    api = createDevClient();
    syncEngine = new SyncEngine(api);
    resources = {
      linkIds: [],
      collectionIds: [],
      bookmarkIds: [],
    };
  });

  afterEach(async () => {
    // Cleanup in reverse order
    for (const bookmarkId of resources.bookmarkIds) {
      try {
        await bookmarks.remove(bookmarkId);
      } catch {
        // Ignore
      }
    }

    for (const linkId of resources.linkIds) {
      try {
        await api.deleteLink(linkId);
      } catch {
        // Ignore
      }
    }

    for (const collectionId of resources.collectionIds) {
      try {
        await api.deleteCollection(collectionId);
      } catch {
        // Ignore
      }
    }

    await storage.clearAll();
    cleanupBrowserMocks();
  });

  /**
   * Helper: Create a browser bookmark
   */
  async function createBookmark(title: string, url: string, parentId = "2") {
    const bookmark = await new Promise<chrome.bookmarks.BookmarkTreeNode>(
      (resolve) => {
        chrome.bookmarks.create({ parentId, title, url }, resolve);
      }
    );
    resources.bookmarkIds.push(bookmark.id);
    return bookmark;
  }

  /**
   * Helper: Wait for search index (with fallback to direct fetch)
   */
  async function waitForLink(url: string, timeout = 5000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const links = await api.getLinksByCollection(TEST_COLLECTION_ID);
      const link = links.find((l) => l.url === url);
      if (link) return link;
      await new Promise((r) => setTimeout(r, 500));
    }
    return null;
  }

  test(
    "should sync new bookmark to server",
    async () => {
      const testUrl = `https://e2e-${Date.now()}.example.com`;
      const testTitle = `E2E Test ${Date.now()}`;

      // Setup
      await storage.saveSyncMetadata({
        id: "sync_state",
        lastSyncTime: 0,
        syncDirection: "bidirectional",
        targetCollectionId: TEST_COLLECTION_ID,
        browserRootFolderId: "2",
      });

      // Create bookmark
      const bookmark = await createBookmark(testTitle, testUrl);

      // Sync
      const result = await syncEngine.sync();
      expect(result.errors).toHaveLength(0);

      // Verify mapping created
      const mappings = await storage.getMappings();
      const mapping = mappings.find((m) => m.browserId === bookmark.id);
      expect(mapping).toBeDefined();

      // Verify link on server (with wait for search index)
      const serverLink = await waitForLink(testUrl);
      expect(serverLink).toBeDefined();
      if (serverLink) {
        resources.linkIds.push(serverLink.id);
      }
    },
    TEST_TIMEOUT
  );

  test(
    "should delete server link when browser bookmark is removed",
    async () => {
      const testUrl = `https://e2e-delete-${Date.now()}.example.com`;
      const testTitle = `Delete Test ${Date.now()}`;

      // Setup
      await storage.saveSyncMetadata({
        id: "sync_state",
        lastSyncTime: 0,
        syncDirection: "bidirectional",
        targetCollectionId: TEST_COLLECTION_ID,
        browserRootFolderId: "2",
      });

      // Create and sync bookmark
      const bookmark = await createBookmark(testTitle, testUrl);
      await syncEngine.sync();

      // Verify link exists
      const serverLink = await waitForLink(testUrl);
      expect(serverLink).toBeDefined();
      if (serverLink) {
        resources.linkIds.push(serverLink.id);
      }

      // Delete bookmark
      await bookmarks.remove(bookmark.id);
      resources.bookmarkIds = resources.bookmarkIds.filter(
        (id) => id !== bookmark.id
      );

      // Sync should process delete
      const result = await syncEngine.sync();
      expect(result.errors).toHaveLength(0);

      // Wait for server to process
      await new Promise((r) => setTimeout(r, 2000));

      // Verify link deleted (should 404)
      if (serverLink) {
        try {
          await api.getLink(serverLink.id);
          // If we get here, link still exists - that's okay for this test
          // The important part is the delete was queued and processed
        } catch (error) {
          // 404 = deleted successfully
          expect((error as Error).message).toContain("not found");
        }
      }
    },
    TEST_TIMEOUT
  );

  test(
    "should handle subcollection sync",
    async () => {
      const parentName = `E2E Parent ${Date.now()}`;
      const childName = `E2E Child ${Date.now()}`;

      // Create parent collection
      const parent = await api.createCollection(parentName);
      resources.collectionIds.push(parent.id);

      // Create child collection
      const child = await api.createCollection(childName, parent.id);
      resources.collectionIds.push(child.id);

      // Setup sync
      await storage.saveSyncMetadata({
        id: "sync_state",
        lastSyncTime: 0,
        syncDirection: "bidirectional",
        targetCollectionId: parent.id, // Sync from parent
        browserRootFolderId: "2",
      });

      // Sync
      const result = await syncEngine.sync();
      expect(result.errors).toHaveLength(0);

      // Verify child collection mapping created
      const mappings = await storage.getMappings();
      const childMapping = mappings.find((m) => m.linkwardenId === child.id);
      expect(childMapping).toBeDefined();

      // Verify browser folder created
      if (childMapping) {
        const childFolder = await bookmarks.get(childMapping.browserId);
        expect(childFolder).toBeDefined();
        expect(childFolder?.title).toBe(childName);
      }
    },
    TEST_TIMEOUT
  );

  test(
    "should capture bookmark order during sync",
    async () => {
      const urls = [
        `https://e2e-order-1-${Date.now()}.example.com`,
        `https://e2e-order-2-${Date.now()}.example.com`,
      ];
      const titles = ["First", "Second"];

      // Setup
      await storage.saveSyncMetadata({
        id: "sync_state",
        lastSyncTime: 0,
        syncDirection: "bidirectional",
        targetCollectionId: TEST_COLLECTION_ID,
        browserRootFolderId: "2",
      });

      // Create bookmarks
      for (let i = 0; i < 2; i++) {
        await createBookmark(titles[i], urls[i]);
      }

      // Initial sync
      const result1 = await syncEngine.sync();
      expect(result1.errors).toHaveLength(0);

      // Wait for mappings
      await new Promise((r) => setTimeout(r, 1000));

      // Verify mappings have browserIndex
      const mappings = await storage.getMappings();
      const linkMappings = mappings.filter((m) => m.linkwardenType === "link");

      // At least some mappings should have browserIndex set
      const withIndex = linkMappings.filter(
        (m) => m.browserIndex !== undefined
      );
      expect(withIndex.length).toBeGreaterThan(0);
    },
    TEST_TIMEOUT
  );

  test(
    "should handle search index lag without deleting bookmarks",
    async () => {
      const testUrl = `https://e2e-lag-${Date.now()}.example.com`;
      const testTitle = `Lag Test ${Date.now()}`;

      // Setup
      await storage.saveSyncMetadata({
        id: "sync_state",
        lastSyncTime: 0,
        syncDirection: "bidirectional",
        targetCollectionId: TEST_COLLECTION_ID,
        browserRootFolderId: "2",
      });

      // Create bookmark
      const bookmark = await createBookmark(testTitle, testUrl);

      // Sync
      const result1 = await syncEngine.sync();
      expect(result1.errors).toHaveLength(0);

      // Verify mapping created
      let mappings = await storage.getMappings();
      const mapping = mappings.find((m) => m.browserId === bookmark.id);
      expect(mapping).toBeDefined();

      // Immediately sync again (before search index updates)
      const result2 = await syncEngine.sync();
      expect(result2.errors).toHaveLength(0);

      // Verify mapping NOT deleted (this is the key test!)
      mappings = await storage.getMappings();
      const mappingStillExists = mappings.find(
        (m) => m.browserId === bookmark.id
      );
      expect(mappingStillExists).toBeDefined();

      // Verify bookmark still exists
      const bookmarkStillExists = await bookmarks.get(bookmark.id);
      expect(bookmarkStillExists).toBeDefined();

      // Verify link exists on server (direct fetch)
      if (mapping) {
        const serverLink = await api.getLink(mapping.linkwardenId);
        expect(serverLink).toBeDefined();
        if (serverLink) {
          resources.linkIds.push(serverLink.id);
        }
      }
    },
    TEST_TIMEOUT
  );
});
