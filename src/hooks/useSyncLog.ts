/**
 * useSyncLog Hook
 * Manages sync log state and provides clear function
 */

import { useCallback } from "preact/hooks";
import { sendMessage } from "../utils/messaging";

export function useSyncLog() {
  const clearLog = useCallback(async () => {
    try {
      await sendMessage<void>("CLEAR_LOG");
    } catch (error) {
      console.error("[LWSync useSyncLog] Clear log error:", error);
    }
  }, []);

  const addLogEntry = useCallback(
    async (type: "info" | "success" | "error" | "warning", message: string) => {
      try {
        await sendMessage<void>("ADD_LOG_ENTRY", { type, message });
      } catch (error) {
        console.error("[LWSync useSyncLog] Add log entry error:", error);
      }
    },
    []
  );

  return { clearLog, addLogEntry };
}
