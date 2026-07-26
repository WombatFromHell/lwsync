/**
 * useSettings Hook
 * Manages settings state and provides load/save functions
 */

import { useState, useCallback } from "preact/hooks";
import { sendMessage } from "../../utils/index";
import { getDefaultCollectionName } from "../../browser";
import type { Settings } from "../../types/storage";

const defaultSettings: Settings = {
  serverUrl: "",
  accessToken: "",
  syncInterval: 5,
  targetCollectionName: getDefaultCollectionName(),
  rootFolderName: "",
  browserFolderName: "",
  syncPreference: "prefer-remote",
};

export function useSettings() {
  const [settings, setSettings] = useState<Settings>({ ...defaultSettings });

  const loadSettings = useCallback(async () => {
    try {
      const response = await sendMessage<Settings | null>("GET_SETTINGS");
      if (response) {
        setSettings({
          serverUrl: response.serverUrl || "",
          accessToken: response.accessToken || "",
          syncInterval: response.syncInterval || 5,
          targetCollectionName:
            response.targetCollectionName || getDefaultCollectionName(),
          rootFolderName: response.rootFolderName || "",
          browserFolderName: response.browserFolderName || "",
          syncPreference: response.syncPreference || "prefer-remote",
        });
      } else {
        // Reset to defaults if no settings (e.g., after reset)
        setSettings({ ...defaultSettings });
      }
    } catch (error) {
      console.error("[LWSync useSettings] Settings load error:", error);
    }
  }, []);

  const saveSettings = useCallback(
    async (newSettings: Settings): Promise<boolean> => {
      if (!newSettings.serverUrl || !newSettings.accessToken) {
        return false;
      }

      if (
        !newSettings.serverUrl.startsWith("http://") &&
        !newSettings.serverUrl.startsWith("https://")
      ) {
        return false;
      }

      try {
        await sendMessage<{ success: boolean }>("SAVE_SETTINGS", {
          serverUrl: newSettings.serverUrl,
          accessToken: newSettings.accessToken,
          syncInterval: newSettings.syncInterval,
          targetCollectionName: newSettings.targetCollectionName,
          rootFolderName: newSettings.rootFolderName,
          browserFolderName: newSettings.browserFolderName,
          syncPreference: newSettings.syncPreference,
        });
        return true;
      } catch (error) {
        console.error("[LWSync useSettings] Save error:", error);
        return false;
      }
    },
    []
  );

  return { settings, setSettings, loadSettings, saveSettings };
}
