import { useEffect, useMemo, useRef, useState } from "react";
import type { ComponentProps } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { i18n, t } from "../core/i18n.ts";

export interface ContentBlock {
  type: string;
  text?: string;
  thinking?: string;
  id?: string;
  name?: string;
  arguments?: Record<string, unknown>;
  data?: string;
  mimeType?: string;
}
export interface Message {
  role: string;
  content?: string | ContentBlock[];
  provider?: string;
  model?: string;
  toolCallId?: string;
  toolName?: string;
  isError?: boolean;
  errorMessage?: string;
  stopReason?: string;
}
export interface Tool {
  status: "running" | "completed" | "failed" | "interrupted";
  result?: unknown;
}
export type ViewMode = "summary" | "normal" | "verbose";

interface Model {
  provider: string;
  id: string;
  name?: string;
}

function modelDisplayName(message: Message, models: Model[]): string {
  if (!message.provider || !message.model) return "";
  const provider = message.provider.toLowerCase();
  const model = message.model.toLowerCase();
  return (
    models.find(
      (item) =>
        item.provider.toLowerCase() === provider &&
        (item.id.toLowerCase() === model || model.endsWith(`/${item.id.toLowerCase()}`)),
    )?.name ?? `${message.provider}/${message.model}`
  );
}

export function messageText(message: Message): string {
  if (typeof message.content === "string") return message.content;
  return (message.content ?? [])
    .filter((part) => part.type === "text")
    .map((part) => part.text ?? "")
    .join("\n");
}

function toolOutput(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "object" && "content" in value) {
    const content = (value as Message).content;
    if (typeof content === "string" || Array.isArray(content))
      return messageText({ role: "toolResult", content });
  }
  return JSON.stringify(value, null, 2) ?? "";
}

function CopyButton({ text }: { text: string | (() => string) }) {
  const [status, setStatus] = useState<"idle" | "copied" | "failed">("idle");
  useEffect(() => {
    if (status === "idle") return;
    const timer = setTimeout(() => setStatus("idle"), 2000);
    return () => clearTimeout(timer);
  }, [status]);
  return (
    <button
      type="button"
      className="copy-button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(typeof text === "function" ? text() : text);
          setStatus("copied");
        } catch {
          setStatus("failed");
        }
      }}
    >
      {t(status === "copied" ? "Copied" : status === "failed" ? "Copy failed" : "Copy")}
    </button>
  );
}

function CodeBlock({ children }: ComponentProps<"pre">) {
  const code = useRef<HTMLPreElement>(null);
  return (
    <div className="code-block">
      <div className="code-toolbar">
        <CopyButton text={() => code.current?.textContent ?? ""} />
      </div>
      <pre ref={code}>{children}</pre>
    </div>
  );
}

const markdownComponents = {
  pre: CodeBlock,
  a: ({ href, children }: ComponentProps<"a">) => (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  ),
  // Remote images require a separate host capability; preserve their link in the meantime.
  img: ({ src, alt }: ComponentProps<"img">) => (
    <a href={typeof src === "string" ? src : undefined} target="_blank" rel="noopener noreferrer">
      {alt || t("Image")}
    </a>
  ),
};
const markdownPlugins = [remarkGfm];

function Markdown({ text }: { text: string }) {
  const locale = i18n.getLocale();
  // Streaming updates should not reparse the Markdown in every earlier message.
  return useMemo(
    () => (
      <div className="message-markdown">
        {text.length > 100_000 ? (
          <pre className="large-message">{text}</pre>
        ) : (
          <ReactMarkdown remarkPlugins={markdownPlugins} components={markdownComponents} skipHtml>
            {text}
          </ReactMarkdown>
        )}
      </div>
    ),
    [text, locale],
  );
}

function MessageImage({ block }: { block: ContentBlock }) {
  if (!block.data || !/^image\/(png|jpeg|gif|webp)$/.test(block.mimeType ?? "")) return null;
  return (
    <img
      className="message-image"
      src={`data:${block.mimeType};base64,${block.data}`}
      alt={t("Image")}
      loading="lazy"
    />
  );
}

