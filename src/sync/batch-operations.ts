/**
 * Batch Operations
 *
 * Efficient batch processing for link moves, deletes, and updates.
 * Uses parallel execution for improved performance.
 *
 * Usage:
 *   const batch = new BatchOperations(api);
 *   await batch.batchMoveLinks(moves);
 *   await batch.batchDeleteLinks(linkIds);
 */

import type { LinkwardenAPI } from "../api";
import type { PendingChange } from "../types/storage";
import { createLogger } from "../utils";

const logger = createLogger("LWSync batch-operations");

export interface BatchResult {
  successes: number;
  failures: number;
  errors: Array<{ id: number; error: Error }>;
}

export interface LinkMove {
  linkId: number;
  toCollectionId: number;
  browserId?: string; // Optional: for logging
}

export class BatchOperations {
  private api: LinkwardenAPI;
  private readonly concurrencyLimit: number;

  constructor(api: LinkwardenAPI, concurrencyLimit: number = 10) {
    this.api = api;
    this.concurrencyLimit = concurrencyLimit; // Limit concurrent API calls
  }

  /**
   * Batch move multiple links to collections
   * Groups moves by target collection for efficiency
   */
  async batchMoveLinks(moves: LinkMove[]): Promise<BatchResult> {
    if (moves.length === 0) {
      return { successes: 0, failures: 0, errors: [] };
    }

    logger.info("Batch moving links:", {
      count: moves.length,
      concurrencyLimit: this.concurrencyLimit,
    });

    // Group moves by target collection
    const movesByCollection = new Map<number, LinkMove[]>();
    for (const move of moves) {
      const list = movesByCollection.get(move.toCollectionId) || [];
      list.push(move);
      movesByCollection.set(move.toCollectionId, list);
    }

    // Process each collection group with concurrency limit
    const results: BatchResult[] = [];
    for (const [collectionId, collectionMoves] of movesByCollection.entries()) {
      logger.debug("Moving links to collection:", {
        collectionId,
        count: collectionMoves.length,
      });

      const result = await this.processWithConcurrency(
        collectionMoves,
        async (move) => {
          await this.api.updateLink(move.linkId, {
            collectionId: move.toCollectionId,
          });
        }
      );

      results.push(result);
    }

    // Aggregate results
    return this.aggregateResults(results);
  }

  /**
   * Batch delete multiple links
   */
  async batchDeleteLinks(linkIds: number[]): Promise<BatchResult> {
    if (linkIds.length === 0) {
      return { successes: 0, failures: 0, errors: [] };
    }

    logger.info("Batch deleting links:", {
      count: linkIds.length,
      concurrencyLimit: this.concurrencyLimit,
    });

    const result = await this.processWithConcurrency(
      linkIds.map((id) => ({ id })),
      async ({ id }) => {
        await this.api.deleteLink(id);
      }
    );

    return result;
  }

  /**
   * Batch update multiple links
   */
  async batchUpdateLinks(
    updates: Array<{ linkId: number; data: { name?: string; url?: string } }>
  ): Promise<BatchResult> {
    if (updates.length === 0) {
      return { successes: 0, failures: 0, errors: [] };
    }

    logger.info("Batch updating links:", {
      count: updates.length,
      concurrencyLimit: this.concurrencyLimit,
    });

    const result = await this.processWithConcurrency(
      updates,
      async ({ linkId, data }) => {
        await this.api.updateLink(linkId, data);
      }
    );

    return result;
  }

  /**
   * Process pending changes in batches
   * Intelligently groups changes by type for optimal processing
   */
  async processPendingChanges(
    changes: PendingChange[],
    options: {
      onProgress?: (completed: number, total: number) => void;
    } = {}
  ): Promise<BatchResult> {
    const results: BatchResult[] = [];
    let completed = 0;

    // Group changes by type
    const moves: LinkMove[] = [];
    const deletes: number[] = [];
    const updates: Array<{
      linkId: number;
      data: { name?: string; url?: string };
    }> = [];

    for (const change of changes) {
      if (change.type === "move" && change.linkwardenId && change.parentId) {
        // Ensure parentId is a number (convert if string)
        const toCollectionId =
          typeof change.parentId === "string"
            ? parseInt(change.parentId, 10)
            : change.parentId;

        moves.push({
          linkId: change.linkwardenId,
          toCollectionId,
          browserId: change.browserId,
        });
      } else if (change.type === "delete" && change.linkwardenId) {
        deletes.push(change.linkwardenId);
      } else if (
        (change.type === "create" || change.type === "update") &&
        change.linkwardenId
      ) {
        updates.push({
          linkId: change.linkwardenId,
          data: {
            name: change.data?.title,
            url: change.data?.url,
          },
        });
      }
    }

    // Process each batch
    if (moves.length > 0) {
      const result = await this.batchMoveLinks(moves);
      results.push(result);
      completed += moves.length;
      options.onProgress?.(completed, changes.length);
    }

    if (deletes.length > 0) {
      const result = await this.batchDeleteLinks(deletes);
      results.push(result);
      completed += deletes.length;
      options.onProgress?.(completed, changes.length);
    }

    if (updates.length > 0) {
      const result = await this.batchUpdateLinks(updates);
      results.push(result);
      completed += updates.length;
      options.onProgress?.(completed, changes.length);
    }

    return this.aggregateResults(results);
  }

  /**
   * Process items with concurrency limit
   * Prevents overwhelming the API with too many simultaneous requests
   */
  private async processWithConcurrency<T>(
    items: T[],
    processor: (item: T) => Promise<void>
  ): Promise<BatchResult> {
    const errors: Array<{ id: number; error: Error }> = [];
    let successes = 0;
    let failures = 0;

    // Process in chunks of concurrencyLimit
    const chunks = this.chunkArray(items, this.concurrencyLimit);

    for (const chunk of chunks) {
      const results = await Promise.allSettled(
        chunk.map(async (item) => {
          try {
            await processor(item);
            successes++;
          } catch (error) {
            failures++;
            errors.push({
              id: this.extractId(item),
              error: error as Error,
            });
          }
        })
      );

      // Small delay between chunks to avoid rate limiting
      if (chunks.length > 1) {
        await this.delay(100);
      }
    }

    return { successes, failures, errors };
  }

  /**
   * Extract ID from item for error reporting
   */
  private extractId(item: any): number {
    if (item && typeof item === "object") {
      return item.linkId || item.id || 0;
    }
    return 0;
  }

  /**
   * Split array into chunks of specified size
   */
  private chunkArray<T>(array: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }

  /**
   * Aggregate multiple batch results
   */
  private aggregateResults(results: BatchResult[]): BatchResult {
    return {
      successes: results.reduce((sum, r) => sum + r.successes, 0),
      failures: results.reduce((sum, r) => sum + r.failures, 0),
      errors: results.flatMap((r) => r.errors),
    };
  }

  /**
   * Delay helper
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

/**
 * Create batch operations with default concurrency limit
 */
export function createBatchOperations(api: LinkwardenAPI): BatchOperations {
  return new BatchOperations(api, 10);
}
