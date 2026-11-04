import utilityStyles from "../primitives/Utilities.module.css";
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
import styles from "./Settings.module.css";

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

  return (
    <main className={`${componentClass(managementStyles, "management")} settings`}>
      <header className={componentClass(styles, "page-heading")}>
        <h1>
          {t("Settings")} <span>/ Preferences</span>
        </h1>
        <p>{t("Manage appearance, language, and the Pi runtime.")}</p>
      </header>
      <section className={componentClass(styles, "settings-card")}>
        <h2>
          <Icon name="palette" size={16} />
          {t("Appearance and display")}
        </h2>
        <div className={componentClass(styles, "appearance-grid")}>
          <label className={componentClass(styles, "language-setting")}>
            {t("Language")}
            <select value={locale} onChange={(event) => action("core.locale", event.target.value)}>
              <option value="zh-CN">简体中文 (zh-CN)</option>
              <option value="en">English (en-US)</option>
            </select>
            <span className={`settings-note ${utilityStyles.settingsNote}`}>
              {t(
                "Choose the display language. Changes apply immediately and are saved on this device.",
              )}
            </span>
          </label>
          <div className={componentClass(styles, "theme-setting")}>
            <label>
              {t("Theme")}
              <select
                aria-label={t("Theme")}
                value={themePreference}
                onChange={(event) => setTheme(event.target.value as ThemePreference)}
              >
                <option value="dark">{t("Dark")}</option>
                <option value="system">{t("Follow system")}</option>
                <option value="light">{t("Light")}</option>
              </select>
            </label>
            <div className={componentClass(styles, "theme-choices")}>
              {(["dark", "system", "light"] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  className={themePreference === value ? componentClass(styles, "selected") : ""}
                  aria-pressed={themePreference === value}
                  onClick={() => setTheme(value)}
                >
                  <span
                    className={componentClass(styles, `theme-preview-${value}`)}
                    aria-hidden="true"
                  >
                    <Icon
                      name={value === "dark" ? "moon" : value === "light" ? "sun" : "monitor"}
                      size={15}
                    />
                  </span>
                  {t(value === "dark" ? "Dark" : value === "light" ? "Light" : "Follow system")}
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>
      <section className={componentClass(styles, "settings-card")}>
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
          <div className={`button-row ${utilityStyles.buttonRow}`}>
            <button
              type="button"
              disabled={busy || setupBusy || !native}
              onClick={() => refreshSetup().catch((error) => runtime.notice("Pi", String(error)))}
            >
              {t("Test connection")}
            </button>
            <Button variant="primary" className="primary" disabled={busy || !native} type="submit">
              {t("Save settings")}
            </Button>
            <button
              type="button"
              disabled={busy || !connected}
              onClick={() => action("core.disconnect")}
            >
              {t("Disconnect")}
            </button>
          </div>
        </form>
      </section>
      {setupError && (
        <p className="error" role="alert">
          {setupError}
        </p>
      )}
      <PiVersionSection
        setupStatus={setupStatus}
        setupBusy={setupBusy}
        setupProgress={setupProgress}
        versionStatus={versionStatus}
        checkPiUpdate={checkPiUpdate}
        updatePi={updatePi}
      />
      <PionUpdateSection update={appUpdate} />
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
