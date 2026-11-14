import { Icon } from "../primitives/Icon.tsx";
import { componentClass } from "../componentClass.ts";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Dispatch, RefObject, SetStateAction } from "react";
import type { Json } from "../../core/api.ts";
import { t } from "../../core/i18n.ts";
import { ChatMessage } from "./ChatMessage.tsx";
import type { Message, Tool, ViewMode } from "./ChatMessage.tsx";
import styles from "./ChatTranscript.module.css";

/** Messages rendered at first, and added per "Show earlier messages". */
export const TRANSCRIPT_PAGE = 150;

interface ChatTranscriptProps {
  messages: Message[];
  stream: Message | null;
  models: { provider: string; id: string; name?: string }[];
  toolResults: Map<string, Tool>;
  viewMode: ViewMode;
  working: boolean;
  retry: RetryState | null;
  compaction: { summary: string; tokensBefore: number; estimatedTokensAfter: number } | null;
  syncError: string;
  error: string;
  scroll: RefObject<HTMLDivElement | null>;
  conversation: RefObject<HTMLDivElement | null>;
  follow: RefObject<boolean>;
  setShowLatest: Dispatch<SetStateAction<boolean>>;
  showLatest: boolean;
  configure: (command: string, args: Record<string, Json>) => Promise<boolean>;
  readPi: (full: boolean) => Promise<unknown>;
  setSyncError: Dispatch<SetStateAction<string>>;
  queue: { steering: string[]; followUp: string[] };
  clearQueue: (restore: boolean) => Promise<void>;
  setError: Dispatch<SetStateAction<string>>;
  /** Pi is connected; until then an empty transcript is still loading, not empty. */
  connected: boolean;
}

