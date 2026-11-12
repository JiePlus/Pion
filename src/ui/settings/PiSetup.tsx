import utilityStyles from "../primitives/Utilities.module.css";
import { Button } from "../primitives/Button.tsx";
import managementStyles from "./Management.module.css";
import { componentClass } from "../componentClass.ts";
import type { Dispatch, SetStateAction } from "react";
import type { PiSetupStatus } from "../../core/host.ts";
import { t } from "../../core/i18n.ts";
import { ModelPicker } from "../layout/Topbar/ModelPicker.tsx";
import { ModelSettings } from "../settings/ModelSettings.tsx";
import { BrandMark } from "../primitives/BrandMark.tsx";
import styles from "./PiSetup.module.css";

interface PiSetupProps {
  setupStatus: PiSetupStatus | null;
  piInstalled: boolean;
  setupBusy: boolean;
  setupProgress: string;
  setupError: string;
  setupPathExpanded: boolean;
  setSetupPathExpanded: Dispatch<SetStateAction<boolean>>;
  executable: string;
  setExecutable: Dispatch<SetStateAction<string>>;
  installPi: () => Promise<void>;
  savePiPath: () => Promise<void>;
  setupModel: { provider: string; id: string } | null;
  setSetupModel: Dispatch<SetStateAction<{ provider: string; id: string } | null>>;
  refreshSetup: (model?: { provider: string; id: string } | null) => Promise<void>;
  action: (id: string, args?: string) => void;
}

