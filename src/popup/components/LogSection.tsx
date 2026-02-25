/**
 * LogSection Component
 * Displays sync log entries
 */

import type { LogEntry } from "../../types/storage";

export interface LogSectionProps {
  logEntries: LogEntry[];
  onClear: () => Promise<void>;
}

export function LogSection({ logEntries, onClear }: LogSectionProps) {
  const handleClear = async () => {
    await onClear();
  };

  return (
    <div id="log-section" className="section">
      <div className="section-title">
        Sync Log
        <button
          id="clearLogBtn"
          className="btn-secondary"
          style={{
            width: "auto",
            padding: "2px 8px",
            fontSize: "11px",
            float: "right",
          }}
          onClick={handleClear}
        >
          Clear
        </button>
      </div>
      <div
        id="syncLog"
        style={{
          maxHeight: "150px",
          overflowY: "auto",
          background: "var(--section-bg)",
          border: "1px solid var(--border-color)",
          borderRadius: "6px",
          padding: "8px",
          fontFamily: "monospace",
          fontSize: "11px",
          boxSizing: "border-box",
          wordBreak: "break-word",
          marginBottom: "8px",
        }}
      >
        {logEntries && logEntries.length > 0 ? (
          logEntries
            .slice(-50)
            .reverse()
            .map((entry, i) => {
              const time = new Date(entry.timestamp).toLocaleTimeString();
              const colors: Record<string, string> = {
                info: "var(--status-info-text)",
                success: "var(--status-success-text)",
                error: "var(--status-error-text)",
                warning: "var(--status-warning-text, #92400e)",
              };
              const icons: Record<string, string> = {
                info: "ℹ️",
                success: "✅",
                error: "❌",
                warning: "⚠️",
              };
              return (
                <div key={i} style={{ marginBottom: "4px" }}>
                  <span style={{ color: "var(--text-muted)" }}>[{time}]</span>
                  <span style={{ color: colors[entry.type] }}>
                    {icons[entry.type]}
                  </span>
                  <span style={{ color: "var(--text-color)" }}>
                    {entry.message}
                  </span>
                </div>
              );
            })
        ) : (
          <div style={{ color: "var(--text-muted)", textAlign: "center" }}>
            No sync activity yet
          </div>
        )}
      </div>
    </div>
  );
}
