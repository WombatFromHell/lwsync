/**
 * Messaging utilities
 * For communication between background service worker and popup/other contexts
 */

/**
 * Send a message to the background service worker
 * Promise-based wrapper around chrome.runtime.sendMessage
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
