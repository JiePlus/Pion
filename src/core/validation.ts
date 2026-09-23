import { locations, permissions } from "./api.ts";
import type { Manifest, View } from "./api.ts";

export const DESKTOP_VERSION = "0.1.0";
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Expected object");
  return value as Record<string, unknown>;
}
export function text(value: unknown, max = 200): string {
  if (typeof value !== "string" || !value.length || value.length > max)
    throw new Error("Invalid text length");
  return value;
}
function validateTranslations(value: unknown): void {
  if (value === undefined) return;
  for (const [locale, label] of Object.entries(object(value))) {
    if (locale !== "en" && locale !== "zh-CN") throw new Error("Unsupported translation locale");
    text(label, 100);
  }
}
export function parseManifest(value: unknown): Manifest {
  const m = object(value);
  const id = text(m.id, 64);
  if (id === "core" || !/^[a-z][a-z0-9-]*$/.test(id)) throw new Error("Invalid plugin id");
  text(m.name, 100);
  validateTranslations(m.nameI18n);
  const semver = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
  if (!semver.test(text(m.version)) || !semver.test(text(m.minDesktopVersion)))
    throw new Error("Use numeric major.minor.patch");
  const required = (m.minDesktopVersion as string).split(".").map(Number);
  const current = DESKTOP_VERSION.split(".").map(Number);
  const differing = required.findIndex((part, index) => part !== current[index]);
  if (m.apiVersion !== "1" || (differing >= 0 && required[differing] > current[differing]))
    throw new Error("Incompatible Desktop API/version");
  const main = text(m.main, 240);
  if (
    !/^[a-zA-Z0-9_./-]+\.js$/.test(main) ||
    main.startsWith("/") ||
    main.split("/").some((p) => p === ".." || p === "." || !p)
  )
    throw new Error("Unsafe entrypoint");
  if (
    !Array.isArray(m.permissions) ||
    m.permissions.length > permissions.length ||
    m.permissions.some((p) => !permissions.includes(p)) ||
    new Set(m.permissions).size !== m.permissions.length
  )
    throw new Error("Unknown/duplicate permission");
  const contributions = object(m.contributes);
  const seen = new Set<string>();
  for (const kind of ["commands", "panels"] as const) {
    const items = contributions[kind];
    if (!Array.isArray(items) || items.length > 32) throw new Error("Invalid contributions");
    for (const item of items) {
      const c = object(item);
      const name = text(c.id, 120);
      if (!name.startsWith(`${id}.`) || !/^[a-z][a-z0-9.-]+$/.test(name) || seen.has(name))
        throw new Error("Duplicate or unowned contribution");
      seen.add(name);
      text(c.title, 100);
      validateTranslations(c.titleI18n);
      if (kind === "panels" && !locations.includes(c.location as never))
        throw new Error("Unknown UI location");
    }
  }
  return m as unknown as Manifest;
}
export function validateView(value: unknown, manifest: Manifest): View {
  if (JSON.stringify(value).length > 256_000) throw new Error("View exceeds 256 KB");
  let count = 0;
  function visit(input: unknown, depth: number): void {
    if (++count > 256 || depth > 12) throw new Error("View too complex");
    const node = object(input);
    switch (node.type) {
      case "stack":
        if (!Array.isArray(node.children)) throw new Error("Invalid children");
        node.children.forEach((child) => visit(child, depth + 1));
        break;
      case "text":
      case "badge":
        if (typeof node.text !== "string" || node.text.length > 100_000)
          throw new Error("Invalid view text");
        if (node.tone !== undefined && !["muted", "error", "heading"].includes(node.tone as string))
          throw new Error("Invalid tone");
        break;
      case "list":
        if (!Array.isArray(node.items) || node.items.length > 200)
          throw new Error("List too large");
        node.items.forEach((item) => {
          const row = object(item);
          text(row.label, 100);
          if (typeof row.text !== "string" || row.text.length > 100_000)
            throw new Error("Invalid row");
        });
        break;
      case "button":
      case "form":
        if (!manifest.contributes.commands.some((c) => c.id === node.command))
          throw new Error("UI command must be owned and declared");
        if (node.disabled !== undefined && typeof node.disabled !== "boolean")
          throw new Error("Invalid disabled");
        if (node.type === "button") text(node.label, 100);
        else {
          text(node.placeholder, 300);
          text(node.submit, 100);
        }
        break;
      default:
        throw new Error("Unknown UI node");
    }
  }
  visit(value, 0);
  return value as View;
}
