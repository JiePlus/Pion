import { Icon } from "../primitives/Icon.tsx";
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
  const state = tool?.status ?? "pending";
  const head = (
    <>
      <StatusIcon state={state} />
      <span className={componentClass(styles, "tool-name")}>{block.name ?? "tool"}</span>
      <code className={componentClass(styles, "tool-preview")}>{String(preview)}</code>
      <small className={componentClass(styles, "tool-status")}>{status}</small>
    </>
  );
  if (viewMode === "summary")
    return (
      <div
        className={`${componentClass(styles, "tool-call")} ${componentClass(styles, "tool-call-summary")} ${componentClass(styles, state)}`}
      >
        {head}
      </div>
    );
  return (
    <details
      className={`${componentClass(styles, "tool-call")} ${componentClass(styles, state)}`}
      open={viewMode === "verbose" ? true : undefined}
    >
      <summary>
        {head}
        <Icon className={componentClass(styles, "tool-chevron")} name="chevron-right" size={14} />
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

// State reads from the icon first: spinning while running, a check when done, a warning on
// failure, a hollow ring while pending or after an interruption.
function StatusIcon({ state }: { state: string }) {
  return (
    <span
      className={`${componentClass(styles, "tool-icon")} ${componentClass(styles, state)}`}
      aria-hidden="true"
    >
      {state === "completed" && <Icon name="check" size={13} />}
      {state === "failed" && <Icon name="alert" size={13} />}
    </span>
  );
}
