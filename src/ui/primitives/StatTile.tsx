import type { ReactNode } from "react";
import { componentClass } from "../componentClass.ts";
import styles from "./StatTile.module.css";

export type StatTone = "blue" | "green" | "orange" | "purple";

// Bento tile for a figure that is the point of its section: label, oversized value, caption.
export function StatTile({
  label,
  value,
  caption,
  tone = "blue",
  icon,
}: {
  label: string;
  value: ReactNode;
  caption?: ReactNode;
  tone?: StatTone;
  icon?: ReactNode;
}) {
  return (
    <section className={componentClass(styles, "stat-tile")} aria-label={label}>
      <span className={componentClass(styles, "stat-label")}>
        {icon}
        {label}
      </span>
      <span className={`${componentClass(styles, "stat-value")} ${componentClass(styles, tone)}`}>
        {value}
      </span>
      <span className={`${componentClass(styles, "stat-rule")} ${componentClass(styles, tone)}`} />
      {caption && <span className={componentClass(styles, "stat-caption")}>{caption}</span>}
    </section>
  );
}

export function StatGrid({ children }: { children: ReactNode }) {
  return <div className={componentClass(styles, "stat-grid")}>{children}</div>;
}
