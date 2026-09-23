import type { Message } from "./ChatMessage.tsx";

export function messageText(message: Message): string {
  if (typeof message.content === "string") return message.content;
  return (message.content ?? [])
    .filter((part) => part.type === "text")
    .map((part) => part.text ?? "")
    .join("\n");
}
