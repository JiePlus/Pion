import { componentClass } from "../componentClass.ts";
import { t } from "../../core/i18n.ts";
import type { TaskFilter } from "../hooks/useTasks.ts";
import styles from "./TaskGlance.module.css";

// Big counters on the new-task page double as shortcuts into the sidebar filter.
export function TaskGlance({
  running,
  attention,
  total,
  filter,
  onFilter,
}: {
  running: number;
  attention: number;
  total: number;
  filter: TaskFilter;
  onFilter: (filter: TaskFilter) => void;
}) {
  const items = [
    ["running", "Running", running, "blue"],
    ["attention", "Attention", attention, "orange"],
    ["all", "All", total, "ink"],
  ] as const;
  return (
    <div
      className={componentClass(styles, "task-glance")}
      role="group"
      aria-label={t("Task overview")}
    >
      {items.map(([value, label, count, tone]) => (
        <button
          key={value}
          type="button"
          className={filter === value ? componentClass(styles, "selected") : ""}
          aria-pressed={filter === value}
          onClick={() => onFilter(value)}
        >
          <span className={componentClass(styles, "glance-label")}>{t(label)}</span>
          <span
            className={`${componentClass(styles, "glance-number")} ${componentClass(styles, tone)}`}
          >
            {count}
          </span>
        </button>
      ))}
    </div>
  );
}
