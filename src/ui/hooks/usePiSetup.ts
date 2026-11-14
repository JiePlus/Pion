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
const SETUP_CACHE = "pion.setupStatus";

/** The last setup check that passed for this Pi executable, if any. */
export function readCachedSetup(executable: string): PiSetupStatus | null {
  try {
    const cached = JSON.parse(localStorage.getItem(SETUP_CACHE) ?? "null") as {
      executable?: string;
      status?: PiSetupStatus;
    } | null;
    const status = cached?.status;
    return cached?.executable === executable &&
      status?.installation === "ready" &&
      status.modelReady &&
      status.selectedModel
      ? status
      : null;
  } catch {
    return null;
  }
}

function saveCachedSetup(executable: string, status: PiSetupStatus) {
  try {
    if (status.installation === "ready" && status.modelReady && status.selectedModel)
      localStorage.setItem(SETUP_CACHE, JSON.stringify({ executable, status }));
    else localStorage.removeItem(SETUP_CACHE);
  } catch {
    // Without the cache the next start runs the full check.
  }
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
      saveCachedSetup(result.executable ?? candidateExecutable, result);
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

  // Confirms a remembered setup without starting a throwaway Pi: Pi still runs and
  // the model is still signed in. Anything else falls back to the full check.
  async function verifyCachedSetup(cached: PiSetupStatus) {
    try {
      const result = await host<PiSetupStatus>({
        op: "pi_setup.status",
        executable,
        model: cached.selectedModel,
        quick: true,
      });
      if (
        result.installation === "ready" &&
        result.modelReady &&
        result.executable === executable
      ) {
        const status = { ...cached, ...result, models: cached.models };
        setSetupStatus(status);
        saveCachedSetup(executable, status);
        return;
      }
    } catch {
      // Fall through to the full check, which reports the problem.
    }
    await refreshSetup(cached.selectedModel ?? null);
  }

  useEffect(() => {
    if (!native) return;
    const cached = readCachedSetup(executable);
    if (!cached) {
      void refreshSetup();
      return;
    }
    // Start from the last good check so the workspace connects Pi right away.
    setSetupStatus(cached);
    setSetupModel(cached.selectedModel ?? null);
    void verifyCachedSetup(cached);
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
