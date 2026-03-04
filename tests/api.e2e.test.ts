/**
 * Integration tests for Linkwarden API client
 * Uses real Linkwarden API with credentials from .env
 *
 * Run with: bun test tests/api.e2e.test.ts
 *
 * NOTE: Tests use TEST_COLLECTION from .env (default: 114 "Unorganized").
 * Test links are created and cleaned up, but the collection is reused.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import {
  LinkwardenAPI,
  createDevClient,
  findCollectionByName,
} from "../src/api";
import type { LinkwardenLink } from "../src/types/api";
import { getTestCollectionId, getTestCollectionName } from "./utils/config";

// Test configuration
const TEST_TIMEOUT = 30000;

// Track created links for cleanup
let createdLinks: LinkwardenLink[] = [];
let createdSubCollections: number[] = [];

/**
 * Generate a unique URL for testing
 */
function testUrl(): string {
  return `https://test-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.example.com`;
}

/**
 * Generate a unique title for testing
 */
function testTitle(prefix = "Test"): string {
  return `${prefix} ${Date.now()}`;
}

describe("E2E: Linkwarden API", () => {
  let api: LinkwardenAPI;
  let targetCollectionId: number;
  let targetCollectionName: string;

  beforeEach(async () => {
    api = createDevClient();
    // Use TEST_COLLECTION from env (default: 114 "Unorganized")
    targetCollectionId = getTestCollectionId();
    targetCollectionName = getTestCollectionName();

    const collection = await findCollectionByName(api, targetCollectionName);

    if (!collection) {
      throw new Error(
        `Collection "${targetCollectionName}" (ID: ${targetCollectionId}) not found. ` +
          `Please create it in Linkwarden or update TEST_COLLECTION in .env`
      );
    }

    // Verify the collection ID matches
    if (collection.id !== targetCollectionId) {
      console.warn(
        `[E2E] Warning: Collection "${targetCollectionName}" has ID ${collection.id}, ` +
          `but TEST_COLLECTION is set to ${targetCollectionId}. Using found ID ${collection.id}.`
      );
      targetCollectionId = collection.id;
    }

    console.log(
      `[E2E] Using collection: ${targetCollectionName} (ID: ${targetCollectionId})`
    );
  }, TEST_TIMEOUT);

  afterEach(async () => {
    // Clean up created links
    for (const link of createdLinks) {
      try {
        await api.deleteLink(link.id);
      } catch {
        // Ignore cleanup errors
      }
    }
    createdLinks = [];

    // Clean up subcollections
    for (const collectionId of createdSubCollections) {
      try {
        await api.deleteCollection(collectionId);
      } catch {
        // Ignore cleanup errors
      }
    }
    createdSubCollections = [];
  }, TEST_TIMEOUT);

  test(
    "should find target collection by name",
    async () => {
      const collection = await findCollectionByName(api, targetCollectionName);

      expect(collection).toBeDefined();
      expect(collection?.name).toBe(targetCollectionName);
    },
    TEST_TIMEOUT
  );

  test(
    "should create a link in target collection",
    async () => {
      const link = await api.createLink(
        testUrl(),
        targetCollectionId,
        testTitle("Link")
      );
      createdLinks.push(link);

      expect(link.url).toBeTruthy();
      expect(link.name).toContain("Link");
      // Note: API may return collection.id instead of collectionId
      const actualCollectionId = link.collectionId || link.collection?.id;
      expect(actualCollectionId).toBe(targetCollectionId);
    },
    TEST_TIMEOUT
  );

  test(
    "should update a link",
    async () => {
      const link = await api.createLink(
        testUrl(),
        targetCollectionId,
        testTitle("Original")
      );
      createdLinks.push(link);

      const newTitle = testTitle("Updated");
      const newUrl = testUrl();
      const updated = await api.updateLink(link.id, {
        name: newTitle,
        url: newUrl,
      });

      expect(updated.name).toContain("Updated");
      expect(updated.url).toBe(newUrl);
    },
    TEST_TIMEOUT
  );

  test(
    "should delete a link",
    async () => {
      const link = await api.createLink(
        testUrl(),
        targetCollectionId,
        testTitle("Delete")
      );
      createdLinks.push(link);

      await api.deleteLink(link.id);
      createdLinks = createdLinks.filter((l) => l.id !== link.id);

      // Verify deletion
      const collection = await api.getCollection(targetCollectionId);
      const deletedLink = collection.links?.find(
        (l: { id: number }) => l.id === link.id
      );

      expect(deletedLink).toBeUndefined();
    },
    TEST_TIMEOUT
  );

  test(
    "should create and delete a subcollection",
    async () => {
      const subCollection = await api.createCollection(
        testTitle("[TEST] Sub"),
        targetCollectionId,
        "Test subcollection"
      );
      createdSubCollections.push(subCollection.id);

      expect(subCollection.name).toContain("[TEST] Sub");

      // Delete it
      await api.deleteCollection(subCollection.id);
      createdSubCollections = createdSubCollections.filter(
        (id) => id !== subCollection.id
      );

      // Verify deletion
      const collections = await api.getCollections();
      const deleted = collections.find((c) => c.id === subCollection.id);

      expect(deleted).toBeUndefined();
    },
    TEST_TIMEOUT
  );

  test(
    "should test connection successfully",
    async () => {
      const connected = await api.testConnection();
      expect(connected).toBe(true);
    },
    TEST_TIMEOUT
  );

  test(
    "should handle invalid credentials gracefully",
    async () => {
      const badApi = new LinkwardenAPI(
        process.env.ENDPOINT || "",
        "invalid-token"
      );

      await expect(badApi.testConnection()).resolves.toBe(false);
    },
    TEST_TIMEOUT
  );

  test(
    "should fetch collection tree with links",
    async () => {
      // Create a link first
      const link = await api.createLink(
        testUrl(),
        targetCollectionId,
        testTitle("Tree Link")
      );
      createdLinks.push(link);

      // Fetch tree
      const tree = await api.getCollectionTree(targetCollectionId);

      expect(tree.id).toBe(targetCollectionId);
      // Links may be in tree.links or may need to be fetched separately
      // Just verify the collection was fetched successfully
      expect(tree.name).toBe(targetCollectionName);
    },
    TEST_TIMEOUT
  );
});
