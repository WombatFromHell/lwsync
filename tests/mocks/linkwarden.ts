/**
 * Mock implementation of LinkwardenAPI
 * Provides in-memory collections and links for testing
 */

import type {
  LinkwardenAPI,
  LinkwardenCollection,
  LinkwardenLink,
} from "../../src/api";
import { getTestCollectionId, getTestCollectionName } from "../utils/config";

interface MockCollectionData {
  id: number;
  name: string;
  description?: string;
  color?: string;
  isPublic: boolean;
  ownerId: number;
  parentId?: number;
  createdAt: string;
  updatedAt: string;
  links: { id: number }[];
  collections?: { id: number; name: string; updatedAt: string }[];
}

interface MockLinkData {
  id: number;
  name: string;
  type: "url";
  description?: string;
  url: string;
  collectionId: number;
  createdAt: string;
  updatedAt: string;
}

export class MockLinkwardenAPI implements Partial<LinkwardenAPI> {
  private collections = new Map<number, MockCollectionData>();
  private links = new Map<number, MockLinkData>();
  private nextId = 1;
  private nextLinkId = 1;
  private readonly defaultCollectionId: number;

  constructor(options: { createDefaultCollection?: boolean } = {}) {
    this.defaultCollectionId = getTestCollectionId();
    if (options.createDefaultCollection !== false) {
      this.createDefaultCollection();
    }
  }

  /**
   * Create default test collection (uses TEST_COLLECTION from env, default: 114 "Unorganized")
   */
  private createDefaultCollection(): void {
    const now = new Date().toISOString();
    const collectionId = this.defaultCollectionId;
    const collectionName = getTestCollectionName();

    this.collections.set(collectionId, {
      id: collectionId,
      name: collectionName,
      description: "",
      color: collectionId === 114 ? "#0ea5e9" : "",
      isPublic: false,
      ownerId: 1,
      links: [],
      collections: [],
      createdAt: now,
      updatedAt: now,
    });
  }

  /**
   * Create a collection with a specific ID
   * @deprecated Use createCollection() with default collection ID from config instead
   */
  createCollectionWithId(
    id: number,
    name: string,
    parentId?: number
  ): Promise<LinkwardenCollection> {
    const now = new Date().toISOString();

    const collection: MockCollectionData = {
      id,
      name,
      parentId,
      description: "",
      color: "",
      isPublic: false,
      ownerId: 1,
      links: [],
      collections: [],
      createdAt: now,
      updatedAt: now,
    };

    this.collections.set(id, collection);

    // Add to parent's collections array
    if (parentId) {
      const parent = this.collections.get(parentId);
      if (parent) {
        if (!parent.collections) {
          parent.collections = [];
        }
        parent.collections.push({ id, name, updatedAt: now });
      }
    }

    // Update nextId to avoid conflicts
    if (id >= this.nextId) {
      this.nextId = id + 1;
    }

    return Promise.resolve(this.toCollection(collection));
  }

  /**
   * Get a collection by ID (internal, returns raw data)
   */
  private getCollectionData(id: number): MockCollectionData | undefined {
    return this.collections.get(id);
  }

  /**
   * Convert internal collection to public type
   */
  private toCollection(
    data: MockCollectionData,
    visited = new Set<number>()
  ): LinkwardenCollection {
    // Prevent infinite recursion
    if (visited.has(data.id)) {
      return {
        ...data,
        links: [],
        collections: [],
      } as LinkwardenCollection;
    }

    visited.add(data.id);

    return {
      ...data,
      links: data.links
        .map((l) => this.links.get(l.id))
        .filter((l): l is NonNullable<typeof l> => l !== undefined)
        .map((l) => this.toLink(l)),
      collections: data.collections
        ?.map((c) => this.collections.get(c.id))
        .filter((c): c is NonNullable<typeof c> => c !== undefined)
        .map((c) => this.toCollection(c, new Set(visited))),
    };
  }

  /**
   * Convert internal link to public type
   */
  private toLink(data: MockLinkData): LinkwardenLink {
    const collection = this.collections.get(data.collectionId);
    return {
      ...data,
      collection: collection
        ? { id: collection.id, name: collection.name }
        : undefined,
    };
  }

  /**
   * Get a collection by ID
   */
  async getCollection(id: number): Promise<LinkwardenCollection> {
    const collection = this.collections.get(id);
    if (!collection) {
      throw new Error(`Collection ${id} not found`);
    }
    return this.toCollection(collection);
  }

