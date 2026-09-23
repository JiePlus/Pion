import utilityStyles from "../primitives/Utilities.module.css";
import { componentClass } from "../componentClass.ts";
import { native } from "../../core/host.ts";
import type { PiSetupStatus } from "../../core/host.ts";
import { t } from "../../core/i18n.ts";
import styles from "./PiVersionSection.module.css";
import { Button } from "../primitives/Button.tsx";

interface PiVersionSectionProps {
  setupStatus: PiSetupStatus | null;
  setupBusy: boolean;
  setupProgress: string;
  versionStatus: PiSetupStatus | null;
  checkPiUpdate: () => Promise<void>;
  updatePi: () => Promise<void>;
}

export function PiVersionSection({
  setupStatus,
  setupBusy,
  setupProgress,
  versionStatus,
  checkPiUpdate,
  updatePi,
}: PiVersionSectionProps) {
  return (
    <section className={componentClass(styles, "pi-version-section")}>
      <h2>{t("Pi version")}</h2>
      <p className={`settings-note ${utilityStyles.settingsNote}`}>
        {t("Installed: {installed} · Pion verified: {verified}", {
          installed: setupStatus?.installedVersion ?? "—",
          verified: setupStatus?.verifiedVersion ?? "—",
        })}
      </p>
      <div className={`button-row ${utilityStyles.buttonRow}`}>
        <Button
          variant="outline"
          type="button"
          disabled={setupBusy || !native}
          onClick={() => void checkPiUpdate()}
        >
          {t("Check Pi updates")}
        </Button>
        {versionStatus?.canUpdate && (
          <Button
            variant="primary"
            type="button"
            disabled={setupBusy}
            onClick={() => void updatePi()}
          >
            {t("Update Pi to {version}", { version: versionStatus.verifiedVersion })}
          </Button>
        )}
      </div>
      {setupBusy && <p role="status">{setupProgress}</p>}
      {versionStatus?.latestVersion && (
        <p className={`settings-note ${utilityStyles.settingsNote}`} role="status">
          {t("Official latest: {version}", { version: versionStatus.latestVersion })}
          {versionStatus.latestVersion !== versionStatus.verifiedVersion &&
            ` · ${t("This release has not been verified with Pion yet.")}`}
          {!versionStatus.npmManaged &&
            versionStatus.installation === "ready" &&
            ` · ${t("Only global npm installations can be updated here.")}`}
        </p>
      )}
      {versionStatus?.installation === "ready" && !versionStatus.npmManaged && (
        <p className={`settings-note ${utilityStyles.settingsNote}`}>
          <a href="https://pi.dev/docs/latest/cli" target="_blank" rel="noreferrer">
            {t("Manual Pi update guide")}
          </a>
        </p>
      )}
    </section>
  );
}
