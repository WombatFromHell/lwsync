/**
 * Test data factories for BookmarkNode objects
 */

import type { BookmarkNode } from "../../src/types/bookmarks";

let bookmarkCounter = 0;

/**
 * Create a BookmarkNode (bookmark) with sensible defaults
 */
export function createBookmark(
  overrides: Partial<BookmarkNode> = {}
): BookmarkNode {
  bookmarkCounter++;
  const now = Date.now();
  return {
    id: `bookmark-${bookmarkCounter}`,
    title: `Test Bookmark ${bookmarkCounter}`,
    url: `https://example-${bookmarkCounter}.com`,
    parentId: "0",
    dateAdded: now,
    dateGroupModified: now,
    index: 0,
    ...overrides,
  };
}

/**
 * Create a BookmarkNode (folder) with sensible defaults
 */
export function createBookmarkFolder(
  name: string,
  parentId: string,
  overrides: Partial<BookmarkNode> = {}
): BookmarkNode {
  bookmarkCounter++;
  const now = Date.now();
  return {
    id: `folder-${bookmarkCounter}`,
    title: name,
    parentId,
    dateAdded: now,
    dateGroupModified: now,
    index: 0,
    children: [],
    ...overrides,
  };
}

/**
 * Create root bookmark structure (Root, Bookmarks Bar, Other Bookmarks)
 * Note: Returns simple objects for internal mock use
 */
export function createRootStructure(): {
  id: string;
  title: string;
  parentId?: string;
  dateAdded: number;
  dateGroupModified: number;
  index: number;
  children?: string[];
}[] {
  const now = Date.now();
  return [
    {
      id: "0",
      title: "Root",
      dateAdded: now,
      dateGroupModified: now,
      index: 0,
      children: ["1", "2"],
    },
    {
      id: "1",
      title: "Bookmarks Bar",
      parentId: "0",
      dateAdded: now,
      dateGroupModified: now,
      index: 0,
      children: [],
    },
    {
      id: "2",
      title: "Other Bookmarks",
      parentId: "0",
      dateAdded: now,
      dateGroupModified: now,
      index: 1,
      children: [],
    },
  ];
}

/**
 * Reset the bookmark counter (call in beforeEach)
 */
export function resetBookmarkCounter(): void {
  bookmarkCounter = 0;
}
