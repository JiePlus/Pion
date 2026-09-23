import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const executable = process.env.PI_EXECUTABLE || "pi";
const version = execFileSync(executable, ["--version"], { encoding: "utf8" }).trim();
const cwd = mkdtempSync(join(tmpdir(), "pion-pi-smoke-"));
const extension = join(process.cwd(), "src-tauri", "src", "pion-core-extension.js");
const child = spawn(
  executable,
  [
    "--mode",
    "rpc",
    "--no-session",
    "--no-extensions",
    "--extension",
    extension,
    "--no-skills",
    "--no-prompt-templates",
  ],
  { cwd, stdio: ["pipe", "pipe", "pipe"] },
);
const requests = [
  { type: "get_state" },
  { type: "get_commands" },
  { type: "get_available_models" },
  { type: "get_available_thinking_levels" },
  { type: "get_session_stats" },
  { type: "get_messages" },
  { type: "get_tree" },
  { type: "get_entries" },
  { type: "get_fork_messages" },
  { type: "get_last_assistant_text" },
  { type: "clear_queue" },
  { type: "set_auto_compaction", enabled: false },
  { type: "set_auto_compaction", enabled: true },
  { type: "set_auto_retry", enabled: false },
  { type: "set_auto_retry", enabled: true },
  { type: "abort_retry" },
  { type: "abort" },
  { type: "prompt", message: "/pion-core-tools chat", preset: "chat" },
  { type: "prompt", message: "/pion-core-tools read-only", preset: "read-only" },
  { type: "prompt", message: "/pion-core-tools full", preset: "full" },
];
let cursor = 0;
let buffer = "";
let finished = false;
let reportedPreset = "";
const timeout = setTimeout(() => finish(new Error("Pi smoke timed out")), 25000);
function finish(error) {
  if (finished) return;
  finished = true;
  clearTimeout(timeout);
  child.kill();
  rmSync(cwd, { recursive: true, force: true });
  if (error) {
    console.error(error);
    process.exitCode = 1;
  } else
    console.log(
      `Pi ${version}: ${requests.length} sequential RPC/extension checks passed. No provider request sent.`,
    );
}
function send() {
  const { preset: _preset, ...request } = requests[cursor];
  child.stdin.write(JSON.stringify({ id: `test-${cursor}`, ...request }) + "\n");
}
child.on("error", finish);
child.on("exit", () => {
  if (!finished) finish(new Error("Pi exited before all responses"));
});
child.stderr.on("data", () => {});
child.stdout.setEncoding("utf8");
child.stdout.on("data", (chunk) => {
  buffer += chunk;
  let newline;
  while ((newline = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, newline);
    buffer = buffer.slice(newline + 1);
    try {
      const response = JSON.parse(line);
      if (
        response.type === "extension_ui_request" &&
        response.method === "setStatus" &&
        response.statusKey === "pion-core-tool-preset"
      )
        reportedPreset = response.statusText;
      if (response.type !== "response") continue;
      assert.equal(response.id, `test-${cursor}`);
      assert.equal(response.command, requests[cursor].type);
      assert.equal(response.success, true, response.error);
      if (cursor === 0) assert.equal(typeof response.data.isStreaming, "boolean");
      if (cursor === 1) assert.ok(Array.isArray(response.data.commands));
      if (cursor === 2) assert.ok(Array.isArray(response.data.models));
      if (cursor === 3) assert.ok(Array.isArray(response.data.levels));
      if (cursor === 4) assert.equal(typeof response.data.totalMessages, "number");
      if (cursor === 5) assert.ok(Array.isArray(response.data.messages));
      if (cursor === 6) assert.ok(Array.isArray(response.data.tree));
      if (cursor === 7) assert.ok(Array.isArray(response.data.entries));
      if (cursor === 8) assert.ok(Array.isArray(response.data.messages));
      if (requests[cursor].type === "get_last_assistant_text")
        assert.equal(response.data.text == null, true);
      if (requests[cursor].type === "clear_queue") assert.ok(Array.isArray(response.data.steering));
      if (requests[cursor].preset) assert.equal(reportedPreset, requests[cursor].preset);
      cursor++;
      if (cursor === requests.length) finish();
      else send();
    } catch (error) {
      finish(error);
    }
  }
});
send();
