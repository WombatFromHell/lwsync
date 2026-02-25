/**
 * Batch Storage Operations
 * Provides efficient bulk operations to reduce storage read/write calls
 */

import { getAll, saveAll } from "./main";
import type { Mapping, PendingChange, StorageData } from "../types/storage";

/**
 * Add or update multiple mappings in a single storage write
 */
export async function upsertMappings(mappings: Mapping[]): Promise<void> {
  if (mappings.length === 0) return;

  const data = await getAll();

  for (const mapping of mappings) {
    const existingIndex = data.mappings.findIndex(
      (m) =>
        m.linkwardenId === mapping.linkwardenId &&
        m.linkwardenType === mapping.linkwardenType
    );

    if (existingIndex >= 0) {
      data.mappings[existingIndex] = mapping;
    } else {
      data.mappings.push(mapping);
    }
  }

  await saveAll(data);
}

/**
 * Add multiple pending changes in a single storage write
 */
export async function addPendingChanges(
  changes: PendingChange[]
): Promise<void> {
  if (changes.length === 0) return;

  const data = await getAll();
  data.pending_changes.push(...changes);
  await saveAll(data);
}

/**
 * Remove multiple mappings by Linkwarden IDs in a single storage write
 */
export async function removeMappings(
  linkwardenIds: number[],
  type?: "link" | "collection"
): Promise<void> {
  if (linkwardenIds.length === 0) return;

  const data = await getAll();
  data.mappings = data.mappings.filter(
    (m) =>
      !(
        linkwardenIds.includes(m.linkwardenId) &&
        (!type || m.linkwardenType === type)
      )
  );
  await saveAll(data);
}

/**
 * Remove multiple pending changes by IDs in a single storage write
 */
export async function removePendingChanges(ids: string[]): Promise<void> {
  if (ids.length === 0) return;

  const data = await getAll();
  data.pending_changes = data.pending_changes.filter(
    (c) => !ids.includes(c.id)
  );
  await saveAll(data);
}

/**
 * Mark multiple pending changes as resolved in a single storage write
 */
export async function resolvePendingChanges(ids: string[]): Promise<void> {
  if (ids.length === 0) return;

  const data = await getAll();
  for (const id of ids) {
    const change = data.pending_changes.find((c) => c.id === id);
    if (change) {
      change.resolved = true;
    }
  }
  await saveAll(data);
}

/**
 * Execute a function with storage data, then save changes
 * Useful for read-modify-write operations
 */
export async function withStorageData<T>(
  fn: (data: StorageData) => T | Promise<T>
): Promise<T> {
  const data = await getAll();
  const result = await fn(data);
  await saveAll(data);
  return result;
}

/**
 * Bulk update mappings - replace all mappings in a single write
 * Use with caution - this replaces the entire mappings array
 */
export async function setAllMappings(mappings: Mapping[]): Promise<void> {
  const data = await getAll();
  data.mappings = mappings;
  await saveAll(data);
}

/**
 * Bulk add log entries - add multiple entries at once
 */
export async function addLogEntries(
  entries: {
    timestamp: number;
    type: "info" | "success" | "error" | "warning";
    message: string;
  }[]
): Promise<void> {
  if (entries.length === 0) return;

  const data = await getAll();
  data.sync_log.push(...entries);

  // Trim to max entries
  const MAX_LOG_ENTRIES = 100;
  if (data.sync_log.length > MAX_LOG_ENTRIES) {
    data.sync_log = data.sync_log.slice(-MAX_LOG_ENTRIES);
  }

  await saveAll(data);
}
