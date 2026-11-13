import type { ReactNode } from "react";
import { componentClass } from "../componentClass.ts";
import { Icon } from "../primitives/Icon.tsx";
import type { IconName } from "../primitives/Icon.tsx";
import type { StatTone } from "../primitives/StatTile.tsx";
import styles from "./Management.module.css";

export type CardSpan = 4 | 5 | 6 | 7 | 8 | 12;

// Page opener: bold Chinese title, small English eyebrow, and the one figure that sums up the page.
export function PageHero({
  eyebrow,
  title,
  description,
  stat,
  actions,
}: {
  eyebrow: string;
  title: string;
  description: ReactNode;
  stat?: { value: ReactNode; caption: string; tone: StatTone };
  actions?: ReactNode;
}) {
  return (
    <header className={componentClass(styles, "page-hero")}>
      <div className={componentClass(styles, "hero-copy")}>
        <span className={componentClass(styles, "eyebrow")}>{eyebrow}</span>
        <h1>{title}</h1>
        <p>{description}</p>
        {actions && <div className={componentClass(styles, "hero-actions")}>{actions}</div>}
      </div>
      {stat && (
        <div className={componentClass(styles, "hero-stat")} aria-hidden="true">
          <span
            className={`${componentClass(styles, "hero-number")} ${componentClass(styles, stat.tone)}`}
          >
            {stat.value}
          </span>
          <span className={componentClass(styles, "eyebrow")}>{stat.caption}</span>
        </div>
      )}
    </header>
  );
}

export function Card({
  title,
  eyebrow,
  icon,
  span = 12,
  actions,
  headingId,
  children,
}: {
  title?: string;
  eyebrow?: string;
  icon?: IconName;
  span?: CardSpan;
  actions?: ReactNode;
  headingId?: string;
  children: ReactNode;
}) {
  return (
    <section
      className={`${componentClass(styles, "card")} ${componentClass(styles, `span-${span}`)}`}
      aria-labelledby={title ? headingId : undefined}
    >
      {(title || eyebrow || actions) && (
        <div className={componentClass(styles, "card-head")}>
          <div className={componentClass(styles, "card-title")}>
            {icon && (
              <span className={componentClass(styles, "card-icon")} aria-hidden="true">
                <Icon name={icon} size={16} />
              </span>
            )}
            {title && <h2 id={headingId}>{title}</h2>}
            {eyebrow && <span className={componentClass(styles, "eyebrow")}>{eyebrow}</span>}
          </div>
          {actions}
        </div>
      )}
      <div className={componentClass(styles, "card-body")}>{children}</div>
    </section>
  );
}

export function EmptyState({ icon, children }: { icon: IconName; children: ReactNode }) {
  return (
    <div className={componentClass(styles, "empty-state")}>
      <span aria-hidden="true">
        <Icon name={icon} size={22} />
      </span>
      <p className="muted">{children}</p>
    </div>
  );
}
