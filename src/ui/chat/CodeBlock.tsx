import { componentClass } from "../componentClass.ts";
import { useEffect, useRef, useState } from "react";
import type { ComponentProps } from "react";
import { t } from "../../core/i18n.ts";
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
      {t(status === "copied" ? "Copied" : status === "failed" ? "Copy failed" : "Copy")}
    </button>
  );
}

export function CodeBlock({ children }: ComponentProps<"pre">) {
  const code = useRef<HTMLPreElement>(null);
  return (
    <div className={componentClass(styles, "code-block")}>
      <div className={componentClass(styles, "code-toolbar")}>
        <CopyButton text={() => code.current?.textContent ?? ""} />
      </div>
      <pre ref={code}>{children}</pre>
    </div>
  );
}
