import type { Page } from "@playwright/test";
import { readFileSync } from "node:fs";

// This fake native boundary exists only in tests. Production preview never fabricates Pi replies.
export async function taskFixture(page: Page) {
  await page.addInitScript(
    ({ manifest, source }) => {
      if (!localStorage.getItem("pion.locale") && navigator.language.startsWith("en"))
        localStorage.setItem("pion.locale", "en");
      const callbacks = new Map<number, (event: unknown) => void>();
      const listeners = new Map<string, number>();
      let sequence = 0;
      let updaterResourceSequence = 0;
      const updaterResources = new Set<number>();
      const downloadedUpdates = new Set<number>();
      let authLoginSequence = 0;
      let generation = 0;
      let active = "";
      const running = new Set<string>();
      const opened = new Set<string>();
      let model = {
        provider: "openai",
        id: "gpt-test",
        name: "GPT Test",
        input: ["text", "image"],
      };
      let thinkingLevel = "medium";
      let steeringMode = "one-at-a-time";
      let followUpMode = "one-at-a-time";
      let autoCompactionEnabled = true;
      let toolPreset = "full";
      let queue = { steering: [] as string[], followUp: [] as string[] };
      const read = (key: string, fallback: unknown) =>
        JSON.parse(localStorage.getItem(key) ?? JSON.stringify(fallback));
      const catalog = read("fixture.catalog", {
        projects: [{ id: "p1", name: "Pion", path: "/projects/Pion" }],
        tasks: [],
      });
      const histories = read("fixture.histories", {});
      const records = read("fixture.plugins", []);
      const packageSources = read("fixture.packageSources", []) as {
        source: string;
        scope: "user" | "project";
      }[];
      const skillPaths = read("fixture.skillPaths", { user: [], project: [] }) as {
        user: string[];
        project: string[];
      };
      const skillResources = read("fixture.skillResources", []) as any[];
      const skillStates = read("fixture.skillStates", {}) as Record<string, boolean>;
      const skillOverrides = read("fixture.skillOverrides", {}) as Record<string, string>;
      const skillCommands = read("fixture.skillCommands", { user: true, project: "inherit" }) as {
        user: boolean;
        project: "inherit" | "enabled" | "disabled";
      };
      const modelConfig = read("fixture.modelConfig", {
        path: "/home/test/.pi/agent/models.json",
        providers: [] as any[],
      });
      const modelAuth = read("fixture.modelAuth", {
        path: "/home/test/.pi/agent/auth.json",
        providers: [] as { provider: string; type: string }[],
      });
      const setupStatus = read("fixture.setupStatus", {
        installation: "ready",
        executable: "pi",
        installedVersion: "0.87.0",
        verifiedVersion: "0.87.0",
        npmManaged: true,
        canInstall: true,
        modelReady: true,
        selectedModel: { provider: "openai", id: "gpt-test" },
        models: [model, { provider: "anthropic", id: "claude-test", name: "Claude Test" }],
      });
      const gitRepo = read("fixture.gitRepo", {
        branch: "main",
        ahead: 0,
        unstaged: [
          "@@ -1,3 +1,3 @@\n one\n-two\n+TWO\n three\n",
          "@@ -20,2 +20,3 @@\n twenty\n+twenty-one\n twenty-two\n",
        ],
        staged: [] as string[],
        untracked: ["notes.md"],
        stagedNew: [] as string[],
        turn: true,
      });
      const gitStatus = read("fixture.gitStatus", {
        repo: true,
        branch: "main",
        detached: false,
        ahead: 0,
        behind: 0,
        clean: false,
        files: [
          { path: "src/core/runtime.ts", index: " ", worktree: "M" },
          { path: "plugins/git-diff-plugin/index.js", index: "A", worktree: " " },
          { path: "README.md", index: "?", worktree: "?" },
        ],
      });
      const gitDiffs = read("fixture.gitDiffs", {
        "src/core/runtime.ts": {
          path: "src/core/runtime.ts",
          staged: false,
          binary: false,
          truncated: false,
          diff: [
            "diff --git a/src/core/runtime.ts b/src/core/runtime.ts",
            "index 1a2b3c4..5d6e7f8 100644",
            "--- a/src/core/runtime.ts",
            "+++ b/src/core/runtime.ts",
            "@@ -44,6 +44,8 @@ const methods: Record<string, Permission> = {",
            '   "workspace.readFile": "workspace.read",',
            '+  "workspace.gitStatus": "workspace.git",',
            '+  "workspace.gitDiff": "workspace.git",',
            '   "storage.get": "storage",',
            '   "storage.set": "storage",',
            '   "notifications.show": "notifications",',
          ].join("\n"),
        },
        "plugins/git-diff-plugin/index.js": {
          path: "plugins/git-diff-plugin/index.js",
          staged: true,
          binary: false,
          truncated: false,
          diff: [
            "diff --git a/plugins/git-diff-plugin/index.js b/plugins/git-diff-plugin/index.js",
            "new file mode 100644",
            "--- /dev/null",
            "+++ b/plugins/git-diff-plugin/index.js",
            "@@ -0,0 +1,3 @@",
            "+async function refresh() {",
            "+  status = await api.workspace.gitStatus();",
            "+}",
          ].join("\n"),
        },
        "README.md": {
          path: "README.md",
          staged: false,
          binary: false,
          truncated: false,
          diff: [
            "diff --git a/README.md b/README.md",
            "new file mode 100644",
            "--- /dev/null",
            "+++ b/README.md",
            "@@ -0,0 +1,2 @@",
            "+## First-party Git/Diff plugin",
            "+Review-install plugins/git-diff-plugin to view status and diffs.",
          ].join("\n"),
        },
      });
      const emit = (name: string, payload: unknown) =>
        callbacks.get(listeners.get(name)!)?.({ event: name, payload });
      const piEvent = (event: unknown) =>
        emit("pi:event", { generation, taskId: active || null, event });
      const save = () => {
        localStorage.setItem("fixture.catalog", JSON.stringify(catalog));
        localStorage.setItem("fixture.histories", JSON.stringify(histories));
        localStorage.setItem("fixture.plugins", JSON.stringify(records));
        localStorage.setItem("fixture.packageSources", JSON.stringify(packageSources));
        localStorage.setItem("fixture.skillPaths", JSON.stringify(skillPaths));
        localStorage.setItem("fixture.skillResources", JSON.stringify(skillResources));
        localStorage.setItem("fixture.skillStates", JSON.stringify(skillStates));
        localStorage.setItem("fixture.skillOverrides", JSON.stringify(skillOverrides));
        localStorage.setItem("fixture.skillCommands", JSON.stringify(skillCommands));
        localStorage.setItem("fixture.modelConfig", JSON.stringify(modelConfig));
        localStorage.setItem("fixture.modelAuth", JSON.stringify(modelAuth));
      };
      const skillListing = () => ({
        paths: skillPaths,
        skillCommands,
        skills: [
          ...(["user", "project"] as const).flatMap((scope) =>
            skillPaths[scope].map((path) => ({
              name: path.split("/").at(-1),
              path,
              scope,
              origin: "top-level",
              source: null,
              enabled:
                skillOverrides[path] === "unload"
                  ? false
                  : skillOverrides[path] === "load"
                    ? true
                    : (skillStates[path] ?? true),
              userEnabled: skillStates[path] ?? true,
              projectOverride: skillOverrides[path] ?? "inherit",
            })),
          ),
          ...skillResources.map((resource) => ({
            ...resource,
            userEnabled: resource.userEnabled ?? resource.enabled,
            projectOverride: skillOverrides[resource.path] ?? "inherit",
          })),
        ],
      });
      Object.assign(window, {
        isTauri: true,
        fixturePiEvent: piEvent,
        fixturePiEventFor: (taskId: string, event: unknown) =>
          emit("pi:event", { generation, taskId, event }),
        fixtureTaskStatus: (taskId: string, state: string) => {
          const item = catalog.tasks.find((candidate: any) => candidate.id === taskId);
          if (item && state === "idle" && taskId !== active) item.unread = true;
          save();
          emit("task:status", { taskId, state, unread: state === "idle" && taskId !== active });
        },
        __TAURI_INTERNALS__: {
          transformCallback(callback: (event: unknown) => void) {
            callbacks.set(++sequence, callback);
            return sequence;
          },
          async invoke(command: string, args: any) {
            if (command === "plugin:event|listen") {
              listeners.set(args.event, args.handler);
              return args.handler;
            }
            if (command === "plugin:event|unlisten") return null;
            if (command === "plugin:app|version") return "0.1.0";
            if (command.startsWith("plugin:updater|") || command === "plugin:process|restart") {
              const calls = read("fixture.appUpdateCalls", []) as string[];
              calls.push(command);
              localStorage.setItem("fixture.appUpdateCalls", JSON.stringify(calls));
            }
            if (command === "plugin:updater|check") {
              if (localStorage.getItem("fixture.holdAppUpdateCheck"))
                await new Promise<void>((resolve) =>
                  Object.assign(window, { fixtureReleaseAppUpdateCheck: resolve }),
                );
              if (localStorage.getItem("fixture.failAppUpdateCheck"))
                throw new Error("Update check is offline");
              const update = read("fixture.appUpdate", null) as {
                version: string;
                date?: string;
                body?: string;
              } | null;
              if (!update) return null;
              const rid = ++updaterResourceSequence;
              updaterResources.add(rid);
              return {
                rid,
                currentVersion: "0.1.0",
                version: update.version,
                date: update.date ?? null,
                body: update.body ?? null,
                rawJson: {},
              };
            }
            if (command === "plugin:updater|download") {
              if (!updaterResources.has(args.rid)) throw new Error("Update resource is closed");
              args.onEvent.onmessage({ event: "Started", data: { contentLength: 2048 } });
              args.onEvent.onmessage({ event: "Progress", data: { chunkLength: 1024 } });
              if (localStorage.getItem("fixture.holdAppUpdateDownload"))
                await new Promise<void>((resolve) =>
                  Object.assign(window, { fixtureReleaseAppUpdateDownload: resolve }),
                );
              if (localStorage.getItem("fixture.failAppUpdateDownload"))
                throw new Error("Download interrupted");
              args.onEvent.onmessage({ event: "Progress", data: { chunkLength: 1024 } });
              args.onEvent.onmessage({ event: "Finished" });
              const rid = ++updaterResourceSequence;
              downloadedUpdates.add(rid);
              localStorage.setItem("fixture.appUpdateDownloaded", "yes");
              return rid;
            }
            if (command === "plugin:updater|install") {
              if (!updaterResources.has(args.updateRid) || !downloadedUpdates.has(args.bytesRid))
                throw new Error("No staged update");
              if (localStorage.getItem("fixture.failAppUpdateInstall"))
                throw new Error("Installation failed");
              downloadedUpdates.delete(args.bytesRid);
              localStorage.setItem("fixture.appUpdateInstalled", "yes");
              return null;
            }
            if (command === "plugin:updater|download_and_install")
              throw new Error("Background updates must not install before user restart");
            if (command === "plugin:resources|close") {
              updaterResources.delete(args.rid);
              downloadedUpdates.delete(args.rid);
              const closed = read("fixture.appUpdateClosed", []) as number[];
              closed.push(args.rid);
              localStorage.setItem("fixture.appUpdateClosed", JSON.stringify(closed));
              return null;
            }
            if (command === "plugin:process|restart") {
              if (localStorage.getItem("fixture.failAppRelaunch"))
                throw new Error("Restart failed");
              localStorage.setItem("fixture.appRelaunched", "yes");
              return null;
            }
            if (command !== "desktop") throw new Error("Unexpected native command");
            const request = args.request;
            if (request.op === "extension_ui.response") {
              if (localStorage.getItem("fixture.delayExtensionResponse"))
                await new Promise((resolve) => setTimeout(resolve, 150));
              localStorage.setItem("fixture.extensionResponse", JSON.stringify(request));
              return null;
            }
            if (request.op === "builtin.set") {
              const states = { "git-review": true, ...read("fixture.builtins", {}) };
              states[request.id] = request.enabled;
              localStorage.setItem("fixture.builtins", JSON.stringify(states));
              return states;
            }
            if (typeof request.op === "string" && request.op.startsWith("git.")) {
              const calls = read("fixture.gitCalls", []);
              localStorage.setItem("fixture.gitCalls", JSON.stringify([...calls, request]));
              if (localStorage.getItem("fixture.gitNotRepo") && request.op !== "git.init") {
                if (request.op === "git.summary") return { repo: false };
                throw new Error("Workspace is not a Git repository");
              }
              const repo = gitRepo;
              const hunkA1 = "@@ -1,3 +1,3 @@\n one\n-two\n+TWO\n three\n";
              const hunkA2 = "@@ -20,2 +20,3 @@\n twenty\n+twenty-one\n twenty-two\n";
              const fileDiff = (path: string, hunks: string[]) =>
                hunks.length
                  ? `diff --git a/${path} b/${path}\nindex 1111111..2222222 100644\n--- a/${path}\n+++ b/${path}\n${hunks.join("")}`
                  : "";
              const untracked = (path: string) =>
                `diff --git a/${path} b/${path}\nnew file mode 100644\n--- /dev/null\n+++ b/${path}\n@@ -0,0 +1 @@\n+hello\n`;
              const diffs = {
                unstaged:
                  fileDiff("src/a.ts", repo.unstaged) + repo.untracked.map(untracked).join(""),
                staged: fileDiff("src/a.ts", repo.staged) + repo.stagedNew.map(untracked).join(""),
                branch: fileDiff("src/a.ts", [hunkA1]),
                turn: repo.turn ? fileDiff("src/a.ts", [hunkA2]) : "",
              } as Record<string, string>;
              const unstagedCount = (repo.unstaged.length ? 1 : 0) + repo.untracked.length;
              const stagedCount = (repo.staged.length ? 1 : 0) + repo.stagedNew.length;
              switch (request.op) {
                case "git.init":
                  localStorage.removeItem("fixture.gitNotRepo");
                  localStorage.setItem("fixture.gitUnborn", "yes");
                  return { ok: true, output: "" };
                case "git.summary":
                  return {
                    repo: true,
                    branch: repo.branch,
                    ahead: repo.ahead,
                    behind: 0,
                    additions: repo.unstaged.length + repo.staged.length + repo.untracked.length,
                    deletions:
                      repo.unstaged.includes(hunkA1) || repo.staged.includes(hunkA1) ? 1 : 0,
                    files: unstagedCount + stagedCount,
                  };
                case "git.review":
                  return {
                    repo: true,
                    scope: request.scope,
                    branch: repo.branch,
                    detached: false,
                    ahead: repo.ahead,
                    behind: 0,
                    upstream: true,
                    remote: true,
                    staged: stagedCount,
                    unstaged: unstagedCount,
                    base: request.scope === "branch" ? "origin/main" : null,
                    turnAvailable: repo.turn,
                    unborn: !!localStorage.getItem("fixture.gitUnborn"),
                    diff: diffs[request.scope] ?? "",
                    truncated: false,
                  };
                case "git.hunk": {
                  const from = request.action === "unstage" ? repo.staged : repo.unstaged;
                  const index = from.indexOf(request.hunk);
                  if (index < 0)
                    throw new Error("This change is out of date; refresh the review and try again");
                  const [hunk] = from.splice(index, 1);
                  if (request.action === "stage") repo.staged.push(hunk);
                  if (request.action === "unstage") repo.unstaged.push(hunk);
                  break;
                }
                case "git.stage":
                  for (const path of request.paths) {
                    if (path === "." || path === "src/a.ts") {
                      repo.staged.push(...repo.unstaged.splice(0));
                    }
                    if (path === ".") repo.stagedNew.push(...repo.untracked.splice(0));
                    else if (repo.untracked.includes(path)) {
                      repo.untracked = repo.untracked.filter((item: string) => item !== path);
                      repo.stagedNew.push(path);
                    }
                  }
                  break;
                case "git.unstage":
                  repo.unstaged.push(...repo.staged.splice(0));
                  repo.untracked.push(...repo.stagedNew.splice(0));
                  break;
                case "git.revert":
                  for (const path of request.paths) {
                    if (path === "src/a.ts") repo.unstaged = [];
                    repo.untracked = repo.untracked.filter((item: string) => item !== path);
                  }
                  break;
                case "git.commit": {
                  if (request.includeUnstaged) {
                    repo.staged.push(...repo.unstaged.splice(0));
                    repo.stagedNew.push(...repo.untracked.splice(0));
                  }
                  repo.staged = [];
                  repo.stagedNew = [];
                  repo.ahead += 1;
                  const result: Record<string, unknown> = { ok: true, hash: "f00ba47" };
                  if (request.then !== "commit") {
                    result.pushed = true;
                    repo.ahead = 0;
                  }
                  if (request.then === "pr") result.prUrl = "https://github.com/acme/pion/pull/7";
                  return result;
                }
                case "git.branches":
                  if (localStorage.getItem("fixture.gitUnborn"))
                    return {
                      branches: [{ name: repo.branch, current: true, upstream: "", unborn: true }],
                    };
                  return {
                    branches: [
                      { name: repo.branch, current: true, upstream: `origin/${repo.branch}` },
                      { name: "feature/glass", current: false, upstream: "" },
                    ].filter((b, i, all) => all.findIndex((x) => x.name === b.name) === i),
                  };
                case "git.checkout":
                  repo.branch = request.branch;
                  break;
                case "git.createBranch":
                  repo.branch = request.name;
                  break;
                case "git.pr":
                  return { ok: true, prUrl: "https://github.com/acme/pion/pull/7" };
              }
              return { ok: true, output: "" };
            }
            switch (request.op) {
              case "boot":
                return {
                  plugins: records,
                  builtins: read("fixture.builtins", {}),
                  catalog,
                  settings: { executable: "pi", workspace: "/projects/Pion" },
                };
              case "pi_setup.scan":
                if (localStorage.getItem("fixture.delayPiScan"))
                  await new Promise((resolve) => setTimeout(resolve, 450));
                if (localStorage.getItem("fixture.failPiScan"))
                  throw new Error("Pi scan failed; retry or enter the path manually");
                return {
                  candidates: read("fixture.piCandidates", [
                    { executable: "/usr/local/bin/pi", version: "0.87.0", verified: true },
                    {
                      executable: "/Users/test/.nvm/versions/node/v22.19.0/bin/pi",
                      version: "0.87.1",
                      verified: true,
                    },
                  ]),
                };
              case "pi_setup.status":
                if (localStorage.getItem("fixture.delaySetupStatus"))
                  await new Promise((resolve) => setTimeout(resolve, 450));
                localStorage.setItem("fixture.setupStatusFinished", "yes");
                return {
                  ...setupStatus,
                  // The default fixture resolves whichever path is being tested;
                  // explicit setup-status fixtures can still model fallback paths.
                  ...(setupStatus.executable === "pi" ? { executable: request.executable } : {}),
                  selectedModel: request.model ?? setupStatus.selectedModel,
                };
              case "pi_setup.check_update":
                if (localStorage.getItem("fixture.failUpdateCheck"))
                  throw new Error("Pi update check is offline");
                return read("fixture.versionStatus", {
                  ...setupStatus,
                  latestVersion: "0.87.1",
                  canUpdate: false,
                });
              case "pi_setup.install":
                Object.assign(setupStatus, {
                  installation: "ready",
                  executable: "/usr/local/bin/pi",
                  installedVersion: "0.87.0",
                });
                localStorage.setItem("fixture.setupStatus", JSON.stringify(setupStatus));
                return setupStatus;
              case "pi_setup.update":
                if (localStorage.getItem("fixture.updateBlocked"))
                  throw new Error("Wait for running Pi tasks to finish before updating");
                localStorage.setItem("fixture.piUpdated", "yes");
                Object.assign(setupStatus, { installedVersion: setupStatus.verifiedVersion });
                localStorage.setItem("fixture.setupStatus", JSON.stringify(setupStatus));
                return setupStatus;
              case "package.list":
                return { sources: packageSources };
              case "skill.list":
                return skillListing();
              case "model_config.list":
                return modelConfig;
              case "model_config.scan":
                return {
                  services: read("fixture.localScan", [
                    {
                      name: "ollama-local",
                      label: "Ollama",
                      baseUrl: "http://127.0.0.1:11434/v1",
                      api: "openai-completions",
                      latencyMs: 8,
                      models: ["qwen2.5-coder:7b", "deepseek-r1:7b"],
                      modelCount: 2,
                    },
                    {
                      name: "lmstudio-local",
                      label: "LM Studio",
                      baseUrl: "http://127.0.0.1:1234/v1",
                      api: "openai-completions",
                      latencyMs: 11,
                      models: ["llama-3.2-3b"],
                      modelCount: 1,
                    },
                  ]),
                };
              case "model_config.probe":
                localStorage.setItem("fixture.modelProbe", JSON.stringify(request));
                return { type: "probe", latencyMs: 14 };
              case "model_config.discover":
                localStorage.setItem("fixture.modelDiscoveryProvider", request.provider);
                return {
                  type: "models",
                  models: [
                    { id: "qwen2.5-coder:7b", name: "Qwen Coder", contextWindow: 128000 },
                    { id: "deepseek-r1:7b", name: "DeepSeek R1" },
                    { id: "embed-large" },
                  ],
                  latencyMs: 38,
                  truncated: false,
                };
              case "model_auth.list":
                return modelAuth;
              case "model_auth.providers":
                return {
                  providers: [
                    {
                      id: "openai-codex",
                      name: "OpenAI (ChatGPT Plus/Pro)",
                      credentialType: modelAuth.providers.some(
                        (item: { provider: string; type: string }) =>
                          item.provider === "openai-codex" && item.type === "oauth",
                      )
                        ? "oauth"
                        : null,
                    },
                    { id: "github-copilot", name: "GitHub Copilot", credentialType: null },
                  ],
                };
              case "model_auth.login": {
                localStorage.setItem("fixture.modelAuthLogin", JSON.stringify(request));
                authLoginSequence += 1;
                const currentLogin = authLoginSequence;
                setTimeout(() => {
                  if (request.provider === "github-copilot") {
                    emit("model-auth:event", {
                      loginId: currentLogin,
                      event: {
                        type: "device_code",
                        userCode: "ABCD-1234",
                        verificationUri: "https://example.test/device",
                      },
                    });
                    return;
                  }
                  emit("model-auth:event", {
                    loginId: currentLogin,
                    event: {
                      type: "prompt",
                      id: "1",
                      kind: "select",
                      message: "Choose login method",
                      options: [{ id: "browser", label: "Browser login" }],
                    },
                  });
                }, 0);
                return { loginId: currentLogin };
              }
              case "model_auth.respond":
                localStorage.setItem("fixture.modelAuthResponse", JSON.stringify(request));
                if (request.promptId === "1") {
                  setTimeout(() => {
                    emit("model-auth:event", {
                      loginId: request.loginId,
                      event: { type: "auth_url", url: "https://example.test/login" },
                    });
                    emit("model-auth:event", {
                      loginId: request.loginId,
                      event: {
                        type: "prompt",
                        id: "2",
                        kind: "manual_code",
                        message: "Paste authorization code",
                      },
                    });
                  }, 0);
                  return null;
                }
                modelAuth.providers.push({ provider: "openai-codex", type: "oauth" });
                save();
                setTimeout(
                  () =>
                    emit("model-auth:event", {
                      loginId: request.loginId,
                      event: { type: "success" },
                    }),
                  0,
                );
                return null;
              case "model_auth.cancel":
              case "model_auth.sync":
                return null;
              case "model_auth.open_url":
                localStorage.setItem("fixture.modelAuthUrl", request.url);
                return null;
              case "model_auth.change": {
                localStorage.setItem("fixture.modelAuthAction", JSON.stringify(request));
                const index = modelAuth.providers.findIndex(
                  (item: { provider: string }) => item.provider === request.provider,
                );
                if (request.action === "save_key" && index < 0)
                  modelAuth.providers.push({ provider: request.provider, type: "api_key" });
                if (request.action === "save_key") setupStatus.modelReady = true;
                if (request.action === "remove_key" && index >= 0)
                  modelAuth.providers.splice(index, 1);
                save();
                localStorage.setItem("fixture.setupStatus", JSON.stringify(setupStatus));
                return modelAuth;
              }
              case "model_config.change": {
                localStorage.setItem("fixture.modelConfigAction", JSON.stringify(request));
                const provider = modelConfig.providers.find(
                  (item: any) => item.name === request.provider,
                );
                if (request.action === "provider.save") {
                  if (provider)
                    Object.assign(provider, { baseUrl: request.baseUrl, api: request.api });
                  else
                    modelConfig.providers.push({
                      name: request.provider,
                      baseUrl: request.baseUrl,
                      api: request.api,
                      models: [],
                      hasAdvancedSettings: false,
                    });
                }
                if (request.action === "provider.remove")
                  modelConfig.providers.splice(modelConfig.providers.indexOf(provider), 1);
                if (request.action === "model.save") {
                  const model = provider.models.find((item: any) => item.id === request.id);
                  const fields = {
                    id: request.id,
                    name: request.name,
                    reasoning: request.reasoning,
                    input: request.image ? ["text", "image"] : ["text"],
                    contextWindow: request.contextWindow,
                    maxTokens: request.maxTokens,
                  };
                  if (model) Object.assign(model, fields);
                  else provider.models.push(fields);
                }
                if (request.action === "model.import") {
                  let imported = 0;
                  for (const item of request.models) {
                    if (provider.models.some((model: any) => model.id === item.id)) continue;
                    provider.models.push(item);
                    imported += 1;
                  }
                  modelConfig.imported = imported;
                }
                if (request.action === "model.remove")
                  provider.models.splice(
                    provider.models.findIndex((item: any) => item.id === request.id),
                    1,
                  );
                save();
                return modelConfig;
              }
              case "package.install":
              case "package.update":
              case "package.remove":
                localStorage.setItem("fixture.packageAction", JSON.stringify(request));
                if (
                  request.op === "package.install" &&
                  !packageSources.some(
                    (item) => item.source === request.source && item.scope === request.scope,
                  )
                )
                  packageSources.push({ source: request.source, scope: request.scope });
                if (request.op === "package.remove")
                  packageSources.splice(
                    packageSources.findIndex(
                      (item) => item.source === request.source && item.scope === request.scope,
                    ),
                    1,
                  );
                save();
                return { sources: packageSources };
              case "skill.add":
              case "skill.remove":
              case "skill.toggle":
              case "skill.override":
              case "skill.commands":
                localStorage.setItem("fixture.skillAction", JSON.stringify(request));
                if (
                  request.op === "skill.add" &&
                  !skillPaths[request.scope as "user" | "project"].includes(request.path)
                )
                  skillPaths[request.scope as "user" | "project"].push(request.path);
                if (request.op === "skill.remove")
                  skillPaths[request.scope as "user" | "project"].splice(
                    skillPaths[request.scope as "user" | "project"].indexOf(request.path),
                    1,
                  );
                if (request.op === "skill.toggle") {
                  skillStates[request.path] = request.enabled;
                  const resource = skillResources.find((item) => item.path === request.path);
                  if (resource) {
                    resource.enabled = request.enabled;
                    resource.userEnabled = request.enabled;
                  }
                }
                if (request.op === "skill.override") {
                  skillOverrides[request.path] = request.state;
                  const resource = skillResources.find((item) => item.path === request.path);
                  if (resource) resource.enabled = request.state !== "unload";
                }
                if (request.op === "skill.commands") {
                  if (request.scope === "user") skillCommands.user = request.state === "enabled";
                  else skillCommands.project = request.state;
                }
                save();
                return skillListing();
              case "review": {
                const override = read("fixture.reviewManifest", null);
                return override
                  ? {
                      bundle: { manifest: override, source: "function activate() {}" },
                      digest: "fixture-custom",
                      enabled: true,
                    }
                  : { bundle: { manifest, source }, digest: "fixture-builtin", enabled: true };
              }
              case "approve":
                records.splice(0, records.length, {
                  bundle: { manifest, source },
                  digest: "fixture-builtin",
                  enabled: true,
                });
                save();
                return null;
              case "project.add": {
                const project = { id: "p2", name: "Other", path: "/projects/Other" };
                if (!catalog.projects.some((p: any) => p.id === project.id))
                  catalog.projects.push(project);
                save();
                return { catalog, project };
              }
              case "image.pick":
                return { images: read("fixture.pickedImages", []) };
              case "image.import":
                return {
                  images: request.images.map((image: any, index: number) => ({
                    ...image,
                    id: `import-${index}`,
                    size: Math.floor((image.data.length * 3) / 4),
                  })),
                };
              case "sessions.legacy.list":
                return {
                  sessions: [
                    {
                      id: "legacy-1",
                      title: "Imported CLI task",
                      unread: false,
                      projectPath: "/projects/Pion",
                      modified: 1,
                      messageCount: 2,
                    },
                  ],
                };
              case "sessions.legacy.import": {
                if (!catalog.tasks.some((task: any) => task.id === "legacy-task"))
                  catalog.tasks.unshift({
                    id: "legacy-task",
                    projectId: "p1",
                    title: "Imported CLI task",
                  });
                save();
                return { catalog, tasks: [catalog.tasks[0]] };
              }
              case "task.create": {
                const task = {
                  id: String(catalog.tasks.length + 1),
                  projectId: request.projectId,
                  title: request.title,
                  unread: false,
                };
                catalog.tasks.unshift(task);
                save();
                return { catalog, task };
              }
              case "task.prepare":
                localStorage.setItem("fixture.prepareStarted", "yes");
                active = "draft";
                generation++;
                emit("pi:status", {
                  generation,
                  taskId: null,
                  active: true,
                  state: "disconnected",
                  detail: "Connecting",
                });
                emit("pi:status", {
                  generation,
                  taskId: null,
                  active: true,
                  state: "connected",
                  detail: "Pi RPC connected",
                  working: false,
                });
                return null;
              case "task.open":
                if (localStorage.getItem("fixture.failOpen"))
                  throw new Error("Cannot start Pi: test failure");
                active = request.id;
                const reused = opened.has(active);
                opened.add(active);
                const task = catalog.tasks.find((item: any) => item.id === active);
                if (task) task.unread = false;
                save();
                generation++;
                emit("pi:status", {
                  generation,
                  taskId: active,
                  active: true,
                  state: "disconnected",
                  detail: "Connecting",
                });
                emit("pi:status", {
                  generation,
                  taskId: active,
                  active: true,
                  state: "connected",
                  detail: "Pi RPC connected",
                  working: running.has(active),
                });
                if (request.model)
                  model = {
                    provider: request.model.provider,
                    id: request.model.modelId,
                    name: request.model.modelId === "claude-test" ? "Claude Test" : "GPT Test",
                    input: ["text", "image"],
                  };
                if (request.thinkingLevel) thinkingLevel = request.thinkingLevel;
                piEvent({
                  type: "extension_ui_request",
                  id: `tool-preset-${generation}`,
                  method: "setStatus",
                  statusKey: "pion-core-tool-preset",
                  statusText: toolPreset,
                });
                return { catalog, reused };
              case "settings.save":
                localStorage.setItem("fixture.savedExecutable", request.executable);
                return null;
              case "session.branch": {
                const source = catalog.tasks.find((item: any) => item.id === active);
                const next = {
                  id: String(catalog.tasks.length + 1),
                  projectId: source.projectId,
                  title: request.title,
                };
                histories[next.id] = [...(histories[active] ?? [])];
                if (request.kind === "fork") {
                  const selected = (histories[active] ?? []).find(
                    (message: any) => message.entryId === request.entryId,
                  );
                  histories[next.id] = selected ? [selected] : [];
                }
                catalog.tasks.unshift(next);
                active = next.id;
                save();
                emit("pi:status", {
                  generation,
                  taskId: active,
                  active: true,
                  state: "connected",
                  detail: "Pi RPC connected",
                  working: false,
                });
                return {
                  cancelled: false,
                  catalog,
                  task: next,
                  text: request.kind === "fork" ? "Edited historical prompt" : null,
                };
              }
              case "task.rename": {
                const changed = catalog.tasks.find((item: any) => item.id === request.id);
                changed.title = request.name;
                save();
                return { catalog, task: changed };
              }
              case "session.export":
                localStorage.setItem("fixture.exported", "yes");
                return { path: "/tmp/pion-session.html" };
              case "session.history": {
                localStorage.setItem("fixture.historyCalled", "yes");
                const depth = Number(localStorage.getItem("fixture.historyDepth") ?? "0");
                const messages = histories[active] ?? [];
                const items = depth
                  ? Array.from({ length: depth }, (_, index) => ({
                      id: `deep-${index}`,
                      parentId: index ? `deep-${index - 1}` : null,
                      type: "message",
                      label: `Entry ${index}`,
                    }))
                  : messages.map((message: any, index: number) => ({
                      id: message.entryId ?? `entry-${index}`,
                      parentId: index
                        ? (messages[index - 1].entryId ?? `entry-${index - 1}`)
                        : null,
                      type: "message",
                      label:
                        typeof message.content === "string"
                          ? message.content.slice(0, 100)
                          : message.role,
                    }));
                return {
                  items,
                  leafId: items.at(-1)?.id ?? null,
                  forks: messages
                    .filter((message: any) => message.role === "user")
                    .map((message: any, index: number) => ({
                      entryId: message.entryId ?? `user-${index}`,
                      text:
                        typeof message.content === "string"
                          ? message.content
                          : (message.content?.find((part: any) => part.type === "text")?.text ??
                            ""),
                    })),
                };
              }
              case "enable":
                records.find((r: any) => r.bundle.manifest.id === request.id).enabled =
                  request.enabled;
                save();
                return null;
              case "remove":
                records.splice(0, records.length);
                save();
                return null;
              case "pi": {
                if (!active) throw new Error("No task open");
                if (request.command === "get_state") {
                  if (localStorage.getItem("fixture.failRefresh"))
                    throw new Error("Refresh failed for test");
                  if (localStorage.getItem("fixture.refreshDelay"))
                    await new Promise((resolve) => setTimeout(resolve, 250));
                  return {
                    model: localStorage.getItem("fixture.noImages")
                      ? { ...model, input: ["text"] }
                      : model,
                    thinkingLevel,
                    isStreaming: running.has(active),
                    isCompacting: false,
                    steeringMode,
                    followUpMode,
                    autoCompactionEnabled,
                  };
                }
                if (request.command === "get_messages")
                  return { messages: histories[active] ?? [] };
                if (request.command === "get_models")
                  return {
                    models: read("fixture.models", [
                      model,
                      { provider: "anthropic", id: "claude-test", name: "Claude Test" },
                    ]),
                  };
                if (request.command === "get_thinking_levels")
                  return { levels: ["off", "medium", "high"] };
                if (request.command === "get_commands")
                  return {
                    commands: [
                      { name: "fix-tests", description: "Fix failing tests", source: "prompt" },
                      { name: "demo", description: "Extension command", source: "extension" },
                      { name: "info", description: "Pi information", source: "extension" },
                    ],
                  };
                if (request.command === "get_tree")
                  return {
                    tree: (histories[active] ?? []).map((message: any, index: number) => ({
                      entry: {
                        id: message.entryId ?? `entry-${index}`,
                        parentId: index ? `entry-${index - 1}` : null,
                        type: "message",
                        message,
                      },
                      children: [],
                    })),
                    leafId: (histories[active] ?? []).length
                      ? `entry-${histories[active].length - 1}`
                      : null,
                  };
                if (request.command === "get_entries") return { entries: [], leafId: null };
                if (request.command === "get_fork_messages")
                  return {
                    messages: (histories[active] ?? [])
                      .filter((message: any) => message.role === "user")
                      .map((message: any, index: number) => ({
                        entryId: message.entryId ?? `user-${index}`,
                        text:
                          typeof message.content === "string"
                            ? message.content
                            : (message.content?.find((part: any) => part.type === "text")?.text ??
                              ""),
                      })),
                  };
                if (request.command === "get_session_stats") {
                  if (localStorage.getItem("fixture.failStats"))
                    throw new Error("Usage unavailable for test");
                  const rawPercent = localStorage.getItem("fixture.statsPercent");
                  return {
                    cost: 0.012,
                    contextUsage: {
                      tokens: 1200,
                      contextWindow: 12000,
                      percent: rawPercent === null ? 10 : Number(rawPercent),
                    },
                  };
                }
                if (request.command === "set_model") {
                  model = {
                    provider: request.args.provider,
                    id: request.args.modelId,
                    name: request.args.modelId === "claude-test" ? "Claude Test" : "GPT Test",
                    input: ["text", "image"],
                  };
                  return model;
                }
                if (request.command === "set_thinking_level") {
                  thinkingLevel = request.args.level;
                  return null;
                }
                if (request.command === "set_tool_preset") {
                  toolPreset = request.args.preset;
                  localStorage.setItem("fixture.toolPreset", toolPreset);
                  piEvent({
                    type: "extension_ui_request",
                    id: `tool-preset-${generation}-${toolPreset}`,
                    method: "setStatus",
                    statusKey: "pion-core-tool-preset",
                    statusText: toolPreset,
                  });
                  return null;
                }
                if (request.command === "compact") {
                  localStorage.setItem("fixture.compactRequest", JSON.stringify(request.args));
                  return null;
                }
                if (request.command === "set_auto_compaction") {
                  autoCompactionEnabled = request.args.enabled;
                  localStorage.setItem("fixture.autoCompaction", String(autoCompactionEnabled));
                  return null;
                }
                if (request.command === "set_auto_retry") {
                  localStorage.setItem("fixture.autoRetry", String(request.args.enabled));
                  return null;
                }
                if (request.command === "set_steering_mode") {
                  steeringMode = request.args.mode;
                  localStorage.setItem("fixture.steeringMode", steeringMode);
                  return null;
                }
                if (request.command === "set_follow_up_mode") {
                  followUpMode = request.args.mode;
                  localStorage.setItem("fixture.followUpMode", followUpMode);
                  return null;
                }
                if (request.command === "abort_retry") {
                  localStorage.setItem("fixture.retryAborted", "yes");
                  return null;
                }
                if (request.command === "clear_queue") {
                  const removed = queue;
                  queue = { steering: [], followUp: [] };
                  piEvent({ type: "queue_update", ...queue });
                  return removed;
                }
                if (["prompt", "steer", "follow_up"].includes(request.command)) {
                  localStorage.setItem(
                    "fixture.piRequestCount",
                    String(Number(localStorage.getItem("fixture.piRequestCount") ?? "0") + 1),
                  );
                  localStorage.setItem("fixture.lastPiRequest", JSON.stringify(request));
                  if (localStorage.getItem("fixture.delaySend"))
                    await new Promise((resolve) => setTimeout(resolve, 150));
                  if (localStorage.getItem("fixture.failSend"))
                    throw new Error("Prompt rejected for test");
                  if (["/demo", "/info"].includes(request.args.message)) {
                    if (request.command !== "prompt")
                      throw new Error("Extension commands require prompt");
                    localStorage.setItem("fixture.extensionCommand", request.command);
                    return null;
                  }
                  if (
                    localStorage.getItem("fixture.hold") &&
                    ["steer", "follow_up"].includes(request.command)
                  )
                    running.add(active);
                  if (running.has(active) && request.command !== "prompt") {
                    if (request.command === "steer") queue.steering.push(request.args.message);
                    else queue.followUp.push(request.args.message);
                    piEvent({ type: "queue_update", ...queue });
                    return null;
                  }
                  running.add(active);
                  emit("task:status", { taskId: active, state: "working" });
                  const content = request.args.images?.length
                    ? [
                        { type: "text", text: request.args.message },
                        ...request.args.images.map((image: any) => ({
                          type: "image",
                          data: image.data,
                          mimeType: image.mimeType,
                        })),
                      ]
                    : request.args.message;
                  const user = {
                    role: "user",
                    content,
                    entryId: `user-${histories[active]?.length ?? 0}`,
                  };
                  const reply = { role: "assistant", content: `Reply for ${request.args.message}` };
                  const toolCallId = `tool-${histories[active]?.length ?? 0}`;
                  const toolCall = {
                    role: "assistant",
                    content: [
                      {
                        type: "toolCall",
                        id: toolCallId,
                        name: "read",
                        arguments: { path: "README.md" },
                      },
                    ],
                  };
                  const toolResult = {
                    role: "toolResult",
                    toolCallId,
                    toolName: "read",
                    content: [{ type: "text", text: "read complete" }],
                    isError: false,
                  };
                  histories[active] = [
                    ...(histories[active] ?? []),
                    user,
                    toolCall,
                    toolResult,
                    reply,
                  ];
                  save();
                  piEvent({ type: "agent_start" });
                  piEvent({ type: "message_end", message: user });
                  piEvent({ type: "message_end", message: toolCall });
                  piEvent({
                    type: "tool_execution_start",
                    toolCallId,
                    toolName: "read",
                    args: { path: "README.md" },
                  });
                  piEvent({
                    type: "tool_execution_end",
                    toolCallId,
                    result: toolResult,
                    isError: false,
                  });
                  piEvent({ type: "message_end", message: toolResult });
                  piEvent({ type: "message_end", message: reply });
                  if (!localStorage.getItem("fixture.hold")) {
                    running.delete(active);
                    emit("task:status", { taskId: active, state: "idle" });
                    piEvent({ type: "agent_settled" });
                  }
                  return null;
                }
                if (request.command === "abort") {
                  running.delete(active);
                  emit("task:status", { taskId: active, state: "idle" });
                  piEvent({ type: "agent_settled" });
                  return null;
                }
                throw new Error("Unknown core Pi command");
              }
              case "plugin":
                if (request.method === "workspace.gitStatus") return gitStatus;
                if (request.method === "workspace.gitDiff") {
                  const found = gitDiffs[request.args.path];
                  return (
                    found ?? {
                      path: request.args.path,
                      staged: request.args.staged === true,
                      binary: false,
                      truncated: false,
                      diff: "",
                    }
                  );
                }
                if (!active) throw new Error("No task open");
                if (request.method === "pi.getState") return { isStreaming: running.has(active) };
                if (request.method === "pi.getMessages")
                  return { messages: histories[active] ?? [] };
                if (request.method === "pi.prompt") {
                  if (localStorage.getItem("fixture.failSend"))
                    throw new Error("Prompt rejected for test");
                  running.add(active);
                  const user = { role: "user", content: request.args.message };
                  const reply = { role: "assistant", content: `Reply for ${request.args.message}` };
                  histories[active] = [...(histories[active] ?? []), user, reply];
                  save();
                  piEvent({ type: "agent_start" });
                  piEvent({ type: "message_end", message: user });
                  piEvent({ type: "message_end", message: reply });
                  if (!localStorage.getItem("fixture.hold")) {
                    running.delete(active);
                    piEvent({ type: "agent_settled" });
                  }
                  return null;
                }
                if (request.method === "pi.abort") {
                  running.delete(active);
                  piEvent({ type: "agent_settled" });
                  return null;
                }
                throw new Error("Unknown fixture API");
              default:
                throw new Error("Unexpected host operation " + request.op);
            }
          },
        },
      });
    },
    {
      manifest: JSON.parse(readFileSync("plugins/agent-chat/plugin.json", "utf8")),
      source: readFileSync("plugins/agent-chat/index.js", "utf8"),
    },
  );
}
