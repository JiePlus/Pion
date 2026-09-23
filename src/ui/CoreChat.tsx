import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Json, PiEvent } from "../core/api.ts";
import {
  attachmentDraft,
  imageFailure,
  importImageFiles,
  pickImages,
  setAttachmentDraft,
} from "../core/attachments.ts";
import type { ImageAttachment } from "../core/attachments.ts";
import { applyAssistantDelta } from "../core/chat-stream.ts";
import { host, hostEvents, native } from "../core/host.ts";
import { t } from "../core/i18n.ts";
import { queueFromEvent } from "../core/pi-events.ts";
import { ChatMessage } from "./ChatMessage.tsx";
import type { Message, Tool, ViewMode } from "./ChatMessage.tsx";
import { ModelPicker } from "./ModelPicker.tsx";

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

  useEffect(() => {
    const dispose = hostEvents.on("pi:event", (value) => {
      const event = value as PiEvent;
      if (event.type === "agent_start") {
        setWorking(true);
        setError("");
      }
      if (event.type === "agent_settled") {
        setWorking(false);
        setStream(null);
        setTools(
          (items) =>
            new Map(
              [...items].map(([id, tool]) => [
                id,
                tool.status === "running" ? { ...tool, status: "interrupted" as const } : tool,
              ]),
            ),
        );
      }
      if (event.type === "message_start" && (event.message as Message)?.role === "assistant") {
        setStream(event.message as Message);
      }
      if (event.type === "message_update" && (event.message as Message)?.role === "assistant") {
        setStream(event.message as Message);
      } else if (event.type === "message_update" && event.assistantMessageEvent) {
        setStream((message) =>
          applyAssistantDelta(
            message,
            event.assistantMessageEvent as Parameters<typeof applyAssistantDelta>[1],
          ),
        );
      }
      if (event.type === "message_end") {
        const message = event.message as Message;
        if (message) setMessages((items) => [...items, message]);
        if (message?.role === "assistant") setStream(null);
      }
      if (event.type === "tool_execution_start") {
        setTools((items) => new Map(items).set(String(event.toolCallId), { status: "running" }));
      }
      if (event.type === "tool_execution_update" || event.type === "tool_execution_end") {
        setTools((items) =>
          new Map(items).set(String(event.toolCallId), {
            status:
              event.type === "tool_execution_update"
                ? "running"
                : event.isError
                  ? "failed"
                  : "completed",
            result: event.type === "tool_execution_update" ? event.partialResult : event.result,
          }),
        );
      }
      if (event.type === "auto_retry_end" && event.success) setError("");
      if (event.type === "auto_retry_end") setRetry(null);
      if (event.type === "auto_retry_start") {
        setRetry({
          attempt: Number(event.attempt ?? 0),
          maxAttempts: Number(event.maxAttempts ?? 0),
          delayMs: Number(event.delayMs ?? 0),
        });
        setError(t("Pi is retrying: {error}", { error: String(event.errorMessage ?? "") }));
      }
      if (event.type === "extension_error")
        setError(String(event.error ?? t("Pi extension failed")));
      if (event.type === "desktop_extension_ui_error") setError(String(event.error ?? ""));
      if (event.type === "queue_update") setQueue(queueFromEvent(event));
      if (event.type === "compaction_end" && event.result) {
        const result = event.result as {
          summary?: string;
          tokensBefore?: number;
          estimatedTokensAfter?: number;
        };
        setCompaction({
          summary: result.summary ?? "",
          tokensBefore: result.tokensBefore ?? 0,
          estimatedTokensAfter: result.estimatedTokensAfter ?? 0,
        });
      }
      if (event.type === "extension_ui_request" && event.method === "set_editor_text") {
        saveDraft(String(event.text ?? ""));
        requestAnimationFrame(() => composer.current?.focus());
      }
      if (event.type === "extension_ui_request" && event.method === "setTitle")
        onExtensionTitle(String(event.title ?? ""));
    });
    return dispose;
  }, [onExtensionTitle, taskId]);

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
    <section className="core-chat" aria-label={t("Pi conversation")}>
      {!!visibleExtensionStatuses.length && (
        <div className="extension-statuses" role="status">
          {visibleExtensionStatuses.map(([key, text]) => (
            <span key={key}>{text}</span>
          ))}
        </div>
      )}
      <div className="chat-viewport">
        <div
          className="chat-scroll"
          ref={scroll}
          onScroll={(event) => {
            const node = event.currentTarget;
            follow.current = node.scrollHeight - node.scrollTop - node.clientHeight < 80;
            setShowLatest(!follow.current);
          }}
        >
          <div className="chat-messages" ref={conversation}>
            {!messages.length && !stream && !working && (
              <h1>{t("What would you like to work on?")}</h1>
            )}
            {messages.map((message, index) => (
              <ChatMessage
                key={index}
                message={message}
                models={models}
                tools={toolResults}
                viewMode={viewMode}
              />
            ))}
            {stream && (
              <ChatMessage
                message={stream}
                models={models}
                tools={toolResults}
                streaming
                viewMode={viewMode}
              />
            )}
            {working && (
              <div className="chat-working" role="status">
                <span className="dot" />
                {t("Working…")}
              </div>
            )}
            {retry && (
              <div className="retry-card" role="status">
                <span>
                  {t("Retry {attempt}/{max} in {seconds}s", {
                    attempt: retry.attempt,
                    max: retry.maxAttempts,
                    seconds: Math.ceil(retry.delayMs / 1000),
                  })}
                </span>
                <button type="button" onClick={() => configure("abort_retry", {})}>
                  {t("Cancel retry")}
                </button>
              </div>
            )}
            {compaction && (
              <details className="compaction-card">
                <summary>{t("Compaction summary")}</summary>
                <p>{compaction.summary}</p>
                <small>
                  {t("{before} → about {after} tokens", {
                    before: compaction.tokensBefore,
                    after: compaction.estimatedTokensAfter,
                  })}
                </small>
              </details>
            )}
            {!!syncError && (
              <div className="error" role="alert">
                {t("Showing cached messages. Synchronization failed.")} {syncError}
                <button
                  type="button"
                  onClick={() => readPi(false).catch((failure) => setSyncError(String(failure)))}
                >
                  {t("Retry sync")}
                </button>
              </div>
            )}
            {!!error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
          </div>
        </div>
        {showLatest && (
          <button
            className="scroll-to-latest"
            type="button"
            onClick={() => {
              follow.current = true;
              if (scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight;
              setShowLatest(false);
            }}
          >
            ↓ {t("Scroll to latest")}
          </button>
        )}
      </div>

      {!!(queue.steering.length || queue.followUp.length) && (
        <section className="message-queue" aria-label={t("Queued messages")}>
          <div>
            {[
              ...queue.steering.map((text) => ["Steer", text]),
              ...queue.followUp.map((text) => ["Follow-up", text]),
            ].map(([kind, text], index) => (
              <span key={`${kind}-${index}`}>
                <strong>{t(kind as "Steer" | "Follow-up")}</strong> {text}
              </span>
            ))}
          </div>
          <button
            type="button"
            onClick={() => clearQueue(true).catch((failure) => setError(String(failure)))}
          >
            {t("Move queue to editor")}
          </button>
          <button
            type="button"
            onClick={() => clearQueue(false).catch((failure) => setError(String(failure)))}
          >
            {t("Clear queue")}
          </button>
        </section>
      )}

      {aboveWidgets.map(([key, widget]) => (
        <pre className="extension-widget" key={key}>
          {widget.lines.join("\n")}
        </pre>
      ))}

      <form
        className="core-composer"
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          importFiles([...event.dataTransfer.files]).catch((failure) =>
            setError(imageFailure(failure)),
          );
        }}
        onSubmit={(event) => {
          event.preventDefault();
          send().catch((failure) => setError(String(failure)));
        }}
      >
        {customCompactOpen && (
          <div className="custom-compact" role="group" aria-label={t("Custom compaction")}>
            <textarea
              aria-label={t("Compaction instructions")}
              placeholder={t("What should Pi preserve in the summary?")}
              value={customCompactText}
              maxLength={4096}
              rows={3}
              onChange={(event) => setCustomCompactText(event.target.value)}
            />
            <div className="button-row">
              <button type="button" onClick={() => setCustomCompactOpen(false)}>
                {t("Cancel")}
              </button>
              <button
                type="button"
                className="primary"
                disabled={!connected || working || !customCompactText.trim()}
                onClick={async () => {
                  if (
                    await configure("compact", {
                      customInstructions: customCompactText.trim(),
                    })
                  ) {
                    setCustomCompactText("");
                    setCustomCompactOpen(false);
                  }
                }}
              >
                {t("Compact with instructions")}
              </button>
            </div>
          </div>
        )}
        {!!attachments.length && (
          <div className="attachment-strip" aria-label={t("Image attachments")}>
            {attachments.map((attachment) => (
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
                    saveAttachments(attachments.filter((item) => item.id !== attachment.id))
                  }
                >
                  ×
                </button>
              </figure>
            ))}
          </div>
        )}
        {!!attachments.length && !supportsImages && (
          <p className="image-warning" role="alert">
            {t("The current model does not support image input.")}
          </p>
        )}
        <input
          ref={picker}
          className="sr-only"
          type="file"
          accept="image/png,image/jpeg,image/gif,image/webp"
          multiple
          onChange={(event) => {
            const files = [...(event.target.files ?? [])];
            event.target.value = "";
            importFiles(files).catch((failure) => setError(imageFailure(failure)));
          }}
        />
        {!!matchingCommands.length && (
          <div className="slash-command-menu" role="listbox" aria-label={t("Pi command")}>
            {matchingCommands.map((command) => (
              <button
                key={command.name}
                type="button"
                role="option"
                onClick={() => {
                  saveDraft(`/${command.name} `);
                  requestAnimationFrame(() => composer.current?.focus());
                }}
              >
                <strong>/{command.name}</strong>
                {!!command.description && <span>{command.description}</span>}
              </button>
            ))}
          </div>
        )}
        <textarea
          ref={composer}
          aria-label={t("Ask Pi to explore, build, or fix something…")}
          placeholder={t(
            working
              ? "Steer now or queue a follow-up…"
              : "Ask Pi to explore, build, or fix something…",
          )}
          value={draft}
          disabled={!connected || sending}
          rows={1}
          onChange={(event) => saveDraft(event.target.value)}
          onPaste={(event) => {
            const files = [...event.clipboardData.files].filter((file) =>
              file.type.startsWith("image/"),
            );
            if (files.length) {
              event.preventDefault();
              importFiles(files).catch((failure) => setError(imageFailure(failure)));
            }
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape" && moreOpen) {
              event.preventDefault();
              setMoreOpen(false);
              moreButton.current?.focus();
              return;
            }
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
        <div className="core-composer-footer">
          <div className="composer-options">
            <button
              ref={moreButton}
              className="composer-command-button"
              type="button"
              aria-label={t("More options")}
              aria-expanded={moreOpen}
              title={t("More options")}
              onClick={() => setMoreOpen((open) => !open)}
            >
              +
            </button>
            <button
              className="composer-command-button"
              type="button"
              aria-label={t("Attach images")}
              title={t("Attach images")}
              disabled={!connected}
              onClick={() => {
                if (native) chooseImages().catch((failure) => setError(imageFailure(failure)));
                else picker.current?.click();
              }}
            >
              ◇
            </button>
            <ModelPicker
              models={models}
              value={activeModel}
              disabled={working || !connected}
              onChange={(value) => {
                const model = models.find((item) => `${item.provider}/${item.id}` === value);
                if (model) configure("set_model", { provider: model.provider, modelId: model.id });
              }}
            />
            <label className="compact-field tool-preset composer-tool-preset">
              <span className="sr-only">{t("Tool preset")}</span>
              <select
                aria-label={t("Tool preset")}
                title={t(
                  "Tool presets change tools exposed to the model; Pi extensions remain trusted code.",
                )}
                value={toolPreset}
                disabled={working || !connected}
                onChange={(event) => configure("set_tool_preset", { preset: event.target.value })}
              >
                {toolPreset === "custom" && (
                  <option value="custom" disabled>
                    {t("Custom tools")}
                  </option>
                )}
                <option value="full">{t("Full tools")}</option>
                <option value="read-only">{t("Read-only tools")}</option>
                <option value="chat">{t("Chat only")}</option>
              </select>
            </label>
          </div>
          {moreOpen && (
            <div
              className="composer-more"
              ref={more}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  setMoreOpen(false);
                  moreButton.current?.focus();
                }
              }}
            >
              <div className="composer-options">
                <button
                  className="queue-button"
                  type="button"
                  disabled={working || !connected}
                  title={t("Compact the current Pi context")}
                  onClick={() => configure("compact", {})}
                >
                  {t("Compact")}
                </button>
                <button
                  className="queue-button"
                  type="button"
                  disabled={working || !connected}
                  onClick={() => setCustomCompactOpen((open) => !open)}
                >
                  {t("Custom compaction")}
                </button>
                <button
                  className="composer-command-button"
                  type="button"
                  aria-label={t("Pi command")}
                  title={t("Pi command")}
                  disabled={!connected}
                  onClick={() => {
                    if (!draft.trim()) saveDraft("/");
                    setMoreOpen(false);
                    requestAnimationFrame(() => composer.current?.focus());
                  }}
                >
                  /
                </button>
                <label className="compact-field queue-mode">
                  <span className="sr-only">{t("Steering mode")}</span>
                  <select
                    aria-label={t("Steering mode")}
                    value={state.steeringMode ?? "one-at-a-time"}
                    disabled={working || !connected}
                    onChange={(event) =>
                      configure("set_steering_mode", { mode: event.target.value })
                    }
                  >
                    <option value="one-at-a-time">{t("Steer one at a time")}</option>
                    <option value="all">{t("Steer all")}</option>
                  </select>
                </label>
                <label className="compact-field queue-mode">
                  <span className="sr-only">{t("Follow-up mode")}</span>
                  <select
                    aria-label={t("Follow-up mode")}
                    value={state.followUpMode ?? "one-at-a-time"}
                    disabled={working || !connected}
                    onChange={(event) =>
                      configure("set_follow_up_mode", { mode: event.target.value })
                    }
                  >
                    <option value="one-at-a-time">{t("Follow up one at a time")}</option>
                    <option value="all">{t("Follow up all")}</option>
                  </select>
                </label>
                <label className="compact-field">
                  <span className="sr-only">{t("Automatic compaction")}</span>
                  <select
                    aria-label={t("Automatic compaction")}
                    value={state.autoCompactionEnabled === false ? "off" : "on"}
                    disabled={working || !connected}
                    onChange={(event) =>
                      configure("set_auto_compaction", { enabled: event.target.value === "on" })
                    }
                  >
                    <option value="on">{t("Auto compact on")}</option>
                    <option value="off">{t("Auto compact off")}</option>
                  </select>
                </label>
                <label className="compact-field">
                  <span className="sr-only">{t("Automatic retry")}</span>
                  <select
                    aria-label={t("Automatic retry")}
                    value={autoRetry === null ? "unknown" : autoRetry ? "on" : "off"}
                    disabled={working || !connected}
                    onChange={async (event) => {
                      const enabled = event.target.value === "on";
                      if (await configure("set_auto_retry", { enabled })) setAutoRetry(enabled);
                    }}
                  >
                    {autoRetry === null && (
                      <option value="unknown" disabled>
                        {t("Set automatic retry")}
                      </option>
                    )}
                    <option value="on">{t("Auto retry on")}</option>
                    <option value="off">{t("Auto retry off")}</option>
                  </select>
                </label>
              </div>
              <div className="composer-more-settings">
                <label className="compact-field">
                  <span className="sr-only">{t("Thinking")}</span>
                  <select
                    aria-label={t("Thinking")}
                    value={state.thinkingLevel ?? "off"}
                    disabled={working || !connected}
                    onChange={(event) =>
                      configure("set_thinking_level", { level: event.target.value })
                    }
                  >
                    {levels.map((level) => (
                      <option key={level} value={level}>
                        {t("Thinking")} · {level}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </div>
          )}
          <div className="composer-actions">
            {working && (
              <button
                className="queue-button queue-next-button"
                type="button"
                disabled={sending || !draft.trim()}
                onClick={() => send("follow_up").catch((failure) => setError(String(failure)))}
              >
                {t("Queue next")}
              </button>
            )}
            {working && (
              <button
                className="stop-button"
                type="button"
                aria-label={t("Stop agent")}
                title={t("Stop agent")}
                onClick={() => stop().catch((failure) => setError(String(failure)))}
              >
                ■
              </button>
            )}
            <button
              className="primary send-button"
              type="submit"
              aria-label={sending ? t("Sending…") : working ? t("Steer") : t("Send to Pi")}
              title={sending ? t("Sending…") : working ? t("Steer") : t("Send to Pi")}
              disabled={
                sending ||
                !connected ||
                (!draft.trim() && !attachments.length) ||
                (!!attachments.length && !supportsImages)
              }
            >
              ↑
            </button>
          </div>
        </div>
      </form>
      {belowWidgets.map(([key, widget]) => (
        <pre className="extension-widget" key={key}>
          {widget.lines.join("\n")}
        </pre>
      ))}
    </section>
  );
}
