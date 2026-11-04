import { StatusDot } from "../primitives/StatusDot.tsx";
import managementStyles from "../settings/Management.module.css";
import { componentClass } from "../componentClass.ts";
import { t, translate } from "../../core/i18n.ts";
import { native } from "../../core/host.ts";
import type { Boot } from "../../core/host.ts";
import { Runtime } from "../../core/runtime.ts";
import type { PanelView } from "../../core/runtime.ts";
import { SettingsTabs } from "../settings/SettingsTabs.tsx";
import { Settings } from "../settings/Settings.tsx";
import { Shortcuts } from "../settings/Shortcuts.tsx";
import { PiSetup } from "../settings/PiSetup.tsx";
import { PiPackages } from "../settings/PiPackages.tsx";
import { Skills } from "../settings/Skills.tsx";
import { Plugins } from "../settings/Plugins.tsx";
import { Panels } from "../settings/Panels.tsx";
import { ModelSettings } from "../settings/ModelSettings.tsx";
import { useShellController } from "../hooks/useShellController.ts";
import { useAppUpdate } from "../hooks/useAppUpdate.ts";
import { Rail } from "./Rail/Rail.tsx";
import { Topbar } from "./Topbar/Topbar.tsx";
import { ShellDialogs } from "./ShellDialogs.tsx";
import { Workspace } from "./Workspace.tsx";
import { ThemeProvider } from "../theme/ThemeProvider.tsx";
import { Panel } from "../primitives/Panel.tsx";
import { useState } from "react";
import styles from "./Shell.module.css";

