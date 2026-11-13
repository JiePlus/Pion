import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";

const sdk = readFileSync(new URL("../src/core/worker-sdk.js", import.meta.url), "utf8");

// Runs the worker SDK the way sandbox.ts assembles it, with a fake Worker global.
function worker(source: string) {
  const sent: Record<string, unknown>[] = [];
  const scope: Record<string, unknown> = {
    setTimeout,
    clearTimeout,
    self: {
      postMessage: (message: Record<string, unknown>) => sent.push(message),
      addEventListener: () => {},
    },
  };
  runInNewContext(
    `"use strict";\nlet desktopLocale = "en";\n${sdk}\nconst plugin = (() => {\n${source}\nreturn { activate, deactivate: typeof deactivate === "function" ? deactivate : undefined };\n})();\nplugin.activate(context);`,
    scope,
  );
  const self = scope.self as { onmessage: (event: { data: unknown }) => void };
  return {
    sent,
    post: (data: unknown) => self.onmessage({ data }),
    context: () => scope.ctx as { storage: { get(key: string): Promise<unknown> } },
  };
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

test("deactivate() can still save to storage before the worker reports done", async () => {
  const plugin = worker(`
    function activate(context) { globalThis.ctx = context; }
    async function deactivate() { await ctx.storage.set("draft", "saved"); }
  `);
  plugin.post({ kind: "deactivate" });
  await settle();
  const call = plugin.sent.find((message) => message.kind === "call");
  assert.equal(call?.method, "storage.set");
  assert.equal(JSON.stringify(call?.args), JSON.stringify({ key: "draft", value: "saved" }));
  assert.ok(!plugin.sent.some((message) => message.kind === "deactivated"));
  plugin.post({ kind: "result", id: call?.id, value: null });
  await settle();
  assert.ok(plugin.sent.some((message) => message.kind === "deactivated"));
  await assert.rejects(plugin.context().storage.get("draft"), /disposed/);
});

test("a plugin without deactivate() reports done at once", async () => {
  const plugin = worker(`function activate() {}`);
  plugin.post({ kind: "deactivate" });
  await settle();
  assert.equal(plugin.sent.map((message) => message.kind).join(), "deactivated");
});

test("a failing deactivate() still reports done", async () => {
  const plugin = worker(`
    function activate() {}
    async function deactivate() { throw new Error("boom"); }
  `);
  plugin.post({ kind: "deactivate" });
  await settle();
  assert.ok(plugin.sent.some((message) => message.kind === "deactivated"));
});
