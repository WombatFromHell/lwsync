/**
 * Test data factories for LinkwardenLink objects
 */

import type { LinkwardenLink } from "../../src/api";

let linkCounter = 0;

/**
 * Create a LinkwardenLink with sensible defaults
 */
export function createLink(
  collectionId: number,
  overrides: Partial<LinkwardenLink> = {}
): LinkwardenLink {
  linkCounter++;
  const now = new Date().toISOString();
  return {
    id: linkCounter,
    name: `Test Link ${linkCounter}`,
    type: "url",
    description: "",
    url: `https://example-${linkCounter}.com`,
    collectionId,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

/**
 * Create a link with custom URL and name
 */
export function createLinkWithDetails(
  url: string,
  name: string,
  collectionId: number,
  overrides: Partial<LinkwardenLink> = {}
): LinkwardenLink {
  linkCounter++;
  const now = new Date().toISOString();
  return {
    id: linkCounter,
    name,
    type: "url",
    description: "",
    url,
    collectionId,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

/**
 * Reset the link counter (call in beforeEach)
 */
export function resetLinkCounter(): void {
  linkCounter = 0;
}