export function Shell({ runtime, boot }: { runtime: Runtime; boot: Boot }) {
  const controller = useShellController(runtime, boot);
  const appUpdate = useAppUpdate((title, message) => runtime.notice(title, message));
  const [addProviderRequest, setAddProviderRequest] = useState(0);
  const {
    locale,
    page,
    setPage,
    installed,
    path,
    setPath,
    packageSource,
    setPackageSource,
    packageSources,
    packageScope,
    setPackageScope,
    packageBusy,
    skillPath,
    setSkillPath,
    skillScope,
    setSkillScope,
    skills,
    skillBusy,
    working,
    executable,
    setExecutable,
    tasksState,
    catalog,
    projectId,
    task,
    taskStatuses,
    setupStatus,
    setupModel,
    setSetupModel,
    setupBusy,
    setupPathExpanded,
    setSetupPathExpanded,
    setupProgress,
    setupError,
    versionStatus,
    status,
    connected,
    busy,
    layout,
    themePreference,
    setTheme,
    viewMode,
    taskBrowserOpen,
    setTaskBrowserOpen,
    railCollapsed,
    taskMenuOpen,
    setTaskMenuOpen,
    usageOpen,
    setUsageOpen,
    usageStats,
    usageLoading,
    usageError,
    filter,
    contextMenu,
    setContextMenu,
    extensionTitle,
    sessionBusy,
    setRenameOpen,
    setRenameValue,
    legacySessions,
    legacySelected,
    setLegacySelected,
    legacyLoading,
    headerActions,
    usageButton,
    taskMenuButton,
    refreshSetup,
    savePiPath,
    installPi,
    checkPiUpdate,
    updatePi,
    packageAction,
    skillAction,
    skillToggle,
    skillOverride,
    skillCommands,
    clearExtensionUi,
    loadLegacySessions,
    importLegacySessions,
    openHistory,
    branch,
    showUsage,
    setConversationView,
    toggleRail,
    perform,
    run,
    action,
    panels,
    at,
  } = controller;
  function panel(view: PanelView) {
    return (
      <Panel
        key={view.id}
        panel={view}
        location={layout[view.id]?.location ?? view.location}
        onMove={(location) => action("core.layout", { id: view.id, location })}
        onHide={() => action("core.layout", { id: view.id, hidden: true })}
        run={run}
      />
    );
  }
  const selectedProject = catalog.projects.find((project) => project.id === projectId);
  const piInstalled = setupStatus?.installation === "ready";
  const runningCount = [...taskStatuses.values()].filter((value) => value === "working").length;
  const attentionCount = catalog.tasks.filter((item) => item.unread).length;

  return (
    <ThemeProvider value={themePreference}>
      <div
        className={`${componentClass(styles, "app")} ${page === "setup" ? componentClass(styles, "setup-page") : ""} ${page === "models" ? componentClass(styles, "model-view") : ""} ${railCollapsed ? componentClass(styles, "rail-collapsed") : ""}`}
        onContextMenu={(event) => {
          if (at("contextMenu").length) {
            event.preventDefault();
            setContextMenu(true);
          }
        }}
      >
        {page !== "setup" && (
          <Rail
            tasks={tasksState}
            page={page}
            setPage={setPage}
            busy={busy}
            connected={connected}
            railCollapsed={railCollapsed}
            toggleRail={toggleRail}
            taskBrowserOpen={taskBrowserOpen}
            setTaskBrowserOpen={setTaskBrowserOpen}
            runningCount={runningCount}
            attentionCount={attentionCount}
            clearExtensionUi={clearExtensionUi}
            perform={perform}
            action={action}
          />
        )}
        <div className={componentClass(styles, "shell-content")}>
          {page !== "setup" && (
            <Topbar
              page={page}
              projectName={selectedProject?.name}
              extensionTitle={extensionTitle}
              task={task}
              viewMode={viewMode}
              setConversationView={setConversationView}
              connected={connected}
              setupStatus={setupStatus}
              headerActions={headerActions}
              usageButton={usageButton}
              usageOpen={usageOpen}
              showUsage={showUsage}
              runtime={runtime}
              usageStats={usageStats}
              usageLoading={usageLoading}
              usageError={usageError}
              taskMenuButton={taskMenuButton}
              taskMenuOpen={taskMenuOpen}
              setTaskMenuOpen={setTaskMenuOpen}
              setUsageOpen={setUsageOpen}
              working={working}
              busy={busy}
              sessionBusy={sessionBusy}
              openHistory={openHistory}
              branch={branch}
              onAddProvider={() => setAddProviderRequest((value) => value + 1)}
              setRenameValue={setRenameValue}
              setRenameOpen={setRenameOpen}
              perform={perform}
            />
          )}
          {!native && (
            <div className={componentClass(styles, "preview-banner")}>
              {t(
                "Browser preview · Plugin sandbox is live. Run the desktop app to connect your real Pi runtime.",
              )}
            </div>
          )}
          {page === "workspace" && (
            <Workspace controller={controller} panel={panel} selectedProject={selectedProject} />
          )}
          {(page === "settings" ||
            page === "plugins" ||
            page === "panels" ||
            page === "shortcuts") && (
            <SettingsTabs page={page} onNavigate={(next) => action("core.navigate", next)} />
          )}
          {page === "models" && (
            <main className={componentClass(styles, "models-page")}>
              <ModelSettings
                onPackages={() => action("core.navigate", "packages")}
                models={setupStatus?.models}
                selectedModel={setupStatus?.selectedModel}
                runtimeVersion={setupStatus?.installedVersion}
                addProviderRequest={addProviderRequest}
              />
            </main>
          )}
          {page === "setup" && (
            <PiSetup
              setupStatus={setupStatus}
              piInstalled={piInstalled}
              setupBusy={setupBusy}
              setupProgress={setupProgress}
              setupError={setupError}
              setupPathExpanded={setupPathExpanded}
              setSetupPathExpanded={setSetupPathExpanded}
              executable={executable}
              setExecutable={setExecutable}
              installPi={installPi}
              savePiPath={savePiPath}
              setupModel={setupModel}
              setSetupModel={setSetupModel}
              refreshSetup={refreshSetup}
              action={action}
            />
          )}
          {page === "packages" && (
            <PiPackages
              packageSource={packageSource}
              setPackageSource={setPackageSource}
              packageScope={packageScope}
              setPackageScope={setPackageScope}
              packageSources={packageSources}
              packageBusy={packageBusy}
              projectId={projectId}
              packageAction={packageAction}
              runtime={runtime}
            />
          )}
          {page === "skills" && (
            <Skills
              skills={skills}
              skillScope={skillScope}
              setSkillScope={setSkillScope}
              skillBusy={skillBusy}
              skillPath={skillPath}
              setSkillPath={setSkillPath}
              projectId={projectId}
              skillCommands={skillCommands}
              skillAction={skillAction}
              skillOverride={skillOverride}
              skillToggle={skillToggle}
              runtime={runtime}
            />
          )}
          {page === "plugins" && (
            <Plugins
              installed={installed}
              runtime={runtime}
              path={path}
              setPath={setPath}
              busy={busy}
              action={action}
            />
          )}
          {page === "panels" && (
            <Panels panels={panels} layout={layout} at={at} panel={panel} action={action} />
          )}
          {page === "shortcuts" && <Shortcuts />}
          {page === "settings" && (
            <Settings
              locale={locale}
              action={action}
              themePreference={themePreference}
              setTheme={setTheme}
              executable={executable}
              setExecutable={setExecutable}
              busy={busy}
              connected={connected}
              setupError={setupError}
              setupStatus={setupStatus}
              setupBusy={setupBusy}
              setupProgress={setupProgress}
              refreshSetup={refreshSetup}
              versionStatus={versionStatus}
              checkPiUpdate={checkPiUpdate}
              updatePi={updatePi}
              appUpdate={appUpdate}
              legacySessions={legacySessions}
              legacyLoading={legacyLoading}
              legacySelected={legacySelected}
              setLegacySelected={setLegacySelected}
              loadLegacySessions={loadLegacySessions}
              importLegacySessions={importLegacySessions}
              runtime={runtime}
            />
          )}
          {page !== "setup" && (
            <footer className={componentClass(styles, "statusbar")}>
              <span>
                <StatusDot offline={!connected} />
                {translate(locale, status)}
              </span>
              <span>
                {working
                  ? t("Working…")
                  : task
                    ? t("Local task")
                    : native && !setupStatus
                      ? t("Checking Pi…")
                      : native && !setupStatus?.modelReady
                        ? t("Finish Pi setup before starting a task.")
                        : t("Ready for a new task")}
              </span>
              {at("statusBar").map(panel)}
            </footer>
          )}
        </div>
        <ShellDialogs controller={controller} runtime={runtime} panel={panel} />
      </div>
    </ThemeProvider>
  );
}
