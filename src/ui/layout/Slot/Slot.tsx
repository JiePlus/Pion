import type { ReactNode } from "react";
import { componentClass } from "../../componentClass.ts";
import styles from "./Slot.module.css";
import { SlotResizer } from "./SlotResizer.tsx";

export function Slot({
  kind,
  edge,
  children,
}: {
  kind: "main" | "side" | "bottom" | "toolbar";
  edge?: "left" | "right";
  children: ReactNode;
}) {
  const className = `${componentClass(styles, `slot-${kind}`)} ${edge ?? ""}`;
  if (kind === "main") return <main className={className}>{children}</main>;
  if (kind === "side")
    return (
      <aside className={className}>
        {children}
        <SlotResizer axis="horizontal" edge={edge === "right" ? "left" : "right"} />
      </aside>
    );
  if (kind === "bottom")
    return (
      <div className={className}>
        {children}
        <SlotResizer axis="vertical" />
      </div>
    );
  return <div className={className}>{children}</div>;
}
