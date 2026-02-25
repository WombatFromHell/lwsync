/**
 * Test utility functions for generating unique test data
 */

let uniqueCounter = 0;

/**
 * Generate a unique ID
 * @param prefix - Prefix for the ID (default: "id")
 */
export function uniqueId(prefix = "id"): string {
  uniqueCounter++;
  return `${prefix}-${Date.now()}-${uniqueCounter}`;
}

/**
 * Generate a unique URL
 */
export function uniqueUrl(): string {
  const random = Math.random().toString(36).slice(2, 6);
  return `https://test-${Date.now()}-${random}.example.com`;
}

/**
 * Generate a unique title
 * @param prefix - Prefix for the title (default: "Test")
 */
export function uniqueTitle(prefix = "Test"): string {
  return `${prefix} ${Date.now()}`;
}

/**
 * Get current timestamp
 * @param offset - Milliseconds to add/subtract (default: 0)
 */
export function timestamp(offset = 0): number {
  return Date.now() + offset;
}

/**
 * Get ISO timestamp
 * @param offset - Milliseconds to add/subtract (default: 0)
 */
export function isoTimestamp(offset = 0): string {
  return new Date(timestamp(offset)).toISOString();
}

/**
 * Reset the unique counter (call in beforeEach)
 */
export function resetUniqueCounter(): void {
  uniqueCounter = 0;
}

/**
 * Create a past timestamp (for testing "older" items)
 * @param daysAgo - Days in the past (default: 1)
 */
export function pastTimestamp(daysAgo = 1): number {
  return Date.now() - daysAgo * 24 * 60 * 60 * 1000;
}

/**
 * Create a future timestamp (for testing "newer" items)
 * @param daysFromNow - Days in the future (default: 1)
 */
export function futureTimestamp(daysFromNow = 1): number {
  return Date.now() + daysFromNow * 24 * 60 * 60 * 1000;
}

/**
 * Create a past ISO timestamp
 * @param daysAgo - Days in the past (default: 1)
 */
export function pastIsoTimestamp(daysAgo = 1): string {
  return new Date(pastTimestamp(daysAgo)).toISOString();
}

/**
 * Create a future ISO timestamp
 * @param daysFromNow - Days in the future (default: 1)
 */
export function futureIsoTimestamp(daysFromNow = 1): string {
  return new Date(futureTimestamp(daysFromNow)).toISOString();
}
