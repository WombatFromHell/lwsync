/**
 * useSyncStatus Hook
 * Manages sync status state and provides update function
 */

import { useState, useCallback } from "preact/hooks";
import { sendMessage } from "../../utils/index";

export interface SyncStatus {
  configured: boolean;
  syncing: boolean;
  lastSyncTime: number | null;
  mappingsCount: number;
  pendingChangesCount: number;
  storageBytes: number;
  syncLog: {
    timestamp: number;
    type: "info" | "success" | "error" | "warning";
    message: string;
  }[];
}

export function useSyncStatus() {
  const [status, setStatus] = useState<SyncStatus>({
    configured: false,
    syncing: false,
    lastSyncTime: null,
    mappingsCount: 0,
    pendingChangesCount: 0,
    storageBytes: 0,
    syncLog: [],
  });

  const updateStatus = useCallback(async () => {
    try {
      const response = await sendMessage<SyncStatus>("GET_STATUS");
      setStatus({
        configured: response.configured,
        syncing: response.syncing,
        lastSyncTime: response.lastSyncTime,
        mappingsCount: response.mappingsCount,
        pendingChangesCount: response.pendingChangesCount,
        storageBytes: response.storageBytes ?? 0,
        syncLog: response.syncLog ?? [],
      });
    } catch (error) {
      console.error("[LWSync useSyncStatus] Status update error:", error);
    }
  }, []);

  return { status, updateStatus };
}
