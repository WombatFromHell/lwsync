/**
 * SyncSettingsSection Component
 */

import { useState, useEffect } from "preact/hooks";
import { Section, Input, Button } from "../ui";

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
    <Section id="sync-settings-section" title="Sync Settings">
      <div className="flex items-end gap-2">
        <div className="flex-1">
          <Input
            id="syncIntervalDisplay"
            label="Sync Interval (minutes)"
            type="number"
            min={1}
            max={60}
            value={interval}
            onInput={(e) =>
              setInterval(
                parseInt((e.target as HTMLInputElement).value, 10) || 5
              )
            }
          />
        </div>
        <Button
          id="updateIntervalBtn"
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
        Background sync runs automatically at this interval.
      </p>
    </Section>
  );
}
