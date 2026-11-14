import type { Installed } from "./host.ts";

export interface DevReloadDeps {
  /** Asks the host to re-read a linked folder; resolves to the new record, or null if unchanged. */
  poll: (id: string) => Promise<Installed | null>;
  /** Whether the plugin should still be reloaded (it was not disabled or unlinked meanwhile). */
  wanted: (id: string) => boolean;
  /** Stores the new record and reloads the plugin. */
  apply: (record: Installed) => void;
  /** Reports a failed check; called again only when the error changes. */
  report: (id: string, error: string) => void;
}

// Checks linked development plugins for changes. One check per plugin runs at a time,
// and an unchanged error is reported once rather than on every tick.
export class DevReloader {
  private inFlight = new Set<string>();
  private errors = new Map<string, string>();
  private deps: DevReloadDeps;
  constructor(deps: DevReloadDeps) {
    this.deps = deps;
  }

  tick(records: Installed[]): Promise<void> {
    const checks: Promise<void>[] = [];
    for (const record of records) {
      const id = record.bundle.manifest.id;
      if (!record.dev || !record.enabled || this.inFlight.has(id)) continue;
      this.inFlight.add(id);
      checks.push(
        this.deps
          .poll(id)
          .then((next) => {
            this.errors.delete(id);
            if (next && this.deps.wanted(id)) this.deps.apply(next);
          })
          .catch((error) => {
            const message = String(error);
            if (this.errors.get(id) === message) return;
            this.errors.set(id, message);
            this.deps.report(id, message);
          })
          .finally(() => this.inFlight.delete(id)),
      );
    }
    return Promise.all(checks).then(() => {});
  }
}
