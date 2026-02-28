/**
 * CommonSettingsSection Component
 * Wrapper for Server Collection, Bookmark Folder, and Sync Settings
 */

import { useState, useEffect } from "preact/hooks";
import { FoldingSection } from "../ui/FoldingSection";
import { Spacer } from "../ui/Spacer";
import { Input } from "../ui/Input";
import { Button } from "../ui/Button";
import { CollectionBox } from "../components/CollectionBox";

export interface CommonSettingsSectionProps {
  // Server Collection props
  targetCollectionName: string;
  onUpdateTargetCollection: (name: string) => Promise<void | boolean>;
  // Bookmark Folder props
  browserFolderName: string;
  onUpdateBrowserFolder: (name: string) => Promise<void | boolean>;
  // Sync Settings props
  syncInterval: number;
  onUpdateInterval: (interval: number) => Promise<void | boolean>;
  // Common
  disabled?: boolean;
  defaultExpanded?: boolean;
}

export function CommonSettingsSection({
  targetCollectionName,
  onUpdateTargetCollection,
  browserFolderName,
  onUpdateBrowserFolder,
  syncInterval,
  onUpdateInterval,
  disabled = false,
  defaultExpanded = false,
}: CommonSettingsSectionProps) {
  const [interval, setInterval] = useState(syncInterval);
  const [isUpdating, setIsUpdating] = useState(false);

  useEffect(() => {
    setInterval(syncInterval);
  }, [syncInterval]);

  const handleUpdateInterval = async () => {
    if (disabled) return;
    if (isNaN(interval) || interval < 1 || interval > 60) {
      return;
    }
    setIsUpdating(true);
    await onUpdateInterval(interval);
    setIsUpdating(false);
  };

  return (
    <FoldingSection
      sectionId="common-settings"
      title="Common Settings"
      defaultExpanded={defaultExpanded}
    >
      <CollectionBox
        title="Server Collection"
        label="Target Collection Name"
        value={targetCollectionName}
        onUpdate={onUpdateTargetCollection}
        placeholder="Bookmarks/Linkwarden"
        helpText="Case-sensitive. Use / for nested collections. Will be created if it doesn't exist."
        disabled={disabled}
      />

      <Spacer size="sm" />

      <CollectionBox
        title="Bookmark Folder"
        label="Target Bookmark Folder"
        value={browserFolderName}
        onUpdate={onUpdateBrowserFolder}
        placeholder="Work/Links (leave empty for root)"
        helpText="Use / for nested folders. Leave empty to use the root bookmarks folder."
        disabled={disabled}
      />

      <Spacer size="sm" />

      <div
        className="
          rounded-lg border border-slate-200 bg-white px-2 py-2.5
          dark:border-slate-700 dark:bg-slate-800/50
        "
      >
        <h2
          className="
            mb-2.5 text-base font-semibold text-slate-900
            dark:text-slate-100
          "
        >
          Sync Settings
        </h2>

        <Input
          id="syncIntervalDisplay"
          label="Sync Interval (minutes)"
          type="number"
          min={1}
          max={60}
          value={interval}
          onInput={(e) =>
            setInterval(parseInt((e.target as HTMLInputElement).value, 10) || 5)
          }
        />

        <Spacer size="sm" />

        <Button
          id="updateIntervalBtn"
          variant="secondary"
          onClick={handleUpdateInterval}
          disabled={disabled || isUpdating}
          loading={isUpdating}
        >
          {isUpdating ? "Updating..." : "Update"}
        </Button>

        <Spacer size="sm" />

        <p
          className="
            text-xs text-slate-500
            dark:text-slate-400
          "
        >
          Background sync runs automatically at this interval.
        </p>
      </div>
    </FoldingSection>
  );
}
