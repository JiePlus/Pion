import { createRoot } from "react-dom/client";
import { connectEvents, host } from "./core/host.ts";
import type { Boot } from "./core/host.ts";
import { i18n, t } from "./core/i18n.ts";
import { Runtime } from "./core/runtime.ts";
import { applyTheme, readThemePreference } from "./core/theme.ts";
import { Shell } from "./ui/layout/Shell.tsx";
import startupStyles from "./ui/layout/StartupError.module.css";
import "@fontsource/outfit/300.css";
import "@fontsource/outfit/700.css";
import "@fontsource/outfit/800.css";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/500.css";
import "./ui/theme/tokens.css";
import "./ui/theme/themes.css";
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
    root.render(<Shell runtime={runtime} boot={boot} />);
    // Plugins start after the first frame, so their sandboxes never delay the window.
    requestAnimationFrame(() =>
      setTimeout(() => {
        for (const record of boot.plugins) {
          try {
            runtime.load(record.bundle, record.enabled);
          } catch (error) {
            runtime.notice("Desktop", t("Plugin rejected: {error}", { error: String(error) }));
          }
        }
      }),
    );
  } catch (error) {
    root.render(
      <main className={startupStyles.startupError}>
        <h1>{t("Pion could not start")}</h1>
        <p>{String(error)}</p>
        <button onClick={() => location.reload()}>{t("Retry")}</button>
      </main>,
    );
  }
}
void start();
