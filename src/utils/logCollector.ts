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
}
