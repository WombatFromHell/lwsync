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
    "fixed top-2 left-2 right-2 pl-3 pr-8 py-[10px] rounded-[6px] text-[13px] z-50 shadow-[0_4px_12px_rgba(0,0,0,0.15)]";

  const variants = {
    success:
      "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-100",
    error: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-100",
    info: "bg-sky-100 text-sky-800 dark:bg-sky-900 dark:text-sky-100",
  };

  return (
    <div
      className={`
        ${base}
        ${variants[type]}
      `}
    >
      <div className="flex items-start justify-between gap-3">
        <span className="flex-1">{message}</span>
        {onDismiss && (
          <button
            className="
              flex size-5 shrink-0 items-center justify-center rounded-sm
              transition-colors
              hover:bg-black/10
            "
            onClick={onDismiss}
            title="Dismiss"
          >
            ×
          </button>
        )}
      </div>
    </div>
  );
}
