import { componentClass } from "../componentClass.ts";
import { t } from "../../core/i18n.ts";
import { Icon } from "../primitives/Icon.tsx";
import type { Page } from "../layout/types.ts";
import styles from "./SettingsTabs.module.css";

// Every management page lives here, so the sidebar only carries tasks.
const sections = [
  ["settings", "General", "sliders"],
  ["models", "Model services", "cube"],
  ["packages", "Pi packages", "grid"],
  ["skills", "Pi skills", "bolt"],
  ["plugins", "Desktop plugins", "puzzle"],
  ["shortcuts", "Keyboard shortcuts", "keyboard"],
] as const;

export function SettingsTabs({
  page,
  onNavigate,
}: {
  page: Page;
  onNavigate: (page: Page) => void;
}) {
  const current = page === "panels" ? "plugins" : page;
  return (
    <nav className={componentClass(styles, "settings-tabs")} aria-label={t("Settings sections")}>
      {sections.map(([section, label, icon]) => (
        <button
          key={section}
          className={current === section ? componentClass(styles, "selected") : ""}
          aria-current={current === section ? "page" : undefined}
          onClick={() => onNavigate(section)}
        >
          <Icon name={icon} size={16} />
          {t(label)}
        </button>
      ))}
    </nav>
  );
}
