import { componentClass } from "../componentClass.ts";
import styles from "./BrandMark.module.css";

// The in-app mark: the same π and ion dot as the app icon, drawn in the UI's own ink and
// glass so it follows the theme instead of sitting on the page like a pasted image.
export function BrandMark({ size = 28 }: { size?: number }) {
  return (
    <span
      className={componentClass(styles, "brand-mark")}
      style={{ width: size, height: size, borderRadius: size * 0.3 }}
      aria-hidden="true"
    >
      <svg viewBox="0 0 256 256" width={size * 0.92} height={size * 0.92}>
        <g
          transform="translate(-4 -6)"
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="24"
        >
          <path d="M68 100c10-12 22-15 38-15h76" />
          <path d="M110 90c-1 42-9 73-27 96" />
          <path d="M156 90l-3 66c-1 20 8 30 26 25" />
        </g>
        <circle className={componentClass(styles, "ion")} cx="198" cy="62" r="13" />
      </svg>
    </span>
  );
}
