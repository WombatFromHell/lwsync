/**
 * Mock implementation for chrome.bookmarks API
 * Provides in-memory bookmark tree for testing
 */

import type { BookmarkNode } from "../../src/types/bookmarks";

export interface MockBookmarkNode {
  id: string;
  parentId?: string;
  title?: string;
  url?: string;
  children?: string[];
  dateAdded?: number;
  dateGroupModified?: number;
  index?: number;
}

interface ChangeInfo {
  title?: { newValue?: string };
  url?: { newValue?: string };
}

interface RemoveInfo {
  nodeId: string;
  parentId: string;
  index: number;
  node: chrome.bookmarks.BookmarkTreeNode;
}

interface MoveInfo {
  parentId: string;
  oldParentId: string;
  index: number;
  oldIndex: number;
}

interface EventListeners {
  onCreated: ((id: string, node: chrome.bookmarks.BookmarkTreeNode) => void)[];
  onChanged: ((id: string, changes: ChangeInfo) => void)[];
  onRemoved: ((id: string, removeInfo: RemoveInfo) => void)[];
  onMoved: ((id: string, moveInfo: MoveInfo) => void)[];
}

export class MockBookmarks {
  private tree = new Map<string, MockBookmarkNode>();
  private eventListeners: EventListeners = {
    onCreated: [],
    onChanged: [],
    onRemoved: [],
    onMoved: [],
  };

  constructor() {
    this.createDefaultStructure();
  }

  /**
   * Create default bookmark structure (Root, Bookmarks Bar, Other Bookmarks)
   */
  private createDefaultStructure(): void {
    const now = Date.now();

    // Root
    this.tree.set("0", {
      id: "0",
      title: "Root",
      dateAdded: now,
      dateGroupModified: now,
      index: 0,
      children: ["1", "2"],
    });

    // Bookmarks Bar
    this.tree.set("1", {
      id: "1",
      title: "Bookmarks Bar",
      parentId: "0",
      dateAdded: now,
      dateGroupModified: now,
      index: 0,
      children: [],
    });

    // Other Bookmarks
    this.tree.set("2", {
      id: "2",
      title: "Other Bookmarks",
      parentId: "0",
      dateAdded: now,
      dateGroupModified: now,
      index: 1,
      children: [],
    });
  }

