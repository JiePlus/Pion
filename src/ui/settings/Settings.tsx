import utilityStyles from "../primitives/Utilities.module.css";
import { Select } from "../primitives/Select.tsx";
import { Button } from "../primitives/Button.tsx";
import managementStyles from "./Management.module.css";
import { componentClass } from "../componentClass.ts";
import type { Dispatch, SetStateAction } from "react";
import { useEffect, useState } from "react";
import { host, native } from "../../core/host.ts";
import type { PiSetupStatus } from "../../core/host.ts";
import type { Locale } from "../../core/api.ts";
import { t } from "../../core/i18n.ts";
import type { Runtime } from "../../core/runtime.ts";
import type { ThemePreference } from "../../core/theme.ts";
import { PiVersionSection } from "./PiVersionSection.tsx";
import { PionUpdateSection } from "./PionUpdateSection.tsx";
import type { AppUpdateController } from "../hooks/useAppUpdate.ts";
import { Checkbox, Input } from "../primitives/index.ts";
import { Icon } from "../primitives/Icon.tsx";
import { StatGrid, StatTile } from "../primitives/StatTile.tsx";
import styles from "./Settings.module.css";
import { PageHero } from "./PageKit.tsx";
import { Segmented } from "../primitives/Segmented.tsx";
import { readRunMode, saveRunMode } from "../../core/runMode.ts";

export interface LegacySession {
  id: string;
  title: string;
  projectPath: string;
  modified: number;
  messageCount: number;
}

interface SettingsProps {
  locale: Locale;
  action: (id: string, args?: string) => void;
  themePreference: ThemePreference;
  setTheme: (value: ThemePreference) => void;
  executable: string;
  setExecutable: Dispatch<SetStateAction<string>>;
  busy: boolean;
  connected: boolean;
  setupError: string;
  setupStatus: PiSetupStatus | null;
  setupBusy: boolean;
  setupProgress: string;
  refreshSetup: () => Promise<void>;
  versionStatus: PiSetupStatus | null;
  checkPiUpdate: () => Promise<void>;
  updatePi: () => Promise<void>;
  appUpdate: AppUpdateController;
  legacySessions: LegacySession[];
  legacyLoading: boolean;
  legacySelected: Set<string>;
  setLegacySelected: Dispatch<SetStateAction<Set<string>>>;
  loadLegacySessions: () => Promise<void>;
  importLegacySessions: () => Promise<void>;
  runtime: Runtime;
}

