import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import type { Json, Locale, PiDesktopPluginContext, PiEvent, View } from "../src/core/api.ts";
import { parseManifest, validateView } from "../src/core/validation.ts";

const manifest = parseManifest(JSON.parse(readFileSync("plugins/agent-chat/plugin.json", "utf8")));
const source = readFileSync("plugins/agent-chat/index.js", "utf8");
test("chat assembles deltas, uses authoritative final messages, survives retry and clears workspace data", async () => {
  const panels = new Map<string, View>();
  const commands = new Map<string, (args?: Json) => unknown>();
  const callbacks = new Map<number, () => void>();
  let timer = 0;
  let onEvent: (event: PiEvent) => void = () => {};
  let onStatus: (event: { state: string; detail: string }) => void = () => {};
  let aborts = 0;
  let locale: Locale = "en";
  let onLocale: (locale: Locale) => void = () => {};
  const update = (id: string, view: View) => {
    panels.set(id, validateView(view, manifest));
  };
  const api = {
    i18n: {
      get locale() {
        return locale;
      },
      onDidChange(callback: typeof onLocale) {
        onLocale = callback;
        return () => {
          onLocale = () => {};
        };
      },
    },
    commands: {
      register(id: string, callback: (args?: Json) => unknown) {
        commands.set(id, callback);
        return () => commands.delete(id);
      },
    },
    ui: {
      registerPanel(id: string, view: View) {
        update(id, view);
        return () => panels.delete(id);
      },
      updatePanel: update,
    },
    pi: {
      getState: async () => ({ isStreaming: false }),
      getMessages: async () => ({ messages: [] }),
      prompt: async () => {},
      abort: async () => {
        aborts++;
      },
      onEvent(callback: typeof onEvent) {
        onEvent = callback;
        return () => {};
      },
    },
    events: {
      on(_name: string, callback: typeof onStatus) {
        onStatus = callback;
        return () => {};
      },
    },
  } as unknown as PiDesktopPluginContext;
  const plugin = runInNewContext(`${source}\n({activate, deactivate})`, {
    setTimeout(callback: () => void) {
      callbacks.set(++timer, callback);
      return timer;
    },
    clearTimeout(id: number) {
      callbacks.delete(id);
    },
  });
  function emit(event: PiEvent) {
    onEvent(event);
    [...callbacks.values()].forEach((callback) => callback());
  }
  const rendered = () => JSON.stringify(panels.get("agent-chat.conversation"));
  await plugin.activate(api);
  await commands.get("agent-chat.send")!({ text: "hello" });
  emit({ type: "agent_start" });
  emit({ type: "message_start", message: { role: "assistant", content: [] } });
  emit({
    type: "message_update",
    assistantMessageEvent: { type: "text_delta", contentIndex: 1, delta: "world" },
  });
  emit({
    type: "message_update",
    assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "Hello " },
  });
  assert.ok(rendered().includes("Hello world"));
  emit({ type: "agent_end", willRetry: true });
  assert.ok(rendered().includes("WORKING"));
  emit({ type: "tool_execution_start", toolCallId: "t1", toolName: "read" });
  emit({ type: "tool_execution_end", toolCallId: "t1", isError: false });
  assert.ok(rendered().includes("Completed"));
  emit({ type: "auto_retry_start", errorMessage: "RAW $& failure" });
  locale = "zh-CN";
  onLocale(locale);
  assert.ok(rendered().includes("处理中"));
  assert.ok(rendered().includes("Hello world"));
  assert.ok(rendered().includes("Pi 正在重试：RAW $& failure"));
  assert.ok(rendered().includes("已完成"));
  assert.ok(rendered().includes("read"));
  emit({ type: "extension_error", error: "constructor" });
  assert.ok(rendered().includes('"text":"constructor"'));
  locale = "en";
  onLocale(locale);
  assert.ok(rendered().includes("WORKING"));
  assert.ok(rendered().includes("Hello world"));
  emit({
    type: "message_end",
    message: { role: "assistant", content: [{ type: "text", text: "Final authoritative text" }] },
  });
  assert.ok(rendered().includes("Final authoritative text"));
  assert.ok(!rendered().includes("Hello world"));
  emit({ type: "agent_settled" });
  assert.ok(rendered().includes("READY"));
  await commands.get("agent-chat.abort")!();
  assert.equal(aborts, 1);
  onStatus({ state: "disconnected", detail: "Connecting another workspace" });
  assert.ok(!rendered().includes("Final authoritative text"));
  assert.ok(!rendered().includes("Completed"));
  plugin.deactivate();
  assert.equal(commands.size, 0);
  assert.equal(panels.size, 0);
});
