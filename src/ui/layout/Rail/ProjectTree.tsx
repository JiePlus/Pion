import { useState, type Dispatch, type SetStateAction } from "react";
import { t } from "../../../core/i18n.ts";
import type { useTasks } from "../../hooks/useTasks.ts";
import { componentClass } from "../../componentClass.ts";
import { Icon } from "../../primitives/Icon.tsx";
import type { Page } from "../types.ts";
import { TaskList } from "./TaskList.tsx";
import styles from "./Rail.module.css";

// How many chats a project shows before its history is contracted behind a
// "show more" control. Keeps one busy project from flooding the whole sidebar.
const TASK_PREVIEW_LIMIT = 8;

interface ProjectTreeProps {
  tasks: ReturnType<typeof useTasks>;
  page: Page;
  setPage: Dispatch<SetStateAction<Page>>;
  busy: boolean;
  connected: boolean;
  railCollapsed: boolean;
  clearExtensionUi: () => void;
  perform: (work: () => Promise<unknown>) => void;
}

export function ProjectTree({
  tasks,
  page,
  setPage,
  busy,
  connected,
  railCollapsed,
  clearExtensionUi,
  perform,
}: ProjectTreeProps) {
  const {
    catalog,
    projectId,
    task,
    setTask,
    setProjectId,
    taskStatuses,
    taskFilter,
    taskQuery,
    collapsedProjects,
    toggleProject,
    taskMatches,
  } = tasks;
  const [expandedHistories, setExpandedHistories] = useState<Set<string>>(new Set());
  function toggleHistory(id: string) {
    setExpandedHistories((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  return (
    <div className={componentClass(styles, "project-tree")}>
      {!catalog.projects.length && <p className="muted">{t("Add a project folder to start.")}</p>}
      {catalog.projects.map((project, index) => {
        const projectTasks = catalog.tasks.filter(
          (item) => item.projectId === project.id && taskMatches(item),
        );
        if ((taskQuery || taskFilter !== "all") && !projectTasks.length) return null;
        const projectRunning = catalog.tasks.filter(
          (item) => item.projectId === project.id && taskStatuses.get(item.id) === "working",
        ).length;
        const collapsed = collapsedProjects.has(project.id);
        const filtered = taskQuery !== "" || taskFilter !== "all";
        const historyExpanded = expandedHistories.has(project.id);
        let visibleTasks = projectTasks;
        if (!filtered && !historyExpanded && projectTasks.length > TASK_PREVIEW_LIMIT) {
          visibleTasks = projectTasks.slice(0, TASK_PREVIEW_LIMIT);
          // Never hide the task that is currently open in this project.
          if (task && task.projectId === project.id) {
            const selectedIndex = projectTasks.findIndex((item) => item.id === task.id);
            if (selectedIndex >= TASK_PREVIEW_LIMIT) {
              visibleTasks = projectTasks.slice(0, selectedIndex + 1);
            }
          }
        }
        const hiddenTaskCount = projectTasks.length - visibleTasks.length;
        const initial = Array.from(project.name.trim())[0]?.toUpperCase() ?? "?";
        return (
          <section key={project.id} className={componentClass(styles, "project-group")}>
            <div className={componentClass(styles, "project-row")}>
              <button
                title={`${project.name} — ${project.path}`}
                aria-label={project.name}
                className={
                  project.id === projectId ? componentClass(styles, "selected-project") : ""
                }
                disabled={busy}
                aria-expanded={
                  railCollapsed || window.matchMedia("(max-width: 850px)").matches
                    ? undefined
                    : !collapsed
                }
                aria-current={project.id === projectId ? "true" : undefined}
                onClick={() => {
                  if (railCollapsed || window.matchMedia("(max-width: 850px)").matches) {
                    setProjectId(project.id);
                    setTask(null);
                    clearExtensionUi();
                    setPage("workspace");
                  } else toggleProject(project.id);
                }}
              >
                <span className={componentClass(styles, "disclosure")} aria-hidden="true">
                  <Icon name={collapsed ? "chevron-right" : "chevron-down"} size={14} />
                </span>
                <span
                  className={`${componentClass(styles, "project-initials")} ${componentClass(styles, `project-color-${index % 6}`)}`}
                  aria-hidden="true"
                >
                  {initial}
                </span>
                <span className={componentClass(styles, "project-name")}>{project.name}</span>
                <small
                  title={[
                    t("{count} tasks", { count: projectTasks.length }),
                    ...(projectRunning ? [t("{count} running", { count: projectRunning })] : []),
                  ].join(" · ")}
                >
                  {projectTasks.length}
                </small>
              </button>
              <button
                aria-label={t("New task in {project}", { project: project.name })}
                disabled={busy}
                onClick={() => {
                  setProjectId(project.id);
                  setTask(null);
                  clearExtensionUi();
                  setPage("workspace");
                }}
              >
                <Icon name="plus" size={16} />
              </button>
            </div>
            {!collapsed && (
              <>
                <TaskList
                  items={visibleTasks}
                  tasks={tasks}
                  page={page}
                  setPage={setPage}
                  busy={busy}
                  connected={connected}
                  perform={perform}
                />
                {!filtered && projectTasks.length > TASK_PREVIEW_LIMIT && (
                  <button
                    type="button"
                    className={componentClass(styles, "task-list-more")}
                    disabled={busy}
                    aria-expanded={historyExpanded}
                    onClick={() => toggleHistory(project.id)}
                  >
                    {historyExpanded
                      ? t("Show less")
                      : t("Show {count} more", { count: hiddenTaskCount })}
                  </button>
                )}
              </>
            )}
          </section>
        );
      })}
      {!!catalog.projects.length &&
        (taskQuery || taskFilter !== "all") &&
        !catalog.tasks.some(taskMatches) && (
          <p className={`muted ${componentClass(styles, "task-empty")}`}>
            {t("No tasks match this view.")}
          </p>
        )}
    </div>
  );
}