export function Settings({
  locale,
  action,
  themePreference,
  setTheme,
  executable,
  setExecutable,
  busy,
  connected,
  setupError,
  setupStatus,
  setupBusy,
  setupProgress,
  refreshSetup,
  versionStatus,
  checkPiUpdate,
  updatePi,
  appUpdate,
  legacySessions,
  legacyLoading,
  legacySelected,
  setLegacySelected,
  loadLegacySessions,
  importLegacySessions,
  runtime,
}: SettingsProps) {
  const [piCandidates, setPiCandidates] = useState<{ executable: string; version: string }[]>([]);
  const [piScanning, setPiScanning] = useState(native);
  const [piScanError, setPiScanError] = useState("");
  const [piScanRevision, setPiScanRevision] = useState(0);
  const [piOperation, setPiOperation] = useState<"runtime" | "update">("runtime");

  useEffect(() => {
    if (!native) return;
    let cancelled = false;
    setPiScanning(true);
    setPiScanError("");
    setPiCandidates([]);
    host<{ candidates: { executable: string; version: string }[] }>({
      op: "pi_setup.scan",
      executable,
    })
      .then((result) => {
        if (!cancelled) setPiCandidates(result.candidates);
      })
      .catch((failure) => {
        if (!cancelled) setPiScanError(String(failure));
      })
      .finally(() => {
        if (!cancelled) setPiScanning(false);
      });
    return () => {
      cancelled = true;
    };
    // Scan on entry or an explicit retry, never on each keystroke. Results only
    // offer choices; they cannot overwrite a path edited while scanning.
  }, [piScanRevision]);

  const [runMode, setRunMode] = useState(readRunMode);
  return (
    <main
      className={`${componentClass(managementStyles, "management")} ${styles.settings} settings`}
    >
      <PageHero
        eyebrow="General"
        title={t("Settings")}
        description={t("Manage appearance, language, and the Pi runtime.")}
      />
      <StatGrid>
        <StatTile
          label={t("Pi runtime")}
          tone="blue"
          icon={<Icon name="terminal" size={15} />}
          value={setupStatus?.installedVersion ?? "—"}
          caption={
            setupStatus?.installedVersion
              ? t("Installed: {installed} · Pion verified: {verified}", {
                  installed: setupStatus.installedVersion,
                  verified: setupStatus.verifiedVersion,
                })
              : t("Pi setup required")
          }
        />
        <StatTile
          label={t("Pion App")}
          tone="orange"
          icon={<Icon name="download" size={15} />}
          value={appUpdate.state.currentVersion || "—"}
          caption={appUpdate.state.updateVersion ? `→ ${appUpdate.state.updateVersion}` : undefined}
        />
        <StatTile
          label={t("Pi models")}
          tone="purple"
          icon={<Icon name="cube" size={15} />}
          value={setupStatus?.models?.length ?? 0}
          caption={
            setupStatus?.selectedModel
              ? `${setupStatus.selectedModel.provider}/${setupStatus.selectedModel.id}`
              : undefined
          }
        />
      </StatGrid>
      <section
        className={`${componentClass(styles, "settings-card")} ${componentClass(managementStyles, "span-12")}`}
      >
        <h2>
          <Icon name="palette" size={16} />
          {t("Appearance and display")}
        </h2>
        <div className={componentClass(styles, "appearance-grid")}>
          <label className={componentClass(styles, "language-setting")}>
            {t("Language")}
            <Select
              label={t("Language")}
              value={locale}
              onChange={(value) => action("core.locale", value)}
              options={[
                { value: "zh-CN", label: "简体中文 (zh-CN)" },
                { value: "en", label: "English (en-US)" },
              ]}
            />
            <span className={`settings-note ${utilityStyles.settingsNote}`}>
              {t(
                "Choose the display language. Changes apply immediately and are saved on this device.",
              )}
            </span>
          </label>
          <fieldset className={componentClass(styles, "theme-setting")}>
            <legend>{t("Theme")}</legend>
            <div className={componentClass(styles, "theme-choices")}>
              {(["light", "dark", "system"] as const).map((value) => (
                <label key={value} className={componentClass(styles, "theme-choice")}>
                  <input
                    type="radio"
                    name="theme"
                    value={value}
                    checked={themePreference === value}
                    onChange={() => setTheme(value)}
                  />
                  <span
                    className={`${componentClass(styles, "theme-preview")} ${componentClass(styles, `theme-preview-${value}`)}`}
                    aria-hidden="true"
                  >
                    <span className={styles.previewSidebar} />
                    <span className={styles.previewContent}>
                      <span />
                      <span />
                      <span />
                    </span>
                  </span>
                  <span className={styles.themeLabel}>
                    <Icon
                      name={value === "dark" ? "moon" : value === "light" ? "sun" : "monitor"}
                      size={15}
                    />
                    {t(value === "dark" ? "Dark" : value === "light" ? "Light" : "Follow system")}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
        </div>
      </section>
      <section
        className={`${componentClass(styles, "settings-card")} ${componentClass(managementStyles, "span-12")}`}
      >
        <h2>
          <Icon name="terminal" size={16} />
          {t("Task defaults")}
        </h2>
        <div className={componentClass(styles, "setting-row")}>
          <div>
            <strong>{t("Message while running")}</strong>
            <span>
              {t(
                "Default for messages sent while Pi is working. You can switch it above the composer during a run.",
              )}
            </span>
          </div>
          <Segmented
            label={t("Message while running")}
            value={runMode}
            onChange={(mode) => {
              saveRunMode(mode);
              setRunMode(mode);
            }}
            options={[
              { value: "steer", label: t("Steer") },
              { value: "follow_up", label: t("Follow-up") },
            ]}
          />
        </div>
      </section>
      <section
        className={`${componentClass(styles, "settings-card")} ${componentClass(managementStyles, "span-7")}`}
      >
        <h2>
          <Icon name="terminal" size={16} />
          {t("Pi runtime")}
        </h2>
        <p className="muted">
          {t("Pion starts your installed Pi with its existing model and authentication settings.")}
        </p>
        <section
          className={componentClass(styles, "pi-scan")}
          aria-label={t("Detected Pi installations")}
          aria-busy={piScanning}
        >
          <div className={componentClass(styles, "pi-scan-head")}>
            <span>{t("Detected Pi installations")}</span>
            <button
              type="button"
              disabled={piScanning || !native}
              onClick={() => setPiScanRevision((revision) => revision + 1)}
            >
              {t(piScanning ? "Scanning…" : "Scan again")}
            </button>
          </div>
          <p className="muted">
            {t("Choose a detected path or enter your own below. Save settings to apply.")}
          </p>
          {piScanError && (
            <p className="error" role="alert">
              {piScanError}
            </p>
          )}
          {!!piCandidates.length && (
            <div className={componentClass(styles, "pi-scan-list")}>
              {piCandidates.map((candidate) => {
                const chosen = executable === candidate.executable;
                return (
                  <button
                    key={candidate.executable}
                    type="button"
                    className={`${componentClass(styles, "pi-scan-item")} ${chosen ? componentClass(styles, "selected") : ""}`}
                    title={candidate.executable}
                    aria-pressed={chosen}
                    onClick={() => setExecutable(candidate.executable)}
                  >
                    <code>{candidate.executable}</code>
                    <small>v{candidate.version}</small>
                    <span>{chosen ? t("Selected") : t("Use")}</span>
                  </button>
                );
              })}
            </div>
          )}
          <div role="status">
            {piScanning && <p className="muted">{t("Scanning…")}</p>}
            {!piScanning && !piCandidates.length && !piScanError && (
              <p className="muted">
                {t(
                  native
                    ? "No Pi installation found. Enter the executable path manually."
                    : "Pi scanning requires the desktop app.",
                )}
              </p>
            )}
          </div>
        </section>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            setPiOperation("runtime");
            action("core.settings.save");
          }}
        >
          <label>
            {t("Pi executable")}
            <Input
              value={executable}
              placeholder={t("pi or an absolute executable path")}
              onChange={(event) => setExecutable(event.target.value)}
              required
            />
          </label>
          <p className={`settings-note ${utilityStyles.settingsNote}`}>
            {t(
              "Connecting trusts the selected workspace and its Pi extensions. Pi runs with your user permissions. Tested with Pi 0.87.0.",
            )}
          </p>
          <div className={`button-row ${utilityStyles.buttonRow} ${styles.runtimeActions}`}>
            <button
              type="button"
              disabled={busy || setupBusy || !native}
              onClick={() => {
                setPiOperation("runtime");
                void refreshSetup().catch((error) => runtime.notice("Pi", String(error)));
              }}
            >
              {t("Test connection")}
            </button>
            <Button variant="primary" className="primary" disabled={busy || !native} type="submit">
              {t("Save settings")}
            </Button>
            <button
              type="button"
              className={styles.disconnect}
              disabled={busy || !connected}
              onClick={() => action("core.disconnect")}
            >
              {t("Disconnect")}
            </button>
          </div>
        </form>
        {setupError && piOperation === "runtime" && (
          <p className="error" role="alert">
            {setupError}
          </p>
        )}
      </section>
      <section
        className={`${componentClass(styles, "settings-card")} ${componentClass(managementStyles, "span-5")}`}
      >
        <h2>
          <Icon name="download" size={16} />
          {t("Versions and updates")}
        </h2>
        <PionUpdateSection update={appUpdate} />
        <PiVersionSection
          setupStatus={setupStatus}
          setupBusy={setupBusy}
          setupProgress={setupProgress}
          versionStatus={versionStatus}
          setupError={piOperation === "update" ? setupError : ""}
          checkPiUpdate={() => {
            setPiOperation("update");
            return checkPiUpdate();
          }}
          updatePi={() => {
            setPiOperation("update");
            return updatePi();
          }}
        />
      </section>
      <section className={componentClass(styles, "legacy-sessions")}>
        <h2>{t("Import Pi CLI sessions")}</h2>
        <p className={`settings-note ${utilityStyles.settingsNote}`}>
          {t(
            "Copies selected sessions from ~/.pi/agent into Pion. The original files are not changed or kept in sync.",
          )}
        </p>
        <div className={`button-row ${utilityStyles.buttonRow}`}>
          <button
            type="button"
            disabled={busy || legacyLoading || !native}
            onClick={() =>
              loadLegacySessions().catch((error) => runtime.notice("Pi", String(error)))
            }
          >
            {t(legacyLoading ? "Scanning sessions…" : "Scan Pi sessions")}
          </button>
          <Button
            variant="primary"
            type="button"
            className="primary"
            disabled={busy || legacyLoading || !legacySelected.size}
            onClick={() =>
              importLegacySessions().catch((error) => runtime.notice("Pi", String(error)))
            }
          >
            {t("Import selected sessions")}
          </Button>
        </div>
        {!!legacySessions.length && (
          <div className={componentClass(styles, "legacy-session-list")}>
            {legacySessions.map((session) => (
              <label key={session.id}>
                <Checkbox
                  checked={legacySelected.has(session.id)}
                  onChange={(event) => {
                    const next = new Set(legacySelected);
                    if (event.target.checked) next.add(session.id);
                    else next.delete(session.id);
                    setLegacySelected(next);
                  }}
                />
                <span>
                  <strong>{session.title}</strong>
                  <small>
                    {session.projectPath} · {t("{count} messages", { count: session.messageCount })}
                  </small>
                </span>
              </label>
            ))}
          </div>
        )}
        {!legacyLoading && !legacySessions.length && (
          <p className="muted">{t("No scanned sessions.")}</p>
        )}
      </section>
    </main>
  );
}
