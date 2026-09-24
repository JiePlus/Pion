import { componentClass } from "../componentClass.ts";
import { t } from "../../core/i18n.ts";
import { Icon } from "../primitives/Icon.tsx";
import type { Page } from "../layout/types.ts";
import styles from "./SettingsTabs.module.css";

const sections = [
  ["settings", "General", "sliders"],
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
  return (
    <nav className={componentClass(styles, "settings-tabs")} aria-label={t("Settings sections")}>
      {sections.map(([section, label, icon]) => (
        <button
          key={section}
          className={page === section ? componentClass(styles, "selected") : ""}
          onClick={() => onNavigate(section)}
        >
          <Icon name={icon} size={15} />
          {t(label)}
        </button>
      ))}
    </nav>
  );
}
