import { componentClass } from "../componentClass.ts";
import { t } from "../../core/i18n.ts";
import type { ContentBlock } from "./ChatMessage.tsx";
import styles from "./ChatMessage.module.css";

export function MessageImage({ block }: { block: ContentBlock }) {
  if (!block.data || !/^image\/(png|jpeg|gif|webp)$/.test(block.mimeType ?? "")) return null;
  return (
    <img
      className={componentClass(styles, "message-image")}
      src={`data:${block.mimeType};base64,${block.data}`}
      alt={t("Image")}
      loading="lazy"
    />
  );
}
