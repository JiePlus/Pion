import { componentClass } from "../componentClass.ts";
import { t } from "../../core/i18n.ts";
import managementStyles from "./Management.module.css";
import { Card, PageHero } from "./PageKit.tsx";
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
      <PageHero
        eyebrow="Keyboard"
        title={t("Keyboard shortcuts")}
        description={t("Keyboard shortcuts for common actions.")}
        stat={{ value: shortcuts.length, caption: "shortcuts", tone: "blue" }}
      />
      <Card icon="keyboard" title={t("Common actions")} headingId="common-actions-heading">
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
      </Card>
    </main>
  );
}
