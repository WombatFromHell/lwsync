/**
 * API Error Classes
 * Custom error types for Linkwarden API operations
 */

/**
 * Base API error
 */
export class APIError extends Error {
  public readonly status?: number;
  public readonly endpoint?: string;

  constructor(message: string, status?: number, endpoint?: string) {
    super(message);
    this.name = "APIError";
    this.status = status;
    this.endpoint = endpoint;
  }
}

/**
 * Network error (connection issues, timeouts, etc.)
 */
export class NetworkError extends APIError {
  public readonly cause?: Error;

  constructor(endpoint: string, cause?: Error) {
    super(`Network error: ${endpoint}`, undefined, endpoint);
    this.name = "NetworkError";
    this.cause = cause;
  }
}

/**
 * Authentication error (401 Unauthorized)
 */
export class AuthError extends APIError {
  constructor(endpoint?: string) {
    super("Authentication failed. Check your access token.", 401, endpoint);
    this.name = "AuthError";
  }
}

/**
 * Not found error (404)
 */
export class NotFoundError extends APIError {
  constructor(resource: string, endpoint?: string) {
    super(`Resource not found: ${resource}`, 404, endpoint);
    this.name = "NotFoundError";
  }
}

/**
 * Conflict error (409)
 */
export class ConflictError extends APIError {
  constructor(message: string, endpoint?: string) {
    super(message, 409, endpoint);
    this.name = "ConflictError";
  }
}

/**
 * Rate limit error (429)
 */
export class RateLimitError extends APIError {
  public readonly retryAfter?: number;

  constructor(endpoint: string, retryAfter?: number) {
    super(`Rate limit exceeded. Try again later.`, 429, endpoint);
    this.name = "RateLimitError";
    this.retryAfter = retryAfter;
  }
}

/**
 * Server error (5xx)
 */
export class ServerError extends APIError {
  constructor(status: number, endpoint?: string) {
    super(`Server error: ${status}`, status, endpoint);
    this.name = "ServerError";
  }
}
