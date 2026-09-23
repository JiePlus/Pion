import { createRoot } from "react-dom/client";
import { connectEvents, host } from "./core/host.ts";
import type { Boot } from "./core/host.ts";
import { i18n, t } from "./core/i18n.ts";
import { Runtime } from "./core/runtime.ts";
import { applyTheme, readThemePreference } from "./core/theme.ts";
import { Shell } from "./ui/Shell.tsx";
import "./style.css";

applyTheme(readThemePreference());

async function start() {
  document.documentElement.lang = i18n.getLocale();
  const root = createRoot(document.getElementById("root")!);
  try {
    await connectEvents();
    const boot = await host<Boot>({ op: "boot" });
    // Agent Chat was bundled in 0.1/0.2. Pi's base conversation is now part of Core.
    boot.plugins = boot.plugins.filter((record) => record.bundle.manifest.id !== "agent-chat");
    const runtime = new Runtime();
    for (const record of boot.plugins) {
      try {
        runtime.load(record.bundle, record.enabled);
      } catch (error) {
        runtime.notice("Desktop", t("Plugin rejected: {error}", { error: String(error) }));
      }
    }
    root.render(<Shell runtime={runtime} boot={boot} />);
  } catch (error) {
    root.render(
      <main className="startup-error">
        <h1>{t("Pion could not start")}</h1>
        <p>{String(error)}</p>
        <button onClick={() => location.reload()}>{t("Retry")}</button>
      </main>,
    );
  }
}
void start();
