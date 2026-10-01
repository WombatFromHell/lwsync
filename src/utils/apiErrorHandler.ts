/**
 * API Error Handling Utilities
 * Error classification for user-facing messages
 */

import {
  APIError,
  AuthError,
  NotFoundError,
  ConflictError,
  RateLimitError,
  ServerError,
} from "../api/errors";

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
