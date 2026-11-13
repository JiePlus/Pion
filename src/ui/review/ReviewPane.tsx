import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { host } from "../../core/host.ts";
import { t } from "../../core/i18n.ts";
import type { MessageKey } from "../../core/i18n.ts";
import { parseDiff, splitPath, totals } from "../../core/git-review.ts";
import type {
  DiffFile,
  DiffHunk,
  GitBranch,
  GitReview,
  HunkAction,
  ReviewScope,
} from "../../core/git-review.ts";
import { componentClass } from "../componentClass.ts";
import { Button } from "../primitives/Button.tsx";
import { Icon } from "../primitives/Icon.tsx";
import { MenuItem, MenuSeparator, Popover } from "../primitives/Popover.tsx";
import { Segmented } from "../primitives/Segmented.tsx";
import { clearCommitDraft, CommitDialog } from "./CommitDialog.tsx";
import styles from "./ReviewPane.module.css";

const SCOPE_KEY = "pion.review.scope";
const LARGE_FILE = 400;
const scopes: ReviewScope[] = ["unstaged", "staged", "branch", "turn"];

function savedScope(): ReviewScope {
  try {
    const value = localStorage.getItem(SCOPE_KEY) as ReviewScope | null;
    return value && scopes.includes(value) ? value : "unstaged";
  } catch {
    return "unstaged";
  }
}

function message(error: unknown): string {
  return String(error instanceof Error ? error.message : error).replace(/^Error:\s*/, "");
}

const changeBadge: Record<string, { letter: string; tone: string; label: MessageKey }> = {
  added: { letter: "A", tone: "add", label: "Added" },
  deleted: { letter: "D", tone: "delete", label: "Deleted" },
  modified: { letter: "M", tone: "modify", label: "Modified" },
  renamed: { letter: "R", tone: "rename", label: "Renamed" },
  untracked: { letter: "U", tone: "untracked", label: "Untracked" },
};

// Two-step destructive button: the first click arms it, the second confirms.
function ConfirmButton({
  label,
  confirm,
  disabled,
  onConfirm,
}: {
  label: string;
  confirm: string;
  disabled?: boolean;
  onConfirm: () => void;
}) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const timer = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(timer);
  }, [armed]);
  return (
    <button
      type="button"
      className={`${componentClass(styles, "chip")} ${armed ? componentClass(styles, "danger") : ""}`}
      disabled={disabled}
      onClick={(event) => {
        event.stopPropagation();
        if (!armed) return setArmed(true);
        setArmed(false);
        onConfirm();
      }}
    >
      {armed ? confirm : label}
    </button>
  );
}

function Chip({
  children,
  onClick,
  disabled,
  title,
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      className={componentClass(styles, "chip")}
      disabled={disabled}
      title={title}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
    >
      {children}
    </button>
  );
}

