/**
 * Test configuration utilities
 *
 * Centralizes test configuration including collection IDs, timeouts,
 * and environment-based settings.
 */

/**
 * Get the test collection ID from environment variable
 * Falls back to 114 ("Unorganized") if not set
 */
export function getTestCollectionId(): number {
  const envValue = process.env.TEST_COLLECTION;
  if (envValue) {
    const parsed = parseInt(envValue, 10);
    if (!isNaN(parsed) && parsed > 0) {
      return parsed;
    }
  }
  // Default fallback: "Unorganized" collection
  return 114;
}

/**
 * Get the test collection name from environment or use default
 */
export function getTestCollectionName(): string {
  return process.env.TEST_COLLECTION_NAME || "Unorganized";
}
