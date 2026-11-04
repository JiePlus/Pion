import type { Bundle, Json, Manifest, Panel, Permission, View } from "./api.ts";
import { i18n } from "./i18n.ts";
import { host, hostEvents } from "./host.ts";
import { Commands, Events } from "./registry.ts";
import { sandbox } from "./sandbox.ts";
import { object, parseManifest, text, validateView } from "./validation.ts";

export interface PanelView extends Panel {
  owner: string;
  view: View;
}
export interface PluginState {
  manifest: Manifest;
  state: "loading" | "active" | "disabled" | "crashed";
  error?: string;
}
interface Instance {
  bundle: Bundle;
  live: boolean;
  port: ReturnType<typeof sandbox>;
  subscriptions: Map<string, () => void>;
  pending: Map<
    number,
    {
      resolve: (value: Json) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >;
  timer: ReturnType<typeof setTimeout>;
  heartbeat: ReturnType<typeof setInterval>;
  lastPong: number;
  count: number;
  apiBusy: boolean;
  ready: () => void;
  failed: (error: Error) => void;
}
const methods: Record<string, Permission> = {
  "pi.prompt": "pi.sendMessage",
  "pi.abort": "pi.sendMessage",
  "pi.setModel": "pi.sendMessage",
  "pi.getState": "pi.read",
  "pi.getMessages": "pi.read",
  "pi.getModels": "pi.read",
  "pi.getCommands": "pi.read",
  "workspace.get": "workspace.read",
  "workspace.readFile": "workspace.read",
  "workspace.writeFile": "workspace.write",
  "network.fetch": "network.fetch",
  "storage.get": "storage",
  "storage.set": "storage",
  "notifications.show": "notifications",
};

export class Runtime {
  readonly commands = new Commands();
  readonly events = new Events();
  readonly panels = new Map<string, PanelView>();
  readonly plugins = new Map<string, PluginState>();
  readonly notices: { id: number; owner: string; message: string }[] = [];
  private instances = new Map<string, Instance>();
  private changes = new Set<() => void>();
  private revision = 0;
  private sequence = 0;
  private lifecycle: Promise<unknown> = Promise.resolve();
  private tickets = new Map<string, number>();

