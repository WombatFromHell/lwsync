/**
 * ConfigSection Component
 */

import { useState } from "preact/hooks";
import type { Settings } from "../../types/storage";
import { Section, Input, Button } from "../ui";

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
    <Section id="config-section" title="Server Configuration">
      <div className="space-y-4">
        <Input
          id="serverUrl"
          label="Linkwarden URL"
          type="text"
          placeholder="https://linkwarden.example.com"
          value={settings.serverUrl}
          onInput={(e) =>
            updateField("serverUrl", (e.target as HTMLInputElement).value)
          }
          helpText="Your Linkwarden instance URL (with https://)"
        />

        <Input
          id="accessToken"
          label="Access Token"
          type="password"
          placeholder="Enter your access token"
          value={settings.accessToken}
          onInput={(e) =>
            updateField("accessToken", (e.target as HTMLInputElement).value)
          }
          helpText="Create a token in Settings → Access Tokens"
        />

        <Input
          id="syncInterval"
          label="Sync Interval (minutes)"
          type="number"
          min={1}
          max={60}
          value={settings.syncInterval}
          onInput={(e) =>
            updateField(
              "syncInterval",
              parseInt((e.target as HTMLInputElement).value, 10) || 5
            )
          }
          helpText="How often to sync automatically"
        />

        <Input
          id="targetCollection"
          label="Target Collection Name"
          type="text"
          placeholder="e.g. Bookmarks/Linkwarden"
          value={settings.targetCollectionName}
          onInput={(e) =>
            updateField(
              "targetCollectionName",
              (e.target as HTMLInputElement).value
            )
          }
          helpText="Case-sensitive. Use / for nested collections."
        />

        <Input
          id="browserFolder"
          label="Browser Bookmark Folder"
          type="text"
          placeholder="e.g. Work/Links (leave empty for root)"
          value={settings.browserFolderName}
          onInput={(e) =>
            updateField(
              "browserFolderName",
              (e.target as HTMLInputElement).value
            )
          }
          helpText="Use / for nested folders. Leave empty for root."
        />
      </div>

      <div className="mt-6 space-y-2">
        <Button
          id="testConnectionBtn"
          variant="secondary"
          onClick={handleTestConnection}
          disabled={isTesting || isSaving}
          loading={isTesting}
        >
          {isTesting ? "Testing..." : "Test Connection"}
        </Button>
        <Button
          id="saveBtn"
          variant="primary"
          onClick={handleSave}
          disabled={isTesting || isSaving}
          loading={isSaving}
        >
          {isSaving ? "Saving..." : "Save Settings"}
        </Button>
      </div>
    </Section>
  );
}
