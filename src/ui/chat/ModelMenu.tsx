import { useRef, useState } from "react";
import { componentClass } from "../componentClass.ts";
import { t } from "../../core/i18n.ts";
import type { MessageKey } from "../../core/i18n.ts";
import { Icon } from "../primitives/Icon.tsx";
import { MenuItem, MenuSeparator, Popover, Submenu } from "../primitives/Popover.tsx";
import { ModelList } from "../layout/Topbar/ModelPicker.tsx";
import type { Model } from "../layout/Topbar/ModelPicker.tsx";
import styles from "./ModelMenu.module.css";

const recentKey = "pion.recentModels";
const QUICK = 5;

// What each Pi thinking level is for, in one line. Unknown levels show without a note.
const levelNotes: Record<string, MessageKey> = {
  off: "Answers directly without thinking",
  minimal: "A brief check before answering",
  low: "Small edits and quick questions",
  medium: "Balanced speed and depth",
  high: "Complex changes and debugging",
  xhigh: "Large refactors and deep analysis",
  max: "Most thorough; slowest and uses the most",
};

const presets = [
  ["full", "Full tools", "Read and write files, run commands, and use extension tools"],
  ["read-only", "Read-only", "Only read, grep, find and ls"],
  ["chat", "Chat only", "No tools; conversation only"],
] as const satisfies readonly (readonly [string, MessageKey, MessageKey])[];

function readRecent(): string[] {
  try {
    const value = JSON.parse(localStorage.getItem(recentKey) ?? "[]");
    return Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
  } catch {
    return [];
  }
}

// Recents keep their order so the list doesn't jump; a new pick replaces the oldest.
function remember(key: string) {
  const recent = readRecent();
  if (recent.includes(key)) return;
  localStorage.setItem(recentKey, JSON.stringify([...recent, key].slice(-QUICK)));
}

function keyOf(model: Model) {
  return `${model.provider}/${model.id}`;
}

// One pill for how Pi works: a short list of recent models, then thinking and tools as
// rows that show their current value and open a side menu with one-line explanations.
export function ModelMenu({
  models,
  value,
  onModel,
  levels,
  thinking,
  onThinking,
  toolPreset,
  onToolPreset,
  disabled,
  locked,
}: {
  models: Model[];
  value: string;
  onModel: (key: string) => void;
  levels: string[];
  thinking: string;
  onThinking: (level: string) => void;
  toolPreset: string;
  onToolPreset: (preset: string) => void;
  /** No model service yet: the pill can't open at all. */
  disabled: boolean;
  /** A task is running: everything shows but nothing can change. */
  locked: boolean;
}) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const selected = models.find((model) => keyOf(model) === value);
  const byKey = new Map(models.map((model) => [keyOf(model), model]));
  const quick = [...readRecent().filter((key) => byKey.has(key))];
  if (selected && !quick.includes(value)) quick.unshift(value);
  for (const model of models) {
    if (quick.length >= Math.min(3, QUICK)) break;
    if (model.provider === selected?.provider && !quick.includes(keyOf(model)))
      quick.push(keyOf(model));
  }
  const names = new Map<string, number>();
  for (const key of quick) {
    const name = byKey.get(key)?.name ?? byKey.get(key)?.id ?? key;
    names.set(name, (names.get(name) ?? 0) + 1);
  }
  const presetLabel = presets.find(([preset]) => preset === toolPreset)?.[1];

  function pick(key: string) {
    remember(key);
    onModel(key);
    setOpen(false);
    trigger.current?.focus();
  }

  return (
    <span className={componentClass(styles, "anchor")}>
      <button
        ref={trigger}
        type="button"
        className={componentClass(styles, "model-pill")}
        aria-label={t("Model")}
        aria-haspopup="menu"
        aria-expanded={open}
        title={selected ? `${selected.provider} / ${selected.id}` : t("Default model")}
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
      >
        <span className={componentClass(styles, "pill-name")}>
          {selected?.name || selected?.id || t("Default model")}
        </span>
        {thinking !== "off" && levels.length > 1 && (
          <span className={componentClass(styles, "pill-tag")}>{thinking}</span>
        )}
        {(toolPreset === "read-only" || toolPreset === "chat") && (
          <span
            className={`${componentClass(styles, "pill-tag")} ${componentClass(styles, "tools")}`}
          >
            {t(toolPreset === "chat" ? "Chat only" : "Read-only")}
          </span>
        )}
        <Icon name="chevron-down" size={14} />
      </button>
      <Popover
        open={open}
        onClose={() => setOpen(false)}
        anchor={trigger}
        role="menu"
        label={t("Model")}
        className={componentClass(styles, "menu")}
      >
        {quick.map((key) => {
          const model = byKey.get(key)!;
          const name = model.name || model.id;
          return (
            <MenuItem
              key={key}
              label={(names.get(name) ?? 0) > 1 ? `${name} · ${model.provider}` : name}
              checked={key === value}
              disabled={locked}
              trailing={
                <span className={componentClass(styles, "provider")} aria-hidden="true">
                  {model.provider}
                </span>
              }
              onSelect={() => pick(key)}
            />
          );
        })}
        {models.length > quick.length && (
          <Submenu
            label={t("More models")}
            value={String(models.length)}
            role="dialog"
            wide
            disabled={locked}
          >
            <ModelList models={models} value={value} onPick={pick} />
          </Submenu>
        )}
        <MenuSeparator />
        {levels.length > 1 && (
          <Submenu label={t("Thinking")} value={thinking} disabled={locked}>
            <p className={componentClass(styles, "menu-note")}>
              {t("More thinking gives more thorough answers but takes longer and uses more.")}
            </p>
            {levels.map((level) => (
              <MenuItem
                key={level}
                label={level}
                description={levelNotes[level] ? t(levelNotes[level]) : undefined}
                checked={level === thinking}
                onSelect={() => onThinking(level)}
              />
            ))}
          </Submenu>
        )}
        <Submenu
          label={t("Tool preset")}
          value={presetLabel ? t(presetLabel) : t("Custom tools")}
          disabled={locked}
        >
          {presets.map(([preset, label, note]) => (
            <MenuItem
              key={preset}
              label={t(label)}
              description={t(note)}
              checked={preset === toolPreset}
              onSelect={() => onToolPreset(preset)}
            />
          ))}
          <p className={componentClass(styles, "menu-note")}>
            {t(
              "Tool presets change tools exposed to the model; Pi extensions remain trusted code.",
            )}
          </p>
        </Submenu>
        {locked && (
          <p className={componentClass(styles, "menu-note")}>
            {t("Model, thinking and tools can't change while a task runs.")}
          </p>
        )}
      </Popover>
    </span>
  );
}
