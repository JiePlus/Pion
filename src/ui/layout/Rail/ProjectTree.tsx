import type { Dispatch, SetStateAction } from "react";
import { t } from "../../../core/i18n.ts";
import type { useTasks } from "../../hooks/useTasks.ts";
import { componentClass } from "../../componentClass.ts";
import { Icon } from "../../primitives/Icon.tsx";
import type { Page } from "../types.ts";
import { TaskList } from "./TaskList.tsx";
import styles from "./Rail.module.css";

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
    setTask,
    setProjectId,
    taskStatuses,
    taskFilter,
    taskQuery,
    collapsedProjects,
    toggleProject,
    taskMatches,
  } = tasks;
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
                <small>{projectRunning || projectTasks.length}</small>
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
              <TaskList
                items={projectTasks}
                tasks={tasks}
                page={page}
                setPage={setPage}
                busy={busy}
                connected={connected}
                perform={perform}
              />
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
