import type { ComponentPropsWithRef } from "react";
import styles from "./Switch.module.css";

/**
 * Single, unified on/off switch used across the app.
 *
 * Visual language:
 * - Off: muted surface track, muted thumb.
 * - On:  brand track, contrast thumb.
 * - Hover/focus/disabled are handled consistently for every usage.
 *
 * Accessibility: renders as a native button with role="switch" and
 * aria-checked, so it works with keyboard and screen readers.
 */
export function Switch({
  checked,
  className,
  disabled,
  ...rest
}: Omit<ComponentPropsWithRef<"button">, "onChange" | "aria-checked" | "role"> & {
  checked: boolean;
}) {
  return (
    <button
      {...rest}
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      className={[styles.switch, className].filter(Boolean).join(" ")}
    >
      <span className={styles.thumb} aria-hidden="true" />
    </button>
  );
}
