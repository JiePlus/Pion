import { useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { componentClass } from "../componentClass.ts";
import { Icon } from "./Icon.tsx";
import { Popover } from "./Popover.tsx";
import type { Placement } from "./Popover.tsx";
import styles from "./Select.module.css";

export interface SelectOption<T extends string> {
  value: T;
  label: string;
  description?: string;
}

// Select-only combobox: a glass trigger and listbox in place of the native <select>,
// so the menu matches the app instead of the operating system. ↑↓ move, Enter picks, Esc closes.
export function Select<T extends string>({
  label,
  value,
  options,
  onChange,
  placeholder,
  disabled = false,
  placement = "bottom-start",
  compact = false,
}: {
  label: string;
  value: T | "";
  options: SelectOption<T>[];
  onChange: (value: T) => void;
  placeholder?: string;
  disabled?: boolean;
  placement?: Placement;
  /** Pill-sized trigger for toolbars. */
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [width, setWidth] = useState(0);
  const trigger = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const current = options.find((option) => option.value === value);

  function show() {
    setWidth(trigger.current?.offsetWidth ?? 0);
    setOpen(true);
    // Start on the chosen option, like a native menu.
    requestAnimationFrame(() =>
      list.current
        ?.querySelector<HTMLButtonElement>('[aria-selected="true"], [role="option"]')
        ?.focus(),
    );
  }

  function pick(next: T) {
    setOpen(false);
    trigger.current?.focus();
    if (next !== value) onChange(next);
  }

  function move(event: KeyboardEvent<HTMLDivElement>) {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const items = [...(list.current?.querySelectorAll<HTMLButtonElement>('[role="option"]') ?? [])];
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? items.length - 1
          : Math.max(0, Math.min(items.length - 1, index + (event.key === "ArrowDown" ? 1 : -1)));
    items[next]?.focus();
  }

  return (
    <span className={componentClass(styles, "select")}>
      <button
        ref={trigger}
        type="button"
        role="combobox"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        data-value={value}
        disabled={disabled}
        className={`${componentClass(styles, "trigger")} ${compact ? componentClass(styles, "compact") : ""}`}
        onClick={() => (open ? setOpen(false) : show())}
        onKeyDown={(event) => {
          if (["ArrowDown", "ArrowUp", "Enter", " "].includes(event.key) && !open) {
            event.preventDefault();
            show();
          }
        }}
      >
        <span className={current ? "" : componentClass(styles, "placeholder")}>
          {current?.label ?? placeholder ?? ""}
        </span>
        <Icon name="chevron-down" size={14} />
      </button>
      <Popover
        open={open}
        onClose={() => setOpen(false)}
        anchor={trigger}
        placement={placement}
        role="listbox"
        label={label}
        className={componentClass(styles, "listbox")}
      >
        <div ref={list} onKeyDown={move} style={{ minWidth: width ? width - 12 : undefined }}>
          {options.map((option) => (
            <button
              key={option.value}
              type="button"
              role="option"
              aria-selected={option.value === value}
              data-value={option.value}
              className={componentClass(styles, "option")}
              onClick={() => pick(option.value)}
            >
              <span>
                {option.label}
                {option.description && <small>{option.description}</small>}
              </span>
              {option.value === value && <Icon name="check" size={15} />}
            </button>
          ))}
        </div>
      </Popover>
    </span>
  );
}
