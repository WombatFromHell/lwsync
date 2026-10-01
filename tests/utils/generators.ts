/**
 * Test utility functions for generating unique test data
 */

/**
 * Get current timestamp
 * @param offset - Milliseconds to add/subtract (default: 0)
 */
export function timestamp(offset = 0): number {
  return Date.now() + offset;
}