export function PiSetup({
  setupStatus,
  piInstalled,
  setupBusy,
  setupProgress,
  setupError,
  setupPathExpanded,
  setSetupPathExpanded,
  executable,
  setExecutable,
  installPi,
  savePiPath,
  setupModel,
  setSetupModel,
  refreshSetup,
  action,
}: PiSetupProps) {
  return (
    <main
      className={`${componentClass(managementStyles, "management")} ${componentClass(styles, "pi-setup")}`}
    >
      <div className={componentClass(styles, "pi-setup-layout")}>
        <aside className={componentClass(styles, "pi-setup-intro")}>
          <div className={componentClass(styles, "pi-setup-title-block")}>
            <BrandMark size={54} />
            <span className={componentClass(styles, "pi-setup-kicker")}>
              Pion / {t("Pi setup")}
            </span>
            <h1>{t("Set up Pi")}</h1>
            <p>
              {t(
                "Pion needs an installed Pi and a model with working authentication before starting a task.",
              )}
            </p>
          </div>
          <ol className={componentClass(styles, "pi-setup-progress")} aria-label={t("Pi setup")}>
            <li className={componentClass(styles, piInstalled ? "complete" : "current")}>
              <span className={componentClass(styles, "pi-setup-progress-mark")} aria-hidden="true">
                {piInstalled ? "✓" : "01"}
              </span>
              <span>
                <strong>{t("Install Pi")}</strong>
                <small>
                  {!setupStatus
                    ? t("Checking Pi…")
                    : piInstalled
                      ? t("Pi {version} is installed.", {
                          version: setupStatus.installedVersion ?? "",
                        })
                      : setupStatus.installation === "broken"
                        ? t("The configured Pi executable could not start.")
                        : t("Pi was not found on this computer.")}
                </small>
              </span>
            </li>
            <li className={componentClass(styles, piInstalled ? "current" : "pending")}>
              <span className={componentClass(styles, "pi-setup-progress-mark")} aria-hidden="true">
                02
              </span>
              <span>
                <strong>{t("Choose a model")}</strong>
                <small>
                  {piInstalled
                    ? t("Choose a model and connect its provider below.")
                    : t("Available after Pi installation")}
                </small>
              </span>
            </li>
          </ol>
        </aside>
        <div className={componentClass(styles, "pi-setup-content")}>
          {setupBusy && (
            <div className={componentClass(styles, "pi-setup-working")} role="status">
              <span>{setupProgress}</span>
              <span
                className={componentClass(styles, "pi-setup-working-track")}
                aria-hidden="true"
              />
            </div>
          )}
          {setupError && (
            <p className={componentClass(styles, "pi-setup-error")} role="alert">
              {setupError}
            </p>
          )}
          {!setupBusy && !setupError && setupStatus?.detail && (
            <p className={componentClass(styles, "pi-setup-error")} role="alert">
              {setupStatus.detail}
            </p>
          )}
          {setupStatus && (
            <section
              className={`${componentClass(styles, "pi-setup-step")} ${componentClass(styles, piInstalled ? "complete" : "active")}`}
            >
              <div className={componentClass(styles, "pi-setup-step-heading")}>
                <span className={componentClass(styles, "pi-setup-step-index")}>01 / PI</span>
                <h2>{t("Install Pi")}</h2>
                <p>
                  {piInstalled
                    ? t("Pi {version} is installed.", {
                        version: setupStatus.installedVersion ?? "",
                      })
                    : setupStatus?.installation === "broken"
                      ? t("The configured Pi executable could not start.")
                      : t("Pi was not found on this computer.")}
                </p>
              </div>
              {piInstalled ? (
                <div className={componentClass(styles, "pi-setup-installed")}>
                  <code title={setupStatus.executable}>{setupStatus.executable}</code>
                  <button type="button" onClick={() => setSetupPathExpanded((open) => !open)}>
                    {t("Change Pi path")}
                  </button>
                </div>
              ) : (
                <div className={componentClass(styles, "pi-setup-install")}>
                  <Button
                    variant="primary"
                    type="button"
                    className="primary"
                    disabled={setupBusy || !setupStatus?.canInstall}
                    onClick={() => void installPi()}
                  >
                    {t("Install Pi globally")}
                  </Button>
                  <p className={`settings-note ${utilityStyles.settingsNote}`}>
                    {t("Global installation requires Node.js 22.19+ and npm.")}{" "}
                    <a
                      href="https://pi.dev/docs/latest/quickstart"
                      target="_blank"
                      rel="noreferrer"
                    >
                      {t("Pi installation guide")}
                    </a>
                  </p>
                </div>
              )}
              {(!piInstalled || setupPathExpanded) && (
                <form
                  className={componentClass(styles, "pi-setup-path-form")}
                  onSubmit={(event) => {
                    event.preventDefault();
                    void savePiPath();
                  }}
                >
                  <label>
                    {t("Pi executable")}
                    <input
                      value={executable}
                      onChange={(event) => setExecutable(event.target.value)}
                      placeholder={t("pi or an absolute executable path")}
                      required
                    />
                  </label>
                  <button type="submit" disabled={setupBusy}>
                    {t("Check this path")}
                  </button>
                </form>
              )}
            </section>
          )}
          {piInstalled && setupStatus && (
            <section
              className={`${componentClass(styles, "pi-setup-step")} ${componentClass(styles, "active")} ${componentClass(styles, "pi-setup-model-step")}`}
            >
              <div className={componentClass(styles, "pi-setup-step-heading")}>
                <span className={componentClass(styles, "pi-setup-step-index")}>02 / MODEL</span>
                <h2>{t("Choose a model")}</h2>
                <p>
                  {setupStatus.modelReady
                    ? t("The selected model is ready to use.")
                    : t(
                        "Choose a model and connect its provider below. Pion checks authentication without sending a model request.",
                      )}
                </p>
              </div>
              {!!setupStatus.models?.length && (
                <div className={componentClass(styles, "pi-setup-model-choice")}>
                  <span>{t("Model")}</span>
                  <ModelPicker
                    models={setupStatus.models}
                    value={setupModel ? `${setupModel.provider}/${setupModel.id}` : ""}
                    disabled={setupBusy}
                    onChange={(value) => {
                      const separator = value.indexOf("/");
                      const model = {
                        provider: value.slice(0, separator),
                        id: value.slice(separator + 1),
                      };
                      setSetupModel(model);
                      void refreshSetup(model);
                    }}
                  />
                  <button
                    type="button"
                    disabled={setupBusy}
                    onClick={() => void refreshSetup(setupModel)}
                  >
                    {t("Check model again")}
                  </button>
                </div>
              )}
              {!setupStatus.modelReady && (
                <div className={componentClass(styles, "pi-setup-auth")}>
                  <ModelSettings
                    embedded
                    onPackages={() => action("core.navigate", "packages")}
                    onChanged={() => void refreshSetup(setupModel)}
                  />
                </div>
              )}
            </section>
          )}
        </div>
      </div>
    </main>
  );
}
