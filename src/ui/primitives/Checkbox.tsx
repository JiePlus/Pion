import type { ComponentPropsWithRef } from "react";
import styles from "./Checkbox.module.css";

export function Checkbox(props: Omit<ComponentPropsWithRef<"input">, "type">) {
  return (
    <input
      {...props}
      type="checkbox"
      className={[styles.checkbox, props.className].filter(Boolean).join(" ")}
    />
  );
}
