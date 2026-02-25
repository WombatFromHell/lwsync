/**
 * LWSync Popup UI - Preact Implementation
 */
import { render } from "preact";
import { useState, useEffect, useCallback } from "preact/hooks";

import { createLogger } from "./logger";
import { getDefaultCollectionName } from "./browser";
import { getDefaultBrowserRootFolderName } from "./bookmarks";

const logger = createLogger("LWSync popup");

// ============================================================================
// Types
// ============================================================================

interface StatusResponse {
  configured: boolean;
  syncing: boolean;
  lastSyncTime: number | null;
  mappingsCount: number;
  pendingChangesCount: number;
  storageBytes?: number;
  syncLog?: LogEntry[];
}

interface LogEntry {
  timestamp: number;
  type: "info" | "success" | "error" | "warning";
  message: string;
}

interface Settings {
  serverUrl: string;
  accessToken: string;
  syncInterval: number;
  targetCollectionName: string;
  browserFolderName: string;
}

// ============================================================================
// Utility Functions
// ============================================================================

function formatTime(timestamp: number | null): string {
  if (!timestamp) return "Never";

  const date = new Date(timestamp);
  const now = new Date();
  const diff = now.getTime() - date.getTime();

  if (diff < 60000) return "Just now";
  if (diff < 3600000) {
    const minutes = Math.floor(diff / 60000);
    return `${minutes} minute${minutes > 1 ? "s" : ""} ago`;
  }
  if (diff < 86400000) {
    const hours = Math.floor(diff / 3600000);
    return `${hours} hour${hours > 1 ? "s" : ""} ago`;
  }
  return date.toLocaleDateString();
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function sendMessage<T>(type: string, payload?: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    const message = payload ? { type, payload } : { type };
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(response);
      }
    });
  });
}

// ============================================================================
// Components
// ============================================================================

interface StatusMessageProps {
  message: string;
  type: "success" | "error" | "info";
  onDismiss?: () => void;
  autoDismiss?: boolean;
  dismissDelay?: number;
}

