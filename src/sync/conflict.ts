/**
 * Conflict Resolution
 * Handles conflict detection and resolution between Linkwarden and browser bookmarks
 */

import { computeChecksum as computeStringChecksum } from "../utils/hash";
import type { ChecksumItem, ConflictResult } from "../types/sync";
import type { Mapping } from "../types/storage";

/**
 * Compute checksum for a Linkwarden item (for change detection)
 */
export function computeChecksum(item: ChecksumItem): string {
  return computeStringChecksum(`${item.name || ""}|${item.url || ""}`);
}

/**
 * Resolve conflicts between Linkwarden and browser bookmark
 * Strategy: Last-Write-Wins with checksum validation
 */
export function resolveConflict(
  local: Mapping,
  remote: { name?: string; url?: string; updatedAt: string }
): ConflictResult {
  const remoteUpdatedAt = new Date(remote.updatedAt).getTime();

  // 1. If checksums match, no conflict
  const remoteChecksum = computeChecksum(remote);
  if (local.checksum === remoteChecksum) {
    return "no-op";
  }

  // 2. Last-write-wins based on updatedAt timestamp
  if (remoteUpdatedAt > local.browserUpdatedAt) {
    return "use-remote"; // Linkwarden wins
  } else if (local.browserUpdatedAt > remoteUpdatedAt) {
    return "use-local"; // Browser wins
  }

  // 3. Exact timestamp tie: prefer browser (user's immediate action)
  return "use-local";
}
