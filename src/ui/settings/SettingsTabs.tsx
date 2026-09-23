import { componentClass } from "../componentClass.ts";
import { t } from "../../core/i18n.ts";
import type { Page } from "../layout/types.ts";
import styles from "./SettingsTabs.module.css";

const sections = [
  ["settings", "General"],
  ["plugins", "Desktop plugins"],
  ["packages", "Pi packages"],
  ["skills", "Pi skills"],
  ["panels", "Extension panels"],
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
      {sections.map(([section, label]) => (
        <button
          key={section}
          className={page === section ? componentClass(styles, "selected") : ""}
          onClick={() => onNavigate(section)}
        >
          {t(label)}
        </button>
      ))}
    </nav>
  );
}
