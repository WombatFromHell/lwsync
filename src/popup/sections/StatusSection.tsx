/**
 * StatusSection Component
 */

import { useState } from "preact/hooks";
import { formatTime, formatBytes } from "../../utils";
import { StatusRow } from "../ui/StatusRow";
import { Button } from "../ui/Button";
import { Spacer } from "../ui/Spacer";
import { FoldingSection } from "../ui/FoldingSection";

export interface StatusSectionProps {
  lastSyncTime: number | null;
  mappingsCount: number;
  pendingChangesCount: number;
  storageBytes: number;
  syncing: boolean;
  onSync: () => Promise<void | boolean>;
  onReset: () => Promise<void | boolean>;
  disabled?: boolean;
  defaultExpanded?: boolean;
}

export function StatusSection({
  lastSyncTime,
  mappingsCount,
  pendingChangesCount,
  storageBytes,
  syncing,
  onSync,
  onReset,
  disabled = false,
  defaultExpanded = true,
}: StatusSectionProps) {
  const [isSyncing, setIsSyncing] = useState(false);

  const handleSync = async () => {
    setIsSyncing(true);
    await onSync();
    setIsSyncing(false);
  };

  const handleReset = async () => {
    if (
      !confirm(
        "This will clear all sync data. Your bookmarks and Linkwarden data will not be deleted. Continue?"
      )
    ) {
      return;
    }
    await onReset();
  };

  return (
    <FoldingSection
      sectionId="sync-status"
      title="Sync Status"
      defaultExpanded={defaultExpanded}
    >
      <div
        className="
          rounded-md border border-slate-200 bg-slate-50 p-3
          dark:border-slate-700 dark:bg-slate-800
        "
      >
        <StatusRow
          label="Last Sync"
          value={formatTime(lastSyncTime)}
          id="lastSyncTime"
        />
        <StatusRow
          label="Bookmarks Synced"
          value={mappingsCount}
          id="mappingsCount"
        />
        <StatusRow
          label="Pending Changes"
          value={pendingChangesCount}
          id="pendingChangesCount"
        />
        <StatusRow
          label="Storage Used"
          value={formatBytes(storageBytes)}
          id="storageUsed"
        />
      </div>

      <Spacer size="md" />

      <div className="flex flex-col gap-2">
        <Button
          id="syncBtn"
          variant="primary"
          onClick={handleSync}
          disabled={disabled || syncing || isSyncing}
          loading={syncing || isSyncing}
        >
          {syncing || isSyncing ? "Syncing..." : "Sync Now"}
        </Button>
        <Button
          id="resetBtn"
          variant="danger"
          onClick={handleReset}
          disabled={disabled}
        >
          Reset Sync Data
        </Button>
      </div>
    </FoldingSection>
  );
}
