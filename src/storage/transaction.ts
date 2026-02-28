/**
 * Storage Transactions
 * Provides a transactional interface for batch storage operations
 *
 * Instead of multiple read-modify-write cycles:
 * ```typescript
 * // Before: Multiple storage calls
 * const data1 = await getAll();
 * data1.mappings.push(mapping1);
 * await saveAll(data1);
 *
 * const data2 = await getAll();
 * data2.pending_changes.push(change1);
 * await saveAll(data2);
 * ```
 *
 * Use transactions for automatic batching:
 * ```typescript
 * // After: Single storage call
 * await transaction(tx => {
 *   tx.mappings.push(mapping1);
 *   tx.pendingChanges.push(change1);
 * });
 * ```
 */

import { getAll, saveAll } from "./main";
import type {
  Mapping,
  PendingChange,
  SyncMetadata,
  Settings,
  LogEntry,
  SectionState,
  StorageData,
} from "../types/storage";

/**
 * Transactional view of storage data
 * All mutations are tracked and applied in a single write
 */
export class StorageTransaction {
  private data: StorageData;
  private dirty = false;

  constructor(data: StorageData) {
    this.data = data;
  }

  /**
   * Get all mappings (read-only)
   */
  get mappings(): readonly Mapping[] {
    return this.data.mappings;
  }

  /**
   * Add a mapping (staged for write)
   */
  addMapping(mapping: Mapping): void {
    this.data.mappings = [...this.data.mappings, mapping];
    this.dirty = true;
  }

  /**
   * Add multiple mappings (staged for write)
   */
  addMappings(mappings: Mapping[]): void {
    this.data.mappings = [...this.data.mappings, ...mappings];
    this.dirty = true;
  }

  /**
   * Update or add a mapping (staged for write)
   */
  upsertMapping(mapping: Mapping, predicate: (m: Mapping) => boolean): void {
    const index = this.data.mappings.findIndex(predicate);
    if (index >= 0) {
      this.data.mappings = [
        ...this.data.mappings.slice(0, index),
        mapping,
        ...this.data.mappings.slice(index + 1),
      ];
    } else {
      this.data.mappings = [...this.data.mappings, mapping];
    }
    this.dirty = true;
  }

  /**
   * Remove mappings matching predicate (staged for write)
   */
  removeMappings(predicate: (m: Mapping) => boolean): number {
    const filtered = this.data.mappings.filter((m) => !predicate(m));
    const removed = this.data.mappings.length - filtered.length;
    if (removed > 0) {
      this.data.mappings = filtered;
      this.dirty = true;
    }
    return removed;
  }

  /**
   * Get all pending changes (read-only)
   */
  get pendingChanges(): readonly PendingChange[] {
    return this.data.pending_changes;
  }

  /**
   * Add a pending change (staged for write)
   */
  addPendingChange(change: PendingChange): void {
    this.data.pending_changes = [...this.data.pending_changes, change];
    this.dirty = true;
  }

  /**
   * Add multiple pending changes (staged for write)
   */
  addPendingChanges(changes: PendingChange[]): void {
    this.data.pending_changes = [...this.data.pending_changes, ...changes];
    this.dirty = true;
  }

  /**
   * Mark pending changes as resolved (staged for write)
   */
  resolvePendingChanges(predicate: (c: PendingChange) => boolean): number {
    let resolved = 0;
    const updated = this.data.pending_changes.map((c) => {
      if (predicate(c) && !c.resolved) {
        resolved++;
        return { ...c, resolved: true };
      }
      return c;
    });
    if (resolved > 0) {
      this.data.pending_changes = updated;
      this.dirty = true;
    }
    return resolved;
  }

  /**
   * Remove resolved pending changes (staged for write)
   */
  cleanupResolvedChanges(): number {
    const removed = this.data.pending_changes.filter((c) => c.resolved).length;
    if (removed > 0) {
      this.data.pending_changes = this.data.pending_changes.filter(
        (c) => !c.resolved
      );
      this.dirty = true;
    }
    return removed;
  }

  /**
   * Get sync metadata (read-only)
   */
  get syncMetadata(): SyncMetadata | null {
    return this.data.sync_metadata;
  }

  /**
   * Set sync metadata (staged for write)
   */
  setSyncMetadata(metadata: SyncMetadata | null): void {
    this.data.sync_metadata = metadata;
    this.dirty = true;
  }

  /**
   * Get settings (read-only)
   */
  get settings(): Settings | null {
    return this.data.settings;
  }

  /**
   * Set settings (staged for write)
   */
  setSettings(settings: Settings | null): void {
    this.data.settings = settings;
    this.dirty = true;
  }

  /**
   * Add a log entry (staged for write)
   */
  addLogEntry(entry: LogEntry): void {
    const MAX_LOG_ENTRIES = 100;
    const newLog = [...this.data.sync_log, entry];
    if (newLog.length > MAX_LOG_ENTRIES) {
      this.data.sync_log = newLog.slice(-MAX_LOG_ENTRIES);
    } else {
      this.data.sync_log = newLog;
    }
    this.dirty = true;
  }

  /**
   * Get section state (read-only)
   */
  get sectionState(): SectionState {
    return this.data.section_state || {};
  }

  /**
   * Set section state (staged for write)
   */
  setSectionState(state: SectionState): void {
    this.data.section_state = state;
    this.dirty = true;
  }

  /**
   * Check if any changes were made
   */
  isDirty(): boolean {
    return this.dirty;
  }

  /**
   * Get the current data snapshot
   */
  getData(): StorageData {
    return this.data;
  }
}

/**
 * Execute a transaction with automatic batching
 * All mutations are applied in a single storage write
 */
export async function transaction<T>(
  fn: (tx: StorageTransaction) => T | Promise<T>
): Promise<T> {
  const data = await getAll();
  const tx = new StorageTransaction(data);

  try {
    const result = await fn(tx);

    // Only save if changes were made
    if (tx.isDirty()) {
      await saveAll(tx.getData());
    }

    return result;
  } catch (error) {
    // Don't save on error - transaction is rolled back
    throw error;
  }
}

/**
 * Execute a transaction without saving
 * Useful for read-only operations or when you want manual control
 */
export async function readTransaction<T>(
  fn: (tx: StorageTransaction) => T | Promise<T>
): Promise<T> {
  const data = await getAll();
  const tx = new StorageTransaction(data);
  return await fn(tx);
}

/**
 * Batch operation helper
 * Execute multiple operations and save once at the end
 */
export async function batch<T>(
  operations: Array<(tx: StorageTransaction) => void | Promise<void>>
): Promise<T | void> {
  return transaction(async (tx) => {
    for (const op of operations) {
      await op(tx);
    }
  });
}
