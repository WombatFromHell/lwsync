/**
 * Sync Comparator Types
 * Type definitions for sync comparison and diagnostics
 */

import type { Mapping } from "./storage";

/**
 * Bookmark that needs to be uploaded to server
 */
export interface BookmarkToUpload {
  browserId: string;
  browserPath: string; // e.g., "/Bookmarks/Folder1/Bookmark"
  browserParentId: string;
  title: string;
  url: string;
  reason: "unmapped" | "modified" | "new_folder";
  checksum: string;
  dateAdded?: number;
  dateModified?: number;
}

/**
 * Link that needs to be downloaded from server
 */
export interface LinkToDownload {
  linkwardenId: number;
  linkwardenPath: string; // e.g., "/Favorites/Subcollection/Link"
  linkwardenParentId?: number;
  title: string;
  url: string;
  reason: "unmapped" | "modified" | "new_collection";
  checksum: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Pair of synced items (browser ↔ server)
 */
export interface SyncedPair {
  browserId: string;
  browserPath: string;
  linkwardenId: number;
  linkwardenPath: string;
  title: string;
  url: string;
  lastSyncedAt: number;
  checksumMatch: boolean;
  browserChecksum: string;
  serverChecksum: string;
}

/**
 * Conflict between browser and server versions
 */
export interface Conflict {
  browserId: string;
  linkwardenId: number;
  url: string;
  browserTitle: string;
  serverTitle: string;
  browserModifiedAt: number;
  serverModifiedAt: number;
  browserChecksum: string;
  serverChecksum: string;
  winner: "browser" | "server" | "pending";
  reason: string;
}

/**
 * Summary statistics for sync comparison
 */
export interface ComparisonSummary {
  browserTotal: number;
  serverTotal: number;
  toUploadCount: number;
  toDownloadCount: number;
  syncedCount: number;
  conflictCount: number;
  skippedCount: number;
  estimatedSyncTime?: number; // in milliseconds
}

/**
 * Complete sync comparison result
 */
export interface SyncComparison {
  timestamp: number;
  browserRootId: string;
  serverCollectionId: number;
  serverCollectionName?: string;

  // Categorized items
  toUpload: BookmarkToUpload[];
  toDownload: LinkToDownload[];
  synced: SyncedPair[];
  conflicts: Conflict[];

  // Summary
  summary: ComparisonSummary;

  // Raw data for debugging
  debug?: {
    allBrowserBookmarks: Array<{ id: string; url: string; title: string }>;
    allServerLinks: Array<{ id: number; url: string; name: string }>;
    allMappings: Array<{
      browserId: string;
      linkwardenId: number;
      checksum: string;
    }>;
  };
}

/**
 * Comparison options
 */
export interface ComparisonOptions {
  /** Include debug data in result */
  includeDebug?: boolean;
  /** Compare by checksum (default: true) */
  compareChecksums?: boolean;
  /** Detect conflicts (default: true) */
  detectConflicts?: boolean;
  /** Maximum items to return per category (default: unlimited) */
  limit?: number;
}

/**
 * Sync direction recommendation
 */
export type SyncRecommendation =
  | "upload" // Mostly browser changes
  | "download" // Mostly server changes
  | "bidirectional" // Changes on both sides
  | "none"; // Already in sync

/**
 * Recommendation with explanation
 */
export interface SyncRecommendationResult {
  direction: SyncRecommendation;
  confidence: "high" | "medium" | "low";
  explanation: string;
  actions: Array<{
    type: "upload" | "download" | "resolve_conflict";
    count: number;
    description: string;
  }>;
}
