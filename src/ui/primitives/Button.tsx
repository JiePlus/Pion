import type { ComponentPropsWithRef, ReactNode } from "react";
import styles from "./Button.module.css";

type Variant = "primary" | "ghost" | "outline" | "toolbar" | "icon" | "rail";
type Size = "sm" | "md";

export function Button({
  variant = "ghost",
  size = "md",
  icon,
  className,
  children,
  ...rest
}: ComponentPropsWithRef<"button"> & {
  variant?: Variant;
  size?: Size;
  icon?: ReactNode;
}) {
  return (
    <button
      className={[styles.button, styles[variant], styles[size], className]
        .filter(Boolean)
        .join(" ")}
      {...rest}
    >
      {icon && <span className={styles.iconContent}>{icon}</span>}
      {children}
    </button>
  );
}