  /**
   * Get collection tree (recursively fetch subcollections)
   */
  async getCollectionTree(id: number): Promise<LinkwardenCollection> {
    return this.getCollection(id);
  }

  /**
   * Get all collections
   */
  async getCollections(): Promise<LinkwardenCollection[]> {
    return Array.from(this.collections.values()).map((c) =>
      this.toCollection(c)
    );
  }

  /**
   * Create a new collection
   */
  async createCollection(
    name: string,
    parentId?: number
  ): Promise<LinkwardenCollection> {
    const id = this.nextId++;
    const now = new Date().toISOString();

    const collection: MockCollectionData = {
      id,
      name,
      parentId,
      description: "",
      color: "",
      isPublic: false,
      ownerId: 1,
      links: [],
      collections: [],
      createdAt: now,
      updatedAt: now,
    };

    this.collections.set(id, collection);

    // Add to parent's collections array
    if (parentId) {
      const parent = this.collections.get(parentId);
      if (parent) {
        if (!parent.collections) {
          parent.collections = [];
        }
        parent.collections.push({ id, name, updatedAt: now });
      }
    }

    return this.toCollection(collection);
  }

  /**
   * Create a subcollection (convenience method for tests)
   */
  async createSubcollection(
    name: string,
    parentId: number
  ): Promise<LinkwardenCollection> {
    return this.createCollection(name, parentId);
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
    const collection = this.collections.get(id);
    if (!collection) {
      throw new Error(`Collection ${id} not found`);
    }

    const now = new Date().toISOString();

    // Handle parentId change (move collection)
    if (
      updates.parentId !== undefined &&
      updates.parentId !== collection.parentId
    ) {
      const oldParentId = collection.parentId;
      const newParentId = updates.parentId;

      // Remove from old parent
      if (oldParentId) {
        const oldParent = this.collections.get(oldParentId);
        if (oldParent && oldParent.collections) {
          oldParent.collections = oldParent.collections.filter(
            (c) => c.id !== id
          );
        }
      }

      // Add to new parent
      if (newParentId) {
        const newParent = this.collections.get(newParentId);
        if (newParent) {
          if (!newParent.collections) {
            newParent.collections = [];
          }
          newParent.collections.push({
            id,
            name: collection.name,
            updatedAt: now,
          });
        }
      }

      collection.parentId = newParentId;
    }

    if (updates.name !== undefined) {
      collection.name = updates.name;
    }
    if (updates.description !== undefined) {
      collection.description = updates.description;
    }
    if (updates.color !== undefined) {
      collection.color = updates.color;
    }

    collection.updatedAt = now;
    this.collections.set(id, collection);

    return this.toCollection(collection);
  }

  /**
   * Delete a collection
   */
  async deleteCollection(id: number): Promise<void> {
    const collection = this.collections.get(id);
    if (!collection) {
      throw new Error(`Collection ${id} not found`);
    }

    // Remove from parent's collections
    if (collection.parentId) {
      const parent = this.collections.get(collection.parentId);
      if (parent && parent.collections) {
        parent.collections = parent.collections.filter((c) => c.id !== id);
      }
    }

    // Delete all links in the collection
    for (const linkRef of collection.links) {
      this.links.delete(linkRef.id);
    }

    // Delete subcollections recursively
    if (collection.collections) {
      for (const sub of collection.collections) {
        await this.deleteCollection(sub.id);
      }
    }

    this.collections.delete(id);
  }

  /**
   * Create a new link
   */
  async createLink(
    url: string,
    collectionId: number,
    name?: string,
    description?: string
  ): Promise<LinkwardenLink> {
    const collection = this.collections.get(collectionId);
    if (!collection) {
      throw new Error(`Collection ${collectionId} not found`);
    }

    const id = this.nextLinkId++;
    const now = new Date().toISOString();

    const link: MockLinkData = {
      id,
      url,
      name: name || url,
      type: "url",
      description: description || "",
      collectionId,
      createdAt: now,
      updatedAt: now,
    };

    this.links.set(id, link);
    collection.links.push({ id });
    collection.updatedAt = now;

    return this.toLink(link);
  }

  /**
   * Get a link by ID
   */
  async getLink(id: number): Promise<LinkwardenLink> {
    const link = this.links.get(id);
    if (!link) {
      throw new Error(`Link ${id} not found`);
    }
    return this.toLink(link);
  }

