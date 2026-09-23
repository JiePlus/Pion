import type { Dispatch, SetStateAction } from "react";
import { t } from "../../../core/i18n.ts";
import type { useTasks } from "../../hooks/useTasks.ts";
import { componentClass } from "../../componentClass.ts";
import type { Page } from "../types.ts";
import { TaskList } from "./TaskList.tsx";
import styles from "./Rail.module.css";

interface ProjectTreeProps {
  tasks: ReturnType<typeof useTasks>;
  page: Page;
  setPage: Dispatch<SetStateAction<Page>>;
  busy: boolean;
  connected: boolean;
  clearExtensionUi: () => void;
  perform: (work: () => Promise<unknown>) => void;
}

export function ProjectTree({
  tasks,
  page,
  setPage,
  busy,
  connected,
  clearExtensionUi,
  perform,
}: ProjectTreeProps) {
  const {
    catalog,
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
      {catalog.projects.map((project) => {
        const projectTasks = catalog.tasks.filter(
          (item) => item.projectId === project.id && taskMatches(item),
        );
        if ((taskQuery || taskFilter !== "all") && !projectTasks.length) return null;
        const projectRunning = catalog.tasks.filter(
          (item) => item.projectId === project.id && taskStatuses.get(item.id) === "working",
        ).length;
        const collapsed = collapsedProjects.has(project.id);
        return (
          <section key={project.id} className={componentClass(styles, "project-group")}>
            <div className={componentClass(styles, "project-row")}>
              <button
                title={project.path}
                disabled={busy}
                aria-expanded={!collapsed}
                onClick={() => toggleProject(project.id)}
              >
                <span className={componentClass(styles, "disclosure")} aria-hidden="true">
                  {collapsed ? "›" : "⌄"}
                </span>
                <span>{project.name}</span>
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
                ＋
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
      {!!catalog.projects.length && !catalog.tasks.some(taskMatches) && (
        <p className={`muted ${componentClass(styles, "task-empty")}`}>
          {t("No tasks match this view.")}
        </p>
      )}
    </div>
  );
}
