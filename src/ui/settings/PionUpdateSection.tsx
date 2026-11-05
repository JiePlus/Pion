import utilityStyles from "../primitives/Utilities.module.css";
import { componentClass } from "../componentClass.ts";
import { native } from "../../core/host.ts";
import { t } from "../../core/i18n.ts";
import type { AppUpdateController } from "../hooks/useAppUpdate.ts";
import { Button } from "../primitives/Button.tsx";
import { Switch } from "../primitives/Switch.tsx";
import { Icon } from "../primitives/Icon.tsx";
import styles from "./Settings.module.css";

export function PionUpdateSection({ update }: { update: AppUpdateController }) {
  const { state, checkForUpdate, downloadUpdate, restart, setAutoCheck, setAutoInstall } = update;
  const busy =
    state.phase === "checking" || state.phase === "downloading" || state.phase === "installing";
  const percent =
    state.total && state.total > 0
      ? Math.min(100, Math.round((state.downloaded / state.total) * 100))
      : undefined;

  return (
    <section className={componentClass(styles, "settings-card")}>
      <h2>
        <Icon name="download" size={16} />
        {t("Pion updates")}
      </h2>
      <p className="muted">
        {t("Pion can check for new releases and download them in the background.")}
      </p>
      <p className={`settings-note ${utilityStyles.settingsNote}`}>
        {t("Current version: {version}", { version: state.currentVersion || "—" })}
      </p>
      <div className={`button-row ${utilityStyles.buttonRow}`}>
        <Button
          variant="outline"
          type="button"
          disabled={!native || busy || state.phase === "ready"}
          onClick={() => void checkForUpdate(true)}
        >
          {t("Check for updates")}
        </Button>
        {(state.phase === "available" || (state.phase === "error" && state.updateVersion)) && (
          <Button
            variant="primary"
            type="button"
            disabled={!native}
            onClick={() => void downloadUpdate()}
          >
            {t("Download update")}
          </Button>
        )}
        {state.phase === "ready" && (
          <Button variant="primary" type="button" disabled={!native} onClick={() => void restart()}>
            {t(state.installed ? "Restart Pion" : "Install and restart Pion")}
          </Button>
        )}
      </div>
      <div className={componentClass(styles, "update-status")} role="status" aria-live="polite">
        {state.phase === "checking" && <p>{t("Checking for updates…")}</p>}
        {state.phase === "available" && (
          <p>{t("Update {version} is available.", { version: state.updateVersion ?? "—" })}</p>
        )}
        {state.phase === "downloading" && (
          <>
            <p>
              {percent === undefined
                ? t("Downloading update…")
                : t("Downloading update… {percent}%", { percent })}
            </p>
            <div
              className={componentClass(styles, "update-progress")}
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={percent ?? 0}
            >
              <span style={{ width: `${percent ?? 0}%` }} />
            </div>
          </>
        )}
        {state.phase === "ready" && (
          <p>
            {t(
              state.installed
                ? "Update installed — restart Pion to finish."
                : "Update downloaded — restart Pion to install.",
            )}
          </p>
        )}
        {state.phase === "installing" && <p>{t("Installing update and restarting Pion…")}</p>}
        {state.phase === "current" && <p>{t("Pion is up to date.")}</p>}
        {state.error && (
          <p className="error" role="alert">
            {t("Update failed: {error}", { error: state.error ?? "" })}
          </p>
        )}
      </div>
      <label className={componentClass(styles, "update-option")}>
        <Switch
          checked={state.autoCheck}
          aria-label={t("Automatically check for updates")}
          onClick={() => setAutoCheck(!state.autoCheck)}
        />
        {t("Automatically check for updates")}
      </label>
      <label className={componentClass(styles, "update-option")}>
        <Switch
          checked={state.autoInstall}
          aria-label={t("Automatically download updates in the background")}
          onClick={() => setAutoInstall(!state.autoInstall)}
        />
        {t("Automatically download updates in the background")}
      </label>
      <p className={`settings-note ${utilityStyles.settingsNote}`}>
        {t(
          "Updates download without interrupting your work. Choose Install and restart Pion when you are ready. Closing Pion before installing discards the download.",
        )}
      </p>
      {!native && (
        <p className={`settings-note ${utilityStyles.settingsNote}`}>
          {t("Checking for updates requires the desktop app.")}
        </p>
      )}
    </section>
  );
}
