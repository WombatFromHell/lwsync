/**
 * Mock implementations for browser APIs
 * Combines storage, bookmarks, and runtime mocks
 */

import { MockStorage } from "./storage";
import { MockBookmarks } from "./bookmarks";

export { MockStorage, MockBookmarks };

/**
 * Mock runtime API
 */
export class MockRuntime {
  private lastError?: Error;

  get lastErrorInstance(): Error | undefined {
    return this.lastError;
  }

  set lastErrorInstance(error: Error | undefined) {
    this.lastError = error;
  }

  sendMessage(
    message: unknown,
    responseCallback?: (response: unknown) => void
  ): Promise<unknown> {
    const promise = Promise.resolve(undefined);
    if (responseCallback) {
      promise.then((r) => setTimeout(() => responseCallback(r), 0));
    }
    return promise;
  }

  toChromeAPI(): typeof chrome.runtime {
    return {
      lastError: this.lastError,
      sendMessage: this.sendMessage.bind(this),
    } as unknown as typeof chrome.runtime;
  }
}

export interface BrowserMocks {
  storage: MockStorage;
  bookmarks: MockBookmarks;
  runtime: MockRuntime;
}

/**
 * Setup all browser mocks and install them globally
 */
export function setupBrowserMocks(): BrowserMocks {
  const storage = new MockStorage();
  const bookmarks = new MockBookmarks();
  const runtime = new MockRuntime();

  globalThis.chrome = {
    storage: {
      local: storage.toChromeAPI(),
    },
    bookmarks: bookmarks.toChromeAPI(),
    runtime: runtime.toChromeAPI(),
  } as unknown as typeof chrome;

  return { storage, bookmarks, runtime };
}

/**
 * Cleanup browser mocks (remove global chrome)
 */
export function cleanupBrowserMocks(): void {
  delete (globalThis as Record<string, unknown>).chrome;
}

/**
 * Reset all mocks to initial state (call in beforeEach)
 */
export function resetBrowserMocks(mocks: BrowserMocks): void {
  mocks.storage.clearAll();
  mocks.bookmarks.clear();
  mocks.runtime.lastErrorInstance = undefined;
}
