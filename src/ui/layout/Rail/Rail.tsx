import { StatusDot } from "../../primitives/StatusDot.tsx";
import { Button } from "../../primitives/Button.tsx";
import { componentClass } from "../../componentClass.ts";
import type { Dispatch, SetStateAction } from "react";
import type { Json } from "../../../core/api.ts";
import { native } from "../../../core/host.ts";
import { t } from "../../../core/i18n.ts";
import type { useTasks } from "../../hooks/useTasks.ts";
import type { Page } from "../types.ts";
import pionMark from "../../../../src-tauri/icon.svg";
import styles from "./Rail.module.css";
import { ProjectTree } from "./ProjectTree.tsx";

interface RailProps {
  tasks: ReturnType<typeof useTasks>;
  page: Page;
  setPage: Dispatch<SetStateAction<Page>>;
  busy: boolean;
  connected: boolean;
  railCollapsed: boolean;
  toggleRail: () => void;
  taskBrowserOpen: boolean;
  setTaskBrowserOpen: Dispatch<SetStateAction<boolean>>;
  runningCount: number;
  attentionCount: number;
  clearExtensionUi: () => void;
  perform: (work: () => Promise<unknown>) => void;
  action: (id: string, args?: Json) => void;
}

export function Rail({
  tasks,
  page,
  setPage,
  busy,
  connected,
  railCollapsed,
  toggleRail,
  taskBrowserOpen,
  setTaskBrowserOpen,
  runningCount,
  attentionCount,
  clearExtensionUi,
  perform,
  action,
}: RailProps) {
  const { catalog, task, setTask, taskFilter, setTaskFilter, taskQuery, setTaskQuery, addProject } =
    tasks;
  return (
    <aside className={componentClass(styles, "rail")}>
      <div className={componentClass(styles, "rail-header")}>
        <div className={componentClass(styles, "brand")}>
          <img src={pionMark} alt="" />
          <strong>Pion</strong>
        </div>
        <Button
          variant="icon"
          className={`icon-button ${componentClass(styles, "rail-toggle")}`}
          type="button"
          aria-label={t(railCollapsed ? "Show sidebar" : "Hide sidebar")}
          title={t(railCollapsed ? "Show sidebar" : "Hide sidebar")}
          onClick={toggleRail}
        >
          {railCollapsed ? "›" : "‹"}
        </Button>
      </div>
      <nav aria-label={t("Main navigation")}>
        <button
          className={`${componentClass(styles, "new-task-button")} ${!task && page === "workspace" ? componentClass(styles, "selected") : ""}`}
          disabled={busy}
          onClick={() => {
            setTask(null);
            clearExtensionUi();
            setPage("workspace");
          }}
        >
          <span aria-hidden="true">＋</span>
          <span>{t("New task")}</span>
        </button>
        <button
          className={page === "models" ? componentClass(styles, "selected") : ""}
          aria-label={t("Pi models")}
          title={t("Pi models")}
          onClick={() => action("core.navigate", "models")}
        >
          <span aria-hidden="true">◇</span>
          <span>{t("Pi models")}</span>
        </button>
      </nav>
      <div className={componentClass(styles, "project-heading")}>
        <span>{t("Projects")}</span>
        <div className={componentClass(styles, "project-actions")}>
          <Button
            variant="icon"
            className={`icon-button ${
              taskBrowserOpen || taskQuery || taskFilter !== "all"
                ? componentClass(styles, "selected")
                : ""
            }`}
            aria-label={t("Search tasks")}
            title={t("Search tasks")}
            aria-expanded={taskBrowserOpen}
            aria-controls="task-browser-controls"
            onClick={() => setTaskBrowserOpen((open) => !open)}
          >
            ⌕
          </Button>
          <Button
            variant="icon"
            className="icon-button"
            aria-label={t("Add project")}
            title={t("Add project")}
            disabled={busy || !native}
            onClick={() => perform(addProject)}
          >
            ＋
          </Button>
        </div>
      </div>
      {taskBrowserOpen && (
        <div id="task-browser-controls" className={componentClass(styles, "task-browser-controls")}>
          <label className={componentClass(styles, "task-search")}>
            <span aria-hidden="true">⌕</span>
            <span className="sr-only">{t("Search tasks")}</span>
            <input
              autoFocus
              aria-label={t("Search tasks")}
              value={taskQuery}
              placeholder={t("Search tasks")}
              onChange={(event) => setTaskQuery(event.target.value)}
            />
          </label>
          <div
            className={componentClass(styles, "task-filters")}
            role="group"
            aria-label={t("Filter tasks")}
          >
            {(["all", "running", "attention"] as const).map((filter) => (
              <button
                key={filter}
                type="button"
                className={taskFilter === filter ? componentClass(styles, "selected") : ""}
                aria-pressed={taskFilter === filter}
                onClick={() => setTaskFilter(filter)}
              >
                {t(filter === "all" ? "All" : filter === "running" ? "Running" : "Attention")}
                {filter === "running" && !!runningCount && <small>{runningCount}</small>}
                {filter === "attention" && !!attentionCount && <small>{attentionCount}</small>}
              </button>
            ))}
          </div>
        </div>
      )}
      <ProjectTree
        tasks={tasks}
        page={page}
        setPage={setPage}
        busy={busy}
        connected={connected}
        clearExtensionUi={clearExtensionUi}
        perform={perform}
      />
      <div className={componentClass(styles, "rail-bottom")}>
        <button
          className={
            page !== "workspace" && page !== "models" ? componentClass(styles, "selected") : ""
          }
          onClick={() => action("core.navigate", "settings")}
        >
          <span aria-hidden="true">⚙</span> {t("Settings")}
        </button>
        <div className={componentClass(styles, "runtime-label")}>
          <StatusDot offline={!connected} />
          <span>Pion</span> <span>Pi</span>
        </div>
      </div>
    </aside>
  );
}
