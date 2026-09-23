import type { Dispatch, SetStateAction } from "react";
import type { Task } from "../../../core/host.ts";
import { t } from "../../../core/i18n.ts";
import type { useTasks } from "../../hooks/useTasks.ts";
import { componentClass } from "../../componentClass.ts";
import type { Page } from "../types.ts";
import styles from "./Rail.module.css";

interface TaskListProps {
  items: Task[];
  tasks: ReturnType<typeof useTasks>;
  page: Page;
  setPage: Dispatch<SetStateAction<Page>>;
  busy: boolean;
  connected: boolean;
  perform: (work: () => Promise<unknown>) => void;
}

export function TaskList({ items, tasks, page, setPage, busy, connected, perform }: TaskListProps) {
  const { task, taskStatuses, openTask } = tasks;
  return (
    <div className={componentClass(styles, "task-list")}>
      {items.map((item) => {
        const itemStatus = taskStatuses.get(item.id);
        return (
          <button
            key={item.id}
            title={item.title}
            className={
              task?.id === item.id && page === "workspace" ? componentClass(styles, "selected") : ""
            }
            disabled={busy}
            onClick={() => {
              if (task?.id === item.id && connected) setPage("workspace");
              else perform(() => openTask({ task: item }));
            }}
          >
            <span className={componentClass(styles, "task-title")}>
              {item.title || t("New task")}
            </span>
            {itemStatus === "working" && (
              <span
                className={`${componentClass(styles, "task-state")} ${componentClass(styles, "working")}`}
                aria-hidden="true"
              />
            )}
            {item.unread && itemStatus !== "working" && (
              <span
                className={componentClass(styles, "unread-mark")}
                role="status"
                aria-label={t("Unread completed task")}
              />
            )}
          </button>
        );
      })}
    </div>
  );
}
