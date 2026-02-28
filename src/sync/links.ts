/**
 * Link Sync Operations
 * Handles syncing individual links from Linkwarden to browser
 */

import * as storage from "../storage";
import * as bookmarks from "../bookmarks";
import { createLogger, generateId, now } from "../utils";
import { computeChecksum, resolveConflict } from "./conflict";
import type { LinkwardenLink } from "../types/api";
import type { Mapping } from "../types/storage";

const logger = createLogger("LWSync links");

/**
 * Sync a single link from Linkwarden to browser
 */
export async function syncLink(
  link: LinkwardenLink,
  parentBrowserId: string,
  errors: string[],
  stats: { created: number; updated: number; deleted: number; skipped: number }
): Promise<void> {
  try {
    const existing = await storage.getMappingByLinkwardenId(link.id, "link");

    if (existing) {
      await updateExistingLink(link, parentBrowserId, existing, stats);
    } else {
      await createNewLink(link, parentBrowserId, stats);
    }
  } catch (error) {
    errors.push(
      `Failed to sync link ${link.id}: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Update an existing linked bookmark
 */
async function updateExistingLink(
  link: LinkwardenLink,
  parentBrowserId: string,
  existing: Mapping,
  stats: { created: number; updated: number; deleted: number; skipped: number }
): Promise<void> {
  const result = resolveConflict(existing, link);

  if (result === "use-remote") {
    // Check if link was moved to a different folder on server
    const currentNode = await bookmarks.get(existing.browserId);
    const wasMoved = currentNode?.parentId !== parentBrowserId;

    if (wasMoved) {
      logger.info("Link moved on server, updating browser:", {
        linkId: link.id,
        linkName: link.name,
        fromParentId: currentNode?.parentId,
        toParentId: parentBrowserId,
      });

      await bookmarks.move(existing.browserId, {
        parentId: parentBrowserId,
      });

      logger.info("Link move completed in browser:", link.name);
    }

    // Update browser bookmark title and URL
    await bookmarks.update(existing.browserId, {
      title: link.name,
      url: link.url,
    });

    existing.browserUpdatedAt = now();
    existing.checksum = computeChecksum(link);
    existing.lastSyncedAt = now();
    await storage.upsertMapping(existing);
    stats.updated++;
  } else if (result === "no-op") {
    // Check if link was moved on server (even if no content change)
    const currentNode = await bookmarks.get(existing.browserId);
    const wasMoved = currentNode?.parentId !== parentBrowserId;

    if (wasMoved) {
      logger.info("Link moved on server (no content change):", {
        linkId: link.id,
        linkName: link.name,
        fromParentId: currentNode?.parentId,
        toParentId: parentBrowserId,
      });

      await bookmarks.move(existing.browserId, {
        parentId: parentBrowserId,
      });

      logger.info("Link move completed in browser:", link.name);
    }

    // Just update last synced time
    existing.lastSyncedAt = now();
    await storage.upsertMapping(existing);
  }
  // "use-local" - browser changes win, do nothing
}

/**
 * Create a new browser bookmark for a Linkwarden link
 */
async function createNewLink(
  link: LinkwardenLink,
  parentBrowserId: string,
  stats: { created: number; updated: number; deleted: number; skipped: number }
): Promise<void> {
  // Check if bookmark already exists by URL
  const existingBookmarks = await bookmarks.search(link.url);
  const matchingBookmark = existingBookmarks.find(
    (b) => b.parentId === parentBrowserId && b.title === link.name
  );

  if (matchingBookmark) {
    // Bookmark exists but has no mapping - create mapping (don't duplicate)
    const mapping: Mapping = {
      id: generateId(),
      linkwardenType: "link",
      linkwardenId: link.id,
      browserId: matchingBookmark.id,
      linkwardenUpdatedAt: new Date(link.updatedAt).getTime(),
      browserUpdatedAt:
        matchingBookmark.dateGroupModified ||
        matchingBookmark.dateAdded ||
        now(),
      lastSyncedAt: now(),
      checksum: computeChecksum(link),
    };
    await storage.upsertMapping(mapping);
  } else {
    // Create new bookmark
    const node = await bookmarks.create({
      parentId: parentBrowserId,
      title: link.name,
      url: link.url,
    });

    const mapping: Mapping = {
      id: generateId(),
      linkwardenType: "link",
      linkwardenId: link.id,
      browserId: node.id,
      linkwardenUpdatedAt: new Date(link.updatedAt).getTime(),
      browserUpdatedAt: node.dateAdded || now(),
      lastSyncedAt: now(),
      checksum: computeChecksum(link),
    };
    await storage.upsertMapping(mapping);
    stats.created++;
  }
}
