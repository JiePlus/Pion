import { useCallback, useEffect, useRef, useState } from "react";
import type { GitSummary } from "../../core/git-review.ts";
import { host, hostEvents, native } from "../../core/host.ts";

const OPEN_KEY = "pion.review.open";

function savedOpen(): boolean {
  try {
    return localStorage.getItem(OPEN_KEY) === "true";
  } catch {
    return false;
  }
}

// Review pane visibility, the topbar change summary, and a revision that tells
// the pane to reload after each Pi turn.
// `connected` is whether the task's Pi is ready. Waiting for it keeps the summary (git
// status) behind the chat's own read in the Core lane, which is queued first.
export function useGitReview(taskId: string | null, enabled = true, connected = true) {
  const [open, setOpenState] = useState(savedOpen);
  const [summary, setSummary] = useState<GitSummary | null>(null);
  const [revision, setRevision] = useState(0);
  const request = useRef(0);

  const refresh = useCallback(async () => {
    if (!native || !taskId || !enabled) {
      setSummary(null);
      return;
    }
    if (!connected) return;
    const id = ++request.current;
    try {
      const value = await host<GitSummary>({ op: "git.summary" });
      if (id === request.current) setSummary(value);
    } catch {
      if (id === request.current) setSummary(null);
    }
  }, [taskId, enabled, connected]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(
    () =>
      hostEvents.on("pi:event", (value) => {
        const type = (value as { type?: string }).type;
        if (type === "agent_settled") {
          setRevision((count) => count + 1);
          void refresh();
        }
      }),
    [refresh],
  );

  useEffect(() => {
    const focus = () => void refresh();
    window.addEventListener("focus", focus);
    return () => window.removeEventListener("focus", focus);
  }, [refresh]);

  const setOpen = useCallback((value: boolean) => {
    setOpenState(value);
    try {
      localStorage.setItem(OPEN_KEY, String(value));
    } catch {
      // The pane still toggles for this session.
    }
  }, []);

  return { open: open && enabled, setOpen, summary, refresh, revision };
}

export type GitReviewState = ReturnType<typeof useGitReview>;
