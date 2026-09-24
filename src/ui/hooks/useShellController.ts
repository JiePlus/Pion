import { useEffect, useReducer, useRef, useState, useSyncExternalStore } from "react";
import {
  imageFailure,
  importImageFiles,
  pickImages,
  setAttachmentDraft,
} from "../../core/attachments.ts";
import type { ImageAttachment } from "../../core/attachments.ts";
import type { Json, Locale, Location } from "../../core/api.ts";
import { i18n, localized, t, translate } from "../../core/i18n.ts";
import type { MessageKey } from "../../core/i18n.ts";
import { locations } from "../../core/api.ts";
import { host, hostEvents, native, respondExtensionUi } from "../../core/host.ts";
import type { Boot, Catalog, Installed, PiSetupStatus, Project, Task } from "../../core/host.ts";
import { Runtime } from "../../core/runtime.ts";
import type { PanelView } from "../../core/runtime.ts";
import {
  emptyExtensionDialogs,
  extensionDialogReducer,
  isExtensionDialog,
  plainExtensionText,
} from "../../core/extension-ui.ts";
import { flatHistoryItems } from "../../core/session-tree.ts";
import type { SessionHistoryEntry } from "../../core/session-tree.ts";
import type { PiPackage } from "../settings/PiPackages.tsx";
import type { PiSkill, PiSkills } from "../settings/Skills.tsx";
import type { LegacySession } from "../settings/Settings.tsx";
import { useLayout } from "./useLayout.ts";
import { usePanels } from "./usePanels.ts";
import { useTasks } from "./useTasks.ts";
import { usePiSetup } from "./usePiSetup.ts";
import { usePackageSkills } from "./usePackageSkills.ts";
import { useSessionActions } from "./useSessionActions.ts";
import { useCoreCommands } from "./useCoreCommands.ts";
import type { SessionStats } from "../layout/Topbar/Topbar.tsx";
import type { Page } from "../layout/types.ts";
import { useTheme } from "../theme/useTheme.ts";
import type { ThemePreference } from "../../core/theme.ts";
import type { ViewMode } from "../chat/ChatMessage.tsx";

