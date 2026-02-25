/**
 * Bookmarks Types
 * Type definitions for browser bookmark operations
 */

export interface BookmarkNode {
  id: string;
  parentId?: string;
  index?: number;
  title?: string;
  url?: string;
  dateAdded?: number;
  dateGroupModified?: number;
  children?: BookmarkNode[];
}

export interface BookmarkCreateDetails {
  parentId?: string;
  index?: number;
  title?: string;
  url?: string;
}

export interface BookmarkUpdateChanges {
  title?: string;
  url?: string;
}

export interface BookmarkMoveDestination {
  parentId?: string;
  index?: number;
}
