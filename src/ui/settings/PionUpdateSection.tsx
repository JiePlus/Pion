import utilityStyles from "../primitives/Utilities.module.css";
import { componentClass } from "../componentClass.ts";
import { native } from "../../core/host.ts";
import { t } from "../../core/i18n.ts";
import type { AppUpdateController } from "../hooks/useAppUpdate.ts";
import { Button } from "../primitives/Button.tsx";
import { Checkbox } from "../primitives/Checkbox.tsx";
import { Icon } from "../primitives/Icon.tsx";
import styles from "./Settings.module.css";

export function PionUpdateSection({ update }: { update: AppUpdateController }) {
  const { state, checkForUpdate, installUpdate, restart, setAutoCheck, setAutoInstall } = update;
  const busy = state.phase === "checking" || state.phase === "downloading";
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
        {t("Pion can check for new releases and install them silently in the background.")}
      </p>
      <p className={`settings-note ${utilityStyles.settingsNote}`}>
        {t("Current version: {version}", { version: state.currentVersion || "—" })}
      </p>
      <div className={`button-row ${utilityStyles.buttonRow}`}>
        <Button
          variant="outline"
          type="button"
          disabled={!native || busy}
          onClick={() => void checkForUpdate(true)}
        >
          {t("Check for updates")}
        </Button>
        {state.phase === "available" && (
          <Button
            variant="primary"
            type="button"
            disabled={!native}
            onClick={() => void installUpdate()}
          >
            {t("Download and install")}
          </Button>
        )}
        {state.phase === "ready" && (
          <Button variant="primary" type="button" disabled={!native} onClick={() => void restart()}>
            {t("Restart Pion")}
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
        {state.phase === "ready" && <p>{t("Update installed — restart Pion to finish.")}</p>}
        {state.phase === "current" && <p>{t("Pion is up to date.")}</p>}
        {state.phase === "error" && (
          <p className="error" role="alert">
            {t("Update failed: {error}", { error: state.error ?? "" })}
          </p>
        )}
      </div>
      <label className={componentClass(styles, "update-option")}>
        <Checkbox
          checked={state.autoCheck}
          onChange={(event) => setAutoCheck(event.target.checked)}
        />
        {t("Automatically check for updates")}
      </label>
      <label className={componentClass(styles, "update-option")}>
        <Checkbox
          checked={state.autoInstall}
          onChange={(event) => setAutoInstall(event.target.checked)}
        />
        {t("Automatically download and install updates in the background")}
      </label>
      <p className={`settings-note ${utilityStyles.settingsNote}`}>
        {t(
          "Silent updates install in the background and take effect the next time Pion starts. You still choose when to restart.",
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