export function ChatTranscript({
  messages,
  stream,
  models,
  toolResults,
  viewMode,
  working,
  retry,
  compaction,
  syncError,
  error,
  scroll,
  conversation,
  follow,
  setShowLatest,
  showLatest,
  configure,
  readPi,
  setSyncError,
  queue,
  clearQueue,
  setError,
  connected,
}: ChatTranscriptProps) {
  // Long conversations render only their latest page; earlier pages load on request.
  const [shown, setShown] = useState(TRANSCRIPT_PAGE);
  const hidden = Math.max(0, messages.length - shown);
  const anchor = useRef<number | null>(null);
  function showEarlier() {
    const node = scroll.current;
    // Keep the message being read in place while earlier ones are added above it.
    if (node) anchor.current = node.scrollHeight - node.scrollTop;
    setShown((count) => count + TRANSCRIPT_PAGE);
  }
  useLayoutEffect(() => {
    const node = scroll.current;
    if (node && anchor.current !== null) node.scrollTop = node.scrollHeight - anchor.current;
    anchor.current = null;
  }, [shown]);
  return (
    <>
      <div className={componentClass(styles, "chat-viewport")}>
        <div
          className={componentClass(styles, "chat-scroll")}
          ref={scroll}
          onScroll={(event) => {
            const node = event.currentTarget;
            follow.current = node.scrollHeight - node.scrollTop - node.clientHeight < 80;
            setShowLatest(!follow.current);
          }}
        >
          <div className={componentClass(styles, "chat-messages")} ref={conversation}>
            {connected && !messages.length && !stream && !working && (
              <h1>{t("What would you like to work on?")}</h1>
            )}
            {!!hidden && (
              <button
                type="button"
                className={componentClass(styles, "earlier-messages")}
                onClick={showEarlier}
              >
                {t("Show {count} earlier messages", {
                  count: Math.min(hidden, TRANSCRIPT_PAGE),
                })}
              </button>
            )}
            {messages.slice(hidden).map((message, index) => (
              <ChatMessage
                key={hidden + index}
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
            {working && !retry && (
              <WorkingIndicator activity={currentActivity(stream, messages, toolResults)} />
            )}
            {retry && <RetryCard retry={retry} onCancel={() => configure("abort_retry", {})} />}
            {compaction && (
              <details className={componentClass(styles, "compaction-card")}>
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
              <div className={`error ${componentClass(styles, "transcript-error")}`} role="alert">
                <Icon name="alert" size={15} />
                <span>{error}</span>
              </div>
            )}
          </div>
        </div>
        {showLatest && (
          <button
            className={componentClass(styles, "scroll-to-latest")}
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
        <section
          className={componentClass(styles, "message-queue")}
          aria-label={t("Queued messages")}
        >
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
    </>
  );
}

export interface RetryState {
  attempt: number;
  maxAttempts: number;
  delayMs: number;
  error?: string;
  startedAt?: number;
}

// Elapsed seconds since the current turn started; one quiet tick per second.
function useElapsed(since: number) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return Math.max(0, Math.floor((now - since) / 1000));
}

// What Pi is doing right now, in words: the newest running tool, else thinking or replying.
function currentActivity(stream: Message | null, messages: Message[], tools: Map<string, Tool>) {
  for (const message of [stream, ...[...messages].reverse()]) {
    if (!message || typeof message.content === "string") continue;
    const blocks = message.content ?? [];
    for (const block of [...blocks].reverse()) {
      if (block.type !== "toolCall" || tools.get(block.id ?? "")?.status !== "running") continue;
      const args = block.arguments ?? {};
      const path =
        String(args.path ?? args.file_path ?? "")
          .split("/")
          .pop() ?? "";
      const command = String(args.command ?? "").split("\n")[0];
      const target = command.length > 48 ? `${command.slice(0, 47)}…` : command;
      if (block.name === "read" && path) return t("Reading {target}", { target: path });
      if ((block.name === "edit" || block.name === "write") && path)
        return t("Editing {target}", { target: path });
      if (block.name === "bash" && target) return t("Running {target}", { target });
      if (["grep", "find", "ls"].includes(block.name ?? ""))
        return t("Searching {target}", { target: String(args.pattern ?? path) });
      return t("Using {tool}", { tool: block.name ?? "tool" });
    }
  }
  const last = typeof stream?.content === "string" ? null : stream?.content?.at(-1);
  if (last?.type === "thinking") return t("Thinking…");
  if (last?.type === "text") return t("Writing a reply…");
  return t("Working…");
}

// The one place that says Pi is busy: a glass pill with the current action and elapsed time.
function WorkingIndicator({ activity }: { activity: string }) {
  const [since] = useState(Date.now);
  const seconds = useElapsed(since);
  return (
    <div className={componentClass(styles, "chat-working")} role="status">
      <span className={componentClass(styles, "working-dot")} aria-hidden="true" />
      <span className={componentClass(styles, "working-label")}>{activity}</span>
      {seconds >= 2 && <span className={componentClass(styles, "working-time")}>{seconds}s</span>}
    </div>
  );
}

// One amber card for the whole retry: countdown, the failure that caused it, and a way out.
function RetryCard({ retry, onCancel }: { retry: RetryState; onCancel: () => void }) {
  const [since] = useState(() => retry.startedAt ?? Date.now());
  const elapsed = useElapsed(since);
  const total = Math.ceil(retry.delayMs / 1000);
  const remaining = Math.max(0, total - elapsed);
  return (
    <div className={componentClass(styles, "retry-card")} role="status">
      <span className={componentClass(styles, "retry-icon")} aria-hidden="true">
        <Icon name="clock" size={16} />
      </span>
      <div className={componentClass(styles, "retry-text")}>
        <strong>
          {t("Retry {attempt}/{max} in {seconds}s", {
            attempt: retry.attempt,
            max: retry.maxAttempts,
            seconds: remaining,
          })}
        </strong>
        {!!retry.error && <code>{retry.error}</code>}
      </div>
      <button type="button" onClick={onCancel}>
        {t("Cancel retry")}
      </button>
      <span
        className={componentClass(styles, "retry-bar")}
        aria-hidden="true"
        style={{ animationDuration: `${retry.delayMs}ms` }}
        key={retry.attempt}
      />
    </div>
  );
}
