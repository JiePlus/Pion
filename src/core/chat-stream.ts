import type { ContentBlock, Message } from "../ui/chat/ChatMessage.tsx";

interface Delta {
  type?: string;
  contentIndex?: number;
  delta?: string;
  id?: string;
  toolName?: string;
  content?: string;
  thinking?: string;
  toolCall?: ContentBlock;
}

export function applyAssistantDelta(message: Message | null, delta: Delta): Message {
  const content = Array.isArray(message?.content) ? [...message.content] : [];
  const index = delta.contentIndex ?? content.length;
  if (delta.type === "text_start") content[index] = { type: "text", text: "" };
  if (delta.type === "text_delta") {
    const current = content[index]?.type === "text" ? content[index] : { type: "text", text: "" };
    content[index] = { ...current, text: `${current.text ?? ""}${delta.delta ?? ""}` };
  }
  if (delta.type === "text_end") content[index] = { type: "text", text: delta.content ?? "" };
  if (delta.type === "thinking_start") content[index] = { type: "thinking", thinking: "" };
  if (delta.type === "thinking_delta") {
    const current =
      content[index]?.type === "thinking" ? content[index] : { type: "thinking", thinking: "" };
    content[index] = { ...current, thinking: `${current.thinking ?? ""}${delta.delta ?? ""}` };
  }
  if (delta.type === "thinking_end")
    content[index] = { type: "thinking", thinking: delta.thinking ?? delta.content ?? "" };
  if (delta.type === "toolcall_start")
    content[index] = { type: "toolCall", id: delta.id, name: delta.toolName, arguments: {} };
  if (delta.type === "toolcall_end" && delta.toolCall) content[index] = delta.toolCall;
  return { role: "assistant", ...message, content };
}
