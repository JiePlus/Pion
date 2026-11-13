import utilityStyles from "../primitives/Utilities.module.css";
import { Button } from "../primitives/Button.tsx";
import { Icon } from "../primitives/Icon.tsx";
import { MenuItem, MenuSeparator, Popover, Submenu } from "../primitives/Popover.tsx";
import { Segmented } from "../primitives/Segmented.tsx";
import { Switch } from "../primitives/Switch.tsx";
import { componentClass } from "../componentClass.ts";
import { useEffect, useRef, useState } from "react";
import type { Dispatch, RefObject, SetStateAction } from "react";
import type { Json } from "../../core/api.ts";
import { imageFailure } from "../../core/attachments.ts";
import type { ImageAttachment } from "../../core/attachments.ts";
import { native } from "../../core/host.ts";
import { t } from "../../core/i18n.ts";
import { readRunMode } from "../../core/runMode.ts";
import type { RunMode } from "../../core/runMode.ts";
import { UsageIndicator } from "./UsageIndicator.tsx";
import { ModelMenu } from "./ModelMenu.tsx";
import type { UsageProps } from "./UsageIndicator.tsx";
import styles from "./ChatComposer.module.css";

const modifier = typeof navigator !== "undefined" && /Mac/.test(navigator.platform) ? "⌘" : "Ctrl+";

interface ComposerProps {
  usage?: UsageProps;
  skills: { name: string; description?: string }[];
  onManagePackages?: () => void;
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

// Four controls, one job each: ＋ adds to the message, the model pill shapes how Pi works,
// the ring reports context and compacts it, and the last button sends or stops.
export function ChatComposer(props: ComposerProps) {
  const {
    usage,
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
    matchingCommands,
    models,
    activeModel,
    toolPreset,
    state,
    levels,
    importFiles,
    chooseImages,
    send,
    stop,
    configure,
    saveDraft,
    saveAttachments,
    setError,
  } = props;
  const [runMode, setRunMode] = useState<RunMode>(readRunMode);
  // Every run starts from the saved default; the floating switch only overrides the current run.
  useEffect(() => {
    if (working) setRunMode(readRunMode());
  }, [working]);
  const empty = !draft.trim() && !attachments.length;
  // While a send is in flight the draft is already cleared; keep showing "Sending…", not stop.
  const showStop = working && empty && !sending;
  const sendLabel = sending
    ? t("Sending…")
    : working
      ? t(runMode === "steer" ? "Steer" : "Queue next")
      : t("Send to Pi");

  function attach() {
    if (native) chooseImages().catch((failure) => setError(imageFailure(failure)));
    else picker.current?.click();
  }

  return (
    <form
      className={`${componentClass(styles, "core-composer")} ${working ? componentClass(styles, "running") : ""}`}
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();
        importFiles([...event.dataTransfer.files]).catch((failure) =>
          setError(imageFailure(failure)),
        );
      }}
      onSubmit={(event) => {
        event.preventDefault();
        send(working ? runMode : undefined).catch((failure) => setError(String(failure)));
      }}
    >
      {working && (
        <div className={componentClass(styles, "run-float")}>
          <Segmented
            size="sm"
            label={t("Message while running")}
            value={runMode}
            onChange={setRunMode}
            options={[
              { value: "steer", label: t("Steer"), title: t("Steers the current task right away") },
              {
                value: "follow_up",
                label: t("Follow-up"),
                title: t("Waits until this turn finishes"),
              },
            ]}
          />
        </div>
      )}
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
          if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "u") {
            event.preventDefault();
            attach();
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
          <AddMenu {...props} attach={attach} />
          <ModelMenu
            models={models}
            value={activeModel}
            onModel={(value) => {
              const model = models.find((item) => `${item.provider}/${item.id}` === value);
              if (model) configure("set_model", { provider: model.provider, modelId: model.id });
            }}
            levels={levels}
            thinking={state.thinkingLevel ?? "off"}
            onThinking={(level) => configure("set_thinking_level", { level })}
            toolPreset={toolPreset}
            onToolPreset={(preset) => configure("set_tool_preset", { preset })}
            disabled={!connected}
            locked={working}
          />
        </div>
        <div className={componentClass(styles, "composer-actions")}>
          {usage && (
            <UsageIndicator {...usage}>
              <SessionControls {...props} />
            </UsageIndicator>
          )}
          {working && !showStop && !sending && (
            <button
              className={`${componentClass(styles, "stop-button")} ${componentClass(styles, "secondary-stop")}`}
              type="button"
              aria-label={t("Stop agent")}
              title={t("Stop agent")}
              onClick={() => stop().catch((failure) => setError(String(failure)))}
            >
              <Icon name="stop" size={12} />
            </button>
          )}
          {showStop ? (
            <button
              className={componentClass(styles, "stop-button")}
              type="button"
              aria-label={t("Stop agent")}
              title={`${t("Stop agent")} · ${t("Clear the message to stop")}`}
              onClick={() => stop().catch((failure) => setError(String(failure)))}
            >
              <Icon name="stop" size={14} />
            </button>
          ) : (
            <Button
              variant="primary"
              className={`primary ${componentClass(styles, "send-button")}`}
              type="submit"
              aria-label={sendLabel}
              title={sendLabel}
              disabled={sending || !connected || empty || (!!attachments.length && !supportsImages)}
            >
              <Icon name="arrow-up" size={17} />
            </Button>
          )}
        </div>
      </div>
    </form>
  );
}

