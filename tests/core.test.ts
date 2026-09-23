import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { plainExtensionText } from "../src/core/extension-ui.ts";
import { Commands, Events } from "../src/core/registry.ts";
import { parseManifest, validateView } from "../src/core/validation.ts";
import { resolveLocale, translate } from "../src/core/i18n.ts";

const manifest = JSON.parse(
  readFileSync(new URL("../plugins/agent-chat/plugin.json", import.meta.url), "utf8"),
);
test("manifest enforces API, ownership, permissions and paths", () => {
  assert.equal(parseManifest(manifest).id, "agent-chat");
  assert.throws(() => parseManifest({ ...manifest, id: "core" }));
  assert.throws(() => parseManifest({ ...manifest, permissions: ["process.spawn"] }));
  assert.throws(() => parseManifest({ ...manifest, main: "../escape.js" }));
  assert.throws(() => parseManifest({ ...manifest, apiVersion: "2" }));
  assert.throws(() => parseManifest({ ...manifest, minDesktopVersion: "0.2.0" }));
  assert.throws(() =>
    parseManifest({
      ...manifest,
      contributes: { ...manifest.contributes, commands: [{ id: "core.quit", title: "Quit" }] },
    }),
  );
});
test("UI boundary only renders bounded data and owned commands", () => {
  assert.equal(
    validateView({ type: "text", text: "<script>bad()</script>" }, manifest).type,
    "text",
  );
  assert.throws(() => validateView({ type: "html", html: "<script>bad()</script>" }, manifest));
  assert.throws(() =>
    validateView({ type: "button", label: "Escape", command: "core.quit" }, manifest),
  );
  assert.throws(() => validateView({ type: "text", text: "x".repeat(300000) }, manifest));
});
test("extension UI text strips terminal styling without changing content", () => {
  assert.equal(
    plainExtensionText("\u001b[38;2;255;255;0mCodex #2 · 44%\u001b[39m"),
    "Codex #2 · 44%",
  );
  assert.equal(
    plainExtensionText("\u001b]8;;https://example.com\u0007Example\u001b]8;;\u0007"),
    "Example",
  );
  assert.equal(plainExtensionText("普通文本\n第二行"), "普通文本\n第二行");
});
test("commands reject duplicates, confused deputy and calls after unload", async () => {
  const registry = new Commands();
  registry.register("a", "a.run", async () => "ok");
  assert.throws(() => registry.register("b", "a.run", async () => null));
  assert.equal(await registry.execute("a.run", null, "a"), "ok");
  await assert.rejects(registry.execute("a.run", null, "b"), /Cross-plugin/);
  registry.remove("b", "a.run");
  assert.equal(registry.has("a.run"), true);
  registry.removeOwner("a");
  await assert.rejects(registry.execute("a.run"), /unavailable/);
});
test("event subscriptions dispose deterministically", () => {
  const events = new Events();
  let seen = 0;
  const dispose = events.on("test", () => seen++);
  events.emit("test", null);
  dispose();
  events.emit("test", null);
  assert.equal(seen, 1);
});

test("locale selection respects saved preference, system order and English fallback", () => {
  assert.equal(resolveLocale("en", ["zh-CN"]), "en");
  assert.equal(resolveLocale("zh-CN", ["en-US"]), "zh-CN");
  assert.equal(resolveLocale("invalid", ["zh-TW", "en"]), "zh-CN");
  assert.equal(resolveLocale(null, ["fr-FR", "en-GB", "zh-CN"]), "en");
  assert.equal(resolveLocale(null, ["ja-JP"]), "en");
  assert.equal(translate("zh-CN", "Enable {name}?", { name: "$&插件" }), "启用“$&插件”？");
  assert.equal(translate("en", "Enable {name}?", { name: "Chat" }), "Enable Chat?");
  assert.equal(translate("zh-CN", "External diagnostic"), "External diagnostic");
});

test("manifest translations are optional, bounded and validated on every contribution", () => {
  const legacy = JSON.parse(readFileSync("examples/hello-plugin/plugin.json", "utf8"));
  assert.equal(parseManifest(legacy).nameI18n, undefined);
  assert.equal(parseManifest(manifest).nameI18n?.["zh-CN"], "智能体对话");
  assert.throws(() => parseManifest({ ...manifest, nameI18n: { fr: "Chat" } }));
  assert.throws(() => parseManifest({ ...manifest, nameI18n: { en: 123 } }));
  const badCommand = structuredClone(manifest);
  badCommand.contributes.commands[0].titleI18n = { "zh-CN": "" };
  assert.throws(() => parseManifest(badCommand));
  const badPanel = structuredClone(manifest);
  badPanel.contributes.panels[0].titleI18n = { en: "x".repeat(101) };
  assert.throws(() => parseManifest(badPanel));
});
