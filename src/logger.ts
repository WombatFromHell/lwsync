/**
 * Logger for LWSync extension
 *
 * Provides environment-aware logging:
 * - In extension context: logs to console for debugging
 * - In test context (BUN_ENV=test): suppresses info/debug logs to reduce noise
 * - Supports log levels: debug, info, warn, error
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface Logger {
  debug(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
}

/**
 * Check if we're running in a test environment
 */
function isTestEnvironment(): boolean {
  // Check multiple environment variables for test detection
  if (typeof process !== "undefined" && process.env) {
    // Bun test environment
    if (process.env.BUN_ENV === "test") return true;
    // Node.js test environment
    if (process.env.NODE_ENV === "test") return true;
  }
  return false;
}

/**
 * Create a logger instance with optional prefix
 */
export function createLogger(prefix?: string): Logger {
  const isTest = isTestEnvironment();
  const label = prefix ? `[${prefix}]` : "[LWSync]";

  return {
    debug(message: string, ...args: unknown[]): void {
      if (!isTest) {
        console.debug(label, message, ...args);
      }
    },

    info(message: string, ...args: unknown[]): void {
      if (!isTest) {
        console.log(label, message, ...args);
      }
    },

    warn(message: string, ...args: unknown[]): void {
      // Always log warnings, even in tests
      console.warn(label, message, ...args);
    },

    error(message: string, ...args: unknown[]): void {
      // Always log errors, even in tests
      console.error(label, message, ...args);
    },
  };
}

/**
 * Default logger instance for general use
 */
export const logger = createLogger();
