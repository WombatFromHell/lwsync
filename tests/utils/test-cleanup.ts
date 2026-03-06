/**
 * Test Utilities for E2E Tests
 *
 * Enhanced cleanup and tracking for tests that create server-side data
 */

import { createLogger } from "../../src/utils";
import type { LinkwardenAPI, LinkwardenLink } from "../../src/api";

const logger = createLogger("LWSync test-utils");

export interface TestResources {
  linkIds: number[];
  collectionIds: number[];
  bookmarkIds: string[];
}

export function createTestResources(): TestResources {
  return {
    linkIds: [],
    collectionIds: [],
    bookmarkIds: [],
  };
}

/**
 * Cleanup server-side test resources
 */
export async function cleanupServerResources(
  api: LinkwardenAPI,
  resources: TestResources
): Promise<void> {
  const errors: Error[] = [];
  const promises: Promise<void>[] = [];

  // Delete links
  for (const linkId of resources.linkIds) {
    promises.push(
      api.deleteLink(linkId).catch((error: Error) => {
        logger.debug(`Link ${linkId} already deleted or error:`, error.message);
        errors.push(error);
      })
    );
  }

  // Delete collections (auto-deletes child collections and links)
  for (const collectionId of resources.collectionIds) {
    promises.push(
      api.deleteCollection(collectionId).catch((error: Error) => {
        logger.debug(
          `Collection ${collectionId} already deleted or error:`,
          error.message
        );
        errors.push(error);
      })
    );
  }

  await Promise.all(promises);

  logger.info("Server resources cleanup complete", {
    linksAttempted: resources.linkIds.length,
    collectionsAttempted: resources.collectionIds.length,
    errors: errors.length,
  });
}

/**
 * Enhanced cleanup that also removes orphaned test data
 * Scans for links created during tests that weren't tracked
 */
export async function enhancedCleanup(
  api: LinkwardenAPI,
  resources: TestResources,
  collectionId: number
): Promise<void> {
  // First, cleanup tracked resources
  await cleanupServerResources(api, resources);

  // Then, scan for untracked test data
  try {
    const links = await api.getLinksByCollection(collectionId);

    // Look for test pattern links that weren't tracked
    const testPatterns = [
      "example.com/test-",
      "example.com/smoke-",
      "example.com/e2e-",
      "example.com/manual-",
      "example.com/conflict-",
      "example.com/order-",
      "example.com/restore-",
      "example.com/duplicate-",
      "example.com/resync-",
      "test-",
      "smoke-",
      "e2e-",
    ];

    const orphanedLinks = links.filter((link: LinkwardenLink) => {
      const lowerUrl = link.url.toLowerCase();
      const hasPattern = testPatterns.some((pattern) =>
        lowerUrl.includes(pattern)
      );
      const isTracked = resources.linkIds.includes(link.id);
      return hasPattern && !isTracked;
    });

    if (orphanedLinks.length > 0) {
      logger.warn(`Found ${orphanedLinks.length} orphaned test links`, {
        ids: orphanedLinks.map((l) => l.id),
      });

      // Delete orphaned links
      await Promise.all(
        orphanedLinks.map((link) =>
          api.deleteLink(link.id).catch((error) => {
            logger.debug(`Failed to delete orphan ${link.id}:`, error.message);
          })
        )
      );

      logger.info(`Cleaned up ${orphanedLinks.length} orphaned test links`);
    }
  } catch (error) {
    logger.warn("Failed to scan for orphaned links:", (error as Error).message);
  }
}

/**
 * Create a wrapper API client that automatically tracks created resources
 */
export function createTrackedApiClient(
  api: LinkwardenAPI,
  resources: TestResources
): LinkwardenAPI {
  return new Proxy(api, {
    get(target, prop) {
      const original = (target as any)[prop];

      if (typeof original !== "function") {
        return original;
      }

      // Wrap createLink to track created links
      if (prop === "createLink") {
        return async function (...args: any[]) {
          const result = await original.apply(target, args);
          if (result && result.id) {
            resources.linkIds.push(result.id);
            logger.debug(`Tracked created link: ${result.id}`);
          }
          return result;
        };
      }

      // Wrap createCollection to track created collections
      if (prop === "createCollection") {
        return async function (...args: any[]) {
          const result = await original.apply(target, args);
          if (result && result.id) {
            resources.collectionIds.push(result.id);
            logger.debug(`Tracked created collection: ${result.id}`);
          }
          return result;
        };
      }

      return original;
    },
  });
}
