import utilityStyles from "../primitives/Utilities.module.css";
import { Button } from "../primitives/Button.tsx";
import { Icon } from "../primitives/Icon.tsx";
import controlStyles from "../primitives/Controls.module.css";
import { componentClass } from "../componentClass.ts";
import type { Dispatch, RefObject, SetStateAction } from "react";
import type { Json } from "../../core/api.ts";
import { imageFailure } from "../../core/attachments.ts";
import type { ImageAttachment } from "../../core/attachments.ts";
import { native } from "../../core/host.ts";
import { t } from "../../core/i18n.ts";
import { ModelPicker } from "../layout/Topbar/ModelPicker.tsx";
import styles from "./ChatComposer.module.css";

interface ComposerProps {
  connected: boolean;
  working: boolean;
  sending: boolean;
  draft: string;
  attachments: ImageAttachment[];
  supportsImages: boolean;
  customCompactOpen: boolean;
  setCustomCompactOpen: Dispatch<SetStateAction<boolean>>;
  customCompactText: string;
  setCustomCompactText: Dispatch<SetStateAction<string>>;
  picker: RefObject<HTMLInputElement | null>;
  composer: RefObject<HTMLTextAreaElement | null>;
  moreButton: RefObject<HTMLButtonElement | null>;
  more: RefObject<HTMLDivElement | null>;
  moreOpen: boolean;
  setMoreOpen: Dispatch<SetStateAction<boolean>>;
  matchingCommands: { name: string; description?: string }[];
  models: { provider: string; id: string; name?: string }[];
  activeModel: string;
  toolPreset: string;
  state: {
    steeringMode?: "all" | "one-at-a-time";
    followUpMode?: "all" | "one-at-a-time";
    autoCompactionEnabled?: boolean;
    thinkingLevel?: string;
  };
  autoRetry: boolean | null;
  setAutoRetry: Dispatch<SetStateAction<boolean | null>>;
  levels: string[];
  importFiles: (files: File[]) => Promise<void>;
  chooseImages: () => Promise<void>;
  send: (command?: "prompt" | "steer" | "follow_up") => Promise<void>;
  stop: () => Promise<void>;
  configure: (command: string, args: Record<string, Json>) => Promise<boolean>;
  saveDraft: (value: string) => void;
  saveAttachments: (value: ImageAttachment[]) => void;
  setError: Dispatch<SetStateAction<string>>;
}

