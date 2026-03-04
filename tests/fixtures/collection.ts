/**
 * Test data factories for LinkwardenCollection objects
 *
 * Default collection ID is from TEST_COLLECTION env var (default: 114 "Unorganized").
 * Override with `createCollection({ id: 999 })` if needed.
 */

import type { LinkwardenCollection } from "../../src/api";
import { getTestCollectionId, getTestCollectionName } from "../utils/config";

let collectionCounter = getTestCollectionId();

/**
 * Create a LinkwardenCollection with sensible defaults
 * Default ID is from TEST_COLLECTION env var ("Unorganized"), increments for subsequent collections
 */
export function createCollection(
  overrides: Partial<LinkwardenCollection> = {}
): LinkwardenCollection {
  const now = new Date().toISOString();
  const defaultId = getTestCollectionId();
  const defaultName = getTestCollectionName();

  const collection = {
    id: collectionCounter,
    name:
      collectionCounter === defaultId
        ? defaultName
        : `Collection ${collectionCounter}`,
    description: "",
    color: collectionCounter === defaultId ? "#0ea5e9" : "",
    isPublic: false,
    ownerId: 1,
    parentId: undefined,
    createdAt: now,
    updatedAt: now,
    links: [],
    collections: [],
    ...overrides,
  };

  collectionCounter++;
  return collection;
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
  collectionCounter = getTestCollectionId();
}
