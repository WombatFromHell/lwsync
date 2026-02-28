/**
 * useStatusMessage Hook
 * Manages status message state with optional auto-dismiss
 */

import { useState, useCallback, useEffect } from "preact/hooks";

export interface StatusMessageData {
  message: string;
  type: "success" | "error" | "info";
}

export interface UseStatusMessageOptions {
  autoDismiss?: boolean;
  dismissDelay?: number;
}

export function useStatusMessage({
  autoDismiss = true,
  dismissDelay = 5000,
}: UseStatusMessageOptions = {}) {
  const [statusMessage, setStatusMessage] = useState<StatusMessageData | null>(
    null
  );

  const show = useCallback(
    (message: string, type: "success" | "error" | "info") => {
      setStatusMessage({ message, type });
    },
    []
  );

  const dismiss = useCallback(() => {
    setStatusMessage(null);
  }, []);

  // Auto-dismiss effect
  useEffect(() => {
    if (autoDismiss && statusMessage) {
      const timer = setTimeout(dismiss, dismissDelay);
      return () => clearTimeout(timer);
    }
  }, [autoDismiss, dismissDelay, statusMessage, dismiss]);

  return { statusMessage, show, dismiss };
}
