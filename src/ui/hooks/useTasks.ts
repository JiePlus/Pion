import { useState } from "react";
import { host } from "../../core/host.ts";
import type { Catalog, Project, Task } from "../../core/host.ts";
import type { ImageAttachment } from "../../core/attachments.ts";
import { setAttachmentDraft } from "../../core/attachments.ts";
import type { Runtime } from "../../core/runtime.ts";

export type TaskFilter = "all" | "running" | "attention";
export type TaskStatus = "working" | "idle" | "disconnected";

function readCollapsedProjects(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem("pion.collapsedProjects") ?? "[]"));
  } catch {
    return new Set();
  }
}

interface TaskOptions {
  catalog: Catalog;
  runtime: Runtime;
  executable: string;
  draftModels: { provider: string; id: string }[];
  draftModel: string;
  draftThinking: string;
  draftToolPreset: string;
  onStart: () => void;
  onBeforeOpen: (previous: Task | null, next: Task) => void;
  onOpenFailed: (previous: Task | null) => void;
  onProjectAdded: () => void;
}

const LAST_TASK = "pion.lastTask";

/** The task that was open when Pion last ran, if any. */
export function readLastTask(): string | null {
  try {
    return localStorage.getItem(LAST_TASK);
  } catch {
    return null;
  }
}

export function useTasks(options: TaskOptions) {
  const initialCatalog = options.catalog;
  const [catalog, setCatalog] = useState(initialCatalog);
  const [projectId, setProjectId] = useState(initialCatalog.projects[0]?.id ?? "");
  const [task, setTask] = useState<Task | null>(null);
  const [taskStatuses, setTaskStatuses] = useState(new Map<string, TaskStatus>());
  const [opening, setOpening] = useState(false);
  const [initialPrompt, setInitialPrompt] = useState<{ taskId: string; text: string } | null>(null);
  const [taskFilter, setTaskFilter] = useState<TaskFilter>("all");
  const [taskQuery, setTaskQuery] = useState("");
  const [collapsedProjects, setCollapsedProjects] = useState(readCollapsedProjects);

  async function openTask(intent: {
    projectId?: string;
    text?: string;
    images?: ImageAttachment[];
    task?: Task;
  }) {
    const previous = task;
    const previousProjectId = projectId;
    options.onStart();
    setOpening(true);
    try {
      let next = intent.task;
      const creating = !next;
      if (!next) {
        const created = await host<{ catalog: Catalog; task: Task }>({
          op: "task.create",
          projectId: intent.projectId,
          title: intent.text,
        });
        setCatalog(created.catalog);
        next = created.task;
        if (intent.text) localStorage.setItem(`pion.draft.${next.id}`, intent.text);
        if (intent.images?.length) setAttachmentDraft(next.id, intent.images);
      }
      options.onBeforeOpen(previous, next);
      setTask(next);
      setProjectId(next.projectId);
      setInitialPrompt(
        creating && (intent.text !== undefined || intent.images?.length)
          ? { taskId: next.id, text: intent.text ?? "" }
          : null,
      );
      const model = options.draftModels.find(
        (item) => `${item.provider}/${item.id}` === options.draftModel,
      );
      const opened = await host<{ catalog: Catalog; reused: boolean }>({
        op: "task.open",
        id: next.id,
        executable: options.executable,
        ...(creating && model ? { model: { provider: model.provider, modelId: model.id } } : {}),
        ...(creating && options.draftThinking ? { thinkingLevel: options.draftThinking } : {}),
      });
      if (creating) {
        try {
          await host({
            op: "pi",
            command: "set_tool_preset",
            args: { preset: options.draftToolPreset },
          });
        } catch (error) {
          options.runtime.notice("Pi", String(error));
        }
      }
      setCatalog(opened.catalog);
      setTask(opened.catalog.tasks.find((item) => item.id === next.id) ?? next);
      try {
        localStorage.setItem(LAST_TASK, next.id);
      } catch {
        // Startup then shows the new-task page instead of this task.
      }
    } catch (error) {
      setTask(previous);
      setProjectId(previousProjectId);
      setInitialPrompt(null);
      options.onOpenFailed(previous);
      throw error;
    } finally {
      setOpening(false);
    }
  }

  async function addProject() {
    const result = await host<{ catalog: Catalog; project: Project } | null>({ op: "project.add" });
    if (result) {
      setCatalog(result.catalog);
      setProjectId(result.project.id);
      setTask(null);
      options.onProjectAdded();
      options.onStart();
    }
  }

  function toggleProject(id: string) {
    setCollapsedProjects((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      localStorage.setItem("pion.collapsedProjects", JSON.stringify([...next]));
      return next;
    });
  }

  function taskMatches(item: Task) {
    if (taskQuery && !item.title.toLowerCase().includes(taskQuery.toLowerCase())) return false;
    const taskStatus = taskStatuses.get(item.id);
    if (taskFilter === "running") return taskStatus === "working";
    if (taskFilter === "attention") return item.unread;
    return true;
  }

  return {
    catalog,
    setCatalog,
    projectId,
    setProjectId,
    task,
    setTask,
    taskStatuses,
    setTaskStatuses,
    opening,
    initialPrompt,
    setInitialPrompt,
    openTask,
    addProject,
    taskFilter,
    setTaskFilter,
    taskQuery,
    setTaskQuery,
    collapsedProjects,
    setCollapsedProjects,
    toggleProject,
    taskMatches,
  };
}
