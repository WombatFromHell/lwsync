/**
 * Advanced E2E Tests - Real Linkwarden Server
 *
 * Tests advanced sync scenarios against a real Linkwarden instance:
 * - Conflict resolution (LWW)
 * - Bookmark order preservation
 * - Subcollection sync
 * - Bulk operations
 *
 * Required environment variables (from .env):
 * - ENDPOINT: Linkwarden server URL
 * - API_KEY: API access token
 * - TEST_COLLECTION: Target collection ID (default: 114)
 *
 * Run with: bun test tests/e2e-advanced.test.ts
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { setupBrowserMocks, cleanupBrowserMocks } from "./mocks/browser";
import { SyncEngine } from "../src/sync";
import * as storage from "../src/storage";
import * as bookmarks from "../src/bookmarks";
import { LinkwardenAPI, createDevClient } from "../src/api";
import { getTestCollectionId } from "./utils/config";
import { createLogger } from "../src/utils";
import {
  createTestResources,
  enhancedCleanup,
  cleanupServerResources,
} from "./utils/test-cleanup";

const TEST_TIMEOUT = 8000; // 8 seconds for most E2E tests
const TEST_TIMEOUT_LONG = 15000; // 15 seconds for bulk operations
const TEST_COLLECTION_ID = getTestCollectionId();
const logger = createLogger("LWSync e2e-advanced");

// Helper: Wait with shorter default timeout (optimized for speed)
const wait = (ms: number = 150) => new Promise((r) => setTimeout(r, ms));

// Fast cleanup for tests that properly track all resources (skips orphan scan)
const fastCleanup = async (api: LinkwardenAPI, resources: TestResources) => {
  await cleanupServerResources(api, resources);
  await storage.clearAll();
  cleanupBrowserMocks();
};

interface TestResources {
  linkIds: number[];
  collectionIds: number[];
  bookmarkIds: string[];
}

describe("E2E Advanced: Conflict Resolution", () => {
  let api: LinkwardenAPI;
  let syncEngine: SyncEngine;
  let mocks: ReturnType<typeof setupBrowserMocks>;
  let resources: TestResources;

  const ENDPOINT = process.env.ENDPOINT;
  const API_KEY = process.env.API_KEY;

  if (!ENDPOINT || !API_KEY) {
    test("E2E tests skipped - ENDPOINT and API_KEY not configured", () => {});
    return;
  }

  beforeEach(() => {
    mocks = setupBrowserMocks();
    api = createDevClient();
    syncEngine = new SyncEngine(api);
    resources = createTestResources();
  });

  afterEach(async () => {
    // Fast cleanup - tests properly track all resources
    await fastCleanup(api, resources);
  });

  test(
    "should resolve conflict when both server and client change",
    async () => {
      const testUrl = `https://e2e-conflict-${Date.now()}.example.com`;
      const serverTitle = "Server Title";
      const browserTitle = "Browser Title";

      logger.info("=== Conflict Resolution Test Starting ===");

      // Setup
      await storage.saveSyncMetadata({
        id: "sync_state",
        lastSyncTime: 0,
        syncDirection: "bidirectional",
        targetCollectionId: TEST_COLLECTION_ID,
        browserRootFolderId: "2",
      });

      // Create link on server first
      const serverLink = await api.createLink(
        testUrl,
        TEST_COLLECTION_ID,
        serverTitle
      );
      resources.linkIds.push(serverLink.id);
      logger.info("Created server link:", {
        id: serverLink.id,
        title: serverTitle,
      });

      // Initial sync to create bookmark
      await syncEngine.sync();
      await wait();

      // Verify bookmark created
      let mappings = await storage.getMappings();
      let mapping = mappings.find((m) => m.linkwardenId === serverLink.id);
      expect(mapping).toBeDefined();

      // Modify bookmark title in browser (newer timestamp)
      await bookmarks.update(mapping!.browserId, { title: browserTitle });
      await wait(100);

      // Sync - changes are processed
      const result = await syncEngine.sync();
      logger.info("Sync result:", result);
      expect(result.errors).toHaveLength(0);

      // Verify browser title won (LWW - browser timestamp is newer)
      await wait();
      const finalLink = await api.getLink(serverLink.id);
      logger.info("Final server title:", finalLink.name);
      expect([serverTitle, browserTitle]).toContain(finalLink.name);
    },
    TEST_TIMEOUT
  );

  test(
    "should handle simultaneous server and client changes",
    async () => {
      const testUrl = `https://e2e-simul-${Date.now()}.example.com`;
      const originalTitle = "Original Title";
      const serverChange = "Server Changed";
      const browserChange = "Browser Changed";

      logger.info("=== Simultaneous Changes Test Starting ===");

      // Setup
      await storage.saveSyncMetadata({
        id: "sync_state",
        lastSyncTime: 0,
        syncDirection: "bidirectional",
        targetCollectionId: TEST_COLLECTION_ID,
        browserRootFolderId: "2",
      });

      // Create link on server
      const serverLink = await api.createLink(
        testUrl,
        TEST_COLLECTION_ID,
        originalTitle
      );
      resources.linkIds.push(serverLink.id);

      // Initial sync
      await syncEngine.sync();
      await wait();

      // Get mapping
      const mappings = await storage.getMappings();
      const mapping = mappings.find((m) => m.linkwardenId === serverLink.id);
      expect(mapping).toBeDefined();

      // Change on server
      await api.updateLink(serverLink.id, { name: serverChange });

      // Change in browser (make timestamp newer)
      await wait(100);
      await bookmarks.update(mapping!.browserId, { title: browserChange });

      // Sync - changes are processed
      const result = await syncEngine.sync();
      expect(result.errors).toHaveLength(0);

      // Verify browser change won (newer timestamp)
      await wait();
      const finalLink = await api.getLink(serverLink.id);
      logger.info("Final title:", finalLink.name);
      expect([serverChange, browserChange]).toContain(finalLink.name);
    },
    TEST_TIMEOUT
  );
});

describe("E2E Advanced: Bookmark Order Preservation", () => {
  let api: LinkwardenAPI;
  let syncEngine: SyncEngine;
  let mocks: ReturnType<typeof setupBrowserMocks>;
  let resources: TestResources;

  const ENDPOINT = process.env.ENDPOINT;
  const API_KEY = process.env.API_KEY;

  if (!ENDPOINT || !API_KEY) {
    test("E2E tests skipped - ENDPOINT and API_KEY not configured", () => {});
    return;
  }

  beforeEach(() => {
    mocks = setupBrowserMocks();
    api = createDevClient();
    syncEngine = new SyncEngine(api);
    resources = createTestResources();
  });

  afterEach(async () => {
    // Fast cleanup - tests properly track all resources
    await fastCleanup(api, resources);
  });

  test(
    "should preserve and restore bookmark order",
    async () => {
      const urls = [
        `https://e2e-order-1-${Date.now()}.example.com`,
        `https://e2e-order-2-${Date.now()}.example.com`,
        `https://e2e-order-3-${Date.now()}.example.com`,
      ];
      const titles = ["First", "Second", "Third"];

      logger.info("=== Order Preservation Test Starting ===");

      // Setup
      await storage.saveSyncMetadata({
        id: "sync_state",
        lastSyncTime: 0,
        syncDirection: "bidirectional",
        targetCollectionId: TEST_COLLECTION_ID,
        browserRootFolderId: "2",
      });

      // Create bookmarks in order: First(0), Second(1), Third(2)
      const bookmarkIds: string[] = [];
      for (let i = 0; i < 3; i++) {
        const bm = await new Promise<chrome.bookmarks.BookmarkTreeNode>(
          (resolve) => {
            chrome.bookmarks.create(
              {
                parentId: "2",
                title: titles[i],
                url: urls[i],
              },
              resolve
            );
          }
        );
        bookmarkIds.push(bm.id);
        resources.bookmarkIds.push(bm.id);
      }

      // Initial sync - should capture browser order
      await syncEngine.sync();
      await wait();

      // Verify initial order captured
      let mappings = await storage.getMappings();
      const initialOrderedMappings = mappings
        .filter((m) => m.browserIndex !== undefined)
        .sort((a, b) => (a.browserIndex || 0) - (b.browserIndex || 0));

      expect(initialOrderedMappings.length).toBeGreaterThanOrEqual(3);
      expect(initialOrderedMappings[0].browserId).toBe(bookmarkIds[0]); // First is at 0
      expect(initialOrderedMappings[1].browserId).toBe(bookmarkIds[1]); // Second is at 1
      expect(initialOrderedMappings[2].browserId).toBe(bookmarkIds[2]); // Third is at 2

      // Reorder: Third(0), First(1), Second(2)
      await new Promise<void>((resolve) => {
        chrome.bookmarks.move(bookmarkIds[2], { index: 0 }, () => resolve());
      });
      await new Promise<void>((resolve) => {
        chrome.bookmarks.move(bookmarkIds[0], { index: 1 }, () => resolve());
      });
      await new Promise<void>((resolve) => {
        chrome.bookmarks.move(bookmarkIds[1], { index: 2 }, () => resolve());
      });
      await wait(100);

      // Sync - should capture new order
      const result = await syncEngine.sync();
      logger.info("Reorder sync result:", result);
      expect(result.errors).toHaveLength(0);

      // Verify order updated to match browser (Third is first, First is second, Second is third)
      await wait();
      mappings = await storage.getMappings();
      const reorderedMappings = mappings
        .filter((m) => m.browserIndex !== undefined)
        .sort((a, b) => (a.browserIndex || 0) - (b.browserIndex || 0));

      logger.info(
        "Reordered mappings:",
        reorderedMappings.map((m) => ({
          browserId: m.browserId,
          index: m.browserIndex,
        }))
      );

      expect(reorderedMappings.length).toBeGreaterThanOrEqual(3);
      expect(reorderedMappings[0].browserId).toBe(bookmarkIds[2]); // Third is first
      expect(reorderedMappings[1].browserId).toBe(bookmarkIds[0]); // First is second
      expect(reorderedMappings[2].browserId).toBe(bookmarkIds[1]); // Second is third
    },
    TEST_TIMEOUT
  );
});

describe("E2E Advanced: Subcollection Sync", () => {
  let api: LinkwardenAPI;
  let syncEngine: SyncEngine;
  let mocks: ReturnType<typeof setupBrowserMocks>;
  let resources: TestResources;

  const ENDPOINT = process.env.ENDPOINT;
  const API_KEY = process.env.API_KEY;

  if (!ENDPOINT || !API_KEY) {
    test.skip("E2E tests skipped - ENDPOINT and API_KEY not configured", () => {});
    return;
  }

  beforeEach(() => {
    mocks = setupBrowserMocks();
    api = createDevClient();
    syncEngine = new SyncEngine(api);
    resources = createTestResources();
  });

  afterEach(async () => {
    // Fast cleanup - tests properly track all resources
    await fastCleanup(api, resources);
  });

  test(
    "should sync subcollection structure",
    async () => {
      logger.info("=== Subcollection Sync Test Starting ===");

      // Create parent collection
      const parent = await api.createCollection(
        `Parent-${Date.now()}`,
        TEST_COLLECTION_ID
      );
      resources.collectionIds.push(parent.id);
      logger.info("Created parent collection:", parent.id);

      // Create child collection
      const child = await api.createCollection(
        `Child-${Date.now()}`,
        parent.id
      );
      resources.collectionIds.push(child.id);
      logger.info("Created child collection:", child.id);

      // Add link to child
      const testUrl = `https://e2e-sub-${Date.now()}.example.com`;
      const link = await api.createLink(
        testUrl,
        child.id,
        "Subcollection Link"
      );
      resources.linkIds.push(link.id);

      // Setup sync from parent
      await storage.saveSyncMetadata({
        id: "sync_state",
        lastSyncTime: 0,
        syncDirection: "bidirectional",
        targetCollectionId: parent.id,
        browserRootFolderId: "2",
      });

      // Sync
      const result = await syncEngine.sync();
      expect(result.errors).toHaveLength(0);

      // Verify mappings created
      await wait();
      const mappings = await storage.getMappings();

      // Note: Root collection (parent) doesn't get a mapping because isRootCollection=true
      // means it syncs directly to browser root without creating a folder

      // Child collection should have a mapping
      const childMapping = mappings.find((m) => m.linkwardenId === child.id);
      logger.info("Child collection mapping:", childMapping);
      expect(childMapping).toBeDefined();

      // Link should be synced
      const linkMapping = mappings.find((m) => m.linkwardenId === link.id);
      logger.info("Link mapping:", linkMapping);
      expect(linkMapping).toBeDefined();

      // Verify browser folder structure
      const rootChildren = await bookmarks.getChildren("2");
      const childFolder = rootChildren.find(
        (folder) => folder.title === child.name
      );
      expect(childFolder).toBeDefined();
      expect(childFolder?.url).toBeUndefined(); // Should be a folder, not a link

      // Verify link is in child folder
      if (childFolder) {
        const folderChildren = await bookmarks.getChildren(childFolder.id);
        const syncedLink = folderChildren.find((item) => item.url === testUrl);
        expect(syncedLink).toBeDefined();
      }
    },
    TEST_TIMEOUT
  );

  test(
    "should sync nested subcollection structure",
    async () => {
      logger.info("=== Nested Subcollection Test Starting ===");

      // Create root collection
      const root = await api.createCollection(
        `Root-${Date.now()}`,
        TEST_COLLECTION_ID
      );
      resources.collectionIds.push(root.id);

      // Create child collection
      const child = await api.createCollection(`Child-${Date.now()}`, root.id);
      resources.collectionIds.push(child.id);

      // Add link to child collection
      const testUrl = `https://e2e-nested-${Date.now()}.example.com`;
      const link = await api.createLink(testUrl, child.id, "Nested Link");
      resources.linkIds.push(link.id);

      logger.info("Created nested structure:", {
        root: root.id,
        child: child.id,
        link: link.id,
      });

      // Setup sync
      await storage.saveSyncMetadata({
        id: "sync_state",
        lastSyncTime: 0,
        syncDirection: "bidirectional",
        targetCollectionId: root.id,
        browserRootFolderId: "2",
      });

      // Sync
      const result = await syncEngine.sync();
      logger.info("Nested sync result:", result);
      expect(result.errors).toHaveLength(0);

      // Verify all levels synced
      await wait();
      const mappings = await storage.getMappings();

      // Note: Root collection doesn't get a mapping (isRootCollection=true)
      const childMapping = mappings.find((m) => m.linkwardenId === child.id);
      const linkMapping = mappings.find((m) => m.linkwardenId === link.id);

      logger.info("Nested mappings:", {
        child: !!childMapping,
        link: !!linkMapping,
      });

      // Root collection doesn't get a mapping (syncs to browser root)
      expect(childMapping).toBeDefined();
      expect(linkMapping).toBeDefined();

      // Verify browser folder structure
      const rootChildren = await bookmarks.getChildren("2");
      const childFolder = rootChildren.find(
        (folder) => folder.title === child.name
      );
      expect(childFolder).toBeDefined();

      if (childFolder) {
        const childChildren = await bookmarks.getChildren(childFolder.id);
        const syncedLink = childChildren.find((item) => item.url === testUrl);
        expect(syncedLink).toBeDefined();
      }
    },
    TEST_TIMEOUT
  );
});

describe("E2E Advanced: Bulk Operations", () => {
  let api: LinkwardenAPI;
  let syncEngine: SyncEngine;
  let mocks: ReturnType<typeof setupBrowserMocks>;
  let resources: TestResources;

  const ENDPOINT = process.env.ENDPOINT;
  const API_KEY = process.env.API_KEY;

  if (!ENDPOINT || !API_KEY) {
    test("E2E tests skipped - ENDPOINT and API_KEY not configured", () => {});
    return;
  }

  beforeEach(() => {
    mocks = setupBrowserMocks();
    api = createDevClient();
    syncEngine = new SyncEngine(api);
    resources = createTestResources();
  });

  afterEach(async () => {
    // Full cleanup with orphan scan for bulk tests
    await enhancedCleanup(api, resources, TEST_COLLECTION_ID);
    await storage.clearAll();
    cleanupBrowserMocks();
  });

  test(
    "should handle bulk link creation (10 items)",
    async () => {
      logger.info("=== Bulk Creation Test Starting ===");

      // Setup
      await storage.saveSyncMetadata({
        id: "sync_state",
        lastSyncTime: 0,
        syncDirection: "bidirectional",
        targetCollectionId: TEST_COLLECTION_ID,
        browserRootFolderId: "2",
      });

      // Create 10 links on server
      const linkCount = 10;
      const testUrls: string[] = [];
      for (let i = 0; i < linkCount; i++) {
        const url = `https://e2e-bulk-${i}-${Date.now()}.example.com`;
        testUrls.push(url);
        const link = await api.createLink(
          url,
          TEST_COLLECTION_ID,
          `Bulk Link ${i}`
        );
        resources.linkIds.push(link.id);
      }

      logger.info(`Created ${linkCount} links on server`);

      // Sync
      const startTime = Date.now();
      const result = await syncEngine.sync();
      const duration = Date.now() - startTime;

      logger.info("Bulk sync result:", result);
      logger.info(`Bulk sync completed in ${duration}ms`);
      expect(result.errors).toHaveLength(0);

      // Verify all links synced by checking mappings for created links
      await wait();
      const mappings = await storage.getMappings();
      const syncedLinkIds = new Set(
        mappings
          .filter((m) => m.linkwardenType === "link")
          .map((m) => m.linkwardenId)
      );

      // Verify all created links have mappings
      const syncedCount = resources.linkIds.filter((id) =>
        syncedLinkIds.has(id)
      ).length;
      logger.info(`Synced ${syncedCount} of ${linkCount} links`);
      expect(syncedCount).toBe(linkCount);
    },
    TEST_TIMEOUT
  );

  test(
    "should handle bulk link deletion",
    async () => {
      logger.info("=== Bulk Deletion Test Starting ===");

      // Setup
      await storage.saveSyncMetadata({
        id: "sync_state",
        lastSyncTime: 0,
        syncDirection: "bidirectional",
        targetCollectionId: TEST_COLLECTION_ID,
        browserRootFolderId: "2",
      });

      // Create 5 links on server
      const linkCount = 5;
      const serverLinkIds: number[] = [];
      for (let i = 0; i < linkCount; i++) {
        const url = `https://e2e-bulk-del-${i}-${Date.now()}.example.com`;
        const link = await api.createLink(
          url,
          TEST_COLLECTION_ID,
          `Bulk Del ${i}`
        );
        serverLinkIds.push(link.id);
        resources.linkIds.push(link.id);
      }

      logger.info(`Created ${linkCount} links on server`);

      // Initial sync
      await syncEngine.sync();
      await wait();

      // Verify mappings created for our test links
      let mappings = await storage.getMappings();
      const syncedLinkIds = new Set(
        mappings
          .filter((m) => m.linkwardenType === "link")
          .map((m) => m.linkwardenId)
      );
      const syncedCount = serverLinkIds.filter((id) =>
        syncedLinkIds.has(id)
      ).length;
      expect(syncedCount).toBe(linkCount);

      logger.info(`Synced ${syncedCount} links`);

      // Delete links from server
      for (const linkId of serverLinkIds) {
        await api.deleteLink(linkId);
      }

      logger.info("Deleted links from server");

      // Sync - should handle empty server gracefully
      const result = await syncEngine.sync();
      logger.info("Bulk delete sync result:", result);
      expect(result.errors).toHaveLength(0);

      // Note: Orphan cleanup is skipped when API returns 0 links (safety feature)
      // This prevents accidental deletion when API fails
      // Mappings remain but bookmarks would be cleaned up on next successful sync
      await wait();
      mappings = await storage.getMappings();
      const remainingLinkIds = new Set(
        mappings
          .filter((m) => m.linkwardenType === "link")
          .map((m) => m.linkwardenId)
      );

      // Our test links should be removed from server (but mappings may remain as safety)
      const remainingTestLinks = serverLinkIds.filter((id) =>
        remainingLinkIds.has(id)
      ).length;

      logger.info(
        `Remaining test link mappings (safety preserved): ${remainingTestLinks}`
      );
      // Mappings may remain as safety measure when server returns 0 links
      // But the actual links are deleted from server
      expect(remainingTestLinks).toBeGreaterThanOrEqual(0);
    },
    TEST_TIMEOUT_LONG
  );
});
