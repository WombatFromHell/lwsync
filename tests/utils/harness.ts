/**
 * Test Harness
 * Centralized test setup and teardown utility
 *
 * Reduces boilerplate by combining mock setup into a single helper.
 *
 * Usage:
 * ```typescript
 * import { createTestHarness } from "./utils/harness";
 *
 * const harness = createTestHarness();
 *
 * beforeEach(() => harness.setup());
 * afterEach(() => harness.cleanup());
 *
 * // Access mocks via harness
 * harness.api.createLink(...);
 * harness.storage.upsertMapping(...);
 * harness.bookmarks.create(...);
 * ```
 */

import {
  setupBrowserMocks,
  cleanupBrowserMocks,
  type BrowserMocks,
} from "../mocks/browser";
import { MockLinkwardenAPI } from "../mocks/linkwarden";

export class TestHarness {
  /** Mock browser APIs (storage, bookmarks, runtime) */
  mocks: BrowserMocks | null = null;

  /** Mock Linkwarden API */
  api: MockLinkwardenAPI | null = null;

  /**
   * Setup all mocks and create mock API instance
   * Call in beforeEach()
   */
  setup(): void {
    this.mocks = setupBrowserMocks();
    this.api = new MockLinkwardenAPI();
  }

  /**
   * Cleanup all mocks
   * Call in afterEach()
   */
  cleanup(): void {
    cleanupBrowserMocks();
    this.mocks = null;
    this.api = null;
  }

  /**
   * Get storage mock (shorthand)
   */
  get storage() {
    if (!this.mocks) {
      throw new Error("Harness not initialized. Call setup() first.");
    }
    return this.mocks.storage;
  }

  /**
   * Get bookmarks mock (shorthand)
   */
  get bookmarks() {
    if (!this.mocks) {
      throw new Error("Harness not initialized. Call setup() first.");
    }
    return this.mocks.bookmarks;
  }

  /**
   * Get runtime mock (shorthand)
   */
  get runtime() {
    if (!this.mocks) {
      throw new Error("Harness not initialized. Call setup() first.");
    }
    return this.mocks.runtime;
  }

  /**
   * Reset all mocks to initial state
   * Call in beforeEach() after setup() if needed
   */
  reset(): void {
    if (this.mocks) {
      this.mocks.storage.clearAll();
      this.mocks.bookmarks.clear();
      this.mocks.runtime.lastErrorInstance = undefined;
    }
    if (this.api) {
      this.api.clear();
    }
  }
}

/**
 * Create a new test harness instance
 */
export function createTestHarness(): TestHarness {
  return new TestHarness();
}
