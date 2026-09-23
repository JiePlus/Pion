import { componentClass } from "../componentClass.ts";
import managementStyles from "./Management.module.css";
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
      <h1>{t("Plugins")}</h1>
      <p className="muted">
        {t("Install a local plugin, review its permissions, and make this space yours.")}
      </p>
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
      <h3>{t("Installed plugins")}</h3>
      {!installed.length && <p className="muted">{t("No plugins installed yet.")}</p>}
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
    </main>
  );
}
