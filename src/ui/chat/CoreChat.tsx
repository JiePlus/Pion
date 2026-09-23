import { componentClass } from "../componentClass.ts";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Json } from "../../core/api.ts";
import {
  attachmentDraft,
  imageFailure,
  importImageFiles,
  pickImages,
  setAttachmentDraft,
} from "../../core/attachments.ts";
import type { ImageAttachment } from "../../core/attachments.ts";
import { host, native } from "../../core/host.ts";
import { t } from "../../core/i18n.ts";
import { ChatTranscript } from "./ChatTranscript.tsx";
import { usePiEvents } from "../hooks/usePiEvents.ts";
import type { Message, Tool, ViewMode } from "./ChatMessage.tsx";
import { ChatComposer } from "./ChatComposer.tsx";
import styles from "./CoreChat.module.css";

interface Model {
  provider: string;
  id: string;
  name?: string;
  input?: string[];
}
interface State {
  model?: Model;
  thinkingLevel?: string;
  isStreaming?: boolean;
  isCompacting?: boolean;
  steeringMode?: "all" | "one-at-a-time";
  followUpMode?: "all" | "one-at-a-time";
  autoCompactionEnabled?: boolean;
}
interface Command {
  name: string;
  description?: string;
  source?: string;
}

interface ChatSnapshot {
  messages: Message[];
  state: State;
  models: Model[];
  levels: string[];
  commands: Command[];
  queue: { steering: string[]; followUp: string[] };
}
const snapshots = new Map<string, ChatSnapshot>();
export function hasChatSnapshot(taskId: string) {
  return snapshots.has(taskId);
}

