/**
 * Browser detection and utilities
 */

import { getEnvVarWithDefault } from "./utils";

export type BrowserType = "firefox" | "chrome" | "edge" | "safari" | "unknown";

/**
 * Detect the current browser
 */
export function detectBrowser(): BrowserType {
  // @ts-expect-error - browser specific globals
  if (typeof browser !== "undefined" && browser.runtime) {
    return "firefox";
  }

  const userAgent = navigator.userAgent;

  if (userAgent.includes("Edg/")) {
    return "edge";
  }

  if (userAgent.includes("Chrome")) {
    return "chrome";
  }

  if (userAgent.includes("Safari")) {
    return "safari";
  }

  return "unknown";
}

/**
 * Get the default Linkwarden collection name
 * This is the default server-side collection name
 */
export function getDefaultCollectionName(): string {
  return "Bookmarks";
}

/**
 * Get the target collection name from environment or default
 */
export function getTargetCollectionNameFromEnv(): string {
  return getEnvVarWithDefault("COLLECTION", "Bookmarks");
}
