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
import styles from "./Topbar.module.css";

export interface SessionStats {
  cost?: number;
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
  usageButton: RefObject<HTMLButtonElement | null>;
  usageOpen: boolean;
  showUsage: () => Promise<void>;
  runtime: Runtime;
  usageStats: SessionStats | null;
  usageLoading: boolean;
  usageError: string;
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
  usageButton,
  usageOpen,
  showUsage,
  runtime,
  usageStats,
  usageLoading,
  usageError,
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
          <label className={componentClass(styles, "view-mode-control")}>
            <span className="sr-only">{t("Conversation detail")}</span>
            <select
              aria-label={t("Conversation detail")}
              value={viewMode}
              onChange={(event) => setConversationView(event.target.value as ViewMode)}
            >
              <option value="summary">{t("Summary")}</option>
              <option value="normal">{t("Normal")}</option>
              <option value="verbose">{t("Verbose")}</option>
            </select>
          </label>
          {!connected && (
            <span className={componentClass(styles, "connection-pill")} role="status">
              <StatusDot offline />
              {t("Disconnected")}
            </span>
          )}
          <button
            ref={usageButton}
            type="button"
            className={componentClass(styles, "header-button")}
            aria-expanded={usageOpen}
            onClick={() => showUsage().catch((error) => runtime.notice("Pi", String(error)))}
          >
            {usageStats?.contextUsage?.percent === undefined
              ? t("Usage")
              : t("Context {percent}%", { percent: usageStats.contextUsage.percent.toFixed(2) })}
          </button>
          {usageOpen && (
            <section
              className={`${componentClass(styles, "header-popover")} ${componentClass(styles, "usage-popover")}`}
              aria-label={t("Usage")}
            >
              <strong>{t("Session usage")}</strong>
              {usageLoading && <p className="muted">{t("Loading…")}</p>}
              {!!usageError && <p className="error">{usageError}</p>}
              {usageStats && (
                <dl>
                  <div>
                    <dt>{t("Context")}</dt>
                    <dd>
                      {usageStats.contextUsage?.tokens?.toLocaleString() ?? "—"} /{" "}
                      {usageStats.contextUsage?.contextWindow?.toLocaleString() ?? "—"}
                    </dd>
                  </div>
                  <div>
                    <dt>{t("Cost")}</dt>
                    <dd>
                      {usageStats.cost === undefined ? "—" : `$${usageStats.cost.toFixed(4)}`}
                    </dd>
                  </div>
                </dl>
              )}
            </section>
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
