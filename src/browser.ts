/**
 * Browser detection and utilities
 */

import { getEnvVarWithDefault } from "./utils";

export type BrowserType = "firefox" | "chrome" | "edge" | "safari" | "unknown";

/**
 * Detect the current browser
 * ponytail: userAgent first — Chrome 128+ exposes `browser` global, breaking the old check
 */
export function detectBrowser(): BrowserType {
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

  // Firefox: userAgent lacks "Chrome", and may not have "Safari" either
  // Check for the browser global as a Firefox-specific signal
  // @ts-expect-error - browser specific globals
  if (typeof browser !== "undefined" && browser.runtime) {
    return "firefox";
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