function ToolCall({
  block,
  tool,
  viewMode,
}: {
  block: ContentBlock;
  tool?: Tool;
  viewMode: ViewMode;
}) {
  const args = block.arguments ?? {};
  const preview = args.command ?? args.path ?? args.file_path ?? args.pattern ?? "";
  const output = toolOutput(tool?.result);
  const result = tool?.result as Message | undefined;
  const status = t(
    !tool
      ? "Pending"
      : tool.status === "running"
        ? "Running…"
        : tool.status === "failed"
          ? "Failed"
          : tool.status === "interrupted"
            ? "Interrupted"
            : "Completed",
  );
  if (viewMode === "summary")
    return (
      <div className={`tool-call tool-call-summary ${tool?.status ?? "pending"}`}>
        <span className="dot" />
        <span className="tool-name">{block.name ?? "tool"}</span>
        <span className="tool-preview">{String(preview)}</span>
        <small>{status}</small>
      </div>
    );
  return (
    <details
      className={`tool-call ${tool?.status ?? "pending"}`}
      open={viewMode === "verbose" ? true : undefined}
    >
      <summary>
        <span className="dot" />
        <span className="tool-name">{block.name ?? "tool"}</span>
        <span className="tool-preview">{String(preview)}</span>
        <small>{status}</small>
      </summary>
      <div className="tool-details">
        <h4>{t("Input")}</h4>
        <pre>{JSON.stringify(args, null, 2)}</pre>
        {!!output && (
          <>
            <h4>{t("Output")}</h4>
            <pre>{output}</pre>
          </>
        )}
        {Array.isArray(result?.content) &&
          result.content.map((part, index) =>
            part.type === "image" ? <MessageImage key={index} block={part} /> : null,
          )}
      </div>
    </details>
  );
}

export function ChatMessage({
  message,
  models = [],
  tools,
  streaming = false,
  viewMode = "normal",
}: {
  message: Message;
  models?: Model[];
  tools: Map<string, Tool>;
  streaming?: boolean;
  viewMode?: ViewMode;
}) {
  if (message.role !== "user" && message.role !== "assistant") return null;
  const content =
    typeof message.content === "string"
      ? [{ type: "text", text: message.content }]
      : (message.content ?? []);
  const text = messageText(message);
  const modelName = message.role === "assistant" ? modelDisplayName(message, models) : "";
  const error =
    message.errorMessage || (message.stopReason === "error" ? t("Pi response failed.") : "");
  if (!content.length && !error && !message.stopReason) return null;
  return (
    <article
      className={`chat-message ${message.role}${streaming ? " streaming" : ""}`}
      aria-label={message.role === "user" ? t("You") : "Pi"}
    >
      <div className="message-content">
        {content.map((block, index) => {
          if (block.type === "text" && block.text)
            return <Markdown key={index} text={block.text} />;
          if (block.type === "image") return <MessageImage key={index} block={block} />;
          if (block.type === "thinking" && block.thinking?.trim())
            if (viewMode === "summary")
              return (
                <div className="thinking-summary" key={index}>
                  {t("Thinking process")}
                </div>
              );
            else
              return (
                <details
                  className="thinking-block"
                  key={index}
                  open={viewMode === "verbose" ? true : undefined}
                >
                  <summary>
                    <span>{t("Thinking process")}</span>
                    <span className="thinking-preview">{block.thinking.trim().split("\n")[0]}</span>
                  </summary>
                  <Markdown text={block.thinking} />
                </details>
              );
          if (block.type === "toolCall")
            return (
              <ToolCall
                key={`${block.id ?? index}-${viewMode}`}
                block={block}
                tool={tools.get(block.id ?? "")}
                viewMode={viewMode}
              />
            );
          return null;
        })}
        {!!error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {message.stopReason === "length" && (
          <p className="message-notice">{t("Response reached the output limit.")}</p>
        )}
        {message.stopReason === "aborted" && (
          <p className="message-notice">{t("Response stopped.")}</p>
        )}
      </div>
      {!!text && !streaming && (
        <div className="message-actions">
          {modelName && <span title={`${message.provider}/${message.model}`}>{modelName}</span>}
          <CopyButton text={text} />
        </div>
      )}
    </article>
  );
}
