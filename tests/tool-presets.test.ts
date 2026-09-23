import assert from "node:assert/strict";
import test from "node:test";
import pionCoreExtension, {
  classifyTools,
  toolsForPreset,
} from "../src-tauri/src/pion-core-extension.js";

const tools = [
  { name: "read", sourceInfo: { source: "builtin" } },
  { name: "grep", sourceInfo: { source: "builtin" } },
  { name: "find", sourceInfo: { source: "builtin" } },
  { name: "ls", sourceInfo: { source: "builtin" } },
  { name: "bash", sourceInfo: { source: "builtin" } },
  { name: "write", sourceInfo: { source: "builtin" } },
  { name: "extension-read", sourceInfo: { source: "extension" } },
];

test("tool preset mapping is strict and classifies custom configurations", () => {
  assert.deepEqual(toolsForPreset("read-only", tools), ["read", "grep", "find", "ls"]);
  assert.deepEqual(toolsForPreset("chat", tools), []);
  assert.deepEqual(
    toolsForPreset("full", tools),
    tools.map((tool) => tool.name),
  );
  assert.equal(classifyTools([], tools), "chat");
  assert.equal(classifyTools(["read", "grep", "find", "ls"], tools), "read-only");
  assert.equal(classifyTools(["read", "bash"], tools), "custom");
});

test("Pi extension persists, restores and reports presets through public APIs", async () => {
  type Entry = { type: string; customType: string; data: { preset: string } };
  type Context = {
    sessionManager: { getBranch: () => Entry[] };
    ui: {
      notify: () => void;
      setStatus: (key: string, value: string) => void;
    };
  };
  let active = tools.map((tool) => tool.name);
  let command: { handler: (args: string, context: Context) => Promise<void> } | undefined;
  const events = new Map<string, (event: unknown, context: Context) => void>();
  const entries: Entry[] = [];
  const statuses: [string, string][] = [];
  const pi = {
    getAllTools: () => tools,
    getActiveTools: () => active,
    setActiveTools: (names: string[]) => {
      active = names;
    },
    appendEntry: (customType: string, data: { preset: string }) =>
      entries.push({ type: "custom", customType, data }),
    registerCommand: (
      _name: string,
      value: { handler: (args: string, context: Context) => Promise<void> },
    ) => {
      command = value;
    },
    on: (name: string, handler: (event: unknown, context: Context) => void) =>
      events.set(name, handler),
  };
  const context = {
    sessionManager: { getBranch: () => entries },
    ui: {
      notify: () => {},
      setStatus: (key: string, value: string) => statuses.push([key, value]),
    },
  };
  pionCoreExtension(pi);
  events.get("session_start")?.({}, context);
  assert.deepEqual(statuses.at(-1), ["pion-core-tool-preset", "full"]);
  assert.ok(command);
  await command.handler("read-only", context);
  assert.deepEqual(active, ["read", "grep", "find", "ls"]);
  assert.deepEqual(entries.at(-1)?.data, { preset: "read-only" });
  const entryCount = entries.length;
  await command.handler("status", context);
  assert.equal(entries.length, entryCount);
  assert.deepEqual(statuses.at(-1), ["pion-core-tool-preset", "read-only"]);
  active = [];
  events.get("session_start")?.({}, context);
  assert.deepEqual(active, ["read", "grep", "find", "ls"]);
  assert.deepEqual(statuses.at(-1), ["pion-core-tool-preset", "read-only"]);
});
