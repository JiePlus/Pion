import { existsSync, readFileSync, realpathSync } from "node:fs";
import { createInterface } from "node:readline";
import { basename, delimiter, dirname, isAbsolute, join } from "node:path";
import { pathToFileURL } from "node:url";

function packageEntry(executable) {
  const paths = isAbsolute(executable)
    ? [executable]
    : (process.env.PATH ?? "").split(delimiter).map((entry) => join(entry, executable));
  const found = paths.find(existsSync);
  if (!found) throw new Error("Pi executable was not found");
  const windowsPackage = join(
    dirname(found),
    "node_modules",
    "@earendil-works",
    "pi-coding-agent",
    "dist",
    "index.js",
  );
  if (existsSync(windowsPackage)) return windowsPackage;
  let directory = dirname(realpathSync(found));
  while (directory !== dirname(directory)) {
    const manifest = join(directory, "package.json");
    if (existsSync(manifest)) {
      const packageName = JSON.parse(readFileSync(manifest, "utf8")).name;
      if (packageName === "@earendil-works/pi-coding-agent") {
        return join(directory, "dist/index.js");
      }
    }
    directory = dirname(directory);
  }
  throw new Error(`Pi SDK is unavailable for ${basename(found)}`);
}

function send(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

function modelNumber(value) {
  return Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

async function discoverModels(runtime, providerId, api) {
  if (
    ![
      "openai-completions",
      "openai-responses",
      "anthropic-messages",
      "google-generative-ai",
    ].includes(api)
  )
    throw new Error("Unsupported Pi API");
  const provider = runtime.getProvider(providerId);
  if (!provider) throw new Error("Unknown Pi provider");
  const auth = await runtime.getAuth(providerId);
  const baseUrl = auth?.auth.baseUrl ?? provider.baseUrl;
  if (!baseUrl) throw new Error("Provider has no base URL");
  const url = new URL(baseUrl);
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("Invalid provider URL");
  url.pathname = `${url.pathname.replace(/\/+$/, "")}/models`;
  if (api === "anthropic-messages") url.searchParams.set("limit", "1000");
  if (api === "google-generative-ai") url.searchParams.set("pageSize", "1000");

  const headers = new Headers({ Accept: "application/json" });
  const key = auth?.auth.apiKey;
  if (key) {
    if (api === "anthropic-messages") headers.set("x-api-key", key);
    else if (api === "google-generative-ai") headers.set("x-goog-api-key", key);
    else headers.set("Authorization", `Bearer ${key}`);
  }
  if (api === "anthropic-messages") headers.set("anthropic-version", "2023-06-01");
  for (const [name, value] of Object.entries({ ...provider.headers, ...auth?.auth.headers })) {
    if (typeof value === "string") headers.set(name, value);
    else headers.delete(name);
  }

  let response;
  try {
    response = await fetch(url, {
      headers,
      redirect: "error",
      signal: AbortSignal.timeout(10000),
    });
  } catch (error) {
    if (error?.name === "TimeoutError") throw new Error("Model list request timed out");
    throw new Error("Cannot reach the provider model list. Check the Base URL and connection.");
  }
  if (!response.ok) {
    if (response.status === 401 || response.status === 403)
      throw new Error(
        `Model list request failed (${response.status}). Check the provider API key.`,
      );
    if (response.status === 404)
      throw new Error("This endpoint does not provide a model list. Add models manually.");
    throw new Error(`Model list request failed (${response.status})`);
  }
  if (Number(response.headers.get("content-length")) > 4 * 1024 * 1024)
    throw new Error("Model list response is too large");
  const body = await response.text();
  if (body.length > 4 * 1024 * 1024) throw new Error("Model list response is too large");
  let result;
  try {
    result = JSON.parse(body);
  } catch {
    throw new Error("Endpoint returned an invalid model list");
  }
  const entries = Array.isArray(result)
    ? result
    : Array.isArray(result?.data)
      ? result.data
      : result?.models;
  if (!Array.isArray(entries)) throw new Error("Endpoint returned an unsupported model list");
  const models = new Map();
  for (const item of entries) {
    if (
      api === "google-generative-ai" &&
      Array.isArray(item?.supportedGenerationMethods) &&
      !item.supportedGenerationMethods.includes("generateContent")
    )
      continue;
    const rawId = item?.id ?? item?.name;
    const id =
      api === "google-generative-ai" && typeof rawId === "string"
        ? rawId.replace(/^models\//, "").trim()
        : typeof rawId === "string"
          ? rawId.trim()
          : rawId;
    if (typeof id !== "string" || !id || id.length > 200 || /[\u0000-\u001f]/.test(id)) continue;
    const name =
      item.display_name ?? item.displayName ?? (item.name !== rawId ? item.name : undefined);
    const contextWindow = modelNumber(
      item.context_window ?? item.contextWindow ?? item.max_input_tokens ?? item.inputTokenLimit,
    );
    const maxTokens = modelNumber(item.max_tokens ?? item.maxTokens ?? item.outputTokenLimit);
    models.set(id, {
      id,
      ...(typeof name === "string" && name !== id && name.length <= 200 ? { name } : {}),
      ...(contextWindow ? { contextWindow } : {}),
      ...(maxTokens ? { maxTokens } : {}),
    });
    if (models.size >= 1000) break;
  }
  return {
    type: "models",
    models: [...models.values()],
    truncated: entries.length > 1000 || !!result?.has_more || !!result?.nextPageToken,
  };
}

const [, , executable, action, providerId, api] = process.argv;

try {
  const { ModelRuntime } = await import(pathToFileURL(packageEntry(executable)).href);
  const runtime = await ModelRuntime.create({ allowModelNetwork: false, refreshOnCreate: false });
  if (action === "list") {
    const credentials = new Map(
      (await runtime.listCredentials()).map((item) => [item.providerId, item.type]),
    );
    send({
      type: "providers",
      providers: runtime
        .getProviders()
        .filter((item) => item.auth.oauth)
        .map((item) => ({
          id: item.id,
          name: item.auth.oauth.name ?? item.name,
          credentialType: credentials.get(item.id) ?? null,
        })),
    });
  } else if (action === "discover") {
    send(await discoverModels(runtime, providerId, api));
  } else if (action === "login") {
    if (!runtime.getProvider(providerId)?.auth.oauth)
      throw new Error("Provider does not support Pi login");
    const abort = new AbortController();
    const pending = new Map();
    let sequence = 0;
    const input = createInterface({ input: process.stdin });
    input.on("line", (line) => {
      try {
        const message = JSON.parse(line);
        if (message.type === "cancel") {
          abort.abort();
          for (const entry of pending.values()) entry.reject(new Error("Login cancelled"));
          pending.clear();
        }
        if (message.type === "response" && typeof message.value === "string") {
          const entry = pending.get(message.id);
          if (entry) {
            pending.delete(message.id);
            entry.resolve(message.value);
          }
        }
      } catch {
        // Ignore malformed input; it cannot become an OAuth response.
      }
    });
    try {
      await runtime.login(providerId, "oauth", {
        signal: abort.signal,
        prompt(request) {
          const id = String(++sequence);
          return new Promise((resolve, reject) => {
            pending.set(id, { resolve, reject });
            request.signal?.addEventListener(
              "abort",
              () => {
                pending.delete(id);
                reject(new Error("Prompt cancelled"));
              },
              { once: true },
            );
            send({
              type: "prompt",
              id,
              kind: request.type,
              message: request.message,
              placeholder: request.placeholder,
              options: request.options,
            });
          });
        },
        notify(event) {
          send(event);
        },
      });
      send({ type: "success" });
    } catch (error) {
      send({ type: abort.signal.aborted ? "cancelled" : "error", message: String(error) });
    } finally {
      input.close();
      process.stdin.pause();
    }
  } else {
    throw new Error("Unknown Pi authentication action");
  }
} catch (error) {
  send({ type: "error", message: String(error) });
  process.exitCode = 1;
}
