import { componentClass } from "../componentClass.ts";
import { isValidElement, useEffect, useRef, useState } from "react";
import type { ComponentProps } from "react";
import { t } from "../../core/i18n.ts";
import { Icon } from "../primitives/Icon.tsx";
import styles from "./ChatMessage.module.css";

export function CopyButton({ text }: { text: string | (() => string) }) {
  const [status, setStatus] = useState<"idle" | "copied" | "failed">("idle");
  useEffect(() => {
    if (status === "idle") return;
    const timer = setTimeout(() => setStatus("idle"), 2000);
    return () => clearTimeout(timer);
  }, [status]);
  return (
    <button
      type="button"
      className={componentClass(styles, "copy-button")}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(typeof text === "function" ? text() : text);
          setStatus("copied");
        } catch {
          setStatus("failed");
        }
      }}
    >
      <Icon name={status === "copied" ? "check" : "copy"} size={13} />
      {t(status === "copied" ? "Copied" : status === "failed" ? "Copy failed" : "Copy")}
    </button>
  );
}

// Markdown marks fenced code with a "language-xyz" class on the inner <code>.
function languageOf(children: unknown) {
  if (!isValidElement<{ className?: string }>(children)) return "";
  return /language-([\w+#-]+)/.exec(children.props.className ?? "")?.[1] ?? "";
}

export function CodeBlock({ children }: ComponentProps<"pre">) {
  const code = useRef<HTMLPreElement>(null);
  const language = languageOf(children);
  return (
    <div className={componentClass(styles, "code-block")}>
      <div className={componentClass(styles, "code-toolbar")}>
        <Icon name="terminal" size={13} />
        <span className={componentClass(styles, "code-language")}>{language || "text"}</span>
        <CopyButton text={() => code.current?.textContent ?? ""} />
      </div>
      <pre ref={code}>{children}</pre>
    </div>
  );
}