// ＋ only adds things to the message; settings live with the model and the context ring.
function AddMenu({
  connected,
  draft,
  saveDraft,
  composer,
  skills,
  onManagePackages,
  attach,
}: ComposerProps & { attach: () => void }) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const insert = (text: string) => {
    setOpen(false);
    saveDraft(draft.trim() ? `${draft.trimEnd()} ${text}` : text);
    requestAnimationFrame(() => composer.current?.focus());
  };
  return (
    <span className={componentClass(styles, "anchor")}>
      <button
        ref={trigger}
        type="button"
        className={componentClass(styles, "add-button")}
        aria-label={t("Add")}
        title={t("Add")}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={!connected}
        onClick={() => setOpen((current) => !current)}
      >
        <Icon name="plus" size={17} />
      </button>
      <Popover
        open={open}
        onClose={() => setOpen(false)}
        anchor={trigger}
        role="menu"
        label={t("Add")}
      >
        <MenuItem
          icon="image"
          label={t("Attach images")}
          shortcut={`${modifier}U`}
          onSelect={() => {
            setOpen(false);
            attach();
          }}
        />
        <MenuItem
          icon="terminal"
          label={t("Pi command")}
          shortcut="/"
          onSelect={() => insert("/")}
        />
        <Submenu icon="bolt" label={t("Skills")}>
          {skills.map((skill) => (
            <MenuItem
              key={skill.name}
              label={skill.name.replace(/^skill:/, "")}
              description={skill.description}
              onSelect={() => insert(`/${skill.name} `)}
            />
          ))}
          {!skills.length && (
            <MenuItem label={t("No skills installed.")} disabled onSelect={() => {}} />
          )}
        </Submenu>
        {onManagePackages && (
          <>
            <MenuSeparator />
            <MenuItem
              icon="grid"
              label={t("Install Pi packages…")}
              onSelect={() => {
                setOpen(false);
                onManagePackages();
              }}
            />
          </>
        )}
      </Popover>
    </span>
  );
}

// Session-level switches that belong with context: compaction, retry, and queue handling.
function SessionControls({
  usage,
  connected,
  working,
  state,
  autoRetry,
  setAutoRetry,
  configure,
  setCustomCompactOpen,
}: ComposerProps) {
  const queueMode = state.steeringMode ?? "one-at-a-time";
  return (
    <div className={componentClass(styles, "session-controls")}>
      <div className={componentClass(styles, "session-row")}>
        <span>{t("Compact")}</span>
        <div className={componentClass(styles, "session-actions")}>
          <button
            type="button"
            className={componentClass(styles, "small-button")}
            disabled={working || !connected}
            title={t("Compact the current Pi context")}
            onClick={() => configure("compact", {})}
          >
            {t("Compact now")}
          </button>
          <button
            type="button"
            className={`${componentClass(styles, "small-button")} ${componentClass(styles, "ghost")}`}
            disabled={working || !connected}
            onClick={() => {
              setCustomCompactOpen(true);
              usage?.onToggle();
            }}
          >
            {t("Compact with instructions…")}
          </button>
        </div>
      </div>
      <div className={componentClass(styles, "session-row")}>
        <span>{t("Automatic compaction")}</span>
        <Switch
          label={t("Automatic compaction")}
          checked={state.autoCompactionEnabled !== false}
          disabled={working || !connected}
          onChange={(enabled) => configure("set_auto_compaction", { enabled })}
        />
      </div>
      <div className={componentClass(styles, "session-row")}>
        <span>{t("Automatic retry")}</span>
        <Switch
          label={t("Automatic retry")}
          checked={autoRetry === true}
          disabled={working || !connected}
          onChange={async (enabled) => {
            if (await configure("set_auto_retry", { enabled })) setAutoRetry(enabled);
          }}
        />
      </div>
      <div className={componentClass(styles, "session-row")}>
        <span>{t("Queue mode")}</span>
        <Segmented
          size="sm"
          label={t("Queue mode")}
          value={queueMode}
          disabled={working || !connected}
          onChange={async (mode) => {
            await configure("set_steering_mode", { mode });
            await configure("set_follow_up_mode", { mode });
          }}
          options={[
            { value: "one-at-a-time", label: t("One at a time") },
            { value: "all", label: t("All at once") },
          ]}
        />
      </div>
    </div>
  );
}
