import type { ReactNode } from "react";

export type IconName =
  | "plus"
  | "cube"
  | "grid"
  | "bolt"
  | "search"
  | "settings"
  | "chevron-left"
  | "chevron-right"
  | "chevron-down"
  | "folder"
  | "arrow-up"
  | "sparkles"
  | "sliders"
  | "keyboard"
  | "puzzle"
  | "terminal"
  | "moon"
  | "sun"
  | "monitor"
  | "download"
  | "palette";

export function Icon({
  name,
  size = 18,
  className,
}: {
  name: IconName;
  size?: number;
  className?: string;
}) {
  const paths = {
    plus: <path d="M12 5v14M5 12h14" />,
    cube: (
      <>
        <path d="m12 2 9 5-9 5-9-5 9-5Z" />
        <path d="M3 7v10l9 5 9-5V7M12 12v10" />
      </>
    ),
    grid: (
      <>
        <rect x="3" y="3" width="7" height="7" rx="1.5" />
        <rect x="14" y="3" width="7" height="7" rx="1.5" />
        <rect x="3" y="14" width="7" height="7" rx="1.5" />
        <rect x="14" y="14" width="7" height="7" rx="1.5" />
      </>
    ),
    bolt: <path d="m13 2-9 11h7l-1 9 10-12h-7l1-8Z" />,
    search: (
      <>
        <circle cx="10.8" cy="10.8" r="6.8" />
        <path d="m16 16 5 5" />
      </>
    ),
    settings: (
      <>
        <path
          d="M10 2h4l.6 2.2 1.7.7 2-.9 2.8 2.8-.9 2 .7 1.7L23 11v4l-2.2.6-.7 1.7.9 2-2.8 2.8-2-.9-1.7.7L14 24h-4l-.6-2.1-1.7-.7-2 .9-2.8-2.8.9-2-.7-1.7L1 15v-4l2.2-.6.7-1.7-.9-2L5.8 4l2 .9 1.7-.7L10 2Z"
          transform="translate(0 -1) scale(.96)"
        />
        <circle cx="12" cy="12" r="3" />
      </>
    ),
    "chevron-left": <path d="m15 18-6-6 6-6" />,
    "chevron-right": <path d="m9 18 6-6-6-6" />,
    "chevron-down": <path d="m6 9 6 6 6-6" />,
    folder: <path d="M3 6h7l2 2h9v11H3V6Z" />,
    "arrow-up": (
      <>
        <path d="M12 20V4m-7 7 7-7 7 7" />
      </>
    ),
    sparkles: (
      <>
        <path d="m12 2 1.8 6.2L20 10l-6.2 1.8L12 18l-1.8-6.2L4 10l6.2-1.8L12 2ZM19 17l.6 1.4L21 19l-1.4.6L19 21l-.6-1.4L17 19l1.4-.6L19 17Z" />
      </>
    ),
    sliders: (
      <>
        <path d="M5 3v18M12 3v18M19 3v18" />
        <circle cx="5" cy="9" r="2" fill="var(--pion-color-surface)" />
        <circle cx="12" cy="16" r="2" fill="var(--pion-color-surface)" />
        <circle cx="19" cy="7" r="2" fill="var(--pion-color-surface)" />
      </>
    ),
    keyboard: (
      <>
        <rect x="2" y="5" width="20" height="14" rx="2" />
        <path
          d="M6 9h.01M10 9h.01M14 9h.01M18 9h.01M6 13h.01M10 13h.01M14 13h.01M18 13h.01M7 16h10"
          strokeLinecap="round"
          strokeWidth="2.5"
        />
      </>
    ),
    puzzle: (
      <path d="M9 3H3v6h2a2 2 0 1 1 0 4H3v8h7v-2a2 2 0 1 1 4 0v2h7v-7h-2a2 2 0 1 1 0-4h2V3h-8v2a2 2 0 1 1-4 0V3Z" />
    ),
    terminal: (
      <>
        <rect x="2" y="3" width="20" height="18" rx="2" />
        <path d="m6 9 3 3-3 3m6 0h6" />
      </>
    ),
    moon: <path d="M20.5 14.5A8.5 8.5 0 0 1 9.5 3.5a8.5 8.5 0 1 0 11 11Z" />,
    sun: (
      <>
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
      </>
    ),
    monitor: (
      <>
        <rect x="2" y="3" width="20" height="15" rx="2" />
        <path d="M8 22h8m-4-4v4" />
      </>
    ),
    download: (
      <>
        <path d="M12 3v12m-5-5 5 5 5-5" />
        <path d="M4 19h16" />
      </>
    ),
    palette: (
      <>
        <path d="M12 2a10 10 0 1 0 0 20h1.5a2 2 0 0 0 1.5-3.3 1.9 1.9 0 0 1 1.5-3.2H18A4 4 0 0 0 22 11 10 10 0 0 0 12 2Z" />
        <circle cx="7" cy="11" r=".7" fill="currentColor" />
        <circle cx="10" cy="6.8" r=".7" fill="currentColor" />
        <circle cx="16" cy="7.5" r=".7" fill="currentColor" />
      </>
    ),
  } satisfies Record<IconName, ReactNode>;

  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {paths[name]}
    </svg>
  );
}
