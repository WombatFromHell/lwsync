/**
 * API Error Handling Utilities
 * Centralized error handling with retry logic and error classification
 */

import { createLogger } from ".";
import {
  APIError,
  AuthError,
  NotFoundError,
  ConflictError,
  RateLimitError,
  ServerError,
} from "../api/errors";

const logger = createLogger("LWSync API errors");

export interface RetryOptions {
  /** Maximum number of retry attempts */
  maxRetries?: number;
  /** Initial delay in milliseconds */
  initialDelay?: number;
  /** Maximum delay in milliseconds */
  maxDelay?: number;
  /** Delay multiplier for exponential backoff */
  backoffMultiplier?: number;
  /** Custom retry delay function */
  getRetryDelay?: (attempt: number, error?: Error) => number;
  /** Called before each retry */
  onRetry?: (attempt: number, error: Error) => void;
  /** Called when all retries are exhausted */
  onExhausted?: (error: Error, attempts: number) => void;
}

const DEFAULT_RETRY_OPTIONS = {
  maxRetries: 3,
  initialDelay: 1000,
  maxDelay: 30000,
  backoffMultiplier: 2,
  getRetryDelay:
    undefined as unknown as Required<RetryOptions>["getRetryDelay"],
  onRetry: undefined as unknown as Required<RetryOptions>["onRetry"],
  onExhausted: undefined as unknown as Required<RetryOptions>["onExhausted"],
};

/**
 * Determine if an error is retryable
 * Client errors (4xx) are generally not retryable except for rate limits
 */
export function isRetryableError(error: Error): boolean {
  if (error instanceof RateLimitError) {
    return true;
  }

  if (error instanceof APIError) {
    // Don't retry client errors (4xx) except rate limits (429)
    if (error.status && error.status >= 400 && error.status < 500) {
      return false;
    }
    // Retry server errors (5xx)
    return error.status ? error.status >= 500 : false;
  }

  // Retry network errors
  return true;
}

/**
 * Calculate retry delay with exponential backoff
 */
export function calculateRetryDelay(
  attempt: number,
  options: Required<RetryOptions>,
  error?: Error
): number {
  // Use custom retry delay if provided
  if (options.getRetryDelay) {
    return options.getRetryDelay(attempt, error);
  }

  // Handle rate limit with Retry-After header
  if (error instanceof RateLimitError && error.retryAfter) {
    return error.retryAfter * 1000;
  }

  // Exponential backoff with jitter
  const exponentialDelay =
    options.initialDelay * Math.pow(options.backoffMultiplier, attempt);
  const jitter = Math.random() * 0.3 * exponentialDelay; // ±15% jitter
  const delay = exponentialDelay + jitter;

  return Math.min(delay, options.maxDelay);
}

/**
 * Execute an operation with retry logic
 */
export async function withRetry<T>(
  operation: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const opts = { ...DEFAULT_RETRY_OPTIONS, ...options };
  let lastError: Error | undefined;

  for (let attempt = 0; attempt < opts.maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error as Error;

      // Don't retry non-retryable errors
      if (!isRetryableError(error as Error)) {
        throw error;
      }

      // Call retry hook
      if (opts.onRetry && attempt < opts.maxRetries - 1) {
        opts.onRetry(attempt + 1, error as Error);
      }

      // Don't delay on last attempt
      if (attempt < opts.maxRetries - 1) {
        const delay = calculateRetryDelay(attempt, opts, error as Error);
        logger.warn(
          `Operation failed (attempt ${attempt + 1}/${opts.maxRetries}), retrying in ${delay}ms...`,
          error
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  // All retries exhausted
  if (opts.onExhausted && lastError) {
    opts.onExhausted(lastError, opts.maxRetries);
  }

  throw lastError;
}

/**
 * Classify an error for appropriate handling
 */
export interface ErrorClassification {
  /** Whether the error is retryable */
  retryable: boolean;
  /** Whether the error indicates an auth problem */
  authError: boolean;
  /** Whether the error indicates a not-found problem */
  notFound: boolean;
  /** Whether the error indicates a conflict */
  conflict: boolean;
  /** Whether the error is a rate limit */
  rateLimited: boolean;
  /** Whether the error is a server error */
  serverError: boolean;
  /** Suggested user message */
  userMessage?: string;
}

/**
 * Classify an error for appropriate handling
 */
export function classifyError(error: Error): ErrorClassification {
  const classification: ErrorClassification = {
    retryable: false,
    authError: false,
    notFound: false,
    conflict: false,
    rateLimited: false,
    serverError: false,
  };

  if (error instanceof AuthError) {
    classification.authError = true;
    classification.userMessage =
      "Authentication failed. Please check your access token.";
  } else if (error instanceof NotFoundError) {
    classification.notFound = true;
    classification.userMessage = "The requested resource was not found.";
  } else if (error instanceof ConflictError) {
    classification.conflict = true;
    classification.userMessage =
      "A conflict occurred. The data may have been modified.";
  } else if (error instanceof RateLimitError) {
    classification.rateLimited = true;
    classification.retryable = true;
    classification.userMessage = `Rate limited. Please wait before trying again.`;
  } else if (error instanceof ServerError) {
    classification.serverError = true;
    classification.retryable = true;
    classification.userMessage =
      "Server error. Please try again later or contact support.";
  } else if (error instanceof APIError) {
    classification.retryable = error.status ? error.status >= 500 : false;
    classification.serverError = error.status ? error.status >= 500 : false;
    classification.userMessage = `API error: ${error.status} ${error.message}`;
  } else {
    // Network error or other unknown error
    classification.retryable = true;
    classification.userMessage =
      "A network error occurred. Please check your connection.";
  }

  return classification;
}

/**
 * Handle API error with logging and user-friendly message
 */
export function handleApiError(
  error: Error,
  context: string,
  options?: {
    /** Whether to log the error */
    log?: boolean;
    /** Whether to include stack trace in log */
    includeStack?: boolean;
  }
): {
  classification: ErrorClassification;
  shouldRetry: boolean;
  userMessage: string;
} {
  const { log = true, includeStack = false } = options || {};
  const classification = classifyError(error);

  if (log) {
    if (includeStack && error.stack) {
      logger.error(`${context}: ${error.message}`, error.stack);
    } else {
      logger.error(`${context}:`, classification.userMessage);
    }
  }

  return {
    classification,
    shouldRetry: classification.retryable,
    userMessage: classification.userMessage || "An unexpected error occurred.",
  };
}

/**
 * Wrap an API operation with standardized error handling
 */
export function withApiErrorHandling<T>(
  operation: () => Promise<T>,
  context: string,
  options?: RetryOptions & {
    log?: boolean;
    includeStack?: boolean;
  }
): Promise<T> {
  const { log = true, includeStack = false, ...retryOptions } = options || {};

  return withRetry(() => operation(), {
    ...retryOptions,
    onRetry: (attempt, error) => {
      logger.warn(`${context} retry ${attempt}:`, error.message);
      retryOptions.onRetry?.(attempt, error);
    },
    onExhausted: (error, attempts) => {
      handleApiError(error, context, { log, includeStack });
      retryOptions.onExhausted?.(error, attempts);
    },
  });
}
