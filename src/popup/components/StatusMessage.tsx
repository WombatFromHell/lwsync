/**
 * StatusMessage Component
 * Displays temporary status notifications
 */

import { useEffect } from "preact/hooks";

export interface StatusMessageProps {
  message: string;
  type: "success" | "error" | "info";
  onDismiss?: () => void;
  autoDismiss?: boolean;
  dismissDelay?: number;
}

export function StatusMessage({
  message,
  type,
  onDismiss,
  autoDismiss = true,
  dismissDelay = 5000,
}: StatusMessageProps) {
  useEffect(() => {
    if (autoDismiss && onDismiss) {
      const timer = setTimeout(onDismiss, dismissDelay);
      return () => clearTimeout(timer);
    }
  }, [autoDismiss, dismissDelay, onDismiss]);

  return (
    <div className={`status status-${type}`}>
      <span>{message}</span>
      {onDismiss && (
        <button className="status-dismiss" onClick={onDismiss} title="Dismiss">
          ×
        </button>
      )}
    </div>
  );
}
