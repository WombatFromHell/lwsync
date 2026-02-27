/**
 * BookmarkFolderSection Component
 */

import { useState, useEffect } from "preact/hooks";
import { getDefaultBrowserRootFolderName } from "../../bookmarks";
import { Section, Input, Button } from "../ui";

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
    <Section id="bookmark-folder-section" title="Bookmark Folder">
      <div className="flex items-end gap-2">
        <div className="flex-1">
          <Input
            id="targetFolderName"
            label="Target Bookmark Folder"
            type="text"
            placeholder="e.g. Work/Links (leave empty for root)"
            value={folderName}
            onInput={(e) => setFolderName((e.target as HTMLInputElement).value)}
          />
        </div>
        <Button
          id="updateFolderBtn"
          variant="secondary"
          onClick={handleUpdate}
          disabled={isUpdating}
          loading={isUpdating}
          fullWidth={false}
        >
          {isUpdating ? "Updating..." : "Update"}
        </Button>
      </div>
      <p
        className="
          mt-[2px] mb-[14px] text-[11px] text-slate-500
          dark:text-slate-400
        "
      >
        Use / for nested folders. Leave empty to use the root bookmarks folder.
      </p>
    </Section>
  );
}
