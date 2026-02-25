/**
 * Format utilities
 * For displaying time and storage in human-readable format
 */

/**
 * Format a timestamp as a human-readable relative time
 * E.g., "Just now", "5 minutes ago", "2 hours ago", "01/15/2025"
 */
export function formatTime(timestamp: number | null): string {
  if (!timestamp) return "Never";

  const date = new Date(timestamp);
  const now = Date.now();
  const diff = now - date.getTime();

  if (diff < 60000) return "Just now";
  if (diff < 3600000) {
    const minutes = Math.floor(diff / 60000);
    return `${minutes} minute${minutes > 1 ? "s" : ""} ago`;
  }
  if (diff < 86400000) {
    const hours = Math.floor(diff / 3600000);
    return `${hours} hour${hours > 1 ? "s" : ""} ago`;
  }
  return date.toLocaleDateString();
}

/**
 * Format bytes as human-readable string
 * E.g., "1.5 MB", "256 KB", "100 B"
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}
