/**
 * Test data factories for Mapping objects
 * Provides sensible defaults for quick test data creation
 */

import type { Mapping } from "../../src/storage";

let mappingCounter = 0;

/**
 * Create a Mapping with sensible defaults
 * Override any properties as needed
 */
export function createMapping(overrides: Partial<Mapping> = {}): Mapping {
  mappingCounter++;
  const now = Date.now();
  return {
    id: `mapping-${now}-${mappingCounter}`,
    linkwardenType: "link",
    linkwardenId: mappingCounter,
    browserId: `bookmark-${mappingCounter}`,
    linkwardenUpdatedAt: now,
    browserUpdatedAt: now,
    lastSyncedAt: now,
    checksum: "test-checksum",
    ...overrides,
  };
}

/**
 * Create a collection mapping (folder instead of link)
 */
export function createCollectionMapping(
  overrides: Partial<Mapping> = {}
): Mapping {
  return createMapping({
    linkwardenType: "collection",
    browserId: `folder-${mappingCounter}`,
    ...overrides,
  });
}

/**
 * Reset the mapping counter (call in beforeEach)
 */
export function resetMappingCounter(): void {
  mappingCounter = 0;
}
