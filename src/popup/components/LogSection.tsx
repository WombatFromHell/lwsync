/**
 * LogSection Component
 */

import type { LogEntry } from "../../types/storage";
import { Button } from "../ui/Button";
import { FoldingSection } from "../ui/FoldingSection";
import { Spacer } from "../ui/Spacer";

export interface LogSectionProps {
  logEntries: LogEntry[];
  onClear: () => Promise<void>;
  onStatusUpdate?: () => Promise<void>;
  defaultExpanded?: boolean;
  /** Whether to hide the entire section (e.g., when unconfigured) */
  hidden?: boolean;
}

export function LogSection({
  logEntries,
  onClear,
  onStatusUpdate,
  defaultExpanded = false,
  hidden = false,
}: LogSectionProps) {
  if (hidden) {
    return null;
  }

  const handleClear = async () => {
    await onClear();
    await onStatusUpdate?.();
  };

  const getColors = (type: string) => {
    const colors: Record<string, string> = {
      info: "text-sky-600 dark:text-sky-400",
      success: "text-green-600 dark:text-green-400",
      error: "text-red-600 dark:text-red-400",
      warning: "text-amber-600 dark:text-amber-400",
    };
    return colors[type] || "text-slate-600 dark:text-slate-400";
  };

  const getIcon = (type: string) => {
    const icons: Record<string, string> = {
      info: "ℹ️",
      success: "✅",
      error: "❌",
      warning: "⚠️",
    };
    return icons[type] || "ℹ️";
  };

  return (
    <FoldingSection
      sectionId="sync-log"
      title="Sync Log"
      defaultExpanded={defaultExpanded}
    >
      <div
        className="
          max-h-40 overflow-y-auto rounded-md border border-slate-200
          bg-slate-50 p-2
          dark:border-slate-700 dark:bg-slate-800
        "
      >
        {logEntries && logEntries.length > 0 ? (
          logEntries
            .slice(-50)
            .reverse()
            .map((entry, i) => {
              const time = new Date(entry.timestamp).toLocaleTimeString();
              return (
                <div
                  key={i}
                  className="
                    mb-2 text-xs
                    last:mb-0
                  "
                >
                  <span
                    className="
                      text-slate-500
                      dark:text-slate-400
                    "
                  >
                    [{time}]{""}
                  </span>
                  <span className={getColors(entry.type)}>
                    {getIcon(entry.type)}
                    {""}
                  </span>
                  <span
                    className="
                      text-slate-900
                      dark:text-slate-100
                    "
                  >
                    {entry.message}
                  </span>
                </div>
              );
            })
        ) : (
          <div
            className="
              py-6 text-center text-sm text-slate-500
              dark:text-slate-400
            "
          >
            No sync activity yet
          </div>
        )}
      </div>

      <Spacer size="sm" />

      <div className="flex justify-end">
        <Button
          id="clearLogBtn"
          variant="secondary"
          onClick={handleClear}
          fullWidth={false}
          className="px-2.5 py-1 text-xs font-medium"
        >
          Clear Log
        </Button>
      </div>
    </FoldingSection>
  );
}
