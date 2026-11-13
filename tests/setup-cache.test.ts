import assert from "node:assert/strict";
import test from "node:test";

const store = new Map<string, string>();
Object.assign(globalThis, {
  localStorage: {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, value),
    removeItem: (key: string) => store.delete(key),
  },
});
const { readCachedSetup } = await import("../src/ui/hooks/usePiSetup.ts");

const ready = {
  installation: "ready",
  executable: "/usr/local/bin/pi",
  installedVersion: "0.90.0",
  verifiedVersion: "",
  canInstall: true,
  modelReady: true,
  selectedModel: { provider: "anthropic", id: "claude-opus-5-5" },
  models: [{ provider: "anthropic", id: "claude-opus-5-5" }],
};
const save = (value: unknown) => store.set("pion.setupStatus", JSON.stringify(value));

test("a passed check is reused only for the same executable", () => {
  save({ executable: "/usr/local/bin/pi", status: ready });
  assert.equal(readCachedSetup("/usr/local/bin/pi")?.installedVersion, "0.90.0");
  assert.equal(readCachedSetup("/opt/pi"), null);
});

test("a check that did not pass is never reused", () => {
  save({ executable: "/usr/local/bin/pi", status: { ...ready, modelReady: false } });
  assert.equal(readCachedSetup("/usr/local/bin/pi"), null);
  save({ executable: "/usr/local/bin/pi", status: { ...ready, selectedModel: null } });
  assert.equal(readCachedSetup("/usr/local/bin/pi"), null);
  save({ executable: "/usr/local/bin/pi", status: { ...ready, installation: "broken" } });
  assert.equal(readCachedSetup("/usr/local/bin/pi"), null);
});

test("missing or damaged cache falls back to the full check", () => {
  store.clear();
  assert.equal(readCachedSetup("/usr/local/bin/pi"), null);
  store.set("pion.setupStatus", "{not json");
  assert.equal(readCachedSetup("/usr/local/bin/pi"), null);
});
