import { componentClass } from "../componentClass.ts";
import type { ReactNode } from "react";
import { t } from "../../core/i18n.ts";
import { Icon } from "../primitives/Icon.tsx";
import type { ViewMode } from "./ChatMessage.tsx";
import styles from "./ChatMessage.module.css";

export function ThinkingBlock({
  text,
  viewMode,
  children,
}: {
  text: string;
  viewMode: ViewMode;
  children: ReactNode;
}) {
  if (viewMode === "summary")
    return (
      <div className={componentClass(styles, "thinking-summary")}>{t("Thinking process")}</div>
    );
  return (
    <details
      className={componentClass(styles, "thinking-block")}
      open={viewMode === "verbose" ? true : undefined}
    >
      <summary>
        <Icon name="chevron-right" size={13} />
        <span className={componentClass(styles, "thinking-label")}>{t("Thinking process")}</span>
        <span className={componentClass(styles, "thinking-preview")}>
          {text.trim().split("\n")[0]}
        </span>
      </summary>
      {children}
    </details>
  );
}
