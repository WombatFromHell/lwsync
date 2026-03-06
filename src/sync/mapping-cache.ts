/**
 * Mapping Cache
 *
 * In-memory cache for sync mappings to avoid repeated storage lookups.
 * Provides O(1) lookup by both Linkwarden ID and browser ID.
 *
 * Usage:
 *   const cache = new MappingCache();
 *   await cache.load();
 *   const mapping = cache.getMappingByLinkwardenId(1, "link");
 */

import * as storage from "../storage";
import type { Mapping } from "../types/storage";
import { createLogger } from "../utils";

const logger = createLogger("LWSync mapping-cache");

export class MappingCache {
  private byLinkwardenId = new Map<string, Mapping>();
  private byBrowserId = new Map<string, Mapping>();
  private byType = new Map<"link" | "collection", Mapping[]>();
  private loaded = false;

  /**
   * Get number of cached mappings
   */
  get size(): number {
    return this.byLinkwardenId.size;
  }

  /**
   * Check if cache has been loaded
   */
  get isLoaded(): boolean {
    return this.loaded;
  }

  /**
   * Load all mappings from storage into memory
   * Should be called once at the start of sync
   */
  async load(): Promise<void> {
    logger.debug("Loading mapping cache...");
    const start = performance.now();

    const mappings = await storage.getMappings();

    // Clear existing cache
    this.clear();

    // Index all mappings
    for (const mapping of mappings) {
      this.indexMapping(mapping);
    }

    this.loaded = true;
    const duration = performance.now() - start;

    logger.debug("Mapping cache loaded:", {
      count: mappings.length,
      duration: `${duration.toFixed(2)}ms`,
    });
  }

  /**
   * Clear all cached mappings
   */
  clear(): void {
    this.byLinkwardenId.clear();
    this.byBrowserId.clear();
    this.byType.clear();
    this.loaded = false;
  }

  /**
   * Get mapping by Linkwarden ID and type
   * O(1) lookup
   */
  getMappingByLinkwardenId(
    id: number,
    type: "link" | "collection"
  ): Mapping | undefined {
    const key = this.buildLinkwardenKey(id, type);
    return this.byLinkwardenId.get(key);
  }

  /**
   * Get mapping by browser ID
   * O(1) lookup
   */
  getMappingByBrowserId(browserId: string): Mapping | undefined {
    return this.byBrowserId.get(browserId);
  }

  /**
   * Get all mappings of specified type
   */
  getMappingsByType(type: "link" | "collection"): Mapping[] {
    return this.byType.get(type) || [];
  }

  /**
   * Get all cached mappings
   */
  getAllMappings(): Mapping[] {
    return Array.from(this.byLinkwardenId.values());
  }

  /**
   * Upsert mapping to both storage and cache
   * Use this instead of storage.upsertMapping() when cache is active
   */
  async upsert(mapping: Mapping): Promise<void> {
    await storage.upsertMapping(mapping);
    this.indexMapping(mapping);
  }

  /**
   * Remove mapping from both storage and cache
   */
  async remove(
    linkwardenId: number,
    type: "link" | "collection"
  ): Promise<void> {
    const key = this.buildLinkwardenKey(linkwardenId, type);
    const existing = this.byLinkwardenId.get(key);

    if (existing) {
      this.byBrowserId.delete(existing.browserId);
    }

    this.byLinkwardenId.delete(key);

    const typeList = this.byType.get(type);
    if (typeList) {
      const index = typeList.findIndex((m) => m.linkwardenId === linkwardenId);
      if (index !== -1) {
        typeList.splice(index, 1);
      }
    }

    await storage.removeMapping(linkwardenId, type);
  }

  /**
   * Bulk upsert multiple mappings
   * More efficient than individual upserts
   */
  async upsertMany(mappings: Mapping[]): Promise<void> {
    // Batch storage operation
    for (const mapping of mappings) {
      await storage.upsertMapping(mapping);
    }

    // Update cache
    for (const mapping of mappings) {
      this.indexMapping(mapping);
    }
  }