interface PiModel {
  provider: string;
  id: string;
  name?: string;
  input?: string[];
}
interface PiState {
  model?: PiModel;
  thinkingLevel?: string;
}
function readViewMode(): ViewMode {
  const saved = localStorage.getItem("pion.viewMode");
  return saved === "summary" || saved === "verbose" ? saved : "normal";
}
export function useShellController(runtime: Runtime, boot: Boot) {
  useSyncExternalStore(runtime.subscribe, runtime.snapshot);
  const locale = useSyncExternalStore(i18n.subscribe, i18n.getLocale);
  const [page, setPage] = useState<Page>("workspace");
  const [installed, setInstalled] = useState(boot.plugins);
  const [review, setReview] = useState<Installed | null>(null);
  const [path, setPath] = useState("");
  const [newText, setNewText] = useState(() => localStorage.getItem("pion.newTaskDraft") ?? "");
  const [newAttachments, setNewAttachments] = useState<ImageAttachment[]>([]);
  const [newImageError, setNewImageError] = useState("");
  const newImagePicker = useRef<HTMLInputElement>(null);
  const [draftModels, setDraftModels] = useState<PiModel[]>([]);
  const [draftLevels, setDraftLevels] = useState<string[]>([]);
  const [draftModel, setDraftModel] = useState("");
  const [draftThinking, setDraftThinking] = useState("");
  const [draftToolPreset, setDraftToolPreset] = useState("full");
  const [preparing, setPreparing] = useState(false);
  const [working, setWorking] = useState(false);
  const {
    executable,
    setExecutable,
    setupStatus,
    setSetupStatus,
    setupModel,
    setSetupModel,
    setupBusy,
    setSetupBusy,
    setupPathExpanded,
    setSetupPathExpanded,
    setupProgress,
    setSetupProgress,
    setupError,
    setSetupError,
    versionStatus,
    setVersionStatus,
    refreshSetup,
    savePiPath,
    installPi,
    checkPiUpdate,
    updatePi,
  } = usePiSetup(boot.settings.executable, setPage);
  const tasksState = useTasks({
    catalog: boot.catalog,
    runtime,
    executable,
    draftModels,
    draftModel,
    draftThinking,
    draftToolPreset,
    onStart: () => setPage("workspace"),
    onBeforeOpen: (previous, next) => {
      if (previous)
        extensionCache.current.set(previous.id, {
          title: extensionTitle,
          statuses: extensionStatuses,
          widgets: extensionWidgets,
        });
      clearExtensionUi();
      const extension = extensionCache.current.get(next.id);
      if (extension) {
        setExtensionTitle(extension.title);
        setExtensionStatuses(extension.statuses);
        setExtensionWidgets(extension.widgets);
      }
      activeTaskId.current = next.id;
    },
    onOpenFailed: (previous) => {
      activeTaskId.current = previous?.id ?? null;
      const extension = previous && extensionCache.current.get(previous.id);
      if (extension) {
        setExtensionTitle(extension.title);
        setExtensionStatuses(extension.statuses);
        setExtensionWidgets(extension.widgets);
      }
    },
    onProjectAdded: clearExtensionUi,
  });
  const {
    catalog,
    setCatalog,
    projectId,
    setProjectId,
    task,
    setTask,
    taskStatuses,
    setTaskStatuses,
    taskFilter,
    setTaskFilter,
    taskQuery,
    setTaskQuery,
    collapsedProjects,
    toggleProject,
    taskMatches,
    opening,
    initialPrompt,
    setInitialPrompt,
    openTask,
    addProject,
  } = tasksState;
  const {
    packageSource,
    setPackageSource,
    packageSources,
    setPackageSources,
    packageScope,
    setPackageScope,
    packageBusy,
    setPackageBusy,
    skillPath,
    setSkillPath,
    skillScope,
    setSkillScope,
    skills,
    setSkills,
    skillBusy,
    setSkillBusy,
    packageAction,
    skillAction,
    skillToggle,
    skillOverride,
    skillCommands,
  } = usePackageSkills(page, projectId, runtime);
  const [status, setStatus] = useState("Disconnected");
  const [connected, setConnected] = useState(false);
  const layoutState = useLayout();
  const { layout, updatePanel } = layoutState;
  const { theme: themePreference, setTheme } = useTheme();
  const [viewMode, setViewMode] = useState<ViewMode>(readViewMode);
  const [taskBrowserOpen, setTaskBrowserOpen] = useState(false);
  const [railCollapsed, setRailCollapsed] = useState(
    () => localStorage.getItem("pion.railCollapsed") === "true",
  );
  const [taskMenuOpen, setTaskMenuOpen] = useState(false);
  const [usageOpen, setUsageOpen] = useState(false);
  const [usageStats, setUsageStats] = useState<SessionStats | null>(null);
  const [usageLoading, setUsageLoading] = useState(false);
  const [usageError, setUsageError] = useState("");
  const [palette, setPalette] = useState(false);
  const [filter, setFilter] = useState("");
  const [contextMenu, setContextMenu] = useState(false);
  const [dialogs, dispatchDialog] = useReducer(extensionDialogReducer, emptyExtensionDialogs);
  const [dialogValue, setDialogValue] = useState("");
  const [extensionTitle, setExtensionTitle] = useState("");
  const [extensionStatuses, setExtensionStatuses] = useState(new Map<string, string>());
  const [extensionWidgets, setExtensionWidgets] = useState(
    new Map<string, { lines: string[]; placement: "aboveEditor" | "belowEditor" }>(),
  );
  const [extensionDraft, setExtensionDraft] = useState<string | null>(null);
  const extensionCache = useRef(
    new Map<
      string,
      {
        title: string;
        statuses: Map<string, string>;
        widgets: Map<string, { lines: string[]; placement: "aboveEditor" | "belowEditor" }>;
      }
    >(),
  );
  const activeTaskId = useRef<string | null>(task?.id ?? null);
  const {
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
  } = useSessionActions({ task, setTask, setCatalog, setInitialPrompt, clearExtensionUi });
  const [legacySessions, setLegacySessions] = useState<LegacySession[]>([]);
  const [legacySelected, setLegacySelected] = useState(new Set<string>());
  const [legacyLoading, setLegacyLoading] = useState(false);
  const extensionDialog = useRef<HTMLFormElement>(null);
  const headerActions = useRef<HTMLDivElement>(null);
  const usageButton = useRef<HTMLButtonElement>(null);
  const taskMenuButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!taskMenuOpen && !usageOpen) return;
    const close = (event: PointerEvent) => {
      if (!headerActions.current?.contains(event.target as Node)) {
        setTaskMenuOpen(false);
        setUsageOpen(false);
      }
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [taskMenuOpen, usageOpen]);

  useEffect(() => {
    if (task)
      extensionCache.current.set(task.id, {
        title: extensionTitle,
        statuses: extensionStatuses,
        widgets: extensionWidgets,
      });
  }, [task?.id, extensionTitle, extensionStatuses, extensionWidgets]);

  useEffect(
    () =>
      hostEvents.on("pi:status", (event) => {
        const value = event as { state: string; detail: string; working?: boolean };
        setStatus(value.detail);
        setConnected(value.state === "connected");
        if (value.state === "disconnected") setWorking(false);
        else if (typeof value.working === "boolean") setWorking(value.working);
      }),
    [],
  );

  useEffect(
    () =>
      hostEvents.on("task:status", (event) => {
        const value = event as {
          taskId: string;
          state: "working" | "idle" | "disconnected";
          unread?: boolean;
        };
        setTaskStatuses((current) => new Map(current).set(value.taskId, value.state));
        if (typeof value.unread === "boolean") {
          const unread = value.unread && value.taskId !== activeTaskId.current;
          setCatalog((current) => ({
            ...current,
            tasks: current.tasks.map((item) =>
              item.id === value.taskId ? { ...item, unread } : item,
            ),
          }));
        }
      }),
    [],
  );

  useEffect(
    () =>
      hostEvents.on("pi:event", (value) => {
        const event = value as Record<string, unknown>;
        if (event.type !== "extension_ui_request") return;
        if (isExtensionDialog(event)) dispatchDialog({ type: "enqueue", request: event });
        if (event.method === "notify")
          runtime.notice(
            `Pi · ${String(event.notifyType ?? "info")}`,
            plainExtensionText(String(event.message ?? "")),
          );
        if (event.method === "setTitle")
          setExtensionTitle(plainExtensionText(String(event.title ?? "")));
        if (event.method === "set_editor_text") setExtensionDraft(String(event.text ?? ""));
        if (event.method === "setStatus")
          setExtensionStatuses((current) => {
            const next = new Map(current);
            if (typeof event.statusText === "string")
              next.set(String(event.statusKey), plainExtensionText(event.statusText));
            else next.delete(String(event.statusKey));
            return next;
          });
        if (event.method === "setWidget")
          setExtensionWidgets((current) => {
            const next = new Map(current);
            if (Array.isArray(event.widgetLines))
              next.set(String(event.widgetKey), {
                lines: event.widgetLines.map((line) => plainExtensionText(String(line))),
                placement: event.widgetPlacement === "belowEditor" ? "belowEditor" : "aboveEditor",
              });
            else next.delete(String(event.widgetKey));
            return next;
          });
      }),
    [runtime],
  );

  useEffect(() => {
    activeTaskId.current = task?.id ?? null;
    dispatchDialog({ type: "clear" });
    setHistory(null);
    setTaskMenuOpen(false);
    setUsageOpen(false);
    setUsageStats(null);
    setUsageError("");
  }, [task?.id]);

  useEffect(() => {
    if (!connected) dispatchDialog({ type: "clear" });
  }, [connected]);

  useEffect(() => {
    const request = dialogs.active;
    setDialogValue(request?.method === "editor" ? plainExtensionText(request.prefill ?? "") : "");
    if (request?.timeout === undefined) return;
    const timer = setTimeout(() => {
      dispatchDialog({ type: "finish", id: request.id });
      runtime.notice("Pi", t("Extension dialog timed out."));
    }, request.timeout);
    return () => clearTimeout(timer);
  }, [dialogs.active, runtime]);

  useEffect(() => {
    if (!dialogs.active) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const frame = requestAnimationFrame(() =>
      extensionDialog.current
        ?.querySelector<HTMLElement>(
          "button:not(:disabled), input:not(:disabled), textarea:not(:disabled)",
        )
        ?.focus(),
    );
    return () => {
      cancelAnimationFrame(frame);
      previous?.focus();
    };
  }, [dialogs.active?.id]);

  useEffect(() => {
    let live = true;
    async function prepare() {
      if (page !== "workspace" || task || !projectId || (native && !setupStatus?.modelReady))
        return;
      setPreparing(true);
      setDraftModels([]);
      setDraftLevels([]);
      try {
        await host({ op: "task.prepare", projectId, executable });
        const state = await host<PiState>({ op: "pi", command: "get_state", args: {} });
        const available = await host<{ models: PiModel[] }>({
          op: "pi",
          command: "get_models",
          args: {},
        });
        const thinking = await host<{ levels: string[] }>({
          op: "pi",
          command: "get_thinking_levels",
          args: {},
        });
        if (!live) return;
        const activeModel = state.model ? `${state.model.provider}/${state.model.id}` : "";
        const savedModel =
          localStorage.getItem(`pion.newTaskModel.${projectId}`) ??
          localStorage.getItem("pion.defaultModel") ??
          "";
        const savedThinking = localStorage.getItem(`pion.newTaskThinking.${projectId}`) ?? "";
        const savedToolPreset =
          localStorage.getItem(`pion.newTaskToolPreset.${projectId}`) ?? "full";
        setDraftModels(available.models);
        setDraftLevels(thinking.levels);
        setDraftModel(
          available.models.some((model) => `${model.provider}/${model.id}` === savedModel)
            ? savedModel
            : activeModel,
        );
        setDraftThinking(
          thinking.levels.includes(savedThinking)
            ? savedThinking
            : (state.thinkingLevel ?? thinking.levels[0] ?? ""),
        );
        setDraftToolPreset(
          ["full", "read-only", "chat"].includes(savedToolPreset) ? savedToolPreset : "full",
        );
      } catch (error) {
        if (live) runtime.notice("Pi", String(error));
      } finally {
        if (live) setPreparing(false);
      }
    }
    prepare().catch((error) => live && runtime.notice("Pi", String(error)));
    return () => {
      live = false;
    };
  }, [executable, page, projectId, runtime, setupStatus?.modelReady, task]);
  useEffect(
    () =>
      hostEvents.on("pi:event", (value) => {
        const event = value as { type: string };
        if (event.type === "agent_start") setWorking(true);
        if (event.type === "agent_settled") setWorking(false);
      }),
    [],
  );

  function updateNewText(value: string) {
    setNewText(value);
    localStorage.setItem("pion.newTaskDraft", value);
  }
  async function importNewImages(files: File[]) {
    setNewAttachments(await importImageFiles(newAttachments, files));
    setNewImageError("");
  }
  async function chooseNewImages() {
    setNewAttachments(await pickImages(newAttachments));
    setNewImageError("");
  }
  function clearExtensionUi() {
    dispatchDialog({ type: "clear" });
    setExtensionTitle("");
    setExtensionStatuses(new Map());
    setExtensionWidgets(new Map());
    setExtensionDraft(null);
  }
  async function loadLegacySessions() {
    setLegacyLoading(true);
    try {
      const result = await host<{ sessions: LegacySession[] }>({ op: "sessions.legacy.list" });
      setLegacySessions(result.sessions);
      setLegacySelected(new Set());
    } finally {
      setLegacyLoading(false);
    }
  }
  async function importLegacySessions() {
    setLegacyLoading(true);
    try {
      const result = await host<{ catalog: Catalog }>({
        op: "sessions.legacy.import",
        ids: [...legacySelected],
      });
      setCatalog(result.catalog);
      setLegacySessions((items) => items.filter((item) => !legacySelected.has(item.id)));
      setLegacySelected(new Set());
    } finally {
      setLegacyLoading(false);
    }
  }
  async function answerDialog(response: Record<string, unknown>) {
    const request = dialogs.active;
    if (!request || dialogs.responding) return;
    dispatchDialog({ type: "responding" });
    try {
      await respondExtensionUi({ id: request.id, response });
    } catch (error) {
      runtime.notice("Pi", String(error));
    } finally {
      dispatchDialog({ type: "finish", id: request.id });
    }
  }

  async function showUsage() {
    const next = !usageOpen;
    setUsageOpen(next);
    setTaskMenuOpen(false);
    if (!next || usageStats || usageLoading || !task) return;
    setUsageLoading(true);
    setUsageError("");
    try {
      setUsageStats(await host<SessionStats>({ op: "pi", command: "get_session_stats", args: {} }));
    } catch (error) {
      setUsageError(String(error));
    } finally {
      setUsageLoading(false);
    }
  }
  function setConversationView(value: ViewMode) {
    localStorage.setItem("pion.viewMode", value);
    setViewMode(value);
  }
  function toggleRail() {
    setRailCollapsed((current) => {
      localStorage.setItem("pion.railCollapsed", String(!current));
      return !current;
    });
  }
  const { busy, setBusy, locked, perform, run, action } = useCoreCommands({
    runtime,
    installed,
    setInstalled,
    executable,
    working,
    setPage,
    setPalette,
    setReview,
    refreshSetup,
    updatePanel,
  });
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        runtime.commands.execute("core.palette").catch(() => {});
      }
      if (
        (event.metaKey || event.ctrlKey) &&
        !event.shiftKey &&
        event.key.toLowerCase() === "n" &&
        !dialogs.active &&
        !busy &&
        page !== "setup"
      ) {
        event.preventDefault();
        setPalette(false);
        setTask(null);
        clearExtensionUi();
        setPage("workspace");
      }
      if (event.key === "Tab" && dialogs.active) {
        const focusable = [
          ...(extensionDialog.current?.querySelectorAll<HTMLElement>(
            "button:not(:disabled), input:not(:disabled), textarea:not(:disabled)",
          ) ?? []),
        ];
        if (focusable.length) {
          const current = focusable.indexOf(document.activeElement as HTMLElement);
          const next = event.shiftKey
            ? current <= 0
              ? focusable.length - 1
              : current - 1
            : current === focusable.length - 1
              ? 0
              : current + 1;
          event.preventDefault();
          focusable[next].focus();
        }
      }
      if (event.key === "Escape") {
        if (dialogs.active) {
          event.preventDefault();
          answerDialog({ cancelled: true }).catch((error) => runtime.notice("Pi", String(error)));
        }
        setPalette(false);
        setContextMenu(false);
        setHistory(null);
        setRenameOpen(false);
        if (taskMenuOpen) {
          setTaskMenuOpen(false);
          taskMenuButton.current?.focus();
        }
        if (usageOpen) {
          setUsageOpen(false);
          usageButton.current?.focus();
        }
      }
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [dialogs.active, dialogs.responding, runtime, taskMenuOpen, usageOpen, page, busy]);

  const panels = [...runtime.panels.values()];
  const { getPanelsAt: at } = usePanels(runtime, layoutState);
  return {
    locale,
    page,
    setPage,
    installed,
    review,
    path,
    setPath,
    packageSource,
    setPackageSource,
    packageSources,
    packageScope,
    setPackageScope,
    packageBusy,
    skillPath,
    setSkillPath,
    skillScope,
    setSkillScope,
    skills,
    skillBusy,
    newText,
    newAttachments,
    setNewAttachments,
    newImageError,
    setNewImageError,
    newImagePicker,
    draftModels,
    draftLevels,
    draftModel,
    setDraftModel,
    draftThinking,
    setDraftThinking,
    draftToolPreset,
    setDraftToolPreset,
    preparing,
    working,
    setWorking,
    executable,
    setExecutable,
    tasksState,
    catalog,
    projectId,
    setProjectId,
    task,
    taskStatuses,
    opening,
    initialPrompt,
    setInitialPrompt,
    openTask,
    addProject,
    setupStatus,
    setupModel,
    setSetupModel,
    setupBusy,
    setupPathExpanded,
    setSetupPathExpanded,
    setupProgress,
    setupError,
    versionStatus,
    status,
    connected,
    busy,
    layout,
    themePreference,
    setTheme,
    viewMode,
    taskBrowserOpen,
    setTaskBrowserOpen,
    railCollapsed,
    taskMenuOpen,
    setTaskMenuOpen,
    usageOpen,
    setUsageOpen,
    usageStats,
    usageLoading,
    usageError,
    palette,
    setPalette,
    filter,
    setFilter,
    contextMenu,
    setContextMenu,
    dialogs,
    dialogValue,
    setDialogValue,
    extensionTitle,
    setExtensionTitle,
    extensionStatuses,
    extensionWidgets,
    extensionDraft,
    setExtensionDraft,
    sessionBusy,
    history,
    setHistory,
    renameOpen,
    setRenameOpen,
    renameValue,
    setRenameValue,
    legacySessions,
    legacySelected,
    setLegacySelected,
    legacyLoading,
    extensionDialog,
    headerActions,
    usageButton,
    taskMenuButton,
    refreshSetup,
    savePiPath,
    installPi,
    checkPiUpdate,
    updatePi,
    packageAction,
    skillAction,
    skillToggle,
    skillOverride,
    skillCommands,
    updateNewText,
    importNewImages,
    chooseNewImages,
    clearExtensionUi,
    loadLegacySessions,
    importLegacySessions,
    answerDialog,
    openHistory,
    branch,
    renameTask,
    showUsage,
    setConversationView,
    toggleRail,
    perform,
    run,
    action,
    panels,
    at,
  };
}
