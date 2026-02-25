/**
 * Hash and checksum utilities
 * Provides deterministic hashing for change detection
 */

/**
 * Compute a checksum for change detection
 * Uses a simple hash function - good enough for detecting changes
 */
export function computeChecksum(data: string): string {
  let hash = 0;
  for (let i = 0; i < data.length; i++) {
    const char = data.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return Math.abs(hash).toString(16);
}

/**
 * Compute checksum for an object with name and/or url properties
 * Convenience wrapper for common use case
 */
export function computeObjectChecksum(obj: {
  name?: string;
  url?: string;
}): string {
  const str = `${obj.name || ""}|${obj.url || ""}`;
  return computeChecksum(str);
}
