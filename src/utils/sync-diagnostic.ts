/**
 * Sync Diagnostic Utilities
 * Export diagnostic data for debugging
 */

import type { Mapping, Settings, LogEntry } from "../types/storage";

/**
 * Export complete diagnostic data
 */
export async function exportSyncDiagnostic(): Promise<{
  timestamp: string;
  mappings: Mapping[];
  settings: Settings | null;
  recentLogs: LogEntry[];
  version: string;
}> {
  // Import dynamically to avoid circular dependencies
  const storage = await import("../storage");

  const [mappings, settings, logs] = await Promise.all([
    storage.getMappings(),
    storage.getSettings(),
    storage.getSyncLog(),
  ]);

  return {
    timestamp: new Date().toISOString(),
    mappings,
    settings,
    recentLogs: logs.slice(-50), // Last 50 log entries
    version: "1.0.0",
  };
}
