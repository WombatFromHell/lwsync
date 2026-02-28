/**
 * Sync Error Reporter
 * Centralized error collection and reporting for sync operations
 *
 * Provides consistent error handling across all sync operations:
 * - Collects errors with context
 * - Deduplicates similar errors
 * - Formats errors for user display
 * - Integrates with logging
 */

import { createLogger } from "../utils";
import type { SyncResult } from "../types/sync";

const logger = createLogger("LWSync errors");

export interface ErrorEntry {
  /** Unique error ID (for deduplication) */
  id: string;
  /** Error message */
  message: string;
  /** Context where error occurred */
  context: string;
  /** Original error object */
  original?: Error;
  /** Timestamp when error occurred */
  timestamp: number;
  /** Whether error was already reported */
  reported: boolean;
}

export interface ErrorContext {
  /** Operation being performed */
  operation: string;
  /** Item ID being processed (if applicable) */
  itemId?: number | string;
  /** Item name (if applicable) */
  itemName?: string;
  /** Additional context data */
  data?: Record<string, unknown>;
}

export class SyncErrorReporter {
  private errors: Map<string, ErrorEntry> = new Map();

  /**
   * Collect an error for later reporting
   */
  collect(error: Error | string, context: ErrorContext): void {
    const errorMessage = typeof error === "string" ? error : error.message;
    const originalError = typeof error === "string" ? undefined : error;

    // Create unique ID for deduplication
    const errorId = this.createErrorId(context.operation, errorMessage);

    // Skip if we already have this error
    if (this.errors.has(errorId)) {
      return;
    }

    const entry: ErrorEntry = {
      id: errorId,
      message: this.formatErrorMessage(errorMessage, context),
      context: context.operation,
      original: originalError,
      timestamp: Date.now(),
      reported: false,
    };

    this.errors.set(errorId, entry);

    // Log immediately for debugging
    logger.error(`[${context.operation}]`, entry.message, originalError || "");
  }

  /**
   * Collect an error from a promise rejection
   */
  async collectPromise<T>(
    promise: Promise<T>,
    context: ErrorContext,
    defaultValue?: T
  ): Promise<T | undefined> {
    try {
      return await promise;
    } catch (error) {
      this.collect(error as Error, context);
      return defaultValue;
    }
  }

  /**
   * Check if there are any errors
   */
  hasErrors(): boolean {
    return this.errors.size > 0;
  }

  /**
   * Get the count of collected errors
   */
  count(): number {
    return this.errors.size;
  }

  /**
   * Get all collected errors as an array
   */
  getErrors(): string[] {
    return Array.from(this.errors.values()).map((e) => e.message);
  }

  /**
   * Get all error entries (for debugging)
   */
  getErrorEntries(): ErrorEntry[] {
    return Array.from(this.errors.values());
  }

  /**
   * Clear all collected errors
   */
  clear(): void {
    this.errors.clear();
  }

  /**
   * Convert to SyncResult format
   */
  toSyncResult(stats: {
    created: number;
    updated: number;
    deleted: number;
    skipped: number;
  }): SyncResult {
    return {
      ...stats,
      errors: this.getErrors(),
    };
  }

  /**
   * Create a unique error ID for deduplication
   */
  private createErrorId(operation: string, message: string): string {
    // Simple hash of operation + message
    const str = `${operation}:${message}`;
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash;
    }
    return `${operation}:${Math.abs(hash).toString(16)}`;
  }

  /**
   * Format error message with context
   */
  private formatErrorMessage(message: string, context: ErrorContext): string {
    const parts = [message];

    if (context.itemId !== undefined) {
      parts.push(`(ID: ${context.itemId})`);
    }

    if (context.itemName) {
      parts.push(`"${context.itemName}"`);
    }

    if (context.data) {
      const extra = Object.entries(context.data)
        .map(([k, v]) => `${k}=${v}`)
        .join(", ");
      if (extra) {
        parts.push(`[${extra}]`);
      }
    }

    return parts.join(" ");
  }
}

/**
 * Helper to create error context with type safety
 */
export function createErrorContext(
  operation: string,
  options?: {
    itemId?: number | string;
    itemName?: string;
    data?: Record<string, unknown>;
  }
): ErrorContext {
  return {
    operation,
    itemId: options?.itemId,
    itemName: options?.itemName,
    data: options?.data,
  };
}
