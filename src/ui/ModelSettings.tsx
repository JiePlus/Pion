import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { t } from "../core/i18n.ts";
import { host, native } from "../core/host.ts";

interface CustomModel {
  id: string;
  name?: string;
  reasoning?: boolean;
  input?: string[];
  contextWindow?: number;
  maxTokens?: number;
}
interface Provider {
  name: string;
  baseUrl?: string;
  api?: string;
  models: CustomModel[];
  hasAdvancedSettings: boolean;
}
interface Config {
  path: string;
  providers: Provider[];
  imported?: number;
}
interface DiscoveredModel {
  id: string;
  name?: string;
  contextWindow?: number;
  maxTokens?: number;
}
const blankModel = {
  id: "",
  name: "",
  reasoning: false,
  image: false,
  contextWindow: "",
  maxTokens: "",
};

type AccessMethod = "key" | "login" | "environment" | "custom" | "extension";
const methods: {
  id: AccessMethod;
  label: "API key" | "Pi login" | "Environment" | "Custom endpoint" | "Provider extension";
}[] = [
  { id: "key", label: "API key" },
  { id: "login", label: "Pi login" },
  { id: "environment", label: "Environment" },
  { id: "custom", label: "Custom endpoint" },
  { id: "extension", label: "Provider extension" },
];
const providerSuggestions = [
  "anthropic",
  "openai",
  "google",
  "openrouter",
  "deepseek",
  "xai",
  "groq",
  "mistral",
  "cerebras",
];

export function ModelSettings({
  onPackages,
  onChanged,
  embedded = false,
}: {
  onPackages: () => void;
  onChanged?: () => void;
  embedded?: boolean;
}) {
  const [method, setMethod] = useState<AccessMethod>("key");
  return (
    <div className="model-management">
      {!embedded && (
        <header className="model-management-header">
          <h1>{t("Connect Pi models")}</h1>
          <p className="settings-note">
            {t(
              "Choose how Pi connects to a model provider. Reopen a task after changing configuration.",
            )}
          </p>
        </header>
      )}
      <nav className="model-method-tabs" aria-label={t("Connection methods")}>
        {methods.map((item) => (
          <button
            key={item.id}
            type="button"
            className={method === item.id ? "selected" : ""}
            aria-current={method === item.id ? "page" : undefined}
            onClick={() => setMethod(item.id)}
          >
            {t(item.label)}
          </button>
        ))}
      </nav>
      {method === "key" && <ApiKeyAccess onChanged={onChanged} />}
      {method === "login" && <PiLogin onChanged={onChanged} />}
      {method === "environment" && (
        <section className="model-method-content">
          <h2>{t("Environment variables")}</h2>
          <p>
            {t(
              "Pi can use provider API keys from the environment without saving them in auth.json. Set the variable before launching Pion.",
            )}
          </p>
          <div className="model-env-list">
            <span>Anthropic</span>
            <code>ANTHROPIC_API_KEY</code>
            <span>OpenAI</span>
            <code>OPENAI_API_KEY</code>
            <span>Google Gemini</span>
            <code>GEMINI_API_KEY</code>
            <span>OpenRouter</span>
            <code>OPENROUTER_API_KEY</code>
            <span>DeepSeek</span>
            <code>DEEPSEEK_API_KEY</code>
          </div>
          <p className="settings-note">
            {t(
              "When Pion starts from Finder, shell-only environment variables may not be inherited.",
            )}
          </p>
        </section>
      )}
      {method === "custom" && <CustomModels onChanged={onChanged} />}
      {method === "extension" && (
        <section className="model-method-content">
          <h2>{t("Provider extension")}</h2>
          <p>
            {t(
              "Pi extensions can add providers with custom authentication, model discovery, or wire protocols. Install and manage them through Pi packages.",
            )}
          </p>
          <button type="button" onClick={onPackages}>
            {t("Open Pi packages")}
          </button>
        </section>
      )}
    </div>
  );
}

