import { useEffect, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { Json, Locale, Location } from "../../core/api.ts";
import { host } from "../../core/host.ts";
import type { Installed } from "../../core/host.ts";
import { i18n, t } from "../../core/i18n.ts";
import type { Runtime } from "../../core/runtime.ts";
import type { Page } from "../layout/types.ts";
import type { useLayout } from "./useLayout.ts";

interface CoreCommandsOptions {
  runtime: Runtime;
  installed: Installed[];
  setInstalled: Dispatch<SetStateAction<Installed[]>>;
  executable: string;
  working: boolean;
  setPage: Dispatch<SetStateAction<Page>>;
  setPalette: Dispatch<SetStateAction<boolean>>;
  setReview: Dispatch<SetStateAction<Installed | null>>;
  refreshSetup: () => Promise<void>;
  updatePanel: ReturnType<typeof useLayout>["updatePanel"];
}

export function useCoreCommands({
  runtime,
  installed,
  setInstalled,
  executable,
  working,
  setPage,
  setPalette,
  setReview,
  refreshSetup,
  updatePanel,
}: CoreCommandsOptions) {
  const locked = useRef(false);
  const [busy, setBusy] = useState(false);
  function perform(work: () => Promise<unknown>) {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    work()
      .catch((error) => runtime.notice("Pion", String(error)))
      .finally(() => {
        locked.current = false;
        setBusy(false);
      });
  }
  useEffect(() => {
    const dispose = [
      runtime.commands.register("core", "core.locale", async (args) => {
        i18n.setLocale(args as Locale);
        return null;
      }),
      runtime.commands.register("core", "core.navigate", async (args) => {
        setPage(args as Page);
        return null;
      }),
      runtime.commands.register("core", "core.palette", async () => {
        setPalette((value) => !value);
        return null;
      }),
      runtime.commands.register("core", "core.review", async (args) => {
        setReview(await host<Installed>({ op: "review", path: args }));
        return null;
      }),
      runtime.commands.register("core", "core.review.cancel", async () => {
        setReview(null);
        return null;
      }),
      runtime.commands.register("core", "core.approve", async (args) => {
        const record = args as unknown as Installed;
        await host({ op: "approve", digest: record.digest });
        runtime.load(record.bundle);
        setInstalled((records) => [
          ...records.filter((r) => r.bundle.manifest.id !== record.bundle.manifest.id),
          record,
        ]);
        setReview(null);
        return null;
      }),
      runtime.commands.register("core", "core.plugin", async (args) => {
        const { id, action } = args as { id: string; action: string };
        const record = installed.find((r) => r.bundle.manifest.id === id);
        if (!record) throw new Error(t("Plugin unavailable"));
        runtime.unload(id);
        if (action === "remove") {
          await host({ op: "remove", id });
          runtime.forget(id);
          setInstalled((records) => records.filter((r) => r.bundle.manifest.id !== id));
        } else {
          const enabled = action !== "disable";
          await host({ op: "enable", id, enabled });
          setInstalled((records) => records.map((r) => (r === record ? { ...r, enabled } : r)));
          runtime.load(record.bundle, enabled);
        }
        return null;
      }),
      runtime.commands.register("core", "core.settings.save", async () => {
        await host({ op: "settings.save", executable });
        await refreshSetup();
        runtime.notice("Pion", t("Settings saved. They apply when the next task opens."));
        return null;
      }),
      runtime.commands.register("core", "core.disconnect", async () => {
        await host({ op: "disconnect" });
        return null;
      }),
      runtime.commands.register("core", "core.layout", async (args) => {
        const { id, location, hidden, collapsed } = args as {
          id: string;
          location?: Location;
          hidden?: boolean;
          collapsed?: boolean;
        };
        updatePanel(id, {
          ...(location ? { location } : {}),
          ...(hidden === undefined ? {} : { hidden }),
          ...(collapsed === undefined ? {} : { collapsed }),
        });
        return null;
      }),
      runtime.commands.register("core", "core.dismiss", async (args) => {
        runtime.dismiss(Number(args));
        return null;
      }),
    ];
    return () => dispose.forEach((fn) => fn());
  }, [runtime, installed, executable, working]);

  async function run(id: string, args?: Json): Promise<Json> {
    try {
      return await runtime.commands.execute(id, args);
    } catch (error) {
      runtime.notice("Desktop", String(error));
      throw error;
    }
  }
  function action(id: string, args?: Json) {
    perform(() => runtime.commands.execute(id, args));
  }
  return { busy, setBusy, locked, perform, run, action };
}
