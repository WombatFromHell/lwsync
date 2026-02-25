/**
 * BookmarkFolderSection Component
 * Allows updating the target browser bookmark folder
 */

import { useState, useEffect } from "preact/hooks";
import { getDefaultBrowserRootFolderName } from "../../bookmarks";

export interface BookmarkFolderSectionProps {
  browserFolderName: string;
  onUpdate: (name: string) => Promise<void>;
}

export function BookmarkFolderSection({
  browserFolderName,
  onUpdate,
}: BookmarkFolderSectionProps) {
  const [folderName, setFolderName] = useState(browserFolderName);
  const [isUpdating, setIsUpdating] = useState(false);

  useEffect(() => {
    setFolderName(browserFolderName);
  }, [browserFolderName]);

  const handleUpdate = async () => {
    const name = folderName.trim() || getDefaultBrowserRootFolderName();
    if (!name) {
      return;
    }
    setIsUpdating(true);
    await onUpdate(name);
    setIsUpdating(false);
  };

  return (
    <div id="bookmark-folder-section" className="section">
      <div className="section-title">Bookmark Folder</div>

      <label htmlFor="targetFolderName">Target Bookmark Folder</label>
      <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
        <input
          type="text"
          id="targetFolderName"
          placeholder="e.g. Work/Links (leave empty for root)"
          value={folderName}
          style={{ marginBottom: "0" }}
          onInput={(e) => setFolderName((e.target as HTMLInputElement).value)}
        />
        <button
          id="updateFolderBtn"
          className="btn-secondary"
          style={{ width: "auto", padding: "8px 16px" }}
          onClick={handleUpdate}
          disabled={isUpdating}
        >
          {isUpdating ? "Updating..." : "Update"}
        </button>
      </div>
      <p className="help-text">
        Use / for nested folders. Leave empty to use the root bookmarks folder.
      </p>
    </div>
  );
}
