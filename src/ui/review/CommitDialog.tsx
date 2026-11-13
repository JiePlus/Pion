import { useState } from "react";
import { t } from "../../core/i18n.ts";
import type { CommitFollowUp, GitReview } from "../../core/git-review.ts";
import { componentClass } from "../componentClass.ts";
import { Button } from "../primitives/Button.tsx";
import { Checkbox } from "../primitives/Checkbox.tsx";
import { Dialog } from "../primitives/Dialog.tsx";
import { MenuItem } from "../primitives/Popover.tsx";
import styles from "./ReviewPane.module.css";

const DRAFT_KEY = "pion.review.commitDraft";

function draft(): string {
  try {
    return localStorage.getItem(DRAFT_KEY) ?? "";
  } catch {
    return "";
  }
}

export function CommitDialog({
  review,
  busy,
  error,
  onClose,
  onCommit,
}: {
  review: GitReview;
  busy: boolean;
  error: string;
  onClose: () => void;
  onCommit: (args: { message: string; includeUnstaged: boolean; then: CommitFollowUp }) => void;
}) {
  const [text, setText] = useState(draft);
  // With nothing staged, committing only makes sense with the unstaged changes included.
  const [includeUnstaged, setIncludeUnstaged] = useState(review.staged === 0);
  const [then, setThen] = useState<CommitFollowUp>("commit");
  const canPublish = review.remote && !review.detached;
  const nothing = !review.staged && !includeUnstaged;

  function update(value: string) {
    setText(value);
    try {
      if (value) localStorage.setItem(DRAFT_KEY, value);
      else localStorage.removeItem(DRAFT_KEY);
    } catch {
      // Drafts are a convenience only.
    }
  }

  const steps: { value: CommitFollowUp; label: string; description: string }[] = [
    { value: "commit", label: t("Commit"), description: t("Record the changes locally") },
    {
      value: "push",
      label: t("Commit and push"),
      description: t("Publish the branch to its remote"),
    },
    {
      value: "pr",
      label: t("Commit and create PR"),
      description: t("Push, then open a pull request with the GitHub CLI"),
    },
  ];

  return (
    <Dialog
      titleId="commit-dialog-title"
      onClose={onClose}
      className={componentClass(styles, "commit-dialog")}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!text.trim() || nothing || busy) return;
          onCommit({ message: text.trim(), includeUnstaged, then });
        }}
      >
        <h2 id="commit-dialog-title">{t("Commit your changes")}</h2>
        <p className={componentClass(styles, "muted")}>
          {review.detached ? t("Detached HEAD") : review.branch} ·{" "}
          {t("{staged} staged, {unstaged} unstaged", {
            staged: review.staged,
            unstaged: review.unstaged,
          })}
        </p>
        <label className={componentClass(styles, "field")}>
          {t("Commit message")}
          <textarea
            autoFocus
            rows={4}
            value={text}
            placeholder={t("Summarize what changed")}
            onChange={(event) => update(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }
            }}
          />
        </label>
        {review.unstaged > 0 && (
          <label className={componentClass(styles, "check")}>
            <Checkbox
              checked={includeUnstaged}
              onChange={(event) => setIncludeUnstaged(event.target.checked)}
            />
            {t("Include unstaged changes")}
          </label>
        )}
        <div
          className={componentClass(styles, "steps")}
          role="radiogroup"
          aria-label={t("Next step")}
        >
          {steps.map((step) => (
            <MenuItem
              key={step.value}
              label={step.label}
              description={step.description}
              checked={then === step.value}
              disabled={step.value !== "commit" && !canPublish}
              onSelect={() => setThen(step.value)}
            />
          ))}
        </div>
        {error && (
          <p className={componentClass(styles, "error")} role="alert">
            {error}
          </p>
        )}
        <div className={componentClass(styles, "dialog-actions")}>
          <Button type="button" variant="ghost" onClick={onClose}>
            {t("Cancel")}
          </Button>
          <Button type="submit" variant="primary" disabled={busy || !text.trim() || nothing}>
            {busy ? t("Working…") : t("Continue")}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

export function clearCommitDraft() {
  try {
    localStorage.removeItem(DRAFT_KEY);
  } catch {
    // Ignore unavailable storage.
  }
}
