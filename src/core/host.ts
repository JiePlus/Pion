import { Channel, invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { Bundle, Json } from "./api.ts";
import { createHostQueue } from "./host-queue.ts";
import { Events } from "./registry.ts";

export interface Installed {
  bundle: Bundle;
  digest: string;
  enabled: boolean;
  /** Linked development folder; Pion reloads the plugin when its files change. */
  dev?: string;
}
export interface Project {
  id: string;
  name: string;
  path: string;
}
export interface Task {
  id: string;
  projectId: string;
  title: string;
  unread: boolean;
}
export interface Catalog {
  projects: Project[];
  tasks: Task[];
}
export interface Boot {
  plugins: Installed[];
  catalog: Catalog;
  settings: { executable: string; workspace: string };
  /** Built-in feature switches; missing ids are enabled. */
  builtins?: Record<string, boolean>;
}
export interface PiSetupStatus {
  installation: "missing" | "broken" | "ready";
  executable?: string;
  installedVersion?: string;
  latestVersion?: string;
  npmManaged?: boolean;
  canInstall: boolean;
  canUpdate?: boolean;
  detail?: string;
  models?: { provider: string; id: string; name?: string }[];
  selectedModel?: { provider: string; id: string } | null;
  modelReady?: boolean;
}
export const native = isTauri();
export const hostEvents = new Events();
let generation = 0;
let activeTask: string | null = null;

const queue = createHostQueue((request) =>
  native ? invoke("desktop", { request }) : preview(request),
);

// One request in flight per lane (Core, or one plugin). The guard rechecks plugin
// lifetime when the request is admitted, just before Rust is invoked.
export function host<T = Json>(
  request: Record<string, unknown>,
  guard: () => void = () => {},
): Promise<T> {
  return queue.enqueue<T>(request, guard);
}

// Extension dialogs can block the command that caused them, so their response must bypass
// the ordinary serialized host queue. Rust exposes only this correlated response operation.
export function respondExtensionUi(request: Record<string, unknown>): Promise<void> {
  if (!native) return Promise.reject(new Error("Extension UI requires the desktop app"));
  return invoke("desktop", {
    request: { op: "extension_ui.response", generation, ...request },
  });
}
export async function connectEvents(): Promise<() => void> {
  if (!native) return () => {};
  type PiEventPayload = { generation: number; taskId?: string | null; event: unknown };
  const deliver = (payload: PiEventPayload) => {
    if (payload.generation === generation && (payload.taskId ?? null) === activeTask)
      hostEvents.emit("pi:event", payload.event);
  };
  // Pi events arrive on this window's own channel; the broadcast listener below only
  // serves a host that has no channel registered.
  const channel = new Channel<PiEventPayload>();
  channel.onmessage = deliver;
  await invoke("pi_events", { channel });
  const pi = await listen<PiEventPayload>("pi:event", (event) => deliver(event.payload));
  const status = await listen<{
    generation: number;
    taskId?: string | null;
    active?: boolean;
  }>("pi:status", (event) => {
    if (event.payload.active) {
      generation = event.payload.generation;
      activeTask = event.payload.taskId ?? null;
      hostEvents.emit("pi:status", event.payload);
    } else if (
      event.payload.generation === generation &&
      (event.payload.taskId ?? null) === activeTask
    ) {
      hostEvents.emit("pi:status", event.payload);
    }
  });
  const taskStatus = await listen("task:status", (event) =>
    hostEvents.emit("task:status", event.payload),
  );
  const workspace = await listen("workspace:opened", (event) =>
    hostEvents.emit("workspace:opened", event.payload),
  );
  return () => {
    pi();
    status();
    taskStatus();
    workspace();
  };
}
function saved(): Installed[] {
  return JSON.parse(localStorage.getItem("pion.preview.plugins") ?? "[]");
}
async function preview(request: Record<string, unknown>): Promise<unknown> {
  // Preview deliberately has no simulated Pi responses or native filesystem access.
  const installed = saved();
  switch (request.op) {
    case "boot":
      return {
        plugins: installed,
        catalog: { projects: [], tasks: [] },
        settings: { executable: "pi", workspace: "" },
        builtins: {},
      };
    case "review": {
      throw new Error("Local installation requires the desktop app");
    }
    case "enable":
    case "remove": {
      const record = installed.find((r) => r.bundle.manifest.id === request.id);
      if (!record) throw new Error("Unknown plugin");
      record.enabled = request.enabled === true;
      localStorage.setItem(
        "pion.preview.plugins",
        JSON.stringify(request.op === "remove" ? installed.filter((r) => r !== record) : installed),
      );
      return null;
    }
    case "plugin": {
      const record = installed.find((r) => r.bundle.manifest.id === request.id && r.enabled);
      if (!record) throw new Error("Plugin disabled");
      const args = request.args as Record<string, Json>;
      if (request.method === "storage.get" || request.method === "storage.set") {
        if (!record.bundle.manifest.permissions.includes("storage"))
          throw new Error("Permission denied: storage");
        const key = `pion.preview.storage.${request.id}.${args.key}`;
        if (request.method === "storage.get")
          return JSON.parse(localStorage.getItem(key) ?? "null");
        localStorage.setItem(key, JSON.stringify(args.value));
        return null;
      }
      throw new Error("Pi / workspace access requires the desktop app");
    }
    default:
      throw new Error("Start the desktop app with npm run desktop to connect Pi");
  }
}
