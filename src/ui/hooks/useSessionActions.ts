import { useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { host } from "../../core/host.ts";
import type { Catalog, Task } from "../../core/host.ts";
import { t } from "../../core/i18n.ts";
import type { SessionHistoryEntry } from "../../core/session-tree.ts";

interface SessionOptions {
  task: Task | null;
  setTask: Dispatch<SetStateAction<Task | null>>;
  setCatalog: Dispatch<SetStateAction<Catalog>>;
  setInitialPrompt: Dispatch<SetStateAction<{ taskId: string; text: string } | null>>;
  clearExtensionUi: () => void;
}

export function useSessionActions({
  task,
  setTask,
  setCatalog,
  setInitialPrompt,
  clearExtensionUi,
}: SessionOptions) {
  const [sessionBusy, setSessionBusy] = useState(false);
  const [history, setHistory] = useState<{
    items: SessionHistoryEntry[];
    leafId: string | null;
    forks: { entryId: string; text: string }[];
  } | null>(null);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  async function openHistory() {
    setSessionBusy(true);
    try {
      setHistory(
        await host<{
          items: SessionHistoryEntry[];
          leafId: string | null;
          forks: { entryId: string; text: string }[];
        }>({ op: "session.history" }),
      );
    } finally {
      setSessionBusy(false);
    }
  }

  async function branch(kind: "fork" | "clone", entryId?: string) {
    if (!task) return;
    setSessionBusy(true);
    clearExtensionUi();
    try {
      const result = await host<{
        cancelled: boolean;
        catalog?: Catalog;
        task?: Task;
        text?: string;
      }>({
        op: "session.branch",
        kind,
        entryId,
        title: `${kind === "fork" ? t("Fork") : t("Clone")}: ${task.title}`,
      });
      if (result.cancelled || !result.catalog || !result.task) return;
      setCatalog(result.catalog);
      setTask(result.task);
      setHistory(null);
      setInitialPrompt(null);
      if (result.text) localStorage.setItem(`pion.draft.${result.task.id}`, result.text);
    } finally {
      setSessionBusy(false);
    }
  }

  async function renameTask() {
    if (!task) return;
    setSessionBusy(true);
    try {
      const result = await host<{ catalog: Catalog; task: Task }>({
        op: "task.rename",
        id: task.id,
        name: renameValue,
      });
      setCatalog(result.catalog);
      setTask(result.task);
      setRenameOpen(false);
    } finally {
      setSessionBusy(false);
    }
  }
  return {
    sessionBusy,
    setSessionBusy,
    history,
    setHistory,
    renameOpen,
    setRenameOpen,
    renameValue,
    setRenameValue,
    openHistory,
    branch,
    renameTask,
  };
}
