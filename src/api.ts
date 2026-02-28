/**
 * Linkwarden API client
 * Handles authentication and CRUD operations for collections and links
 *
 * For development: Uses environment variables from .env file
 *   - ENDPOINT: Your Linkwarden instance URL
 *   - API_KEY: Development access token
 *   - COLLECTION: Target collection name for sync (case-sensitive)
 */

import { createLogger, getEnvVar, getEnvVarWithDefault } from "./utils";
import {
  APIError,
  AuthError,
  NotFoundError,
  ConflictError,
  RateLimitError,
  ServerError,
} from "./api/errors";
import type { LinkwardenCollection, LinkwardenLink } from "./types/api";
export type { LinkwardenCollection, LinkwardenLink } from "./types/api";

const logger = createLogger("LWSync API");

/**
 * Delay for retry logic (exponential backoff)
 */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class LinkwardenAPI {
  private baseUrl: string;
  private token: string;
  private readonly maxRetries = 3;
  private readonly timeout = 30000; // 30 seconds

  constructor(serverUrl: string, token: string) {
    // Remove trailing slash if present
    this.baseUrl = `${serverUrl.replace(/\/$/, "")}/api/v1`;
    this.token = token;
  }

  private getHeaders(): HeadersInit {
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.token}`,
    };
  }

  /**
   * Make HTTP request with retry logic and error handling
   */
  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;
    let lastError: Error | undefined;

    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.timeout);

        const response = await fetch(url, {
          ...options,
          headers: {
            ...this.getHeaders(),
            ...options.headers,
          },
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        // Handle error responses
        if (!response.ok) {
          throw this.createError(response, endpoint);
        }

        // Parse successful response
        const data = (await response.json()) as { response: T };
        return data.response;
      } catch (error) {
        lastError = error as Error;

        // Don't retry on client errors (4xx) except rate limits
        if (error instanceof APIError) {
          if (error.status === 429 && attempt < this.maxRetries - 1) {
            // Rate limit - retry with exponential backoff
            const retryAfter =
              error instanceof RateLimitError ? error.retryAfter : undefined;
            const delayMs = retryAfter
              ? retryAfter * 1000
              : Math.pow(2, attempt) * 1000;
            logger.warn(`Rate limited, retrying in ${delayMs}ms...`);
            await delay(delayMs);
            continue;
          }
          if (error.status && error.status >= 400 && error.status < 500) {
            throw error; // Don't retry client errors
          }
        }

        // Retry on network errors or server errors (5xx)
        if (attempt < this.maxRetries - 1) {
          const delayMs = Math.pow(2, attempt) * 1000; // Exponential backoff
          logger.warn(
            `Request failed (attempt ${attempt + 1}/${this.maxRetries}), retrying in ${delayMs}ms...`
          );
          await delay(delayMs);
        }
      }
    }

    // All retries exhausted
    throw lastError;
  }

  /**
   * Create appropriate error from response
   */
  private createError(response: Response, endpoint: string): APIError {
    const status = response.status;
    const message = `API error: ${status} ${response.statusText}`;

    switch (status) {
      case 401:
        return new AuthError(endpoint);
      case 404:
        return new NotFoundError(endpoint, endpoint);
      case 409:
        return new ConflictError(message, endpoint);
      case 429: {
        // Try to get Retry-After header
        const retryAfter = response.headers.get("Retry-After");
        return new RateLimitError(
          endpoint,
          retryAfter ? parseInt(retryAfter, 10) : undefined
        );
      }
      default:
        if (status >= 500) {
          return new ServerError(status, endpoint);
        }
        return new APIError(message, status, endpoint);
    }
  }

  /**
   * Get all collections (flat list)
   */
  async getCollections(): Promise<LinkwardenCollection[]> {
    return this.request<LinkwardenCollection[]>("/collections");
  }

  /**
   * Get a collection by ID with its links and subcollections
   */
  async getCollection(id: number): Promise<LinkwardenCollection> {
    return this.request<LinkwardenCollection>(`/collections/${id}`);
  }

  /**
   * Get links for a specific collection
   * Uses /api/v1/links?collectionId=:id endpoint
   */
  async getCollectionLinks(collectionId: number): Promise<LinkwardenLink[]> {
    const links = await this.request<LinkwardenLink[]>(
      `/links?collectionId=${collectionId}`
    );
    logger.debug("Got", links.length, "links for collection", collectionId);
    return links;
  }

  /**
   * Get a collection tree recursively (collection with all subcollections and links)
   */
  async getCollectionTree(id: number): Promise<LinkwardenCollection> {
    logger.debug("Fetching collection tree for ID:", id);

    const collection = await this.getCollection(id);
    logger.debug("Collection:", {
      id: collection.id,
      name: collection.name,
      hasCollections: !!collection.collections,
      collectionsCount: collection.collections?.length || 0,
    });

    // Fetch links separately using the collectionId filter
    const links = await this.getCollectionLinks(id);
    collection.links = links;

    // Fetch ALL collections and filter for subcollections of this one
    // This is needed because the API might not return nested collections
    const allCollections = await this.getCollections();
    const subCollections = allCollections.filter((c) => {
      // Check if this collection's parentId matches our collection id
      // or if it appears in the collections array
      return (
        c.parentId === id ||
        collection.collections?.some(
          (sc: LinkwardenCollection) => sc.id === c.id
        )
      );
    });

    if (subCollections.length > 0) {
      logger.debug("Found", subCollections.length, "subcollections");
      // Fetch full tree for each subcollection
      collection.collections = await Promise.all(
        subCollections.map((sc) => this.getCollectionTree(sc.id))
      );
    } else {
      collection.collections = [];
    }

    return collection;
  }

  /**
   * Create a new collection
   */
  async createCollection(
    name: string,
    parentId?: number,
    description?: string,
    color?: string
  ): Promise<LinkwardenCollection> {
    const body: Record<string, unknown> = {
      name,
      description: description || "",
      color: color || "#0ea5e9",
    };

    if (parentId) {
      body.parentId = parentId;
    }

    return this.request<LinkwardenCollection>("/collections", {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  /**
   * Update a collection
   */
  async updateCollection(
    id: number,
    updates: {
      name?: string;
      description?: string;
      color?: string;
      parentId?: number;
    }
  ): Promise<LinkwardenCollection> {
    return this.request<LinkwardenCollection>(`/collections/${id}`, {
      method: "PUT",
      body: JSON.stringify(updates),
    });
  }

  /**
   * Delete a collection
   */
  async deleteCollection(id: number): Promise<void> {
    await this.request<void>(`/collections/${id}`, {
      method: "DELETE",
    });
  }

  /**
   * Create a new link
   */
  async createLink(
    url: string,
    collectionId: number,
    name?: string
  ): Promise<LinkwardenLink> {
    return this.request<LinkwardenLink>("/links", {
      method: "POST",
      body: JSON.stringify({
        url,
        name: name || url,
        collection: { id: collectionId },
      }),
    });
  }

  /**
   * Update a link
   * Note: Linkwarden API requires all fields including collection and tags
   */
  async updateLink(
    id: number,
    updates: { name?: string; url?: string; collectionId?: number }
  ): Promise<LinkwardenLink> {
    // First fetch the existing link to get its collection and tags
    const existing = await this.getLink(id);

    return this.request<LinkwardenLink>(`/links/${id}`, {
      method: "PUT",
      body: JSON.stringify({
        id,
        name: updates.name ?? existing.name,
        url: updates.url ?? existing.url,
        collection: updates.collectionId
          ? { id: updates.collectionId }
          : (existing.collection ?? { id: existing.collectionId }),
        tags: existing.tags ?? [],
      }),
    });
  }

  /**
   * Get a link by ID
   */
  async getLink(id: number): Promise<LinkwardenLink> {
    return this.request<LinkwardenLink>(`/links/${id}`);
  }

  /**
   * Delete a link
   */
  async deleteLink(id: number): Promise<void> {
    await this.request<void>(`/links/${id}`, {
      method: "DELETE",
    });
  }

  /**
   * Search links
   */
  async searchLinks(query: string): Promise<LinkwardenLink[]> {
    return this.request<LinkwardenLink[]>(
      `/search?searchQueryString=${encodeURIComponent(query)}`
    );
  }

  /**
   * Test API connection and authentication
   */
  async testConnection(): Promise<boolean> {
    try {
      await this.getCollections();
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Create a Linkwarden API client for development
 * Uses environment variables: ENDPOINT, API_KEY
 */
export function createDevClient(): LinkwardenAPI {
  const url = getEnvVar("ENDPOINT") || "http://localhost:3000";
  const token = getEnvVar("API_KEY");

  if (!token) {
    throw new Error(
      "API_KEY not found. Set it in .env file or environment variables."
    );
  }

  return new LinkwardenAPI(url, token);
}

/**
 * Get the target collection name from environment or default
 */
export function getTargetCollectionName(): string {
  return getEnvVarWithDefault("COLLECTION", "Bookmarks");
}

/**
 * Find a collection by name (case-sensitive)
 */
export async function findCollectionByName(
  api: LinkwardenAPI,
  name: string
): Promise<LinkwardenCollection | null> {
  const collections = await api.getCollections();
  return collections.find((c) => c.name === name) || null;
}
