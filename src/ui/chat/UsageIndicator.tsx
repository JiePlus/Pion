import type { ReactNode, RefObject } from "react";
import { componentClass } from "../componentClass.ts";
import { t } from "../../core/i18n.ts";
import type { SessionStats } from "../layout/Topbar/Topbar.tsx";
import styles from "./UsageIndicator.module.css";

const RING = 2 * Math.PI * 8;

export interface UsageProps {
  area: RefObject<HTMLDivElement | null>;
  button: RefObject<HTMLButtonElement | null>;
  open: boolean;
  stats: SessionStats | null;
  loading: boolean;
  error: string;
  onToggle: () => void;
}

// Context ring beside the send button. Its popover is the one home for usage and compaction.
export function UsageIndicator({
  area,
  button,
  open,
  stats,
  loading,
  error,
  onToggle,
  children,
}: UsageProps & { children?: ReactNode }) {
  const percent = stats?.contextUsage?.percent;
  const label =
    percent === undefined ? t("Usage") : t("Context {percent}%", { percent: percent.toFixed(2) });
  const filled = percent === undefined ? 0 : (Math.min(percent, 100) / 100) * RING;
  return (
    <div className={componentClass(styles, "usage-indicator")} ref={area}>
      <button
        ref={button}
        type="button"
        className={componentClass(styles, "usage-ring")}
        aria-label={label}
        title={label}
        aria-expanded={open}
        onClick={onToggle}
      >
        <svg viewBox="0 0 20 20" aria-hidden="true">
          <circle cx="10" cy="10" r="8" className={componentClass(styles, "ring-track")} />
          <circle
            cx="10"
            cy="10"
            r="8"
            className={componentClass(styles, "ring-fill")}
            strokeDasharray={`${filled} ${RING}`}
          />
        </svg>
      </button>
      {open && (
        <section className={componentClass(styles, "usage-popover")} aria-label={t("Usage")}>
          <div className={componentClass(styles, "usage-section")}>
            <div className={componentClass(styles, "usage-hero")}>
              <span className={componentClass(styles, "usage-number")}>
                {percent === undefined ? "—" : percent.toFixed(percent < 10 ? 1 : 0)}
                <small>%</small>
              </span>
              <span className={componentClass(styles, "usage-caption")}>{t("Context window")}</span>
            </div>
            <div className={componentClass(styles, "usage-bar")} aria-hidden="true">
              <i style={{ width: `${Math.min(percent ?? 0, 100)}%` }} />
            </div>
            {loading && <p className="muted">{t("Loading…")}</p>}
            {!!error && <p className="error">{error}</p>}
            {stats && (
              <dl>
                <div>
                  <dt>{t("Context")}</dt>
                  <dd>
                    {stats.contextUsage?.tokens?.toLocaleString() ?? "—"} /{" "}
                    {stats.contextUsage?.contextWindow?.toLocaleString() ?? "—"}
                  </dd>
                </div>
                {stats.tokens?.input !== undefined && (
                  <div>
                    <dt>{t("Input")}</dt>
                    <dd>{stats.tokens.input.toLocaleString()}</dd>
                  </div>
                )}
                {stats.tokens?.output !== undefined && (
                  <div>
                    <dt>{t("Output")}</dt>
                    <dd>{stats.tokens.output.toLocaleString()}</dd>
                  </div>
                )}
                <div>
                  <dt>{t("Cost")}</dt>
                  <dd>{stats.cost === undefined ? "—" : `$${stats.cost.toFixed(4)}`}</dd>
                </div>
              </dl>
            )}
          </div>
          {children}
        </section>
      )}
    </div>
  );
}
