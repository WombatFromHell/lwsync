/**
 * Mapping and Cache Operations
 * Helpers for building and managing sync caches
 */

import type { LinkwardenAPI } from "../api";
import type { LinkwardenCollection } from "../types/api";
import type { BookmarkNode } from "../types/bookmarks";
import * as bookmarks from "../bookmarks";

/**
 * Build a path string from hierarchy for path-based matching
 * E.g., "/Root Collection/Subcollection/Grandchild"
 */
export function buildPath(
  collectionId: number,
  collectionsCache: Map<number, LinkwardenCollection>
): string {
  const parts: string[] = [];
  let currentId: number | undefined = collectionId;

  while (currentId !== undefined) {
    const collection = collectionsCache.get(currentId);
    if (!collection) break;

    parts.unshift(collection.name);

    // Find parent by checking if any collection contains this as a subcollection
    const parentCollection = Array.from(collectionsCache.values()).find((c) =>
      c.collections?.some((sc: LinkwardenCollection) => sc.id === currentId)
    );

    if (!parentCollection) break;
    currentId = parentCollection.id;
  }

  return `/${parts.join("/")}`;
}

/**
 * Build a browser folder path from hierarchy
 * E.g., "/Other Bookmarks/Root Collection/Subcollection"
 */
export async function buildBrowserPath(
  browserId: string,
  bookmarksCache: Map<string, BookmarkNode>
): Promise<string> {
  const parts: string[] = [];
  let currentId: string | undefined = browserId;

  while (currentId !== undefined) {
    const node = bookmarksCache.get(currentId);
    if (!node) break;

    parts.unshift(node.title || "");

    currentId = node.parentId;
  }

  return `/${parts.join("/")}`;
}

/**
 * Find a browser folder by path
 * Returns the folder ID if found, undefined otherwise
 */
export async function findFolderByPath(
  targetPath: string,
  rootFolderId: string
): Promise<string | undefined> {
  // Normalize path - remove leading slash for splitting
  const pathParts = targetPath.replace(/^\//, "").split("/");

  // Start from root folder
  let currentFolderId = rootFolderId;

  // Traverse path parts (skip first if it matches root folder name)
  const rootFolder = await bookmarks.get(rootFolderId);
  const rootName = rootFolder?.title;

  let startIndex = 0;
  if (pathParts[0] === rootName) {
    startIndex = 1;
  }

  for (let i = startIndex; i < pathParts.length; i++) {
    const partName = pathParts[i];
    const children = await bookmarks.getChildren(currentFolderId);

    // Find folder with matching name (folders have no URL)
    const matchingFolder = children.find(
      (child) => child.title === partName && !child.url
    );

    if (!matchingFolder) {
      return undefined; // Path doesn't exist
    }

    currentFolderId = matchingFolder.id;
  }

  return currentFolderId;
}

/**
 * Find or create a nested folder structure based on path parts
 * Starts from the browser root folder and traverses/creates folders as needed
 * Returns the ID of the deepest (final) folder in the path
 */
export async function findOrCreateNestedFolder(
  pathParts: string[],
  rootFolderId: string
): Promise<string> {
  if (pathParts.length === 0) {
    return rootFolderId;
  }

  let currentFolderId = rootFolderId;

  for (const partName of pathParts) {
    const children = await bookmarks.getChildren(currentFolderId);

    // Find existing folder with matching name (folders have no URL)
    let matchingFolder = children.find(
      (child) => child.title === partName && !child.url
    );

    // Create folder if it doesn't exist
    if (!matchingFolder) {
      matchingFolder = await bookmarks.create({
        parentId: currentFolderId,
        title: partName,
      });
    }

    currentFolderId = matchingFolder.id;
  }

  return currentFolderId;
}

/**
 * Cache all Linkwarden collections for path-based lookup
 */
export async function buildCollectionsCache(
  api: LinkwardenAPI,
  rootCollectionId: number
): Promise<Map<number, LinkwardenCollection>> {
  const cache = new Map<number, LinkwardenCollection>();

  // Fetch all collections
  const allCollections = await api.getCollections();

  // Build parent-child relationships
  for (const collection of allCollections) {
    cache.set(collection.id, { ...collection });
  }

  // Fetch full tree to get complete hierarchy
  const rootCollection = await api.getCollectionTree(rootCollectionId);

  // Update cache with full tree data
  function updateCache(collection: LinkwardenCollection) {
    cache.set(collection.id, collection);
    if (collection.collections) {
      for (const sub of collection.collections) {
        updateCache(sub);
      }
    }
  }

  updateCache(rootCollection);

  return cache;
}

/**
 * Cache browser bookmark tree for path-based lookup
 */
export async function buildBookmarksCache(
  rootFolderId: string
): Promise<Map<string, BookmarkNode>> {
  const cache = new Map<string, BookmarkNode>();

  async function traverse(node: BookmarkNode) {
    cache.set(node.id, node);
    if (node.children) {
      for (const child of node.children) {
        await traverse(child);
      }
    }
  }

  const root = await bookmarks.get(rootFolderId);
  if (root) {
    await traverse(root);
  }

  return cache;
}