  /**
   * Create a bookmark node
   */
  create(
    node: Partial<chrome.bookmarks.BookmarkTreeNode>,
    callback?: (node: chrome.bookmarks.BookmarkTreeNode) => void
  ): Promise<chrome.bookmarks.BookmarkTreeNode> {
    const id =
      node.id ||
      `bookmark-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const now = Date.now();

    // Auto-increment index if not provided
    let index = node.index;
    if (index === undefined && node.parentId) {
      const parent = this.tree.get(node.parentId);
      if (parent && parent.children) {
        index = parent.children.length; // Next available index
      }
    }

    const newNode: MockBookmarkNode = {
      id,
      parentId: node.parentId || "0",
      title: node.title || "",
      url: node.url,
      children: node.url ? undefined : [],
      dateAdded: node.dateAdded || now,
      dateGroupModified: node.dateGroupModified || now,
      index: index ?? 0,
    };

    this.tree.set(id, newNode);

    // Add to parent's children
    if (newNode.parentId) {
      const parent = this.tree.get(newNode.parentId);
      if (parent && parent.children) {
        parent.children.push(id);
        parent.dateGroupModified = now;
        this.tree.set(parent.id, parent);
      }
    }

    // Fire event (match real Chrome API signature: id, bookmark)
    const chromeNode = this.toChromeNode(newNode);
    this.eventListeners.onCreated.forEach((cb) =>
      cb(chromeNode.id, chromeNode)
    );

    const promise = Promise.resolve(chromeNode);

    if (callback) {
      promise.then((n) => setTimeout(() => callback(n), 0));
    }

    return promise;
  }

  /**
   * Get bookmark node(s) by ID(s)
   */
  get(
    idOrIds: string | string[],
    callback?: (nodes: chrome.bookmarks.BookmarkTreeNode[]) => void
  ): Promise<chrome.bookmarks.BookmarkTreeNode[]> {
    const ids = Array.isArray(idOrIds) ? idOrIds : [idOrIds];
    const results = ids
      .map((id) => this.tree.get(id))
      .filter((n): n is NonNullable<typeof n> => n !== undefined)
      .map((n) => this.toChromeNode(n));

    const promise = Promise.resolve(results);

    if (callback) {
      promise.then((nodes) => setTimeout(() => callback(nodes), 0));
    }

    return promise;
  }

  /**
   * Get all children of a node
   */
  getChildren(
    id: string,
    callback?: (children: chrome.bookmarks.BookmarkTreeNode[]) => void
  ): Promise<chrome.bookmarks.BookmarkTreeNode[]> {
    const node = this.tree.get(id);
    const result =
      node && node.children
        ? node.children
            .map((childId) => this.tree.get(childId))
            .filter((n): n is NonNullable<typeof n> => n !== undefined)
            .map((n) => this.toChromeNode(n))
        : [];

    const promise = Promise.resolve(result);

    if (callback) {
      promise.then((c) => setTimeout(() => callback(c), 0));
    }

    return promise;
  }

  /**
   * Update a bookmark node
   */
  update(
    id: string,
    changes: ChangeInfo,
    callback?: (node: chrome.bookmarks.BookmarkTreeNode) => void
  ): Promise<chrome.bookmarks.BookmarkTreeNode> {
    const node = this.tree.get(id);
    if (!node) {
      throw new Error(`Bookmark ${id} not found`);
    }

    const now = Date.now();

    if (changes.title !== undefined) {
      node.title = changes.title.newValue ?? "";
    }
    if (changes.url !== undefined) {
      node.url = changes.url.newValue ?? "";
    }

    node.dateGroupModified = now;
    this.tree.set(id, node);

    // Fire event
    const chromeNode = this.toChromeNode(node);
    this.eventListeners.onChanged.forEach((cb) => cb(id, changes));

    const promise = Promise.resolve(chromeNode);

    if (callback) {
      promise.then((n) => setTimeout(() => callback(n), 0));
    }

    return promise;
  }

  /**
   * Remove a bookmark node
   */
  remove(id: string, callback?: () => void): Promise<void> {
    const node = this.tree.get(id);
    if (!node) {
      throw new Error(`Bookmark ${id} not found`);
    }

    const chromeNode = this.toChromeNode(node);

    // Remove from parent's children
    if (node.parentId) {
      const parent = this.tree.get(node.parentId);
      if (parent && parent.children) {
        parent.children = parent.children.filter((childId) => childId !== id);
        parent.dateGroupModified = Date.now();
        this.tree.set(parent.id, parent);
      }
    }

    // Remove children recursively
    if (node.children) {
      for (const childId of node.children) {
        this.removeRecursive(childId);
      }
    }

    this.tree.delete(id);

    // Fire event
    this.eventListeners.onRemoved.forEach((cb) =>
      cb(id, {
        nodeId: id,
        parentId: node.parentId || "0",
        index: node.index || 0,
        node: chromeNode,
      })
    );

    const promise = Promise.resolve();

    if (callback) {
      promise.then(() => setTimeout(() => callback(), 0));
    }

    return promise;
  }

  /**
   * Remove a node recursively (helper for removeTree)
   */
  private removeRecursive(id: string): void {
    const node = this.tree.get(id);
    if (!node) return;

    if (node.children) {
      for (const childId of node.children) {
        this.removeRecursive(childId);
      }
    }

    this.tree.delete(id);
  }

  /**
   * Remove a bookmark tree
   */
  removeTree(id: string, callback?: () => void): Promise<void> {
    return this.remove(id, callback);
  }

  /**
   * Move a bookmark node to a new parent
   */
  move(
    id: string,
    destination: { parentId?: string; index?: number },
    callback?: (node: chrome.bookmarks.BookmarkTreeNode) => void
  ): Promise<chrome.bookmarks.BookmarkTreeNode> {
    const node = this.tree.get(id);
    if (!node) {
      throw new Error(`Bookmark ${id} not found`);
    }

    const oldParentId = node.parentId;
    const oldIndex = node.index || 0;
    const now = Date.now();

    // Remove from old parent
    if (oldParentId) {
      const oldParent = this.tree.get(oldParentId);
      if (oldParent && oldParent.children) {
        oldParent.children = oldParent.children.filter(
          (childId) => childId !== id
        );
        oldParent.dateGroupModified = now;
        this.tree.set(oldParent.id, oldParent);
      }
    }

    // Add to new parent at specified index
    // If parentId not specified, keep same parent (reorder within same folder)
    const newParentId = destination.parentId ?? oldParentId;
    if (newParentId) {
      const newParent = this.tree.get(newParentId);
      if (newParent && newParent.children) {
        const insertIndex = destination.index ?? newParent.children.length;
        // Insert at specified index
        newParent.children.splice(insertIndex, 0, id);
        newParent.dateGroupModified = now;
        this.tree.set(newParent.id, newParent);
      }
    }

    node.parentId = newParentId;
    node.index = destination.index ?? 0;
    node.dateGroupModified = now;
    this.tree.set(id, node);

    // Renumber all siblings in new parent to ensure consistent indices
    if (newParentId) {
      this.renumberChildren(newParentId);
    }

    // Fire event
    const chromeNode = this.toChromeNode(node);
    this.eventListeners.onMoved.forEach((cb) =>
      cb(id, {
        parentId: newParentId || "0",
        oldParentId: oldParentId || "0",
        index: node.index || 0,
        oldIndex,
      })
    );

    const promise = Promise.resolve(chromeNode);

    if (callback) {
      promise.then((n) => setTimeout(() => callback(n), 0));
    }

    return promise;
  }

  /**
   * Renumber children of a parent to ensure sequential indices
   */
  private renumberChildren(parentId: string): void {
    const parent = this.tree.get(parentId);
    if (!parent || !parent.children) return;

    for (let i = 0; i < parent.children.length; i++) {
      const child = this.tree.get(parent.children[i]);
      if (child) {
        child.index = i;
        this.tree.set(child.id, child);
      }
    }
  }

  /**
   * Get the entire bookmark tree
   */
  getTree(
    callback?: (tree: chrome.bookmarks.BookmarkTreeNode[]) => void
  ): Promise<chrome.bookmarks.BookmarkTreeNode[]> {
    const root = this.tree.get("0");
    const result = root ? [this.toChromeNode(root, true)] : [];

    const promise = Promise.resolve(result);

    if (callback) {
      promise.then((t) => setTimeout(() => callback(t), 0));
    }

    return promise;
  }

  /**
   * Get recent bookmarks
   */
  getRecent(
    numberOfItems: number,
    callback?: (results: chrome.bookmarks.BookmarkTreeNode[]) => void
  ): Promise<chrome.bookmarks.BookmarkTreeNode[]> {
    const allNodes = Array.from(this.tree.values())
      .filter((n) => n.url)
      .sort((a, b) => (b.dateAdded || 0) - (a.dateAdded || 0))
      .slice(0, numberOfItems);

    const result = allNodes.map((n) => this.toChromeNode(n));
    const promise = Promise.resolve(result);

    if (callback) {
      promise.then((r) => setTimeout(() => callback(r), 0));
    }

    return promise;
  }

  /**
   * Search bookmarks
   */
  search(
    query: string,
    callback?: (results: chrome.bookmarks.BookmarkTreeNode[]) => void
  ): Promise<chrome.bookmarks.BookmarkTreeNode[]> {
    const queryLower = query.toLowerCase();
    const results = Array.from(this.tree.values()).filter(
      (n) =>
        (n.title && n.title.toLowerCase().includes(queryLower)) ||
        (n.url && n.url.toLowerCase().includes(queryLower))
    );

    const result = results.map((n) => this.toChromeNode(n));
    const promise = Promise.resolve(result);

    if (callback) {
      promise.then((r) => setTimeout(() => callback(r), 0));
    }

    return promise;
  }

  /**
   * Get all bookmarks (for testing)
   */
  getAll(): Map<string, MockBookmarkNode> {
    return new Map(this.tree);
  }

  /**
   * Set a node directly (for test setup)
   */
  setNode(id: string, node: Partial<MockBookmarkNode>): void {
    const existing = this.tree.get(id);
    this.tree.set(id, {
      id,
      parentId: node.parentId ?? existing?.parentId ?? "0",
      title: node.title ?? existing?.title ?? "",
      url: node.url ?? existing?.url,
      children: node.children ?? existing?.children ?? [],
      dateAdded: node.dateAdded ?? existing?.dateAdded ?? Date.now(),
      dateGroupModified:
        node.dateGroupModified ?? existing?.dateGroupModified ?? Date.now(),
      index: node.index ?? existing?.index ?? 0,
    });
  }

  /**
   * Clear all bookmarks and reset to default structure
   */
  clear(): void {
    this.tree.clear();
    this.createDefaultStructure();
  }

  /**
   * Convert internal node to chrome.bookmarks.BookmarkTreeNode
   */
  private toChromeNode(
    node: MockBookmarkNode,
    includeChildren = false
  ): chrome.bookmarks.BookmarkTreeNode {
    const result: chrome.bookmarks.BookmarkTreeNode = {
      id: node.id,
      parentId: node.parentId ?? "",
      title: node.title ?? "",
      url: node.url,
      dateAdded: node.dateAdded,
      dateGroupModified: node.dateGroupModified,
      index: node.index || 0,
      syncing: false,
    };

    if (includeChildren && node.children) {
      result.children = node.children
        .map((childId) => this.tree.get(childId))
        .filter((n): n is NonNullable<typeof n> => n !== undefined)
        .map((n) => this.toChromeNode(n, true));
    }

    return result;
  }

  /**
   * Reorder multiple bookmarks within the same parent folder
   * Moves all bookmarks to their target indices efficiently
   * Processes moves sequentially to avoid index conflicts
   */
  async reorderWithinFolder(
    items: Array<{ id: string; targetIndex: number }>,
    parentId: string
  ): Promise<void> {
    // Get current children order
    const parent = this.tree.get(parentId);
    if (!parent || !parent.children) return;

    // Build the new order directly from target indices
    // Create array of [targetIndex, id] pairs
    const itemsWithIndex = items.map(
      (item) => [item.targetIndex, item.id] as [number, string]
    );

    // Sort by target index
    itemsWithIndex.sort((a, b) => a[0] - b[0]);

    // Rebuild the children array in the correct order
    const newChildren = itemsWithIndex.map(([_, id]) => id);

    // Add any children that weren't in the reorder list (they stay at the end)
    const reorderedIds = new Set(items.map((i) => i.id));
    for (const childId of parent.children) {
      if (!reorderedIds.has(childId)) {
        newChildren.push(childId);
      }
    }

    // Update parent's children
    parent.children = newChildren;
    parent.dateGroupModified = Date.now();
    this.tree.set(parentId, parent);

    // Update each node's index
    for (let i = 0; i < parent.children.length; i++) {
      const child = this.tree.get(parent.children[i]);
      if (child) {
        child.index = i;
        this.tree.set(child.id, child);
      }
    }

    // Fire events for all moved items
    for (const item of items) {
      const node = this.tree.get(item.id);
      if (node) {
        this.eventListeners.onMoved.forEach((cb) =>
          cb(item.id, {
            parentId: parentId || "0",
            oldParentId: parentId || "0",
            index: item.targetIndex,
            oldIndex: node.index || 0,
          })
        );
      }
    }
  }

  /**
   * Convert to chrome.bookmarks API format
   */
  toChromeAPI(): typeof chrome.bookmarks {
    return {
      create: this.create.bind(this),
      get: this.get.bind(this),
      getChildren: this.getChildren.bind(this),
      update: this.update.bind(this),
      remove: this.remove.bind(this),
      move: this.move.bind(this),
      getTree: this.getTree.bind(this),
      getRecent: this.getRecent.bind(this),
      search: this.search.bind(this),
      onCreated: {
        addListener: (
          cb: (id: string, node: chrome.bookmarks.BookmarkTreeNode) => void
        ) => {
          this.eventListeners.onCreated.push(cb);
        },
        removeListener: (
          cb: (id: string, node: chrome.bookmarks.BookmarkTreeNode) => void
        ) => {
          this.eventListeners.onCreated = this.eventListeners.onCreated.filter(
            (c) => c !== cb
          );
        },
      },
      onChanged: {
        addListener: (cb: (id: string, changes: ChangeInfo) => void) => {
          this.eventListeners.onChanged.push(cb);
        },
        removeListener: (cb: (id: string, changes: ChangeInfo) => void) => {
          this.eventListeners.onChanged = this.eventListeners.onChanged.filter(
            (c) => c !== cb
          );
        },
      },
      onRemoved: {
        addListener: (cb: (id: string, removeInfo: RemoveInfo) => void) => {
          this.eventListeners.onRemoved.push(cb);
        },
        removeListener: (cb: (id: string, removeInfo: RemoveInfo) => void) => {
          this.eventListeners.onRemoved = this.eventListeners.onRemoved.filter(
            (c) => c !== cb
          );
        },
      },
      onMoved: {
        addListener: (cb: (id: string, moveInfo: MoveInfo) => void) => {
          this.eventListeners.onMoved.push(cb);
        },
        removeListener: (cb: (id: string, moveInfo: MoveInfo) => void) => {
          this.eventListeners.onMoved = this.eventListeners.onMoved.filter(
            (c) => c !== cb
          );
        },
      },
    } as unknown as typeof chrome.bookmarks;
  }
}
