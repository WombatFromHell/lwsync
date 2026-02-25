/**
 * SyncSettingsSection Component
 * Allows updating the sync interval
 */

import { useState, useEffect } from "preact/hooks";

export interface SyncSettingsSectionProps {
  syncInterval: number;
  onUpdateInterval: (interval: number) => Promise<void>;
}

export function SyncSettingsSection({
  syncInterval,
  onUpdateInterval,
}: SyncSettingsSectionProps) {
  const [interval, setInterval] = useState(syncInterval);
  const [isUpdating, setIsUpdating] = useState(false);

  useEffect(() => {
    setInterval(syncInterval);
  }, [syncInterval]);

  const handleUpdate = async () => {
    if (isNaN(interval) || interval < 1 || interval > 60) {
      return;
    }
    setIsUpdating(true);
    await onUpdateInterval(interval);
    setIsUpdating(false);
  };

  return (
    <div id="sync-settings-section" className="section">
      <div className="section-title">Sync Settings</div>

      <label htmlFor="syncIntervalDisplay">Sync Interval (minutes)</label>
      <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
        <input
          type="number"
          id="syncIntervalDisplay"
          min="1"
          max="60"
          value={interval}
          style={{ marginBottom: "0" }}
          onInput={(e) =>
            setInterval(parseInt((e.target as HTMLInputElement).value, 10) || 5)
          }
        />
        <button
          id="updateIntervalBtn"
          className="btn-secondary"
          style={{ width: "auto", padding: "8px 16px" }}
          onClick={handleUpdate}
          disabled={isUpdating}
        >
          {isUpdating ? "Updating..." : "Update"}
        </button>
      </div>
      <p className="help-text">
        Background sync runs automatically at this interval.
      </p>
    </div>
  );
}
