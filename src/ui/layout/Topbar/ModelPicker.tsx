import { componentClass } from "../../componentClass.ts";
import { useEffect, useRef, useState } from "react";
import { t } from "../../../core/i18n.ts";
import { Icon } from "../../primitives/Icon.tsx";
import styles from "./ModelPicker.module.css";

interface Model {
  provider: string;
  id: string;
  name?: string;
}

export function ModelPicker({
  models,
  value,
  disabled,
  onChange,
}: {
  models: Model[];
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const selected = models.find((model) => `${model.provider}/${model.id}` === value);
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
    if (!open) return;
    search.current?.focus();
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
        className={componentClass(styles, "model-picker-trigger")}
        aria-label={t("Model")}
        aria-expanded={open}
        aria-haspopup="dialog"
        title={selected ? `${selected.provider} / ${selected.id}` : t("Default model")}
        disabled={disabled}
        onClick={() => {
          setQuery("");
          setOpen((current) => !current);
        }}
      >
        <span>{selected?.name || selected?.id || t("Default model")}</span>
        {selected && <small>{selected.provider}</small>}
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
                root.current
                  ?.querySelector<HTMLButtonElement>(
                    `.${componentClass(styles, "model-picker-results")} button`,
                  )
                  ?.focus();
              }
            }}
          />
          <div className={componentClass(styles, "model-picker-results")}>
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
                      onClick={() => {
                        onChange(key);
                        setOpen(false);
                        trigger.current?.focus();
                      }}
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
      )}
    </div>
  );
}