export function ChatComposer({
  connected,
  working,
  sending,
  draft,
  attachments,
  supportsImages,
  customCompactOpen,
  setCustomCompactOpen,
  customCompactText,
  setCustomCompactText,
  picker,
  composer,
  moreButton,
  more,
  moreOpen,
  setMoreOpen,
  matchingCommands,
  models,
  activeModel,
  toolPreset,
  state,
  autoRetry,
  setAutoRetry,
  levels,
  importFiles,
  chooseImages,
  send,
  stop,
  configure,
  saveDraft,
  saveAttachments,
  setError,
}: ComposerProps) {
  return (
    <form
      className={componentClass(styles, "core-composer")}
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();
        importFiles([...event.dataTransfer.files]).catch((failure) =>
          setError(imageFailure(failure)),
        );
      }}
      onSubmit={(event) => {
        event.preventDefault();
        send().catch((failure) => setError(String(failure)));
      }}
    >
      {customCompactOpen && (
        <div
          className={componentClass(styles, "custom-compact")}
          role="group"
          aria-label={t("Custom compaction")}
        >
          <textarea
            aria-label={t("Compaction instructions")}
            placeholder={t("What should Pi preserve in the summary?")}
            value={customCompactText}
            maxLength={4096}
            rows={3}
            onChange={(event) => setCustomCompactText(event.target.value)}
          />
          <div className={`button-row ${utilityStyles.buttonRow}`}>
            <button type="button" onClick={() => setCustomCompactOpen(false)}>
              {t("Cancel")}
            </button>
            <Button
              variant="primary"
              type="button"
              className="primary"
              disabled={!connected || working || !customCompactText.trim()}
              onClick={async () => {
                if (
                  await configure("compact", {
                    customInstructions: customCompactText.trim(),
                  })
                ) {
                  setCustomCompactText("");
                  setCustomCompactOpen(false);
                }
              }}
            >
              {t("Compact with instructions")}
            </Button>
          </div>
        </div>
      )}
      {!!attachments.length && (
        <div
          className={componentClass(styles, "attachment-strip")}
          aria-label={t("Image attachments")}
        >
          {attachments.map((attachment) => (
            <figure key={attachment.id}>
              <img
                src={`data:${attachment.mimeType};base64,${attachment.data}`}
                alt={attachment.name}
              />
              <figcaption>{attachment.name}</figcaption>
              <button
                type="button"
                aria-label={t("Remove {name}", { name: attachment.name })}
                onClick={() =>
                  saveAttachments(attachments.filter((item) => item.id !== attachment.id))
                }
              >
                ×
              </button>
            </figure>
          ))}
        </div>
      )}
      {!!attachments.length && !supportsImages && (
        <p className={componentClass(styles, "image-warning")} role="alert">
          {t("The current model does not support image input.")}
        </p>
      )}
      <input
        ref={picker}
        className="sr-only"
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp"
        multiple
        onChange={(event) => {
          const files = [...(event.target.files ?? [])];
          event.target.value = "";
          importFiles(files).catch((failure) => setError(imageFailure(failure)));
        }}
      />
      {!!matchingCommands.length && (
        <div
          className={componentClass(styles, "slash-command-menu")}
          role="listbox"
          aria-label={t("Pi command")}
        >
          {matchingCommands.map((command) => (
            <button
              key={command.name}
              type="button"
              role="option"
              onClick={() => {
                saveDraft(`/${command.name} `);
                requestAnimationFrame(() => composer.current?.focus());
              }}
            >
              <strong>/{command.name}</strong>
              {!!command.description && <span>{command.description}</span>}
            </button>
          ))}
        </div>
      )}
      <textarea
        ref={composer}
        aria-label={t("Ask Pi to explore, build, or fix something…")}
        placeholder={t(
          working
            ? "Steer now or queue a follow-up…"
            : "Ask Pi to explore, build, or fix something…",
        )}
        value={draft}
        disabled={!connected || sending}
        rows={1}
        onChange={(event) => saveDraft(event.target.value)}
        onPaste={(event) => {
          const files = [...event.clipboardData.files].filter((file) =>
            file.type.startsWith("image/"),
          );
          if (files.length) {
            event.preventDefault();
            importFiles(files).catch((failure) => setError(imageFailure(failure)));
          }
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape" && moreOpen) {
            event.preventDefault();
            setMoreOpen(false);
            moreButton.current?.focus();
            return;
          }
          if (
            event.key === "Enter" &&
            !event.shiftKey &&
            !event.nativeEvent.isComposing &&
            event.keyCode !== 229
          ) {
            event.preventDefault();
            event.currentTarget.form?.requestSubmit();
          }
        }}
      />
      <div className={componentClass(styles, "core-composer-footer")}>
        <div className={componentClass(styles, "composer-options")}>
          <button
            ref={moreButton}
            className={`composer-command-button ${controlStyles.commandButton}`}
            type="button"
            aria-label={t("More options")}
            aria-expanded={moreOpen}
            title={t("More options")}
            onClick={() => setMoreOpen((open) => !open)}
          >
            <Icon name="plus" size={17} />
          </button>
          <button
            className={`composer-command-button ${controlStyles.commandButton}`}
            type="button"
            aria-label={t("Attach images")}
            title={t("Attach images")}
            disabled={!connected}
            onClick={() => {
              if (native) chooseImages().catch((failure) => setError(imageFailure(failure)));
              else picker.current?.click();
            }}
          >
            <Icon name="folder" size={16} />
          </button>
          <ModelPicker
            models={models}
            value={activeModel}
            disabled={working || !connected}
            onChange={(value) => {
              const model = models.find((item) => `${item.provider}/${item.id}` === value);
              if (model) configure("set_model", { provider: model.provider, modelId: model.id });
            }}
          />
          <label
            className={`compact-field tool-preset ${controlStyles.compactField} ${componentClass(styles, "composer-tool-preset")}`}
          >
            <span className="sr-only">{t("Tool preset")}</span>
            <select
              aria-label={t("Tool preset")}
              title={t(
                "Tool presets change tools exposed to the model; Pi extensions remain trusted code.",
              )}
              value={toolPreset}
              disabled={working || !connected}
              onChange={(event) => configure("set_tool_preset", { preset: event.target.value })}
            >
              {toolPreset === "custom" && (
                <option value="custom" disabled>
                  {t("Custom tools")}
                </option>
              )}
              <option value="full">{t("Full tools")}</option>
              <option value="read-only">{t("Read-only tools")}</option>
              <option value="chat">{t("Chat only")}</option>
            </select>
          </label>
        </div>
        {moreOpen && (
          <div
            className={componentClass(styles, "composer-more")}
            ref={more}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                setMoreOpen(false);
                moreButton.current?.focus();
              }
            }}
          >
            <div className={componentClass(styles, "composer-options")}>
              <button
                className={`queue-button ${controlStyles.queueButton}`}
                type="button"
                disabled={working || !connected}
                title={t("Compact the current Pi context")}
                onClick={() => configure("compact", {})}
              >
                {t("Compact")}
              </button>
              <button
                className={`queue-button ${controlStyles.queueButton}`}
                type="button"
                disabled={working || !connected}
                onClick={() => setCustomCompactOpen((open) => !open)}
              >
                {t("Custom compaction")}
              </button>
              <button
                className={`composer-command-button ${controlStyles.commandButton}`}
                type="button"
                aria-label={t("Pi command")}
                title={t("Pi command")}
                disabled={!connected}
                onClick={() => {
                  if (!draft.trim()) saveDraft("/");
                  setMoreOpen(false);
                  requestAnimationFrame(() => composer.current?.focus());
                }}
              >
                /
              </button>
              <label className={`compact-field queue-mode ${controlStyles.compactField}`}>
                <span className="sr-only">{t("Steering mode")}</span>
                <select
                  aria-label={t("Steering mode")}
                  value={state.steeringMode ?? "one-at-a-time"}
                  disabled={working || !connected}
                  onChange={(event) => configure("set_steering_mode", { mode: event.target.value })}
                >
                  <option value="one-at-a-time">{t("Steer one at a time")}</option>
                  <option value="all">{t("Steer all")}</option>
                </select>
              </label>
              <label className={`compact-field queue-mode ${controlStyles.compactField}`}>
                <span className="sr-only">{t("Follow-up mode")}</span>
                <select
                  aria-label={t("Follow-up mode")}
                  value={state.followUpMode ?? "one-at-a-time"}
                  disabled={working || !connected}
                  onChange={(event) =>
                    configure("set_follow_up_mode", { mode: event.target.value })
                  }
                >
                  <option value="one-at-a-time">{t("Follow up one at a time")}</option>
                  <option value="all">{t("Follow up all")}</option>
                </select>
              </label>
              <label className={`compact-field ${controlStyles.compactField}`}>
                <span className="sr-only">{t("Automatic compaction")}</span>
                <select
                  aria-label={t("Automatic compaction")}
                  value={state.autoCompactionEnabled === false ? "off" : "on"}
                  disabled={working || !connected}
                  onChange={(event) =>
                    configure("set_auto_compaction", { enabled: event.target.value === "on" })
                  }
                >
                  <option value="on">{t("Auto compact on")}</option>
                  <option value="off">{t("Auto compact off")}</option>
                </select>
              </label>
              <label className={`compact-field ${controlStyles.compactField}`}>
                <span className="sr-only">{t("Automatic retry")}</span>
                <select
                  aria-label={t("Automatic retry")}
                  value={autoRetry === null ? "unknown" : autoRetry ? "on" : "off"}
                  disabled={working || !connected}
                  onChange={async (event) => {
                    const enabled = event.target.value === "on";
                    if (await configure("set_auto_retry", { enabled })) setAutoRetry(enabled);
                  }}
                >
                  {autoRetry === null && (
                    <option value="unknown" disabled>
                      {t("Set automatic retry")}
                    </option>
                  )}
                  <option value="on">{t("Auto retry on")}</option>
                  <option value="off">{t("Auto retry off")}</option>
                </select>
              </label>
            </div>
            <div className={componentClass(styles, "composer-more-settings")}>
              <label className={`compact-field ${controlStyles.compactField}`}>
                <span className="sr-only">{t("Thinking")}</span>
                <select
                  aria-label={t("Thinking")}
                  value={state.thinkingLevel ?? "off"}
                  disabled={working || !connected}
                  onChange={(event) =>
                    configure("set_thinking_level", { level: event.target.value })
                  }
                >
                  {levels.map((level) => (
                    <option key={level} value={level}>
                      {t("Thinking")} · {level}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>
        )}
        <div className={componentClass(styles, "composer-actions")}>
          {working && (
            <button
              className={`queue-button ${controlStyles.queueButton} ${componentClass(styles, "queue-next-button")}`}
              type="button"
              disabled={sending || !draft.trim()}
              onClick={() => send("follow_up").catch((failure) => setError(String(failure)))}
            >
              {t("Queue next")}
            </button>
          )}
          {working && (
            <button
              className={componentClass(styles, "stop-button")}
              type="button"
              aria-label={t("Stop agent")}
              title={t("Stop agent")}
              onClick={() => stop().catch((failure) => setError(String(failure)))}
            >
              ■
            </button>
          )}
          <Button
            variant="primary"
            className={`primary ${componentClass(styles, "send-button")}`}
            type="submit"
            aria-label={sending ? t("Sending…") : working ? t("Steer") : t("Send to Pi")}
            title={sending ? t("Sending…") : working ? t("Steer") : t("Send to Pi")}
            disabled={
              sending ||
              !connected ||
              (!draft.trim() && !attachments.length) ||
              (!!attachments.length && !supportsImages)
            }
          >
            <Icon name="arrow-up" size={17} />
          </Button>
        </div>
      </div>
    </form>
  );
}
