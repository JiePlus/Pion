import { useEffect, useRef } from "react";
import type { Dispatch, SetStateAction } from "react";
import { DevReloader } from "../../core/dev-reload.ts";
import { host, native } from "../../core/host.ts";
import type { Installed } from "../../core/host.ts";
import { t } from "../../core/i18n.ts";
import type { Runtime } from "../../core/runtime.ts";

const INTERVAL = 1000;

// Reloads plugins linked for development when their folder changes on disk.
export function useDevReload(
  runtime: Runtime,
  installed: Installed[],
  setInstalled: Dispatch<SetStateAction<Installed[]>>,
) {
  const latest = useRef(installed);
  latest.current = installed;
  useEffect(() => {
    if (!native) return;
    const reloader = new DevReloader({
      poll: (id) => host<Installed | null>({ op: "dev.poll", id }),
      // Disable, unlink and uninstall unload the plugin first, so skip it then.
      wanted: (id) => {
        const state = runtime.plugins.get(id)?.state;
        return state !== undefined && state !== "disabled";
      },
      apply: (record) => {
        const id = record.bundle.manifest.id;
        setInstalled((records) => records.map((r) => (r.bundle.manifest.id === id ? record : r)));
        try {
          runtime.load(record.bundle);
        } catch (error) {
          runtime.notice(id, t("Plugin rejected: {error}", { error: String(error) }));
        }
      },
      report: (id, error) => runtime.notice(id, t("Development reload failed: {error}", { error })),
    });
    const timer = setInterval(() => {
      if (!document.hidden) void reloader.tick(latest.current);
    }, INTERVAL);
    return () => clearInterval(timer);
  }, [runtime, setInstalled]);
}
