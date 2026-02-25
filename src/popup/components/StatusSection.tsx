/**
 * StatusSection Component
 * Displays sync status and provides sync/reset actions
 */

import { useState } from "preact/hooks";
import { formatTime, formatBytes } from "../../utils/format";

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
    <div id="status-section" className="section">
      <div className="section-title">Sync Status</div>

      <div className="status-row">
        <span className="status-label">Last Sync</span>
        <span className="status-value" id="lastSyncTime">
          {formatTime(lastSyncTime)}
        </span>
      </div>
      <div className="status-row">
        <span className="status-label">Bookmarks Synced</span>
        <span className="status-value" id="mappingsCount">
          {mappingsCount}
        </span>
      </div>
      <div className="status-row">
        <span className="status-label">Pending Changes</span>
        <span className="status-value" id="pendingChangesCount">
          {pendingChangesCount}
        </span>
      </div>
      <div className="status-row">
        <span className="status-label">Storage Used</span>
        <span className="status-value" id="storageUsed">
          {formatBytes(storageBytes)}
        </span>
      </div>

      <div className="button-row" style={{ marginTop: "12px" }}>
        <button
          id="syncBtn"
          className="btn-primary"
          onClick={handleSync}
          disabled={syncing || isSyncing}
        >
          {syncing || isSyncing ? (
            <span id="syncBtnText">
              <span className="spinner" /> Syncing...
            </span>
          ) : (
            <span id="syncBtnText">Sync Now</span>
          )}
        </button>
        <button id="resetBtn" className="btn-danger" onClick={handleReset}>
          Reset
        </button>
      </div>
    </div>
  );
}
