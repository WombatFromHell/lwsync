/**
 * Mock implementation of chrome.storage.local
 * Provides in-memory storage for testing
 */

export class MockStorage {
  private data: Record<string, unknown> = {};

  /**
   * Get items from storage
   */
  get<T = Record<string, unknown>>(
    keys: keyof T | (keyof T)[] | Partial<T> | null | undefined,
    callback?: (result: T) => void
  ): Promise<T> {
    const result: Record<string, unknown> = {};

    if (keys) {
      const keyArray = Array.isArray(keys)
        ? keys
        : typeof keys === "object"
          ? Object.keys(keys)
          : [keys as string];

      for (const key of keyArray) {
        result[key as string] = this.data[key as string];
      }
    }

    const promise = Promise.resolve(result as T);

    if (callback) {
      promise.then((r) => setTimeout(() => callback(r), 0));
    }

    return promise;
  }

  /**
   * Set items in storage
   */
  set<T = Record<string, unknown>>(
    items: Partial<T>,
    callback?: () => void
  ): Promise<void> {
    Object.assign(this.data, items);

    const promise = Promise.resolve();

    if (callback) {
      promise.then(() => setTimeout(callback, 0));
    }

    return promise;
  }

  /**
   * Remove items from storage
   */
  remove(keys: string | string[], callback?: () => void): Promise<void> {
    const keyArray = Array.isArray(keys) ? keys : [keys];

    for (const key of keyArray) {
      delete this.data[key];
    }

    const promise = Promise.resolve();

    if (callback) {
      promise.then(() => setTimeout(callback, 0));
    }

    return promise;
  }

  /**
   * Clear all storage
   */
  clear(callback?: () => void): Promise<void> {
    this.data = {};

    const promise = Promise.resolve();

    if (callback) {
      promise.then(() => setTimeout(callback, 0));
    }

    return promise;
  }

  /**
   * Get bytes in use (always returns 0 for mocks)
   * Signature matches chrome.storage.local.getBytesInUse
   */
  getBytesInUse(
    keysOrCallback?:
      | string
      | string[]
      | number
      | symbol
      | (string | number | symbol)[]
      | null
      | ((bytes: number) => void),
    callback?: (bytes: number) => void
  ): Promise<number> {
    // If first arg is a function, it's the callback (no keys provided)
    const actualCallback =
      typeof keysOrCallback === "function" ? keysOrCallback : callback;

    const promise = Promise.resolve(0);

    if (actualCallback) {
      promise.then((b) => setTimeout(() => actualCallback(b), 0));
    }

    return promise;
  }

  /**
   * Get all data (for testing assertions)
   * Returns a copy by default, pass true for direct reference
   */
  getAllData(copy = true): Record<string, unknown> {
    return copy ? { ...this.data } : this.data;
  }

  /**
   * Set all data (for test setup)
   */
  setAllData(data: Record<string, unknown>): void {
    this.data = { ...data };
  }

  /**
   * Clear all data (for test cleanup)
   */
  clearAll(): void {
    this.data = {};
  }

  /**
   * Convert to chrome.storage.local API format
   */
  toChromeAPI(): typeof chrome.storage.local {
    return {
      get: this.get.bind(this),
      set: this.set.bind(this),
      remove: this.remove.bind(this),
      clear: this.clear.bind(this),
      getBytesInUse: this.getBytesInUse.bind(this),
      QUOTA_BYTES: 10485760,
      setAccessLevel: () => void 0,
      onChanged: {
        addListener: () => void 0,
        removeListener: () => void 0,
        hasListener: () => false,
        hasListeners: () => false,
      },
      getKeys: () => Promise.resolve(Object.keys(this.data)),
    } as unknown as typeof chrome.storage.local;
  }
}
