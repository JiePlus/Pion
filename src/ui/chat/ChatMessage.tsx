import { componentClass } from "../componentClass.ts";
import { Icon } from "../primitives/Icon.tsx";
import { useMemo } from "react";
import type { ComponentProps } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { i18n, t } from "../../core/i18n.ts";
import styles from "./ChatMessage.module.css";
import { CodeBlock, CopyButton } from "./CodeBlock.tsx";
import { MessageImage } from "./MessageImage.tsx";
import { ThinkingBlock } from "./ThinkingBlock.tsx";
import { ToolCall } from "./ToolCall.tsx";
import { messageText } from "./messageText.ts";
export { messageText } from "./messageText.ts";

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
      <div className={componentClass(styles, "message-markdown")}>
        {text.length > 100_000 ? (
          <pre className={componentClass(styles, "large-message")}>{text}</pre>
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
  // A deliberate stop reports itself as "stopped"; its "Request was aborted" text is noise.
  const error =
    message.stopReason === "aborted"
      ? ""
      : message.errorMessage || (message.stopReason === "error" ? t("Pi response failed.") : "");
  if (!content.length && !error && !message.stopReason) return null;
  return (
    <article
      className={`${componentClass(styles, "chat-message")} ${componentClass(styles, message.role)} ${streaming ? componentClass(styles, "streaming") : ""}`}
      aria-label={message.role === "user" ? t("You") : "Pi"}
    >
      <div className={componentClass(styles, "message-content")}>
        {content.map((block, index) => {
          if (block.type === "text" && block.text)
            return <Markdown key={index} text={block.text} />;
          if (block.type === "image") return <MessageImage key={index} block={block} />;
          if (block.type === "thinking" && block.thinking?.trim())
            return (
              <ThinkingBlock key={index} text={block.thinking} viewMode={viewMode}>
                <Markdown text={block.thinking} />
              </ThinkingBlock>
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
          <div className={`error ${componentClass(styles, "message-error")}`} role="alert">
            <Icon name="alert" size={15} />
            <span>{error}</span>
          </div>
        )}
        {message.stopReason === "length" && (
          <p className={componentClass(styles, "message-notice")}>
            <Icon name="alert" size={13} />
            {t("Response reached the output limit.")}
          </p>
        )}
        {message.stopReason === "aborted" && (
          <p className={componentClass(styles, "message-notice")}>
            <Icon name="stop" size={11} />
            {t("Response stopped.")}
          </p>
        )}
      </div>
      {!!text && !streaming && (
        <div className={componentClass(styles, "message-actions")}>
          {modelName && <span title={`${message.provider}/${message.model}`}>{modelName}</span>}
          <CopyButton text={text} />
        </div>
      )}
    </article>
  );
}
