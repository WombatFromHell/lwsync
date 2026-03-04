/**
 * Sync Log Collector
 * Collects structured log entries during sync operations
 * Exports as JSON for easy debugging and analysis
 */

export interface LogEntry {
  timestamp: string;
  level: "debug" | "info" | "warn" | "error";
  module: string;
  message: string;
  data?: unknown;
}

export class SyncLogCollector {
  private entries: LogEntry[] = [];
  private maxEntries = 100; // Keep last 100 entries

  /**
   * Add a log entry
   */
  add(
    level: LogEntry["level"],
    module: string,
    message: string,
    data?: unknown
  ): void {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      module,
      message,
      data,
    };

    this.entries.push(entry);

    // Trim to max entries
    if (this.entries.length > this.maxEntries) {
      this.entries = this.entries.slice(this.entries.length - this.maxEntries);
    }
  }

  /**
   * Get all entries
   */
  getEntries(): LogEntry[] {
    return [...this.entries];
  }

  /**
   * Get entries as JSON string
   */
  toJSON(): string {
    return JSON.stringify(this.entries, null, 2);
  }

  /**
   * Get entries filtered by level
   */
  getByLevel(level: LogEntry["level"]): LogEntry[] {
    return this.entries.filter((e) => e.level === level);
  }

  /**
   * Get entries filtered by module
   */
  getByModule(module: string): LogEntry[] {
    return this.entries.filter((e) => e.module === module);
  }

  /**
   * Get errors only
   */
  getErrors(): LogEntry[] {
    return this.getByLevel("error");
  }

  /**
   * Clear all entries
   */
  clear(): void {
    this.entries = [];
  }

  /**
   * Export to file (browser only)
   */
  download(filename = "sync-log.json"): void {
    const blob = new Blob([this.toJSON()], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }
}

// Global collector instance
let globalCollector: SyncLogCollector | null = null;

/**
 * Get or create global log collector
 */
export function getLogCollector(): SyncLogCollector {
  if (!globalCollector) {
    globalCollector = new SyncLogCollector();
  }
  return globalCollector;
}

/**
 * Reset global collector (for testing)
 */
export function resetLogCollector(): void {
  globalCollector = null;
}
