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
export type { BatchResult, LinkMove } from "./browser-changes";
export { BatchOperations, createBatchOperations } from "./browser-changes";
export { RemoteSync } from "./remote-sync";
export { CollectionSync } from "./collections";
export type { CollectionSyncDeps, CollectionCaches } from "./collections";
export { SyncInitializer } from "./initialization";
export { OrphanCleanup } from "./orphans";
export { SyncComparator } from "./comparator";
export { MappingCache } from "./mapping-cache";

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

// Path and cache utilities (re-export from collections.ts)
export {
  buildPath,
  findOrCreateNestedFolder,
  buildCollectionsCache,
  buildBookmarksCache,
} from "./collections";

// Path utilities (re-export for tests)
export { parseFolderPath } from "../utils";

// Link sync (re-export from collections.ts)
export { syncLink } from "./collections";

// Sync result type
export type { SyncResult } from "../types/sync";
