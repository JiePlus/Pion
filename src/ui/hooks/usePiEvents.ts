import { useEffect } from "react";
import type { RetryState } from "../chat/ChatTranscript.tsx";
import type { Dispatch, RefObject, SetStateAction } from "react";
import type { PiEvent } from "../../core/api.ts";
import { applyAssistantDelta } from "../../core/chat-stream.ts";
import { hostEvents } from "../../core/host.ts";
import { t } from "../../core/i18n.ts";
import { queueFromEvent } from "../../core/pi-events.ts";
import type { Message, Tool } from "../chat/ChatMessage.tsx";

interface PiEventState {
  taskId: string;
  /** Only the visible chat follows Pi; resident hidden chats ignore its events. */
  active: boolean;
  setWorking: Dispatch<SetStateAction<boolean>>;
  setError: Dispatch<SetStateAction<string>>;
  setStream: Dispatch<SetStateAction<Message | null>>;
  setTools: Dispatch<SetStateAction<Map<string, Tool>>>;
  setMessages: Dispatch<SetStateAction<Message[]>>;
  setRetry: Dispatch<SetStateAction<RetryState | null>>;
  setQueue: Dispatch<SetStateAction<{ steering: string[]; followUp: string[] }>>;
  setCompaction: Dispatch<
    SetStateAction<{
      summary: string;
      tokensBefore: number;
      estimatedTokensAfter: number;
    } | null>
  >;
  saveDraft: (value: string) => void;
  composer: RefObject<HTMLTextAreaElement | null>;
  onExtensionTitle: (title: string) => void;
}

export function usePiEvents({
  taskId,
  active,
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
}: PiEventState) {
  useEffect(() => {
    if (!active) return;
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
        // The failure that triggered the retry lives on the retry card, not as a second error line.
        setRetry({
          attempt: Number(event.attempt ?? 0),
          maxAttempts: Number(event.maxAttempts ?? 0),
          delayMs: Number(event.delayMs ?? 0),
          error: String(event.errorMessage ?? ""),
          startedAt: Date.now(),
        });
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
  }, [active, onExtensionTitle, taskId]);
}
