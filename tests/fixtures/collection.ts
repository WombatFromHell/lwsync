/**
 * Test data factories for LinkwardenCollection objects
 */

import type { LinkwardenCollection } from "../../src/api";

let collectionCounter = 0;

/**
 * Create a LinkwardenCollection with sensible defaults
 */
export function createCollection(
  overrides: Partial<LinkwardenCollection> = {}
): LinkwardenCollection {
  collectionCounter++;
  const now = new Date().toISOString();
  return {
    id: collectionCounter,
    name: `Test Collection ${collectionCounter}`,
    description: "",
    color: "",
    isPublic: false,
    ownerId: 1,
    parentId: undefined,
    createdAt: now,
    updatedAt: now,
    links: [],
    collections: [],
    ...overrides,
  };
}

/**
 * Create a nested subcollection
 */
export function createSubcollection(
  name: string,
  parentId: number,
  overrides: Partial<LinkwardenCollection> = {}
): LinkwardenCollection {
  collectionCounter++;
  const now = new Date().toISOString();
  return {
    id: collectionCounter,
    name,
    parentId,
    description: "",
    color: "",
    isPublic: false,
    ownerId: 1,
    createdAt: now,
    updatedAt: now,
    links: [],
    collections: [],
    ...overrides,
  };
}

/**
 * Reset the collection counter (call in beforeEach)
 */
export function resetCollectionCounter(): void {
  collectionCounter = 0;
}