  /**
   * Bulk remove multiple mappings
   */
  async removeMany(
    items: Array<{ linkwardenId: number; type: "link" | "collection" }>
  ): Promise<void> {
    for (const { linkwardenId, type } of items) {
      const key = this.buildLinkwardenKey(linkwardenId, type);
      const existing = this.byLinkwardenId.get(key);

      if (existing) {
        this.byBrowserId.delete(existing.browserId);
      }

      this.byLinkwardenId.delete(key);

      const typeList = this.byType.get(type);
      if (typeList) {
        const index = typeList.findIndex(
          (m) => m.linkwardenId === linkwardenId
        );
        if (index !== -1) {
          typeList.splice(index, 1);
        }
      }

      await storage.removeMapping(linkwardenId, type);
    }
  }

  /**
   * Check if mapping exists in cache
   */
  hasMapping(linkwardenId: number, type: "link" | "collection"): boolean {
    const key = this.buildLinkwardenKey(linkwardenId, type);
    return this.byLinkwardenId.has(key);
  }

  /**
   * Check if browser ID exists in cache
   */
  hasBrowserId(browserId: string): boolean {
    return this.byBrowserId.has(browserId);
  }

  /**
   * Iterate over all mappings
   */
  forEach(callback: (mapping: Mapping) => void): void {
    for (const mapping of this.byLinkwardenId.values()) {
      callback(mapping);
    }
  }

  /**
   * Filter mappings by predicate
   */
  filter(predicate: (mapping: Mapping) => boolean): Mapping[] {
    return this.getAllMappings().filter(predicate);
  }

  /**
   * Map mappings to another type
   */
  map<T>(mapper: (mapping: Mapping) => T): T[] {
    return this.getAllMappings().map(mapper);
  }

  /**
   * Export cache to plain object (for debugging)
   */
  toJSON(): {
    linkwardenIdCount: number;
    browserIdCount: number;
    linkCount: number;
    collectionCount: number;
  } {
    return {
      linkwardenIdCount: this.byLinkwardenId.size,
      browserIdCount: this.byBrowserId.size,
      linkCount: this.byType.get("link")?.length || 0,
      collectionCount: this.byType.get("collection")?.length || 0,
    };
  }

  /**
   * Internal: Index a single mapping
   */
  private indexMapping(mapping: Mapping): void {
    // Index by Linkwarden ID
    const key = this.buildLinkwardenKey(
      mapping.linkwardenId,
      mapping.linkwardenType
    );

    // Update or insert in byLinkwardenId
    const existing = this.byLinkwardenId.get(key);
    if (existing) {
      // Remove old browser ID index
      this.byBrowserId.delete(existing.browserId);
    }

    this.byLinkwardenId.set(key, mapping);
    this.byBrowserId.set(mapping.browserId, mapping);

    // Index by type
    const typeList = this.byType.get(mapping.linkwardenType) || [];
    const existingIndex = typeList.findIndex(
      (m) => m.linkwardenId === mapping.linkwardenId
    );

    if (existingIndex !== -1) {
      typeList[existingIndex] = mapping;
    } else {
      typeList.push(mapping);
    }

    this.byType.set(mapping.linkwardenType, typeList);
  }

  /**
   * Internal: Build cache key for Linkwarden ID lookup
   */
  private buildLinkwardenKey(id: number, type: "link" | "collection"): string {
    return `${type}:${id}`;
  }
}

/**
 * Shared cache instance for use across sync modules
 * Lazy-initialized to avoid circular dependencies
 */
let sharedCache: MappingCache | null = null;

/**
 * Get or create shared mapping cache instance
 */
export function getSharedCache(): MappingCache {
  if (!sharedCache) {
    sharedCache = new MappingCache();
  }
  return sharedCache;
}

/**
 * Reset shared cache (for testing)
 */
export function resetSharedCache(): void {
  sharedCache = null;
}
