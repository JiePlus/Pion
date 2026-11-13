import { Button } from "../primitives/Button.tsx";
import { Select } from "../primitives/Select.tsx";
import { Icon } from "../primitives/Icon.tsx";
import controlStyles from "../primitives/Controls.module.css";
import { componentClass } from "../componentClass.ts";
import type { Dispatch, ReactNode, RefObject, SetStateAction } from "react";
import { useRef } from "react";
import { imageFailure } from "../../core/attachments.ts";
import type { ImageAttachment } from "../../core/attachments.ts";
import { native } from "../../core/host.ts";
import type { Catalog, PiSetupStatus, Project, Task } from "../../core/host.ts";
import { t } from "../../core/i18n.ts";
import { ModelMenu } from "./ModelMenu.tsx";
import type { Page } from "../layout/types.ts";
import { BrandMark } from "../primitives/BrandMark.tsx";
import styles from "./TaskStart.module.css";

interface TaskStartProps {
  setupStatus: PiSetupStatus | null;
  setPage: Dispatch<SetStateAction<Page>>;
  newText: string;
  newAttachments: ImageAttachment[];
  setNewAttachments: Dispatch<SetStateAction<ImageAttachment[]>>;
  draftSupportsImages: boolean;
  newImageError: string;
  setNewImageError: Dispatch<SetStateAction<string>>;
  newImagePicker: RefObject<HTMLInputElement | null>;
  importNewImages: (files: File[]) => Promise<void>;
  chooseNewImages: () => Promise<void>;
  updateNewText: (value: string) => void;
  busy: boolean;
  working: boolean;
  preparing: boolean;
  projectId: string;
  setProjectId: Dispatch<SetStateAction<string>>;
  catalog: Catalog;
  perform: (work: () => Promise<unknown>) => void;
  addProject: () => Promise<void>;
  draftModels: { provider: string; id: string; name?: string }[];
  draftModel: string;
  setDraftModel: Dispatch<SetStateAction<string>>;
  draftLevels: string[];
  draftThinking: string;
  setDraftThinking: Dispatch<SetStateAction<string>>;
  draftToolPreset: string;
  setDraftToolPreset: Dispatch<SetStateAction<string>>;
  selectedProject: Project | undefined;
  openTask: (intent: {
    projectId?: string;
    text?: string;
    images?: ImageAttachment[];
    task?: Task;
  }) => Promise<void>;
  footer?: ReactNode;
}

