import { useLayoutEffect, useRef, useState } from "react";
import { componentClass } from "../componentClass.ts";
import styles from "./Segmented.module.css";

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  title?: string;
}

// Two to four mutually exclusive choices with a sliding glass thumb; arrow keys move the choice.
export function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
  disabled = false,
  size = "md",
}: {
  label: string;
  options: SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  disabled?: boolean;
  size?: "sm" | "md";
}) {
  const group = useRef<HTMLDivElement>(null);
  const [thumb, setThumb] = useState<{ left: number; width: number } | null>(null);

  useLayoutEffect(() => {
    const node = group.current;
    if (!node) return;
    const place = () => {
      const active = node.querySelector<HTMLButtonElement>('[aria-checked="true"]');
      setThumb(active ? { left: active.offsetLeft, width: active.offsetWidth } : null);
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(node);
    return () => observer.disconnect();
  }, [value, options.length]);

  function move(step: number) {
    const index = options.findIndex((option) => option.value === value);
    const next = options[(index + step + options.length) % options.length];
    onChange(next.value);
    requestAnimationFrame(() =>
      group.current?.querySelector<HTMLButtonElement>(`[data-value="${next.value}"]`)?.focus(),
    );
  }

  return (
    <div
      ref={group}
      role="radiogroup"
      aria-label={label}
      aria-disabled={disabled || undefined}
      className={`${componentClass(styles, "segmented")} ${componentClass(styles, size)}`}
    >
      {thumb && (
        <span
          className={componentClass(styles, "thumb")}
          aria-hidden="true"
          style={{ width: thumb.width, transform: `translateX(${thumb.left}px)` }}
        />
      )}
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          data-value={option.value}
          aria-checked={option.value === value}
          tabIndex={option.value === value ? 0 : -1}
          title={option.title}
          disabled={disabled}
          onClick={() => option.value !== value && onChange(option.value)}
          onKeyDown={(event) => {
            if (event.key === "ArrowRight" || event.key === "ArrowDown") {
              event.preventDefault();
              move(1);
            } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
              event.preventDefault();
              move(-1);
            }
          }}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
