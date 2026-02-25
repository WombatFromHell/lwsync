/**
 * ConfigSection Component
 * Server configuration form for initial setup
 */

import { useState } from "preact/hooks";
import type { Settings } from "../../types/storage";

export interface ConfigSectionProps {
  settings: Settings;
  onSettingsChange: (settings: Settings) => void;
  onSave: () => Promise<void>;
  onTestConnection: () => Promise<void>;
}

export function ConfigSection({
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
      <p className="help-text">your Linkwarden instance URL (with https://)</p>

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
