import type { Message } from "../ui/chat/ChatMessage.tsx";

export interface SessionTreeNode {
  entry: {
    id: string;
    parentId?: string | null;
    type: string;
    message?: Message;
  };
  children: SessionTreeNode[];
  label?: string;
}

export interface SessionTreeItem {
  id: string;
  depth: number;
  label: string;
  active: boolean;
}

export interface SessionHistoryEntry {
  id: string;
  parentId: string | null;
  type: string;
  label: string;
}

export function flatHistoryItems(
  entries: SessionHistoryEntry[],
  leafId: string | null,
): SessionTreeItem[] {
  const depths = new Map<string, number>();
  return entries.map((entry) => {
    const depth = entry.parentId ? (depths.get(entry.parentId) ?? -1) + 1 : 0;
    depths.set(entry.id, depth);
    return { id: entry.id, depth, label: entry.label, active: entry.id === leafId };
  });
}

export function sessionTreeItems(
  tree: SessionTreeNode[],
  leafId: string | null,
): SessionTreeItem[] {
  const items: SessionTreeItem[] = [];
  function visit(node: SessionTreeNode, depth: number) {
    const message = node.entry.message;
    const content = message
      ? typeof message.content === "string"
        ? message.content
        : (message.content ?? [])
            .filter((part) => part.type === "text")
            .map((part) => part.text ?? "")
            .join(" ")
      : "";
    items.push({
      id: node.entry.id,
      depth,
      label: node.label || content.trim().replace(/\s+/g, " ").slice(0, 100) || node.entry.type,
      active: node.entry.id === leafId,
    });
    node.children.forEach((child) => visit(child, depth + 1));
  }
  tree.forEach((node) => visit(node, 0));
  return items;
}