export function TaskStart({
  setupStatus,
  setPage,
  newText,
  newAttachments,
  setNewAttachments,
  draftSupportsImages,
  newImageError,
  setNewImageError,
  newImagePicker,
  importNewImages,
  chooseNewImages,
  updateNewText,
  busy,
  working,
  preparing,
  projectId,
  setProjectId,
  catalog,
  perform,
  addProject,
  draftModels,
  draftModel,
  setDraftModel,
  draftLevels,
  draftThinking,
  setDraftThinking,
  draftToolPreset,
  setDraftToolPreset,
  selectedProject,
  openTask,
  footer,
}: TaskStartProps) {
  const prompt = useRef<HTMLTextAreaElement>(null);
  return (
    <div className={componentClass(styles, "task-start")}>
      <div className={componentClass(styles, "start-heading")}>
        <BrandMark size={52} />
        <h1>{t("What would you like to work on?")}</h1>
        <p>{t("Start a local Pi task in one of your projects.")}</p>
        <div className={componentClass(styles, "suggestions")} aria-label={t("Suggestions")}>
          {(
            [
              ["bolt", "Explore the project architecture"],
              ["cube", "Review dependencies"],
              ["sparkles", "Write unit tests"],
            ] as const
          ).map(([icon, label]) => (
            <button
              key={label}
              type="button"
              onClick={() => {
                updateNewText(t(label));
                prompt.current?.focus();
              }}
            >
              <Icon name={icon} size={14} />
              {t(label)}
            </button>
          ))}
        </div>
      </div>
      {native && !setupStatus && (
        <p className={componentClass(styles, "setup-reminder")} role="status">
          {t("Checking Pi…")}
        </p>
      )}
      {native && setupStatus && !setupStatus.modelReady && (
        <div className={componentClass(styles, "setup-reminder")} role="status">
          <span>{t("Finish Pi setup before starting a task.")}</span>
          <button type="button" onClick={() => setPage("setup")}>
            {t("Open Pi setup")}
          </button>
        </div>
      )}
      <form
        className={componentClass(styles, "command-form")}
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          importNewImages([...event.dataTransfer.files]).catch((failure) =>
            setNewImageError(imageFailure(failure)),
          );
        }}
        onSubmit={(event) => {
          event.preventDefault();
          if (
            (newText.trim() || newAttachments.length) &&
            projectId &&
            !working &&
            (!newAttachments.length || draftSupportsImages) &&
            (!native || setupStatus?.modelReady)
          )
            perform(() => openTask({ projectId, text: newText.trim(), images: newAttachments }));
        }}
      >
        {!!newAttachments.length && (
          <div
            className={componentClass(styles, "attachment-strip")}
            aria-label={t("Image attachments")}
          >
            {newAttachments.map((attachment) => (
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
                    setNewAttachments(newAttachments.filter((item) => item.id !== attachment.id))
                  }
                >
                  ×
                </button>
              </figure>
            ))}
          </div>
        )}
        {!!newAttachments.length && !draftSupportsImages && (
          <p className={componentClass(styles, "image-warning")} role="alert">
            {t("The current model does not support image input.")}
          </p>
        )}
        {!!newImageError && (
          <p className={componentClass(styles, "image-warning")} role="alert">
            {newImageError}
          </p>
        )}
        <input
          ref={newImagePicker}
          className="sr-only"
          type="file"
          accept="image/png,image/jpeg,image/gif,image/webp"
          multiple
          onChange={(event) => {
            const files = [...(event.target.files ?? [])];
            event.target.value = "";
            importNewImages(files).catch((failure) => setNewImageError(imageFailure(failure)));
          }}
        />
        <textarea
          ref={prompt}
          autoFocus
          aria-label={t("Describe your task")}
          placeholder={t("Ask a question, build a feature, or fix a bug…")}
          value={newText}
          disabled={busy || working}
          rows={4}
          onChange={(event) => updateNewText(event.target.value)}
          onPaste={(event) => {
            const files = [...event.clipboardData.files].filter((file) =>
              file.type.startsWith("image/"),
            );
            if (files.length) {
              event.preventDefault();
              importNewImages(files).catch((failure) => setNewImageError(imageFailure(failure)));
            }
          }}
          onKeyDown={(event) => {
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
        <div className={componentClass(styles, "composer-footer")}>
          <div className={componentClass(styles, "new-task-options")}>
            <button
              className={`composer-command-button ${controlStyles.commandButton}`}
              type="button"
              aria-label={t("Attach images")}
              title={t("Attach images")}
              disabled={busy || working}
              onClick={() => {
                if (native)
                  chooseNewImages().catch((failure) => setNewImageError(imageFailure(failure)));
                else newImagePicker.current?.click();
              }}
            >
              <Icon name="image" size={16} />
            </button>
            {catalog.projects.length ? (
              <Select
                compact
                placement="top-start"
                label={t("Project")}
                value={projectId}
                disabled={busy || working || preparing}
                onChange={setProjectId}
                options={catalog.projects.map((project) => ({
                  value: project.id,
                  label: project.name,
                  description: project.path,
                }))}
              />
            ) : (
              <button type="button" disabled={busy || !native} onClick={() => perform(addProject)}>
                ＋ {t("Add project")}
              </button>
            )}
            {!!catalog.projects.length && (
              <>
                <ModelMenu
                  models={draftModels}
                  value={draftModel}
                  onModel={(value) => {
                    setDraftModel(value);
                    localStorage.setItem(`pion.newTaskModel.${projectId}`, value);
                  }}
                  levels={draftLevels}
                  thinking={draftThinking}
                  onThinking={(level) => {
                    setDraftThinking(level);
                    localStorage.setItem(`pion.newTaskThinking.${projectId}`, level);
                  }}
                  toolPreset={draftToolPreset}
                  onToolPreset={(preset) => {
                    setDraftToolPreset(preset);
                    localStorage.setItem(`pion.newTaskToolPreset.${projectId}`, preset);
                  }}
                  disabled={busy || preparing || !draftModels.length}
                  locked={working}
                />
              </>
            )}
          </div>
          <Button
            variant="primary"
            type="submit"
            className={`primary ${componentClass(styles, "send-button")}`}
            aria-label={t(busy ? "Opening task…" : "Start task")}
            title={t(busy ? "Opening task…" : "Start task")}
            disabled={
              busy ||
              preparing ||
              working ||
              !projectId ||
              (!newText.trim() && !newAttachments.length) ||
              (!!newAttachments.length && !draftSupportsImages) ||
              (native && !setupStatus?.modelReady)
            }
          >
            <Icon name="arrow-up" size={17} />
          </Button>
        </div>
      </form>
      <p className={componentClass(styles, "start-hint")}>
        {t("Enter to send · Shift + Enter for a new line")}
      </p>
      {!!selectedProject && (
        <p className={componentClass(styles, "trust-hint")}>
          <span>{t("Local")}</span>
          <code>{selectedProject.path}</code>
          <span>
            {t("Tasks use your local Pi configuration and can run tools in the selected project.")}
          </span>
        </p>
      )}
      {footer}
    </div>
  );
}
