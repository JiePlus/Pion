import { StatusDot } from "../primitives/StatusDot.tsx";
import { componentClass } from "../componentClass.ts";
import { t } from "../../core/i18n.ts";
import type { ContentBlock, Message, Tool, ViewMode } from "./ChatMessage.tsx";
import { MessageImage } from "./MessageImage.tsx";
import { messageText } from "./messageText.ts";
import styles from "./ChatMessage.module.css";

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

export function ToolCall({
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
      <div
        className={`${componentClass(styles, "tool-call")} ${componentClass(styles, "tool-call-summary")} ${componentClass(styles, tool?.status ?? "pending")}`}
      >
        <StatusDot />
        <span className={componentClass(styles, "tool-name")}>{block.name ?? "tool"}</span>
        <span className={componentClass(styles, "tool-preview")}>{String(preview)}</span>
        <small>{status}</small>
      </div>
    );
  return (
    <details
      className={`${componentClass(styles, "tool-call")} ${componentClass(styles, tool?.status ?? "pending")}`}
      open={viewMode === "verbose" ? true : undefined}
    >
      <summary>
        <StatusDot />
        <span className={componentClass(styles, "tool-name")}>{block.name ?? "tool"}</span>
        <span className={componentClass(styles, "tool-preview")}>{String(preview)}</span>
        <small>{status}</small>
      </summary>
      <div className={componentClass(styles, "tool-details")}>
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
