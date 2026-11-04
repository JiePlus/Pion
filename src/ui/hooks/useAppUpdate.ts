import { useCallback, useEffect, useRef, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { check } from "@tauri-apps/plugin-updater";
import type { Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { native } from "../../core/host.ts";
import { t } from "../../core/i18n.ts";

export type AppUpdatePhase =
  "idle" | "checking" | "available" | "downloading" | "ready" | "current" | "error";

export interface AppUpdateState {
  /** Current update workflow phase. */
  phase: AppUpdatePhase;
  /** Version of the running Pion build. */
  currentVersion: string;
  /** Version announced by the update endpoint, when one is available. */
  updateVersion?: string;
  /** Release notes announced by the endpoint. */
  notes?: string;
  /** Release date announced by the endpoint. */
  releasedAt?: string;
  /** Bytes downloaded so far during the current update. */
  downloaded: number;
  /** Total update size in bytes, when the server reports it. */
  total?: number;
  /** Human-readable failure from the last check or install attempt. */
  error?: string;
  /** Check for updates when Pion starts. */
  autoCheck: boolean;
  /** Download and install available updates silently in the background. */
  autoInstall: boolean;
}

export interface AppUpdateController {
  state: AppUpdateState;
  checkForUpdate: (manual?: boolean) => Promise<void>;
  installUpdate: () => Promise<void>;
  restart: () => Promise<void>;
  setAutoCheck: (value: boolean) => void;
  setAutoInstall: (value: boolean) => void;
}

const AUTO_CHECK_KEY = "pion.updates.autoCheck";
const AUTO_INSTALL_KEY = "pion.updates.autoInstall";

function readFlag(key: string, fallback: boolean): boolean {
  try {
    const value = localStorage.getItem(key);
    return value === null ? fallback : value === "on";
  } catch {
    return fallback;
  }
}

function writeFlag(key: string, value: boolean) {
  try {
    localStorage.setItem(key, value ? "on" : "off");
  } catch {
    /* Storage may be unavailable. */
  }
}

/**
 * Drives Pion's own updater: a manual check, plus the silent background flow that
 * downloads and installs a release so it takes effect the next time the app starts.
 */
export function useAppUpdate(
  notify?: (title: string, message: string) => void,
): AppUpdateController {
  const [state, setState] = useState<AppUpdateState>(() => ({
    phase: "idle",
    currentVersion: "",
    downloaded: 0,
    autoCheck: readFlag(AUTO_CHECK_KEY, true),
    autoInstall: readFlag(AUTO_INSTALL_KEY, true),
  }));
  const pending = useRef<Update | null>(null);
  const checking = useRef(false);
  const installing = useRef(false);
  const autoCheckRef = useRef(state.autoCheck);
  const autoInstallRef = useRef(state.autoInstall);

  useEffect(() => {
    autoCheckRef.current = state.autoCheck;
    autoInstallRef.current = state.autoInstall;
  }, [state.autoCheck, state.autoInstall]);

  const installUpdate = useCallback(async () => {
    const update = pending.current;
    if (!native || !update || installing.current) return;
    installing.current = true;
    setState((current) => ({
      ...current,
      phase: "downloading",
      downloaded: 0,
      total: undefined,
      error: undefined,
    }));
    try {
      await update.downloadAndInstall((event) => {
        if (event.event === "Started") {
          setState((current) => ({ ...current, total: event.data.contentLength }));
        } else if (event.event === "Progress") {
          setState((current) => ({
            ...current,
            downloaded: current.downloaded + event.data.chunkLength,
          }));
        }
      });
      pending.current = null;
      setState((current) => ({ ...current, phase: "ready", updateVersion: update.version }));
      notify?.("Pion", t("Update installed — restart Pion to finish."));
    } catch (error) {
      setState((current) => ({ ...current, phase: "error", error: String(error) }));
    } finally {
      installing.current = false;
    }
  }, [notify]);

  const checkForUpdate = useCallback(
    async (manual = false) => {
      if (!native || checking.current) return;
      checking.current = true;
      setState((current) => ({ ...current, phase: "checking", error: undefined }));
      try {
        // Release the previous manifest resource so repeated checks do not leak it.
        const stale = pending.current;
        pending.current = null;
        if (stale) stale.close().catch(() => {});
        const update = await check();
        pending.current = update;
        if (!update) {
          setState((current) => ({ ...current, phase: "current" }));
          return;
        }
        setState((current) => ({
          ...current,
          phase: "available",
          updateVersion: update.version,
          notes: update.body,
          releasedAt: update.date,
          downloaded: 0,
          total: undefined,
        }));
        // The silent path: when auto-install is on, download and install now; the update
        // applies the next time Pion starts without blocking the current session.
        if (!manual && autoInstallRef.current) await installUpdate();
      } catch (error) {
        setState((current) => ({
          ...current,
          phase: manual ? "error" : "idle",
          error: manual ? String(error) : undefined,
        }));
      } finally {
        checking.current = false;
      }
    },
    [installUpdate],
  );

  const restart = useCallback(async () => {
    if (!native) return;
    await relaunch();
  }, []);

  const setAutoCheck = useCallback((value: boolean) => {
    writeFlag(AUTO_CHECK_KEY, value);
    setState((current) => ({ ...current, autoCheck: value }));
  }, []);

  const setAutoInstall = useCallback((value: boolean) => {
    writeFlag(AUTO_INSTALL_KEY, value);
    setState((current) => ({ ...current, autoInstall: value }));
  }, []);

  useEffect(() => {
    if (!native) return;
    let cancelled = false;
    void getVersion()
      .then((version) => {
        if (!cancelled) setState((current) => ({ ...current, currentVersion: version }));
      })
      .catch(() => {});
    if (autoCheckRef.current) {
      void (async () => {
        await checkForUpdate(false);
        if (cancelled && pending.current) {
          pending.current.close().catch(() => {});
          pending.current = null;
        }
      })();
    }
    return () => {
      cancelled = true;
    };
    // Run once on mount; the silent flow re-reads preferences through refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { state, checkForUpdate, installUpdate, restart, setAutoCheck, setAutoInstall };
}
