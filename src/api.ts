/**
 * Linkwarden API client
 * Handles authentication and CRUD operations for collections and links
 *
 * For development: Uses environment variables from .env file
 *   - ENDPOINT: Your Linkwarden instance URL
 *   - API_KEY: Development access token
 *   - COLLECTION: Target collection name for sync (case-sensitive)
 */

import { createLogger } from "./logger";
import type {
  LinkwardenCollection,
  LinkwardenLink,
  LinkwardenError,
} from "./types/api";
export type { LinkwardenCollection, LinkwardenLink } from "./types/api";

const logger = createLogger("LWSync API");

export class LinkwardenAPI {
  private baseUrl: string;
  private token: string;

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

  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;
    const response = await fetch(url, {
      ...options,
      headers: {
        ...this.getHeaders(),
        ...options.headers,
      },
    });

    if (!response.ok) {
      const error: LinkwardenError = {
        message: `API error: ${response.status} ${response.statusText}`,
        status: response.status,
      };

      try {
        const data = (await response.json()) as { message?: string };
        error.message = data.message || error.message;
      } catch {
        // Response might not be JSON
      }

      throw new Error(error.message);
    }

    const data = (await response.json()) as { response: T };
    return data.response;
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
    const response = await fetch(`${this.baseUrl}/links`, {
      method: "POST",
      headers: this.getHeaders(),
      body: JSON.stringify({
        url,
        name: name || url,
        collection: { id: collectionId },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Failed to create link: ${response.status} - ${errorText}`
      );
    }

    const data = (await response.json()) as { response: LinkwardenLink };
    return data.response;
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

    const response = await fetch(`${this.baseUrl}/links/${id}`, {
      method: "PUT",
      headers: this.getHeaders(),
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

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Failed to update link: ${response.status} - ${errorText}`
      );
    }

    const data = (await response.json()) as { response: LinkwardenLink };
    return data.response;
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
    const response = await fetch(`${this.baseUrl}/links/${id}`, {
      method: "DELETE",
      headers: this.getHeaders(),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Failed to delete link: ${response.status} - ${errorText}`
      );
    }
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
 * Get environment variable safely
 */
function _getEnvVar(key: string): string | undefined {
  if (typeof process !== "undefined" && process.env) {
    return process.env[key];
  }
  return undefined;
}

/**
 * Create a Linkwarden API client for development
 * Uses environment variables: ENDPOINT, API_KEY
 */
export function createDevClient(): LinkwardenAPI {
  const url = _getEnvVar("ENDPOINT") || "http://localhost:3000";
  const token = _getEnvVar("API_KEY");

  if (!token) {
    throw new Error(
      "API_KEY not found. Set it in .env file or environment variables."
    );
  }

  return new LinkwardenAPI(url, token);
}

/**
 * Get the target collection name from environment
 */
export function getTargetCollectionName(): string {
  return _getEnvVar("COLLECTION") || "Bookmarks";
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
