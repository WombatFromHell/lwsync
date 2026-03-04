/**
 * Browser Bookmarks API wrapper
 * Provides a Promise-based interface for chrome.bookmarks
 */

import {
  computeChecksum as computeStringChecksum,
  generateId,
  now,
  chromePromise,
  chromePromiseSingle,
} from "./utils";
import type { Mapping } from "./types/storage";
import type { BookmarkNode } from "./types/bookmarks";
import { detectBrowser } from "./browser";

/**
 * Get the entire bookmarks tree
 */
export async function getTree(): Promise<BookmarkNode[]> {
  return chromePromise((cb) => chrome.bookmarks.getTree(cb));
}

/**
 * Get children of a specific folder
 */
export async function getChildren(id: string): Promise<BookmarkNode[]> {
  return chromePromise((cb) => chrome.bookmarks.getChildren(id, cb));
}

/**
 * Get a bookmark by ID
 */
export async function get(id: string): Promise<BookmarkNode | undefined> {
  return chromePromiseSingle((cb) => chrome.bookmarks.get(id, cb));
}

/**
 * Search bookmarks by query
 */
export async function search(query: string): Promise<BookmarkNode[]> {
  return chromePromise((cb) => chrome.bookmarks.search(query, cb));
}

/**
 * Create a bookmark or folder
 */
export async function create(details: {
  parentId?: string;
  index?: number;
  title?: string;
  url?: string;
}): Promise<BookmarkNode> {
  return chromePromise((cb) => chrome.bookmarks.create(details, cb));
}

/**
 * Update a bookmark
 */
export async function update(
  id: string,
  changes: { title?: string; url?: string }
): Promise<BookmarkNode> {
  return chromePromise((cb) => chrome.bookmarks.update(id, changes, cb));
}

/**
 * Remove a bookmark or empty folder
 */
export async function remove(id: string): Promise<void> {
  return chromePromise((cb) => chrome.bookmarks.remove(id, cb));
}

/**
 * Remove a folder and all its contents
 */
export async function removeTree(id: string): Promise<void> {
  return chromePromise((cb) => chrome.bookmarks.removeTree(id, cb));
}

/**
 * Move a bookmark to a new location
 */
export async function move(
  id: string,
  destination: { parentId?: string; index?: number }
): Promise<BookmarkNode> {
  return chromePromise((cb) => chrome.bookmarks.move(id, destination, cb));
}

/**
 * Find the special "Other Bookmarks" folder
 */
export async function getOtherBookmarksFolder(): Promise<
  BookmarkNode | undefined
> {
  const tree = await getTree();
  if (tree.length === 0) return undefined;

  const root = tree[0];
  // The root contains special folders as children
  if (root.children) {
    // Look for "Other Bookmarks" folder (Chrome) or "Bookmarks Toolbar" (Firefox)
    return root.children.find(
      (child) =>
        child.title === "Other Bookmarks" ||
        child.title === "Bookmarks Toolbar" ||
        child.id === "2"
    );
  }
  return undefined;
}

/**
 * Get the browser-specific root folder ID
 * Firefox: "toolbar_____" (Bookmarks Toolbar)
 * Chrome/Edge: "1" (Bookmarks Bar)
 */
export function getBrowserRootFolderId(): string {
  const browser = detectBrowser();

  if (browser === "firefox") {
    return "toolbar_____";
  }

  return "1";
}

/**
 * Get the default browser root folder name
 */
export function getDefaultBrowserRootFolderName(): string {
  const browser = detectBrowser();

  if (browser === "firefox") {
    return "Bookmarks Toolbar";
  }

  return "Bookmarks";
}

/**
 * Check if a node is a folder (no URL)
 */
export function isFolder(node: BookmarkNode): boolean {
  return !node.url;
}

/**
 * Compute a checksum for a bookmark (for change detection)
 */
export function computeChecksum(node: BookmarkNode): string {
  const str = `${node.title || ""}|${node.url || ""}`;
  return computeStringChecksum(str);
}

/**
 * Convert a BookmarkNode to a Mapping
 */
export function nodeToMapping(
  node: BookmarkNode,
  linkwardenId: number,
  type: "link" | "collection"
): Mapping {
  return {
    id: generateId(),
    linkwardenType: type,
    linkwardenId,
    browserId: node.id,
    linkwardenUpdatedAt: now(),
    browserUpdatedAt: node.dateGroupModified || node.dateAdded || now(),
    lastSyncedAt: now(),
    checksum: computeChecksum(node),
  };
}

/**
 * Reorder multiple bookmarks within the same parent folder
 * Moves all bookmarks to their target indices efficiently
 * Uses atomic reorder to avoid index shifting issues
 *
 * @param items - Array of bookmark IDs and their target indices
 * @param parentId - The parent folder ID (all items must be in this folder)
 */
export async function reorderWithinFolder(
  items: Array<{ id: string; targetIndex: number }>,
  parentId: string
): Promise<void> {
  // Get current children to find items not in the reorder list
  const currentChildren = await getChildren(parentId);
  const currentIds = currentChildren.map((child) => child.id);

  // Build the new order directly from target indices
  // Create array of [targetIndex, id] pairs
  const itemsWithIndex = items.map(
    (item) => [item.targetIndex, item.id] as [number, string]
  );

  // Sort by target index
  itemsWithIndex.sort((a, b) => a[0] - b[0]);

  // Rebuild the children array in the correct order
  const newChildren = itemsWithIndex.map(([_, id]) => id);

  // Add any children that weren't in the reorder list (they stay at the end)
  const reorderedIds = new Set(items.map((i) => i.id));
  for (const childId of currentIds) {
    if (!reorderedIds.has(childId)) {
      newChildren.push(childId);
    }
  }

  // Move each item to its target position
  // The browser handles the reordering internally
  // Process in order to ensure correct final state
  for (let i = 0; i < itemsWithIndex.length; i++) {
    const [targetIndex, id] = itemsWithIndex[i];
    await move(id, { parentId, index: targetIndex });
  }
}