function ApiKeyAccess({ onChanged }: { onChanged?: () => void }) {
  const [config, setConfig] = useState<{
    path: string;
    providers: { provider: string; type: string }[];
  } | null>(null);
  const [provider, setProvider] = useState("");
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!native) return;
    let mounted = true;
    host<{ path: string; providers: { provider: string; type: string }[] }>({
      op: "model_auth.list",
    })
      .then((value) => {
        if (mounted) setConfig(value);
      })
      .catch((failure) => {
        if (mounted) setError(String(failure));
      });
    return () => {
      mounted = false;
    };
  }, []);

  async function change(action: "save_key" | "remove_key", name: string) {
    setBusy(true);
    setError("");
    try {
      const value = await host<{ path: string; providers: { provider: string; type: string }[] }>({
        op: "model_auth.change",
        action,
        provider: name,
        ...(action === "save_key" ? { key } : {}),
      });
      setConfig(value);
      setKey("");
      setProvider("");
      onChanged?.();
    } catch (failure) {
      setError(String(failure));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="model-method-content">
      <h2>{t("API keys")}</h2>
      <p className="settings-note">
        {t(
          "Save a provider API key in Pi's auth.json. Existing keys and OAuth tokens are never shown here.",
        )}
      </p>
      {config && <code className="model-config-path">{config.path}</code>}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {!native && (
        <p className="settings-note">{t("Model configuration requires the desktop app.")}</p>
      )}
      <form
        className="model-auth-form"
        onSubmit={(event) => {
          event.preventDefault();
          change("save_key", provider);
        }}
      >
        <label>
          {t("Provider ID")}
          <input
            list="pi-provider-suggestions"
            value={provider}
            onChange={(event) => setProvider(event.target.value)}
            placeholder="openai"
            required
          />
          <datalist id="pi-provider-suggestions">
            {providerSuggestions.map((item) => (
              <option key={item} value={item} />
            ))}
          </datalist>
        </label>
        <label>
          {t("API key")}
          <input
            type="password"
            autoComplete="new-password"
            value={key}
            onChange={(event) => setKey(event.target.value)}
            required
          />
        </label>
        <button className="primary" type="submit" disabled={!native || busy}>
          {t("Save API key")}
        </button>
      </form>
      {config && config.providers.length > 0 && (
        <div className="model-auth-list">
          <h3>{t("Saved Pi credentials")}</h3>
          {config.providers.map((item) => (
            <div key={item.provider}>
              <strong>{item.provider}</strong>
              <span className="settings-note">
                {item.type === "api_key" ? t("API key saved") : t("Managed by Pi login")}
              </span>
              {item.type === "api_key" && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    if (
                      window.confirm(t("Remove saved API key for {name}?", { name: item.provider }))
                    )
                      change("remove_key", item.provider);
                  }}
                >
                  {t("Remove")}
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

interface LoginEvent {
  type: string;
  id?: string;
  kind?: string;
  message?: string;
  url?: string;
  instructions?: string;
  userCode?: string;
  verificationUri?: string;
  placeholder?: string;
  options?: { id: string; label: string }[];
  links?: { url: string; label?: string }[];
}

function PiLogin({ onChanged }: { onChanged?: () => void }) {
  const [providers, setProviders] = useState<
    { id: string; name: string; credentialType: string | null }[]
  >([]);
  const [provider, setProvider] = useState("");
  const [status, setStatus] = useState<"idle" | "starting" | "waiting" | "success">("idle");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [authUrl, setAuthUrl] = useState("");
  const [infoLinks, setInfoLinks] = useState<{ url: string; label?: string }[]>([]);
  const [device, setDevice] = useState<{ code: string; url: string } | null>(null);
  const [prompt, setPrompt] = useState<LoginEvent | null>(null);
  const [answer, setAnswer] = useState("");
  const loginId = useRef<number | null>(null);
  const lastLoginId = useRef(0);
  const starting = useRef(false);
  const complete = useRef(false);
  const mounted = useRef(false);

  useEffect(() => {
    if (!native) return;
    mounted.current = true;
    let active = true;
    let unlisten: (() => void) | undefined;
    const onEvent = ({ payload }: { payload: { loginId: number; event: LoginEvent } }) => {
      if (!active) return;
      if (loginId.current !== payload.loginId) {
        if (!starting.current || loginId.current !== null || payload.loginId <= lastLoginId.current)
          return;
        loginId.current = payload.loginId;
      }
      const event = payload.event;
      if (event.type === "auth_url" && event.url) {
        setAuthUrl(event.url);
        setMessage(event.instructions ?? "");
      } else if (event.type === "device_code" && event.userCode && event.verificationUri) {
        setDevice({ code: event.userCode, url: event.verificationUri });
      } else if (event.type === "prompt") {
        setPrompt(event);
        setAnswer("");
      } else if (event.type === "progress" || event.type === "info") {
        setMessage(event.message ?? "");
        if (event.type === "info") setInfoLinks(event.links ?? []);
      } else if (event.type === "success") {
        lastLoginId.current = payload.loginId;
        complete.current = true;
        starting.current = false;
        setStatus("success");
        setPrompt(null);
        setMessage("");
        setAuthUrl("");
        setDevice(null);
        setInfoLinks([]);
        host({ op: "model_auth.sync" })
          .then(() => host<{ providers: typeof providers }>({ op: "model_auth.providers" }))
          .then((value) => {
            if (active) setProviders(value.providers);
            onChanged?.();
          })
          .catch((failure) => {
            if (active) setError(String(failure));
          });
      } else if (event.type === "error" || event.type === "cancelled") {
        lastLoginId.current = payload.loginId;
        starting.current = false;
        setStatus("idle");
        setPrompt(null);
        setMessage("");
        if (event.type === "error") setError(event.message ?? t("Pi login failed."));
      }
    };
    async function load() {
      try {
        const dispose = await listen<{ loginId: number; event: LoginEvent }>(
          "model-auth:event",
          onEvent,
        );
        if (!active) return dispose();
        unlisten = dispose;
        const value = await host<{ providers: typeof providers }>({ op: "model_auth.providers" });
        if (active) {
          setProviders(value.providers);
          setProvider(value.providers[0]?.id ?? "");
        }
      } catch (failure) {
        if (active) setError(String(failure));
      }
    }
    void load();
    return () => {
      active = false;
      mounted.current = false;
      unlisten?.();
      if (loginId.current !== null && !complete.current)
        void host({ op: "model_auth.cancel", loginId: loginId.current });
    };
  }, []);

  async function begin() {
    setError("");
    setMessage("");
    setAuthUrl("");
    setInfoLinks([]);
    setDevice(null);
    setPrompt(null);
    setStatus("starting");
    starting.current = true;
    complete.current = false;
    loginId.current = null;
    try {
      const result = await host<{ loginId: number }>({ op: "model_auth.login", provider });
      if (!mounted.current || (!starting.current && !complete.current)) {
        lastLoginId.current = result.loginId;
        await host({ op: "model_auth.cancel", loginId: result.loginId });
        return;
      }
      loginId.current = result.loginId;
      if (starting.current && !complete.current) setStatus("waiting");
    } catch (failure) {
      if (!mounted.current) return;
      starting.current = false;
      setStatus("idle");
      setError(String(failure));
    }
  }

  async function respond() {
    if (loginId.current === null || !prompt?.id || !answer) return;
    const promptId = prompt.id;
    try {
      await host({
        op: "model_auth.respond",
        loginId: loginId.current,
        promptId,
        value: answer,
      });
      setPrompt((current) => (current?.id === promptId ? null : current));
    } catch (failure) {
      setError(String(failure));
    }
  }

  async function cancel() {
    try {
      if (loginId.current !== null) {
        lastLoginId.current = loginId.current;
        await host({ op: "model_auth.cancel", loginId: loginId.current });
      }
    } catch (failure) {
      setError(String(failure));
    }
    loginId.current = null;
    starting.current = false;
    setStatus("idle");
    setPrompt(null);
    setAuthUrl("");
    setInfoLinks([]);
    setDevice(null);
  }

  function openUrl(event: React.MouseEvent<HTMLAnchorElement>, url: string) {
    if (!native) return;
    event.preventDefault();
    host({ op: "model_auth.open_url", url }).catch((failure) => setError(String(failure)));
  }

  return (
    <section className="model-method-content">
      <h2>{t("Pi login")}</h2>
      <p className="settings-note">
        {t("Sign in to a subscription or OAuth provider using Pi's own login flow.")}
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="model-login-controls">
        <label>
          {t("Provider")}
          <select
            value={provider}
            onChange={(event) => setProvider(event.target.value)}
            disabled={status === "starting" || status === "waiting"}
          >
            {providers.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <button
          className="primary"
          type="button"
          disabled={!native || !provider || status === "starting" || status === "waiting"}
          onClick={begin}
        >
          {t("Sign in with Pi")}
        </button>
        {(status === "starting" || status === "waiting") && (
          <button type="button" onClick={cancel}>
            {t("Cancel")}
          </button>
        )}
      </div>
      {status === "success" && (
        <p role="status">{t("Pi login completed. Reopen the task to use its models.")}</p>
      )}
      {message && (
        <p className="settings-note" role="status">
          {message}
        </p>
      )}
      {authUrl && (
        <div className="model-login-step">
          <strong>{t("Open authorization page")}</strong>
          <a
            href={/^https?:\/\//.test(authUrl) ? authUrl : undefined}
            target="_blank"
            rel="noreferrer"
            onClick={(event) => openUrl(event, authUrl)}
          >
            {authUrl}
          </a>
          <button
            type="button"
            onClick={() =>
              navigator.clipboard.writeText(authUrl).catch((failure) => setError(String(failure)))
            }
          >
            {t("Copy URL")}
          </button>
        </div>
      )}
      {device && (
        <div className="model-login-step">
          <strong>{t("Enter this device code")}</strong>
          <code>{device.code}</code>
          <a
            href={/^https?:\/\//.test(device.url) ? device.url : undefined}
            target="_blank"
            rel="noreferrer"
            onClick={(event) => openUrl(event, device.url)}
          >
            {device.url}
          </a>
        </div>
      )}
      {!!infoLinks.length && (
        <div className="model-login-step">
          {infoLinks.map((item) => (
            <a
              key={item.url}
              href={/^https?:\/\//.test(item.url) ? item.url : undefined}
              target="_blank"
              rel="noreferrer"
              onClick={(event) => openUrl(event, item.url)}
            >
              {item.label ?? item.url}
            </a>
          ))}
        </div>
      )}
      {prompt && (
        <form
          className="model-login-step"
          onSubmit={(event) => {
            event.preventDefault();
            respond();
          }}
        >
          <label>
            {prompt.message ?? t("Login response")}
            {prompt.kind === "select" ? (
              <select value={answer} onChange={(event) => setAnswer(event.target.value)} required>
                <option value="">{t("Choose an option")}</option>
                {prompt.options?.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
              </select>
            ) : (
              <input
                value={answer}
                onChange={(event) => setAnswer(event.target.value)}
                placeholder={prompt.placeholder}
                type={prompt.kind === "secret" ? "password" : "text"}
                required
              />
            )}
          </label>
          <button className="primary" type="submit">
            {t("Continue login")}
          </button>
        </form>
      )}
      {!!providers.length && (
        <div className="model-auth-list">
          <h3>{t("Pi login providers")}</h3>
          {providers.map((item) => (
            <div key={item.id}>
              <strong>{item.name}</strong>
              <span className="settings-note">
                {item.credentialType === "oauth" ? t("Signed in") : t("Not signed in")}
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function CustomModels({ onChanged }: { onChanged?: () => void }) {
  const [config, setConfig] = useState<Config | null>(null);
  const [selected, setSelected] = useState("");
  const [providerDraft, setProviderDraft] = useState({
    name: "",
    baseUrl: "",
    api: "openai-completions",
  });
  const [editingProvider, setEditingProvider] = useState(false);
  const [modelDraft, setModelDraft] = useState(blankModel);
  const [editingModel, setEditingModel] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [discovery, setDiscovery] = useState<{
    provider: string;
    models: DiscoveredModel[];
    truncated: boolean;
  } | null>(null);
  const [query, setQuery] = useState("");
  const [chosen, setChosen] = useState<string[]>([]);
  const provider = config?.providers.find((item) => item.name === selected);
  const found = discovery?.provider === provider?.name ? discovery : null;
  const visible =
    found?.models.filter((item) =>
      `${item.name ?? ""} ${item.id}`.toLowerCase().includes(query.toLowerCase()),
    ) ?? [];
  const available = visible.filter(
    (item) => !provider?.models.some((existing) => existing.id === item.id),
  );

  useEffect(() => {
    if (!native) return;
    let mounted = true;
    host<Config>({ op: "model_config.list" })
      .then((value) => {
        if (!mounted) return;
        setConfig(value);
        setSelected((current) => current || value.providers[0]?.name || "");
      })
      .catch((failure) => {
        if (mounted) setError(String(failure));
      });
    return () => {
      mounted = false;
    };
  }, []);

  async function change(action: string, fields: Record<string, unknown>) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const value = await host<Config>({ op: "model_config.change", action, ...fields });
      setConfig(value);
      if (action === "provider.save") setSelected(String(fields.provider));
      if (action === "provider.remove") setSelected(value.providers[0]?.name ?? "");
      setEditingProvider(false);
      setEditingModel(false);
      setModelDraft(blankModel);
      setDiscovery(null);
      onChanged?.();
    } catch (failure) {
      setError(String(failure));
    } finally {
      setBusy(false);
    }
  }

  async function discover() {
    if (!provider || busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    setDiscovery(null);
    try {
      const result = await host<{ models: DiscoveredModel[]; truncated: boolean }>({
        op: "model_config.discover",
        provider: provider.name,
      });
      setDiscovery({ provider: provider.name, ...result });
      setQuery("");
      setChosen([]);
    } catch (failure) {
      setError(String(failure));
    } finally {
      setBusy(false);
    }
  }

  async function importModels() {
    if (!found || !chosen.length || busy) return;
    setBusy(true);
    setError("");
    const models = found.models.filter((item) => chosen.includes(item.id));
    try {
      const value = await host<Config>({
        op: "model_config.change",
        action: "model.import",
        provider: found.provider,
        models,
      });
      setConfig(value);
      setDiscovery(null);
      setChosen([]);
      setNotice(t("Models added: {count}", { count: value.imported ?? models.length }));
      onChanged?.();
    } catch (failure) {
      setError(String(failure));
    } finally {
      setBusy(false);
    }
  }

  function editProvider(item?: Provider) {
    setProviderDraft({
      name: item?.name ?? "",
      baseUrl: item?.baseUrl ?? "",
      api: item?.api ?? "openai-completions",
    });
    setEditingProvider(true);
    setEditingModel(false);
  }

  function editModel(item?: CustomModel) {
    setModelDraft({
      id: item?.id ?? "",
      name: item?.name ?? "",
      reasoning: item?.reasoning ?? false,
      image: item?.input?.includes("image") ?? false,
      contextWindow: item?.contextWindow?.toString() ?? "",
      maxTokens: item?.maxTokens?.toString() ?? "",
    });
    setEditingModel(true);
    setEditingProvider(false);
  }

  return (
    <section className="model-settings">
      <div className="model-settings-heading">
        <div>
          <h2>{t("Custom Pi models")}</h2>
          <p className="settings-note">
            {t(
              "Manage custom providers and models in Pi's models.json. Use API key or Pi login to connect them.",
            )}
          </p>
          <p className="settings-note">{t("Reopen a task to refresh its available models.")}</p>
          {config && <code className="model-config-path">{config.path}</code>}
        </div>
        <button type="button" disabled={!native || busy} onClick={() => editProvider()}>
          {t("Add provider")}
        </button>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {!native && (
        <p className="settings-note">{t("Model configuration requires the desktop app.")}</p>
      )}
      {native && !config && !error && <p className="settings-note">{t("Loading…")}</p>}
      {editingProvider && (
        <form
          className="model-config-form"
          onSubmit={(event) => {
            event.preventDefault();
            change("provider.save", {
              provider: providerDraft.name,
              baseUrl: providerDraft.baseUrl,
              api: providerDraft.api,
            });
          }}
        >
          <h3>{t("Provider details")}</h3>
          <label>
            {t("Provider ID")}
            <input
              value={providerDraft.name}
              disabled={config?.providers.some((item) => item.name === providerDraft.name)}
              onChange={(event) => setProviderDraft({ ...providerDraft, name: event.target.value })}
              required
            />
          </label>
          <label>
            {t("Base URL")}
            <input
              type="url"
              value={providerDraft.baseUrl}
              onChange={(event) =>
                setProviderDraft({ ...providerDraft, baseUrl: event.target.value })
              }
              placeholder="http://localhost:11434/v1"
              required
            />
          </label>
          <label>
            {t("API type")}
            <select
              value={providerDraft.api}
              onChange={(event) => setProviderDraft({ ...providerDraft, api: event.target.value })}
            >
              <option value="openai-completions">OpenAI Completions</option>
              <option value="openai-responses">OpenAI Responses</option>
              <option value="anthropic-messages">Anthropic Messages</option>
              <option value="google-generative-ai">Google Generative AI</option>
            </select>
          </label>
          <p className="settings-note">
            {t(
              "Local endpoints receive a placeholder key. Remote endpoints use your existing Pi authentication.",
            )}
          </p>
          <div className="button-row">
            <button className="primary" type="submit" disabled={busy}>
              {t("Save provider")}
            </button>
            <button type="button" onClick={() => setEditingProvider(false)}>
              {t("Cancel")}
            </button>
          </div>
        </form>
      )}
      {config && config.providers.length === 0 && !editingProvider && (
        <p className="settings-note">{t("No custom providers configured.")}</p>
      )}
      {config && config.providers.length > 0 && (
        <div className="model-config-layout">
          <nav className="model-provider-list" aria-label={t("Custom providers")}>
            {config.providers.map((item) => (
              <button
                key={item.name}
                type="button"
                className={item.name === selected ? "selected" : ""}
                onClick={() => {
                  setSelected(item.name);
                  setEditingModel(false);
                  setEditingProvider(false);
                  setDiscovery(null);
                  setNotice("");
                }}
              >
                <span>{item.name}</span>
                <small>{t("Models: {count}", { count: item.models.length })}</small>
              </button>
            ))}
          </nav>
          {provider && (
            <div className="model-provider-detail">
              <div className="model-provider-title">
                <div>
                  <h3>{provider.name}</h3>
                  <p className="settings-note">
                    {provider.api || t("API set per model")} ·{" "}
                    {provider.baseUrl || t("Built-in endpoint")}
                  </p>
                </div>
                <div className="button-row">
                  <button type="button" disabled={busy} onClick={() => editProvider(provider)}>
                    {t("Edit")}
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      if (
                        window.confirm(
                          t("Remove provider {name} and its models?", { name: provider.name }),
                        )
                      )
                        change("provider.remove", { provider: provider.name });
                    }}
                  >
                    {t("Remove")}
                  </button>
                </div>
              </div>
              {provider.hasAdvancedSettings && (
                <p className="settings-note">
                  {t("Advanced Pi fields are preserved when you save changes here.")}
                </p>
              )}
              <div className="model-discovery-actions button-row">
                <button className="primary" type="button" disabled={busy} onClick={discover}>
                  {busy ? t("Loading…") : t("Fetch model list")}
                </button>
                <button type="button" disabled={busy} onClick={() => editModel()}>
                  {t("Add model")}
                </button>
              </div>
              {found && (
                <div className="model-discovery">
                  <div className="model-discovery-heading">
                    <h4>{t("{count} models found", { count: found.models.length })}</h4>
                    <button type="button" onClick={() => setDiscovery(null)}>
                      {t("Close")}
                    </button>
                  </div>
                  {found.models.length > 0 ? (
                    <>
                      <label className="model-discovery-search">
                        {t("Search available models")}
                        <input value={query} onChange={(event) => setQuery(event.target.value)} />
                      </label>
                      <p className="settings-note">
                        {t("Select chat models to add. Existing model settings will be preserved.")}
                      </p>
                      <div className="model-discovery-list">
                        {visible.map((item) => {
                          const added = provider.models.some((existing) => existing.id === item.id);
                          return (
                            <label key={item.id}>
                              <input
                                type="checkbox"
                                checked={added || chosen.includes(item.id)}
                                disabled={added || busy}
                                onChange={(event) =>
                                  setChosen((current) =>
                                    event.target.checked
                                      ? [...current, item.id]
                                      : current.filter((id) => id !== item.id),
                                  )
                                }
                              />
                              <span>
                                <strong>{item.name || item.id}</strong>
                                {item.name && <small>{item.id}</small>}
                              </span>
                              {added && <small>{t("Already added")}</small>}
                            </label>
                          );
                        })}
                        {visible.length === 0 && (
                          <p className="settings-note">{t("No models match your search.")}</p>
                        )}
                      </div>
                      <div className="button-row">
                        <button
                          type="button"
                          disabled={available.length === 0 || busy}
                          onClick={() =>
                            setChosen((current) => [
                              ...new Set([...current, ...available.map((item) => item.id)]),
                            ])
                          }
                        >
                          {t("Select shown")}
                        </button>
                        <button
                          type="button"
                          disabled={!chosen.length || busy}
                          onClick={() => setChosen([])}
                        >
                          {t("Clear selection")}
                        </button>
                        <button
                          className="primary"
                          type="button"
                          disabled={!chosen.length || busy}
                          onClick={importModels}
                        >
                          {t("Add selected models ({count})", { count: chosen.length })}
                        </button>
                      </div>
                      {found.truncated && (
                        <p className="settings-note">
                          {t("More models are available; only the first page is shown.")}
                        </p>
                      )}
                    </>
                  ) : (
                    <p className="settings-note">
                      {t("No models returned by this endpoint. You can add one manually.")}
                    </p>
                  )}
                </div>
              )}
              <div className="model-list">
                {provider.models.map((item) => (
                  <article key={item.id}>
                    <div>
                      <strong>{item.name || item.id}</strong>
                      <small>{item.id}</small>
                    </div>
                    <div className="button-row">
                      <button type="button" disabled={busy} onClick={() => editModel(item)}>
                        {t("Edit")}
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => {
                          if (window.confirm(t("Remove model {id}?", { id: item.id })))
                            change("model.remove", { provider: provider.name, id: item.id });
                        }}
                      >
                        {t("Remove")}
                      </button>
                    </div>
                  </article>
                ))}
              </div>
              {editingModel && (
                <form
                  className="model-config-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    change("model.save", {
                      provider: provider.name,
                      ...modelDraft,
                      contextWindow: modelDraft.contextWindow
                        ? Number(modelDraft.contextWindow)
                        : null,
                      maxTokens: modelDraft.maxTokens ? Number(modelDraft.maxTokens) : null,
                    });
                  }}
                >
                  <h3>{t("Model details")}</h3>
                  <label>
                    {t("Model ID")}
                    <input
                      value={modelDraft.id}
                      disabled={provider.models.some((item) => item.id === modelDraft.id)}
                      onChange={(event) => setModelDraft({ ...modelDraft, id: event.target.value })}
                      required
                    />
                  </label>
                  <label>
                    {t("Display name")}
                    <input
                      value={modelDraft.name}
                      onChange={(event) =>
                        setModelDraft({ ...modelDraft, name: event.target.value })
                      }
                    />
                  </label>
                  <div className="model-token-fields">
                    <label>
                      {t("Context window")}
                      <input
                        type="number"
                        min="1"
                        step="1"
                        value={modelDraft.contextWindow}
                        onChange={(event) =>
                          setModelDraft({ ...modelDraft, contextWindow: event.target.value })
                        }
                      />
                    </label>
                    <label>
                      {t("Max output tokens")}
                      <input
                        type="number"
                        min="1"
                        step="1"
                        value={modelDraft.maxTokens}
                        onChange={(event) =>
                          setModelDraft({ ...modelDraft, maxTokens: event.target.value })
                        }
                      />
                    </label>
                  </div>
                  <label className="model-checkbox">
                    <input
                      type="checkbox"
                      checked={modelDraft.reasoning}
                      onChange={(event) =>
                        setModelDraft({ ...modelDraft, reasoning: event.target.checked })
                      }
                    />
                    {t("Supports reasoning")}
                  </label>
                  <label className="model-checkbox">
                    <input
                      type="checkbox"
                      checked={modelDraft.image}
                      onChange={(event) =>
                        setModelDraft({ ...modelDraft, image: event.target.checked })
                      }
                    />
                    {t("Supports image input")}
                  </label>
                  <div className="button-row">
                    <button className="primary" type="submit" disabled={busy}>
                      {t("Save model")}
                    </button>
                    <button type="button" onClick={() => setEditingModel(false)}>
                      {t("Cancel")}
                    </button>
                  </div>
                </form>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
