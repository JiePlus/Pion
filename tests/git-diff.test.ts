import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import type { Json, PiDesktopPluginContext, View } from "../src/core/api.ts";
import { parseManifest, validateView } from "../src/core/validation.ts";

const manifest = parseManifest(
  JSON.parse(readFileSync("plugins/git-diff-plugin/plugin.json", "utf8")),
);
const source = readFileSync("plugins/git-diff-plugin/index.js", "utf8");

function harness(status: () => Promise<Json>, diff: () => Promise<Json>) {
  const panels = new Map<string, View>();
  const commands = new Map<string, (args?: Json) => unknown>();
  const update = (id: string, view: View) => panels.set(id, validateView(view, manifest));
  const api = {
    i18n: {
      get locale() {
        return "en";
      },
      onDidChange: () => () => {},
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
    events: { on: () => () => {} },
    workspace: { gitStatus: () => status(), gitDiff: () => diff() },
  } as unknown as PiDesktopPluginContext;
  const plugin = runInNewContext(`${source}\n({activate, deactivate})`, {});
  return {
    plugin,
    panels,
    commands,
    api,
    rendered: () => JSON.stringify(panels.get("git-diff.panel")),
  };
}

test("git status panel lists branch and changed files through a validated View", async () => {
  const { plugin, api, rendered } = harness(
    async () => ({
      repo: true,
      branch: "main",
      detached: false,
      ahead: 1,
      behind: 0,
      clean: false,
      files: [
        { path: "src/a.ts", index: "M", worktree: " " },
        { path: "new.txt", index: "?", worktree: "?" },
      ],
    }),
    async () => ({ path: "", staged: false, binary: false, truncated: false, diff: "" }),
  );
  await plugin.activate(api);
  const json = rendered();
  assert.match(json, /main/);
  assert.match(json, /2 changed files/);
  assert.match(json, /M\s+src\/a\.ts/);
  assert.match(json, /\?\?\s+new\.txt/);
  plugin.deactivate();
});

test("opening a file renders its unified diff and reports binary/truncated states", async () => {
  let staged = false;
  const { plugin, api, commands, rendered } = harness(
    async () => ({
      repo: true,
      branch: "main",
      clean: false,
      files: [{ path: "src/a.ts", index: " ", worktree: "M" }],
    }),
    async () => ({
      path: "src/a.ts",
      staged,
      binary: false,
      truncated: true,
      diff: "diff --git a/src/a.ts b/src/a.ts\n@@ -1 +1,2 @@\n one\n+two\n",
    }),
  );
  await plugin.activate(api);
  await commands.get("git-diff.open")!({ path: "src/a.ts", staged: false });
  const json = rendered();
  assert.match(json, /"text":"src\/a\.ts"/);
  assert.match(json, /"text":"Unstaged"/);
  assert.match(json, /"type":"code"/);
  assert.match(json, /\+two/);
  assert.match(json, /Diff truncated for display/);

  staged = true;
  await commands.get("git-diff.open")!({ path: "src/a.ts", staged: true });
  assert.match(rendered(), /"text":"Staged"/);
  plugin.deactivate();
});

test("missing workspace and repository states are shown without crashing", async () => {
  let mode: "noworkspace" | "norepo" = "noworkspace";
  const { plugin, api, commands, rendered } = harness(
    async () => {
      if (mode === "noworkspace") throw new Error("No workspace is open");
      return { repo: false, clean: true, files: [] };
    },
    async () => ({ path: "", staged: false, binary: false, truncated: false, diff: "" }),
  );
  await plugin.activate(api);
  assert.match(rendered(), /Open a workspace to view Git status/);
  assert.doesNotMatch(rendered(), /Could not read Git status/);

  mode = "norepo";
  await commands.get("git-diff.refresh")!();
  assert.match(rendered(), /not a Git repository/);
  plugin.deactivate();
});
