import { componentClass } from "../componentClass.ts";
import styles from "./Switch.module.css";

// For settings that apply immediately; anything needing confirmation stays a button.
export function Switch({
  label,
  checked,
  onChange,
  disabled = false,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-label={label}
      aria-checked={checked}
      disabled={disabled}
      className={componentClass(styles, "switch")}
      onClick={() => onChange(!checked)}
    />
  );
}
