/**
 * Browser Bookmarks API wrapper
 * Provides a Promise-based interface for chrome.bookmarks
 */

import { computeChecksum as computeStringChecksum } from "./utils/hash";
import { generateId, now } from "./utils/id";
import type { Mapping } from "./types/storage";
import type { BookmarkNode } from "./types/bookmarks";
import { detectBrowser } from "./browser";

/**
 * Get the entire bookmarks tree
 */
export async function getTree(): Promise<BookmarkNode[]> {
  return new Promise((resolve, reject) => {
    chrome.bookmarks.getTree((tree) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(tree);
      }
    });
  });
}

/**
 * Get children of a specific folder
 */
export async function getChildren(id: string): Promise<BookmarkNode[]> {
  return new Promise((resolve, reject) => {
    chrome.bookmarks.getChildren(id, (children) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(children);
      }
    });
  });
}

/**
 * Get a bookmark by ID
 */
export async function get(id: string): Promise<BookmarkNode | undefined> {
  const results = await new Promise<BookmarkNode[]>((resolve, reject) => {
    chrome.bookmarks.get(id, (nodes) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(nodes);
      }
    });
  });
  return results[0];
}

/**
 * Search bookmarks by query
 */
export async function search(query: string): Promise<BookmarkNode[]> {
  return new Promise((resolve, reject) => {
    chrome.bookmarks.search(query, (results) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(results);
      }
    });
  });
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
  return new Promise((resolve, reject) => {
    chrome.bookmarks.create(details, (node) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(node);
      }
    });
  });
}

/**
 * Update a bookmark
 */
export async function update(
  id: string,
  changes: { title?: string; url?: string }
): Promise<BookmarkNode> {
  return new Promise((resolve, reject) => {
    chrome.bookmarks.update(id, changes, (node) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(node);
      }
    });
  });
}

/**
 * Remove a bookmark or empty folder
 */
export async function remove(id: string): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.bookmarks.remove(id, () => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve();
      }
    });
  });
}

/**
 * Remove a folder and all its contents
 */
export async function removeTree(id: string): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.bookmarks.removeTree(id, () => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve();
      }
    });
  });
}

/**
 * Move a bookmark to a new location
 */
export async function move(
  id: string,
  destination: { parentId?: string; index?: number }
): Promise<BookmarkNode> {
  return new Promise((resolve, reject) => {
    chrome.bookmarks.move(id, destination, (node) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(node);
      }
    });
  });
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
