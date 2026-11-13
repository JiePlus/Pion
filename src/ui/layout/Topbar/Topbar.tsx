import { StatusDot } from "../../primitives/StatusDot.tsx";
import { Icon } from "../../primitives/Icon.tsx";
import { componentClass } from "../../componentClass.ts";
import type { Dispatch, RefObject, SetStateAction } from "react";
import { host, native } from "../../../core/host.ts";
import type { PiSetupStatus, Task } from "../../../core/host.ts";
import { t } from "../../../core/i18n.ts";
import type { Runtime } from "../../../core/runtime.ts";
import type { ViewMode } from "../../chat/ChatMessage.tsx";
import type { Page } from "../types.ts";
import { MenuItem, Popover } from "../../primitives/Popover.tsx";
import { useRef, useState } from "react";
import type { GitReviewState } from "../../hooks/useGitReview.ts";
import styles from "./Topbar.module.css";

const viewModes = [
  ["summary", "Summary"],
  ["normal", "Normal"],
  ["verbose", "Verbose"],
] as const;

// How much of Pi's process the transcript shows; a glass menu, not a native select.
function ViewModeMenu({
  value,
  onChange,
}: {
  value: ViewMode;
  onChange: (value: ViewMode) => void;
}) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const current = viewModes.find(([mode]) => mode === value)?.[1] ?? "Normal";
  return (
    <span className={componentClass(styles, "view-mode-control")}>
      <button
        ref={trigger}
        type="button"
        className={componentClass(styles, "header-button")}
        aria-label={t("Conversation detail")}
        title={t("Conversation detail")}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((state) => !state)}
      >
        {t(current)}
        <Icon name="chevron-down" size={13} />
      </button>
      <Popover
        open={open}
        onClose={() => setOpen(false)}
        anchor={trigger}
        placement="bottom-end"
        role="menu"
        label={t("Conversation detail")}
      >
        {viewModes.map(([mode, label]) => (
          <MenuItem
            key={mode}
            label={t(label)}
            checked={mode === value}
            onSelect={() => {
              onChange(mode);
              setOpen(false);
              trigger.current?.focus();
            }}
          />
        ))}
      </Popover>
    </span>
  );
}

export interface SessionStats {
  cost?: number;
  tokens?: { input?: number; output?: number };
  contextUsage?: { tokens?: number; contextWindow?: number; percent?: number };
}

interface TopbarProps {
  page: Page;
  projectName: string | undefined;
  extensionTitle: string;
  task: Task | null;
  viewMode: ViewMode;
  setConversationView: (value: ViewMode) => void;
  connected: boolean;
  setupStatus: PiSetupStatus | null;
  headerActions: RefObject<HTMLDivElement | null>;
  runtime: Runtime;
  taskMenuButton: RefObject<HTMLButtonElement | null>;
  taskMenuOpen: boolean;
  setTaskMenuOpen: Dispatch<SetStateAction<boolean>>;
  setUsageOpen: Dispatch<SetStateAction<boolean>>;
  working: boolean;
  busy: boolean;
  sessionBusy: boolean;
  openHistory: () => Promise<void>;
  branch: (kind: "fork" | "clone", entryId?: string) => Promise<void>;
  setRenameValue: Dispatch<SetStateAction<string>>;
  setRenameOpen: Dispatch<SetStateAction<boolean>>;
  perform: (work: () => Promise<unknown>) => void;
  onAddProvider?: () => void;
  review: GitReviewState;
}

