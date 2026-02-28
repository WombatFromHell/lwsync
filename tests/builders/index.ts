/**
 * Test Data Builders
 * Fluent API for creating test data with sensible defaults
 *
 * Usage:
 * ```typescript
 * const mapping = MappingBuilder.create()
 *   .withLinkwardenId(1)
 *   .withBrowserId("bookmark-1")
 *   .build();
 *
 * // Or with presets
 * const linkMapping = MappingBuilder.link().build();
 * const collectionMapping = MappingBuilder.collection().build();
 * ```
 */

import type {
  Mapping,
  PendingChange,
  SyncMetadata,
  Settings,
  LogEntry,
} from "../../src/types/storage";
import type { LinkwardenLink, LinkwardenCollection } from "../../src/types/api";
import type { BookmarkNode } from "../../src/types/bookmarks";

/**
 * Base builder interface
 */
export interface Builder<T> {
  build(): T;
}

/**
 * Mapping Builder
 */
export class MappingBuilder implements Builder<Mapping> {
  private data: Partial<Mapping> = {
    id: crypto.randomUUID(),
    linkwardenType: "link",
    linkwardenId: 1,
    browserId: "bookmark-1",
    linkwardenUpdatedAt: Date.now(),
    browserUpdatedAt: Date.now(),
    lastSyncedAt: Date.now(),
    checksum: "abc123",
  };

  static create(): MappingBuilder {
    return new MappingBuilder();
  }

  static link(): MappingBuilder {
    return new MappingBuilder().withType("link");
  }

  static collection(): MappingBuilder {
    return new MappingBuilder().withType("collection");
  }

  withId(id: string): this {
    this.data.id = id;
    return this;
  }

  withType(type: "link" | "collection"): this {
    this.data.linkwardenType = type;
    return this;
  }

  withLinkwardenId(id: number): this {
    this.data.linkwardenId = id;
    return this;
  }

  withBrowserId(id: string): this {
    this.data.browserId = id;
    return this;
  }

  withLinkwardenUpdatedAt(time: number): this {
    this.data.linkwardenUpdatedAt = time;
    return this;
  }

  withBrowserUpdatedAt(time: number): this {
    this.data.browserUpdatedAt = time;
    return this;
  }

  withChecksum(checksum: string): this {
    this.data.checksum = checksum;
    return this;
  }

  build(): Mapping {
    return this.data as Mapping;
  }
}

/**
 * Pending Change Builder
 */
export class PendingChangeBuilder implements Builder<PendingChange> {
  private data: Partial<PendingChange> = {
    id: crypto.randomUUID(),
    type: "create",
    source: "browser",
    timestamp: Date.now(),
    resolved: false,
  };

  static create(): PendingChangeBuilder {
    return new PendingChangeBuilder();
  }

  static createChange(): PendingChangeBuilder {
    return new PendingChangeBuilder().withType("create");
  }

  static updateChange(): PendingChangeBuilder {
    return new PendingChangeBuilder().withType("update");
  }

  static deleteChange(): PendingChangeBuilder {
    return new PendingChangeBuilder().withType("delete");
  }

  static moveChange(): PendingChangeBuilder {
    return new PendingChangeBuilder().withType("move");
  }

  withId(id: string): this {
    this.data.id = id;
    return this;
  }

  withType(type: "create" | "update" | "delete" | "move"): this {
    this.data.type = type;
    return this;
  }

  withSource(source: "linkwarden" | "browser"): this {
    this.data.source = source;
    return this;
  }

  withLinkwardenId(id: number): this {
    this.data.linkwardenId = id;
    return this;
  }

  withBrowserId(id: string): this {
    this.data.browserId = id;
    return this;
  }

  withParentId(id: number | string): this {
    this.data.parentId = id;
    return this;
  }

  withData(data: { url?: string; title?: string }): this {
    this.data.data = data;
    return this;
  }

  withTimestamp(time: number): this {
    this.data.timestamp = time;
    return this;
  }

  resolved(): this {
    this.data.resolved = true;
    return this;
  }

  build(): PendingChange {
    return this.data as PendingChange;
  }
}

/**
 * Sync Metadata Builder
 */
export class SyncMetadataBuilder implements Builder<SyncMetadata> {
  private data: Partial<SyncMetadata> = {
    id: "sync_state",
    lastSyncTime: Date.now(),
    syncDirection: "bidirectional",
    targetCollectionId: 1,
    browserRootFolderId: "1",
  };

  static create(): SyncMetadataBuilder {
    return new SyncMetadataBuilder();
  }

  withLastSyncTime(time: number): this {
    this.data.lastSyncTime = time;
    return this;
  }

  withSyncDirection(
    direction: "bidirectional" | "to-browser" | "to-linkwarden"
  ): this {
    this.data.syncDirection = direction;
    return this;
  }

  withTargetCollectionId(id: number): this {
    this.data.targetCollectionId = id;
    return this;
  }

  withBrowserRootFolderId(id: string): this {
    this.data.browserRootFolderId = id;
    return this;
  }

  build(): SyncMetadata {
    return this.data as SyncMetadata;
  }
}

/**
 * Settings Builder
 */
export class SettingsBuilder implements Builder<Settings> {
  private data: Partial<Settings> = {
    serverUrl: "https://linkwarden.example.com",
    accessToken: "test-token-123",
    syncInterval: 5,
    targetCollectionName: "Bookmarks",
    browserFolderName: "",
  };

