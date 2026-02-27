/**
 * StatusSection Component
 */

import { useState } from "preact/hooks";
import { formatTime, formatBytes } from "../../utils/format";
import { Section, StatusRow, Button } from "../ui";

export interface StatusSectionProps {
  lastSyncTime: number | null;
  mappingsCount: number;
  pendingChangesCount: number;
  storageBytes: number;
  syncing: boolean;
  onSync: () => Promise<void>;
  onReset: () => Promise<void>;
}

export function StatusSection({
  lastSyncTime,
  mappingsCount,
  pendingChangesCount,
  storageBytes,
  syncing,
  onSync,
  onReset,
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
    <Section id="status-section" title="Sync Status">
      <div
        className="
          mb-4 rounded-[6px] border border-slate-200 bg-slate-50 p-4
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

      <div className="flex gap-2">
        <Button
          id="syncBtn"
          variant="primary"
          onClick={handleSync}
          disabled={syncing || isSyncing}
          loading={syncing || isSyncing}
        >
          Sync Now
        </Button>
        <Button
          id="resetBtn"
          variant="danger"
          onClick={handleReset}
          fullWidth={false}
        >
          Reset
        </Button>
      </div>
    </Section>
  );
}
