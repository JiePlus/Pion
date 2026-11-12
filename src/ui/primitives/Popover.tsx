import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent, ReactNode, RefObject } from "react";
import { componentClass } from "../componentClass.ts";
import { Icon } from "./Icon.tsx";
import type { IconName } from "./Icon.tsx";
import styles from "./Popover.module.css";

export type Placement = "top-start" | "top-end" | "bottom-start" | "bottom-end";

// Glass surface anchored to a trigger inside a positioned wrapper. Closes on outside
// pointer or Escape, returns focus to the trigger, and plays a short exit before unmounting.
export function Popover({
  open,
  onClose,
  anchor,
  placement = "top-start",
  role = "dialog",
  label,
  className,
  children,
}: {
  open: boolean;
  onClose: () => void;
  anchor: RefObject<HTMLElement | null>;
  placement?: Placement;
  role?: "dialog" | "menu" | "listbox";
  label: string;
  className?: string;
  children: ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(open);
  const closing = mounted && !open;

  useEffect(() => {
    if (open) setMounted(true);
    else if (mounted) {
      const timer = setTimeout(() => setMounted(false), 140);
      return () => clearTimeout(timer);
    }
  }, [open, mounted]);

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!panel.current?.contains(target) && !anchor.current?.contains(target)) onClose();
    };
    const escape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
      anchor.current?.focus();
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape, true);
    const first = panel.current?.querySelector<HTMLElement>(
      "input, [role='menuitem'], [role='option'], button:not(:disabled)",
    );
    first?.focus();
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape, true);
    };
  }, [open, onClose, anchor]);

  if (!mounted) return null;
  return (
    <div
      ref={panel}
      role={role}
      aria-label={label}
      data-state={closing ? "closing" : "open"}
      className={`${componentClass(styles, "popover")} ${componentClass(styles, placement)} ${className ?? ""}`}
      onKeyDown={role === "menu" ? roveMenu : undefined}
    >
      {children}
    </div>
  );
}

// Up/Down move between this menu's own items (not a nested submenu's); Home/End jump.
export function roveMenu(event: KeyboardEvent<HTMLDivElement>) {
  if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
  const menu = event.currentTarget;
  const items = [
    ...menu.querySelectorAll<HTMLButtonElement>("[role^='menuitem']:not(:disabled)"),
  ].filter((item) => item.closest("[role='menu']") === menu);
  if (!items.length) return;
  event.preventDefault();
  event.stopPropagation();
  const index = items.indexOf(document.activeElement as HTMLButtonElement);
  const next =
    event.key === "Home"
      ? 0
      : event.key === "End"
        ? items.length - 1
        : (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
  items[next].focus();
}

export function MenuItem({
  icon,
  label,
  description,
  shortcut,
  trailing,
  checked,
  danger = false,
  disabled = false,
  onSelect,
  ...rest
}: {
  icon?: IconName;
  label: string;
  /** One quiet line under the label explaining what the choice does. */
  description?: string;
  shortcut?: string;
  trailing?: ReactNode;
  /** Makes the item a radio choice with a check mark when selected. */
  checked?: boolean;
  danger?: boolean;
  disabled?: boolean;
  onSelect: () => void;
  "aria-haspopup"?: "menu" | "dialog";
  "aria-expanded"?: boolean;
  onKeyDown?: (event: KeyboardEvent<HTMLButtonElement>) => void;
}) {
  return (
    <button
      type="button"
      role={checked === undefined ? "menuitem" : "menuitemradio"}
      aria-checked={checked}
      aria-label={label}
      aria-description={description}
      aria-keyshortcuts={shortcut?.replace("⌘", "Meta+").replace("Ctrl+", "Control+")}
      disabled={disabled}
      className={`${componentClass(styles, "menu-item")} ${description ? componentClass(styles, "described") : ""} ${danger ? componentClass(styles, "danger") : ""}`}
      onClick={onSelect}
      {...rest}
    >
      {icon && <Icon name={icon} size={16} />}
      <span className={componentClass(styles, "menu-label")}>
        {label}
        {description && <small>{description}</small>}
      </span>
      {shortcut && <kbd>{shortcut}</kbd>}
      {trailing}
      {checked && (
        <span className={componentClass(styles, "check")}>
          <Icon name="check" size={15} />
        </span>
      )}
    </button>
  );
}

export function MenuSeparator() {
  return <div className={componentClass(styles, "separator")} role="separator" />;
}

// A row that shows its current value and opens a side menu on hover, click, or →.
// ← or Escape inside the side menu returns to the row.
export function Submenu({
  icon,
  label,
  value,
  role = "menu",
  disabled = false,
  wide = false,
  children,
}: {
  icon?: IconName;
  label: string;
  value?: string;
  role?: "menu" | "dialog";
  disabled?: boolean;
  wide?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const row = () => root.current?.querySelector<HTMLButtonElement>(":scope > button");
  const enter = () =>
    requestAnimationFrame(() =>
      root.current
        ?.querySelector<HTMLElement>(
          ":scope > [data-submenu] input, :scope > [data-submenu] [role^='menuitem']:not(:disabled)",
        )
        ?.focus(),
    );
  return (
    <div
      ref={root}
      className={componentClass(styles, "sub-anchor")}
      onPointerEnter={() => !disabled && setOpen(true)}
      onPointerLeave={() => setOpen(false)}
    >
      <MenuItem
        icon={icon}
        label={label}
        disabled={disabled}
        aria-haspopup={role}
        aria-expanded={open}
        trailing={
          <>
            {value && <span className={componentClass(styles, "menu-value")}>{value}</span>}
            <Icon name="chevron-right" size={14} />
          </>
        }
        onSelect={() => {
          setOpen(true);
          enter();
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowRight") {
            event.preventDefault();
            setOpen(true);
            enter();
          }
        }}
      />
      {open && (
        <div
          data-submenu
          role={role}
          aria-label={label}
          className={`${componentClass(styles, "submenu")} ${wide ? componentClass(styles, "wide") : ""}`}
          onKeyDown={(event) => {
            if (role === "menu") roveMenu(event);
            if (event.key === "ArrowLeft" && !(event.target instanceof HTMLInputElement)) {
              event.preventDefault();
              event.stopPropagation();
              setOpen(false);
              row()?.focus();
            }
          }}
          onClick={(event) => {
            // Choosing an item closes the side menu; typing in a search box does not.
            if ((event.target as HTMLElement).closest("[role^='menuitem']")) setOpen(false);
          }}
        >
          {children}
        </div>
      )}
    </div>
  );
}
