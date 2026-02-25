/**
 * Sync Module Barrel Exports
 *
 * Note: Main sync engine remains in src/sync.ts for backward compatibility.
 * New modular components are available for future extraction.
 */

// Conflict resolution (new module)
export { computeChecksum, resolveConflict } from "./conflict";
export type { ConflictResult, ChecksumItem } from "../types/sync";

// Move token handling (new module)
export {
  appendMoveToken,
  extractMoveToken,
  removeMoveToken,
  isDescendantOf,
} from "./moves";
export type { MoveToken } from "../types/sync";

// Mapping and cache operations (new module)
export {
  buildPath,
  buildBrowserPath,
  findFolderByPath,
  findOrCreateNestedFolder,
  buildCollectionsCache,
  buildBookmarksCache,
} from "./mappings";

// Link sync (new module)
export { syncLink } from "./links";

// Sync result type
export type { SyncResult } from "../types/sync";

// Re-export main engine for backward compatibility
export { SyncEngine } from "../sync";
