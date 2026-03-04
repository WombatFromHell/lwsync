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

/**
 * Get test timeout in milliseconds
 */
export function getTestTimeout(): number {
  const envValue = process.env.TEST_TIMEOUT;
  if (envValue) {
    const parsed = parseInt(envValue, 10);
    if (!isNaN(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return 15000; // Default: 15 seconds
}

/**
 * Check if running in CI environment
 */
export function isCI(): boolean {
  return process.env.CI === "true" || process.env.GITHUB_ACTIONS === "true";
}

/**
 * Check if verbose logging is enabled for tests
 */
export function isVerbose(): boolean {
  return process.env.VERBOSE === "true" || process.env.DEBUG === "true";
}
