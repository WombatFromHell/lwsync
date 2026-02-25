/**
 * Logger for LWSync extension
 *
 * Provides environment-aware logging:
 * - In extension context: logs to console for debugging
 * - In test context (BUN_ENV=test): suppresses info/debug logs to reduce noise
 * - Supports log levels: debug, info, warn, error
 */

import { isTestEnvironment } from "./env";

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface Logger {
  debug(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
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