export function CoreChat({
  taskId,
  connected,
  initialPrompt,
  onInitialSent,
  onWorkingChange,
  onExtensionTitle,
  extensionStatuses,
  extensionWidgets,
  externalDraft,
  onExternalDraftApplied,
  viewMode,
}: {
  taskId: string;
  connected: boolean;
  initialPrompt?: string;
  onInitialSent: () => void;
  onWorkingChange: (working: boolean) => void;
  onExtensionTitle: (title: string) => void;
  extensionStatuses: Map<string, string>;
  extensionWidgets: Map<string, { lines: string[]; placement: "aboveEditor" | "belowEditor" }>;
  externalDraft: string | null;
  onExternalDraftApplied: () => void;
  viewMode: ViewMode;
}) {
  const cached = snapshots.get(taskId);
  const [messages, setMessages] = useState<Message[]>(cached?.messages ?? []);
  const [stream, setStream] = useState<Message | null>(null);
  const [tools, setTools] = useState(new Map<string, Tool>());
  const [working, setWorking] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [syncError, setSyncError] = useState("");
  const [draft, setDraft] = useState(() => localStorage.getItem(`pion.draft.${taskId}`) ?? "");
  const [state, setState] = useState<State>(cached?.state ?? {});
  const [models, setModels] = useState<Model[]>(cached?.models ?? []);
  const [levels, setLevels] = useState<string[]>(cached?.levels ?? []);
  const [commands, setCommands] = useState<Command[]>(cached?.commands ?? []);
  const [attachments, setAttachments] = useState<ImageAttachment[]>(() => attachmentDraft(taskId));
  const [queue, setQueue] = useState<{ steering: string[]; followUp: string[] }>(
    cached?.queue ?? {
      steering: [],
      followUp: [],
    },
  );
  const [compaction, setCompaction] = useState<{
    summary: string;
    tokensBefore: number;
    estimatedTokensAfter: number;
  } | null>(null);
  const [retry, setRetry] = useState<{
    attempt: number;
    maxAttempts: number;
    delayMs: number;
  } | null>(null);
  const [autoRetry, setAutoRetry] = useState<boolean | null>(null);
  const [customCompactOpen, setCustomCompactOpen] = useState(false);
  const [customCompactText, setCustomCompactText] = useState("");
  const scroll = useRef<HTMLDivElement>(null);
  const conversation = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  const [showLatest, setShowLatest] = useState(false);
  const composer = useRef<HTMLTextAreaElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const more = useRef<HTMLDivElement>(null);
  const moreButton = useRef<HTMLButtonElement>(null);
  const sendingRef = useRef(false);

  useEffect(() => {
    snapshots.set(taskId, { messages, state, models, levels, commands, queue });
  }, [taskId, messages, state, models, levels, commands, queue]);

  useEffect(() => {
    if (!moreOpen) return;
    const close = (event: PointerEvent) => {
      if (
        !more.current?.contains(event.target as Node) &&
        !moreButton.current?.contains(event.target as Node)
      ) {
        setMoreOpen(false);
      }
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setMoreOpen(false);
        moreButton.current?.focus();
      }
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", escape);
    };
  }, [moreOpen]);

  useLayoutEffect(() => {
    if (!composer.current) return;
    composer.current.style.height = "auto";
    composer.current.style.height = `${Math.min(composer.current.scrollHeight, 180)}px`;
  }, [draft]);

  function saveDraft(value: string) {
    setDraft(value);
    if (value) localStorage.setItem(`pion.draft.${taskId}`, value);
    else localStorage.removeItem(`pion.draft.${taskId}`);
  }

  function saveAttachments(value: ImageAttachment[]) {
    setAttachments(value);
    setAttachmentDraft(taskId, value);
  }

  async function readPi(full: boolean) {
    const nextState = await host<State>({ op: "pi", command: "get_state", args: {} });
    setState(nextState);
    setWorking(!!nextState.isStreaming || !!nextState.isCompacting);
    const history = await host<{ messages: Message[] }>({
      op: "pi",
      command: "get_messages",
      args: {},
    });
    setMessages(history.messages);
    setSyncError("");
    setTools(new Map());
    if (!full) return nextState;
    const available = await host<{ models: Model[] }>({
      op: "pi",
      command: "get_models",
      args: {},
    });
    setModels(available.models);
    const thinking = await host<{ levels: string[] }>({
      op: "pi",
      command: "get_thinking_levels",
      args: {},
    });
    setLevels(thinking.levels);
    const availableCommands = await host<{ commands: Command[] }>({
      op: "pi",
      command: "get_commands",
      args: {},
    });
    setCommands(availableCommands.commands);
    return nextState;
  }

  useEffect(() => {
    onWorkingChange(working);
  }, [onWorkingChange, working]);

  usePiEvents({
    taskId,
    setWorking,
    setError,
    setStream,
    setTools,
    setMessages,
    setRetry,
    setQueue,
    setCompaction,
    saveDraft,
    composer,
    onExtensionTitle,
  });

  useEffect(() => {
    if (externalDraft === null) return;
    saveDraft(externalDraft);
    onExternalDraftApplied();
    requestAnimationFrame(() => composer.current?.focus());
  }, [externalDraft, onExternalDraftApplied]);

  useEffect(() => {
    let live = true;
    async function restore() {
      if (!connected) return;
      try {
        const nextState = await readPi(!cached);
        if (initialPrompt !== undefined && live) {
          if (attachments.length && !nextState.model?.input?.includes("image")) return;
          setWorking(true);
          await host({
            op: "pi",
            command: "prompt",
            args: { message: initialPrompt, images: attachments },
          });
          if (live) {
            saveDraft("");
            saveAttachments([]);
            onInitialSent();
          }
        }
      } catch (failure) {
        if (live) {
          setWorking(false);
          if (cached) setSyncError(String(failure));
          else setError(String(failure));
        }
      }
    }
    restore().catch((failure) => live && setError(String(failure)));
    return () => {
      live = false;
    };
  }, [connected, taskId]);

  useLayoutEffect(() => {
    const node = scroll.current;
    if (node && follow.current) node.scrollTop = node.scrollHeight;
  }, [messages, stream, tools, working, error]);

  useEffect(() => {
    const node = scroll.current;
    const content = conversation.current;
    if (!node || !content) return;
    const observer = new ResizeObserver(() => {
      if (follow.current) node.scrollTop = node.scrollHeight;
      setShowLatest(node.scrollHeight - node.scrollTop - node.clientHeight > 80);
    });
    observer.observe(content);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  async function send(command?: "prompt" | "steer" | "follow_up") {
    const message = draft.trim();
    if (sendingRef.current || (!message && !attachments.length) || !connected) return;
    if (attachments.length && !state.model?.input?.includes("image")) return;
    const previousDraft = draft;
    const previousAttachments = attachments;
    const wasWorking = working;
    sendingRef.current = true;
    setSending(true);
    setError("");
    follow.current = true;
    const commandName = /^\/(\S+)/.exec(message)?.[1];
    const extensionCommand = commands.some(
      (item) => item.name === commandName && item.source === "extension",
    );
    saveDraft("");
    saveAttachments([]);
    try {
      if (!wasWorking && !extensionCommand) setWorking(true);
      await host({
        op: "pi",
        command: extensionCommand ? "prompt" : (command ?? (wasWorking ? "steer" : "prompt")),
        args: { message, images: previousAttachments },
      });
      if (initialPrompt !== undefined) onInitialSent();
    } catch (failure) {
      saveDraft(previousDraft);
      saveAttachments(previousAttachments);
      if (!wasWorking && !extensionCommand) setWorking(false);
      setError(String(failure));
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  }

  async function importFiles(files: File[]) {
    saveAttachments(await importImageFiles(attachments, files));
  }

  async function chooseImages() {
    saveAttachments(await pickImages(attachments));
  }

  async function clearQueue(restore: boolean) {
    const removed = await host<{ steering: string[]; followUp: string[] }>({
      op: "pi",
      command: "clear_queue",
      args: {},
    });
    setQueue({ steering: [], followUp: [] });
    if (restore)
      saveDraft([...removed.steering, ...removed.followUp, draft].filter(Boolean).join("\n"));
  }

  async function stop() {
    await clearQueue(true);
    await configure("abort", {});
  }

  async function configure(command: string, args: Record<string, Json>) {
    try {
      await host({ op: "pi", command, args });
      if (
        [
          "set_model",
          "set_thinking_level",
          "set_steering_mode",
          "set_follow_up_mode",
          "set_auto_compaction",
        ].includes(command)
      ) {
        const nextState = await host<State>({ op: "pi", command: "get_state", args: {} });
        setState(nextState);
      }
      setError("");
      return true;
    } catch (failure) {
      setError(String(failure));
      return false;
    }
  }

  const toolResults = new Map<string, Tool>();
  for (const message of messages) {
    if (Array.isArray(message.content)) {
      for (const block of message.content) {
        if (block.type === "toolCall" && block.id && !working)
          toolResults.set(block.id, { status: "interrupted" });
      }
    }
    if (message.role === "toolResult" && message.toolCallId)
      toolResults.set(message.toolCallId, {
        status: message.isError ? "failed" : "completed",
        result: message,
      });
  }
  for (const [id, tool] of tools) toolResults.set(id, tool);
  const activeModel = state.model ? `${state.model.provider}/${state.model.id}` : "";
  const supportsImages = !!state.model?.input?.includes("image");
  const aboveWidgets = [...extensionWidgets.entries()].filter(
    ([, widget]) => widget.placement === "aboveEditor",
  );
  const belowWidgets = [...extensionWidgets.entries()].filter(
    ([, widget]) => widget.placement === "belowEditor",
  );
  const commandText = draft.trimStart();
  const commandQuery =
    commandText.startsWith("/") && !commandText.includes(" ")
      ? commandText.slice(1).toLowerCase()
      : null;
  const matchingCommands =
    commandQuery === null
      ? []
      : commands
          .filter(
            (command) =>
              command.name !== "pion-core-tools" &&
              (command.name.toLowerCase().includes(commandQuery) ||
                !!command.description?.toLowerCase().includes(commandQuery)),
          )
          .slice(0, 8);
  const toolPresetStatus = extensionStatuses.get("pion-core-tool-preset");
  const toolPreset = ["full", "read-only", "chat"].includes(toolPresetStatus ?? "")
    ? toolPresetStatus!
    : "custom";
  const visibleExtensionStatuses = [...extensionStatuses].filter(
    ([key]) => key !== "pion-core-tool-preset",
  );
  return (
    <section className={componentClass(styles, "core-chat")} aria-label={t("Pi conversation")}>
      {!!visibleExtensionStatuses.length && (
        <div className={componentClass(styles, "extension-statuses")} role="status">
          {visibleExtensionStatuses.map(([key, text]) => (
            <span key={key}>{text}</span>
          ))}
        </div>
      )}
      <ChatTranscript
        messages={messages}
        stream={stream}
        models={models}
        toolResults={toolResults}
        viewMode={viewMode}
        working={working}
        retry={retry}
        compaction={compaction}
        syncError={syncError}
        error={error}
        scroll={scroll}
        conversation={conversation}
        follow={follow}
        setShowLatest={setShowLatest}
        showLatest={showLatest}
        configure={configure}
        readPi={readPi}
        setSyncError={setSyncError}
        queue={queue}
        clearQueue={clearQueue}
        setError={setError}
      />

      {aboveWidgets.map(([key, widget]) => (
        <pre className={componentClass(styles, "extension-widget")} key={key}>
          {widget.lines.join("\n")}
        </pre>
      ))}

      <ChatComposer
        connected={connected}
        working={working}
        sending={sending}
        draft={draft}
        attachments={attachments}
        supportsImages={supportsImages}
        customCompactOpen={customCompactOpen}
        setCustomCompactOpen={setCustomCompactOpen}
        customCompactText={customCompactText}
        setCustomCompactText={setCustomCompactText}
        picker={picker}
        composer={composer}
        moreButton={moreButton}
        more={more}
        moreOpen={moreOpen}
        setMoreOpen={setMoreOpen}
        matchingCommands={matchingCommands}
        models={models}
        activeModel={activeModel}
        toolPreset={toolPreset}
        state={state}
        autoRetry={autoRetry}
        setAutoRetry={setAutoRetry}
        levels={levels}
        importFiles={importFiles}
        chooseImages={chooseImages}
        send={send}
        stop={stop}
        configure={configure}
        saveDraft={saveDraft}
        saveAttachments={saveAttachments}
        setError={setError}
      />
      {belowWidgets.map(([key, widget]) => (
        <pre className={componentClass(styles, "extension-widget")} key={key}>
          {widget.lines.join("\n")}
        </pre>
      ))}
    </section>
  );
}
