import { StatusDot } from "./primitives/StatusDot.tsx";
import { Button } from "./primitives/Button.tsx";
import { componentClass } from "./componentClass.ts";
import { Component, createContext, useContext, useLayoutEffect, useRef, useState } from "react";
import type { ErrorInfo, ReactNode } from "react";
import type { Json, View } from "../core/api.ts";
import { t } from "../core/i18n.ts";
import styles from "./View.module.css";

export const DraftScope = createContext("");

type Run = (id: string, args?: Json) => Promise<Json>;
export class PanelBoundary extends Component<{ children: ReactNode }, { error: string }> {
  state = { error: "" };
  static getDerivedStateFromError(error: Error) {
    return { error: error.message };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Panel render failed", error, info);
  }
  render() {
    return this.state.error ? (
      <p role="alert">
        {t("Panel failed: {error}. Reload this plugin.", { error: this.state.error })}
      </p>
    ) : (
      this.props.children
    );
  }
}
export function ViewRenderer({ view, run }: { view: View; run: Run }) {
  switch (view.type) {
    case "stack":
      return <Stack view={view} run={run} />;
    case "row":
      return <Row view={view} run={run} />;
    case "text":
      return (
        <p
          className={`${componentClass(styles, "view-text")} ${view.tone ? componentClass(styles, view.tone) : ""}`}
        >
          {view.text}
        </p>
      );
    case "badge":
      return (
        <span className={componentClass(styles, "badge")}>
          <StatusDot />
          {view.text}
        </span>
      );
    case "list":
      return (
        <div className={componentClass(styles, "view-list")}>
          {view.items.map((item, index) => (
            <article key={index}>
              <div className={componentClass(styles, "item-label")}>{item.label}</div>
              <div className={componentClass(styles, "item-text")}>{item.text}</div>
            </article>
          ))}
        </div>
      );
    case "table":
      return <DataTable view={view} />;
    case "code":
      return (
        <pre className={componentClass(styles, "view-code")} data-language={view.language}>
          <code>{view.text}</code>
        </pre>
      );
    case "diff":
      return <Diff text={view.text} />;
    case "image":
      return (
        <figure className={componentClass(styles, "view-image")}>
          <img src={view.src} alt={view.alt ?? ""} />
          {view.alt && <figcaption>{view.alt}</figcaption>}
        </figure>
      );
    case "input":
      return <InlineInput view={view} run={run} />;
    case "button":
      return <Action view={view} run={run} />;
    case "form":
      return <CommandForm view={view} run={run} />;
  }
}
function DataTable({ view }: { view: Extract<View, { type: "table" }> }) {
  return (
    <div className={componentClass(styles, "view-table-wrap")}>
      <table className={componentClass(styles, "view-table")}>
        {view.caption && <caption>{view.caption}</caption>}
        <thead>
          <tr>
            {view.columns.map((column) => (
              <th key={column.key}>{column.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {view.rows.map((row, index) => (
            <tr key={index}>
              {view.columns.map((column) => (
                <td key={column.key}>{row[column.key] ?? ""}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
function DiffLine({ className, text }: { className: string; text: string }) {
  return (
    <span className={`${componentClass(styles, "diff-line")} ${className}`}>
      <span className={componentClass(styles, "diff-text")}>{text || " "}</span>
    </span>
  );
}
function Diff({ text }: { text: string }) {
  const lines = text.split("\n");
  if (lines.length && lines[lines.length - 1] === "") lines.pop();
  let oldNumber = 0;
  let newNumber = 0;
  let inHunk = false;
  return (
    <pre className={componentClass(styles, "view-diff")}>
      {lines.map((line, index) => {
        const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
        if (hunk) {
          oldNumber = Number(hunk[1]);
          newNumber = Number(hunk[2]);
          inHunk = true;
          return (
            <DiffLine key={index} className={componentClass(styles, "diff-hunk")} text={line} />
          );
        }
        if (!inHunk) {
          return (
            <DiffLine key={index} className={componentClass(styles, "diff-meta")} text={line} />
          );
        }
        const sign = line[0];
        if (sign === "\\") {
          return (
            <DiffLine key={index} className={componentClass(styles, "diff-meta")} text={line} />
          );
        }
        let oldText = "";
        let newText = "";
        if (sign === "+") newText = String(newNumber++);
        else if (sign === "-") oldText = String(oldNumber++);
        else {
          oldText = String(oldNumber++);
          newText = String(newNumber++);
        }
        const body = line.length ? line.slice(1) : "";
        const tone = sign === "+" ? "diff-add" : sign === "-" ? "diff-del" : "diff-context";
        return (
          <span
            key={index}
            className={`${componentClass(styles, "diff-line")} ${componentClass(styles, tone)}`}
          >
            <span className={componentClass(styles, "diff-no")}>{oldText}</span>
            <span className={componentClass(styles, "diff-no")}>{newText}</span>
            <span className={componentClass(styles, "diff-sign")}>{sign === " " ? " " : sign}</span>
            <span className={componentClass(styles, "diff-text")}>{body || " "}</span>
          </span>
        );
      })}
    </pre>
  );
}
function InlineInput({ view, run }: { view: Extract<View, { type: "input" }>; run: Run }) {
  const scope = useContext(DraftScope);
  const draftKey = `pion.draft.${scope}.${view.command}`;
  const [text, setText] = useState(() => localStorage.getItem(draftKey) ?? "");
  const [busy, setBusy] = useState(false);
  function updateText(value: string) {
    setText(value);
    if (value) localStorage.setItem(draftKey, value);
    else localStorage.removeItem(draftKey);
  }
  return (
    <form
      className={componentClass(styles, "view-input")}
      onSubmit={(event) => {
        event.preventDefault();
        if (busy || view.disabled) return;
        setBusy(true);
        run(view.command, { text })
          .then(
            () => updateText(""),
            () => {},
          )
          .finally(() => setBusy(false));
      }}
    >
      {view.label && <label>{view.label}</label>}
      <div className={componentClass(styles, "view-input-row")}>
        <input
          aria-label={view.label ?? view.placeholder}
          placeholder={view.placeholder}
          value={text}
          disabled={view.disabled || busy}
          onChange={(event) => updateText(event.target.value)}
        />
        <button type="submit" disabled={view.disabled || busy}>
          {view.submit}
        </button>
      </div>
    </form>
  );
}
// Key by type + command + occurrence rather than position, so inserting a status line above an
// input does not remount it (a remount would re-read a draft that a successful submit clears).
function childKeys(children: View[]): [View, string][] {
  const seen = new Map<string, number>();
  return children.map((child) => {
    const base = `${child.type}:${"command" in child ? child.command : ""}`;
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    return [child, `${base}:${count}`];
  });
}
function Stack({ view, run }: { view: Extract<View, { type: "stack" }>; run: Run }) {
  const element = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  useLayoutEffect(() => {
    if (element.current && follow.current) element.current.scrollTop = element.current.scrollHeight;
  }, [view]);
  return (
    <div
      className={componentClass(styles, "view-stack")}
      ref={element}
      onScroll={(event) => {
        const node = event.currentTarget;
        follow.current = node.scrollHeight - node.scrollTop - node.clientHeight < 80;
      }}
    >
      {childKeys(view.children).map(([child, key]) => (
        <ViewRenderer key={key} view={child} run={run} />
      ))}
    </div>
  );
}
function Row({ view, run }: { view: Extract<View, { type: "row" }>; run: Run }) {
  return (
    <div
      className={componentClass(styles, "view-row")}
      data-align={view.align ?? "center"}
      data-gap={view.gap ?? "md"}
    >
      {childKeys(view.children).map(([child, key]) => (
        <ViewRenderer key={key} view={child} run={run} />
      ))}
    </div>
  );
}
function Action({ view, run }: { view: Extract<View, { type: "button" }>; run: Run }) {
  const [busy, setBusy] = useState(false);
  const row = view.variant === "row";
  return (
    <button
      className={componentClass(styles, row ? "action-row" : "action-inline")}
      disabled={view.disabled || busy}
      aria-busy={busy}
      onClick={() => {
        setBusy(true);
        run(view.command, view.args)
          .catch(() => {})
          .finally(() => setBusy(false));
      }}
    >
      {row && view.badge && (
        <span className={componentClass(styles, `action-badge-${view.badge.tone}`)}>
          {view.badge.text}
        </span>
      )}
      {row ? (
        <span className={componentClass(styles, "action-row-body")}>
          <span className={componentClass(styles, "action-row-label")}>{view.label}</span>
          {view.detail && (
            <span className={componentClass(styles, "action-row-detail")}>{view.detail}</span>
          )}
        </span>
      ) : (
        <span className={componentClass(styles, "action-inline-label")}>{view.label}</span>
      )}
    </button>
  );
}
function CommandForm({ view, run }: { view: Extract<View, { type: "form" }>; run: Run }) {
  const scope = useContext(DraftScope);
  const draftKey = `pion.draft.${scope}.${view.command}`;
  const [text, setText] = useState(() => localStorage.getItem(draftKey) ?? "");
  function updateText(value: string) {
    setText(value);
    if (value) localStorage.setItem(draftKey, value);
    else localStorage.removeItem(draftKey);
  }
  const [busy, setBusy] = useState(false);
  return (
    <form
      className={componentClass(styles, "command-form")}
      onSubmit={(event) => {
        event.preventDefault();
        if (!text.trim() || busy || view.disabled) return;
        setBusy(true);
        run(view.command, { text })
          .then(
            () => updateText(""),
            () => {},
          )
          .finally(() => setBusy(false));
      }}
    >
      <textarea
        aria-label={view.placeholder}
        placeholder={view.placeholder}
        value={text}
        disabled={view.disabled || busy}
        onChange={(event) => updateText(event.target.value)}
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
        rows={3}
      />
      <div className={componentClass(styles, "composer-footer")}>
        <span>{t("Pi uses your configured tools and model")}</span>
        <Button
          variant="primary"
          className="primary"
          disabled={view.disabled || busy || !text.trim()}
          type="submit"
        >
          {busy ? t("Sending…") : view.submit} <span aria-hidden="true">↗</span>
        </Button>
      </div>
    </form>
  );
}
