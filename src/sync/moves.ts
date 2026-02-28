/**
 * Move Token Handling
 * Helpers for folder move tracking via description field
 * Token format: "{LW:MOVE:{"to":parentId,"ts":timestamp}}"
 */

import { CONFIG } from "../config";
import type { MoveToken } from "../types/sync";
import type { BookmarkNode } from "../types/bookmarks";
import * as bookmarks from "../bookmarks";

const { PREFIX: MOVE_TOKEN_PREFIX, SUFFIX: MOVE_TOKEN_SUFFIX } =
  CONFIG.moveTokens;

/**
 * Append move token to collection description
 */
export function appendMoveToken(
  description: string | undefined,
  parentId: number
): string {
  const token: MoveToken = { to: parentId, ts: Date.now() };
  const tokenStr = `${MOVE_TOKEN_PREFIX}${JSON.stringify(token)}${MOVE_TOKEN_SUFFIX}`;
  if (!description) return tokenStr;
  return `${description} ${tokenStr}`;
}

/**
 * Extract move token from description if present
 */
export function extractMoveToken(
  description: string | undefined
): MoveToken | null {
  if (!description) return null;

  // Match {LW:MOVE:{...}} pattern - handles nested JSON
  const match = description.match(/\{LW:MOVE:(\{[^}]+\})\}/);
  if (!match) return null;

  try {
    return JSON.parse(match[1]);
  } catch {
    return null;
  }
}

/**
 * Remove move token from description
 */
export function removeMoveToken(description: string | undefined): string {
  if (!description) return "";
  return description.replace(/\s*\{LW:MOVE:\{[^}]+\}\}/g, "").trim();
}

/**
 * Check if a folder is a descendant of another folder (prevent circular moves)
 * Traverses up the parent chain to see if targetParentId is an ancestor
 */
export async function isDescendantOf(
  folderBrowserId: string,
  targetParentId: string,
  bookmarksCache?: Map<string, BookmarkNode>
): Promise<boolean> {
  // Build cache if not provided
  if (!bookmarksCache) {
    bookmarksCache = new Map();
    async function traverse(node: BookmarkNode) {
      bookmarksCache!.set(node.id, node);
      if (node.children) {
        for (const child of node.children) {
          await traverse(child);
        }
      }
    }
    const tree = await bookmarks.getTree();
    for (const root of tree) {
      await traverse(root);
    }
  }

  // Traverse up from folder to see if we reach targetParentId
  let currentId: string | undefined = folderBrowserId;
  while (currentId) {
    const node = bookmarksCache.get(currentId);
    if (!node) break;

    // If parent is the target, it's a descendant
    if (node.parentId === targetParentId) {
      return true;
    }

    // If we've reached the target itself
    if (currentId === targetParentId) {
      return true;
    }

    currentId = node.parentId;
  }

  return false;
}
