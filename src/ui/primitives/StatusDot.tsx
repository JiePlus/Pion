import styles from "./StatusDot.module.css";

export function StatusDot({ offline = false }: { offline?: boolean }) {
  return <span className={`dot ${styles.dot} ${offline ? `offline ${styles.offline}` : ""}`} />;
}
