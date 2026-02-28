/**
 * StatusMessage Component
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

  const base =
    "sticky top-0 z-50 rounded-lg border px-4 py-3 text-sm shadow-lg";

  const variants = {
    success:
      "border-green-200 bg-green-50 text-green-800 dark:border-green-800 dark:bg-green-900/80 dark:text-green-300",
    error:
      "border-red-200 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-900/80 dark:text-red-300",
    info: "border-sky-200 bg-sky-50 text-sky-800 dark:border-sky-800 dark:bg-sky-900/80 dark:text-sky-300",
  };

  return (
    <div
      className={`
        ${base}
        ${variants[type]}
      `}
      role="alert"
    >
      <div className="flex items-start justify-between gap-3">
        <span className="flex-1">{message}</span>
        {onDismiss && (
          <button
            className="
              flex size-5 shrink-0 items-center justify-center rounded-sm
              text-slate-500 transition-colors
              hover:bg-black/10
              dark:text-slate-400
            "
            onClick={onDismiss}
            title="Dismiss"
            type="button"
          >
            ×
          </button>
        )}
      </div>
    </div>
  );
}
