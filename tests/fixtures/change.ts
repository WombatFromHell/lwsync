/**
 * Test data factories for PendingChange objects
 */

import type { PendingChange } from "../../src/storage";

let changeCounter = 0;

/**
 * Create a PendingChange with sensible defaults
 */
export function createPendingChange(
  overrides: Partial<PendingChange> = {}
): PendingChange {
  changeCounter++;
  const now = Date.now();
  return {
    id: `change-${now}-${changeCounter}`,
    type: "create",
    source: "browser",
    browserId: `bookmark-${changeCounter}`,
    timestamp: now,
    resolved: false,
    ...overrides,
  };
}

/**
 * Create a "create" change
 */
export function createChange(
  overrides: Partial<PendingChange> = {}
): PendingChange {
  return createPendingChange({
    type: "create",
    ...overrides,
  });
}

/**
 * Create an "update" change
 */
export function updateChange(
  overrides: Partial<PendingChange> = {}
): PendingChange {
  return createPendingChange({
    type: "update",
    ...overrides,
  });
}

/**
 * Create a "delete" change
 */
export function deleteChange(
  overrides: Partial<PendingChange> = {}
): PendingChange {
  return createPendingChange({
    type: "delete",
    ...overrides,
  });
}

/**
 * Create a "move" change
 */
export function moveChange(
  overrides: Partial<PendingChange> = {}
): PendingChange {
  return createPendingChange({
    type: "move",
    parentId: "parent-1",
    ...overrides,
  });
}

/**
 * Reset the change counter (call in beforeEach)
 */
export function resetChangeCounter(): void {
  changeCounter = 0;
}
