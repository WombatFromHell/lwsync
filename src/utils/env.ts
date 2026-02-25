/**
 * Environment variable utilities
 * Provides safe access to environment variables in browser and Node contexts
 */

/**
 * Get environment variable safely
 * Returns undefined if process is not available or variable doesn't exist
 */
export function getEnvVar(key: string): string | undefined {
  if (typeof process !== "undefined" && process.env) {
    return process.env[key];
  }
  return undefined;
}

/**
 * Get environment variable with default value
 * Returns default if variable is not set
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
  const bunEnv = getEnvVar("BUN_ENV");
  const nodeEnv = getEnvVar("NODE_ENV");
  return bunEnv === "test" || nodeEnv === "test";
}
