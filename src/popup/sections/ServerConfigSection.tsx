/**
 * ServerConfigSection Component
 */

import { useState } from "preact/hooks";
import type { Settings } from "../../types/storage";
import { Input } from "../ui/Input";
import { Button } from "../ui/Button";
import { Spacer } from "../ui/Spacer";
import { FoldingSection } from "../ui/FoldingSection";

export interface ServerConfigSectionProps {
  settings: Settings;
  onSettingsChange: (settings: Settings) => void;
  onTestConnection: () => Promise<void | boolean>;
  onSave: () => Promise<void | boolean>;
  onReset?: () => Promise<void | boolean>;
  /** Whether settings are already saved (configured mode) */
  isConfigured?: boolean;
  defaultExpanded?: boolean;
}

export function ServerConfigSection({
  settings,
  onSettingsChange,
  onTestConnection,
  onSave,
  onReset,
  isConfigured = false,
  defaultExpanded = true,
}: ServerConfigSectionProps) {
  const [isTesting, setIsTesting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);

  const updateField = <K extends keyof Settings>(
    field: K,
    value: Settings[K]
  ) => {
    onSettingsChange({ ...settings, [field]: value });
    setHasChanges(true);
  };

  const handleTestConnection = async () => {
    if (!settings.serverUrl || !settings.accessToken) {
      onSettingsChange({
        ...settings,
        serverUrl: "",
        accessToken: "",
        syncInterval: settings.syncInterval,
        targetCollectionName: settings.targetCollectionName,
        browserFolderName: settings.browserFolderName,
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
        browserFolderName: settings.browserFolderName,
      });
      return;
    }

    // Warn when changing credentials in configured mode
    if (isConfigured && hasChanges) {
      const confirmed = confirm(
        "Changing your URL or access token will reset sync mappings. Continue?"
      );
      if (!confirmed) return;

      // Reset sync data after confirmation
      if (onReset) {
        await onReset();
      }
    }

    setIsSaving(true);
    await onSave();
    setIsSaving(false);
    setHasChanges(false);
  };

  return (
    <FoldingSection
      sectionId="server-config"
      title="Server Configuration"
      defaultExpanded={defaultExpanded}
    >
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

      <Spacer size="sm" />

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

      <Spacer size="md" />

      <div className="flex flex-col gap-2">
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
    </FoldingSection>
  );
}