  static create(): SettingsBuilder {
    return new SettingsBuilder();
  }

  withServerUrl(url: string): this {
    this.data.serverUrl = url;
    return this;
  }

  withAccessToken(token: string): this {
    this.data.accessToken = token;
    return this;
  }

  withSyncInterval(minutes: number): this {
    this.data.syncInterval = minutes;
    return this;
  }

  withTargetCollectionName(name: string): this {
    this.data.targetCollectionName = name;
    return this;
  }

  withBrowserFolderName(name: string): this {
    this.data.browserFolderName = name;
    return this;
  }

  build(): Settings {
    return this.data as Settings;
  }
}

/**
 * Log Entry Builder
 */
export class LogEntryBuilder implements Builder<LogEntry> {
  private data: Partial<LogEntry> = {
    timestamp: Date.now(),
    type: "info",
    message: "Test log entry",
  };

  static create(): LogEntryBuilder {
    return new LogEntryBuilder();
  }

  static info(message: string): LogEntryBuilder {
    return new LogEntryBuilder().withType("info").withMessage(message);
  }

  static success(message: string): LogEntryBuilder {
    return new LogEntryBuilder().withType("success").withMessage(message);
  }

  static error(message: string): LogEntryBuilder {
    return new LogEntryBuilder().withType("error").withMessage(message);
  }

  static warning(message: string): LogEntryBuilder {
    return new LogEntryBuilder().withType("warning").withMessage(message);
  }

  withTimestamp(time: number): this {
    this.data.timestamp = time;
    return this;
  }

  withType(type: "info" | "success" | "error" | "warning"): this {
    this.data.type = type;
    return this;
  }

  withMessage(message: string): this {
    this.data.message = message;
    return this;
  }

  build(): LogEntry {
    return this.data as LogEntry;
  }
}

/**
 * Linkwarden Link Builder
 */
export class LinkBuilder implements Builder<LinkwardenLink> {
  private data: Partial<LinkwardenLink> = {
    id: 1,
    name: "Test Link",
    type: "url",
    url: "https://example.com",
    collectionId: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  static create(): LinkBuilder {
    return new LinkBuilder();
  }

  withId(id: number): this {
    this.data.id = id;
    return this;
  }

  withName(name: string): this {
    this.data.name = name;
    return this;
  }

  withUrl(url: string): this {
    this.data.url = url;
    return this;
  }

  withCollectionId(id: number): this {
    this.data.collectionId = id;
    return this;
  }

  withUpdatedAt(time: string | number): this {
    this.data.updatedAt =
      typeof time === "number" ? new Date(time).toISOString() : time;
    return this;
  }

  build(): LinkwardenLink {
    return this.data as LinkwardenLink;
  }
}

/**
 * Linkwarden Collection Builder
 */
export class CollectionBuilder implements Builder<LinkwardenCollection> {
  private data: Partial<LinkwardenCollection> = {
    id: 1,
    name: "Test Collection",
    description: "",
    color: "#0ea5e9",
    isPublic: false,
    ownerId: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    links: [],
    collections: [],
  };

  static create(): CollectionBuilder {
    return new CollectionBuilder();
  }

  withId(id: number): this {
    this.data.id = id;
    return this;
  }

  withName(name: string): this {
    this.data.name = name;
    return this;
  }

  withParentId(id: number): this {
    this.data.parentId = id;
    return this;
  }

  withDescription(desc: string): this {
    this.data.description = desc;
    return this;
  }

  withLinks(links: LinkwardenLink[]): this {
    this.data.links = links;
    return this;
  }

  withSubcollections(collections: LinkwardenCollection[]): this {
    this.data.collections = collections;
    return this;
  }

  withUpdatedAt(time: string | number): this {
    this.data.updatedAt =
      typeof time === "number" ? new Date(time).toISOString() : time;
    return this;
  }

  build(): LinkwardenCollection {
    return this.data as LinkwardenCollection;
  }
}

/**
 * Bookmark Node Builder
 */
export class BookmarkBuilder implements Builder<BookmarkNode> {
  private data: Partial<BookmarkNode> = {
    id: "bookmark-1",
    title: "Test Bookmark",
    url: "https://example.com",
    parentId: "1",
    dateAdded: Date.now(),
    dateGroupModified: Date.now(),
    children: [],
  };

  static create(): BookmarkBuilder {
    return new BookmarkBuilder();
  }

  static folder(title: string): BookmarkBuilder {
    return new BookmarkBuilder().withTitle(title).withoutUrl();
  }

  static link(title: string, url: string): BookmarkBuilder {
    return new BookmarkBuilder().withTitle(title).withUrl(url);
  }

  withId(id: string): this {
    this.data.id = id;
    return this;
  }

  withTitle(title: string): this {
    this.data.title = title;
    return this;
  }

  withUrl(url: string): this {
    this.data.url = url;
    return this;
  }

  withoutUrl(): this {
    this.data.url = undefined;
    return this;
  }

  withParentId(id: string): this {
    this.data.parentId = id;
    return this;
  }

  withDateAdded(time: number): this {
    this.data.dateAdded = time;
    return this;
  }

  withDateGroupModified(time: number): this {
    this.data.dateGroupModified = time;
    return this;
  }

  withChildren(children: BookmarkNode[]): this {
    this.data.children = children;
    return this;
  }

  build(): BookmarkNode {
    return this.data as BookmarkNode;
  }
}
