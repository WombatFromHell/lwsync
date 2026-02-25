/**
 * ID and timestamp utilities
 * Provides wrappers for testability and consistency
 */

/**
 * Generate a unique ID
 * Wrapper around crypto.randomUUID() for testability
 */
export function generateId(): string {
  return crypto.randomUUID();
}

/**
 * Get current timestamp
 * Wrapper around Date.now() for testability
 */
export function now(): number {
  return Date.now();
}

/**
 * Get ISO timestamp string
 * Useful for logging and debugging
 */
export function isoTimestamp(offset = 0): string {
  return new Date(now() + offset).toISOString();
}

/**
 * Get relative timestamp (offset from now)
 * Useful for testing time-based logic
 */
export function relativeTimestamp(offset: number): number {
  return now() + offset;
}
