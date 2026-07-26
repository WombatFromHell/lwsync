/**
 * Conflict Resolution
 * Handles conflict detection and resolution between Linkwarden and browser bookmarks
 */

import { computeChecksum as computeItemChecksum } from "../utils";
import type { ChecksumItem, ConflictResult } from "../types/sync";
import type { Mapping, SyncPreference } from "../types/storage";

/**
 * Compute checksum for a Linkwarden item (for change detection)
 * Re-export for backward compatibility
 */
export function computeChecksum(item: ChecksumItem): string {
  return computeItemChecksum(item);
}

/**
 * Resolve conflicts between Linkwarden and browser bookmark
 * Strategy: Last-Write-Wins with checksum validation, optionally overridden by sync preference
 */
export function resolveConflict(
  local: Mapping,
  remote: { name?: string; url?: string; updatedAt: string },
  preference: SyncPreference = "prefer-remote"
): ConflictResult {
  // 1. If checksums match, no conflict regardless of preference
  const remoteChecksum = computeChecksum(remote);
  if (local.checksum === remoteChecksum) {
    return "no-op";
  }

  // 2. "prefer-local": browser wins whenever content differs
  if (preference === "prefer-local") {
    return "use-local";
  }

  // 3. "prefer-remote": last-write-wins by updatedAt timestamp
  const remoteUpdatedAt = new Date(remote.updatedAt).getTime();
  if (remoteUpdatedAt > local.browserUpdatedAt) {
    return "use-remote"; // Linkwarden wins
  } else if (local.browserUpdatedAt > remoteUpdatedAt) {
    return "use-local"; // Browser wins
  }

  // 4. Exact timestamp tie: prefer browser (user's immediate action)
  return "use-local";
}
