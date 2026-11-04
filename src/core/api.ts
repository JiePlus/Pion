/** The complete public v1 boundary. No React, DOM or Tauri types. */
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type Dispose = () => void;
export type Locale = "en" | "zh-CN";
export type LocalizedText = Partial<Record<Locale, string>>;
export const locations = [
  "sidebar",
  "secondarySidebar",
  "mainPanel",
  "bottomPanel",
  "toolbar",
  "statusBar",
  "commandPalette",
  "contextMenu",
  "settings",
] as const;
export type Location = (typeof locations)[number];
export const permissions = [
  "workspace.read",
  "workspace.write",
  "pi.read",
  "pi.sendMessage",
  "storage",
  "notifications",
  "network.fetch",
] as const;
export type Permission = (typeof permissions)[number];
export interface Command {
  id: string;
  title: string;
  titleI18n?: LocalizedText;
}
export interface Panel {
  id: string;
  title: string;
  titleI18n?: LocalizedText;
  location: Location;
}
// Optional allowlists that scope the matching permission. When a permission is
// requested, its allowlist must be declared; an empty or missing allowlist denies all.
export interface ManifestAccess {
  /** Relative workspace path patterns a plugin may write, e.g. "notes/**" or "out/*.md". */
  workspaceWrite?: string[];
  /** Hostnames a plugin may fetch, e.g. "api.example.com" or "*.example.com". */
  network?: string[];
}
export interface Manifest {
  id: string;
  name: string;
  nameI18n?: LocalizedText;
  version: string;
  apiVersion: "1";
  minDesktopVersion: string;
  main: string;
  permissions: Permission[];
  access?: ManifestAccess;
  contributes: { commands: Command[]; panels: Panel[] };
}
export interface Bundle {
  manifest: Manifest;
  source: string;
}
export interface Workspace {
  id: string;
  path: string;
  name: string;
}
export interface PiEvent {
  type: string;
  [key: string]: unknown;
}
export interface CoreEvents {
  "app:localeChanged": { locale: Locale };
  "app:ready": { version: string };
  "workspace:opened": Workspace;
  "pi:event": PiEvent;
  "pi:status": { state: "connected" | "disconnected"; detail: string };
  "plugin:loaded": { id: string };
  "plugin:unloaded": { id: string };
}
export type EventName = keyof CoreEvents | `custom:${string}:${string}`;
export interface ViewTableColumn {
  key: string;
  label: string;
}
export type View =
  | { type: "stack"; children: View[] }
  | { type: "text"; text: string; tone?: "muted" | "error" | "heading" }
  | { type: "badge"; text: string }
  | { type: "list"; items: { label: string; text: string }[] }
  | {
      type: "table";
      columns: ViewTableColumn[];
      rows: Record<string, string>[];
      caption?: string;
    }
  | { type: "code"; text: string; language?: string }
  | { type: "diff"; text: string }
  | {
      type: "input";
      command: string;
      label?: string;
      placeholder: string;
      submit: string;
      disabled?: boolean;
    }
  | { type: "image"; src: string; alt?: string }
  | { type: "button"; label: string; command: string; args?: Json; disabled?: boolean }
  | { type: "form"; command: string; placeholder: string; submit: string; disabled?: boolean };

export interface NetworkRequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD";
  headers?: Record<string, string>;
  body?: string;
}
export interface NetworkResponse {
  status: number;
  ok: boolean;
  headers: Record<string, string>;
  body: string;
}
export interface PiDesktopPluginContext {
  i18n: { readonly locale: Locale; onDidChange(listener: (locale: Locale) => void): Dispose };
  commands: {
    register(id: string, handler: (args?: Json) => Json | void | Promise<Json | void>): Dispose;
    execute(id: string, args?: Json): Promise<Json>;
  };
  events: {
    on<K extends keyof CoreEvents>(name: K, listener: (payload: CoreEvents[K]) => void): Dispose;
    on(name: `custom:${string}:${string}`, listener: (payload: Json) => void): Dispose;
    emit(name: `custom:${string}:${string}`, payload: Json): void;
  };
  ui: {
    registerPanel(id: string, view: View): Dispose;
    updatePanel(id: string, view: View): void;
  };
  workspace: {
    get(): Promise<Workspace>;
    readFile(path: string): Promise<string>;
    writeFile(path: string, content: string): Promise<void>;
  };
  network: {
    fetch(url: string, options?: NetworkRequestOptions): Promise<NetworkResponse>;
  };
  pi: {
    prompt(message: string): Promise<void>;
    abort(): Promise<void>;
    getState(): Promise<Json>;
    getMessages(): Promise<{ messages: Json[] }>;
    getModels(): Promise<Json>;
    setModel(provider: string, modelId: string): Promise<Json>;
    getCommands(): Promise<Json>;
    onEvent(listener: (event: PiEvent) => void): Dispose;
  };
  storage: { get(key: string): Promise<Json>; set(key: string, value: Json): Promise<void> };
  notifications: { show(message: string): Promise<void> };
}
