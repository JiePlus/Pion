import type { Dispose, Json } from "./api.ts";

export class Commands {
  private entries = new Map<string, { owner: string; run: (args?: Json) => Promise<Json> }>();
  register(owner: string, id: string, run: (args?: Json) => Promise<Json>): Dispose {
    if (this.entries.has(id)) throw new Error(`Command already registered: ${id}`);
    this.entries.set(id, { owner, run });
    return () => {
      this.entries.delete(id);
    };
  }
  execute(id: string, args?: Json, caller?: string): Promise<Json> {
    const entry = this.entries.get(id);
    if (!entry) return Promise.reject(new Error(`Command unavailable: ${id}`));
    if (caller && caller !== entry.owner)
      return Promise.reject(new Error("Cross-plugin command execution is not granted"));
    return entry.run(args);
  }
  remove(owner: string, id: string): void {
    if (this.entries.get(id)?.owner === owner) this.entries.delete(id);
  }
  removeOwner(owner: string): void {
    for (const [id, entry] of this.entries) if (entry.owner === owner) this.entries.delete(id);
  }
  has(id: string): boolean {
    return this.entries.has(id);
  }
}
export class Events {
  private listeners = new Map<string, Set<(value: unknown) => void>>();
  on(name: string, listener: (value: unknown) => void): Dispose {
    const listeners = this.listeners.get(name) ?? new Set();
    listeners.add(listener);
    this.listeners.set(name, listeners);
    return () => {
      listeners.delete(listener);
      if (!listeners.size) this.listeners.delete(name);
    };
  }
  emit(name: string, value: unknown): void {
    for (const listener of this.listeners.get(name) ?? []) {
      try {
        listener(value);
      } catch (error) {
        console.error("Event listener failed", error);
      }
    }
  }
}
