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
import type { SyncPreference } from "../../types/storage";

export interface CommonSettingsSectionProps {
  // Server Collection props
  targetCollectionName: string;
  onUpdateTargetCollection: (name: string) => Promise<void | boolean>;
  // Root Bookmark Folder props
  rootFolderName: string;
  onUpdateRootFolder: (name: string) => Promise<void | boolean>;
  // Subfolder props
  browserFolderName: string;
  onUpdateBrowserFolder: (name: string) => Promise<void | boolean>;
  // Sync Settings props
  syncInterval: number;
  onUpdateInterval: (interval: number) => Promise<void | boolean>;
  // Sync Preference
  syncPreference: SyncPreference;
  onUpdateSyncPreference: (pref: SyncPreference) => Promise<void | boolean>;
  // Common
  disabled?: boolean;
  defaultExpanded?: boolean;
}

export function CommonSettingsSection({
  targetCollectionName,
  onUpdateTargetCollection,
  rootFolderName,
  onUpdateRootFolder,
  browserFolderName,
  onUpdateBrowserFolder,
  syncInterval,
  onUpdateInterval,
  syncPreference,
  onUpdateSyncPreference,
  disabled = false,
  defaultExpanded = false,
}: CommonSettingsSectionProps) {
  const [interval, setInterval] = useState(syncInterval);
  const [isUpdating, setIsUpdating] = useState(false);
  const [isUpdatingPref, setIsUpdatingPref] = useState(false);

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

  const handleUpdateSyncPreference = async (pref: SyncPreference) => {
    if (disabled) return;
    setIsUpdatingPref(true);
    await onUpdateSyncPreference(pref);
    setIsUpdatingPref(false);
  };

  return (
    <FoldingSection
      sectionId="common-settings"
      title="Common Settings"
      defaultExpanded={defaultExpanded}
    >
      <CollectionBox
        title="Server Collection"
        label="Target Collection Name or ID"
        value={targetCollectionName}
        onUpdate={onUpdateTargetCollection}
        placeholder="Favorites or 42"
        helpText='Enter collection name/id (e.g., "Favorites", or 45). Use "/" for nested paths.'
        disabled={disabled}
      />

      <Spacer size="sm" />

      <CollectionBox
        title="Root Bookmark Folder"
        label="Root Bookmark Folder"
        value={rootFolderName}
        onUpdate={onUpdateRootFolder}
        placeholder="Bookmarks Bar"
        helpText='Top-level folder for sync (e.g., "Bookmarks Bar", "Other Bookmarks"). Leave empty for the browser default.'
        disabled={disabled}
      />

      <Spacer size="sm" />

      <CollectionBox
        title="Subfolder"
        label="Subfolder Within Root"
        value={browserFolderName}
        onUpdate={onUpdateBrowserFolder}
        placeholder="Work/Links (leave empty for root)"
        helpText="Use / for nested folders. Leave empty to sync directly into the root folder."
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

        <Spacer size="sm" />

        <label
          className="
            mb-1.5 block text-sm font-medium text-slate-700
            dark:text-slate-300
          "
        >
          Conflict Resolution
        </label>

        <div className="flex gap-2">
          {(
            [
              { value: "prefer-remote" as const, label: "Server wins" },
              { value: "prefer-local" as const, label: "Browser wins" },
            ] as const
          ).map((opt) => (
            <button
              key={opt.value}
              type="button"
              disabled={disabled || isUpdatingPref}
              onClick={() => handleUpdateSyncPreference(opt.value)}
              className={`
                flex-1 rounded-md border px-2 py-1.5 text-sm font-medium
                transition-colors
                ${
                  syncPreference === opt.value
                    ? `
                      border-sky-500 bg-sky-50 text-sky-700
                      dark:border-sky-400 dark:bg-sky-900/30 dark:text-sky-300
                    `
                    : `
                      border-slate-300 bg-white text-slate-600
                      hover:border-slate-400
                      dark:border-slate-600 dark:bg-slate-800
                      dark:text-slate-400
                      dark:hover:border-slate-500
                    `
                }
                ${
                  disabled || isUpdatingPref
                    ? "cursor-not-allowed opacity-50"
                    : "cursor-pointer"
                }
              `}
            >
              {opt.label}
            </button>
          ))}
        </div>

        <Spacer size="xs" />

        <p
          className="
            text-xs text-slate-500
            dark:text-slate-400
          "
        >
          {syncPreference === "prefer-remote"
            ? "Server data wins when conflicts are detected."
            : "Browser data wins when conflicts are detected."}
        </p>
      </div>
    </FoldingSection>
  );
}
