import { useCallback, useEffect, useRef, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { check } from "@tauri-apps/plugin-updater";
import type { Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { native } from "../../core/host.ts";
import { t } from "../../core/i18n.ts";

export type AppUpdatePhase =
  "idle" | "checking" | "available" | "downloading" | "ready" | "installing" | "current" | "error";

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
  /** Installation succeeded, but relaunch may still need to be retried. */
  installed: boolean;
  /** Total update size in bytes, when the server reports it. */
  total?: number;
  /** Human-readable failure from the last check or install attempt. */
  error?: string;
  /** Check for updates when Pion starts. */
  autoCheck: boolean;
  /** Download available updates in the background; installation requires a restart. */
  autoInstall: boolean;
}

export interface AppUpdateController {
  state: AppUpdateState;
  checkForUpdate: (manual?: boolean) => Promise<void>;
  downloadUpdate: () => Promise<void>;
  restart: () => Promise<void>;
  setAutoCheck: (value: boolean) => void;
  setAutoInstall: (value: boolean) => void;
}

const AUTO_CHECK_KEY = "pion.updates.autoCheck";
// Keep the existing preference key when changing from immediate install to staging.
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

/** Stage updates without interrupting the session; install only on an explicit restart. */
export function useAppUpdate(
  notify?: (title: string, message: string) => void,
): AppUpdateController {
  const [state, setState] = useState<AppUpdateState>(() => ({
    phase: "idle",
    currentVersion: "",
    downloaded: 0,
    installed: false,
    autoCheck: readFlag(AUTO_CHECK_KEY, true),
    autoInstall: readFlag(AUTO_INSTALL_KEY, true),
  }));
  const pending = useRef<Update | null>(null);
  const checking = useRef(false);
  const downloading = useRef(false);
  const installing = useRef(false);
  const staged = useRef(false);
  const installed = useRef(false);
  const mounted = useRef(true);
  const autoCheckRef = useRef(state.autoCheck);
  const autoInstallRef = useRef(state.autoInstall);

  const downloadUpdate = useCallback(async () => {
    const update = pending.current;
    if (!native || !update || downloading.current || installing.current || staged.current) return;
    downloading.current = true;
    setState((current) => ({
      ...current,
      phase: "downloading",
      downloaded: 0,
      total: undefined,
      error: undefined,
    }));
    try {
      await update.download((event) => {
        if (event.event === "Started") {
          setState((current) => ({ ...current, total: event.data.contentLength }));
        } else if (event.event === "Progress") {
          setState((current) => ({
            ...current,
            downloaded: current.downloaded + event.data.chunkLength,
          }));
        }
      });
      staged.current = true;
      setState((current) => ({ ...current, phase: "ready" }));
      if (mounted.current) notify?.("Pion", t("Update downloaded — restart Pion to install."));
    } catch (error) {
      setState((current) => ({ ...current, phase: "error", error: String(error) }));
    } finally {
      downloading.current = false;
      if (!mounted.current) {
        pending.current = null;
        void update.close().catch(() => {});
      }
    }
  }, [notify]);

  const checkForUpdate = useCallback(
    async (manual = false) => {
      if (
        !native ||
        checking.current ||
        downloading.current ||
        installing.current ||
        staged.current ||
        installed.current
      )
        return;
      checking.current = true;
      setState((current) => ({
        ...current,
        phase: "checking",
        error: undefined,
        updateVersion: undefined,
        notes: undefined,
        releasedAt: undefined,
      }));
      try {
        const stale = pending.current;
        pending.current = null;
        if (stale) await stale.close().catch(() => {});
        const update = await check();
        if (!mounted.current) {
          if (update) void update.close().catch(() => {});
          return;
        }
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
        if (!manual && autoInstallRef.current) await downloadUpdate();
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
    [downloadUpdate],
  );

  const restart = useCallback(async () => {
    if (
      !native ||
      installing.current ||
      downloading.current ||
      (!staged.current && !installed.current)
    )
      return;
    installing.current = true;
    setState((current) => ({ ...current, phase: "installing", error: undefined }));
    try {
      const update = pending.current;
      if (!installed.current && update) {
        // Windows may exit here; never invoke installation without this explicit action.
        await update.install();
        installed.current = true;
        setState((current) => ({ ...current, installed: true }));
        staged.current = false;
        pending.current = null;
        await update.close().catch(() => {});
      }
      await relaunch();
    } catch (error) {
      // Keep the staged package, or the completed install, so restarting can be retried.
      setState((current) => ({ ...current, phase: "ready", error: String(error) }));
    } finally {
      installing.current = false;
      if (!mounted.current && pending.current) {
        void pending.current.close().catch(() => {});
        pending.current = null;
      }
    }
  }, []);

  const setAutoCheck = useCallback((value: boolean) => {
    autoCheckRef.current = value;
    writeFlag(AUTO_CHECK_KEY, value);
    setState((current) => ({ ...current, autoCheck: value }));
  }, []);

  const setAutoInstall = useCallback((value: boolean) => {
    autoInstallRef.current = value;
    writeFlag(AUTO_INSTALL_KEY, value);
    setState((current) => ({ ...current, autoInstall: value }));
  }, []);

  useEffect(() => {
    if (!native) return;
    mounted.current = true;
    void getVersion()
      .then((version) => {
        if (mounted.current) setState((current) => ({ ...current, currentVersion: version }));
      })
      .catch(() => {});
    if (autoCheckRef.current) void checkForUpdate(false);
    return () => {
      mounted.current = false;
      if (!downloading.current && !installing.current && pending.current) {
        void pending.current.close().catch(() => {});
        pending.current = null;
      }
    };
    // Run once on mount; background checks read the latest preference refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { state, checkForUpdate, downloadUpdate, restart, setAutoCheck, setAutoInstall };
}
