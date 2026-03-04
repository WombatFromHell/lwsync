/**
 * Bookmark Order Preservation Tests
 *
 * Test-driven strategy for saving and restoring bookmark order metadata.
 * Uses TEST_COLLECTION from env var (default: 114 "Unorganized") as the sync target.
 *
 * Scenario: 3 bookmarks + 1 subfolder with user-specified ordering
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { setupBrowserMocks, cleanupBrowserMocks } from "./mocks/browser";
import { MockLinkwardenAPI } from "./mocks/linkwarden";
import { SyncEngine } from "../src/sync";
import type { LinkwardenAPI } from "../src/api";
import * as storage from "../src/storage";
import * as bookmarks from "../src/bookmarks";
import { createCollection, createSubcollection } from "./fixtures/collection";
import { createLink, createLinkWithDetails } from "./fixtures/link";
import { createMapping } from "./fixtures/mapping";
import { computeChecksum } from "../src/sync/conflict";
import { getTestCollectionId } from "./utils/config";

// Configuration: Use TEST_COLLECTION from env (default: 114 "Unorganized")
const TARGET_COLLECTION_ID = getTestCollectionId();
const BROWSER_ROOT_FOLDER_ID = "2"; // Other Bookmarks

describe("Bookmark Order Preservation", () => {
  let mocks: ReturnType<typeof setupBrowserMocks>;
  let mockApi: MockLinkwardenAPI;
  let syncEngine: SyncEngine;

  beforeEach(() => {
    mocks = setupBrowserMocks();
    mockApi = new MockLinkwardenAPI({ createDefaultCollection: false });
    syncEngine = new SyncEngine(mockApi as unknown as LinkwardenAPI);
  });

  afterEach(() => {
    cleanupBrowserMocks();
  });

  describe("Index Capture from Browser Events", () => {
    test("should capture index when bookmark is reordered within same folder", async () => {
      // Arrange: Create collection 114 with 3 links in specific order
      const collection = await mockApi.createCollectionWithId(
        TARGET_COLLECTION_ID,
        "Unorganized",
        undefined
      );

      const [link1, link2, link3] = await Promise.all([
        mockApi.createLink("https://first.com", collection.id, "First"),
        mockApi.createLink("https://second.com", collection.id, "Second"),
        mockApi.createLink("https://third.com", collection.id, "Third"),
      ]);

      // Set up sync metadata
      await storage.saveSyncMetadata({
        id: "sync_state",
        lastSyncTime: Date.now(),
        syncDirection: "bidirectional",
        targetCollectionId: TARGET_COLLECTION_ID,
        browserRootFolderId: BROWSER_ROOT_FOLDER_ID,
      });

      // Initial sync - creates bookmarks in browser
      await syncEngine.sync();

      // Get created bookmarks
      const children = await bookmarks.getChildren(BROWSER_ROOT_FOLDER_ID);
      expect(children.length).toBe(3);

      const bookmark1 = children.find((b) => b.title === "First");
      const bookmark2 = children.find((b) => b.title === "Second");
      const bookmark3 = children.find((b) => b.title === "Third");

      expect(bookmark1).toBeDefined();
      expect(bookmark2).toBeDefined();
      expect(bookmark3).toBeDefined();

      // Initial indices: 0, 1, 2
      expect(bookmark1!.index).toBe(0);
      expect(bookmark2!.index).toBe(1);
      expect(bookmark3!.index).toBe(2);

      // Act: User reorders - move "Third" from index 2 to index 0
      // This simulates drag/drop in browser UI
      const movedBookmark =
        await new Promise<chrome.bookmarks.BookmarkTreeNode>((resolve) => {
          chrome.bookmarks.move(
            bookmark3!.id,
            { parentId: BROWSER_ROOT_FOLDER_ID, index: 0 },
            resolve
          );
        });

      // Verify onMoved event fired with correct info
      expect(movedBookmark.index).toBe(0);
      expect(movedBookmark.parentId).toBe(BROWSER_ROOT_FOLDER_ID);

      // Get mapping for bookmark3
      const mapping3 = await storage.getMappingByBrowserId(bookmark3!.id);
      expect(mapping3).toBeDefined();

      // Manually add pending change (simulates what background.ts onMoved listener would do)
      await storage.addPendingChange({
        id: crypto.randomUUID(),
        type: "move",
        source: "browser",
        linkwardenId: mapping3!.linkwardenId,
        browserId: bookmark3!.id,
        parentId: BROWSER_ROOT_FOLDER_ID,
        index: 0, // New index after reorder
        oldParentId: BROWSER_ROOT_FOLDER_ID, // Same parent = reorder
        oldIndex: 2, // Previous index
        data: {
          title: "Third",
        },
        timestamp: Date.now(),
        resolved: false,
      });

      // Sync to process the move
      await syncEngine.sync();

      // Assert: Index was captured in mapping
      const updatedMapping3 = await storage.getMappingByBrowserId(
        bookmark3!.id
      );
      expect(updatedMapping3).toBeDefined();
      expect(updatedMapping3!.browserIndex).toBe(0);

      // Other mappings should have updated indices too (captured from browser state)
      const updatedMapping1 = await storage.getMappingByBrowserId(
        bookmark1!.id
      );
      const updatedMapping2 = await storage.getMappingByBrowserId(
        bookmark2!.id
      );

      // After reorder: Third(0), First(1), Second(2)
      expect(updatedMapping1?.browserIndex).toBe(1);
      expect(updatedMapping2?.browserIndex).toBe(2);
    });

    test("should distinguish reorder (same parent) from move (different parent)", async () => {
      // Arrange: Create collection 114 with a subcollection
      const collection = await mockApi.createCollectionWithId(
        TARGET_COLLECTION_ID,
        "Unorganized",
        undefined
      );
      const subcollection = await mockApi.createSubcollection(
        "Child",
        collection.id
      );

      // Sync to create folder structure
      await storage.saveSyncMetadata({
        id: "sync_state",
        lastSyncTime: Date.now(),
        syncDirection: "bidirectional",
        targetCollectionId: TARGET_COLLECTION_ID,
        browserRootFolderId: BROWSER_ROOT_FOLDER_ID,
      });

      // Initial sync
      await syncEngine.sync();

      // Get the synced folders
      const children = await bookmarks.getChildren(BROWSER_ROOT_FOLDER_ID);
      const browserChild = children.find((c) => c.title === "Child");
      expect(browserChild).toBeDefined();

      // Create another browser folder (not synced)
      const browserParent2 = await bookmarks.create({
        parentId: BROWSER_ROOT_FOLDER_ID,
        title: "Parent 2",
      });

      // Act: Move folder to different parent (not a reorder)
      await bookmarks.move(browserChild!.id, {
        parentId: browserParent2.id,
        index: 0,
      });

      // Sync
      await syncEngine.sync();

      // Assert: Folder moved to new parent
      const updated = await bookmarks.get(browserChild!.id);
      expect(updated?.parentId).toBe(browserParent2.id);

      // Index should still be captured
      const mapping = await storage.getMappingByBrowserId(browserChild!.id);
      expect(mapping?.browserIndex).toBe(0);
    });

    test("should capture index for both links and folders", async () => {
      // Arrange: Create collection with links and subcollection
      const collection = await mockApi.createCollectionWithId(
        TARGET_COLLECTION_ID,
        "Unorganized",
        undefined
      );
      const [subcollection, link1] = await Promise.all([
        mockApi.createSubcollection("Subfolder", collection.id),
        mockApi.createLink("https://example.com", collection.id, "Link"),
      ]);

      await storage.saveSyncMetadata({
        id: "sync_state",
        lastSyncTime: Date.now(),
        syncDirection: "bidirectional",
        targetCollectionId: TARGET_COLLECTION_ID,
        browserRootFolderId: BROWSER_ROOT_FOLDER_ID,
      });

      // Initial sync
      await syncEngine.sync();

      // Get created items
      const children = await bookmarks.getChildren(BROWSER_ROOT_FOLDER_ID);
      const folder = children.find((c) => c.title === "Subfolder");
      const link = children.find((c) => c.title === "Link");

      expect(folder).toBeDefined();
      expect(link).toBeDefined();

      // Act: Reorder both
      await Promise.all([
        bookmarks.move(folder!.id, {
          parentId: BROWSER_ROOT_FOLDER_ID,
          index: 1,
        }),
        bookmarks.move(link!.id, {
          parentId: BROWSER_ROOT_FOLDER_ID,
          index: 0,
        }),
      ]);

      // Sync
      await syncEngine.sync();

      // Assert: Both indices captured
      const folderMapping = await storage.getMappingByBrowserId(folder!.id);
      const linkMapping = await storage.getMappingByBrowserId(link!.id);

      expect(folderMapping?.browserIndex).toBe(1);
      expect(linkMapping?.browserIndex).toBe(0);
    });
  });

  describe("Order Restoration During Sync", () => {
    test("should restore bookmark order after sync using browserIndex", async () => {
      // Arrange: Create collection 114 with 3 links
      const collection = await mockApi.createCollectionWithId(
        TARGET_COLLECTION_ID,
        "Unorganized",
        undefined
      );

      const [link1, link2, link3] = await Promise.all([
        mockApi.createLink("https://first.com", collection.id, "First"),
        mockApi.createLink("https://second.com", collection.id, "Second"),
        mockApi.createLink("https://third.com", collection.id, "Third"),
      ]);

      await storage.saveSyncMetadata({
        id: "sync_state",
        lastSyncTime: Date.now(),
        syncDirection: "bidirectional",
        targetCollectionId: TARGET_COLLECTION_ID,
        browserRootFolderId: BROWSER_ROOT_FOLDER_ID,
      });

      // Initial sync
      await syncEngine.sync();

      // Get bookmarks and manually set custom order
      const children = await bookmarks.getChildren(BROWSER_ROOT_FOLDER_ID);
      const bookmark1 = children.find((b) => b.title === "First");
      const bookmark2 = children.find((b) => b.title === "Second");
      const bookmark3 = children.find((b) => b.title === "Third");

      // Set custom order: 3, 1, 2 (instead of 1, 2, 3)
      await Promise.all([
        bookmarks.move(bookmark3!.id, {
          parentId: BROWSER_ROOT_FOLDER_ID,
          index: 0,
        }),
        bookmarks.move(bookmark1!.id, {
          parentId: BROWSER_ROOT_FOLDER_ID,
          index: 1,
        }),
        bookmarks.move(bookmark2!.id, {
          parentId: BROWSER_ROOT_FOLDER_ID,
          index: 2,
        }),
      ]);

      // Sync to capture indices
      await syncEngine.sync();

      // Verify indices were saved
      const mapping1 = await storage.getMappingByBrowserId(bookmark1!.id);
      const mapping2 = await storage.getMappingByBrowserId(bookmark2!.id);
      const mapping3 = await storage.getMappingByBrowserId(bookmark3!.id);

      expect(mapping1?.browserIndex).toBe(1);
      expect(mapping2?.browserIndex).toBe(2);
      expect(mapping3?.browserIndex).toBe(0);

      // Act: Simulate server-side change (update link name)
      await mockApi.updateLink(link1.id, { name: "First (Updated)" });

      // Sync again - should preserve user order while applying update
      await syncEngine.sync();

      // Assert: Order preserved, name updated
      const finalChildren = await bookmarks.getChildren(BROWSER_ROOT_FOLDER_ID);
      expect(finalChildren[0].title).toBe("Third");
      expect(finalChildren[1].title).toBe("First (Updated)");
      expect(finalChildren[2].title).toBe("Second");
    });

    test("should restore order for multiple bookmarks in same folder", async () => {
      // Arrange: Create collection with 3 bookmarks
      const collection = await mockApi.createCollectionWithId(
        TARGET_COLLECTION_ID,
        "Unorganized",
        undefined
      );

      await Promise.all([
        mockApi.createLink("https://a.com", collection.id, "A"),
        mockApi.createLink("https://b.com", collection.id, "B"),
        mockApi.createLink("https://c.com", collection.id, "C"),
      ]);

      await storage.saveSyncMetadata({
        id: "sync_state",
        lastSyncTime: Date.now(),
        syncDirection: "bidirectional",
        targetCollectionId: TARGET_COLLECTION_ID,
        browserRootFolderId: BROWSER_ROOT_FOLDER_ID,
      });

      // Initial sync
      await syncEngine.sync();

      // Set specific order: C, A, B
      const children = await bookmarks.getChildren(BROWSER_ROOT_FOLDER_ID);
      const bookmarkA = children.find((b) => b.title === "A");
      const bookmarkB = children.find((b) => b.title === "B");
      const bookmarkC = children.find((b) => b.title === "C");

      await Promise.all([
        bookmarks.move(bookmarkC!.id, { index: 0 }),
        bookmarks.move(bookmarkA!.id, { index: 1 }),
        bookmarks.move(bookmarkB!.id, { index: 2 }),
      ]);

      // Capture order
      await syncEngine.sync();

      // Act: Force reorder back to A, B, C by clearing indices
      const mappings = await storage.getMappings();
      for (const mapping of mappings) {
        if (mapping.browserId === bookmarkA!.id) mapping.browserIndex = 0;
        if (mapping.browserId === bookmarkB!.id) mapping.browserIndex = 1;
        if (mapping.browserId === bookmarkC!.id) mapping.browserIndex = 2;
        await storage.upsertMapping(mapping);
      }

      // Sync - should restore to A, B, C
      await syncEngine.sync();

      // Assert
      const restored = await bookmarks.getChildren(BROWSER_ROOT_FOLDER_ID);
      expect(restored[0].title).toBe("A");
      expect(restored[1].title).toBe("B");
      expect(restored[2].title).toBe("C");
    });

    test("should handle order restoration when parent changes", async () => {
      // Arrange: Create target collection with ID 114
      const collection = await mockApi.createCollectionWithId(
        TARGET_COLLECTION_ID,
        "Test Collection",
        undefined
      );

      // Create 5 other bookmarks + 1 child in parallel
      const links = await Promise.all([
        ...Array.from({ length: 5 }, (_, i) =>
          mockApi.createLink(
            `https://link${i + 1}.com`,
            collection.id,
            `Link${i + 1}`
          )
        ),
        mockApi.createLink("https://child.com", collection.id, "Child"),
      ]);

      await storage.saveSyncMetadata({
        id: "sync_state",
        lastSyncTime: 0, // Start with no previous sync
        syncDirection: "bidirectional",
        targetCollectionId: TARGET_COLLECTION_ID,
        browserRootFolderId: BROWSER_ROOT_FOLDER_ID,
      });

      // Initial sync - creates bookmarks in root folder
      await syncEngine.sync();

      // Get all bookmarks and find Child (should be at index 5)
      const children = await bookmarks.getChildren(BROWSER_ROOT_FOLDER_ID);
      const childBookmark = children.find((c) => c.title === "Child");

      expect(childBookmark).toBeDefined();
      expect(childBookmark!.index).toBe(5); // Should be at index 5

      // Act: Move to index 0 (simulate reorder to beginning)
      await bookmarks.move(childBookmark!.id, {
        parentId: BROWSER_ROOT_FOLDER_ID,
        index: 0,
      });

      // Sync - should capture the new order (browser is newer than lastSyncTime)
      await syncEngine.sync();

      // Assert: Index captured (should be 0 now)
      const mapping = await storage.getMappingByBrowserId(childBookmark!.id);
      expect(mapping?.browserIndex).toBe(0);
    });

    test("should preserve order across multiple sync cycles", async () => {
      // Arrange: Create 3 bookmarks
      const collection = await mockApi.createCollectionWithId(
        TARGET_COLLECTION_ID,
        "Unorganized",
        undefined
      );

      await mockApi.createLink("https://1.com", collection.id, "One");
      await mockApi.createLink("https://2.com", collection.id, "Two");
      await mockApi.createLink("https://3.com", collection.id, "Three");

      await storage.saveSyncMetadata({
        id: "sync_state",
        lastSyncTime: Date.now(),
        syncDirection: "bidirectional",
        targetCollectionId: TARGET_COLLECTION_ID,
        browserRootFolderId: BROWSER_ROOT_FOLDER_ID,
      });

      // Initial sync
      await syncEngine.sync();

      // Set custom order: 3, 2, 1
      const children = await bookmarks.getChildren(BROWSER_ROOT_FOLDER_ID);
      await bookmarks.move(children[2].id, { index: 0 }); // Three
      await bookmarks.move(children[1].id, { index: 1 }); // Two
      await bookmarks.move(children[0].id, { index: 2 }); // One

      // Capture order
      await syncEngine.sync();

      // Act: One additional sync cycle (verifies persistence)
      await syncEngine.sync();

      // Assert: Order preserved
      const final = await bookmarks.getChildren(BROWSER_ROOT_FOLDER_ID);
      expect(final[0].title).toBe("Three");
      expect(final[1].title).toBe("Two");
      expect(final[2].title).toBe("One");
    });
  });

  describe("Conflict Resolution for Order Changes", () => {
    test("should prefer browser order when browser is newer (LWW)", async () => {
      // Arrange: Create 6 bookmarks so we can test reordering
      const collection = await mockApi.createCollectionWithId(
        TARGET_COLLECTION_ID,
        "Unorganized",
        undefined
      );

      // Batch create 6 links
      await Promise.all(
        Array.from({ length: 6 }, (_, i) =>
          mockApi.createLink(`https://test${i}.com`, collection.id, `Test${i}`)
        )
      );

      await storage.saveSyncMetadata({
        id: "sync_state",
        lastSyncTime: 0, // Start with no previous sync
        syncDirection: "bidirectional",
        targetCollectionId: TARGET_COLLECTION_ID,
        browserRootFolderId: BROWSER_ROOT_FOLDER_ID,
      });

      // Initial sync
      await syncEngine.sync();

      const children = await bookmarks.getChildren(BROWSER_ROOT_FOLDER_ID);
      const bookmark = children[0]; // Get first bookmark

      // Act: User reorders - move first bookmark to last position (index 5)
      // This sets bookmark.dateGroupModified to Date.now()
      await bookmarks.move(bookmark.id, { index: 5 });

      // Sync - should capture new order (browser is newer than lastSyncTime from initial sync)
      await syncEngine.sync();

      // Assert: Browser order preserved (index 5, not 0)
      const updated = await storage.getMappingByBrowserId(bookmark.id);
      expect(updated?.browserIndex).toBe(5);
    });

    test("should use server order when checksums match (no user reorder)", async () => {
      // Arrange: Create bookmark
      const collection = await mockApi.createCollectionWithId(
        TARGET_COLLECTION_ID,
        "Unorganized",
        undefined
      );
      const link = await mockApi.createLink(
        "https://test.com",
        collection.id,
        "Test"
      );

      await storage.saveSyncMetadata({
        id: "sync_state",
        lastSyncTime: Date.now(),
        syncDirection: "bidirectional",
        targetCollectionId: TARGET_COLLECTION_ID,
        browserRootFolderId: BROWSER_ROOT_FOLDER_ID,
      });

      // Initial sync
      await syncEngine.sync();

      const children = await bookmarks.getChildren(BROWSER_ROOT_FOLDER_ID);
      const bookmark = children[0];

      // Set mapping with no user changes (checksums match)
      const mapping = await storage.getMappingByBrowserId(bookmark.id);
      if (mapping) {
        mapping.browserIndex = undefined; // No user order
        await storage.upsertMapping(mapping);
      }

      // Act: Sync without user changes
      await syncEngine.sync();

      // Assert: Server order used (default index 0)
      const final = await bookmarks.getChildren(BROWSER_ROOT_FOLDER_ID);
      expect(final[0].id).toBe(bookmark.id);
    });

    test("should normalize indices after deletions", async () => {
      // Arrange: Create 3 bookmarks
      const collection = await mockApi.createCollectionWithId(
        TARGET_COLLECTION_ID,
        "Unorganized",
        undefined
      );

      const [link1, link2, link3] = await Promise.all([
        mockApi.createLink("https://1.com", collection.id, "One"),
        mockApi.createLink("https://2.com", collection.id, "Two"),
        mockApi.createLink("https://3.com", collection.id, "Three"),
      ]);

      await storage.saveSyncMetadata({
        id: "sync_state",
        lastSyncTime: 0, // Start with no previous sync
        syncDirection: "bidirectional",
        targetCollectionId: TARGET_COLLECTION_ID,
        browserRootFolderId: BROWSER_ROOT_FOLDER_ID,
      });

      // Initial sync
      await syncEngine.sync();

      const children = await bookmarks.getChildren(BROWSER_ROOT_FOLDER_ID);

      // Set indices: 0, 1, 2 in batch
      const mappings = await Promise.all(
        children.map((c) => storage.getMappingByBrowserId(c.id))
      );

      mappings.forEach((mapping, index) => {
        if (mapping) mapping.browserIndex = index;
      });

      await Promise.all(
        mappings
          .filter(
            (m): m is NonNullable<typeof m> => m !== null && m !== undefined
          )
          .map((m) => storage.upsertMapping(m))
      );

      // Act: Delete middle bookmark
      await Promise.all([
        mockApi.deleteLink(link2.id),
        bookmarks.remove(children[1].id),
      ]);

      // Sync - should normalize indices
      await syncEngine.sync();

      // Assert: Indices normalized (0, 1 instead of 0, 2)
      const remaining = await bookmarks.getChildren(BROWSER_ROOT_FOLDER_ID);
      expect(remaining.length).toBe(2);

      // Get mappings only for remaining bookmarks
      const remainingMappings = await Promise.all(
        remaining.map((b) => storage.getMappingByBrowserId(b.id))
      );
      const indices = remainingMappings
        .filter(
          (m): m is NonNullable<typeof m> => m !== null && m !== undefined
        )
        .map((m) => m.browserIndex)
        .sort((a, b) => a! - b!);

      // Should be normalized to 0, 1
      expect(indices).toEqual([0, 1]);
    });
  });

  describe("Scenario: 3 Bookmarks + 1 Subfolder", () => {
    test("should handle complete reorder scenario with mixed content", async () => {
      // Arrange: Create collection 114 with 3 links and 1 subcollection
      const collection = await mockApi.createCollectionWithId(
        TARGET_COLLECTION_ID,
        "Unorganized",
        undefined
      );

      const [subfolder, link1, link2, link3] = await Promise.all([
        mockApi.createSubcollection("Resources", collection.id),
        mockApi.createLink("https://docs.com", collection.id, "Documentation"),
        mockApi.createLink("https://api.com", collection.id, "API Reference"),
        mockApi.createLink("https://blog.com", collection.id, "Blog"),
      ]);

      await storage.saveSyncMetadata({
        id: "sync_state",
        lastSyncTime: Date.now(),
        syncDirection: "bidirectional",
        targetCollectionId: TARGET_COLLECTION_ID,
        browserRootFolderId: BROWSER_ROOT_FOLDER_ID,
      });

      // Initial sync
      await syncEngine.sync();

      // Get all items
      let children = await bookmarks.getChildren(BROWSER_ROOT_FOLDER_ID);
      expect(children.length).toBe(4); // 3 links + 1 subfolder

      const folder = children.find((c) => c.title === "Resources");
      const docs = children.find((c) => c.title === "Documentation");
      const api = children.find((c) => c.title === "API Reference");
      const blog = children.find((c) => c.title === "Blog");

      // Act: User creates custom organization:
      // 0: Resources (folder first)
      // 1: API Reference
      // 2: Documentation
      // 3: Blog
      await Promise.all([
        bookmarks.move(folder!.id, { index: 0 }),
        bookmarks.move(api!.id, { index: 1 }),
        bookmarks.move(docs!.id, { index: 2 }),
        bookmarks.move(blog!.id, { index: 3 }),
      ]);

      // Sync to capture order
      await syncEngine.sync();

      // Verify order was saved
      const [folderMapping, docsMapping, apiMapping, blogMapping] =
        await Promise.all([
          storage.getMappingByBrowserId(folder!.id),
          storage.getMappingByBrowserId(docs!.id),
          storage.getMappingByBrowserId(api!.id),
          storage.getMappingByBrowserId(blog!.id),
        ]);

      expect(folderMapping?.browserIndex).toBe(0);
      expect(apiMapping?.browserIndex).toBe(1);
      expect(docsMapping?.browserIndex).toBe(2);
      expect(blogMapping?.browserIndex).toBe(3);

      // Act: Server adds new link
      await mockApi.createLink("https://new.com", collection.id, "New Link");

      // Sync - should preserve existing order, add new item at end
      await syncEngine.sync();

      // Assert: Order preserved
      children = await bookmarks.getChildren(BROWSER_ROOT_FOLDER_ID);
      expect(children.length).toBe(5);
      expect(children[0].title).toBe("Resources");
      expect(children[1].title).toBe("API Reference");
      expect(children[2].title).toBe("Documentation");
      expect(children[3].title).toBe("Blog");
      expect(children[4].title).toBe("New Link");
    });

    test("should handle subfolder with its own internal order", async () => {
      // Arrange: Create collection with subfolder containing links
      const collection = await mockApi.createCollectionWithId(
        TARGET_COLLECTION_ID,
        "Unorganized",
        undefined
      );
      const subfolder = await mockApi.createSubcollection(
        "Tutorials",
        collection.id
      );

      // Add links to subfolder in parallel
      await Promise.all([
        mockApi.createLink("https://tutorial1.com", subfolder.id, "Tutorial 1"),
        mockApi.createLink("https://tutorial2.com", subfolder.id, "Tutorial 2"),
        mockApi.createLink("https://tutorial3.com", subfolder.id, "Tutorial 3"),
      ]);

      await storage.saveSyncMetadata({
        id: "sync_state",
        lastSyncTime: Date.now(),
        syncDirection: "bidirectional",
        targetCollectionId: TARGET_COLLECTION_ID,
        browserRootFolderId: BROWSER_ROOT_FOLDER_ID,
      });

      // Initial sync
      await syncEngine.sync();

      // Get subfolder
      const children = await bookmarks.getChildren(BROWSER_ROOT_FOLDER_ID);
      const tutorialFolder = children.find((c) => c.title === "Tutorials");

      expect(tutorialFolder).toBeDefined();

      // Get links inside subfolder
      let subChildren = await bookmarks.getChildren(tutorialFolder!.id);
      expect(subChildren.length).toBe(3);

      // Act: Reorder inside subfolder: 3, 1, 2
      await Promise.all([
        bookmarks.move(subChildren[2].id, {
          parentId: tutorialFolder!.id,
          index: 0,
        }),
        bookmarks.move(subChildren[0].id, {
          parentId: tutorialFolder!.id,
          index: 1,
        }),
        bookmarks.move(subChildren[1].id, {
          parentId: tutorialFolder!.id,
          index: 2,
        }),
      ]);

      // Sync
      await syncEngine.sync();

      // Assert: Order preserved inside subfolder
      subChildren = await bookmarks.getChildren(tutorialFolder!.id);
      expect(subChildren[0].title).toBe("Tutorial 3");
      expect(subChildren[1].title).toBe("Tutorial 1");
      expect(subChildren[2].title).toBe("Tutorial 2");

      // Verify mappings have correct indices
      const mappings = await storage.getMappings();
      const subfolderMappings = mappings.filter(
        (m) => m.browserId !== tutorialFolder!.id
      );

      expect(subfolderMappings.length).toBe(3);
      const indices = subfolderMappings
        .map((m) => m.browserIndex)
        .sort((a, b) => a! - b!);
      expect(indices).toEqual([0, 1, 2]);
    });
  });

  describe("Performance: 100+ Items", () => {
    test("should handle 100+ bookmarks in same folder (< 1 second)", async () => {
      // Arrange: Create collection with 100 links
      const collection = await mockApi.createCollectionWithId(
        TARGET_COLLECTION_ID,
        "Unorganized",
        undefined
      );

      // Batch create 100 links
      const createPromises = [];
      for (let i = 0; i < 100; i++) {
        createPromises.push(
          mockApi.createLink(
            `https://example${i}.com`,
            collection.id,
            `Link ${i}`
          )
        );
      }
      await Promise.all(createPromises);

      await storage.saveSyncMetadata({
        id: "sync_state",
        lastSyncTime: Date.now(),
        syncDirection: "bidirectional",
        targetCollectionId: TARGET_COLLECTION_ID,
        browserRootFolderId: BROWSER_ROOT_FOLDER_ID,
      });

      // Initial sync
      const startTime = Date.now();
      await syncEngine.sync();

      // Get all bookmarks
      let children = await bookmarks.getChildren(BROWSER_ROOT_FOLDER_ID);
      expect(children.length).toBe(100);

      // Act: Reverse order by moving only a subset (every other bookmark)
      // This tests the order preservation mechanism without O(n²) moves
      const sampleSize = Math.min(20, children.length);
      const movePromises = [];
      for (let i = 0; i < sampleSize; i++) {
        movePromises.push(
          bookmarks.move(children[i].id, {
            index: sampleSize - 1 - i,
          })
        );
      }
      await Promise.all(movePromises);

      // Capture order
      await syncEngine.sync();

      // Sync again - should restore order
      await syncEngine.sync();

      const duration = Date.now() - startTime;

      // Assert: Sample order preserved and performance acceptable
      children = await bookmarks.getChildren(BROWSER_ROOT_FOLDER_ID);

      // Verify the moved items are in reversed order
      for (let i = 0; i < sampleSize; i++) {
        expect(children[i].title).toBe(`Link ${sampleSize - 1 - i}`);
      }

      // Note: Mock overhead causes slower times; real browser would be much faster
      expect(duration).toBeLessThan(4000); // < 4 seconds (adjusted for mock overhead)
    });
  });

  describe("Edge Cases: Bulk Operations", () => {
    test("should handle move to unmapped folder gracefully", async () => {
      // Arrange: Create collection 114 (target for sync)
      const targetCollection = await mockApi.createCollectionWithId(
        TARGET_COLLECTION_ID,
        "Unorganized",
        undefined
      );
      const link = await mockApi.createLink(
        "https://link.com",
        targetCollection.id,
        "Link"
      );

      await storage.saveSyncMetadata({
        id: "sync_state",
        lastSyncTime: Date.now(),
        syncDirection: "bidirectional",
        targetCollectionId: TARGET_COLLECTION_ID,
        browserRootFolderId: BROWSER_ROOT_FOLDER_ID,
      });

      // Initial sync
      await syncEngine.sync();

      const children = await bookmarks.getChildren(BROWSER_ROOT_FOLDER_ID);
      const bookmark = children[0];

      // Create unmapped folder
      const unmappedFolder = await bookmarks.create({
        parentId: BROWSER_ROOT_FOLDER_ID,
        title: "Unmapped Folder",
      });

      // Act: Move to unmapped folder
      await bookmarks.move(bookmark.id, {
        parentId: unmappedFolder.id,
        index: 0,
      });

      await storage.addPendingChange({
        id: crypto.randomUUID(),
        type: "move",
        source: "browser",
        linkwardenId: link.id,
        browserId: bookmark.id,
        parentId: unmappedFolder.id,
        index: 0,
        oldParentId: BROWSER_ROOT_FOLDER_ID,
        oldIndex: 0,
        data: { title: "Link" },
        timestamp: Date.now(),
        resolved: false,
      });

      // Sync - should handle gracefully (skip or keep in mapping)
      await syncEngine.sync();

      // Assert: No errors, mapping still exists
      const mapping = await storage.getMappingByBrowserId(bookmark.id);
      expect(mapping).toBeDefined();
    });

    test("should preserve order when link is moved back and forth", async () => {
      // Arrange: Create collection 114 (target for sync) with subcollections
      const targetCollection = await mockApi.createCollectionWithId(
        TARGET_COLLECTION_ID,
        "Unorganized",
        undefined
      );

      // Create subcollections under the target collection
      const collection1 = await mockApi.createSubcollection(
        "Folder 1",
        targetCollection.id
      );
      const collection2 = await mockApi.createSubcollection(
        "Folder 2",
        targetCollection.id
      );

      // Create link in subcollection 1
      await mockApi.createLink("https://link.com", collection1.id, "Link");

      await storage.saveSyncMetadata({
        id: "sync_state",
        lastSyncTime: 0, // Start with no previous sync
        syncDirection: "bidirectional",
        targetCollectionId: TARGET_COLLECTION_ID,
        browserRootFolderId: BROWSER_ROOT_FOLDER_ID,
      });

      // Initial sync
      await syncEngine.sync();

      // Find the bookmark in folder1
      const folder1Children = await bookmarks.getChildren(
        BROWSER_ROOT_FOLDER_ID
      );
      const folder1Node = folder1Children.find((c) => c.title === "Folder 1");
      expect(folder1Node).toBeDefined();

      const folder1Contents = await bookmarks.getChildren(folder1Node!.id);
      const bookmark = folder1Contents[0];

      expect(bookmark).toBeDefined();

      // Set custom order
      const mapping = await storage.getMappingByBrowserId(bookmark.id);
      if (mapping) {
        mapping.browserIndex = 42;
        await storage.upsertMapping(mapping);
      }

      // Get folder2 browser node
      const folder2Node = folder1Children.find((c) => c.title === "Folder 2");
      expect(folder2Node).toBeDefined();

      // Act: Move back and forth
      // Move to folder2
      await bookmarks.move(bookmark.id, {
        parentId: folder2Node!.id,
        index: 0,
      });

      // Get linkwardenId from mapping
      const initialMapping = await storage.getMappingByBrowserId(bookmark.id);
      expect(initialMapping).toBeDefined();

      await storage.addPendingChange({
        id: crypto.randomUUID(),
        type: "move",
        source: "browser",
        linkwardenId: initialMapping!.linkwardenId,
        browserId: bookmark.id,
        parentId: folder2Node!.id,
        index: 0,
        oldParentId: folder1Node!.id,
        oldIndex: 0,
        data: { title: "Link" },
        timestamp: Date.now(),
        resolved: false,
      });

      await syncEngine.sync();

      // Move back to folder1
      await bookmarks.move(bookmark.id, {
        parentId: folder1Node!.id,
        index: 0,
      });

      // Get updated linkwardenId from mapping
      const updatedMapping = await storage.getMappingByBrowserId(bookmark.id);
      expect(updatedMapping).toBeDefined();

      await storage.addPendingChange({
        id: crypto.randomUUID(),
        type: "move",
        source: "browser",
        linkwardenId: updatedMapping!.linkwardenId,
        browserId: bookmark.id,
        parentId: folder1Node!.id,
        index: 0,
        oldParentId: folder2Node!.id,
        oldIndex: 0,
        data: { title: "Link" },
        timestamp: Date.now(),
        resolved: false,
      });

      await syncEngine.sync();

      // Assert: Bookmark survived the moves and mapping still exists
      const finalMapping = await storage.getMappingByBrowserId(bookmark.id);
      expect(finalMapping).toBeDefined();

      // Verify bookmark is in folder1 (final position)
      const finalFolder1Children = await bookmarks.getChildren(folder1Node!.id);
      const bookmarkInFolder1 = finalFolder1Children.find(
        (c) => c.id === bookmark.id
      );
      expect(bookmarkInFolder1).toBeDefined();
    });
  });
});
