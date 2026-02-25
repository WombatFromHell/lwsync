/**
 * Sync Types
 * Type definitions for sync engine operations and conflict resolution
 */

/**
 * Conflict resolution result
 */
export type ConflictResult = "no-op" | "use-remote" | "use-local";

/**
 * Move token for folder move tracking via description field
 * Token format: "{LW:MOVE:{"to":parentId,"ts":timestamp}}"
 */
export interface MoveToken {
  to: number;
  ts: number;
}

/**
 * Sync result statistics
 */
export interface SyncResult {
  created: number;
  updated: number;
  deleted: number;
  skipped: number;
  errors: string[];
}

/**
 * Checksum computable item
 */
export interface ChecksumItem {
  name?: string;
  url?: string;
}
