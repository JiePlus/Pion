import { useRef } from "react";
import styles from "./SlotResizer.module.css";

export function SlotResizer({
  axis,
  edge = "right",
}: {
  axis: "horizontal" | "vertical";
  edge?: "left" | "right";
}) {
  const drag = useRef<{ coordinate: number; size: number } | null>(null);
  return (
    <div
      className={`${styles.handle} ${styles[axis]} ${styles[edge]}`}
      role="separator"
      aria-label="Resize panel"
      aria-orientation={axis === "horizontal" ? "vertical" : "horizontal"}
      tabIndex={0}
      onPointerDown={(event) => {
        const panel = event.currentTarget.parentElement;
        if (!panel) return;
        drag.current = {
          coordinate: axis === "horizontal" ? event.clientX : event.clientY,
          size:
            axis === "horizontal"
              ? panel.getBoundingClientRect().width
              : panel.getBoundingClientRect().height,
        };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        const panel = event.currentTarget.parentElement;
        if (!panel || !drag.current) return;
        const coordinate = axis === "horizontal" ? event.clientX : event.clientY;
        const direction = axis === "horizontal" ? (edge === "right" ? 1 : -1) : -1;
        const size = Math.max(
          axis === "horizontal" ? 190 : 130,
          drag.current.size + (coordinate - drag.current.coordinate) * direction,
        );
        if (axis === "horizontal") panel.style.width = `${size}px`;
        else panel.style.height = `${size}px`;
      }}
      onPointerUp={() => {
        drag.current = null;
      }}
      onPointerCancel={() => {
        drag.current = null;
      }}
      onKeyDown={(event) => {
        const panel = event.currentTarget.parentElement;
        if (!panel) return;
        const step = event.shiftKey ? 32 : 8;
        if (axis === "horizontal" && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
          event.preventDefault();
          const direction = event.key === "ArrowRight" ? 1 : -1;
          panel.style.width = `${Math.max(190, panel.getBoundingClientRect().width + direction * step * (edge === "right" ? 1 : -1))}px`;
        }
        if (axis === "vertical" && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
          event.preventDefault();
          panel.style.height = `${Math.max(130, panel.getBoundingClientRect().height + (event.key === "ArrowUp" ? 1 : -1) * step)}px`;
        }
      }}
    />
  );
}
