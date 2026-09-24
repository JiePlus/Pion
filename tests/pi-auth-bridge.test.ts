import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

test("Pi auth bridge lists OAuth providers and completes a prompted login", async (context) => {
  const root = mkdtempSync(join(tmpdir(), "pion-pi-auth-"));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, "bin"));
  mkdirSync(join(root, "dist"));
  writeFileSync(
    join(root, "package.json"),
    JSON.stringify({
      name: "@earendil-works/pi-coding-agent",
      type: "module",
    }),
  );
  writeFileSync(join(root, "bin/pi"), "");
  writeFileSync(
    join(root, "dist/index.js"),
    `
export const ModelRuntime = {
  async create() {
    const provider = { id: "test-oauth", name: "Test OAuth", baseUrl: "http://example.test/v1", auth: { oauth: { name: "Test OAuth" } } };
    return {
      getProviders: () => [provider],
      getProvider: (id) => id === provider.id ? provider : undefined,
      getAuth: async () => ({ auth: { apiKey: "test-key" } }),
      listCredentials: async () => [],
      async login(_provider, _method, interaction) {
        interaction.notify({ type: "auth_url", url: "https://example.test/login" });
        const code = await interaction.prompt({ type: "manual_code", message: "Paste code" });
        if (code !== "test-code") throw new Error("Wrong code");
      },
    };
  },
};
`,
  );
  const preload = join(root, "preload.mjs");
  writeFileSync(
    preload,
    `
globalThis.fetch = async (url, options) => {
  if (url.pathname !== "/v1/models" || options.redirect !== "error") throw new Error("Wrong endpoint");
  const api = process.argv.at(-1);
  if (api === "anthropic-messages") {
    if (url.searchParams.get("limit") !== "1000" || options.headers.get("x-api-key") !== "test-key"
      || options.headers.get("anthropic-version") !== "2023-06-01") throw new Error("Wrong Anthropic auth");
    return new Response(JSON.stringify({ data: [{ id: "claude-test", display_name: "Claude Test", max_input_tokens: 200000 }] }));
  }
  if (api === "google-generative-ai") {
    if (url.searchParams.get("pageSize") !== "1000" || options.headers.get("x-goog-api-key") !== "test-key") throw new Error("Wrong Google auth");
    return new Response(JSON.stringify({ models: [
      { name: "models/gemini-test", displayName: "Gemini Test", inputTokenLimit: 100000, supportedGenerationMethods: ["generateContent"] },
      { name: "models/embedding-test", supportedGenerationMethods: ["embedContent"] },
    ] }));
  }
  if (options.headers.get("Authorization") !== "Bearer test-key") throw new Error("Wrong OpenAI auth");
  return new Response(JSON.stringify({ data: [{ id: "model-a", name: "Model A", context_window: 128000 }, { id: "model-b" }] }));
};
`,
  );

  const helper = resolve("src-tauri/src/pi-auth-bridge.mjs");
  const executable = join(root, "bin/pi");
  const probe = spawnSync(process.execPath, ["--import", preload, helper, executable, "probe"], {
    encoding: "utf8",
    input: JSON.stringify({
      baseUrl: "http://example.test/v1",
      api: "openai-completions",
      key: "test-key",
    }),
  });
  assert.equal(probe.status, 0, probe.stdout);
  assert.equal(JSON.parse(probe.stdout).type, "probe");
  assert.ok(JSON.parse(probe.stdout).latencyMs >= 0);
  const listing = spawnSync(process.execPath, [helper, executable, "list"], { encoding: "utf8" });
  assert.equal(listing.status, 0);
  assert.deepEqual(JSON.parse(listing.stdout), {
    type: "providers",
    providers: [{ id: "test-oauth", name: "Test OAuth", credentialType: null }],
  });

  const globalBin = join(root, "global");
  const globalPackage = join(
    globalBin,
    "node_modules",
    "@earendil-works",
    "pi-coding-agent",
    "dist",
  );
  mkdirSync(globalPackage, { recursive: true });
  writeFileSync(join(globalBin, "pi.cmd"), "");
  writeFileSync(
    join(globalBin, "node_modules", "@earendil-works", "pi-coding-agent", "package.json"),
    JSON.stringify({ name: "@earendil-works/pi-coding-agent", type: "module" }),
  );
  writeFileSync(join(globalPackage, "index.js"), readFileSync(join(root, "dist/index.js")));
  const windowsListing = spawnSync(process.execPath, [helper, join(globalBin, "pi.cmd"), "list"], {
    encoding: "utf8",
  });
  assert.equal(windowsListing.status, 0, windowsListing.stdout);
  assert.deepEqual(JSON.parse(windowsListing.stdout), JSON.parse(listing.stdout));

  const child = spawn(process.execPath, [helper, executable, "login", "test-oauth"]);
  const events: { type: string; id?: string }[] = [];
  let buffer = "";
  const exitCode = await new Promise<number | null>((resolveExit, reject) => {
    child.stdout.on("data", (data: Buffer) => {
      buffer += data.toString();
      while (buffer.includes("\n")) {
        const end = buffer.indexOf("\n");
        const event = JSON.parse(buffer.slice(0, end));
        buffer = buffer.slice(end + 1);
        events.push(event);
        if (event.type === "prompt") {
          child.stdin.end(
            `${JSON.stringify({ type: "response", id: event.id, value: "test-code" })}\n`,
          );
        }
      }
    });
    child.on("error", reject);
    child.on("close", resolveExit);
  });
  assert.equal(exitCode, 0);
  assert.deepEqual(
    events.map((event) => event.type),
    ["auth_url", "prompt", "success"],
  );

  const discover = (api: string) => {
    const result = spawnSync(
      process.execPath,
      ["--import", preload, helper, executable, "discover", "test-oauth", api],
      { encoding: "utf8" },
    );
    assert.equal(result.status, 0, result.stdout);
    return JSON.parse(result.stdout);
  };
  assert.deepEqual(discover("openai-completions").models, [
    { id: "model-a", name: "Model A", contextWindow: 128000 },
    { id: "model-b" },
  ]);
  assert.deepEqual(discover("anthropic-messages").models, [
    { id: "claude-test", name: "Claude Test", contextWindow: 200000 },
  ]);
  assert.deepEqual(discover("google-generative-ai").models, [
    { id: "gemini-test", name: "Gemini Test", contextWindow: 100000 },
  ]);
});
