/**
 * SyncSettingsSection Component
 */

import { useState, useEffect } from "preact/hooks";
import { Input } from "../ui/Input";
import { Button } from "../ui/Button";
import { Spacer } from "../ui/Spacer";
import { Card } from "../ui/Card";

export interface SyncSettingsSectionProps {
  syncInterval: number;
  onUpdateInterval: (interval: number) => Promise<void>;
  disabled?: boolean;
}

export function SyncSettingsSection({
  syncInterval,
  onUpdateInterval,
  disabled = false,
}: SyncSettingsSectionProps) {
  const [interval, setInterval] = useState(syncInterval);
  const [isUpdating, setIsUpdating] = useState(false);

  useEffect(() => {
    setInterval(syncInterval);
  }, [syncInterval]);

  const handleUpdate = async () => {
    if (disabled) return;
    if (isNaN(interval) || interval < 1 || interval > 60) {
      return;
    }
    setIsUpdating(true);
    await onUpdateInterval(interval);
    setIsUpdating(false);
  };

  return (
    <Card>
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
        onClick={handleUpdate}
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
    </Card>
  );
}
