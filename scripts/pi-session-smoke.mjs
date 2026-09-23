import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { findPackageJSON } from "node:module";
import { pathToFileURL } from "node:url";

const executable = process.env.PI_EXECUTABLE || "pi";
const path = executable.includes("/")
  ? executable
  : execFileSync("which", [executable], { encoding: "utf8" }).trim();
// Test fixtures use the installed Pi serializer; the application remains RPC-only.
const { SessionManager } = await import(
  pathToFileURL(
    join(
      dirname(findPackageJSON(pathToFileURL(realpathSync(path)).href)),
      "dist/core/session-manager.js",
    ),
  ).href
);
const root = realpathSync(mkdtempSync(join(tmpdir(), "pion-session-smoke-")));
const firstDir = join(root, "first");
const secondDir = join(root, "second");
const operationsDir = join(root, "operations");
const extension = join(process.cwd(), "src-tauri", "src", "pion-core-extension.js");
function seed(directory, content) {
  const session = SessionManager.create(root, directory);
  session.appendMessage({ role: "user", content, timestamp: Date.now() });
  session.appendMessage({
    role: "assistant",
    content: [{ type: "text", text: `Fixture ${content}` }],
    api: "openai-responses",
    provider: "fixture",
    model: "fixture",
    stopReason: "stop",
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    timestamp: Date.now(),
  });
  return session.getSessionFile();
}
function inspect(directory, expected, file = false) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      executable,
      [
        "--mode",
        "rpc",
        file ? "--session" : "--session-dir",
        directory,
        ...(file ? [] : ["--continue"]),
        "--no-extensions",
        "--extension",
        extension,
        "--no-skills",
        "--no-prompt-templates",
      ],
      { cwd: root, stdio: ["pipe", "pipe", "pipe"] },
    );
    let buffer = "";
    let checked = false;
    let failure;
    const timer = setTimeout(() => {
      failure = new Error("Session restore timed out");
      child.kill();
    }, 25000);
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", () => {
      clearTimeout(timer);
      if (failure || !checked) reject(failure ?? new Error("Pi exited early"));
      else resolve();
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
          if (response.type !== "response") continue;
          assert.equal(response.success, true, response.error);
          assert.equal(response.id, "history");
          assert.deepEqual(
            response.data.messages.filter((m) => m.role === "user").map((m) => m.content),
            [expected],
          );
          checked = true;
        } catch (error) {
          failure = error;
        }
        child.kill();
      }
    });
    child.stdin.write(JSON.stringify({ id: "history", type: "get_messages" }) + "\n");
  });
}
function checkPreset(directory, setPreset) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      executable,
      [
        "--mode",
        "rpc",
        "--session-dir",
        directory,
        "--continue",
        "--no-extensions",
        "--extension",
        extension,
        "--no-skills",
        "--no-prompt-templates",
      ],
      { cwd: root, stdio: ["pipe", "pipe", "pipe"] },
    );
    let buffer = "";
    let preset = "";
    let responded = false;
    let failure;
    const timer = setTimeout(() => {
      failure = new Error("Tool preset restore timed out");
      child.kill();
    }, 25000);
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", () => {
      clearTimeout(timer);
      if (failure || !responded || preset !== "read-only")
        reject(failure ?? new Error(`Expected restored read-only preset, received ${preset}`));
      else resolve();
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
            preset = response.statusText;
          if (response.type === "response" && response.id === "preset") {
            assert.equal(response.success, true, response.error);
            responded = true;
          }
          if (responded && preset === "read-only") child.kill();
        } catch (error) {
          failure = error;
          child.kill();
        }
      }
    });
    child.stdin.write(
      JSON.stringify(
        setPreset
          ? { id: "preset", type: "prompt", message: "/pion-core-tools read-only" }
          : { id: "preset", type: "get_state" },
      ) + "\n",
    );
  });
}
function checkSessionOperations(directory) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      executable,
      [
        "--mode",
        "rpc",
        "--session-dir",
        directory,
        "--continue",
        "--no-extensions",
        "--extension",
        extension,
        "--no-skills",
        "--no-prompt-templates",
      ],
      { cwd: root, stdio: ["pipe", "pipe", "pipe"] },
    );
    const exported = join(root, "session.html");
    const commands = [
      "get_state",
      "get_fork_messages",
      "get_tree",
      "get_entries",
      "set_session_name",
      "get_state",
      "export_html",
      "clone",
      "set_session_name",
      "get_state",
      "fork",
      "set_session_name",
      "get_state",
    ];
    let cursor = 0;
    let buffer = "";
    let forkEntry = "";
    let originalFile = "";
    let cloneFile = "";
    let forkFile = "";
    let failure;
    const timer = setTimeout(() => {
      failure = new Error("Session operation smoke timed out");
      child.kill();
    }, 25000);
    function send() {
      const command = commands[cursor];
      const request =
        command === "set_session_name"
          ? {
              id: `operation-${cursor}`,
              type: command,
              name: cursor === 4 ? "Pion smoke" : cursor === 8 ? "Clone smoke" : "Fork smoke",
            }
          : command === "export_html"
            ? { id: `operation-${cursor}`, type: command, outputPath: exported }
            : command === "fork"
              ? { id: `operation-${cursor}`, type: command, entryId: forkEntry }
              : { id: `operation-${cursor}`, type: command };
      child.stdin.write(JSON.stringify(request) + "\n");
    }
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", () => {
      clearTimeout(timer);
      if (failure || cursor !== commands.length)
        reject(failure ?? new Error("Pi exited before session operation checks completed"));
      else {
        try {
          assert.equal(existsSync(cloneFile), true);
          assert.equal(existsSync(forkFile), false);
          resolve();
        } catch (error) {
          reject(error);
        }
      }
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
          if (response.type !== "response") continue;
          assert.equal(response.id, `operation-${cursor}`);
          assert.equal(response.command, commands[cursor]);
          assert.equal(response.success, true, response.error);
          if (cursor === 0) originalFile = response.data.sessionFile;
          if (cursor === 1) {
            assert.equal(response.data.messages.length, 1);
            forkEntry = response.data.messages[0].entryId;
          }
          if (cursor === 2) assert.ok(response.data.tree.length > 0);
          if (cursor === 3) assert.ok(response.data.entries.length > 0);
          if (cursor === 5) assert.equal(response.data.sessionName, "Pion smoke");
          if (cursor === 6) assert.equal(existsSync(exported), true);
          if (cursor === 7 || cursor === 10) assert.equal(response.data.cancelled, false);
          if (cursor === 9) {
            cloneFile = response.data.sessionFile;
            assert.notEqual(cloneFile, originalFile);
            assert.ok(cloneFile.startsWith(root));
            assert.equal(response.data.sessionName, "Clone smoke");
          }
          if (cursor === 12) {
            forkFile = response.data.sessionFile;
            assert.notEqual(forkFile, cloneFile);
            assert.ok(forkFile.startsWith(root));
            assert.equal(response.data.sessionName, "Fork smoke");
          }
          cursor++;
          if (cursor === commands.length) child.kill();
          else send();
        } catch (error) {
          failure = error;
          child.kill();
        }
      }
    });
    send();
  });
}
function checkParallel(first, second) {
  return new Promise((resolve, reject) => {
    const args = (directory) => [
      "--mode",
      "rpc",
      "--session-dir",
      directory,
      "--continue",
      "--no-extensions",
      "--no-skills",
      "--no-prompt-templates",
    ];
    const one = spawn(executable, args(first), { cwd: root, stdio: ["pipe", "pipe", "pipe"] });
    const two = spawn(executable, args(second), { cwd: root, stdio: ["pipe", "pipe", "pipe"] });
    let firstReady = false;
    let secondReady = false;
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      one.kill();
      two.kill();
      if (error) reject(error);
      else resolve();
    };
    const receive = (expected, ready) => {
      let buffer = "";
      return (chunk) => {
        buffer += chunk;
        let newline;
        while ((newline = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, newline);
          buffer = buffer.slice(newline + 1);
          try {
            const response = JSON.parse(line);
            if (response.type !== "response") continue;
            assert.equal(response.id, expected);
            assert.equal(response.success, true, response.error);
            ready();
            if (firstReady && secondReady) finish();
          } catch (error) {
            finish(error);
          }
        }
      };
    };
    const timer = setTimeout(() => finish(new Error("Parallel Pi smoke timed out")), 25000);
    one.on("error", finish);
    two.on("error", finish);
    one.stderr.on("data", () => {});
    two.stderr.on("data", () => {});
    one.stdout.setEncoding("utf8");
    two.stdout.setEncoding("utf8");
    one.stdout.on(
      "data",
      receive("parallel-one", () => {
        firstReady = true;
      }),
    );
    two.stdout.on(
      "data",
      receive("parallel-two", () => {
        secondReady = true;
      }),
    );
    one.stdin.write(JSON.stringify({ id: "parallel-one", type: "get_state" }) + "\n");
    two.stdin.write(JSON.stringify({ id: "parallel-two", type: "get_state" }) + "\n");
  });
}
try {
  const firstFile = seed(firstDir, "first task");
  seed(secondDir, "second task");
  seed(operationsDir, "session operation task");
  const importedDir = join(root, "imported");
  mkdirSync(importedDir);
  const importedFile = join(importedDir, "copied-session.jsonl");
  copyFileSync(firstFile, importedFile);
  await inspect(importedFile, "first task", true);
  await inspect(firstDir, "first task");
  await inspect(secondDir, "second task");
  await inspect(firstDir, "first task");
  await checkPreset(firstDir, true);
  await checkPreset(firstDir, false);
  await checkSessionOperations(operationsDir);
  await checkParallel(firstDir, secondDir);
  console.log(
    "Pi copied-session import, task isolation, parallel processes, reopen, Fork/Clone/rename/export, and tool preset restore passed. No provider request sent.",
  );
} finally {
  rmSync(root, { recursive: true, force: true });
}
