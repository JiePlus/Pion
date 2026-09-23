import type { ReactNode } from "react";
import { componentClass } from "../componentClass.ts";
import styles from "./Dialog.module.css";

export function Dialog({
  titleId,
  onClose,
  className,
  children,
}: {
  titleId: string;
  onClose: () => void;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={componentClass(styles, "modal-backdrop")} onClick={onClose}>
      <section
        className={`${componentClass(styles, "modal")} ${className ?? ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(event) => event.stopPropagation()}
      >
        {children}
      </section>
    </div>
  );
}
