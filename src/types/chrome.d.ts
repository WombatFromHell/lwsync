/**
 * Type declarations for Chrome extension APIs
 * This provides type safety for chrome.* APIs used throughout the project
 */

import type * as Chrome from "chrome";

declare global {
  const chrome: typeof Chrome;
}

export {};
