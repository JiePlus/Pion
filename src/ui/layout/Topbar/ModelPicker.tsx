import { componentClass } from "../../componentClass.ts";
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { t } from "../../../core/i18n.ts";
import { Icon } from "../../primitives/Icon.tsx";
import styles from "./ModelPicker.module.css";

export interface Model {
  provider: string;
  id: string;
  name?: string;
}

export function ModelPicker({
  models,
  value,
  disabled,
  onChange,
  badges,
  footer,
  quiet = false,
}: {
  models: Model[];
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
  /** Small tags after the model name, e.g. a non-default thinking level. */
  badges?: ReactNode;
  /** Extra controls under the model list that shape how the model works. */
  footer?: ReactNode;
  /** Flush with its container until hovered; used inside the composer. */
  quiet?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const selected = models.find((model) => `${model.provider}/${model.id}` === value);
  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);

  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  return (
    <div
      className={componentClass(styles, "model-picker")}
      ref={root}
      onKeyDown={(event) => {
        if (event.key === "Escape" && open) {
          event.preventDefault();
          setOpen(false);
          trigger.current?.focus();
        }
      }}
    >
      <button
        ref={trigger}
        type="button"
        className={`${componentClass(styles, "model-picker-trigger")} ${quiet ? componentClass(styles, "quiet") : ""}`}
        aria-label={t("Model")}
        aria-expanded={open}
        aria-haspopup="dialog"
        title={selected ? `${selected.provider} / ${selected.id}` : t("Default model")}
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
      >
        <span>{selected?.name || selected?.id || t("Default model")}</span>
        {selected && !quiet && <small>{selected.provider}</small>}
        {badges}
        <span className={componentClass(styles, "model-picker-chevron")} aria-hidden="true">
          <Icon name="chevron-down" size={14} />
        </span>
      </button>
      {open && (
        <div
          className={componentClass(styles, "model-picker-menu")}
          role="dialog"
          aria-label={t("Model")}
        >
          <ModelList
            models={models}
            value={value}
            onPick={(key) => {
              onChange(key);
              setOpen(false);
              trigger.current?.focus();
            }}
          />
          {footer && <div className={componentClass(styles, "model-picker-footer")}>{footer}</div>}
        </div>
      )}
    </div>
  );
}

// Searchable, provider-grouped model list. Used by the picker and by "More models".
export function ModelList({
  models,
  value,
  onPick,
}: {
  models: Model[];
  value: string;
  onPick: (key: string) => void;
}) {
  const [query, setQuery] = useState("");
  const root = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const matches = models.filter((model) =>
    `${model.name ?? model.id} ${model.id} ${model.provider}`
      .toLowerCase()
      .includes(query.trim().toLowerCase()),
  );
  const groups = new Map<string, Model[]>();
  for (const model of matches) {
    const group = groups.get(model.provider) ?? [];
    group.push(model);
    groups.set(model.provider, group);
  }
  useEffect(() => {
    search.current?.focus();
  }, []);
  return (
    <div ref={root} className={componentClass(styles, "model-list")}>
      <input
        ref={search}
        type="search"
        aria-label={t("Search models")}
        placeholder={t("Search models")}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            root.current?.querySelector<HTMLButtonElement>("button")?.focus();
          }
        }}
      />
      <div
        className={componentClass(styles, "model-picker-results")}
        onKeyDown={(event) => {
          if (!["ArrowDown", "ArrowUp"].includes(event.key)) return;
          const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>("button")];
          const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
          event.preventDefault();
          if (event.key === "ArrowUp" && index <= 0) search.current?.focus();
          else
            buttons[
              Math.min(buttons.length - 1, index + (event.key === "ArrowDown" ? 1 : -1))
            ]?.focus();
        }}
      >
        {[...groups].map(([provider, items]) => (
          <section key={provider}>
            <h3>{provider}</h3>
            {items.map((model) => {
              const key = `${model.provider}/${model.id}`;
              return (
                <button
                  key={key}
                  type="button"
                  aria-label={`${model.name || model.id} · ${provider}`}
                  aria-pressed={key === value}
                  onClick={() => onPick(key)}
                >
                  <span>{model.name || model.id}</span>
                  {key === value && <span aria-hidden="true">✓</span>}
                </button>
              );
            })}
          </section>
        ))}
        {!matches.length && <p>{t("No matching models.")}</p>}
      </div>
    </div>
  );
}
