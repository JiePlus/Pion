import { componentClass } from "../componentClass.ts";
import { t } from "../../core/i18n.ts";
import managementStyles from "./Management.module.css";
import styles from "./Settings.module.css";

export function Shortcuts() {
  const modifier = /Mac/.test(navigator.platform) ? "⌘" : "Ctrl+";
  const shortcuts = [
    [t("New task"), `${modifier}N`],
    [t("Command palette"), `${modifier}K`],
    [t("Send message"), "Enter"],
    [t("Insert new line"), "Shift+Enter"],
    [t("Close menu or dialog"), "Esc"],
  ];

  return (
    <main className={componentClass(managementStyles, "management")}>
      <header className={componentClass(styles, "page-heading")}>
        <h1>{t("Keyboard shortcuts")}</h1>
        <p>{t("Keyboard shortcuts for common actions.")}</p>
      </header>
      <section className={componentClass(styles, "settings-card")}>
        <h2>{t("Common actions")}</h2>
        <dl className={componentClass(styles, "shortcut-list")}>
          {shortcuts.map(([label, keys]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>
                <kbd>{keys}</kbd>
              </dd>
            </div>
          ))}
        </dl>
      </section>
    </main>
  );
}
