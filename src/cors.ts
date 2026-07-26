/**
 * CORS Bypass via declarativeNetRequest
 *
 * Firefox MV3 enforces CORS preflights on background-script fetch() calls.
 * Chrome service workers bypass CORS entirely with host_permissions.
 *
 * On Firefox, if the server doesn't respond with Access-Control-Allow-Headers:
 * Authorization, Firefox strips the header → 401. This module uses
 * declarativeNetRequest to inject the Authorization header at the network
 * level (after CORS checks) and add CORS response headers, so Firefox's
 * CORS check passes.
 */

import { createLogger } from "./utils";

const logger = createLogger("LWSync cors");

const RULE_ID_AUTH = 1;
const RULE_ID_CORS = 2;

/**
 * Check if we're on Firefox (where CORS enforcement differs from Chrome)
 */
export function isFirefox(): boolean {
  return (
    typeof navigator !== "undefined" && navigator.userAgent.includes("Firefox")
  );
}

/**
 * Set up declarativeNetRequest rules for a given server URL and token.
 * - Rule 1: Injects Authorization header on requests to the server
 * - Rule 2: Adds CORS response headers so Firefox's preflight check passes
 */
export async function setupCorsRules(
  serverUrl: string,
  token: string
): Promise<void> {
  if (!isFirefox()) return;

  const urlFilter = buildUrlFilter(serverUrl);
  if (!urlFilter) {
    logger.warn("Could not build URL filter from server URL:", serverUrl);
    return;
  }

  try {
    const authRule: chrome.declarativeNetRequest.Rule = {
      id: RULE_ID_AUTH,
      priority: 1,
      action: {
        type: chrome.declarativeNetRequest.RuleActionType.MODIFY_HEADERS,
        requestHeaders: [
          {
            header: "Authorization",
            operation: chrome.declarativeNetRequest.HeaderOperation.SET,
            value: `Bearer ${token}`,
          },
        ],
      },
      condition: {
        urlFilter,
        resourceTypes: [
          chrome.declarativeNetRequest.ResourceType.XMLHTTPREQUEST,
        ],
      },
    };

    const originHeader = `moz-extension://${chrome.runtime.id}`;
    const corsRule: chrome.declarativeNetRequest.Rule = {
      id: RULE_ID_CORS,
      priority: 1,
      action: {
        type: chrome.declarativeNetRequest.RuleActionType.MODIFY_HEADERS,
        responseHeaders: [
          {
            header: "Access-Control-Allow-Origin",
            operation: chrome.declarativeNetRequest.HeaderOperation.SET,
            value: originHeader,
          },
          {
            header: "Access-Control-Allow-Headers",
            operation: chrome.declarativeNetRequest.HeaderOperation.SET,
            value: "Authorization, Content-Type",
          },
          {
            header: "Access-Control-Allow-Methods",
            operation: chrome.declarativeNetRequest.HeaderOperation.SET,
            value: "GET, POST, PUT, DELETE, OPTIONS",
          },
        ],
      },
      condition: {
        urlFilter,
        resourceTypes: [
          chrome.declarativeNetRequest.ResourceType.XMLHTTPREQUEST,
        ],
      },
    };

    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: [RULE_ID_AUTH, RULE_ID_CORS],
      addRules: [authRule, corsRule],
    });

    logger.info("CORS bypass rules installed for:", urlFilter);
  } catch (error) {
    logger.error("Failed to set up CORS rules:", error);
  }
}

/**
 * Remove all CORS bypass rules
 */
export async function removeCorsRules(): Promise<void> {
  if (!isFirefox()) return;

  try {
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: [RULE_ID_AUTH, RULE_ID_CORS],
    });

    logger.info("CORS bypass rules removed");
  } catch (error) {
    logger.error("Failed to remove CORS rules:", error);
  }
}

/**
 * Build a URL filter pattern from a server URL.
 * Converts "https://example.com" to "||example.com"
 */
function buildUrlFilter(serverUrl: string): string | null {
  try {
    const url = new URL(serverUrl);
    return `||${url.hostname}`;
  } catch {
    return null;
  }
}
