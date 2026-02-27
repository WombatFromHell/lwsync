/**
 * LogSection Component
 */

import type { LogEntry } from "../../types/storage";
import { Section, Button } from "../ui";

export interface LogSectionProps {
  logEntries: LogEntry[];
  onClear: () => Promise<void>;
}

export function LogSection({ logEntries, onClear }: LogSectionProps) {
  const handleClear = async () => {
    await onClear();
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
    <Section
      id="log-section"
      title="Sync Log"
      action={
        <Button
          id="clearLogBtn"
          variant="secondary"
          onClick={handleClear}
          fullWidth={false}
          class="px-2! py-0.5! text-xs!"
        >
          Clear
        </Button>
      }
    >
      <div
        className="
          mb-2 max-h-[150px] overflow-y-auto rounded-[6px] border
          border-slate-200 bg-slate-50 p-2 font-mono text-[11px] break-all
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
                <div key={i} className="mb-1">
                  <span
                    className="
                      text-slate-500
                      dark:text-slate-400
                    "
                  >
                    [{time}]
                  </span>{" "}
                  <span className={getColors(entry.type)}>
                    {getIcon(entry.type)}
                  </span>{" "}
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
              text-center text-slate-500
              dark:text-slate-400
            "
          >
            No sync activity yet
          </div>
        )}
      </div>
    </Section>
  );
}
