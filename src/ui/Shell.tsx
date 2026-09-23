import { useEffect, useReducer, useRef, useState, useSyncExternalStore } from "react";
import {
  imageFailure,
  importImageFiles,
  pickImages,
  setAttachmentDraft,
} from "../core/attachments.ts";
import type { ImageAttachment } from "../core/attachments.ts";
import type { Json, Locale, Location } from "../core/api.ts";
import { i18n, localized, t, translate } from "../core/i18n.ts";
import type { MessageKey } from "../core/i18n.ts";
import { locations } from "../core/api.ts";
import { host, hostEvents, native, respondExtensionUi } from "../core/host.ts";
import type { Boot, Catalog, Installed, PiSetupStatus, Project, Task } from "../core/host.ts";
import { Runtime } from "../core/runtime.ts";
import type { PanelView } from "../core/runtime.ts";
import {
  emptyExtensionDialogs,
  extensionDialogReducer,
  isExtensionDialog,
  plainExtensionText,
} from "../core/extension-ui.ts";
import { flatHistoryItems } from "../core/session-tree.ts";
import type { SessionHistoryEntry } from "../core/session-tree.ts";
import {
  applyTheme,
  readThemePreference,
  saveThemePreference,
  watchSystemTheme,
} from "../core/theme.ts";
import type { ThemePreference } from "../core/theme.ts";
import { CoreChat, hasChatSnapshot } from "./CoreChat.tsx";
import { ModelSettings } from "./ModelSettings.tsx";
import { ModelPicker } from "./ModelPicker.tsx";
import type { ViewMode } from "./ChatMessage.tsx";
import { PanelBoundary, ViewRenderer } from "./View.tsx";
import pionMark from "../../src-tauri/icon.svg";

