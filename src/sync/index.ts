/**
 * Sync Module Barrel Exports
 *
 * Modular sync components for maintainability and testability.
 * Main SyncEngine available from engine.ts.
 */

// Core engine (includes SyncStats inline)
export { SyncEngine } from "./engine";
export type { SyncStatsObject, SyncStatType } from "./engine";

// Sync modules
export { BrowserChangeApplier } from "./browser-changes";
export { RemoteSync } from "./remote-sync";
export { CollectionSync } from "./collections";
export { SyncInitializer } from "./initialization";
export { OrphanCleanup } from "./orphans";

// Utilities
export { SyncErrorReporter, createErrorContext } from "./errorReporter";
export type { ErrorEntry, ErrorContext } from "./errorReporter";

// Conflict resolution
export { computeChecksum, resolveConflict } from "./conflict";
export type { ConflictResult, ChecksumItem } from "../types/sync";

// Move token handling
export {
  appendMoveToken,
  extractMoveToken,
  removeMoveToken,
  isDescendantOf,
} from "./moves";
export type { MoveToken } from "../types/sync";

// Mapping and cache operations
export {
  buildPath,
  buildBrowserPath,
  findFolderByPath,
  findOrCreateNestedFolder,
  buildCollectionsCache,
  buildBookmarksCache,
} from "./mappings";

// Path utilities (re-export for tests)
export { parseFolderPath } from "../utils";

// Link sync
export { syncLink } from "./links";

// Sync result type
export type { SyncResult } from "../types/sync";
