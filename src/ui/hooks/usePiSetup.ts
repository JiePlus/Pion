import { useEffect, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { host, native } from "../../core/host.ts";
import type { PiSetupStatus } from "../../core/host.ts";
import { t } from "../../core/i18n.ts";
import type { Page } from "../layout/types.ts";

function defaultPiModel(): { provider: string; id: string } | null {
  const value = localStorage.getItem("pion.defaultModel") ?? "";
  const separator = value.indexOf("/");
  return separator > 0
    ? { provider: value.slice(0, separator), id: value.slice(separator + 1) }
    : null;
}
export function usePiSetup(initialExecutable: string, setPage: Dispatch<SetStateAction<Page>>) {
  const [executable, setExecutable] = useState(initialExecutable);
  const [setupStatus, setSetupStatus] = useState<PiSetupStatus | null>(null);
  const [setupModel, setSetupModel] = useState(defaultPiModel);
  const [setupBusy, setSetupBusy] = useState(false);
  const [setupPathExpanded, setSetupPathExpanded] = useState(false);
  const [setupProgress, setSetupProgress] = useState("");
  const [setupError, setSetupError] = useState("");
  const [versionStatus, setVersionStatus] = useState<PiSetupStatus | null>(null);
  async function refreshSetup(model = defaultPiModel(), candidateExecutable = executable) {
    if (!native) return;
    setSetupBusy(true);
    setSetupProgress(t("Checking Pi…"));
    setSetupError("");
    try {
      const result = await host<PiSetupStatus>({
        op: "pi_setup.status",
        executable: candidateExecutable,
        model,
      });
      setSetupStatus(result);
      if (result.detail) setSetupError(result.detail);
      if (
        result.installation === "ready" &&
        result.executable &&
        result.executable !== candidateExecutable
      ) {
        await host({ op: "settings.save", executable: result.executable });
        setExecutable(result.executable);
      }
      const selected = result.selectedModel ?? null;
      setSetupModel(selected);
      if (result.modelReady && selected) {
        localStorage.setItem("pion.defaultModel", `${selected.provider}/${selected.id}`);
        setPage((current) => (current === "setup" ? "workspace" : current));
      } else {
        setPage((current) => (current === "workspace" ? "setup" : current));
      }
    } catch (error) {
      setSetupError(String(error));
    } finally {
      setSetupBusy(false);
    }
  }

  async function savePiPath() {
    setSetupBusy(true);
    setSetupProgress(t("Checking Pi…"));
    setSetupError("");
    setVersionStatus(null);
    try {
      await host({ op: "settings.save", executable });
      await refreshSetup(setupModel);
    } catch (error) {
      setSetupError(String(error));
    } finally {
      setSetupBusy(false);
    }
  }

  async function installPi() {
    setSetupBusy(true);
    setSetupProgress(t("Installing Pi…"));
    setSetupError("");
    setVersionStatus(null);
    try {
      const result = await host<PiSetupStatus>({ op: "pi_setup.install", executable });
      if (result.executable) setExecutable(result.executable);
      await refreshSetup(setupModel, result.executable ?? executable);
    } catch (error) {
      setSetupError(String(error));
    } finally {
      setSetupBusy(false);
    }
  }

  async function checkPiUpdate() {
    setSetupBusy(true);
    setSetupProgress(t("Checking Pi updates…"));
    setSetupError("");
    setVersionStatus(null);
    try {
      setVersionStatus(await host<PiSetupStatus>({ op: "pi_setup.check_update", executable }));
    } catch (error) {
      setSetupError(String(error));
    } finally {
      setSetupBusy(false);
    }
  }

  async function updatePi() {
    setSetupBusy(true);
    setSetupProgress(t("Updating Pi…"));
    setSetupError("");
    try {
      const result = await host<PiSetupStatus>({ op: "pi_setup.update", executable });
      if (result.executable) setExecutable(result.executable);
      setVersionStatus(null);
      await refreshSetup(setupModel, result.executable ?? executable);
    } catch (error) {
      setSetupError(String(error));
    } finally {
      setSetupBusy(false);
    }
  }

  useEffect(() => {
    if (native) void refreshSetup();
  }, []);

  return {
    executable,
    setExecutable,
    setupStatus,
    setSetupStatus,
    setupModel,
    setSetupModel,
    setupBusy,
    setSetupBusy,
    setupPathExpanded,
    setSetupPathExpanded,
    setupProgress,
    setSetupProgress,
    setupError,
    setSetupError,
    versionStatus,
    setVersionStatus,
    refreshSetup,
    savePiPath,
    installPi,
    checkPiUpdate,
    updatePi,
  };
}
