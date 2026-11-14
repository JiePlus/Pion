import utilityStyles from "../primitives/Utilities.module.css";
import { Button } from "../primitives/Button.tsx";
import { componentClass } from "../componentClass.ts";
import type { ReactNode } from "react";
import type { Json } from "../../core/api.ts";
import { plainExtensionText } from "../../core/extension-ui.ts";
import { localized, t } from "../../core/i18n.ts";
import type { MessageKey } from "../../core/i18n.ts";
import type { PanelView, Runtime } from "../../core/runtime.ts";
import { flatHistoryItems } from "../../core/session-tree.ts";
import type { useShellController } from "../hooks/useShellController.ts";
import styles from "./ShellDialogs.module.css";
import { Dialog } from "../primitives/Dialog.tsx";

const permissionLabels: Record<string, MessageKey> = {
  "pi.read": "Read Pi sessions, messages, tool events, and model information",
  "pi.sendMessage":
    "High risk: drive Pi tasks; its tools may write files, execute commands, or access the network",
  "workspace.read": "Read text files in the current workspace",
  "workspace.write": "Write files only under the allowlisted workspace paths",
  "workspace.git": "Read Git status and diffs in the current workspace",
  "network.fetch": "Make network requests only to allowlisted hosts, proxied through the host",
  storage: "Read and write this plugin’s own persistent data",
  notifications: "Show in-app notifications",
};
const sensitivePermissions = new Set(["pi.sendMessage", "workspace.write", "network.fetch"]);

