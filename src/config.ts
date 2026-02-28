/**
 * Centralized Configuration
 * Single source of truth for all magic numbers and constants
 *
 * Using `as const` for type safety and autocomplete
 */

export const CONFIG = {
  /**
   * Sync-related configuration
   */
  sync: {
    /** Maximum number of log entries to keep */
    MAX_LOG_ENTRIES: 100,
    /** Maximum attempts when polling for sync completion */
    MAX_SYNC_ATTEMPTS: 30,
    /** Poll interval in milliseconds */
    POLL_INTERVAL_MS: 500,
    /** Default sync interval in minutes */
    DEFAULT_SYNC_INTERVAL: 5,
    /** Minimum sync interval in minutes */
    MIN_SYNC_INTERVAL: 1,
    /** Maximum sync interval in minutes */
    MAX_SYNC_INTERVAL: 60,
  },

  /**
   * API-related configuration
   */
  api: {
    /** Request timeout in milliseconds */
    TIMEOUT_MS: 30000,
    /** Maximum retry attempts */
    MAX_RETRIES: 3,
    /** Initial retry delay in milliseconds */
    INITIAL_RETRY_DELAY_MS: 1000,
    /** Maximum retry delay in milliseconds */
    MAX_RETRY_DELAY_MS: 30000,
    /** Retry backoff multiplier */
    RETRY_BACKOFF_MULTIPLIER: 2,
  },

  /**
   * Move token configuration
   * Token format: "{LW:MOVE:{"to":parentId,"ts":timestamp}}"
   */
  moveTokens: {
    /** Token prefix */
    PREFIX: "{LW:MOVE:",
    /** Token suffix */
    SUFFIX: "}",
  },

  /**
   * Storage configuration
   */
  storage: {
    /** Storage key for sync metadata */
    KEY_SYNC_METADATA: "sync_metadata",
    /** Storage key for mappings */
    KEY_MAPPINGS: "mappings",
    /** Storage key for pending changes */
    KEY_PENDING_CHANGES: "pending_changes",
    /** Storage key for settings */
    KEY_SETTINGS: "settings",
    /** Storage key for sync log */
    KEY_SYNC_LOG: "sync_log",
    /** Storage key for section state */
    KEY_SECTION_STATE: "section_state",
  },

  /**
   * Default values
   */
  defaults: {
    /** Default collection name */
    COLLECTION_NAME: "Bookmarks",
    /** Default sync direction */
    SYNC_DIRECTION: "bidirectional" as const,
  },

  /**
   * Browser-specific configuration
   */
  browser: {
    /** Firefox toolbar folder ID */
    FIREFOX_TOOLBAR_ID: "toolbar_____",
    /** Chrome/Edge bookmarks bar ID */
    CHROME_BAR_ID: "1",
    /** Other bookmarks folder ID */
    OTHER_BOOKMARKS_ID: "2",
  },
} as const;

/**
 * Type-safe access to storage keys
 */
export type StorageKey = (typeof CONFIG.storage)[keyof typeof CONFIG.storage];

/**
 * Get all storage keys as an array
 */
export function getAllStorageKeys(): string[] {
  return Object.values(CONFIG.storage);
}