  /**
   * Update a link
   */
  async updateLink(
    id: number,
    updates: {
      name?: string;
      url?: string;
      description?: string;
      collectionId?: number;
    }
  ): Promise<LinkwardenLink> {
    const link = this.links.get(id);
    if (!link) {
      throw new Error(`Link ${id} not found`);
    }

    const now = new Date().toISOString();

    // Handle collection change (move)
    if (
      updates.collectionId !== undefined &&
      updates.collectionId !== link.collectionId
    ) {
      // Remove from old collection
      const oldCollection = this.collections.get(link.collectionId);
      if (oldCollection) {
        oldCollection.links = oldCollection.links.filter((l) => l.id !== id);
      }

      // Add to new collection
      const newCollection = this.collections.get(updates.collectionId);
      if (newCollection) {
        if (!newCollection.links) {
          newCollection.links = [];
        }
        newCollection.links.push({ id });
      }

      link.collectionId = updates.collectionId;
    }

    if (updates.name !== undefined) {
      link.name = updates.name;
    }
    if (updates.url !== undefined) {
      link.url = updates.url;
    }
    if (updates.description !== undefined) {
      link.description = updates.description;
    }

    link.updatedAt = now;
    this.links.set(id, link);

    // Update collection's updatedAt
    const collection = this.collections.get(link.collectionId);
    if (collection) {
      collection.updatedAt = now;
    }

    return this.toLink(link);
  }

  /**
   * Delete a link
   */
  async deleteLink(id: number): Promise<void> {
    const link = this.links.get(id);
    if (!link) {
      throw new Error(`Link ${id} not found`);
    }

    // Remove from collection
    const collection = this.collections.get(link.collectionId);
    if (collection) {
      collection.links = collection.links.filter((l) => l.id !== id);
      collection.updatedAt = new Date().toISOString();
    }

    this.links.delete(id);
  }

  /**
   * Search for a collection by name
   */
  async searchCollectionByName(
    name: string
  ): Promise<LinkwardenCollection | undefined> {
    for (const collection of this.collections.values()) {
      if (collection.name === name) {
        return this.toCollection(collection);
      }
    }
    return undefined;
  }

  /**
   * Test connection (always succeeds for mock)
   */
  async testConnection(): Promise<boolean> {
    return true;
  }

  /**
   * Get links by collection using search endpoint simulation
   * Matches signature of real API: async getLinksByCollection()
   * Handles pagination internally and returns all links
   */
  async getLinksByCollection(collectionId: number): Promise<LinkwardenLink[]> {
    const collection = this.collections.get(collectionId);
    if (!collection) {
      return [];
    }

    // Get all links for this collection
    const allLinks = collection.links
      .map((l) => this.links.get(l.id))
      .filter((l): l is MockLinkData => l !== undefined)
      .map((l) => this.toLink(l));

    return allLinks;
  }

  /**
   * Get links by collection with pagination (for testing pagination)
   */
  async getLinksByCollectionPaginated(
    collectionId: number,
    cursor?: number
  ): Promise<{ nextCursor?: number | null; links: LinkwardenLink[] }> {
    const collection = this.collections.get(collectionId);
    if (!collection) {
      return { nextCursor: null, links: [] };
    }

    // Get all links for this collection
    const allLinks = collection.links
      .map((l) => this.links.get(l.id))
      .filter((l): l is MockLinkData => l !== undefined)
      .map((l) => this.toLink(l));

    // Simulate pagination (50 items per page)
    const pageSize = 50;
    const start = cursor || 0;
    const end = Math.min(start + pageSize, allLinks.length);
    const paginatedLinks = allLinks.slice(start, end);

    // Calculate next cursor
    const nextCursor = end < allLinks.length ? end : null;

    return {
      nextCursor,
      links: paginatedLinks,
    };
  }

  /**
   * Get all links for a collection (deprecated, use getLinksByCollection)
   * @deprecated Use getLinksByCollection() instead
   */
  async getCollectionLinks(collectionId: number): Promise<LinkwardenLink[]> {
    return this.getLinksByCollection(collectionId);
  }

  /**
   * Clear all data and reset to initial state
   */
  clear(): void {
    this.collections.clear();
    this.links.clear();
    this.nextId = 1;
    this.nextLinkId = 1;
    this.createDefaultCollection();
  }

  /**
   * Clear collections (alias for clear, backward compatibility)
   */
  clearCollections(): void {
    this.clear();
  }

  /**
   * Get all collections (for assertions)
   */
  getAllCollections(): LinkwardenCollection[] {
    return Array.from(this.collections.values()).map((c) =>
      this.toCollection(c)
    );
  }

  /**
   * Get all links (for assertions)
   */
  getAllLinks(): LinkwardenLink[] {
    return Array.from(this.links.values()).map((l) => this.toLink(l));
  }
}
