// Measures what opening a task costs with your own Pi and its configuration
// (extensions, skills, packages): a cold Pi process versus binding a warm spare
// with switch_session, which is what Pion now does for existing sessions.
// Uses a throwaway synthetic session; your real sessions are never touched.
//
//   npm run bench:pi              # PI_EXECUTABLE=/path/to/pi to pick a binary
//   npm run bench:pi -- 600       # number of conversation turns in the session
import { execFileSync, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";

const executable = process.env.PI_EXECUTABLE || "pi";
const extension = join(process.cwd(), "src-tauri", "src", "pion-core-extension.js");
const turns = Number(process.argv[2] ?? 300);
const runs = 3;

function start(args, cwd) {
  const t0 = performance.now();
  const child = spawn(executable, ["--mode", "rpc", "--extension", extension, ...args], {
    cwd,
    stdio: ["pipe", "pipe", "ignore"],
  });
  const waiting = new Map();
  let sequence = 0;
  createInterface({ input: child.stdout }).on("line", (line) => {
    let frame;
    try {
      frame = JSON.parse(line);
    } catch {
      return;
    }
    if (frame.type === "response") waiting.get(frame.id)?.(frame);
  });
  return {
    t0,
    pid: child.pid,
    request(body) {
      const id = `bench-${++sequence}`;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`${body.type} timed out`)), 60_000);
        waiting.set(id, (frame) => {
          clearTimeout(timer);
          frame.success ? resolve(frame.data) : reject(new Error(frame.error));
        });
        child.stdin.write(JSON.stringify({ ...body, id }) + "\n");
      });
    },
    stop: () => child.kill("SIGKILL"),
  };
}

const rss = (pid) => {
  try {
    return Math.round(Number(execFileSync("ps", ["-o", "rss=", "-p", String(pid)])) / 1024);
  } catch {
    return NaN;
  }
};
const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

const cwd = mkdtempSync(join(tmpdir(), "pion-bench-"));
const file = join(cwd, "session.jsonl");
const now = new Date().toISOString();
const lines = [{ type: "session", version: 3, id: randomUUID(), timestamp: now, cwd }];
let parent = null;
const add = (message) => {
  const id = randomUUID().slice(0, 8);
  lines.push({ type: "message", id, parentId: parent, timestamp: now, message });
  parent = id;
};
const text = "lorem ipsum dolor sit amet ".repeat(80);
const usage = {
  input: 1,
  output: 1,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 2,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};
for (let turn = 0; turn < turns; turn++) {
  add({ role: "user", content: `question ${turn}`, timestamp: Date.now() });
  add({
    role: "assistant",
    content: [
      { type: "text", text: `answer ${turn} ${text}` },
      { type: "toolCall", id: `c${turn}`, name: "read", arguments: { path: "a.txt" } },
    ],
    api: "anthropic-messages",
    provider: "anthropic",
    model: "bench",
    usage,
    stopReason: "toolUse",
    timestamp: Date.now(),
  });
  add({
    role: "toolResult",
    toolCallId: `c${turn}`,
    toolName: "read",
    content: [{ type: "text", text }],
    isError: false,
    timestamp: Date.now(),
  });
}
writeFileSync(file, lines.map((line) => JSON.stringify(line)).join("\n") + "\n");

try {
  console.log(
    `Pi ${execFileSync(executable, ["--version"], { encoding: "utf8" }).trim()} at ${executable}`,
  );
  console.log(
    `Session: ${lines.length - 1} entries, ${(statSync(file).size / 1e6).toFixed(1)} MB\n`,
  );
  const cold = [];
  const warm = [];
  let messages = 0;
  let idle = NaN;
  for (let run = 0; run < runs; run++) {
    const fresh = start(["--session", file], cwd);
    await fresh.request({ type: "get_state" });
    cold.push(performance.now() - fresh.t0);
    fresh.stop();

    const spare = start(["--no-session"], cwd);
    await spare.request({ type: "get_state" });
    idle = rss(spare.pid);
    const bound = performance.now();
    await spare.request({ type: "switch_session", sessionPath: file });
    await spare.request({ type: "get_state" });
    warm.push(performance.now() - bound);
    messages = (await spare.request({ type: "get_messages" })).messages.length;
    spare.stop();
  }
  console.log(`Open with a new Pi process:   ${median(cold).toFixed(0)} ms (median of ${runs})`);
  console.log(`Open with a warm spare:       ${median(warm).toFixed(0)} ms (median of ${runs})`);
  console.log(`Messages loaded:              ${messages}`);
  console.log(`Memory of one idle spare:     ${idle} MB`);
} finally {
  rmSync(cwd, { recursive: true, force: true });
}
