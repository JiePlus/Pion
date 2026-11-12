import { componentClass } from "../componentClass.ts";
import managementStyles from "./Management.module.css";
import { Card, EmptyState, PageHero } from "./PageKit.tsx";
import type { Dispatch, SetStateAction } from "react";
import type { Json } from "../../core/api.ts";
import { native } from "../../core/host.ts";
import type { Installed } from "../../core/host.ts";
import { localized, t } from "../../core/i18n.ts";
import type { Runtime } from "../../core/runtime.ts";

interface PluginsProps {
  installed: Installed[];
  runtime: Runtime;
  path: string;
  setPath: Dispatch<SetStateAction<string>>;
  busy: boolean;
  action: (id: string, args?: Json) => void;
}

export function Plugins({ installed, runtime, path, setPath, busy, action }: PluginsProps) {
  return (
    <main className={componentClass(managementStyles, "management")}>
      <PageHero
        eyebrow="Desktop plugins"
        title={t("Plugins")}
        description={t(
          "Install a local plugin, review its permissions, and make this space yours.",
        )}
        stat={{ value: installed.length, caption: "installed", tone: "blue" }}
        actions={
          <button type="button" onClick={() => action("core.navigate", "panels")}>
            {t("Manage extension panels")}
          </button>
        }
      />
      <Card span={5} icon="puzzle" eyebrow="Review & install">
        <form
          className={componentClass(managementStyles, "install-form")}
          onSubmit={(event) => {
            event.preventDefault();
            action("core.review", path);
          }}
        >
          <label>
            {t("Local plugin folder or ZIP")}
            <input
              placeholder="/path/to/my-plugin"
              value={path}
              onChange={(event) => setPath(event.target.value)}
            />
          </label>
          <button type="submit" disabled={busy || !path || !native}>
            {t("Review installation")}
          </button>
        </form>
      </Card>
      <Card
        span={7}
        icon="puzzle"
        title={t("Installed plugins")}
        headingId="installed-plugins-heading"
      >
        {!installed.length && (
          <EmptyState icon="puzzle">{t("No plugins installed yet.")}</EmptyState>
        )}
        {installed.map((record) => {
          const m = record.bundle.manifest;
          const state = runtime.plugins.get(m.id);
          return (
            <article className={componentClass(managementStyles, "plugin-card")} key={m.id}>
              <div>
                <h2>
                  {localized(m.name, m.nameI18n)} <small>{m.version}</small>
                </h2>
                <p>
                  {m.id} ·{" "}
                  <span className={state?.state === "crashed" ? "error" : ""}>
                    {state ? t(state.state) : ""}
                  </span>
                </p>
                <p className="permission-summary">
                  {m.permissions.join(" · ") || t("No permissions")}
                </p>
                {state?.error && (
                  <p role="alert" className="error">
                    {state.error}
                  </p>
                )}
              </div>
              <div className={componentClass(managementStyles, "card-actions")}>
                <button
                  disabled={busy}
                  onClick={() =>
                    action("core.plugin", {
                      id: m.id,
                      action: record.enabled ? "disable" : "enable",
                    })
                  }
                >
                  {t(record.enabled ? "Disable" : "Enable")}
                </button>
                <button
                  disabled={busy}
                  onClick={() => action("core.plugin", { id: m.id, action: "reload" })}
                >
                  {t("Reload")}
                </button>
                <button
                  disabled={busy}
                  onClick={() => action("core.plugin", { id: m.id, action: "remove" })}
                >
                  {t("Uninstall")}
                </button>
              </div>
            </article>
          );
        })}
      </Card>
    </main>
  );
}
