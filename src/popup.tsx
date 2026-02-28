/**
 * LWSync Popup UI - Preact Implementation
 * Refactored with modular components and hooks
 *
 * Note: CSS is built separately with Tailwind CLI and linked in popup.html
 */

import { render } from "preact";
import { useEffect } from "preact/hooks";

import { Spacer } from "./popup/ui/Spacer";
import { Content } from "./popup/ui/Content";

// Components
import { StatusMessage } from "./popup/components/StatusMessage";
import { LogSection } from "./popup/components/LogSection";
import { ServerConfigSection } from "./popup/sections/ServerConfigSection";
import { CommonSettingsSection } from "./popup/sections/CommonSettingsSection";
import { StatusSection } from "./popup/sections/StatusSection";

// Hooks
import { useSyncStatus } from "./popup/hooks/useSyncStatus";
import { useSettings } from "./popup/hooks/useSettings";
import { useSyncLog } from "./popup/hooks/useSyncLog";
import { useStatusMessage } from "./popup/hooks/useStatusMessage";
import { useSyncActions } from "./popup/hooks/useSyncActions";

function App() {
  const { status, updateStatus } = useSyncStatus();
  const { settings, setSettings, loadSettings, saveSettings } = useSettings();
  const { clearLog } = useSyncLog();
  const { statusMessage, show, dismiss } = useStatusMessage();

  const actions = useSyncActions({
    settings,
    updateStatus,
    loadSettings,
    show,
  });

  // Initialize on mount
  useEffect(() => {
    Promise.all([loadSettings(), updateStatus()]).catch((error) =>
      console.error("[LWSync popup] Initialization error:", error)
    );
  }, [loadSettings, updateStatus]);

  return (
    <div
      className="
        min-h-screen bg-white
        dark:bg-slate-900
      "
    >
      <Content className="pb-2">
        <header className="flex items-center gap-2.5">
          <img src="icon128.png" alt="" className="size-6" />
          <h1
            className="
              text-lg font-semibold text-slate-900
              dark:text-slate-100
            "
          >
            LWSync Settings
          </h1>
        </header>

        <Spacer size="sm" />

        {statusMessage && (
          <StatusMessage
            message={statusMessage.message}
            type={statusMessage.type}
            onDismiss={dismiss}
          />
        )}

        <div className="flex flex-col gap-4">
          <ServerConfigSection
            settings={settings}
            onSettingsChange={setSettings}
            onTestConnection={actions.handleTestConnection}
            onSave={actions.handleSaveSettings}
            onReset={actions.handleReset}
            isConfigured={status.configured}
            defaultExpanded={!status.configured}
          />
          <StatusSection
            lastSyncTime={status.lastSyncTime}
            mappingsCount={status.mappingsCount}
            pendingChangesCount={status.pendingChangesCount}
            storageBytes={status.storageBytes}
            syncing={status.syncing}
            onSync={actions.handleSync}
            onReset={actions.handleReset}
            disabled={!status.configured}
            defaultExpanded={status.configured}
          />
          <CommonSettingsSection
            targetCollectionName={settings.targetCollectionName}
            onUpdateTargetCollection={actions.handleUpdateTargetCollection}
            browserFolderName={settings.browserFolderName}
            onUpdateBrowserFolder={actions.handleUpdateBrowserFolder}
            syncInterval={settings.syncInterval}
            onUpdateInterval={actions.handleUpdateInterval}
            disabled={!status.configured}
          />
          <LogSection
            logEntries={status.syncLog}
            onClear={clearLog}
            onStatusUpdate={updateStatus}
            hidden={!status.configured}
          />
        </div>
      </Content>
    </div>
  );
}

// ============================================================================
// Mount the app
// ============================================================================

render(<App />, document.body);
