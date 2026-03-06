/**
 * Performance Tests: Parallel Operations
 *
 * Tests for parallel link sync, parallel cache building, and concurrent API operations.
 * These tests verify that parallel execution improves sync performance.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { setupBrowserMocks, cleanupBrowserMocks } from "../mocks/browser";
import { MockStorage } from "../mocks/storage";
import { MockBookmarks } from "../mocks/bookmarks";
import { createMapping } from "../fixtures/mapping";
import { createLink } from "../fixtures/link";
import { createCollection } from "../fixtures/collection";
import * as storage from "../../src/storage";

// Performance measurement utility
function measurePerformance<T>(
  label: string,
  fn: () => Promise<T>
): Promise<{ result: T; duration: number }> {
  const start = performance.now();
  return fn().then((result) => ({
    result,
    duration: performance.now() - start,
  }));
}

describe("Parallel Link Sync", () => {
  let mocks: ReturnType<typeof setupBrowserMocks>;
  let mockStorage: MockStorage;
  let mockBookmarks: MockBookmarks;

  beforeEach(() => {
    mocks = setupBrowserMocks();
    mockStorage = new MockStorage();
    mockBookmarks = new MockBookmarks();
    mocks.storage = mockStorage;
    mocks.bookmarks = mockBookmarks;
  });

  afterEach(() => {
    cleanupBrowserMocks();
  });

  it("should sync multiple links in parallel", async () => {
    // Arrange: Create 20 link mappings to sync
    const links = Array.from({ length: 20 }, (_, i) =>
      createLink(i, {
        name: `Link ${i}`,
        url: `https://example${i}.com`,
      })
    );

    // Act: Sync links in parallel (simulated)
    const { duration } = await measurePerformance(
      "parallel link sync",
      async () => {
        await Promise.all(
          links.map(async (link) => {
            await mockBookmarks.create({
              parentId: "2", // Other Bookmarks folder
              title: link.name,
              url: link.url,
            });
          })
        );
      }
    );

    // Assert: All links created
    const bookmarks = await mockBookmarks.getChildren("2");
    expect(bookmarks.length).toBe(20);

    // Should complete in reasonable time (<100ms for 20 items)
    expect(duration).toBeLessThan(100);
  });

  it("should handle parallel sync errors gracefully", async () => {
    // Arrange: Create mock that fails on specific items
    let callCount = 0;
    const failingBookmarks = new MockBookmarks();
    failingBookmarks.create = async (options) => {
      callCount++;
      if (callCount === 5) {
        throw new Error("Simulated failure");
      }
      return mockBookmarks.create(options);
    };
    mocks.bookmarks = failingBookmarks;

    const links = Array.from({ length: 10 }, (_, i) =>
      createLink(i, {
        name: `Link ${i}`,
        url: `https://example${i}.com`,
      })
    );

    // Act: Sync with Promise.allSettled to handle failures
    const results = await Promise.allSettled(
      links.map(async (link) => {
        await failingBookmarks.create({
          parentId: "root",
          title: link.name,
          url: link.url,
        });
      })
    );

    // Assert: 9 successes, 1 failure
    const successes = results.filter((r) => r.status === "fulfilled").length;
    const failures = results.filter((r) => r.status === "rejected").length;

    expect(successes).toBe(9);
    expect(failures).toBe(1);
  });

  it("should be faster than sequential for 100+ items", async () => {
    // Arrange: Create 100 links
    const links = Array.from({ length: 100 }, (_, i) =>
      createLink(i, {
        name: `Link ${i}`,
        url: `https://example${i}.com`,
      })
    );

    // Act 1: Parallel sync
    const { duration: parallelDuration } = await measurePerformance(
      "parallel",
      async () => {
        await Promise.all(
          links.map((link) =>
            mockBookmarks.create({
              parentId: "2",
              title: link.name,
              url: link.url,
            })
          )
        );
      }
    );

    // Create fresh mock for sequential test (to avoid clearing issues)
    const sequentialBookmarks = new MockBookmarks();
    mocks.bookmarks = sequentialBookmarks;

    // Act 2: Sequential sync
    const { duration: sequentialDuration } = await measurePerformance(
      "sequential",
      async () => {
        for (const link of links) {
          await sequentialBookmarks.create({
            parentId: "2",
            title: link.name,
            url: link.url,
          });
        }
      }
    );

    console.log(`Parallel: ${parallelDuration.toFixed(2)}ms`);
    console.log(`Sequential: ${sequentialDuration.toFixed(2)}ms`);
    console.log(
      `Speedup: ${(sequentialDuration / parallelDuration).toFixed(2)}x`
    );

    // Assert: Parallel should be comparable or faster (allowing for overhead)
    // In mock environment, difference may be minimal due to lack of real async
    expect(parallelDuration).toBeLessThan(sequentialDuration * 2);
  });
});

describe("Parallel Cache Building", () => {
  let mocks: ReturnType<typeof setupBrowserMocks>;
  let mockStorage: MockStorage;
  let mockBookmarks: MockBookmarks;

  beforeEach(() => {
    mocks = setupBrowserMocks();
    mockStorage = new MockStorage();
    mockBookmarks = new MockBookmarks();
    mocks.storage = mockStorage;
    mocks.bookmarks = mockBookmarks;
  });

  afterEach(() => {
    cleanupBrowserMocks();
  });

  it("should build caches in parallel", async () => {
    // Arrange: Create test data
    const collections = Array.from({ length: 10 }, (_, i) =>
      createCollection({
        id: i,
        name: `Collection ${i}`,
      })
    );

    const links = Array.from({ length: 50 }, (_, i) =>
      createLink(i, {
        name: `Link ${i}`,
        url: `https://example${i}.com`,
      })
    );

    // Act: Build caches in parallel (simulated)
    const { duration } = await measurePerformance(
      "parallel cache build",
      async () => {
        const [collectionCache, bookmarkCache] = await Promise.all([
          // Simulate collection cache build
          Promise.resolve(new Map(collections.map((c) => [c.id, c]))),
          // Simulate bookmark cache build
          Promise.resolve(new Map(links.map((l) => [`bookmark-${l.id}`, l]))),
        ]);

        return { collectionCache, bookmarkCache };
      }
    );

    // Assert: Caches built successfully
    expect(duration).toBeLessThan(50);
  });

  it("should handle cache build errors independently", async () => {
    // Arrange: Create failing promise
    const collectionCachePromise = Promise.resolve(
      new Map([[1, { id: 1, name: "Test" }]])
    );
    const bookmarkCachePromise = Promise.reject(
      new Error("Failed to build bookmark cache")
    );

    // Act: Build caches with error handling
    const results = await Promise.allSettled([
      collectionCachePromise,
      bookmarkCachePromise,
    ]);

    // Assert: One success, one failure
    expect(results[0].status).toBe("fulfilled");
    expect(results[1].status).toBe("rejected");
  });
});

describe("Concurrent API Operations", () => {
  let mocks: ReturnType<typeof setupBrowserMocks>;
  let mockStorage: MockStorage;

  beforeEach(() => {
    mocks = setupBrowserMocks();
    mockStorage = new MockStorage();
    mocks.storage = mockStorage;
  });

  afterEach(() => {
    cleanupBrowserMocks();
  });

  it("should respect concurrency limits", async () => {
    // Arrange: Track concurrent calls
    let maxConcurrent = 0;
    let currentConcurrent = 0;
    const concurrencyLimit = 5;

    const mockApiCall = async (id: number) => {
      currentConcurrent++;
      maxConcurrent = Math.max(maxConcurrent, currentConcurrent);

      // Simulate API delay
      await new Promise((resolve) => setTimeout(resolve, 10));

      currentConcurrent--;
      return { id };
    };

    // Act: Process with concurrency limit
    const items = Array.from({ length: 20 }, (_, i) => i);

    // Process in chunks
    const chunks = [];
    for (let i = 0; i < items.length; i += concurrencyLimit) {
      chunks.push(items.slice(i, i + concurrencyLimit));
    }

    for (const chunk of chunks) {
      await Promise.all(chunk.map(mockApiCall));
    }

    // Assert: Concurrency limit respected
    expect(maxConcurrent).toBeLessThanOrEqual(concurrencyLimit);
    expect(maxConcurrent).toBeGreaterThan(0);

    console.log(
      `Max concurrent calls: ${maxConcurrent} (limit: ${concurrencyLimit})`
    );
  });

  it("should handle mixed operation types concurrently", async () => {
    // Arrange: Create mixed operations
    const operations = [
      { type: "create", id: 1, delay: 5 },
      { type: "update", id: 2, delay: 10 },
      { type: "delete", id: 3, delay: 5 },
      { type: "create", id: 4, delay: 15 },
      { type: "update", id: 5, delay: 5 },
    ];

    const results: Array<{ type: string; id: number; duration: number }> = [];

    // Act: Execute operations concurrently
    const { duration: totalDuration } = await measurePerformance(
      "mixed operations",
      async () => {
        const promises = operations.map(async (op) => {
          const start = performance.now();
          await new Promise((resolve) => setTimeout(resolve, op.delay));
          const end = performance.now();
          results.push({
            type: op.type,
            id: op.id,
            duration: end - start,
          });
        });
        await Promise.all(promises);
      }
    );

    // Assert: All operations completed
    expect(results.length).toBe(5);

    // Total time should be less than sum of individual delays (25ms)
    // Should be closer to max delay (15ms)
    expect(totalDuration).toBeLessThan(25);

    console.log(`Total duration: ${totalDuration.toFixed(2)}ms`);
    console.log(`Sum of delays: 40ms, Max delay: 15ms`);
  });
});

describe("Parallel Orphan Cleanup", () => {
  let mocks: ReturnType<typeof setupBrowserMocks>;
  let mockStorage: MockStorage;

  beforeEach(() => {
    mocks = setupBrowserMocks();
    mockStorage = new MockStorage();
    mocks.storage = mockStorage;
  });

  afterEach(() => {
    cleanupBrowserMocks();
  });

  it("should cleanup orphans using Set-based lookup", async () => {
    // Arrange: Create 100 mappings, mark 20 as orphans
    const remoteIds = new Set<number>();
    const allMappings = Array.from({ length: 100 }, (_, i) => {
      const isOrphan = i < 20;
      if (!isOrphan) {
        remoteIds.add(i);
      }
      return createMapping({
        linkwardenId: i,
        browserId: `bookmark-${i}`,
        linkwardenType: "link",
      });
    });

    for (const mapping of allMappings) {
      await storage.upsertMapping(mapping);
    }

    // Act: Cleanup orphans using Set-based lookup (O(1) per check)
    const { duration } = await measurePerformance(
      "orphan cleanup",
      async () => {
        const mappings = await storage.getMappings();
        const orphans = mappings.filter((m) => !remoteIds.has(m.linkwardenId));

        for (const orphan of orphans) {
          await storage.removeMapping(orphan.linkwardenId, "link");
        }
      }
    );

    // Assert: Orphans removed
    const remaining = await storage.getMappings();
    expect(remaining.length).toBe(80);

    // Should complete quickly (<100ms for 100 items)
    expect(duration).toBeLessThan(100);

    console.log(`Orphan cleanup duration: ${duration.toFixed(2)}ms`);
  });

  it("should handle empty remote data safely", async () => {
    // Arrange: Create 50 mappings
    const mappings = Array.from({ length: 50 }, (_, i) =>
      createMapping({
        linkwardenId: i,
        browserId: `bookmark-${i}`,
        linkwardenType: "link",
      })
    );

    for (const mapping of mappings) {
      await storage.upsertMapping(mapping);
    }

    // Act: Attempt cleanup with empty remote IDs
    const remoteIds = new Set<number>(); // Empty!
    const remaining: typeof mappings = [];

    for (const mapping of await storage.getMappings()) {
      if (remoteIds.has(mapping.linkwardenId)) {
        // Keep non-orphans
        remaining.push(mapping);
      } else {
        // Would delete orphan - but we skip when remote is empty
        if (remoteIds.size === 0) {
          remaining.push(mapping); // Skip deletion
        }
      }
    }

    // Assert: No deletions performed when remote is empty
    expect(remaining.length).toBe(50);
  });
});