export function ShellDialogs({
  controller,
  runtime,
  panel,
}: {
  controller: ReturnType<typeof useShellController>;
  runtime: Runtime;
  panel: (view: PanelView) => ReactNode;
}) {
  const {
    history,
    setHistory,
    sessionBusy,
    branch,
    renameOpen,
    setRenameOpen,
    renameTask,
    renameValue,
    setRenameValue,
    dialogs,
    extensionDialog,
    answerDialog,
    dialogValue,
    setDialogValue,
    review,
    busy,
    action,
    palette,
    setPalette,
    filter,
    setFilter,
    at,
    contextMenu,
    setContextMenu,
  } = controller;
  const pluginCommands = [...runtime.plugins.values()]
    .flatMap((item) => (item.state === "active" ? item.manifest.contributes.commands : []))
    .filter(
      (command) =>
        runtime.commands.has(command.id) &&
        `${localized(command.title, command.titleI18n)} ${command.title} ${command.id}`
          .toLowerCase()
          .includes(filter.toLowerCase()),
    );
  return (
    <>
      {history && (
        <Dialog
          titleId="session-history-title"
          onClose={() => setHistory(null)}
          className={componentClass(styles, "session-history")}
        >
          <h2 id="session-history-title">{t("Session history")}</h2>
          <div className={componentClass(styles, "session-tree")} role="tree">
            {flatHistoryItems(history.items, history.leafId).map((item) => (
              <div
                key={item.id}
                role="treeitem"
                aria-level={item.depth + 1}
                aria-current={item.active ? "true" : undefined}
                style={{ paddingInlineStart: `${Math.min(item.depth, 20) * 16}px` }}
              >
                {item.active ? "●" : "○"} {item.label}
              </div>
            ))}
          </div>
          <h3>{t("Edit and continue from a user message")}</h3>
          <div className={componentClass(styles, "fork-messages")}>
            {history.forks.map((message) => (
              <button
                key={message.entryId}
                disabled={sessionBusy}
                onClick={() =>
                  branch("fork", message.entryId).catch((error) =>
                    runtime.notice("Pi", String(error)),
                  )
                }
              >
                {message.text}
              </button>
            ))}
          </div>
          <div className={`button-row ${utilityStyles.buttonRow}`}>
            <button type="button" onClick={() => setHistory(null)}>
              {t("Close")}
            </button>
          </div>
        </Dialog>
      )}
      {renameOpen && (
        <div className={componentClass(styles, "modal-backdrop")}>
          <form
            className={componentClass(styles, "modal")}
            role="dialog"
            aria-modal="true"
            aria-labelledby="rename-task-title"
            onSubmit={(event) => {
              event.preventDefault();
              renameTask().catch((error) => runtime.notice("Pi", String(error)));
            }}
          >
            <h2 id="rename-task-title">{t("Rename task and Pi session")}</h2>
            <input
              autoFocus
              aria-label={t("Task name")}
              value={renameValue}
              maxLength={80}
              onChange={(event) => setRenameValue(event.target.value)}
            />
            <div className={`button-row ${utilityStyles.buttonRow}`}>
              <button type="button" disabled={sessionBusy} onClick={() => setRenameOpen(false)}>
                {t("Cancel")}
              </button>
              <Button
                variant="primary"
                className="primary"
                disabled={sessionBusy || !renameValue.trim()}
              >
                {t("Rename")}
              </Button>
            </div>
          </form>
        </div>
      )}
      {dialogs.active && (
        <div className={componentClass(styles, "modal-backdrop")}>
          <form
            ref={extensionDialog}
            className={`${componentClass(styles, "modal")} ${componentClass(styles, "extension-dialog")}`}
            role="dialog"
            aria-modal="true"
            aria-labelledby="extension-dialog-title"
            aria-busy={dialogs.responding}
            onSubmit={(event) => {
              event.preventDefault();
              const request = dialogs.active;
              if (!request) return;
              if (request.method === "confirm")
                answerDialog({ confirmed: true }).catch((error) =>
                  runtime.notice("Pi", String(error)),
                );
              else if (request.method !== "select")
                answerDialog({ value: dialogValue }).catch((error) =>
                  runtime.notice("Pi", String(error)),
                );
            }}
          >
            <h2 id="extension-dialog-title">{plainExtensionText(dialogs.active.title)}</h2>
            {dialogs.active.method === "confirm" && (
              <p>{plainExtensionText(dialogs.active.message)}</p>
            )}
            {dialogs.active.method === "select" && (
              <div className={componentClass(styles, "extension-options")} role="listbox">
                {dialogs.active.options.map((option) => (
                  <button
                    type="button"
                    role="option"
                    key={option}
                    disabled={dialogs.responding}
                    onClick={() =>
                      answerDialog({ value: option }).catch((error) =>
                        runtime.notice("Pi", String(error)),
                      )
                    }
                  >
                    {plainExtensionText(option)}
                  </button>
                ))}
              </div>
            )}
            {dialogs.active.method === "input" && (
              <input
                aria-label={plainExtensionText(dialogs.active.title)}
                placeholder={plainExtensionText(dialogs.active.placeholder ?? "")}
                value={dialogValue}
                disabled={dialogs.responding}
                onChange={(event) => setDialogValue(event.target.value)}
              />
            )}
            {dialogs.active.method === "editor" && (
              <textarea
                aria-label={plainExtensionText(dialogs.active.title)}
                value={dialogValue}
                rows={8}
                disabled={dialogs.responding}
                onChange={(event) => setDialogValue(event.target.value)}
              />
            )}
            {dialogs.active.method !== "select" && (
              <div className={`button-row ${utilityStyles.buttonRow}`}>
                <button
                  type="button"
                  disabled={dialogs.responding}
                  onClick={() =>
                    answerDialog(
                      dialogs.active?.method === "confirm"
                        ? { confirmed: false }
                        : { cancelled: true },
                    ).catch((error) => runtime.notice("Pi", String(error)))
                  }
                >
                  {dialogs.active.method === "confirm" ? t("No") : t("Cancel")}
                </button>
                <Button variant="primary" className="primary" disabled={dialogs.responding}>
                  {dialogs.responding
                    ? t("Sending…")
                    : dialogs.active.method === "confirm"
                      ? t("Yes")
                      : t("Submit")}
                </Button>
              </div>
            )}
            {!!dialogs.queued.length && (
              <small>
                {t("{count} more extension dialogs queued", { count: dialogs.queued.length })}
              </small>
            )}
          </form>
        </div>
      )}
      {review && (
        <div className={componentClass(styles, "modal-backdrop")}>
          <section
            className={componentClass(styles, "modal")}
            role="dialog"
            aria-modal="true"
            aria-labelledby="review-title"
          >
            <div className="eyebrow">{t("PLUGIN PERMISSIONS")}</div>
            <h2 id="review-title">
              {t("Enable {name}?", {
                name: localized(review.bundle.manifest.name, review.bundle.manifest.nameI18n),
              })}
            </h2>
            <p>
              {t("Version {version} · API {api}", {
                version: review.bundle.manifest.version,
                api: review.bundle.manifest.apiVersion,
              })}
            </p>
            <ul className={componentClass(styles, "permissions")}>
              {review.bundle.manifest.permissions.map((permission) => (
                <li
                  key={permission}
                  className={
                    sensitivePermissions.has(permission) ? componentClass(styles, "sensitive") : ""
                  }
                >
                  <strong>{permission}</strong>
                  <p>{t(permissionLabels[permission])}</p>
                  {permission === "workspace.write" && (
                    <p className="muted">
                      {t("Allowed paths: {paths}", {
                        paths: (review.bundle.manifest.access?.workspaceWrite ?? []).join(", "),
                      })}
                    </p>
                  )}
                  {permission === "network.fetch" && (
                    <p className="muted">
                      {t("Allowed hosts: {hosts}", {
                        hosts: (review.bundle.manifest.access?.network ?? []).join(", "),
                      })}
                    </p>
                  )}
                </li>
              ))}
            </ul>
            <p className="muted">
              {review.dev
                ? t(
                    "Development link: Pion reloads this plugin whenever files in {path} change. Changing its permissions or access needs a new review.",
                    { path: review.dev },
                  )
                : t(
                    "Approval applies to this exact code snapshot. New installs and updates need a new review.",
                  )}
            </p>
            <div className={`button-row ${utilityStyles.buttonRow}`}>
              <button disabled={busy} onClick={() => action("core.review.cancel")}>
                {t("Cancel")}
              </button>
              <Button
                variant="primary"
                className="primary"
                disabled={busy}
                onClick={() => action("core.approve", review as unknown as Json)}
              >
                {t("Approve & enable")}
              </Button>
            </div>
          </section>
        </div>
      )}
      {palette && (
        <div className={componentClass(styles, "modal-backdrop")} onClick={() => setPalette(false)}>
          <section
            className={`${componentClass(styles, "modal")} ${componentClass(styles, "palette")}`}
            role="dialog"
            aria-modal="true"
            aria-label={t("Command palette")}
            onClick={(event) => event.stopPropagation()}
          >
            <input
              autoFocus
              aria-label={t("Search commands")}
              placeholder={t("Find a Desktop command…")}
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
            />
            {pluginCommands.length ? (
              pluginCommands.map((command) => (
                <button
                  key={command.id}
                  onClick={() => {
                    setPalette(false);
                    action(command.id);
                  }}
                >
                  <span>{localized(command.title, command.titleI18n)}</span>
                  <small>{command.id}</small>
                </button>
              ))
            ) : (
              <p className="muted">{t("No matching commands. Enable a plugin to get started.")}</p>
            )}
            {at("commandPalette").map(panel)}
          </section>
        </div>
      )}
      {contextMenu && (
        <div
          className={componentClass(styles, "modal-backdrop")}
          onClick={() => setContextMenu(false)}
        >
          <section
            className={componentClass(styles, "modal")}
            role="menu"
            onClick={(event) => event.stopPropagation()}
          >
            {at("contextMenu").map(panel)}
          </section>
        </div>
      )}
      <div className={componentClass(styles, "toasts")} aria-live="polite">
        {runtime.notices.map((notice) => (
          <div className={componentClass(styles, "toast")} key={notice.id}>
            <div>
              <strong>{notice.owner}</strong>
              <p>{notice.message}</p>
            </div>
            <button
              aria-label={t("Dismiss notification")}
              onClick={() => action("core.dismiss", notice.id)}
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </>
  );
}