function HunkView({ hunk, actions }: { hunk: DiffHunk; actions: ReactNode }) {
  return (
    <div className={componentClass(styles, "hunk")}>
      <div className={componentClass(styles, "hunk-header")}>
        <code>{hunk.header}</code>
        <span className={componentClass(styles, "hunk-actions")}>{actions}</span>
      </div>
      <div className={componentClass(styles, "lines")} role="table">
        {hunk.lines.map((line, index) => (
          <div
            key={index}
            role="row"
            className={`${componentClass(styles, "line")} ${componentClass(styles, `line-${line.kind}`)}`}
          >
            <span className={componentClass(styles, "no")}>{line.oldNo ?? ""}</span>
            <span className={componentClass(styles, "no")}>{line.newNo ?? ""}</span>
            <span className={componentClass(styles, "sign")}>
              {line.kind === "add" ? "+" : line.kind === "del" ? "−" : ""}
            </span>
            <span className={componentClass(styles, "text")}>{line.text || " "}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function ReviewPane({
  taskId,
  refreshKey,
  working,
  onChanged,
  onClose,
}: {
  taskId: string;
  refreshKey: number;
  working: boolean;
  onChanged: () => void;
  onClose: () => void;
}) {
  const [scope, setScopeState] = useState<ReviewScope>(savedScope);
  const [review, setReview] = useState<GitReview | null>(null);
  const [notRepo, setNotRepo] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState<{ text: string; url?: string } | null>(null);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [commitOpen, setCommitOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [branchOpen, setBranchOpen] = useState(false);
  const [branches, setBranches] = useState<GitBranch[]>([]);
  const [newBranch, setNewBranch] = useState("");
  const moreButton = useRef<HTMLButtonElement>(null);
  const branchButton = useRef<HTMLButtonElement>(null);
  const request = useRef(0);

  const setScope = (value: ReviewScope) => {
    setScopeState(value);
    try {
      localStorage.setItem(SCOPE_KEY, value);
    } catch {
      // Storage may be unavailable; the choice still applies for this session.
    }
  };

  const load = useCallback(async () => {
    const id = ++request.current;
    setLoading(true);
    try {
      const next = await host<GitReview>({ op: "git.review", scope });
      if (id !== request.current) return;
      setReview(next);
      setNotRepo(false);
      setError("");
    } catch (failure) {
      if (id !== request.current) return;
      const text = message(failure);
      if (/not a Git repository/i.test(text)) {
        setNotRepo(true);
        setReview(null);
        setError("");
      } else setError(text);
    } finally {
      if (id === request.current) setLoading(false);
    }
  }, [scope]);

  useEffect(() => {
    void load();
  }, [load, refreshKey, taskId]);

  useEffect(() => {
    const focus = () => void load();
    window.addEventListener("focus", focus);
    return () => window.removeEventListener("focus", focus);
  }, [load]);

  const files = useMemo(() => (review ? parseDiff(review.diff, review.scope) : []), [review]);
  const sum = totals(files);

  async function act<T>(work: () => Promise<T>, done?: (value: T) => void) {
    setBusy(true);
    setError("");
    setNotice(null);
    try {
      const value = await work();
      done?.(value);
    } catch (failure) {
      setError(message(failure));
    } finally {
      setBusy(false);
      onChanged();
      await load();
    }
  }

  const git = <T = unknown,>(op: string, args: Record<string, unknown> = {}) =>
    host<T>({ op, ...args });

  function hunkAction(file: DiffFile, hunk: DiffHunk, action: HunkAction) {
    void act(() => git("git.hunk", { action, path: file.path, hunk: hunk.text }));
  }

  function fileActions(file: DiffFile) {
    if (scope === "staged")
      return (
        <Chip
          disabled={busy}
          onClick={() => void act(() => git("git.unstage", { paths: [file.path] }))}
        >
          {t("Unstage")}
        </Chip>
      );
    if (scope !== "unstaged") return null;
    return (
      <>
        <ConfirmButton
          label={t(file.untracked ? "Delete" : "Revert")}
          confirm={t(file.untracked ? "Confirm delete" : "Confirm revert")}
          disabled={busy}
          onConfirm={() => void act(() => git("git.revert", { paths: [file.path] }))}
        />
        <Chip
          disabled={busy}
          onClick={() => void act(() => git("git.stage", { paths: [file.path] }))}
        >
          {t("Stage")}
        </Chip>
      </>
    );
  }

  function hunkActions(file: DiffFile, hunk: DiffHunk) {
    // Untracked files have no index entry to patch; stage or delete them whole.
    if (file.untracked || file.binary) return null;
    if (scope === "staged")
      return (
        <Chip disabled={busy} onClick={() => hunkAction(file, hunk, "unstage")}>
          {t("Unstage hunk")}
        </Chip>
      );
    if (scope !== "unstaged") return null;
    return (
      <>
        <ConfirmButton
          label={t("Revert hunk")}
          confirm={t("Confirm revert")}
          disabled={busy}
          onConfirm={() => hunkAction(file, hunk, "revert")}
        />
        <Chip disabled={busy} onClick={() => hunkAction(file, hunk, "stage")}>
          {t("Stage hunk")}
        </Chip>
      </>
    );
  }

  async function openBranches() {
    setBranchOpen((open) => !open);
    try {
      setBranches((await git<{ branches: GitBranch[] }>("git.branches")).branches);
    } catch (failure) {
      setError(message(failure));
    }
  }

  function remote(op: "git.fetch" | "git.pull" | "git.push", done: MessageKey) {
    setMoreOpen(false);
    void act(
      () => git(op),
      () => setNotice({ text: t(done) }),
    );
  }

  const scopeLabel = (value: ReviewScope) =>
    value === "unstaged"
      ? `${t("Unstaged")}${review?.unstaged ? ` ${review.unstaged}` : ""}`
      : value === "staged"
        ? `${t("Staged")}${review?.staged ? ` ${review.staged}` : ""}`
        : value === "branch"
          ? t("Branch")
          : t("Last turn");

  const empty =
    scope === "turn" && review && !review.turnAvailable
      ? t("Send a message to review what the next turn changes.")
      : scope === "branch" && review && !review.base
        ? t("No base branch found to compare with.")
        : scope === "staged"
          ? t("Nothing is staged.")
          : t("No changes.");

  return (
    <aside className={componentClass(styles, "review")} aria-label={t("Review")}>
      <header className={componentClass(styles, "head")}>
        <div className={componentClass(styles, "title-row")}>
          <h2>{t("Review")}</h2>
          <span className={componentClass(styles, "head-actions")}>
            <button
              type="button"
              className={componentClass(styles, "icon-button")}
              aria-label={t("Refresh")}
              title={t("Refresh")}
              disabled={loading || busy}
              onClick={() => void load()}
            >
              ⟳
            </button>
            <span className={componentClass(styles, "anchor")}>
              <button
                ref={moreButton}
                type="button"
                className={componentClass(styles, "icon-button")}
                aria-label={t("More Git actions")}
                aria-haspopup="menu"
                aria-expanded={moreOpen}
                disabled={!review || busy}
                onClick={() => setMoreOpen((open) => !open)}
              >
                <Icon name="dots" size={19} />
              </button>
              <Popover
                open={moreOpen}
                onClose={() => setMoreOpen(false)}
                anchor={moreButton}
                placement="bottom-end"
                role="menu"
                label={t("More Git actions")}
              >
                <MenuItem
                  label={t("Fetch")}
                  disabled={!review?.remote}
                  onSelect={() => remote("git.fetch", "Fetched from remote")}
                />
                <MenuItem
                  label={t("Pull")}
                  description={t("Fast-forward only")}
                  disabled={!review?.upstream}
                  onSelect={() => remote("git.pull", "Pulled latest changes")}
                />
                <MenuItem
                  label={t("Push")}
                  disabled={!review?.remote || review.detached}
                  onSelect={() => remote("git.push", "Pushed")}
                />
                <MenuSeparator />
                <MenuItem
                  label={t("Create pull request")}
                  disabled={!review?.remote || review.detached}
                  onSelect={() => {
                    setMoreOpen(false);
                    void act(
                      () => git<{ prUrl: string }>("git.pr"),
                      (value) => setNotice({ text: t("Pull request ready"), url: value.prUrl }),
                    );
                  }}
                />
              </Popover>
            </span>
            <button
              type="button"
              className={componentClass(styles, "icon-button")}
              aria-label={t("Close review")}
              title={t("Close review")}
              onClick={onClose}
            >
              ×
            </button>
          </span>
        </div>
        {review && (
          <div className={componentClass(styles, "branch-row")}>
            <span className={componentClass(styles, "anchor")}>
              <button
                ref={branchButton}
                type="button"
                className={componentClass(styles, "branch-button")}
                aria-haspopup="menu"
                aria-expanded={branchOpen}
                disabled={busy || working}
                title={
                  working ? t("Wait for the task to finish before switching branches") : undefined
                }
                onClick={() => void openBranches()}
              >
                <Icon name="branch" size={14} />
                <span>{review.detached ? t("Detached HEAD") : review.branch}</span>
                {(review.ahead > 0 || review.behind > 0) && (
                  <small>
                    ↑{review.ahead} ↓{review.behind}
                  </small>
                )}
                <Icon name="chevron-down" size={12} />
              </button>
              <Popover
                open={branchOpen}
                onClose={() => setBranchOpen(false)}
                anchor={branchButton}
                placement="bottom-start"
                role="menu"
                label={t("Branches")}
                className={componentClass(styles, "branch-menu")}
              >
                {branches.map((branch) => (
                  <MenuItem
                    key={branch.name}
                    label={branch.name}
                    description={branch.upstream || undefined}
                    checked={branch.current}
                    disabled={branch.current}
                    onSelect={() => {
                      setBranchOpen(false);
                      void act(
                        () => git("git.checkout", { branch: branch.name }),
                        () =>
                          setNotice({ text: t("Switched to {branch}", { branch: branch.name }) }),
                      );
                    }}
                  />
                ))}
                <MenuSeparator />
                <form
                  className={componentClass(styles, "new-branch")}
                  onSubmit={(event) => {
                    event.preventDefault();
                    const name = newBranch.trim();
                    if (!name) return;
                    setBranchOpen(false);
                    void act(
                      () => git("git.createBranch", { name }),
                      () => {
                        setNewBranch("");
                        setNotice({
                          text: t("Created and switched to {branch}", { branch: name }),
                        });
                      },
                    );
                  }}
                >
                  <input
                    aria-label={t("New branch name")}
                    placeholder={t("New branch name")}
                    value={newBranch}
                    onChange={(event) => setNewBranch(event.target.value)}
                  />
                  <button type="submit" disabled={!newBranch.trim()}>
                    {t("Create")}
                  </button>
                </form>
              </Popover>
            </span>
            <span className={componentClass(styles, "stat")}>
              <span className={componentClass(styles, "plus")}>+{sum.additions}</span>
              <span className={componentClass(styles, "minus")}>−{sum.deletions}</span>
            </span>
            <Button
              variant="primary"
              size="sm"
              disabled={busy || working || (!review.staged && !review.unstaged)}
              title={working ? t("Wait for the task to finish before committing") : undefined}
              onClick={() => setCommitOpen(true)}
            >
              {t("Commit")}
            </Button>
          </div>
        )}
        {review && (
          <Segmented
            label={t("Changes to review")}
            size="sm"
            value={scope}
            onChange={setScope}
            options={scopes.map((value) => ({ value, label: scopeLabel(value) }))}
          />
        )}
      </header>

      {error && (
        <p className={componentClass(styles, "error")} role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className={componentClass(styles, "notice")} role="status">
          {notice.text}{" "}
          {notice.url && (
            <a
              href={notice.url}
              target="_blank"
              rel="noreferrer"
              onClick={(event) => {
                event.preventDefault();
                host({ op: "model_auth.open_url", url: notice.url }).catch((failure) =>
                  setError(message(failure)),
                );
              }}
            >
              {notice.url}
            </a>
          )}
        </p>
      )}

      <div className={componentClass(styles, "body")}>
        {notRepo ? (
          <div className={componentClass(styles, "empty")}>
            <p>{t("This project is not a Git repository.")}</p>
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => void act(() => git("git.init"))}
            >
              {t("Initialize repository")}
            </Button>
          </div>
        ) : !review ? (
          loading && <p className={componentClass(styles, "muted")}>{t("Loading changes…")}</p>
        ) : (
          <>
            {!!files.length && (scope === "unstaged" || scope === "staged") && (
              <div className={componentClass(styles, "bulk")}>
                <span>{t("{count} files", { count: files.length })}</span>
                {scope === "unstaged" ? (
                  <Chip
                    disabled={busy}
                    onClick={() => void act(() => git("git.stage", { paths: ["."] }))}
                  >
                    {t("Stage all")}
                  </Chip>
                ) : (
                  <Chip
                    disabled={busy}
                    onClick={() => void act(() => git("git.unstage", { paths: ["."] }))}
                  >
                    {t("Unstage all")}
                  </Chip>
                )}
              </div>
            )}
            {scope === "branch" && review.base && !!files.length && (
              <p className={componentClass(styles, "muted")}>
                {t("Compared with {base}", { base: review.base })}
              </p>
            )}
            {!files.length && <p className={componentClass(styles, "muted")}>{empty}</p>}
            {review.truncated && (
              <p className={componentClass(styles, "muted")}>
                {t("The diff is too large to show completely.")}
              </p>
            )}
            {files.map((file) => {
              const key = `${scope}:${file.path}`;
              const isCollapsed = collapsed[key] ?? file.additions + file.deletions > LARGE_FILE;
              const { name, dir } = splitPath(file.path);
              const badge = changeBadge[file.untracked ? "untracked" : file.change];
              return (
                <section key={key} className={componentClass(styles, "file")} data-path={file.path}>
                  <div className={componentClass(styles, "file-head")}>
                    <button
                      type="button"
                      className={componentClass(styles, "file-toggle")}
                      aria-expanded={!isCollapsed}
                      title={file.path}
                      onClick={() => setCollapsed((state) => ({ ...state, [key]: !isCollapsed }))}
                    >
                      <Icon name={isCollapsed ? "chevron-right" : "chevron-down"} size={13} />
                      <span
                        className={`${componentClass(styles, "badge")} ${componentClass(styles, badge.tone)}`}
                        title={t(badge.label)}
                      >
                        {badge.letter}
                      </span>
                      <span className={componentClass(styles, "file-name")}>
                        <strong>{name}</strong>
                        {dir && <small>{dir}</small>}
                      </span>
                    </button>
                    <span className={componentClass(styles, "stat")}>
                      {!!file.additions && (
                        <span className={componentClass(styles, "plus")}>+{file.additions}</span>
                      )}
                      {!!file.deletions && (
                        <span className={componentClass(styles, "minus")}>−{file.deletions}</span>
                      )}
                    </span>
                    <span className={componentClass(styles, "file-actions")}>
                      {fileActions(file)}
                    </span>
                  </div>
                  {!isCollapsed && (
                    <div className={componentClass(styles, "file-body")}>
                      {file.oldPath && (
                        <p className={componentClass(styles, "muted")}>
                          {t("Renamed from {path}", { path: file.oldPath })}
                        </p>
                      )}
                      {file.binary ? (
                        <p className={componentClass(styles, "muted")}>
                          {t("Binary file not shown.")}
                        </p>
                      ) : !file.hunks.length ? (
                        <p className={componentClass(styles, "muted")}>{t("No text changes.")}</p>
                      ) : (
                        file.hunks.map((hunk, index) => (
                          <HunkView key={index} hunk={hunk} actions={hunkActions(file, hunk)} />
                        ))
                      )}
                    </div>
                  )}
                </section>
              );
            })}
          </>
        )}
      </div>
      {commitOpen && review && (
        <CommitDialog
          review={review}
          busy={busy}
          error={error}
          onClose={() => setCommitOpen(false)}
          onCommit={(args) =>
            act(
              () => git<{ hash: string; prUrl?: string; pushed?: boolean }>("git.commit", args),
              (value) => {
                setCommitOpen(false);
                clearCommitDraft();
                setNotice(
                  value.prUrl
                    ? {
                        text: t("Committed {hash} and opened a pull request", { hash: value.hash }),
                        url: value.prUrl,
                      }
                    : {
                        text: t(value.pushed ? "Committed and pushed {hash}" : "Committed {hash}", {
                          hash: value.hash,
                        }),
                      },
                );
              },
            )
          }
        />
      )}
    </aside>
  );
}
