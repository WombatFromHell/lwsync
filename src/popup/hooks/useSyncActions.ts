/**
 * useSyncActions Hook
 * Consolidates sync-related action handlers with common patterns
 */

import { useCallback } from "preact/hooks";
import { sendMessage } from "../../utils/index";
import type { Settings } from "../../types/storage";

export interface UseSyncActionsOptions {
  settings: Settings;
  updateStatus: () => Promise<void>;
  loadSettings: () => Promise<void>;
  show: (message: string, type: "success" | "error" | "info") => void;
}

export function useSyncActions({
  settings,
  updateStatus,
  loadSettings,
  show,
}: UseSyncActionsOptions) {
  // Test connection
  const handleTestConnection = useCallback(async () => {
    try {
      const result = await sendMessage<{ success: boolean }>(
        "TEST_CONNECTION",
        {
          serverUrl: settings.serverUrl,
          token: settings.accessToken,
        }
      );
      if (result.success) {
        show("Connection successful!", "success");
      } else {
        show("Connection failed. Check your URL and token.", "error");
      }
    } catch (error) {
      show(`Connection failed: ${error}`, "error");
    }
  }, [settings.serverUrl, settings.accessToken, show]);

  // Save settings
  const handleSaveSettings = useCallback(async () => {
    if (!settings.serverUrl || !settings.accessToken) {
      show("Please enter both URL and access token", "error");
      return false;
    }

    if (
      !settings.serverUrl.startsWith("http://") &&
      !settings.serverUrl.startsWith("https://")
    ) {
      show("URL must start with http:// or https://", "error");
      return false;
    }

    try {
      await sendMessage<{ success: boolean }>("SAVE_SETTINGS", {
        serverUrl: settings.serverUrl,
        accessToken: settings.accessToken,
        syncInterval: settings.syncInterval,
        targetCollectionName: settings.targetCollectionName,
        browserFolderName: settings.browserFolderName,
      });
      show("Settings saved successfully!", "success");
      await updateStatus();
      return true;
    } catch (error) {
      console.error("[LWSync useSyncActions] Save error:", error);
      show("Failed to save settings", "error");
      return false;
    }
  }, [settings, updateStatus, show]);

  // Trigger sync
  const handleSync = useCallback(async () => {
    try {
      await sendMessage<void>("START_SYNC");

      // Poll for completion
      let attempts = 0;
      while (attempts < 30) {
        await new Promise((r) => setTimeout(r, 500));
        await updateStatus();

        const response = await sendMessage<{ syncing: boolean }>("GET_STATUS");
        if (!response.syncing) break;
        attempts++;
      }

      show("Sync completed!", "success");
    } catch (error) {
      show(`Sync failed: ${error}`, "error");
    }
  }, [updateStatus, show]);

  // Reset sync
  const handleReset = useCallback(async () => {
    try {
      const result = await sendMessage<{ success: boolean; error?: string }>(
        "RESET_SYNC"
      );
      if (result.success) {
        show("Sync reset successfully. You can reconfigure now.", "info");
        await Promise.all([updateStatus(), loadSettings()]);
      } else {
        show(`Reset failed: ${result.error || "Unknown error"}`, "error");
      }
    } catch (error) {
      show(`Reset failed: ${error}`, "error");
    }
  }, [updateStatus, loadSettings, show]);

  // Update sync interval
  const handleUpdateInterval = useCallback(
    async (newInterval: number) => {
      if (isNaN(newInterval) || newInterval < 1 || newInterval > 60) {
        show("Sync interval must be between 1 and 60 minutes", "error");
        return false;
      }
      try {
        await sendMessage<{ success: boolean }>("UPDATE_SYNC_INTERVAL", {
          syncInterval: newInterval,
        });
        show(`Sync interval updated to ${newInterval} minutes`, "success");
        await loadSettings();
        return true;
      } catch (error) {
        console.error("[LWSync useSyncActions] Update interval error:", error);
        show(`Failed to update: ${error}`, "error");
        return false;
      }
    },
    [show, loadSettings]
  );

  // Update browser folder
  const handleUpdateBrowserFolder = useCallback(
    async (newFolderName: string) => {
      try {
        await sendMessage<{ success: boolean }>("UPDATE_BROWSER_FOLDER", {
          browserFolderName: newFolderName,
        });
        show(`Browser folder updated to "${newFolderName}"`, "success");
        await loadSettings();
        return true;
      } catch (error) {
        console.error(
          "[LWSync useSyncActions] Update browser folder error:",
          error
        );
        show(`Failed to update: ${error}`, "error");
        return false;
      }
    },
    [show, loadSettings]
  );

  // Update target collection
  const handleUpdateTargetCollection = useCallback(
    async (newCollectionName: string) => {
      try {
        await sendMessage<{ success: boolean }>("UPDATE_TARGET_COLLECTION", {
          targetCollectionName: newCollectionName,
        });
        show(`Target collection updated to "${newCollectionName}"`, "success");
        await loadSettings();
        return true;
      } catch (error) {
        console.error(
          "[LWSync useSyncActions] Update target collection error:",
          error
        );
        show(`Failed to update: ${error}`, "error");
        return false;
      }
    },
    [show, loadSettings]
  );

  return {
    handleTestConnection,
    handleSaveSettings,
    handleSync,
    handleReset,
    handleUpdateInterval,
    handleUpdateBrowserFolder,
    handleUpdateTargetCollection,
  };
}