interface Layout {
  [id: string]: { hidden?: boolean; location?: Location };
}
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
interface SessionStats {
  cost?: number;
  contextUsage?: { tokens?: number; contextWindow?: number; percent?: number };
}
type TaskFilter = "all" | "running" | "attention";
interface LegacySession {
  id: string;
  title: string;
  projectPath: string;
  modified: number;
  messageCount: number;
}
interface PiSkill {
  name: string;
  path: string;
  scope: "user" | "project";
  origin: "package" | "top-level";
  source: string | null;
  enabled: boolean;
  userEnabled: boolean;
  projectOverride?: "inherit" | "load" | "unload";
}
interface PiSkills {
  paths: { user: string[]; project: string[] };
  skills: PiSkill[];
  skillCommands: { user: boolean; project: "inherit" | "enabled" | "disabled" };
}
interface PiPackage {
  source: string;
  scope: "user" | "project";
}
const permissionLabels: Record<string, MessageKey> = {
  "pi.read": "Read Pi sessions, messages, tool events, and model information",
  "pi.sendMessage":
    "High risk: drive Pi tasks; its tools may write files, execute commands, or access the network",
  "workspace.read": "Read text files in the current workspace",
  storage: "Read and write this plugin’s own persistent data",
  notifications: "Show in-app notifications",
};
const labels: Record<Location, MessageKey> = {
  sidebar: "Left sidebar",
  secondarySidebar: "Right sidebar",
  mainPanel: "Main area",
  bottomPanel: "Bottom panel",
  statusBar: "Status bar",
  toolbar: "Toolbar",
  commandPalette: "Commands",
  contextMenu: "Context menu",
  settings: "Settings",
};
function readLayout(): Layout {
  try {
    return JSON.parse(localStorage.getItem("pion.layout") ?? "{}");
  } catch {
    return {};
  }
}
function readViewMode(): ViewMode {
  const saved = localStorage.getItem("pion.viewMode");
  return saved === "summary" || saved === "verbose" ? saved : "normal";
}
function readCollapsedProjects(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem("pion.collapsedProjects") ?? "[]"));
  } catch {
    return new Set();
  }
}
function defaultPiModel(): { provider: string; id: string } | null {
  const value = localStorage.getItem("pion.defaultModel") ?? "";
  const separator = value.indexOf("/");
  return separator > 0
    ? { provider: value.slice(0, separator), id: value.slice(separator + 1) }
    : null;
}
export function Shell({ runtime, boot }: { runtime: Runtime; boot: Boot }) {
  useSyncExternalStore(runtime.subscribe, runtime.snapshot);
  const locale = useSyncExternalStore(i18n.subscribe, i18n.getLocale);
  const [page, setPage] = useState<
    "workspace" | "setup" | "models" | "plugins" | "packages" | "skills" | "settings" | "panels"
  >("workspace");
  const [installed, setInstalled] = useState(boot.plugins);
  const [review, setReview] = useState<Installed | null>(null);
  const [path, setPath] = useState("");
  const [packageSource, setPackageSource] = useState("");
  const [packageSources, setPackageSources] = useState<PiPackage[]>([]);
  const [packageScope, setPackageScope] = useState<"user" | "project">("user");
  const [packageBusy, setPackageBusy] = useState(false);
  const [skillPath, setSkillPath] = useState("");
  const [skillScope, setSkillScope] = useState<"user" | "project">("user");
  const [skills, setSkills] = useState<PiSkills>({
    paths: { user: [], project: [] },
    skills: [],
    skillCommands: { user: true, project: "inherit" },
  });
  const [skillBusy, setSkillBusy] = useState(false);
  const [catalog, setCatalog] = useState<Catalog>(boot.catalog);
  const [projectId, setProjectId] = useState(boot.catalog.projects[0]?.id ?? "");
  const [task, setTask] = useState<Task | null>(null);
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
  const [taskStatuses, setTaskStatuses] = useState(
    new Map<string, "working" | "idle" | "disconnected">(),
  );
  const [opening, setOpening] = useState(false);
  const [initialPrompt, setInitialPrompt] = useState<{ taskId: string; text: string } | null>(null);
  const locked = useRef(false);
  const [executable, setExecutable] = useState(boot.settings.executable);
  const [setupStatus, setSetupStatus] = useState<PiSetupStatus | null>(null);
  const [setupModel, setSetupModel] = useState(defaultPiModel);
  const [setupBusy, setSetupBusy] = useState(false);
  const [setupPathExpanded, setSetupPathExpanded] = useState(false);
  const [setupProgress, setSetupProgress] = useState("");
  const [setupError, setSetupError] = useState("");
  const [versionStatus, setVersionStatus] = useState<PiSetupStatus | null>(null);
  const [status, setStatus] = useState("Disconnected");
  const [connected, setConnected] = useState(false);
  const [busy, setBusy] = useState(false);
  const [layout, setLayout] = useState<Layout>(readLayout);
  const [themePreference, setThemePreference] = useState<ThemePreference>(readThemePreference);
  const [viewMode, setViewMode] = useState<ViewMode>(readViewMode);
  const [taskFilter, setTaskFilter] = useState<TaskFilter>("all");
  const [taskQuery, setTaskQuery] = useState("");
  const [taskBrowserOpen, setTaskBrowserOpen] = useState(false);
  const [collapsedProjects, setCollapsedProjects] = useState(readCollapsedProjects);
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
  const [sessionBusy, setSessionBusy] = useState(false);
  const [history, setHistory] = useState<{
    items: SessionHistoryEntry[];
    leafId: string | null;
    forks: { entryId: string; text: string }[];
  } | null>(null);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [legacySessions, setLegacySessions] = useState<LegacySession[]>([]);
  const [legacySelected, setLegacySelected] = useState(new Set<string>());
  const [legacyLoading, setLegacyLoading] = useState(false);
  const extensionDialog = useRef<HTMLFormElement>(null);
  const headerActions = useRef<HTMLDivElement>(null);
  const usageButton = useRef<HTMLButtonElement>(null);
  const taskMenuButton = useRef<HTMLButtonElement>(null);

  async function refreshSetup(model = defaultPiModel(), candidateExecutable = executable) {
    if (!native) return;
    setSetupBusy(true);
    setSetupProgress(t("Checking Pi…"));
    setSetupError("");
    try {
      const result = await host<PiSetupStatus>({
        op: "pi_setup.status",
        executable: candidateExecutable,
        model,
      });
      setSetupStatus(result);
      if (result.detail) setSetupError(result.detail);
      if (
        result.installation === "ready" &&
        result.executable &&
        result.executable !== candidateExecutable
      ) {
        await host({ op: "settings.save", executable: result.executable });
        setExecutable(result.executable);
      }
      const selected = result.selectedModel ?? null;
      setSetupModel(selected);
      if (result.modelReady && selected) {
        localStorage.setItem("pion.defaultModel", `${selected.provider}/${selected.id}`);
        setPage((current) => (current === "setup" ? "workspace" : current));
      } else {
        setPage((current) => (current === "workspace" ? "setup" : current));
      }
    } catch (error) {
      setSetupError(String(error));
    } finally {
      setSetupBusy(false);
    }
  }

  async function savePiPath() {
    setSetupBusy(true);
    setSetupProgress(t("Checking Pi…"));
    setSetupError("");
    setVersionStatus(null);
    try {
      await host({ op: "settings.save", executable });
      await refreshSetup(setupModel);
    } catch (error) {
      setSetupError(String(error));
    } finally {
      setSetupBusy(false);
    }
  }

  async function installPi() {
    setSetupBusy(true);
    setSetupProgress(t("Installing Pi…"));
    setSetupError("");
    setVersionStatus(null);
    try {
      const result = await host<PiSetupStatus>({ op: "pi_setup.install", executable });
      if (result.executable) setExecutable(result.executable);
      await refreshSetup(setupModel, result.executable ?? executable);
    } catch (error) {
      setSetupError(String(error));
    } finally {
      setSetupBusy(false);
    }
  }

  async function checkPiUpdate() {
    setSetupBusy(true);
    setSetupProgress(t("Checking Pi updates…"));
    setSetupError("");
    setVersionStatus(null);
    try {
      setVersionStatus(await host<PiSetupStatus>({ op: "pi_setup.check_update", executable }));
    } catch (error) {
      setSetupError(String(error));
    } finally {
      setSetupBusy(false);
    }
  }

  async function updatePi() {
    setSetupBusy(true);
    setSetupProgress(t("Updating Pi…"));
    setSetupError("");
    try {
      const result = await host<PiSetupStatus>({ op: "pi_setup.update", executable });
      if (result.executable) setExecutable(result.executable);
      setVersionStatus(null);
      await refreshSetup(setupModel, result.executable ?? executable);
    } catch (error) {
      setSetupError(String(error));
    } finally {
      setSetupBusy(false);
    }
  }

  useEffect(() => {
    if (native) void refreshSetup();
  }, []);

  useEffect(() => {
    applyTheme(themePreference);
    return watchSystemTheme(themePreference, () => applyTheme(themePreference));
  }, [themePreference]);

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
    if (page !== "packages" || !native) return;
    host<{ sources: PiPackage[] }>({ op: "package.list", projectId })
      .then((result) => setPackageSources(result.sources))
      .catch((error) => runtime.notice("Pi", String(error)));
  }, [page, projectId, runtime]);

  async function packageAction(
    op: "install" | "update" | "remove",
    source: string,
    scope: "user" | "project",
  ) {
    setPackageBusy(true);
    try {
      const result = await host<{ sources: PiPackage[] }>({
        op: `package.${op}`,
        source,
        scope,
        projectId,
      });
      setPackageSources(result.sources);
      if (op === "install") setPackageSource("");
      runtime.notice("Pi", t("Reopen a task to load Pi package changes."));
    } finally {
      setPackageBusy(false);
    }
  }

  useEffect(() => {
    if (page !== "skills" || !native) return;
    host<PiSkills>({ op: "skill.list", projectId })
      .then(setSkills)
      .catch((error) => runtime.notice("Pi", String(error)));
  }, [page, projectId, runtime]);

  useEffect(() => {
    if (!projectId) {
      setSkillScope("user");
      setPackageScope("user");
    }
  }, [projectId]);

  async function skillAction(op: "add" | "remove", path: string) {
    setSkillBusy(true);
    try {
      setSkills(await host<PiSkills>({ op: `skill.${op}`, path, scope: skillScope, projectId }));
      if (op === "add") setSkillPath("");
      runtime.notice("Pi", t("Reopen a task to load Pi skill changes."));
    } finally {
      setSkillBusy(false);
    }
  }

  async function skillToggle(skill: PiSkill) {
    setSkillBusy(true);
    try {
      setSkills(
        await host<PiSkills>({
          op: "skill.toggle",
          projectId,
          path: skill.path,
          enabled: !skill.userEnabled,
        }),
      );
      runtime.notice("Pi", t("Reopen a task to load Pi skill changes."));
    } finally {
      setSkillBusy(false);
    }
  }

  async function skillOverride(skill: PiSkill, state: "inherit" | "load" | "unload") {
    setSkillBusy(true);
    try {
      setSkills(await host<PiSkills>({ op: "skill.override", projectId, path: skill.path, state }));
      runtime.notice("Pi", t("Reopen a task to load Pi skill changes."));
    } finally {
      setSkillBusy(false);
    }
  }

  async function skillCommands(state: "inherit" | "enabled" | "disabled") {
    setSkillBusy(true);
    try {
      setSkills(
        await host<PiSkills>({ op: "skill.commands", projectId, scope: skillScope, state }),
      );
      runtime.notice("Pi", t("Reopen a task to load Pi skill changes."));
    } finally {
      setSkillBusy(false);
    }
  }

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
  async function openTask(intent: {
    projectId?: string;
    text?: string;
    images?: ImageAttachment[];
    task?: Task;
  }) {
    const previous = task;
    const previousProjectId = projectId;
    setPage("workspace");
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
      setTask(next);
      setProjectId(next.projectId);
      setInitialPrompt(
        creating && (intent.text !== undefined || intent.images?.length)
          ? { taskId: next.id, text: intent.text ?? "" }
          : null,
      );
      const model = draftModels.find((item) => `${item.provider}/${item.id}` === draftModel);
      const opened = await host<{ catalog: Catalog; reused: boolean }>({
        op: "task.open",
        id: next.id,
        executable,
        ...(creating && model ? { model: { provider: model.provider, modelId: model.id } } : {}),
        ...(creating && draftThinking ? { thinkingLevel: draftThinking } : {}),
      });
      if (creating) {
        try {
          await host({
            op: "pi",
            command: "set_tool_preset",
            args: { preset: draftToolPreset },
          });
        } catch (error) {
          runtime.notice("Pi", String(error));
        }
      }
      setCatalog(opened.catalog);
      setTask(opened.catalog.tasks.find((item) => item.id === next.id) ?? next);
    } catch (error) {
      activeTaskId.current = previous?.id ?? null;
      setTask(previous);
      setProjectId(previousProjectId);
      setInitialPrompt(null);
      const extension = previous && extensionCache.current.get(previous.id);
      if (extension) {
        setExtensionTitle(extension.title);
        setExtensionStatuses(extension.statuses);
        setExtensionWidgets(extension.widgets);
      }
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
      clearExtensionUi();
      setPage("workspace");
    }
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
  function setTheme(value: ThemePreference) {
    saveThemePreference(value);
    setThemePreference(value);
  }
  function setConversationView(value: ViewMode) {
    localStorage.setItem("pion.viewMode", value);
    setViewMode(value);
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
  function toggleRail() {
    setRailCollapsed((current) => {
      localStorage.setItem("pion.railCollapsed", String(!current));
      return !current;
    });
  }
  function perform(work: () => Promise<unknown>) {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    work()
      .catch((error) => runtime.notice("Pion", String(error)))
      .finally(() => {
        locked.current = false;
        setBusy(false);
      });
  }
  useEffect(() => {
    const dispose = [
      runtime.commands.register("core", "core.locale", async (args) => {
        i18n.setLocale(args as Locale);
        return null;
      }),
      runtime.commands.register("core", "core.navigate", async (args) => {
        setPage(args as typeof page);
        return null;
      }),
      runtime.commands.register("core", "core.palette", async () => {
        setPalette((value) => !value);
        return null;
      }),
      runtime.commands.register("core", "core.review", async (args) => {
        setReview(await host<Installed>({ op: "review", path: args }));
        return null;
      }),
      runtime.commands.register("core", "core.review.cancel", async () => {
        setReview(null);
        return null;
      }),
      runtime.commands.register("core", "core.approve", async (args) => {
        const record = args as unknown as Installed;
        await host({ op: "approve", digest: record.digest });
        runtime.load(record.bundle);
        setInstalled((records) => [
          ...records.filter((r) => r.bundle.manifest.id !== record.bundle.manifest.id),
          record,
        ]);
        setReview(null);
        return null;
      }),
      runtime.commands.register("core", "core.plugin", async (args) => {
        const { id, action } = args as { id: string; action: string };
        const record = installed.find((r) => r.bundle.manifest.id === id);
        if (!record) throw new Error(t("Plugin unavailable"));
        runtime.unload(id);
        if (action === "remove") {
          await host({ op: "remove", id });
          runtime.forget(id);
          setInstalled((records) => records.filter((r) => r.bundle.manifest.id !== id));
        } else {
          const enabled = action !== "disable";
          await host({ op: "enable", id, enabled });
          setInstalled((records) => records.map((r) => (r === record ? { ...r, enabled } : r)));
          runtime.load(record.bundle, enabled);
        }
        return null;
      }),
      runtime.commands.register("core", "core.settings.save", async () => {
        await host({ op: "settings.save", executable });
        await refreshSetup();
        runtime.notice("Pion", t("Settings saved. They apply when the next task opens."));
        return null;
      }),
      runtime.commands.register("core", "core.disconnect", async () => {
        await host({ op: "disconnect" });
        return null;
      }),
      runtime.commands.register("core", "core.layout", async (args) => {
        const { id, location, hidden } = args as {
          id: string;
          location?: Location;
          hidden?: boolean;
        };
        setLayout((value) => {
          const next = {
            ...value,
            [id]: {
              ...value[id],
              ...(location ? { location } : {}),
              ...(hidden === undefined ? {} : { hidden }),
            },
          };
          localStorage.setItem("pion.layout", JSON.stringify(next));
          return next;
        });
        return null;
      }),
      runtime.commands.register("core", "core.dismiss", async (args) => {
        runtime.dismiss(Number(args));
        return null;
      }),
    ];
    return () => dispose.forEach((fn) => fn());
  }, [runtime, installed, executable, working]);

  async function run(id: string, args?: Json): Promise<Json> {
    try {
      return await runtime.commands.execute(id, args);
    } catch (error) {
      runtime.notice("Desktop", String(error));
      throw error;
    }
  }
  function action(id: string, args?: Json) {
    perform(() => runtime.commands.execute(id, args));
  }
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        runtime.commands.execute("core.palette").catch(() => {});
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
  }, [dialogs.active, dialogs.responding, runtime, taskMenuOpen, usageOpen]);

  const panels = [...runtime.panels.values()];
  const at = (location: Location) =>
    panels.filter(
      (p) =>
        p.owner !== "agent-chat" &&
        !layout[p.id]?.hidden &&
        (layout[p.id]?.location ?? p.location) === location,
    );
  function panel(panel: PanelView) {
    const conversation = panel.id === "agent-chat.conversation";
    return (
      <section className="plugin-panel" key={panel.id} data-panel={panel.id}>
        {!conversation && (
          <header className="panel-header">
            <span>{localized(panel.title, panel.titleI18n)}</span>
            <div>
              <select
                aria-label={t("Move {title}", { title: localized(panel.title, panel.titleI18n) })}
                value={layout[panel.id]?.location ?? panel.location}
                onChange={(event) =>
                  action("core.layout", { id: panel.id, location: event.target.value })
                }
              >
                {locations.map((location) => (
                  <option key={location} value={location}>
                    {t(labels[location])}
                  </option>
                ))}
              </select>
              <button
                aria-label={t("Hide {title}", { title: localized(panel.title, panel.titleI18n) })}
                className="icon-button"
                onClick={() => action("core.layout", { id: panel.id, hidden: true })}
              >
                −
              </button>
            </div>
          </header>
        )}
        <PanelBoundary>
          <ViewRenderer view={panel.view} run={run} />
        </PanelBoundary>
      </section>
    );
  }
  const pluginCommands = [...runtime.plugins.values()]
    .flatMap((p) => (p.state === "active" ? p.manifest.contributes.commands : []))
    .filter(
      (c) =>
        runtime.commands.has(c.id) &&
        `${localized(c.title, c.titleI18n)} ${c.title} ${c.id}`
          .toLowerCase()
          .includes(filter.toLowerCase()),
    );
  const backgroundTasks = catalog.tasks.filter(
    (item) =>
      item.projectId === task?.projectId &&
      taskStatuses.get(item.id) === "working" &&
      item.id !== task?.id,
  ).length;
  const selectedProject = catalog.projects.find((project) => project.id === projectId);
  const draftSupportsImages = !!draftModels
    .find((model) => `${model.provider}/${model.id}` === draftModel)
    ?.input?.includes("image");
  const piInstalled = setupStatus?.installation === "ready";
  const taskMatches = (item: Task) => {
    if (taskQuery && !item.title.toLowerCase().includes(taskQuery.toLowerCase())) return false;
    const taskStatus = taskStatuses.get(item.id);
    if (taskFilter === "running") return taskStatus === "working";
    if (taskFilter === "attention") return item.unread;
    return true;
  };
  const runningCount = [...taskStatuses.values()].filter((value) => value === "working").length;
  const attentionCount = catalog.tasks.filter((item) => item.unread).length;

  function piVersionSection() {
    return (
      <section className="pi-version-section">
        <h2>{t("Pi version")}</h2>
        <p className="settings-note">
          {t("Installed: {installed} · Pion verified: {verified}", {
            installed: setupStatus?.installedVersion ?? "—",
            verified: setupStatus?.verifiedVersion ?? "—",
          })}
        </p>
        <div className="button-row">
          <button
            type="button"
            disabled={setupBusy || !native}
            onClick={() => void checkPiUpdate()}
          >
            {t("Check Pi updates")}
          </button>
          {versionStatus?.canUpdate && (
            <button
              type="button"
              className="primary"
              disabled={setupBusy}
              onClick={() => void updatePi()}
            >
              {t("Update Pi to {version}", { version: versionStatus.verifiedVersion })}
            </button>
          )}
        </div>
        {setupBusy && page === "settings" && <p role="status">{setupProgress}</p>}
        {versionStatus?.latestVersion && (
          <p className="settings-note" role="status">
            {t("Official latest: {version}", { version: versionStatus.latestVersion })}
            {versionStatus.latestVersion !== versionStatus.verifiedVersion &&
              ` · ${t("This release has not been verified with Pion yet.")}`}
            {!versionStatus.npmManaged &&
              versionStatus.installation === "ready" &&
              ` · ${t("Only global npm installations can be updated here.")}`}
          </p>
        )}
        {versionStatus?.installation === "ready" && !versionStatus.npmManaged && (
          <p className="settings-note">
            <a href="https://pi.dev/docs/latest/cli" target="_blank" rel="noreferrer">
              {t("Manual Pi update guide")}
            </a>
          </p>
        )}
      </section>
    );
  }

  return (
    <div
      className={`app ${page === "setup" ? "setup-page" : ""} ${railCollapsed ? "rail-collapsed" : ""}`}
      onContextMenu={(event) => {
        if (at("contextMenu").length) {
          event.preventDefault();
          setContextMenu(true);
        }
      }}
    >
      {page !== "setup" && (
        <aside className="rail">
          <div className="rail-header">
            <div className="brand">
              <img src={pionMark} alt="" />
              <strong>Pion</strong>
            </div>
            <button
              className="icon-button rail-toggle"
              type="button"
              aria-label={t(railCollapsed ? "Show sidebar" : "Hide sidebar")}
              title={t(railCollapsed ? "Show sidebar" : "Hide sidebar")}
              onClick={toggleRail}
            >
              {railCollapsed ? "›" : "‹"}
            </button>
          </div>
          <nav aria-label={t("Main navigation")}>
            <button
              className={`new-task-button ${!task && page === "workspace" ? "selected" : ""}`}
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
              className={page === "models" ? "selected" : ""}
              aria-label={t("Pi models")}
              title={t("Pi models")}
              onClick={() => action("core.navigate", "models")}
            >
              <span aria-hidden="true">◇</span>
              <span>{t("Pi models")}</span>
            </button>
          </nav>
          <div className="project-heading">
            <span>{t("Projects")}</span>
            <div className="project-actions">
              <button
                className={`icon-button ${
                  taskBrowserOpen || taskQuery || taskFilter !== "all" ? "selected" : ""
                }`}
                aria-label={t("Search tasks")}
                title={t("Search tasks")}
                aria-expanded={taskBrowserOpen}
                aria-controls="task-browser-controls"
                onClick={() => setTaskBrowserOpen((open) => !open)}
              >
                ⌕
              </button>
              <button
                className="icon-button"
                aria-label={t("Add project")}
                title={t("Add project")}
                disabled={busy || !native}
                onClick={() => perform(addProject)}
              >
                ＋
              </button>
            </div>
          </div>
          {taskBrowserOpen && (
            <div id="task-browser-controls" className="task-browser-controls">
              <label className="task-search">
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
              <div className="task-filters" role="group" aria-label={t("Filter tasks")}>
                {(["all", "running", "attention"] as const).map((filter) => (
                  <button
                    key={filter}
                    type="button"
                    className={taskFilter === filter ? "selected" : ""}
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
          <div className="project-tree">
            {!catalog.projects.length && (
              <p className="muted">{t("Add a project folder to start.")}</p>
            )}
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
                <section key={project.id} className="project-group">
                  <div className="project-row">
                    <button
                      title={project.path}
                      disabled={busy}
                      aria-expanded={!collapsed}
                      onClick={() => toggleProject(project.id)}
                    >
                      <span className="disclosure" aria-hidden="true">
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
                    <div className="task-list">
                      {projectTasks.map((item) => {
                        const itemStatus = taskStatuses.get(item.id);
                        return (
                          <button
                            key={item.id}
                            title={item.title}
                            className={
                              task?.id === item.id && page === "workspace" ? "selected" : ""
                            }
                            disabled={busy}
                            onClick={() => {
                              if (task?.id === item.id && connected) setPage("workspace");
                              else perform(() => openTask({ task: item }));
                            }}
                          >
                            <span className="task-title">{item.title || t("New task")}</span>
                            {itemStatus === "working" && (
                              <span className={`task-state ${itemStatus}`} aria-hidden="true" />
                            )}
                            {item.unread && itemStatus !== "working" && (
                              <span
                                className="unread-mark"
                                role="status"
                                aria-label={t("Unread completed task")}
                              />
                            )}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </section>
              );
            })}
            {!!catalog.projects.length && !catalog.tasks.some(taskMatches) && (
              <p className="muted task-empty">{t("No tasks match this view.")}</p>
            )}
          </div>
          <div className="rail-bottom">
            <button
              className={page !== "workspace" && page !== "models" ? "selected" : ""}
              onClick={() => action("core.navigate", "settings")}
            >
              <span aria-hidden="true">⚙</span> {t("Settings")}
            </button>
            <div className="runtime-label">
              <span className={`dot ${connected ? "" : "offline"}`} />
              <span>Pion</span> <span>Pi</span>
            </div>
          </div>
        </aside>
      )}
      <div className="shell-content">
        {page !== "setup" && (
          <header className="topbar">
            <div className="task-breadcrumb">
              <span className="muted">
                {page === "workspace"
                  ? (selectedProject?.name ?? "Pion")
                  : page === "models"
                    ? "Pion"
                    : t("Settings")}
              </span>
              <span className="slash">/</span>
              <strong>
                {page === "workspace"
                  ? extensionTitle || task?.title || t("New task")
                  : page === "models"
                    ? t("Pi models")
                    : t(
                        page === "plugins"
                          ? "Desktop plugins"
                          : page === "packages"
                            ? "Pi packages"
                            : page === "skills"
                              ? "Pi skills"
                              : page === "panels"
                                ? "Extension panels"
                                : "General",
                      )}
              </strong>
            </div>
            {page === "workspace" && task && (
              <div className="header-actions" ref={headerActions}>
                <label className="view-mode-control">
                  <span className="sr-only">{t("Conversation detail")}</span>
                  <select
                    aria-label={t("Conversation detail")}
                    value={viewMode}
                    onChange={(event) => setConversationView(event.target.value as ViewMode)}
                  >
                    <option value="summary">{t("Summary")}</option>
                    <option value="normal">{t("Normal")}</option>
                    <option value="verbose">{t("Verbose")}</option>
                  </select>
                </label>
                <span className={`connection-pill ${connected ? "connected" : "offline"}`}>
                  <span className="dot" />
                  {t(connected ? "Connected" : "Disconnected")}
                </span>
                <button
                  ref={usageButton}
                  type="button"
                  className="header-button"
                  aria-label={t("Usage")}
                  aria-expanded={usageOpen}
                  onClick={() => showUsage().catch((error) => runtime.notice("Pi", String(error)))}
                >
                  {usageStats?.contextUsage?.percent === undefined
                    ? t("Usage")
                    : t("Context {percent}%", { percent: usageStats.contextUsage.percent })}
                </button>
                {usageOpen && (
                  <section className="header-popover usage-popover" aria-label={t("Usage")}>
                    <strong>{t("Session usage")}</strong>
                    {usageLoading && <p className="muted">{t("Loading…")}</p>}
                    {!!usageError && <p className="error">{usageError}</p>}
                    {usageStats && (
                      <dl>
                        <div>
                          <dt>{t("Context")}</dt>
                          <dd>
                            {usageStats.contextUsage?.tokens?.toLocaleString() ?? "—"} /{" "}
                            {usageStats.contextUsage?.contextWindow?.toLocaleString() ?? "—"}
                          </dd>
                        </div>
                        <div>
                          <dt>{t("Cost")}</dt>
                          <dd>
                            {usageStats.cost === undefined ? "—" : `$${usageStats.cost.toFixed(4)}`}
                          </dd>
                        </div>
                      </dl>
                    )}
                  </section>
                )}
                <button
                  ref={taskMenuButton}
                  type="button"
                  className="header-button task-menu-button"
                  aria-label={t("Task actions")}
                  aria-expanded={taskMenuOpen}
                  onClick={() => {
                    setTaskMenuOpen((open) => !open);
                    setUsageOpen(false);
                  }}
                >
                  •••
                </button>
                {taskMenuOpen && (
                  <div className="header-popover task-menu" role="menu">
                    <button
                      type="button"
                      role="menuitem"
                      disabled={working || busy || sessionBusy}
                      onClick={() => {
                        setTaskMenuOpen(false);
                        openHistory().catch((error) => runtime.notice("Pi", String(error)));
                      }}
                    >
                      {t("History")}
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      disabled={working || busy || sessionBusy}
                      onClick={() => {
                        setTaskMenuOpen(false);
                        branch("clone").catch((error) => runtime.notice("Pi", String(error)));
                      }}
                    >
                      {t("Clone")}
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      disabled={working || busy || sessionBusy}
                      onClick={() => {
                        setTaskMenuOpen(false);
                        setRenameValue(task.title);
                        setRenameOpen(true);
                      }}
                    >
                      {t("Rename")}
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      disabled={working || busy || sessionBusy || !native}
                      onClick={() => {
                        setTaskMenuOpen(false);
                        perform(() => host({ op: "session.export" }));
                      }}
                    >
                      {t("Export HTML")}
                    </button>
                  </div>
                )}
              </div>
            )}
          </header>
        )}
        {!native && (
          <div className="preview-banner">
            {t(
              "Browser preview · Plugin sandbox is live. Run the desktop app to connect your real Pi runtime.",
            )}
          </div>
        )}
        {page === "workspace" && (
          <>
            {!!at("toolbar").length && (
              <div className="slot-toolbar">{at("toolbar").map(panel)}</div>
            )}
            <div className={`workspace-grid ${task ? "has-task" : "new-task"}`}>
              {!!at("sidebar").length && (
                <aside className="slot-side left">{at("sidebar").map(panel)}</aside>
              )}
              <main className="slot-main">
                {task ? (
                  <>
                    {!!backgroundTasks && (
                      <div className="background-tasks" role="status">
                        {t(
                          "{count} tasks are running in the background and may edit their workspaces.",
                          {
                            count: backgroundTasks,
                          },
                        )}
                      </div>
                    )}
                    {!connected && !busy && (
                      <div className="task-recovery" role="status">
                        <span>{t("Connection lost. Reopen this task to continue.")}</span>
                        <button onClick={() => perform(() => openTask({ task }))}>
                          {t("Reopen task")}
                        </button>
                        <button onClick={() => action("core.navigate", "settings")}>
                          {t("Settings")}
                        </button>
                      </div>
                    )}
                    <div
                      className="conversation-surface"
                      inert={busy || opening || sessionBusy || !connected}
                      aria-busy={busy || opening || sessionBusy}
                    >
                      {(!opening || hasChatSnapshot(task.id)) && (
                        <CoreChat
                          key={task.id}
                          taskId={task.id}
                          connected={connected && !opening}
                          initialPrompt={
                            initialPrompt?.taskId === task.id ? initialPrompt.text : undefined
                          }
                          onInitialSent={() => {
                            setInitialPrompt(null);
                            updateNewText("");
                            setNewAttachments([]);
                          }}
                          onWorkingChange={setWorking}
                          onExtensionTitle={setExtensionTitle}
                          extensionStatuses={extensionStatuses}
                          extensionWidgets={extensionWidgets}
                          externalDraft={extensionDraft}
                          onExternalDraftApplied={() => setExtensionDraft(null)}
                          viewMode={viewMode}
                        />
                      )}
                    </div>
                  </>
                ) : (
                  <div className="task-start">
                    <div className="start-heading">
                      <img src={pionMark} alt="" />
                      <h1>{t("What would you like to work on?")}</h1>
                      <p>{t("Start a local Pi task in one of your projects.")}</p>
                    </div>
                    {native && !setupStatus && (
                      <p className="setup-reminder" role="status">
                        {t("Checking Pi…")}
                      </p>
                    )}
                    {native && setupStatus && !setupStatus.modelReady && (
                      <div className="setup-reminder" role="status">
                        <span>{t("Finish Pi setup before starting a task.")}</span>
                        <button type="button" onClick={() => setPage("setup")}>
                          {t("Open Pi setup")}
                        </button>
                      </div>
                    )}
                    <form
                      className="command-form"
                      onDragOver={(event) => event.preventDefault()}
                      onDrop={(event) => {
                        event.preventDefault();
                        importNewImages([...event.dataTransfer.files]).catch((failure) =>
                          setNewImageError(imageFailure(failure)),
                        );
                      }}
                      onSubmit={(event) => {
                        event.preventDefault();
                        if (
                          (newText.trim() || newAttachments.length) &&
                          projectId &&
                          !working &&
                          (!newAttachments.length || draftSupportsImages) &&
                          (!native || setupStatus?.modelReady)
                        )
                          perform(() =>
                            openTask({ projectId, text: newText.trim(), images: newAttachments }),
                          );
                      }}
                    >
                      {!!newAttachments.length && (
                        <div className="attachment-strip" aria-label={t("Image attachments")}>
                          {newAttachments.map((attachment) => (
                            <figure key={attachment.id}>
                              <img
                                src={`data:${attachment.mimeType};base64,${attachment.data}`}
                                alt={attachment.name}
                              />
                              <figcaption>{attachment.name}</figcaption>
                              <button
                                type="button"
                                aria-label={t("Remove {name}", { name: attachment.name })}
                                onClick={() =>
                                  setNewAttachments(
                                    newAttachments.filter((item) => item.id !== attachment.id),
                                  )
                                }
                              >
                                ×
                              </button>
                            </figure>
                          ))}
                        </div>
                      )}
                      {!!newAttachments.length && !draftSupportsImages && (
                        <p className="image-warning" role="alert">
                          {t("The current model does not support image input.")}
                        </p>
                      )}
                      {!!newImageError && (
                        <p className="image-warning" role="alert">
                          {newImageError}
                        </p>
                      )}
                      <input
                        ref={newImagePicker}
                        className="sr-only"
                        type="file"
                        accept="image/png,image/jpeg,image/gif,image/webp"
                        multiple
                        onChange={(event) => {
                          const files = [...(event.target.files ?? [])];
                          event.target.value = "";
                          importNewImages(files).catch((failure) =>
                            setNewImageError(imageFailure(failure)),
                          );
                        }}
                      />
                      <textarea
                        aria-label={t("Describe your task")}
                        placeholder={t("Ask a question, build a feature, or fix a bug…")}
                        value={newText}
                        disabled={busy || working}
                        rows={4}
                        onChange={(event) => updateNewText(event.target.value)}
                        onPaste={(event) => {
                          const files = [...event.clipboardData.files].filter((file) =>
                            file.type.startsWith("image/"),
                          );
                          if (files.length) {
                            event.preventDefault();
                            importNewImages(files).catch((failure) =>
                              setNewImageError(imageFailure(failure)),
                            );
                          }
                        }}
                        onKeyDown={(event) => {
                          if (
                            event.key === "Enter" &&
                            !event.shiftKey &&
                            !event.nativeEvent.isComposing &&
                            event.keyCode !== 229
                          ) {
                            event.preventDefault();
                            event.currentTarget.form?.requestSubmit();
                          }
                        }}
                      />
                      <div className="composer-footer">
                        <div className="new-task-options">
                          <button
                            className="composer-command-button"
                            type="button"
                            aria-label={t("Attach images")}
                            title={t("Attach images")}
                            disabled={busy || working}
                            onClick={() => {
                              if (native)
                                chooseNewImages().catch((failure) =>
                                  setNewImageError(imageFailure(failure)),
                                );
                              else newImagePicker.current?.click();
                            }}
                          >
                            ◇
                          </button>
                          {catalog.projects.length ? (
                            <label className="compact-field">
                              <span className="sr-only">{t("Project")}</span>
                              <select
                                aria-label={t("Project")}
                                value={projectId}
                                disabled={busy || working || preparing}
                                onChange={(event) => setProjectId(event.target.value)}
                              >
                                {catalog.projects.map((project) => (
                                  <option key={project.id} value={project.id}>
                                    {project.name}
                                  </option>
                                ))}
                              </select>
                            </label>
                          ) : (
                            <button
                              type="button"
                              disabled={busy || !native}
                              onClick={() => perform(addProject)}
                            >
                              ＋ {t("Add project")}
                            </button>
                          )}
                          {!!catalog.projects.length && (
                            <>
                              <ModelPicker
                                models={draftModels}
                                value={draftModel}
                                disabled={busy || working || preparing || !draftModels.length}
                                onChange={(value) => {
                                  setDraftModel(value);
                                  localStorage.setItem(`pion.newTaskModel.${projectId}`, value);
                                }}
                              />
                              <label className="compact-field">
                                <span className="sr-only">{t("Thinking")}</span>
                                <select
                                  aria-label={t("Thinking")}
                                  value={draftThinking}
                                  disabled={busy || working || preparing || !draftLevels.length}
                                  onChange={(event) => {
                                    setDraftThinking(event.target.value);
                                    localStorage.setItem(
                                      `pion.newTaskThinking.${projectId}`,
                                      event.target.value,
                                    );
                                  }}
                                >
                                  {draftLevels.map((level) => (
                                    <option key={level} value={level}>
                                      {t("Thinking")} · {level}
                                    </option>
                                  ))}
                                </select>
                              </label>
                              <label className="compact-field">
                                <span className="sr-only">{t("Tool preset")}</span>
                                <select
                                  aria-label={t("Tool preset")}
                                  value={draftToolPreset}
                                  disabled={busy || working || preparing}
                                  onChange={(event) => {
                                    setDraftToolPreset(event.target.value);
                                    localStorage.setItem(
                                      `pion.newTaskToolPreset.${projectId}`,
                                      event.target.value,
                                    );
                                  }}
                                >
                                  <option value="full">{t("Full tools")}</option>
                                  <option value="read-only">{t("Read-only tools")}</option>
                                  <option value="chat">{t("Chat only")}</option>
                                </select>
                              </label>
                            </>
                          )}
                        </div>
                        <button
                          type="submit"
                          className="primary send-button"
                          aria-label={t(busy ? "Opening task…" : "Start task")}
                          title={t(busy ? "Opening task…" : "Start task")}
                          disabled={
                            busy ||
                            preparing ||
                            working ||
                            !projectId ||
                            (!newText.trim() && !newAttachments.length) ||
                            (!!newAttachments.length && !draftSupportsImages) ||
                            (native && !setupStatus?.modelReady)
                          }
                        >
                          ↑
                        </button>
                      </div>
                    </form>
                    <p className="start-hint">
                      {t("Enter to send · Shift + Enter for a new line")}
                    </p>
                    {!!selectedProject && (
                      <p className="trust-hint">
                        <span>{t("Local")}</span>
                        <code>{selectedProject.path}</code>
                        <span>
                          {t(
                            "Tasks use your local Pi configuration and can run tools in the selected project.",
                          )}
                        </span>
                      </p>
                    )}
                  </div>
                )}
                {busy && (
                  <div className="task-loading" role="status">
                    {t("Opening task…")}
                  </div>
                )}
                {at("mainPanel").map(panel)}
              </main>
              {!!at("secondarySidebar").length && (
                <aside className="slot-side right">{at("secondarySidebar").map(panel)}</aside>
              )}
            </div>
            {!!at("bottomPanel").length && (
              <div className="slot-bottom">{at("bottomPanel").map(panel)}</div>
            )}
          </>
        )}
        {page !== "workspace" && page !== "models" && page !== "setup" && (
          <nav className="settings-tabs" aria-label={t("Settings sections")}>
            <button
              className={page === "settings" ? "selected" : ""}
              onClick={() => action("core.navigate", "settings")}
            >
              {t("General")}
            </button>
            <button
              className={page === "plugins" ? "selected" : ""}
              onClick={() => action("core.navigate", "plugins")}
            >
              {t("Desktop plugins")}
            </button>
            <button
              className={page === "packages" ? "selected" : ""}
              onClick={() => action("core.navigate", "packages")}
            >
              {t("Pi packages")}
            </button>
            <button
              className={page === "skills" ? "selected" : ""}
              onClick={() => action("core.navigate", "skills")}
            >
              {t("Pi skills")}
            </button>
            <button
              className={page === "panels" ? "selected" : ""}
              onClick={() => action("core.navigate", "panels")}
            >
              {t("Extension panels")}
            </button>
          </nav>
        )}
        {page === "models" && (
          <main className="management settings">
            <ModelSettings onPackages={() => action("core.navigate", "packages")} />
          </main>
        )}
        {page === "setup" && (
          <main className="management pi-setup">
            <div className="pi-setup-layout">
              <aside className="pi-setup-intro">
                <div className="pi-setup-title-block">
                  <img src={pionMark} alt="" />
                  <span className="pi-setup-kicker">Pion / {t("Pi setup")}</span>
                  <h1>{t("Set up Pi")}</h1>
                  <p>
                    {t(
                      "Pion needs an installed Pi and a model with working authentication before starting a task.",
                    )}
                  </p>
                </div>
                <ol className="pi-setup-progress" aria-label={t("Pi setup")}>
                  <li className={piInstalled ? "complete" : "current"}>
                    <span className="pi-setup-progress-mark" aria-hidden="true">
                      {piInstalled ? "✓" : "01"}
                    </span>
                    <span>
                      <strong>{t("Install Pi")}</strong>
                      <small>
                        {!setupStatus
                          ? t("Checking Pi…")
                          : piInstalled
                            ? t("Pi {version} is installed.", {
                                version: setupStatus.installedVersion ?? "",
                              })
                            : setupStatus.installation === "broken"
                              ? t("The configured Pi executable could not start.")
                              : t("Pi was not found on this computer.")}
                      </small>
                    </span>
                  </li>
                  <li className={piInstalled ? "current" : "pending"}>
                    <span className="pi-setup-progress-mark" aria-hidden="true">
                      02
                    </span>
                    <span>
                      <strong>{t("Choose a model")}</strong>
                      <small>
                        {piInstalled
                          ? t("Choose a model and connect its provider below.")
                          : t("Available after Pi installation")}
                      </small>
                    </span>
                  </li>
                </ol>
              </aside>
              <div className="pi-setup-content">
                {setupBusy && (
                  <div className="pi-setup-working" role="status">
                    <span>{setupProgress}</span>
                    <span className="pi-setup-working-track" aria-hidden="true" />
                  </div>
                )}
                {setupError && (
                  <p className="pi-setup-error" role="alert">
                    {setupError}
                  </p>
                )}
                {!setupBusy && !setupError && setupStatus?.detail && (
                  <p className="pi-setup-error" role="alert">
                    {setupStatus.detail}
                  </p>
                )}
                {setupStatus && (
                  <section className={`pi-setup-step ${piInstalled ? "complete" : "active"}`}>
                    <div className="pi-setup-step-heading">
                      <span className="pi-setup-step-index">01 / PI</span>
                      <h2>{t("Install Pi")}</h2>
                      <p>
                        {piInstalled
                          ? t("Pi {version} is installed.", {
                              version: setupStatus.installedVersion ?? "",
                            })
                          : setupStatus?.installation === "broken"
                            ? t("The configured Pi executable could not start.")
                            : t("Pi was not found on this computer.")}
                      </p>
                    </div>
                    {piInstalled ? (
                      <div className="pi-setup-installed">
                        <code title={setupStatus.executable}>{setupStatus.executable}</code>
                        <button type="button" onClick={() => setSetupPathExpanded((open) => !open)}>
                          {t("Change Pi path")}
                        </button>
                      </div>
                    ) : (
                      <div className="pi-setup-install">
                        <button
                          type="button"
                          className="primary"
                          disabled={setupBusy || !setupStatus?.canInstall}
                          onClick={() => void installPi()}
                        >
                          {t("Install Pi globally")}
                        </button>
                        <p className="settings-note">
                          {t("Global installation requires Node.js 22.19+ and npm.")}{" "}
                          <a
                            href="https://pi.dev/docs/latest/quickstart"
                            target="_blank"
                            rel="noreferrer"
                          >
                            {t("Pi installation guide")}
                          </a>
                        </p>
                      </div>
                    )}
                    {(!piInstalled || setupPathExpanded) && (
                      <form
                        className="pi-setup-path-form"
                        onSubmit={(event) => {
                          event.preventDefault();
                          void savePiPath();
                        }}
                      >
                        <label>
                          {t("Pi executable")}
                          <input
                            value={executable}
                            onChange={(event) => setExecutable(event.target.value)}
                            placeholder={t("pi or an absolute executable path")}
                            required
                          />
                        </label>
                        <button type="submit" disabled={setupBusy}>
                          {t("Check this path")}
                        </button>
                      </form>
                    )}
                  </section>
                )}
                {piInstalled && (
                  <section className="pi-setup-step active pi-setup-model-step">
                    <div className="pi-setup-step-heading">
                      <span className="pi-setup-step-index">02 / MODEL</span>
                      <h2>{t("Choose a model")}</h2>
                      <p>
                        {setupStatus.modelReady
                          ? t("The selected model is ready to use.")
                          : t(
                              "Choose a model and connect its provider below. Pion checks authentication without sending a model request.",
                            )}
                      </p>
                    </div>
                    {!!setupStatus.models?.length && (
                      <div className="pi-setup-model-choice">
                        <span>{t("Model")}</span>
                        <ModelPicker
                          models={setupStatus.models}
                          value={setupModel ? `${setupModel.provider}/${setupModel.id}` : ""}
                          disabled={setupBusy}
                          onChange={(value) => {
                            const separator = value.indexOf("/");
                            const model = {
                              provider: value.slice(0, separator),
                              id: value.slice(separator + 1),
                            };
                            setSetupModel(model);
                            void refreshSetup(model);
                          }}
                        />
                        <button
                          type="button"
                          disabled={setupBusy}
                          onClick={() => void refreshSetup(setupModel)}
                        >
                          {t("Check model again")}
                        </button>
                      </div>
                    )}
                    {!setupStatus.modelReady && (
                      <div className="pi-setup-auth">
                        <ModelSettings
                          embedded
                          onPackages={() => action("core.navigate", "packages")}
                          onChanged={() => void refreshSetup(setupModel)}
                        />
                      </div>
                    )}
                  </section>
                )}
              </div>
            </div>
          </main>
        )}
        {page === "packages" && (
          <main className="management">
            <h1>{t("Pi packages")}</h1>
            <p className="settings-note">
              {t(
                "Pi packages run with your user permissions. Review their source before installing.",
              )}
            </p>
            <form
              className="install-form"
              onSubmit={(event) => {
                event.preventDefault();
                packageAction("install", packageSource.trim(), packageScope).catch((error) =>
                  runtime.notice("Pi", String(error)),
                );
              }}
            >
              <label>
                {t("Package source")}
                <input
                  value={packageSource}
                  maxLength={512}
                  placeholder="npm:package, git:host/repo, URL, /absolute/path"
                  onChange={(event) => setPackageSource(event.target.value)}
                />
              </label>
              <label>
                {t("Install scope")}
                <select
                  value={packageScope}
                  onChange={(event) => setPackageScope(event.target.value as "user" | "project")}
                >
                  <option value="user">{t("User")}</option>
                  {!!projectId && <option value="project">{t("Project")}</option>}
                </select>
              </label>
              <button type="submit" disabled={!native || packageBusy || !packageSource.trim()}>
                {t("Install")}
              </button>
            </form>
            <h3>{t("Installed Pi packages")}</h3>
            {!packageSources.length && <p className="muted">{t("No Pi packages installed.")}</p>}
            {packageSources.map((item) => (
              <article className="plugin-card" key={`${item.scope}:${item.source}`}>
                <span>
                  {item.source} <small>{t(item.scope === "project" ? "Project" : "User")}</small>
                </span>
                <div className="card-actions">
                  <button
                    disabled={packageBusy}
                    onClick={() =>
                      packageAction("update", item.source, item.scope).catch((error) =>
                        runtime.notice("Pi", String(error)),
                      )
                    }
                  >
                    {t("Update")}
                  </button>
                  <button
                    disabled={packageBusy}
                    onClick={() =>
                      packageAction("remove", item.source, item.scope).catch((error) =>
                        runtime.notice("Pi", String(error)),
                      )
                    }
                  >
                    {t("Remove")}
                  </button>
                </div>
              </article>
            ))}
          </main>
        )}
        {page === "skills" && (
          <main className="management">
            <h1>{t("Pi skills")}</h1>
            <p className="settings-note">
              {t(
                "Manage discovered user, project, and Pi package skills here. Install and update packages under Pi packages.",
              )}
            </p>
            {skillScope === "user" ? (
              <label>
                <input
                  type="checkbox"
                  checked={skills.skillCommands.user}
                  disabled={!native || skillBusy}
                  onChange={(event) =>
                    skillCommands(event.target.checked ? "enabled" : "disabled").catch((error) =>
                      runtime.notice("Pi", String(error)),
                    )
                  }
                />
                {t("Show /skill:name commands in the command menu")}
              </label>
            ) : (
              <label>
                {t("Show /skill:name commands in the command menu")}
                <select
                  value={skills.skillCommands.project}
                  disabled={!native || skillBusy}
                  onChange={(event) =>
                    skillCommands(event.target.value as "inherit" | "enabled" | "disabled").catch(
                      (error) => runtime.notice("Pi", String(error)),
                    )
                  }
                >
                  <option value="inherit">{t("Inherit")}</option>
                  <option value="enabled">{t("Enabled")}</option>
                  <option value="disabled">{t("Disabled")}</option>
                </select>
              </label>
            )}
            <form
              className="install-form"
              onSubmit={(event) => {
                event.preventDefault();
                skillAction("add", skillPath.trim()).catch((error) =>
                  runtime.notice("Pi", String(error)),
                );
              }}
            >
              <label>
                {t("Skill file or directory")}
                <input
                  value={skillPath}
                  maxLength={1024}
                  placeholder="/path/to/skill or /path/to/SKILL.md"
                  onChange={(event) => setSkillPath(event.target.value)}
                />
              </label>
              <label>
                {t("Skill scope")}
                <select
                  value={skillScope}
                  onChange={(event) => setSkillScope(event.target.value as "user" | "project")}
                >
                  <option value="user">{t("User")}</option>
                  {!!projectId && <option value="project">{t("Project")}</option>}
                </select>
              </label>
              <button type="submit" disabled={!native || skillBusy || !skillPath.trim()}>
                {t("Add skill")}
              </button>
            </form>
            <h3>{t("Additional skill paths")}</h3>
            {!skills.paths[skillScope].length && (
              <p className="muted">{t("No additional skill paths.")}</p>
            )}
            {skills.paths[skillScope].map((path) => (
              <article className="plugin-card" key={path}>
                <code>{path}</code>
                <button
                  disabled={skillBusy}
                  onClick={() =>
                    skillAction("remove", path).catch((error) =>
                      runtime.notice("Pi", String(error)),
                    )
                  }
                >
                  {t("Remove")}
                </button>
              </article>
            ))}
            <h3>{t("Detected skills")}</h3>
            {!skills.skills.filter((skill) => skillScope === "project" || skill.scope === "user")
              .length && <p className="muted">{t("No Pi skills detected.")}</p>}
            {skills.skills
              .filter((skill) => skillScope === "project" || skill.scope === "user")
              .map((skill) => (
                <article className="plugin-card" key={skill.path}>
                  <div>
                    <strong>{skill.name}</strong>{" "}
                    <small>{t(skill.scope === "project" ? "Project" : "User")}</small>
                    <small>
                      {t(
                        (skillScope === "project" ? skill.enabled : skill.userEnabled)
                          ? "Enabled"
                          : "Disabled",
                      )}
                    </small>
                    <p>
                      <code>{skill.path}</code>
                    </p>
                    {skill.source && <p>{skill.source}</p>}
                  </div>
                  {skillScope === "project" ? (
                    <label>
                      {t("Project override")}
                      <select
                        aria-label={`${t("Project override")} ${skill.name}`}
                        value={skill.projectOverride ?? "inherit"}
                        disabled={skillBusy}
                        onChange={(event) =>
                          skillOverride(
                            skill,
                            event.target.value as "inherit" | "load" | "unload",
                          ).catch((error) => runtime.notice("Pi", String(error)))
                        }
                      >
                        <option value="inherit">{t("Inherit")}</option>
                        <option value="load">{t("Load")}</option>
                        <option value="unload">{t("Unload")}</option>
                      </select>
                    </label>
                  ) : (
                    <button
                      disabled={skillBusy}
                      aria-label={`${t(skill.userEnabled ? "Disable" : "Enable")} ${skill.name}`}
                      onClick={() =>
                        skillToggle(skill).catch((error) => runtime.notice("Pi", String(error)))
                      }
                    >
                      {t(skill.userEnabled ? "Disable" : "Enable")}
                    </button>
                  )}
                </article>
              ))}
          </main>
        )}
        {page === "plugins" && (
          <main className="management">
            <h1>{t("Plugins")}</h1>
            <p className="muted">
              {t("Install a local plugin, review its permissions, and make this space yours.")}
            </p>
            <form
              className="install-form"
              onSubmit={(event) => {
                event.preventDefault();
                action("core.review", path);
              }}
            >
              <label>
                {t("Local plugin folder or ZIP")}
                <input
                  placeholder="/path/to/my-plugin"
                  value={path}
                  onChange={(event) => setPath(event.target.value)}
                />
              </label>
              <button type="submit" disabled={busy || !path || !native}>
                {t("Review installation")}
              </button>
            </form>
            <h3>{t("Installed plugins")}</h3>
            {!installed.length && <p className="muted">{t("No plugins installed yet.")}</p>}
            {installed.map((record) => {
              const m = record.bundle.manifest;
              const state = runtime.plugins.get(m.id);
              return (
                <article className="plugin-card" key={m.id}>
                  <div>
                    <h2>
                      {localized(m.name, m.nameI18n)} <small>{m.version}</small>
                    </h2>
                    <p>
                      {m.id} ·{" "}
                      <span className={state?.state === "crashed" ? "error" : ""}>
                        {state ? t(state.state) : ""}
                      </span>
                    </p>
                    <p className="permission-summary">
                      {m.permissions.join(" · ") || t("No permissions")}
                    </p>
                    {state?.error && (
                      <p role="alert" className="error">
                        {state.error}
                      </p>
                    )}
                  </div>
                  <div className="card-actions">
                    <button
                      disabled={busy}
                      onClick={() =>
                        action("core.plugin", {
                          id: m.id,
                          action: record.enabled ? "disable" : "enable",
                        })
                      }
                    >
                      {t(record.enabled ? "Disable" : "Enable")}
                    </button>
                    <button
                      disabled={busy}
                      onClick={() => action("core.plugin", { id: m.id, action: "reload" })}
                    >
                      {t("Reload")}
                    </button>
                    <button
                      disabled={busy}
                      onClick={() => action("core.plugin", { id: m.id, action: "remove" })}
                    >
                      {t("Uninstall")}
                    </button>
                  </div>
                </article>
              );
            })}
          </main>
        )}
        {page === "panels" && (
          <main className="management settings">
            <h1>{t("Extension panels")}</h1>
            <p className="muted">
              {t("Show, hide, and place the panels contributed by installed desktop plugins.")}
            </p>
            <div className="panel-management-list">
              {!panels.filter((item) => item.owner !== "agent-chat").length && (
                <p className="settings-note">{t("No extension panels are available.")}</p>
              )}
              {panels
                .filter((item) => item.owner !== "agent-chat")
                .map((item) => (
                  <article key={item.id}>
                    <div>
                      <strong>{localized(item.title, item.titleI18n)}</strong>
                      <small>{item.id}</small>
                    </div>
                    <label className="compact-field">
                      <span className="sr-only">
                        {t("Move {title}", { title: localized(item.title, item.titleI18n) })}
                      </span>
                      <select
                        aria-label={t("Move {title}", {
                          title: localized(item.title, item.titleI18n),
                        })}
                        value={layout[item.id]?.location ?? item.location}
                        onChange={(event) =>
                          action("core.layout", { id: item.id, location: event.target.value })
                        }
                      >
                        {locations.map((location) => (
                          <option key={location} value={location}>
                            {t(labels[location])}
                          </option>
                        ))}
                      </select>
                    </label>
                    <button
                      type="button"
                      onClick={() =>
                        action("core.layout", {
                          id: item.id,
                          hidden: !layout[item.id]?.hidden,
                        })
                      }
                    >
                      {t(layout[item.id]?.hidden ? "Show" : "Hide")}
                    </button>
                  </article>
                ))}
            </div>
            {at("settings").map(panel)}
          </main>
        )}
        {page === "settings" && (
          <main className="management settings">
            <h1>{t("General")}</h1>
            <label className="language-setting">
              {t("Language")}
              <select
                value={locale}
                onChange={(event) => action("core.locale", event.target.value)}
              >
                <option value="zh-CN">简体中文</option>
                <option value="en">English</option>
              </select>
              <span className="settings-note">
                {t(
                  "Choose the display language. Changes apply immediately and are saved on this device.",
                )}
              </span>
            </label>
            <label className="language-setting">
              {t("Theme")}
              <select
                aria-label={t("Theme")}
                value={themePreference}
                onChange={(event) => setTheme(event.target.value as ThemePreference)}
              >
                <option value="system">{t("Follow system")}</option>
                <option value="light">{t("Light")}</option>
                <option value="dark">{t("Dark")}</option>
              </select>
              <span className="settings-note">{t("Choose how Pion appears on this device.")}</span>
            </label>
            <p className="muted">
              {t(
                "Pion starts your installed Pi with its existing model and authentication settings.",
              )}
            </p>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                action("core.settings.save");
              }}
            >
              <label>
                {t("Pi executable")}
                <input
                  value={executable}
                  placeholder={t("pi or an absolute executable path")}
                  onChange={(event) => setExecutable(event.target.value)}
                  required
                />
              </label>
              <p className="settings-note">
                {t(
                  "Connecting trusts the selected workspace and its Pi extensions. Pi runs with your user permissions. Tested with Pi 0.87.0.",
                )}
              </p>
              <div className="button-row">
                <button className="primary" disabled={busy || !native} type="submit">
                  {t("Save settings")}
                </button>
                <button
                  type="button"
                  disabled={busy || !connected}
                  onClick={() => action("core.disconnect")}
                >
                  {t("Disconnect")}
                </button>
              </div>
            </form>
            {setupError && (
              <p className="error" role="alert">
                {setupError}
              </p>
            )}
            {piVersionSection()}
            <section className="legacy-sessions">
              <h2>{t("Import Pi CLI sessions")}</h2>
              <p className="settings-note">
                {t(
                  "Copies selected sessions from ~/.pi/agent into Pion. The original files are not changed or kept in sync.",
                )}
              </p>
              <div className="button-row">
                <button
                  type="button"
                  disabled={busy || legacyLoading || !native}
                  onClick={() =>
                    loadLegacySessions().catch((error) => runtime.notice("Pi", String(error)))
                  }
                >
                  {t(legacyLoading ? "Scanning sessions…" : "Scan Pi sessions")}
                </button>
                <button
                  type="button"
                  className="primary"
                  disabled={busy || legacyLoading || !legacySelected.size}
                  onClick={() =>
                    importLegacySessions().catch((error) => runtime.notice("Pi", String(error)))
                  }
                >
                  {t("Import selected sessions")}
                </button>
              </div>
              {!!legacySessions.length && (
                <div className="legacy-session-list">
                  {legacySessions.map((session) => (
                    <label key={session.id}>
                      <input
                        type="checkbox"
                        checked={legacySelected.has(session.id)}
                        onChange={(event) => {
                          const next = new Set(legacySelected);
                          if (event.target.checked) next.add(session.id);
                          else next.delete(session.id);
                          setLegacySelected(next);
                        }}
                      />
                      <span>
                        <strong>{session.title}</strong>
                        <small>
                          {session.projectPath} ·{" "}
                          {t("{count} messages", { count: session.messageCount })}
                        </small>
                      </span>
                    </label>
                  ))}
                </div>
              )}
              {!legacyLoading && !legacySessions.length && (
                <p className="muted">{t("No scanned sessions.")}</p>
              )}
            </section>
          </main>
        )}
        {page !== "setup" && (
          <footer className="statusbar">
            <span>
              <span className={`dot ${connected ? "" : "offline"}`} />
              {translate(locale, status)}
            </span>
            <span>
              {working
                ? t("Working…")
                : task
                  ? t("Local task")
                  : native && !setupStatus
                    ? t("Checking Pi…")
                    : native && !setupStatus?.modelReady
                      ? t("Finish Pi setup before starting a task.")
                      : t("Ready for a new task")}
            </span>
            {at("statusBar").map(panel)}
          </footer>
        )}
      </div>
      {history && (
        <div className="modal-backdrop" onClick={() => setHistory(null)}>
          <section
            className="modal session-history"
            role="dialog"
            aria-modal="true"
            aria-labelledby="session-history-title"
            onClick={(event) => event.stopPropagation()}
          >
            <h2 id="session-history-title">{t("Session history")}</h2>
            <div className="session-tree" role="tree">
              {flatHistoryItems(history.items, history.leafId).map((item) => (
                <div
                  key={item.id}
                  role="treeitem"
                  aria-level={item.depth + 1}
                  aria-current={item.active ? "true" : undefined}
                  style={{ paddingInlineStart: `${Math.min(item.depth, 20) * 16}px` }}
                >
                  {item.active ? "●" : "○"} {item.label}
                </div>
              ))}
            </div>
            <h3>{t("Edit and continue from a user message")}</h3>
            <div className="fork-messages">
              {history.forks.map((message) => (
                <button
                  key={message.entryId}
                  disabled={sessionBusy}
                  onClick={() =>
                    branch("fork", message.entryId).catch((error) =>
                      runtime.notice("Pi", String(error)),
                    )
                  }
                >
                  {message.text}
                </button>
              ))}
            </div>
            <div className="button-row">
              <button type="button" onClick={() => setHistory(null)}>
                {t("Close")}
              </button>
            </div>
          </section>
        </div>
      )}
      {renameOpen && (
        <div className="modal-backdrop">
          <form
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="rename-task-title"
            onSubmit={(event) => {
              event.preventDefault();
              renameTask().catch((error) => runtime.notice("Pi", String(error)));
            }}
          >
            <h2 id="rename-task-title">{t("Rename task and Pi session")}</h2>
            <input
              autoFocus
              aria-label={t("Task name")}
              value={renameValue}
              maxLength={80}
              onChange={(event) => setRenameValue(event.target.value)}
            />
            <div className="button-row">
              <button type="button" disabled={sessionBusy} onClick={() => setRenameOpen(false)}>
                {t("Cancel")}
              </button>
              <button className="primary" disabled={sessionBusy || !renameValue.trim()}>
                {t("Rename")}
              </button>
            </div>
          </form>
        </div>
      )}
      {dialogs.active && (
        <div className="modal-backdrop">
          <form
            ref={extensionDialog}
            className="modal extension-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="extension-dialog-title"
            aria-busy={dialogs.responding}
            onSubmit={(event) => {
              event.preventDefault();
              const request = dialogs.active;
              if (!request) return;
              if (request.method === "confirm")
                answerDialog({ confirmed: true }).catch((error) =>
                  runtime.notice("Pi", String(error)),
                );
              else if (request.method !== "select")
                answerDialog({ value: dialogValue }).catch((error) =>
                  runtime.notice("Pi", String(error)),
                );
            }}
          >
            <h2 id="extension-dialog-title">{plainExtensionText(dialogs.active.title)}</h2>
            {dialogs.active.method === "confirm" && (
              <p>{plainExtensionText(dialogs.active.message)}</p>
            )}
            {dialogs.active.method === "select" && (
              <div className="extension-options" role="listbox">
                {dialogs.active.options.map((option) => (
                  <button
                    type="button"
                    role="option"
                    key={option}
                    disabled={dialogs.responding}
                    onClick={() =>
                      answerDialog({ value: option }).catch((error) =>
                        runtime.notice("Pi", String(error)),
                      )
                    }
                  >
                    {plainExtensionText(option)}
                  </button>
                ))}
              </div>
            )}
            {dialogs.active.method === "input" && (
              <input
                aria-label={plainExtensionText(dialogs.active.title)}
                placeholder={plainExtensionText(dialogs.active.placeholder ?? "")}
                value={dialogValue}
                disabled={dialogs.responding}
                onChange={(event) => setDialogValue(event.target.value)}
              />
            )}
            {dialogs.active.method === "editor" && (
              <textarea
                aria-label={plainExtensionText(dialogs.active.title)}
                value={dialogValue}
                rows={8}
                disabled={dialogs.responding}
                onChange={(event) => setDialogValue(event.target.value)}
              />
            )}
            {dialogs.active.method !== "select" && (
              <div className="button-row">
                <button
                  type="button"
                  disabled={dialogs.responding}
                  onClick={() =>
                    answerDialog(
                      dialogs.active?.method === "confirm"
                        ? { confirmed: false }
                        : { cancelled: true },
                    ).catch((error) => runtime.notice("Pi", String(error)))
                  }
                >
                  {dialogs.active.method === "confirm" ? t("No") : t("Cancel")}
                </button>
                <button className="primary" disabled={dialogs.responding}>
                  {dialogs.responding
                    ? t("Sending…")
                    : dialogs.active.method === "confirm"
                      ? t("Yes")
                      : t("Submit")}
                </button>
              </div>
            )}
            {!!dialogs.queued.length && (
              <small>
                {t("{count} more extension dialogs queued", { count: dialogs.queued.length })}
              </small>
            )}
          </form>
        </div>
      )}
      {review && (
        <div className="modal-backdrop">
          <section className="modal" role="dialog" aria-modal="true" aria-labelledby="review-title">
            <div className="eyebrow">{t("PLUGIN PERMISSIONS")}</div>
            <h2 id="review-title">
              {t("Enable {name}?", {
                name: localized(review.bundle.manifest.name, review.bundle.manifest.nameI18n),
              })}
            </h2>
            <p>
              {t("Version {version} · API {api}", {
                version: review.bundle.manifest.version,
                api: review.bundle.manifest.apiVersion,
              })}
            </p>
            <ul className="permissions">
              {review.bundle.manifest.permissions.map((permission) => (
                <li key={permission} className={permission === "pi.sendMessage" ? "sensitive" : ""}>
                  <strong>{permission}</strong>
                  <p>{t(permissionLabels[permission])}</p>
                </li>
              ))}
            </ul>
            <p className="muted">
              {t(
                "Approval applies to this exact code snapshot. New installs and updates need a new review.",
              )}
            </p>
            <div className="button-row">
              <button disabled={busy} onClick={() => action("core.review.cancel")}>
                {t("Cancel")}
              </button>
              <button
                className="primary"
                disabled={busy}
                onClick={() => action("core.approve", review as unknown as Json)}
              >
                {t("Approve & enable")}
              </button>
            </div>
          </section>
        </div>
      )}
      {palette && (
        <div className="modal-backdrop" onClick={() => setPalette(false)}>
          <section
            className="modal palette"
            role="dialog"
            aria-modal="true"
            aria-label={t("Command palette")}
            onClick={(event) => event.stopPropagation()}
          >
            <input
              autoFocus
              aria-label={t("Search commands")}
              placeholder={t("Find a Desktop command…")}
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
            />
            {pluginCommands.length ? (
              pluginCommands.map((command) => (
                <button
                  key={command.id}
                  onClick={() => {
                    setPalette(false);
                    action(command.id);
                  }}
                >
                  <span>{localized(command.title, command.titleI18n)}</span>
                  <small>{command.id}</small>
                </button>
              ))
            ) : (
              <p className="muted">{t("No matching commands. Enable a plugin to get started.")}</p>
            )}
            {at("commandPalette").map(panel)}
          </section>
        </div>
      )}
      {contextMenu && (
        <div className="modal-backdrop" onClick={() => setContextMenu(false)}>
          <section className="modal" role="menu" onClick={(event) => event.stopPropagation()}>
            {at("contextMenu").map(panel)}
          </section>
        </div>
      )}
      <div className="toasts" aria-live="polite">
        {runtime.notices.map((notice) => (
          <div className="toast" key={notice.id}>
            <div>
              <strong>{notice.owner}</strong>
              <p>{notice.message}</p>
            </div>
            <button
              aria-label={t("Dismiss notification")}
              onClick={() => action("core.dismiss", notice.id)}
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
