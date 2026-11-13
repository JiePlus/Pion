import assert from "node:assert/strict";
import test from "node:test";
import { DevReloader } from "../src/core/dev-reload.ts";
import type { Installed } from "../src/core/host.ts";

function record(id: string, extra: Partial<Installed> = {}): Installed {
  return {
    bundle: { manifest: { id } as Installed["bundle"]["manifest"], source: "" },
    digest: "d",
    enabled: true,
    ...extra,
  };
}

test("only enabled linked plugins are checked", async () => {
  const polled: string[] = [];
  const reloader = new DevReloader({
    poll: async (id) => {
      polled.push(id);
      return null;
    },
    wanted: () => true,
    apply: () => assert.fail("nothing changed"),
    report: () => assert.fail("no error"),
  });
  await reloader.tick([
    record("linked", { dev: "/src/linked" }),
    record("snapshot"),
    record("off", { dev: "/src/off", enabled: false }),
  ]);
  assert.deepEqual(polled, ["linked"]);
});

test("a changed folder is applied unless the plugin was turned off meanwhile", async () => {
  const applied: string[] = [];
  let wanted = true;
  const reloader = new DevReloader({
    poll: async (id) => record(id, { dev: "/src", digest: "next" }),
    wanted: () => wanted,
    apply: (next) => applied.push(next.digest),
    report: () => assert.fail("no error"),
  });
  const linked = [record("a", { dev: "/src" })];
  await reloader.tick(linked);
  wanted = false;
  await reloader.tick(linked);
  assert.deepEqual(applied, ["next"]);
});

test("one check per plugin at a time", async () => {
  let calls = 0;
  let release!: () => void;
  const reloader = new DevReloader({
    poll: () => {
      calls++;
      return new Promise((resolve) => (release = () => resolve(null)));
    },
    wanted: () => true,
    apply: () => {},
    report: () => {},
  });
  const linked = [record("a", { dev: "/src" })];
  const first = reloader.tick(linked);
  await reloader.tick(linked);
  assert.equal(calls, 1);
  release();
  await first;
  void reloader.tick(linked);
  assert.equal(calls, 2);
  release();
});

test("the same error is reported once until it changes or clears", async () => {
  const reports: string[] = [];
  let outcome: Error | null = new Error("Permissions changed");
  const reloader = new DevReloader({
    poll: async () => {
      if (outcome) throw outcome;
      return null;
    },
    wanted: () => true,
    apply: () => {},
    report: (id, error) => reports.push(`${id}: ${error}`),
  });
  const linked = [record("a", { dev: "/src" })];
  await reloader.tick(linked);
  await reloader.tick(linked);
  outcome = null;
  await reloader.tick(linked);
  outcome = new Error("Permissions changed");
  await reloader.tick(linked);
  assert.deepEqual(reports, ["a: Error: Permissions changed", "a: Error: Permissions changed"]);
});
