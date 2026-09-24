import { StatusDot } from "../primitives/StatusDot.tsx";
import { componentClass } from "../componentClass.ts";
import type { Dispatch, RefObject, SetStateAction } from "react";
import type { Json } from "../../core/api.ts";
import { t } from "../../core/i18n.ts";
import { ChatMessage } from "./ChatMessage.tsx";
import type { Message, Tool, ViewMode } from "./ChatMessage.tsx";
import styles from "./ChatTranscript.module.css";

interface ChatTranscriptProps {
  messages: Message[];
  stream: Message | null;
  models: { provider: string; id: string; name?: string }[];
  toolResults: Map<string, Tool>;
  viewMode: ViewMode;
  working: boolean;
  retry: { attempt: number; maxAttempts: number; delayMs: number } | null;
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
}: ChatTranscriptProps) {
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
              <div className={componentClass(styles, "chat-working")} role="status">
                <StatusDot />
                <span className={componentClass(styles, "working-label")}>{t("Working…")}</span>
              </div>
            )}
            {retry && (
              <div className={componentClass(styles, "retry-card")} role="status">
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
              <p className="error" role="alert">
                {error}
              </p>
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