export function Topbar({
  page,
  projectName,
  extensionTitle,
  task,
  viewMode,
  setConversationView,
  connected,
  setupStatus,
  headerActions,
  runtime,
  taskMenuButton,
  taskMenuOpen,
  setTaskMenuOpen,
  setUsageOpen,
  working,
  busy,
  sessionBusy,
  openHistory,
  branch,
  setRenameValue,
  setRenameOpen,
  perform,
  onAddProvider,
  review,
}: TopbarProps) {
  return (
    <header className={componentClass(styles, "topbar")}>
      <div className={componentClass(styles, "task-breadcrumb")}>
        <span className="muted">
          {page === "workspace"
            ? (projectName ?? "Pion")
            : page === "models" || page === "packages" || page === "skills"
              ? "Pion"
              : t("Settings")}
        </span>
        <span className={componentClass(styles, "slash")}>/</span>
        <strong>
          {page === "workspace"
            ? extensionTitle || task?.title || t("New task")
            : page === "models" || page === "packages" || page === "skills"
              ? t(
                  page === "models"
                    ? "Model services"
                    : page === "packages"
                      ? "Pi packages"
                      : "Pi skills",
                )
              : t(
                  page === "plugins"
                    ? "Desktop plugins"
                    : page === "panels"
                      ? "Extension panels"
                      : page === "shortcuts"
                        ? "Keyboard shortcuts"
                        : "General",
                )}
        </strong>
      </div>
      {!(page === "workspace" && task) && (
        <div className={componentClass(styles, "page-actions")}>
          {page !== "workspace" && native && !setupStatus?.modelReady && (
            <span className={componentClass(styles, "connection-pill")} role="status">
              <StatusDot offline />
              {t(!setupStatus ? "Checking Pi…" : "Pi setup required")}
            </span>
          )}
          {page === "models" && (
            <button
              type="button"
              className={componentClass(styles, "add-provider")}
              onClick={onAddProvider}
            >
              <Icon name="plus" size={17} />
              {t("Add custom endpoint")}
            </button>
          )}
        </div>
      )}
      {page === "workspace" && task && (
        <div className={componentClass(styles, "header-actions")} ref={headerActions}>
          {review.summary && (
            <button
              type="button"
              className={`${componentClass(styles, "header-button")} ${componentClass(styles, "review-toggle")}`}
              aria-pressed={review.open}
              aria-label={t("Review changes")}
              title={t("Review changes")}
              onClick={() => review.setOpen(!review.open)}
            >
              <Icon name="branch" size={14} />
              {!!review.summary.files && (
                <span className={componentClass(styles, "review-stat")}>
                  <span className={componentClass(styles, "plus")}>
                    +{review.summary.additions ?? 0}
                  </span>
                  <span className={componentClass(styles, "minus")}>
                    −{review.summary.deletions ?? 0}
                  </span>
                </span>
              )}
              {!review.summary.files && t("Review")}
            </button>
          )}
          <ViewModeMenu value={viewMode} onChange={setConversationView} />
          {!connected && (
            <span className={componentClass(styles, "connection-pill")} role="status">
              <StatusDot offline />
              {t("Disconnected")}
            </span>
          )}
          <button
            ref={taskMenuButton}
            type="button"
            className={`${componentClass(styles, "header-button")} ${componentClass(styles, "task-menu-button")}`}
            aria-label={t("Task actions")}
            aria-expanded={taskMenuOpen}
            onClick={() => {
              setTaskMenuOpen((open) => !open);
              setUsageOpen(false);
            }}
          >
            •••
          </button>
          {taskMenuOpen && (
            <div
              className={`${componentClass(styles, "header-popover")} ${componentClass(styles, "task-menu")}`}
              role="menu"
            >
              <button
                type="button"
                role="menuitem"
                disabled={working || busy || sessionBusy}
                onClick={() => {
                  setTaskMenuOpen(false);
                  openHistory().catch((error) => runtime.notice("Pi", String(error)));
                }}
              >
                {t("History")}
              </button>
              <button
                type="button"
                role="menuitem"
                disabled={working || busy || sessionBusy}
                onClick={() => {
                  setTaskMenuOpen(false);
                  branch("clone").catch((error) => runtime.notice("Pi", String(error)));
                }}
              >
                {t("Clone")}
              </button>
              <button
                type="button"
                role="menuitem"
                disabled={working || busy || sessionBusy}
                onClick={() => {
                  setTaskMenuOpen(false);
                  setRenameValue(task.title);
                  setRenameOpen(true);
                }}
              >
                {t("Rename")}
              </button>
              <button
                type="button"
                role="menuitem"
                disabled={working || busy || sessionBusy || !native}
                onClick={() => {
                  setTaskMenuOpen(false);
                  perform(() => host({ op: "session.export" }));
                }}
              >
                {t("Export HTML")}
              </button>
            </div>
          )}
        </div>
      )}
    </header>
  );
}
