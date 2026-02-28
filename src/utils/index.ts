/**
 * LWSync Utilities
 * Cross-cutting utilities for the entire extension
 */

// ============ Environment ============

/**
 * Get environment variable safely
 */
export function getEnvVar(key: string): string | undefined {
  if (typeof process !== "undefined" && process.env) {
    return process.env[key];
  }
  return undefined;
}

/**
 * Get environment variable with default value
 */
export function getEnvVarWithDefault(
  key: string,
  defaultValue: string
): string {
  return getEnvVar(key) ?? defaultValue;
}

/**
 * Check if running in test environment
 */
export function isTestEnvironment(): boolean {
  return getEnvVar("BUN_ENV") === "test" || getEnvVar("NODE_ENV") === "test";
}

// ============ ID & Time ============

/**
 * Generate a unique ID
 */
export function generateId(): string {
  return crypto.randomUUID();
}

/**
 * Get current timestamp
 */
export function now(): number {
  return Date.now();
}

/**
 * Get ISO timestamp string
 */
export function isoTimestamp(offset = 0): string {
  return new Date(now() + offset).toISOString();
}

// ============ Formatting ============

/**
 * Format timestamp as human-readable relative time
 */
export function formatTime(timestamp: number | null): string {
  if (!timestamp) return "Never";
  const diff = Date.now() - new Date(timestamp).getTime();
  if (diff < 60000) return "Just now";
  if (diff < 3600000) {
    const minutes = Math.floor(diff / 60000);
    return `${minutes} minute${minutes > 1 ? "s" : ""} ago`;
  }
  if (diff < 86400000) {
    const hours = Math.floor(diff / 3600000);
    return `${hours} hour${hours > 1 ? "s" : ""} ago`;
  }
  return new Date(timestamp).toLocaleDateString();
}

/**
 * Format bytes as human-readable string
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

// ============ Path Parsing ============

/**
 * Parse folder path into array of names
 */
export function parseFolderPath(path: string): string[] {
  return path
    .split("/")
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

// ============ Messaging ============

/**
 * Send message to background worker
 */
export function sendMessage<T>(type: string, payload?: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    const message = payload ? { type, payload } : { type };
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(response as T);
      }
    });
  });
}

// ============ Logger ============

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface Logger {
  debug(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
}

export function createLogger(prefix?: string): Logger {
  const isTest = isTestEnvironment();
  const label = prefix ? `[${prefix}]` : "[LWSync]";
  return {
    debug: (m, ...a) => !isTest && console.debug(label, m, ...a),
    info: (m, ...a) => !isTest && console.log(label, m, ...a),
    warn: (m, ...a) => console.warn(label, m, ...a),
    error: (m, ...a) => console.error(label, m, ...a),
  };
}

// ============ Checksum ============

export function computeChecksum(
  data: string | { name?: string; url?: string }
): string {
  const str =
    typeof data === "string" ? data : `${data.name || ""}|${data.url || ""}`;
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(16);
}

// ============ Chrome Promise Wrapper ============

export function chromePromise<T>(fn: (cb: (r: T) => void) => void): Promise<T> {
  return new Promise((resolve, reject) => {
    fn((r) => {
      if (chrome.runtime.lastError)
        reject(new Error(chrome.runtime.lastError.message));
      else resolve(r);
    });
  });
}

export function chromePromiseSingle<T>(
  fn: (cb: (r: T[]) => void) => void
): Promise<T | undefined> {
  return chromePromise<T[]>(fn).then((r) => r[0]);
}

// ============ Message Router ============

export type { MessageType, ChromeMessage } from "../types/background";
export { createMessageRouter, createAsyncHandler } from "./messageRouter";

// ============ API Error Handling ============

export type { RetryOptions, ErrorClassification } from "./apiErrorHandler";
export {
  withRetry,
  isRetryableError,
  classifyError,
  handleApiError,
  withApiErrorHandling,
  calculateRetryDelay,
} from "./apiErrorHandler";
