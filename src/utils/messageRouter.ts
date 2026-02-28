/**
 * Message Router
 * Centralized message handling with type safety and error handling
 *
 * Reduces boilerplate in background.ts by providing a router pattern
 * for handling chrome.runtime.onMessage events
 */

import { createLogger } from ".";
import type {
  MessageType,
  MessageMap,
  ChromeMessage,
} from "../types/background";

const logger = createLogger("LWSync router");

type MessageHandler<T extends MessageType> = (
  payload: MessageMap[T]
) => Promise<unknown> | unknown;

interface RouterState {
  handlers: Map<string, MessageHandler<MessageType>>;
}

/**
 * Create a message router instance
 */
export function createMessageRouter() {
  const state: RouterState = {
    handlers: new Map<string, MessageHandler<MessageType>>(),
  };

  /**
   * Register a message handler
   */
  function register<T extends MessageType>(
    type: T,
    handler: MessageHandler<T>
  ): void {
    state.handlers.set(type, handler as MessageHandler<MessageType>);
  }

  /**
   * Handle an incoming message
   * Returns a Promise that resolves to the response
   */
  async function handle<T extends MessageType>(
    message: ChromeMessage<T>
  ): Promise<unknown> {
    const handler = state.handlers.get(message.type);

    if (!handler) {
      logger.warn("No handler registered for message type:", message.type);
      return null;
    }

    try {
      return await handler(message.payload as MessageMap[T]);
    } catch (error) {
      logger.error(`Handler error for ${message.type}:`, error);
      throw error;
    }
  }

  /**
   * Check if a handler is registered
   */
  function hasHandler(type: string): boolean {
    return state.handlers.has(type);
  }

  return {
    register,
    handle,
    hasHandler,
  };
}

/**
 * Helper to create an async message handler with proper response handling
 * Wraps the handler to ensure it works with chrome.runtime.onMessage
 */
export function createAsyncHandler<T extends MessageType>(
  handler: MessageHandler<T>
): (payload: MessageMap[T]) => Promise<unknown> {
  return async (payload: MessageMap[T]) => {
    try {
      return await handler(payload);
    } catch (error) {
      logger.error(`Async handler error:`, error);
      throw error;
    }
  };
}
