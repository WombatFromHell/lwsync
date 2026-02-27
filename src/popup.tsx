/**
 * LWSync Popup UI - Preact Implementation
 * Refactored with modular components and hooks
 *
 * Note: CSS is built separately with Tailwind CLI and linked in popup.html
 */

import { render } from "preact";
import { useState, useEffect, useCallback } from "preact/hooks";

import { sendMessage } from "./utils/messaging";
import type { LogEntry } from "./types/storage";

// Components
import {
  StatusMessage,
  ConfigSection,
  StatusSection,
  LogSection,
} from "./popup/components";
import {
  SyncSettingsSection,
  ServerCollectionSection,
  BookmarkFolderSection,
} from "./popup/sections";

// Hooks
import { useSyncStatus, useSettings } from "./hooks";
import { useSyncLog } from "./hooks/useSyncLog";

interface StatusResponse {
  configured: boolean;
  syncing: boolean;
  lastSyncTime: number | null;
  mappingsCount: number;
  pendingChangesCount: number;
  storageBytes?: number;
  syncLog?: LogEntry[];
}

function App() {
  const { status, updateStatus } = useSyncStatus();
  const { settings, setSettings, loadSettings, saveSettings } = useSettings();
  const { clearLog } = useSyncLog();

  const [statusMessage, setStatusMessage] = useState<{
    message: string;
    type: "success" | "error" | "info";
  } | null>(null);

  const showStatus = useCallback(
    (message: string, type: "success" | "error" | "info") => {
      setStatusMessage({ message, type });
    },
    []
  );

  const dismissStatus = useCallback(() => {
    setStatusMessage(null);
  }, []);

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
        showStatus("Connection successful!", "success");
      } else {
        showStatus("Connection failed. Check your URL and token.", "error");
      }
    } catch (error) {
      showStatus(`Connection failed: ${error}`, "error");
    }
  }, [settings.serverUrl, settings.accessToken, showStatus]);

  // Save settings
  const handleSaveSettings = useCallback(async () => {
    if (!settings.serverUrl || !settings.accessToken) {
      showStatus("Please enter both URL and access token", "error");
      return;
    }

    if (
      !settings.serverUrl.startsWith("http://") &&
      !settings.serverUrl.startsWith("https://")
    ) {
      showStatus("URL must start with http:// or https://", "error");
      return;
    }

    const success = await saveSettings(settings);
    if (success) {
      showStatus("Settings saved successfully!", "success");
      await updateStatus();
    } else {
      showStatus("Failed to save settings", "error");
    }
  }, [settings, saveSettings, showStatus, updateStatus]);

  // Trigger sync
  const handleSync = useCallback(async () => {
    try {
      await sendMessage<void>("START_SYNC");

      // Poll for completion
      let attempts = 0;
      while (attempts < 30) {
        await new Promise((r) => setTimeout(r, 500));
        await updateStatus();

        const response = await sendMessage<StatusResponse>("GET_STATUS");
        if (!response.syncing) break;
        attempts++;
      }

      showStatus("Sync completed!", "success");
    } catch (error) {
      showStatus(`Sync failed: ${error}`, "error");
    }
  }, [updateStatus, showStatus]);

  // Reset sync
  const handleReset = useCallback(async () => {
    try {
      await sendMessage<{ success: boolean; error?: string }>("RESET_SYNC");
      showStatus("Sync reset successfully. You can reconfigure now.", "info");
      await Promise.all([updateStatus(), loadSettings()]);
    } catch (error) {
      showStatus(`Reset failed: ${error}`, "error");
    }
  }, [updateStatus, loadSettings, showStatus]);

  // Update sync interval
  const handleUpdateInterval = useCallback(
    async (newInterval: number) => {
      if (isNaN(newInterval) || newInterval < 1 || newInterval > 60) {
        showStatus("Sync interval must be between 1 and 60 minutes", "error");
        return;
      }
      try {
        await sendMessage<{ success: boolean }>("UPDATE_SYNC_INTERVAL", {
          syncInterval: newInterval,
        });
        showStatus(
          `Sync interval updated to ${newInterval} minutes`,
          "success"
        );
        await loadSettings();
      } catch (error) {
        console.error("[LWSync popup] Update interval error:", error);
        showStatus(`Failed to update: ${error}`, "error");
      }
    },
    [showStatus, loadSettings]
  );

  // Update browser folder (client-side)
  const handleUpdateBrowserFolder = useCallback(
    async (newFolderName: string) => {
      try {
        await sendMessage<{ success: boolean }>("UPDATE_BROWSER_FOLDER", {
          browserFolderName: newFolderName,
        });
        showStatus(`Browser folder updated to "${newFolderName}"`, "success");
        await loadSettings();
      } catch (error) {
        console.error("[LWSync popup] Update browser folder error:", error);
        showStatus(`Failed to update: ${error}`, "error");
      }
    },
    [showStatus, loadSettings]
  );

  // Update target collection (server-side)
  const handleUpdateTargetCollection = useCallback(
    async (newCollectionName: string) => {
      try {
        await sendMessage<{ success: boolean }>("UPDATE_TARGET_COLLECTION", {
          targetCollectionName: newCollectionName,
        });
        showStatus(
          `Target collection updated to "${newCollectionName}"`,
          "success"
        );
        await loadSettings();
      } catch (error) {
        console.error("[LWSync popup] Update target collection error:", error);
        showStatus(`Failed to update: ${error}`, "error");
      }
    },
    [showStatus, loadSettings]
  );

  // Initialize on mount
  useEffect(() => {
    Promise.all([loadSettings(), updateStatus()]).catch((error) =>
      console.error("[LWSync popup] Initialization error:", error)
    );
  }, [loadSettings, updateStatus]);

  return (
    <>
      <h1
        className="
          mb-4 flex items-center gap-2 text-[18px] font-semibold text-slate-900
          dark:text-slate-100
        "
      >
        <img src="icon128.png" alt="" className="size-6" />
        LWSync Settings
      </h1>

      {statusMessage && (
        <StatusMessage
          message={statusMessage.message}
          type={statusMessage.type}
          onDismiss={dismissStatus}
        />
      )}

      {!status.configured ? (
        <ConfigSection
          settings={settings}
          onSettingsChange={setSettings}
          onSave={handleSaveSettings}
          onTestConnection={handleTestConnection}
        />
      ) : (
        <div className="space-y-6">
          <StatusSection
            lastSyncTime={status.lastSyncTime}
            mappingsCount={status.mappingsCount}
            pendingChangesCount={status.pendingChangesCount}
            storageBytes={status.storageBytes}
            syncing={status.syncing}
            onSync={handleSync}
            onReset={handleReset}
          />
          <ServerCollectionSection
            targetCollectionName={settings.targetCollectionName}
            onUpdate={handleUpdateTargetCollection}
          />
          <BookmarkFolderSection
            browserFolderName={settings.browserFolderName}
            onUpdate={handleUpdateBrowserFolder}
          />
          <SyncSettingsSection
            syncInterval={settings.syncInterval}
            onUpdateInterval={handleUpdateInterval}
          />
          <LogSection logEntries={status.syncLog} onClear={clearLog} />
        </div>
      )}
    </>
  );
}

// ============================================================================
// Mount the app
// ============================================================================

render(<App />, document.body);
