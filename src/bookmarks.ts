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
