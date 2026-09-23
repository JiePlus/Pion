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
    case "button":
      return <Action view={view} run={run} />;
    case "form":
      return <CommandForm view={view} run={run} />;
  }
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
      {view.children.map((child, index) => (
        <ViewRenderer
          key={"command" in child ? child.command : `${child.type}:${index}`}
          view={child}
          run={run}
        />
      ))}
    </div>
  );
}
function Action({ view, run }: { view: Extract<View, { type: "button" }>; run: Run }) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      disabled={view.disabled || busy}
      onClick={() => {
        setBusy(true);
        run(view.command, view.args)
          .catch(() => {})
          .finally(() => setBusy(false));
      }}
    >
      {view.label}
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