  constructor() {
    i18n.subscribe(() => {
      this.instances.forEach((instance) =>
        instance.port.send({
          kind: "event",
          name: "app:localeChanged",
          payload: { locale: i18n.getLocale() },
        }),
      );
      this.changed();
    });
    hostEvents.on("pi:event", (event) => this.events.emit("pi:event", event));
    hostEvents.on("pi:status", (event) => this.events.emit("pi:status", event));
    hostEvents.on("workspace:opened", (event) => this.events.emit("workspace:opened", event));
  }
  subscribe = (listener: () => void) => {
    this.changes.add(listener);
    return () => {
      this.changes.delete(listener);
    };
  };
  snapshot = () => this.revision;
  changed() {
    this.revision++;
    this.changes.forEach((listener) => listener());
  }
  notice(owner: string, message: string) {
    const text = message.slice(0, 2000);
    if (this.notices.some((notice) => notice.owner === owner && notice.message === text)) return;
    this.notices.push({ id: ++this.sequence, owner, message: text });
    if (this.notices.length > 5) this.notices.shift();
    this.changed();
  }
  dismiss(id: number) {
    const index = this.notices.findIndex((n) => n.id === id);
    if (index >= 0) this.notices.splice(index, 1);
    this.changed();
  }
  load(bundle: Bundle, enabled = true): void {
    const manifest = parseManifest(bundle.manifest);
    const source = text(bundle.source, 1024 * 1024);
    this.unload(manifest.id);
    const ticket = this.tickets.get(manifest.id) ?? 0;
    this.plugins.set(manifest.id, { manifest, state: enabled ? "loading" : "disabled" });
    this.changed();
    if (!enabled) return;
    // Admission is synchronous; activation is serial even when boot discovers many plugins.
    this.lifecycle = this.lifecycle
      .then(() => {
        if (this.tickets.get(manifest.id) !== ticket) return;
        return this.activate({ manifest, source });
      })
      .catch((error) => {
        if (
          this.tickets.get(manifest.id) === ticket &&
          this.plugins.get(manifest.id)?.state === "loading"
        )
          this.crash(manifest.id, String(error));
      });
  }
  private activate(bundle: Bundle): Promise<void> {
    const id = bundle.manifest.id;
    return new Promise((resolve, reject) => {
      const port = sandbox(bundle.source, (message) => this.receive(id, instance, message));
      const instance: Instance = {
        bundle,
        live: true,
        port,
        subscriptions: new Map(),
        pending: new Map(),
        ready: resolve,
        failed: reject,
        lastPong: Date.now(),
        count: 0,
        apiBusy: false,
        timer: setTimeout(() => this.crash(id, "Activation timed out (8 seconds)"), 8000),
        heartbeat: setInterval(() => {
          if (Date.now() - instance.lastPong > 12000) {
            this.crash(id, "Plugin worker stopped responding");
            return;
          }
          instance.count = 0;
          port.send({ kind: "ping" });
        }, 3000),
      };
      this.instances.set(id, instance);
    });
  }
  private require(instance: Instance, permission: Permission) {
    if (!instance.bundle.manifest.permissions.includes(permission))
      throw new Error(`Permission denied: ${permission}`);
  }
  private receive(id: string, instance: Instance, input: unknown) {
    if (!instance.live || this.instances.get(id) !== instance) return;
    try {
      if (++instance.count > 1500 || JSON.stringify(input).length > 300_000)
        throw new Error("Plugin message quota exceeded");
      const message = object(input);
      const manifest = instance.bundle.manifest;
      switch (message.kind) {
        case "ready":
          clearTimeout(instance.timer);
          this.plugins.set(id, { manifest, state: "active" });
          instance.ready();
          instance.port.send({
            kind: "event",
            name: "app:localeChanged",
            payload: { locale: i18n.getLocale() },
          });
          instance.port.send({ kind: "event", name: "app:ready", payload: { version: "0.1.0" } });
          this.events.emit("plugin:loaded", { id });
          this.changed();
          break;
        case "pong":
          instance.lastPong = Date.now();
          break;
        case "crash":
          this.crash(id, text(message.error, 10000));
          break;
        case "command.register": {
          const command = text(message.id);
          if (!manifest.contributes.commands.some((c) => c.id === command))
            throw new Error("Command not declared");
          this.commands.register(id, command, (args) => this.invoke(instance, command, args));
          this.changed();
          break;
        }
        case "command.remove":
          // Removing a command cannot remove another plugin's registrations.
          if (!manifest.contributes.commands.some((c) => c.id === message.id))
            throw new Error("Command not owned");
          this.commands.remove(id, String(message.id));
          this.changed();
          break;
        case "command.result": {
          const pending = instance.pending.get(Number(message.id));
          if (!pending) return;
          instance.pending.delete(Number(message.id));
          clearTimeout(pending.timer);
          if (message.error) pending.reject(new Error(String(message.error)));
          else pending.resolve((message.value ?? null) as Json);
          break;
        }
        case "panel.register":
        case "panel.update": {
          const panel = manifest.contributes.panels.find((p) => p.id === message.id);
          if (!panel) throw new Error("Panel not declared");
          if (message.kind === "panel.register" && this.panels.has(panel.id))
            throw new Error("Duplicate panel");
          if (message.kind === "panel.update" && !this.panels.has(panel.id))
            throw new Error("Panel not registered");
          this.panels.set(panel.id, {
            ...panel,
            owner: id,
            view: validateView(message.view, manifest),
          });
          this.changed();
          break;
        }
        case "panel.remove": {
          const panel = this.panels.get(String(message.id));
          if (panel?.owner === id) {
            this.panels.delete(panel.id);
            this.changed();
          }
          break;
        }
        case "subscribe": {
          const name = text(message.name);
          if (instance.subscriptions.has(name)) break;
          if (instance.subscriptions.size >= 64) throw new Error("Too many subscriptions");
          if (name.startsWith("pi:")) this.require(instance, "pi.read");
          else if (name === "workspace:opened") this.require(instance, "workspace.read");
          else if (
            !["app:ready", "app:localeChanged", "plugin:loaded", "plugin:unloaded"].includes(
              name,
            ) &&
            !name.startsWith(`custom:${id}:`)
          )
            throw new Error("Event namespace is not accessible");
          instance.subscriptions.set(
            name,
            this.events.on(name, (payload) => instance.port.send({ kind: "event", name, payload })),
          );
          break;
        }
        case "unsubscribe":
          instance.subscriptions.get(String(message.name))?.();
          instance.subscriptions.delete(String(message.name));
          break;
        case "emit": {
          const name = text(message.name);
          if (!name.startsWith(`custom:${id}:`))
            throw new Error("Cannot forge host/other plugin events");
          this.events.emit(name, message.payload);
          break;
        }
        case "call": {
          const method = text(message.method);
          const args = object(message.args);
          const requestId = message.id;
          if (!Number.isSafeInteger(requestId)) throw new Error("Invalid API correlation id");
          if (instance.apiBusy) throw new Error("Only one API request may be in flight");
          instance.apiBusy = true;
          const finish = (value: Json, error?: string) => {
            instance.apiBusy = false;
            if (instance.live) instance.port.send({ kind: "result", id: requestId, value, error });
          };
          if (method === "commands.execute") {
            // Reject reentrancy instead of deadlocking the serial command queue.
            if (instance.pending.size) {
              finish(null, "Nested command execution is not supported in API v1");
              break;
            }
            this.commands.execute(text(args.id), args.args as Json, id).then(
              (value) => finish(value),
              (error) => finish(null, String(error)),
            );
          } else {
            if (!methods[method]) {
              finish(null, "Unknown API method");
              break;
            }
            try {
              this.require(instance, methods[method]);
            } catch (error) {
              finish(null, String(error));
              break;
            }
            if (method === "notifications.show") {
              this.notice(id, text(args.message, 2000));
              finish(null);
              break;
            }
            host<Json>({ op: "plugin", id, method, args }, () => {
              if (!instance.live || this.instances.get(id) !== instance)
                throw new Error("Plugin was unloaded");
              this.require(instance, methods[method]);
            }).then(
              (value) => finish(value),
              (error) => finish(null, String(error)),
            );
          }
          break;
        }
        default:
          throw new Error("Unknown plugin message");
      }
    } catch (error) {
      this.crash(id, String(error));
    }
  }
  private invoke(instance: Instance, command: string, args?: Json): Promise<Json> {
    if (!instance.live) return Promise.reject(new Error("Plugin unloaded"));
    if (instance.pending.size >= 8) return Promise.reject(new Error("Command queue is full"));
    return new Promise((resolve, reject) => {
      const id = ++this.sequence;
      const timer = setTimeout(() => {
        instance.pending.delete(id);
        reject(new Error("Command timed out"));
        this.crash(instance.bundle.manifest.id, "Command timed out (30 seconds)");
      }, 30000);
      instance.pending.set(id, { resolve, reject, timer });
      instance.port.send({ kind: "command", id, command, args });
    });
  }
  unload(id: string): void {
    this.tickets.set(id, (this.tickets.get(id) ?? 0) + 1);
    const instance = this.instances.get(id);
    if (instance) {
      instance.live = false;
      clearTimeout(instance.timer);
      clearInterval(instance.heartbeat);
      instance.failed(new Error("Plugin unloaded"));
      instance.subscriptions.forEach((dispose) => dispose());
      instance.pending.forEach((pending) => {
        clearTimeout(pending.timer);
        pending.reject(new Error("Plugin unloaded"));
      });
      instance.pending.clear();
      instance.port.send({ kind: "deactivate" });
      setTimeout(() => instance.port.destroy(), 150);
      this.instances.delete(id);
    }
    this.commands.removeOwner(id);
    for (const [key, panel] of this.panels) if (panel.owner === id) this.panels.delete(key);
    const plugin = this.plugins.get(id);
    if (plugin) {
      plugin.state = "disabled";
      this.events.emit("plugin:unloaded", { id });
    }
    this.changed();
  }
  forget(id: string) {
    this.unload(id);
    this.plugins.delete(id);
    this.changed();
  }
  private crash(id: string, error: string) {
    this.unload(id);
    const plugin = this.plugins.get(id);
    if (plugin) {
      plugin.state = "crashed";
      plugin.error = error.slice(0, 2000);
    }
    this.notice(id, `Plugin crashed: ${error}`);
    console.error(`[plugin:${id}]`, error);
    this.changed();
  }
}
