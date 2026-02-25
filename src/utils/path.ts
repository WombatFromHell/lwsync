/**
 * Path parsing utilities
 * For handling hierarchical paths in collections and bookmarks
 */

/**
 * Parse a folder path string into an array of folder names
 * Supports Unix-style paths with / delimiter
 * E.g., "Bookmarks Menu/Linkwarden" -> ["Bookmarks Menu", "Linkwarden"]
 */
export function parseFolderPath(path: string): string[] {
  return path
    .split("/")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}
