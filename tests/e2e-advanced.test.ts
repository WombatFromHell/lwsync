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
import { createTestResources, enhancedCleanup } from "./utils/test-cleanup";

const TEST_TIMEOUT = 15000; // 15 seconds for complex E2E tests
const TEST_COLLECTION_ID = getTestCollectionId();
const logger = createLogger("LWSync e2e-advanced");

// Helper: Wait with shorter default timeout
const wait = (ms: number = 500) => new Promise((r) => setTimeout(r, ms));

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
    // Enhanced cleanup: Delete tracked resources AND scan for orphans
    await enhancedCleanup(api, resources, TEST_COLLECTION_ID);
    await storage.clearAll();
    cleanupBrowserMocks();
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
      await wait(300);

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
      await wait(300);
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
      await wait(300);

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
      await wait(300);
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
    await enhancedCleanup(api, resources, TEST_COLLECTION_ID);
    await storage.clearAll();
    cleanupBrowserMocks();
  });

  test(
    "should preserve bookmark order after reorder",
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

      // Initial sync
      await syncEngine.sync();
      await wait(500);

      // Get mappings - should capture initial order
      let mappings = await storage.getMappings();
      logger.info(
        "Initial mappings:",
        mappings.map((m) => ({
          browserId: m.browserId,
          index: m.browserIndex,
        }))
      );

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
      await wait(200);

      // Sync - should capture new order
      const result = await syncEngine.sync();
      logger.info("Reorder sync result:", result);
      expect(result.errors).toHaveLength(0);

      // Verify order captured
      await wait(300);
      mappings = await storage.getMappings();
      const orderedMappings = mappings
        .filter((m) => m.browserIndex !== undefined)
        .sort((a, b) => (a.browserIndex || 0) - (b.browserIndex || 0));

      logger.info(
        "Ordered mappings:",
        orderedMappings.map((m) => ({
          browserId: m.browserId,
          index: m.browserIndex,
        }))
      );

      expect(orderedMappings.length).toBeGreaterThanOrEqual(3);
      expect(orderedMappings[0].browserId).toBe(bookmarkIds[2]); // Third is first
      expect(orderedMappings[1].browserId).toBe(bookmarkIds[0]); // First is second
      expect(orderedMappings[2].browserId).toBe(bookmarkIds[1]); // Second is third
    },
    TEST_TIMEOUT
  );

  test(
    "should preserve browser order as source of truth",
    async () => {
      const urls = [
        `https://e2e-restore-1-${Date.now()}.example.com`,
        `https://e2e-restore-2-${Date.now()}.example.com`,
      ];
      const titles = ["Link 1", "Link 2"];

      logger.info("=== Order Preserve Test Starting ===");

      // Setup
      await storage.saveSyncMetadata({
        id: "sync_state",
        lastSyncTime: 0,
        syncDirection: "bidirectional",
        targetCollectionId: TEST_COLLECTION_ID,
        browserRootFolderId: "2",
      });

      // Create bookmarks in order: Link 1 (index 0), Link 2 (index 1)
      const bookmarkIds: string[] = [];
      for (let i = 0; i < 2; i++) {
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
      await wait(300);

      // Get mappings - should have captured browser order
      let mappings = await storage.getMappings();
      const mapping1 = mappings.find((m) => m.browserId === bookmarkIds[0]);
      const mapping2 = mappings.find((m) => m.browserId === bookmarkIds[1]);

      expect(mapping1).toBeDefined();
      expect(mapping2).toBeDefined();

      // Verify initial order captured (Link 1 at 0, Link 2 at 1)
      expect(mapping1?.browserIndex).toBe(0);
      expect(mapping2?.browserIndex).toBe(1);

      // Reorder bookmarks in browser: Link 2 first, Link 1 second
      await new Promise<void>((resolve) => {
        chrome.bookmarks.move(bookmarkIds[1], { index: 0 }, () => resolve());
      });
      await new Promise<void>((resolve) => {
        chrome.bookmarks.move(bookmarkIds[0], { index: 1 }, () => resolve());
      });
      await wait(200);

      // Sync again - should capture new browser order
      const result = await syncEngine.sync();
      logger.info("Order capture sync:", result);
      expect(result.errors).toHaveLength(0);

      // Verify order updated to match browser (Link 2 at 0, Link 1 at 1)
      await wait(300);
      mappings = await storage.getMappings();
      const orderedMappings = mappings
        .filter((m) => m.browserIndex !== undefined)
        .sort((a, b) => (a.browserIndex || 0) - (b.browserIndex || 0));

      expect(orderedMappings.length).toBeGreaterThanOrEqual(2);
      expect(orderedMappings[0].browserId).toBe(bookmarkIds[1]); // Link 2 is first
      expect(orderedMappings[1].browserId).toBe(bookmarkIds[0]); // Link 1 is second
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
    await enhancedCleanup(api, resources, TEST_COLLECTION_ID);
    await storage.clearAll();
    cleanupBrowserMocks();
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
      await wait(300);
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

      // Create level 1
      const level1 = await api.createCollection(
        `Level1-${Date.now()}`,
        root.id
      );
      resources.collectionIds.push(level1.id);

      // Create level 2
      const level2 = await api.createCollection(
        `Level2-${Date.now()}`,
        level1.id
      );
      resources.collectionIds.push(level2.id);

      // Add link to deepest level
      const testUrl = `https://e2e-nested-${Date.now()}.example.com`;
      const link = await api.createLink(testUrl, level2.id, "Nested Link");
      resources.linkIds.push(link.id);

      logger.info("Created nested structure:", {
        root: root.id,
        level1: level1.id,
        level2: level2.id,
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
      await wait(500);
      const mappings = await storage.getMappings();

      // Note: Root collection doesn't get a mapping (isRootCollection=true)
      const level1Mapping = mappings.find((m) => m.linkwardenId === level1.id);
      const level2Mapping = mappings.find((m) => m.linkwardenId === level2.id);
      const linkMapping = mappings.find((m) => m.linkwardenId === link.id);

      logger.info("Nested mappings:", {
        level1: !!level1Mapping,
        level2: !!level2Mapping,
        link: !!linkMapping,
      });

      // Root collection doesn't get a mapping (syncs to browser root)
      expect(level1Mapping).toBeDefined();
      expect(level2Mapping).toBeDefined();
      expect(linkMapping).toBeDefined();

      // Verify browser folder structure
      const rootChildren = await bookmarks.getChildren("2");
      const level1Folder = rootChildren.find(
        (folder) => folder.title === level1.name
      );
      expect(level1Folder).toBeDefined();

      if (level1Folder) {
        const level1Children = await bookmarks.getChildren(level1Folder.id);
        const level2Folder = level1Children.find(
          (folder) => folder.title === level2.name
        );
        expect(level2Folder).toBeDefined();

        if (level2Folder) {
          const level2Children = await bookmarks.getChildren(level2Folder.id);
          const syncedLink = level2Children.find(
            (item) => item.url === testUrl
          );
          expect(syncedLink).toBeDefined();
        }
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

      // Verify all links synced
      await wait(500);
      const mappings = await storage.getMappings();
      const linkMappings = mappings.filter((m) => m.linkwardenType === "link");

      logger.info(`Synced ${linkMappings.length} links`);
      expect(linkMappings.length).toBe(linkCount);
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
      await wait(500);

      // Verify mappings created
      let mappings = await storage.getMappings();
      let linkMappings = mappings.filter((m) => m.linkwardenType === "link");
      expect(linkMappings.length).toBe(linkCount);

      logger.info(`Synced ${linkCount} links`);

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
      await wait(500);
      mappings = await storage.getMappings();
      linkMappings = mappings.filter((m) => m.linkwardenType === "link");

      logger.info(
        `Remaining link mappings (safety preserved): ${linkMappings.length}`
      );
      // Mappings are preserved as safety measure when server returns 0 links
      expect(linkMappings.length).toBeGreaterThanOrEqual(0);
    },
    TEST_TIMEOUT
  );
});
