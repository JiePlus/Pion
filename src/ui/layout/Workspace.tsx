import type { ReactNode } from "react";
import { componentClass } from "../componentClass.ts";
import type { PanelView, Runtime } from "../../core/runtime.ts";
import type { Project } from "../../core/host.ts";
import { t } from "../../core/i18n.ts";
import { CoreChat, hasChatSnapshot } from "../chat/CoreChat.tsx";
import { TaskStart } from "../chat/TaskStart.tsx";
import { TaskGlance } from "../chat/TaskGlance.tsx";
import type { useShellController } from "../hooks/useShellController.ts";
import { Slot } from "./Slot/Slot.tsx";
import { ReviewPane } from "../review/ReviewPane.tsx";
import type { GitReviewState } from "../hooks/useGitReview.ts";
import { SlotResizer } from "./Slot/SlotResizer.tsx";
import styles from "./Shell.module.css";

export function Workspace({
  controller,
  runtime,
  panel,
  selectedProject,
  review,
}: {
  controller: ReturnType<typeof useShellController>;
  runtime: Runtime;
  panel: (view: PanelView) => ReactNode;
  selectedProject: Project | undefined;
  review: GitReviewState;
}) {
  const {
    at,
    task,
    taskStatuses,
    catalog,
    connected,
    busy,
    perform,
    openTask,
    action,
    opening,
    sessionBusy,
    initialPrompt,
    setInitialPrompt,
    updateNewText,
    setNewAttachments,
    setWorking,
    setExtensionTitle,
    extensionStatuses,
    extensionWidgets,
    extensionDraft,
    setExtensionDraft,
    viewMode,
    setupStatus,
    setPage,
    newText,
    newAttachments,
    newImageError,
    setNewImageError,
    newImagePicker,
    importNewImages,
    chooseNewImages,
    working,
    preparing,
    projectId,
    setProjectId,
    addProject,
    draftModels,
    draftModel,
    setDraftModel,
    draftLevels,
    draftThinking,
    setDraftThinking,
    draftToolPreset,
    setDraftToolPreset,
    usageArea,
    usageButton,
    usageOpen,
    usageStats,
    usageLoading,
    usageError,
    showUsage,
    tasksState,
    setTaskBrowserOpen,
  } = controller;
  const backgroundTasks = catalog.tasks.filter(
    (item) =>
      item.projectId === task?.projectId &&
      taskStatuses.get(item.id) === "working" &&
      item.id !== task?.id,
  ).length;
  const draftSupportsImages = !!draftModels
    .find((model) => `${model.provider}/${model.id}` === draftModel)
    ?.input?.includes("image");

  return (
    <>
      {!!at("toolbar").length && <Slot kind="toolbar">{at("toolbar").map(panel)}</Slot>}
      <div
        className={`${componentClass(styles, "workspace-grid")} ${task ? "has-task" : "new-task"}`}
      >
        {!!at("sidebar").length && (
          <Slot kind="side" edge="left">
            {at("sidebar").map(panel)}
          </Slot>
        )}
        <Slot kind="main">
          {task ? (
            <>
              {!!backgroundTasks && (
                <div className={componentClass(styles, "background-tasks")} role="status">
                  {t("{count} tasks are running in the background and may edit their workspaces.", {
                    count: backgroundTasks,
                  })}
                </div>
              )}
              {!connected && !busy && (
                <div className={componentClass(styles, "task-recovery")} role="status">
                  <span>{t("Connection lost. Reopen this task to continue.")}</span>
                  <button onClick={() => perform(() => openTask({ task }))}>
                    {t("Reopen task")}
                  </button>
                  <button onClick={() => action("core.navigate", "settings")}>
                    {t("Settings")}
                  </button>
                </div>
              )}
              <div
                className={componentClass(styles, "conversation-surface")}
                inert={busy || opening || sessionBusy || !connected}
                aria-busy={busy || opening || sessionBusy}
              >
                {(!opening || hasChatSnapshot(task.id)) && (
                  <CoreChat
                    key={task.id}
                    taskId={task.id}
                    connected={connected && !opening}
                    initialPrompt={
                      initialPrompt?.taskId === task.id ? initialPrompt.text : undefined
                    }
                    onInitialSent={() => {
                      setInitialPrompt(null);
                      updateNewText("");
                      setNewAttachments([]);
                    }}
                    onWorkingChange={setWorking}
                    onExtensionTitle={setExtensionTitle}
                    extensionStatuses={extensionStatuses}
                    extensionWidgets={extensionWidgets}
                    externalDraft={extensionDraft}
                    onExternalDraftApplied={() => setExtensionDraft(null)}
                    viewMode={viewMode}
                    usage={{
                      area: usageArea,
                      button: usageButton,
                      open: usageOpen,
                      stats: usageStats,
                      loading: usageLoading,
                      error: usageError,
                      onToggle: () =>
                        showUsage().catch((error) => runtime.notice("Pi", String(error))),
                    }}
                    onManagePackages={() => action("core.navigate", "packages")}
                  />
                )}
              </div>
            </>
          ) : (
            <TaskStart
              setupStatus={setupStatus}
              setPage={setPage}
              newText={newText}
              newAttachments={newAttachments}
              setNewAttachments={setNewAttachments}
              draftSupportsImages={draftSupportsImages}
              newImageError={newImageError}
              setNewImageError={setNewImageError}
              newImagePicker={newImagePicker}
              importNewImages={importNewImages}
              chooseNewImages={chooseNewImages}
              updateNewText={updateNewText}
              busy={busy}
              working={working}
              preparing={preparing}
              projectId={projectId}
              setProjectId={setProjectId}
              catalog={catalog}
              perform={perform}
              addProject={addProject}
              draftModels={draftModels}
              draftModel={draftModel}
              setDraftModel={setDraftModel}
              draftLevels={draftLevels}
              draftThinking={draftThinking}
              setDraftThinking={setDraftThinking}
              draftToolPreset={draftToolPreset}
              setDraftToolPreset={setDraftToolPreset}
              selectedProject={selectedProject}
              openTask={openTask}
              footer={
                !!catalog.tasks.length && (
                  <TaskGlance
                    running={
                      [...taskStatuses.values()].filter((value) => value === "working").length
                    }
                    attention={catalog.tasks.filter((item) => item.unread).length}
                    total={catalog.tasks.length}
                    filter={tasksState.taskFilter}
                    onFilter={(value) => {
                      tasksState.setTaskFilter(value);
                      setTaskBrowserOpen(true);
                    }}
                  />
                )
              }
            />
          )}
          {busy && (
            <div className={componentClass(styles, "task-loading")} role="status">
              {t("Opening task…")}
            </div>
          )}
          {at("mainPanel").map(panel)}
        </Slot>
        {task && review.open && review.summary && (
          <div className={componentClass(styles, "review-slot")}>
            <SlotResizer axis="horizontal" edge="left" />
            <ReviewPane
              taskId={task.id}
              refreshKey={review.revision}
              working={working}
              onChanged={() => void review.refresh()}
              onClose={() => review.setOpen(false)}
            />
          </div>
        )}
        {!!at("secondarySidebar").length && (
          <Slot kind="side" edge="right">
            {at("secondarySidebar").map(panel)}
          </Slot>
        )}
      </div>
      {!!at("bottomPanel").length && <Slot kind="bottom">{at("bottomPanel").map(panel)}</Slot>}
    </>
  );
}
