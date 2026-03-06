/**
 * Item Order Token Utilities
 *
 * Handles order token format for server-side bookmark order preservation.
 *
 * Token Format: [LW:O:{"47b2f5fa":"3"}]
 *   - Prefix: [LW:O:
 *   - Hash: 8 hex chars (first 4 + last 4 of DJB2 hash)
 *   - Index: Position in parent (0-based)
 *   - Suffix: }]
 *
 * Example: "My bookmark [LW:O:{"47b2f5fa":"3"}]"
 */

import { createLogger } from "../utils";

const logger = createLogger("LWSync order-token");

/**
 * Token prefix identifying order tokens
 */
const TOKEN_PREFIX = "[LW:O:";
const TOKEN_SUFFIX = "}]";

/**
 * Generate order hash from item name using DJB2 algorithm
 * Returns first 4 + last 4 hex characters (8 total)
 */
export function generateOrderHash(name: string): string {
  let hash = 5381;
  for (let i = 0; i < name.length; i++) {
    hash = (hash << 5) + hash + name.charCodeAt(i);
    hash = hash & hash; // Convert to 32-bit integer
  }
  const hex = Math.abs(hash).toString(16).padStart(8, "0");
  return hex.substring(0, 4) + hex.substring(hex.length - 4);
}

/**
 * Format order token string
 */
export function formatOrderToken(hash: string, index: number): string {
  // Format: [LW:O:{"hash":"index"}]
  // Ensure hash is lowercase
  const normalizedHash = hash.toLowerCase();
  return `[LW:O:{"${normalizedHash}":"${index}"}]`;
}

/**
 * Parse order token from description
 * Returns null if no valid token found
 */
export function parseOrderToken(description: string): {
  hash: string;
  index: number;
  token: string;
} | null {
  const regex = /\[LW:O:\{"([a-f0-9]+)":"(\d+)"\}\]/;
  const match = description.match(regex);
  if (!match) return null;

  return {
    hash: match[1],
    index: parseInt(match[2], 10),
    token: match[0],
  };
}

/**
 * Extract order token string from description
 * Returns null if no token found
 */
export function extractOrderToken(description: string): string | null {
  const result = parseOrderToken(description);
  return result?.token || null;
}

/**
 * Remove order token from description
 * Preserves user content, removes token and extra whitespace
 */
export function removeOrderToken(description: string): string {
  return description.replace(/\s*\[LW:O:\{"[a-f0-9]+":"\d+"\}\]/g, "").trim();
}

/**
 * Append or update order token in description
 * Preserves user content, replaces existing token if present
 */
export function appendOrderToken(
  description: string,
  name: string,
  index: number
): string {
  const cleanDescription = removeOrderToken(description);
  const hash = generateOrderHash(name);
  const token = formatOrderToken(hash, index);
  return `${cleanDescription} ${token}`.trim();
}

/**
 * Check if name matches hash (detect renames)
 */
export function verifyOrderHash(name: string, hash: string): boolean {
  return generateOrderHash(name) === hash;
}

/**
 * Get token info from description with validation
 */
export function getTokenInfo(
  description: string,
  currentName: string
): {
  hasToken: boolean;
  index?: number;
  hashValid?: boolean;
  needsUpdate?: boolean;
} | null {
  const token = parseOrderToken(description);

  if (!token) {
    return { hasToken: false };
  }

  const hashValid = verifyOrderHash(currentName, token.hash);
  const needsUpdate = !hashValid;

  logger.debug("Token info:", {
    index: token.index,
    hashValid,
    needsUpdate,
  });

  return {
    hasToken: true,
    index: token.index,
    hashValid,
    needsUpdate,
  };
}

/**
 * Ensure description has valid order token
 * Updates token if name changed, creates if missing
 */
export function ensureOrderToken(
  description: string,
  name: string,
  index: number
): { description: string; tokenUpdated: boolean } {
  const info = getTokenInfo(description, name);

  if (!info?.hasToken) {
    // No token - append new one
    return {
      description: appendOrderToken(description, name, index),
      tokenUpdated: true,
    };
  }

  if (info.needsUpdate) {
    // Hash mismatch (rename) - update token
    logger.info("Name changed, updating order token:", { name });
    return {
      description: appendOrderToken(description, name, index),
      tokenUpdated: true,
    };
  }

  // Token exists and is valid - check if index changed
  if (info.index !== index) {
    logger.debug("Order changed, updating token:", {
      oldIndex: info.index,
      newIndex: index,
    });
    return {
      description: appendOrderToken(description, name, index),
      tokenUpdated: true,
    };
  }

  // Token is current - no change needed
  return { description, tokenUpdated: false };
}