function StatusMessage({
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

interface ConfigSectionProps {
  settings: Settings;
  onSettingsChange: (settings: Settings) => void;
  onSave: () => Promise<void>;
  onTestConnection: () => Promise<void>;
}

function ConfigSection({
  settings,
  onSettingsChange,
  onSave,
  onTestConnection,
}: ConfigSectionProps) {
  const [isTesting, setIsTesting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const handleTestConnection = async () => {
    if (!settings.serverUrl || !settings.accessToken) {
      onSettingsChange({
        ...settings,
        serverUrl: "",
        accessToken: "",
        syncInterval: settings.syncInterval,
        targetCollectionName: settings.targetCollectionName,
      });
      return;
    }
    setIsTesting(true);
    await onTestConnection();
    setIsTesting(false);
  };

  const handleSave = async () => {
    if (!settings.serverUrl || !settings.accessToken) {
      onSettingsChange({
        ...settings,
        serverUrl: "",
        accessToken: "",
        syncInterval: settings.syncInterval,
        targetCollectionName: settings.targetCollectionName,
      });
      return;
    }
    setIsSaving(true);
    await onSave();
    setIsSaving(false);
  };

  const updateField = <K extends keyof Settings>(
    field: K,
    value: Settings[K]
  ) => {
    onSettingsChange({ ...settings, [field]: value });
  };

  return (
    <div id="config-section" className="section">
      <div className="section-title">Server Configuration</div>

      <label htmlFor="serverUrl">Linkwarden URL</label>
      <input
        type="text"
        id="serverUrl"
        placeholder="https://linkwarden.example.com"
        value={settings.serverUrl}
        onInput={(e) =>
          updateField("serverUrl", (e.target as HTMLInputElement).value)
        }
      />
      <p className="help-text">Your Linkwarden instance URL (with https://)</p>

      <label htmlFor="accessToken">Access Token</label>
      <input
        type="password"
        id="accessToken"
        placeholder="Enter your access token"
        value={settings.accessToken}
        onInput={(e) =>
          updateField("accessToken", (e.target as HTMLInputElement).value)
        }
      />
      <p className="help-text">Create a token in Settings → Access Tokens</p>

      <label htmlFor="syncInterval">Sync Interval (minutes)</label>
      <input
        type="number"
        id="syncInterval"
        min="1"
        max="60"
        value={settings.syncInterval}
        onInput={(e) =>
          updateField(
            "syncInterval",
            parseInt((e.target as HTMLInputElement).value, 10) || 5
          )
        }
      />

      <label htmlFor="targetCollection">Target Collection Name</label>
      <input
        type="text"
        id="targetCollection"
        placeholder="e.g. Bookmarks/Linkwarden"
        value={settings.targetCollectionName}
        onInput={(e) =>
          updateField(
            "targetCollectionName",
            (e.target as HTMLInputElement).value
          )
        }
      />
      <p className="help-text">
        Case-sensitive. Use / for nested collections. Will be created if it
        doesn&apos;t exist.
      </p>

      <label htmlFor="browserFolder">Browser Bookmark Folder</label>
      <input
        type="text"
        id="browserFolder"
        placeholder="e.g. Work/Links (leave empty for root)"
        value={settings.browserFolderName}
        onInput={(e) =>
          updateField("browserFolderName", (e.target as HTMLInputElement).value)
        }
      />
      <p className="help-text">
        Use / for nested folders. Leave empty to use the root bookmarks folder.
      </p>

      <button
        id="testConnectionBtn"
        className="btn-secondary"
        onClick={handleTestConnection}
        disabled={isTesting || isSaving}
      >
        {isTesting ? "Testing..." : "Test Connection"}
      </button>
      <button
        id="saveBtn"
        className="btn-primary"
        style={{ marginTop: "8px" }}
        onClick={handleSave}
        disabled={isTesting || isSaving}
      >
        {isSaving ? "Saving..." : "Save Settings"}
      </button>
    </div>
  );
}

interface StatusSectionProps {
  lastSyncTime: number | null;
  mappingsCount: number;
  pendingChangesCount: number;
  storageBytes: number;
  syncing: boolean;
  onSync: () => Promise<void>;
  onReset: () => Promise<void>;
}

function StatusSection({
  lastSyncTime,
  mappingsCount,
  pendingChangesCount,
  storageBytes,
  syncing,
  onSync,
  onReset,
}: StatusSectionProps) {
  const [isSyncing, setIsSyncing] = useState(false);

  const handleSync = async () => {
    setIsSyncing(true);
    await onSync();
    setIsSyncing(false);
  };

  const handleReset = async () => {
    if (
      !confirm(
        "This will clear all sync data. Your bookmarks and Linkwarden data will not be deleted. Continue?"
      )
    ) {
      return;
    }
    await onReset();
  };

  return (
    <div id="status-section" className="section">
      <div className="section-title">Sync Status</div>

      <div className="status-row">
        <span className="status-label">Last Sync</span>
        <span className="status-value" id="lastSyncTime">
          {formatTime(lastSyncTime)}
        </span>
      </div>
      <div className="status-row">
        <span className="status-label">Bookmarks Synced</span>
        <span className="status-value" id="mappingsCount">
          {mappingsCount}
        </span>
      </div>
      <div className="status-row">
        <span className="status-label">Pending Changes</span>
        <span className="status-value" id="pendingChangesCount">
          {pendingChangesCount}
        </span>
      </div>
      <div className="status-row">
        <span className="status-label">Storage Used</span>
        <span className="status-value" id="storageUsed">
          {formatBytes(storageBytes)}
        </span>
      </div>

      <div className="button-row" style={{ marginTop: "12px" }}>
        <button
          id="syncBtn"
          className="btn-primary"
          onClick={handleSync}
          disabled={syncing || isSyncing}
        >
          {syncing || isSyncing ? (
            <span id="syncBtnText">
              <span className="spinner" /> Syncing...
            </span>
          ) : (
            <span id="syncBtnText">Sync Now</span>
          )}
        </button>
        <button id="resetBtn" className="btn-danger" onClick={handleReset}>
          Reset
        </button>
      </div>
    </div>
  );
}

interface SyncSettingsSectionProps {
  syncInterval: number;
  onUpdateInterval: (interval: number) => Promise<void>;
}

function SyncSettingsSection({
  syncInterval,
  onUpdateInterval,
}: SyncSettingsSectionProps) {
  const [interval, setInterval] = useState(syncInterval);
  const [isUpdating, setIsUpdating] = useState(false);

  useEffect(() => {
    setInterval(syncInterval);
  }, [syncInterval]);

  const handleUpdate = async () => {
    if (isNaN(interval) || interval < 1 || interval > 60) {
      return;
    }
    setIsUpdating(true);
    await onUpdateInterval(interval);
    setIsUpdating(false);
  };

  return (
    <div id="sync-settings-section" className="section">
      <div className="section-title">Sync Settings</div>

      <label htmlFor="syncIntervalDisplay">Sync Interval (minutes)</label>
      <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
        <input
          type="number"
          id="syncIntervalDisplay"
          min="1"
          max="60"
          value={interval}
          style={{ marginBottom: "0" }}
          onInput={(e) =>
            setInterval(parseInt((e.target as HTMLInputElement).value, 10) || 5)
          }
        />
        <button
          id="updateIntervalBtn"
          className="btn-secondary"
          style={{ width: "auto", padding: "8px 16px" }}
          onClick={handleUpdate}
          disabled={isUpdating}
        >
          {isUpdating ? "Updating..." : "Update"}
        </button>
      </div>
      <p className="help-text">
        Background sync runs automatically at this interval.
      </p>
    </div>
  );
}

interface LogSectionProps {
  logEntries: LogEntry[];
  onClear: () => Promise<void>;
}

function LogSection({ logEntries, onClear }: LogSectionProps) {
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

interface ServerCollectionSectionProps {
  targetCollectionName: string;
  onUpdate: (name: string) => Promise<void>;
}

function ServerCollectionSection({
  targetCollectionName,
  onUpdate,
}: ServerCollectionSectionProps) {
  const [collectionName, setCollectionName] = useState(targetCollectionName);
  const [isUpdating, setIsUpdating] = useState(false);

  useEffect(() => {
    setCollectionName(targetCollectionName);
  }, [targetCollectionName]);

  const handleUpdate = async () => {
    const name = collectionName.trim() || getDefaultBrowserRootFolderName();
    if (!name) {
      return;
    }
    setIsUpdating(true);
    await onUpdate(name);
    setIsUpdating(false);
  };

  return (
    <div id="server-collection-section" className="section">
      <div className="section-title">Server Collection</div>

      <label htmlFor="targetCollectionName">Target Collection Name</label>
      <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
        <input
          type="text"
          id="targetCollectionName"
          placeholder="e.g. Bookmarks/Linkwarden"
          value={collectionName}
          style={{ marginBottom: "0" }}
          onInput={(e) =>
            setCollectionName((e.target as HTMLInputElement).value)
          }
        />
        <button
          id="updateCollectionBtn"
          className="btn-secondary"
          style={{ width: "auto", padding: "8px 16px" }}
          onClick={handleUpdate}
          disabled={isUpdating}
        >
          {isUpdating ? "Updating..." : "Update"}
        </button>
      </div>
      <p className="help-text">
        Case-sensitive. Use / for nested collections. Will be created if it
        doesn&apos;t exist.
      </p>
    </div>
  );
}

interface BookmarkFolderSectionProps {
  browserFolderName: string;
  onUpdate: (name: string) => Promise<void>;
}

function BookmarkFolderSection({
  browserFolderName,
  onUpdate,
}: BookmarkFolderSectionProps) {
  const [folderName, setFolderName] = useState(browserFolderName);
  const [isUpdating, setIsUpdating] = useState(false);

  useEffect(() => {
    setFolderName(browserFolderName);
  }, [browserFolderName]);

  const handleUpdate = async () => {
    const name = folderName.trim() || getDefaultBrowserRootFolderName();
    if (!name) {
      return;
    }
    setIsUpdating(true);
    await onUpdate(name);
    setIsUpdating(false);
  };

  return (
    <div id="bookmark-folder-section" className="section">
      <div className="section-title">Bookmark Folder</div>

      <label htmlFor="targetFolderName">Target Bookmark Folder</label>
      <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
        <input
          type="text"
          id="targetFolderName"
          placeholder="e.g. Work/Links (leave empty for root)"
          value={folderName}
          style={{ marginBottom: "0" }}
          onInput={(e) => setFolderName((e.target as HTMLInputElement).value)}
        />
        <button
          id="updateFolderBtn"
          className="btn-secondary"
          style={{ width: "auto", padding: "8px 16px" }}
          onClick={handleUpdate}
          disabled={isUpdating}
        >
          {isUpdating ? "Updating..." : "Update"}
        </button>
      </div>
      <p className="help-text">
        Use / for nested folders. Leave empty to use the root bookmarks folder.
      </p>
    </div>
  );
}

// ============================================================================
// Main App Component
// ============================================================================

function App() {
  const [configured, setConfigured] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [lastSyncTime, setLastSyncTime] = useState<number | null>(null);
  const [mappingsCount, setMappingsCount] = useState(0);
  const [pendingChangesCount, setPendingChangesCount] = useState(0);
  const [storageBytes, setStorageBytes] = useState(0);
  const [syncLog, setSyncLog] = useState<LogEntry[]>([]);
  const [settings, setSettings] = useState<Settings>({
    serverUrl: "",
    accessToken: "",
    syncInterval: 5,
    targetCollectionName: getDefaultCollectionName(),
    browserFolderName: "",
  });
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

  // Load status from background
  const updateStatus = useCallback(async () => {
    try {
      const response = await sendMessage<StatusResponse>("GET_STATUS");
      setConfigured(response.configured);
      setSyncing(response.syncing);
      setLastSyncTime(response.lastSyncTime);
      setMappingsCount(response.mappingsCount);
      setPendingChangesCount(response.pendingChangesCount);
      if (response.storageBytes !== undefined) {
        setStorageBytes(response.storageBytes);
      }
      if (response.syncLog) {
        setSyncLog(response.syncLog);
      }
    } catch (error) {
      logger.error("Status update error:", error);
    }
  }, []);

  // Load settings
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
          browserFolderName: response.browserFolderName || "",
        });
      } else {
        // Reset to defaults if no settings (e.g., after reset)
        setSettings({
          serverUrl: "",
          accessToken: "",
          syncInterval: 5,
          targetCollectionName: getDefaultCollectionName(),
          browserFolderName: "",
        });
      }
    } catch (error) {
      logger.error("Settings load error:", error);
    }
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
      showStatus("Connection failed: " + error, "error");
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

    try {
      await sendMessage<{ success: boolean }>("SAVE_SETTINGS", {
        serverUrl: settings.serverUrl,
        accessToken: settings.accessToken,
        syncInterval: settings.syncInterval,
        targetCollectionName: settings.targetCollectionName,
        browserFolderName: settings.browserFolderName,
      });
      showStatus("Settings saved successfully!", "success");
      await updateStatus();
    } catch (error) {
      logger.error("Save error:", error);
      showStatus("Failed to save: " + error, "error");
    }
  }, [settings, showStatus, updateStatus]);

  // Trigger sync
  const handleSync = useCallback(async () => {
    try {
      await sendMessage<void>("START_SYNC");

      // Poll for completion
      let attempts = 0;
      while (attempts < 30) {
        await new Promise((r) => setTimeout(r, 500));
        await updateStatus();

        const status = await sendMessage<StatusResponse>("GET_STATUS");
        if (!status.syncing) break;
        attempts++;
      }

      showStatus("Sync completed!", "success");
    } catch (error) {
      showStatus("Sync failed: " + error, "error");
    }
  }, [updateStatus, showStatus]);

  // Reset sync
  const handleReset = useCallback(async () => {
    try {
      await sendMessage<{ success: boolean; error?: string }>("RESET_SYNC");
      showStatus("Sync reset successfully. You can reconfigure now.", "info");
      await Promise.all([updateStatus(), loadSettings()]);
    } catch (error) {
      showStatus("Reset failed: " + error, "error");
    }
  }, [updateStatus, loadSettings, showStatus]);

  // Clear log
  const handleClearLog = useCallback(async () => {
    try {
      await sendMessage<void>("CLEAR_LOG");
      await updateStatus();
    } catch (error) {
      logger.error("Clear log error:", error);
    }
  }, [updateStatus]);

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
        logger.error("Update interval error:", error);
        showStatus("Failed to update: " + error, "error");
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
        logger.error("Update browser folder error:", error);
        showStatus("Failed to update: " + error, "error");
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
        logger.error("Update target collection error:", error);
        showStatus("Failed to update: " + error, "error");
      }
    },
    [showStatus, loadSettings]
  );

  // Initialize on mount
  useEffect(() => {
    Promise.all([loadSettings(), updateStatus()]).catch((error) =>
      logger.error("Initialization error:", error)
    );
  }, [loadSettings, updateStatus]);

  return (
    <>
      <h1>
        <img src="icon128.png" alt="" />
        LWSync Settings
      </h1>

      {statusMessage && (
        <StatusMessage
          message={statusMessage.message}
          type={statusMessage.type}
          onDismiss={dismissStatus}
        />
      )}

      {!configured ? (
        <ConfigSection
          settings={settings}
          onSettingsChange={setSettings}
          onSave={handleSaveSettings}
          onTestConnection={handleTestConnection}
        />
      ) : (
        <>
          <StatusSection
            lastSyncTime={lastSyncTime}
            mappingsCount={mappingsCount}
            pendingChangesCount={pendingChangesCount}
            storageBytes={storageBytes}
            syncing={syncing}
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
          <LogSection logEntries={syncLog} onClear={handleClearLog} />
        </>
      )}

      <div className="footer-spacer" />
    </>
  );
}

// ============================================================================
// Mount the app
// ============================================================================

render(<App />, document.body);
