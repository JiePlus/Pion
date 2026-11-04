import { useEffect, useState } from "react";
import { host, native } from "../../core/host.ts";
import { t } from "../../core/i18n.ts";
import { Icon } from "../primitives/Icon.tsx";
import { PiLogin } from "./PiLogin.tsx";
import { DiscoveryDialog, EndpointDialog } from "./ModelCatalogDialogs.tsx";
import { blankModel } from "./modelTypes.ts";
import type {
  Config,
  CustomModel,
  DetectedService,
  DiscoveredModel,
  LocalScan,
  Provider,
} from "./modelTypes.ts";
import styles from "./ModelCatalog.module.css";

interface Credential {
  provider: string;
  type: string;
}
interface RuntimeModel {
  provider: string;
  id: string;
  name?: string;
}
interface ModelCatalogProps {
  onChanged?: () => void;
  models?: RuntimeModel[];
  selectedModel?: { provider: string; id: string } | null;
  runtimeVersion?: string;
  addProviderRequest?: number;
}

const builtIns = [
  {
    id: "openai",
    name: "OpenAI",
    mark: "OA",
    env: "OPENAI_API_KEY",
    endpoint: "api.openai.com/v1",
  },
  {
    id: "anthropic",
    name: "Anthropic",
    mark: "AN",
    env: "ANTHROPIC_API_KEY",
    endpoint: "api.anthropic.com",
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    mark: "DS",
    env: "DEEPSEEK_API_KEY",
    endpoint: "api.deepseek.com",
  },
];
type Filter = "all" | "connected" | "local";

export function ModelCatalog({
  onChanged,
  models = [],
  selectedModel,
  runtimeVersion,
  addProviderRequest = 0,
}: ModelCatalogProps) {
  const [config, setConfig] = useState<Config | null>(null);
  const [credentials, setCredentials] = useState<Credential[]>([]);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [expanded, setExpanded] = useState("");
  const [authMode, setAuthMode] = useState<"key" | "environment" | "login">("key");
  const [key, setKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [providerDraft, setProviderDraft] = useState({
    name: "",
    baseUrl: "",
    api: "openai-completions",
  });
  const [editingProvider, setEditingProvider] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [endpointKey, setEndpointKey] = useState("");
  const [probe, setProbe] = useState("");
  const [newProviderMode, setNewProviderMode] = useState<"endpoint" | "key">("endpoint");
  const [otherProvider, setOtherProvider] = useState("");
  const [editingModel, setEditingModel] = useState(false);
  const [editingExistingModel, setEditingExistingModel] = useState(false);
  const [modelDraft, setModelDraft] = useState(blankModel);
  const [discovery, setDiscovery] = useState<{
    provider: string;
    models: DiscoveredModel[];
    truncated: boolean;
    latencyMs?: number;
  } | null>(null);
  const [discoveryQuery, setDiscoveryQuery] = useState("");
  const [discoveryError, setDiscoveryError] = useState("");
  const [chosen, setChosen] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [localScan, setLocalScan] = useState<LocalScan>({ status: "idle", services: [] });

  useEffect(() => {
    setKey("");
    setShowKey(false);
  }, [expanded]);

  useEffect(() => {
    setProbe("");
  }, [providerDraft.baseUrl, providerDraft.api, endpointKey]);

  useEffect(() => {
    if (!addProviderRequest) return;
    setProviderDraft({ name: "", baseUrl: "", api: "openai-completions" });
    setEndpointKey("");
    setProbe("");
    setAddOpen(true);
    setNewProviderMode("endpoint");
  }, [addProviderRequest]);

  useEffect(() => {
    if (!native) return;
    let live = true;
    async function load() {
      try {
        const auth = await host<{ providers: Credential[] }>({ op: "model_auth.list" });
        const next = await host<Config>({ op: "model_config.list" });
        if (!live) return;
        setCredentials(auth.providers);
        setConfig(next);
      } catch (failure) {
        if (live) setError(String(failure));
      }
    }
    void load();
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    void scanLocal();
    // Auto-scan local model services once when the page opens.
  }, []);

  async function refresh() {
    const auth = await host<{ providers: Credential[] }>({ op: "model_auth.list" });
    const next = await host<Config>({ op: "model_config.list" });
    setCredentials(auth.providers);
    setConfig(next);
    onChanged?.();
  }

  async function scanLocal() {
    if (!native) return;
    setLocalScan((current) => ({ ...current, status: "scanning", error: undefined }));
    try {
      const result = await host<{ services: DetectedService[] }>({ op: "model_config.scan" });
      setLocalScan({ status: "done", services: result.services ?? [] });
    } catch (failure) {
      setLocalScan({ status: "error", services: [], error: String(failure) });
    }
  }

  async function submit(request: Record<string, unknown>, success: string) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await host(request);
      await refresh();
      setKey("");
      setEditingProvider(false);
      setEditingModel(false);
      setDiscovery(null);
      if (request.action === "provider.save") setExpanded(String(request.provider));
      if (request.action === "save_key") setExpanded(String(request.provider));
      setNotice(success);
    } catch (failure) {
      setError(String(failure));
    } finally {
      setBusy(false);
    }
  }

  async function discover(provider: Provider) {
    setBusy(true);
    setError("");
    setDiscoveryError("");
    try {
      const result = await host<{
        models: DiscoveredModel[];
        truncated: boolean;
        latencyMs?: number;
      }>({
        op: "model_config.discover",
        provider: provider.name,
      });
      setDiscovery({ provider: provider.name, ...result });
      setDiscoveryQuery("");
      setChosen([]);
    } catch (failure) {
      setError(String(failure));
      setDiscoveryError(String(failure));
    } finally {
      setBusy(false);
    }
  }

  async function testEndpoint() {
    setBusy(true);
    setError("");
    setProbe("");
    try {
      const result = await host<{ latencyMs: number }>({
        op: "model_config.probe",
        baseUrl: providerDraft.baseUrl,
        api: providerDraft.api,
        key: endpointKey,
      });
      setProbe(`● 200 OK (${result.latencyMs}ms)`);
    } catch (failure) {
      setProbe(String(failure));
    } finally {
      setBusy(false);
    }
  }

  async function saveEndpoint() {
    setBusy(true);
    setError("");
    try {
      await host({
        op: "model_config.change",
        action: "provider.save",
        provider: providerDraft.name,
        baseUrl: providerDraft.baseUrl,
        api: providerDraft.api,
      });
      if (endpointKey) {
        await host({
          op: "model_auth.change",
          action: "save_key",
          provider: providerDraft.name,
          key: endpointKey,
        });
      }
      await refresh();
      setExpanded(providerDraft.name);
      setAddOpen(false);
      setEndpointKey("");
      setNotice(t("Provider saved. You can now add models."));
    } catch (failure) {
      setError(String(failure));
      setProbe(String(failure));
    } finally {
      setBusy(false);
    }
  }

  async function saveKeyOnly() {
    setBusy(true);
    setProbe("");
    try {
      await host({
        op: "model_auth.change",
        action: "save_key",
        provider: otherProvider,
        key: endpointKey,
      });
      await refresh();
      setAddOpen(false);
      setEndpointKey("");
      setExpanded(otherProvider);
      setNotice(t("API key saved. Reopen tasks to apply changes."));
    } catch (failure) {
      setProbe(String(failure));
    } finally {
      setBusy(false);
    }
  }

  function openProvider(provider?: Provider, local = false) {
    setProviderDraft({
      name: provider?.name ?? (local ? "ollama-local" : ""),
      baseUrl: provider?.baseUrl ?? (local ? "http://localhost:11434/v1" : ""),
      api: provider?.api ?? "openai-completions",
    });
    setEditingProvider(!!provider);
    setNewProviderMode("endpoint");
    setEditingModel(false);
    if (provider) setExpanded(provider.name);
    else {
      setEndpointKey("");
      setProbe("");
      setAddOpen(true);
    }
  }

  function openDetected(service: DetectedService) {
    setProviderDraft({ name: service.name, baseUrl: service.baseUrl, api: service.api });
    setEditingProvider(false);
    setNewProviderMode("endpoint");
    setEditingModel(false);
    setEndpointKey("");
    setProbe("");
    setAddOpen(true);
  }

  function openModel(provider: Provider, model?: CustomModel) {
    setExpanded(provider.name);
    setModelDraft({
      id: model?.id ?? "",
      name: model?.name ?? "",
      reasoning: model?.reasoning ?? false,
      image: model?.input?.includes("image") ?? false,
      contextWindow: model?.contextWindow?.toString() ?? "",
      maxTokens: model?.maxTokens?.toString() ?? "",
    });
    setEditingModel(true);
    setEditingExistingModel(!!model);
    setEditingProvider(false);
  }

  const custom = config?.providers ?? [];
  const providerCards = [
    ...builtIns.filter((provider) => !custom.some((item) => item.name === provider.id)),
    ...credentials
      .filter(
        (item) =>
          item.type === "api_key" &&
          !builtIns.some((provider) => provider.id === item.provider) &&
          !custom.some((provider) => provider.name === item.provider),
      )
      .map((item) => ({
        id: item.provider,
        name: item.provider,
        mark: item.provider.slice(0, 2).toUpperCase(),
        env: "",
        endpoint: "",
      })),
  ];
  const localCount = custom.filter((provider) =>
    /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::|\/)/.test(provider.baseUrl ?? ""),
  ).length;
  const connectedCount =
    providerCards.filter((provider) =>
      credentials.some(
        (item) =>
          item.provider === provider.id ||
          (provider.id === "openai" && item.provider === "openai-codex"),
      ),
    ).length + custom.length;
  const visibleBuiltIns = providerCards.filter(
    (provider) =>
      `${provider.name} ${provider.id} ${models
        .filter((model) => model.provider === provider.id)
        .map((model) => model.id)
        .join(" ")}`
        .toLowerCase()
        .includes(query.toLowerCase()) &&
      (filter === "all" ||
        (filter === "connected" &&
          credentials.some(
            (item) =>
              item.provider === provider.id ||
              (provider.id === "openai" && item.provider === "openai-codex"),
          ))),
  );
  const visibleCustom = custom.filter(
    (provider) =>
      `${provider.name} ${provider.baseUrl ?? ""} ${provider.models.map((model) => model.id).join(" ")}`
        .toLowerCase()
        .includes(query.toLowerCase()) &&
      (filter !== "local" ||
        /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::|\/)/.test(provider.baseUrl ?? "")),
  );
  const found = discovery && custom.find((provider) => provider.name === discovery.provider);

  return (
    <div className={styles.catalog}>
      <header className={styles.heading}>
        <div className={styles.titleLine}>
          <h1>{t("Model services")}</h1>
          <span className={styles.english}>/ Models</span>
          {runtimeVersion && <span className={styles.version}>Pi {runtimeVersion}</span>}
        </div>
        <p>
          {t(
            "Manage local and cloud models in one place. Reopen tasks after saving configuration.",
          )}
        </p>
      </header>
      <div className={styles.toolbar}>
        <label className={styles.search}>
          <Icon name="search" size={17} />
          <span className="sr-only">{t("Search providers or models")}</span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("Search providers or models (e.g. gpt-4o, qwen, deepseek)...")}
          />
        </label>
        <div className={styles.filters} role="group" aria-label={t("Filter model services")}>
          <button
            className={filter === "all" ? styles.active : ""}
            aria-pressed={filter === "all"}
            onClick={() => setFilter("all")}
          >
            {t("All")} <span>{providerCards.length + custom.length + (localCount ? 0 : 1)}</span>
          </button>
          <button
            className={filter === "connected" ? styles.active : ""}
            aria-pressed={filter === "connected"}
            onClick={() => setFilter("connected")}
          >
            {t("Connected")} <span>{connectedCount}</span>
          </button>
          <button
            className={filter === "local" ? styles.active : ""}
            aria-pressed={filter === "local"}
            onClick={() => setFilter("local")}
          >
            {t("Local offline")} <span>{localCount}</span>
          </button>
        </div>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className={styles.notice} role="status">
          {notice}
        </p>
      )}
      {!native && (
        <p className={styles.notice}>{t("Model configuration requires the desktop app.")}</p>
      )}
      <div className={styles.cards}>
        {visibleBuiltIns.map((provider) => {
          const credential = credentials.find(
            (item) =>
              item.provider === provider.id ||
              (provider.id === "openai" && item.provider === "openai-codex"),
          );
          const active = expanded === provider.id;
          const providerModels = models.filter((model) => model.provider === provider.id);
          return (
            <section
              key={provider.id}
              className={`${styles.card} ${active ? styles.expanded : ""}`}
            >
              <div className={styles.cardHeader}>
                <span className={`${styles.mark} ${styles[provider.id]}`}>{provider.mark}</span>
                <div className={styles.cardIdentity}>
                  <div className={styles.cardName}>
                    <strong>{provider.name}</strong>
                    <span className={credential ? styles.connected : styles.pending}>
                      {credential ? t("Connected") : t("Needs setup")}
                    </span>
                  </div>
                  <p>
                    {credential
                      ? t("Credential: {method}", {
                          method:
                            credential.type === "api_key"
                              ? t("API key saved")
                              : t("Pi login authorization"),
                        })
                      : provider.env
                        ? t("Supports API key or environment variable {name}", {
                            name: provider.env,
                          })
                        : t(
                            "Save a provider API key in Pi's auth.json. Existing keys and OAuth tokens are never shown here.",
                          )}
                  </p>
                </div>
                <button
                  className={styles.iconAction}
                  type="button"
                  aria-label={t("Configure {name}", { name: provider.name })}
                  aria-expanded={active}
                  onClick={() => {
                    setExpanded(active ? "" : provider.id);
                    setAuthMode(credential?.type === "oauth" ? "login" : "key");
                    setError("");
                  }}
                >
                  <Icon name="settings" size={17} />
                </button>
                <button
                  className={`${styles.switch} ${credential ? styles.on : ""}`}
                  type="button"
                  aria-expanded={active}
                  aria-label={t(
                    active ? "Collapse {name} configuration" : "Expand {name} configuration",
                    { name: provider.name },
                  )}
                  onClick={() => {
                    setExpanded(active ? "" : provider.id);
                    setAuthMode(credential?.type === "oauth" ? "login" : "key");
                  }}
                >
                  <span />
                </button>
              </div>
              {!active && (
                <div className={styles.modelStrip}>
                  <span>{t("Available models:")}</span>
                  {providerModels.length ? (
                    providerModels.slice(0, 4).map((model) => (
                      <span className={styles.modelChip} key={model.id}>
                        {model.id}
                        {selectedModel?.provider === provider.id &&
                          selectedModel.id === model.id && <em>{t("Default model")}</em>}
                      </span>
                    ))
                  ) : (
                    <span className={styles.muted}>
                      {t("Pi provides the model list after connection")}
                    </span>
                  )}
                  {provider.endpoint && <small>{provider.endpoint}</small>}
                </div>
              )}
              {active && (
                <div className={styles.authPanel}>
                  <div className={styles.authOptions}>
                    <label>
                      <input
                        type="radio"
                        checked={authMode === "key"}
                        onChange={() => setAuthMode("key")}
                      />
                      {t("API key entry")}
                    </label>
                    {provider.env && (
                      <label>
                        <input
                          type="radio"
                          checked={authMode === "environment"}
                          onChange={() => setAuthMode("environment")}
                        />
                        {t("Environment variable")} <code>${provider.env}</code>
                      </label>
                    )}
                    {provider.id === "openai" && (
                      <label>
                        <input
                          type="radio"
                          checked={authMode === "login"}
                          onChange={() => setAuthMode("login")}
                        />
                        {t("Pi login")}
                      </label>
                    )}
                    {provider.endpoint && (
                      <code className={styles.endpoint}>{provider.endpoint}</code>
                    )}
                  </div>
                  {authMode === "key" && (
                    <form
                      className={styles.keyForm}
                      onSubmit={(event) => {
                        event.preventDefault();
                        void submit(
                          {
                            op: "model_auth.change",
                            action: "save_key",
                            provider: provider.id,
                            key,
                          },
                          t("API key saved. Reopen tasks to apply changes."),
                        );
                      }}
                    >
                      <div className={styles.keyInput}>
                        <input
                          type={showKey ? "text" : "password"}
                          autoComplete="new-password"
                          aria-label={`${provider.name} API Key`}
                          value={key}
                          onChange={(event) => setKey(event.target.value)}
                          placeholder={
                            credential?.type === "api_key"
                              ? t("Saved key. Enter a new key to replace it")
                              : t("Enter API key")
                          }
                          required
                        />
                        <button type="button" onClick={() => setShowKey(!showKey)}>
                          {showKey ? t("Hide") : t("Show")}
                        </button>
                      </div>
                      <button className={styles.primary} type="submit" disabled={!native || busy}>
                        ✓ {t("Save and connect")}
                      </button>
                      {credential?.type === "api_key" && (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => {
                            if (
                              window.confirm(t("Remove {name} API key?", { name: provider.name }))
                            )
                              void submit(
                                {
                                  op: "model_auth.change",
                                  action: "remove_key",
                                  provider: provider.id,
                                },
                                t("API key removed."),
                              );
                          }}
                        >
                          {t("Remove key")}
                        </button>
                      )}
                    </form>
                  )}
                  {authMode === "environment" && (
                    <p className={styles.help}>
                      {t(
                        "Set {name} before launching Pion. Environment variables set only in a terminal may not be inherited when launching from Finder.",
                        { name: provider.env },
                      )}
                    </p>
                  )}
                  {authMode === "login" && (
                    <div className={styles.login}>
                      <PiLogin
                        onChanged={() => {
                          void refresh();
                        }}
                      />
                    </div>
                  )}
                </div>
              )}
            </section>
          );
        })}
        {visibleCustom.map((provider) => {
          const active = expanded === provider.name;
          const local = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::|\/)/.test(
            provider.baseUrl ?? "",
          );
          return (
            <section
              className={`${styles.card} ${active ? styles.expanded : ""}`}
              key={provider.name}
            >
              <div className={styles.cardHeader}>
                <span className={`${styles.mark} ${local ? styles.ollama : styles.customMark}`}>
                  {local ? "OL" : "API"}
                </span>
                <div className={styles.cardIdentity}>
                  <div className={styles.cardName}>
                    <strong>{provider.name}</strong>
                    <span className={styles.connected}>{t("Configured")}</span>
                    <code>{provider.baseUrl}</code>
                  </div>
                  <p>
                    {local
                      ? t("Local model endpoint · offline requests")
                      : t("Custom model endpoint")}
                  </p>
                </div>
                <button
                  type="button"
                  className={styles.secondary}
                  disabled={busy}
                  onClick={() => void discover(provider)}
                >
                  ⟳ {t("Fetch model list")}
                </button>
                <button
                  type="button"
                  className={styles.secondary}
                  disabled={busy}
                  onClick={() => openModel(provider)}
                >
                  ＋ {t("Add model")}
                </button>
                <button
                  className={styles.iconAction}
                  type="button"
                  aria-label={t("Edit provider") + ` ${provider.name}`}
                  onClick={() => openProvider(provider)}
                >
                  <Icon name="settings" size={17} />
                </button>
                <button
                  className={`${styles.switch} ${styles.on}`}
                  type="button"
                  aria-expanded={active}
                  aria-label={t(
                    active ? "Collapse {name} configuration" : "Expand {name} configuration",
                    { name: provider.name },
                  )}
                  onClick={() => setExpanded(active ? "" : provider.name)}
                >
                  <span />
                </button>
              </div>
              <div className={styles.modelStrip}>
                <span>{t("Configured models:")}</span>
                {provider.models.map((model) => (
                  <button
                    className={`${styles.modelChip} ${editingModel && expanded === provider.name && modelDraft.id === model.id ? styles.editing : ""}`}
                    key={model.id}
                    type="button"
                    onClick={() => openModel(provider, model)}
                  >
                    {model.id}
                    {selectedModel?.provider === provider.name && selectedModel.id === model.id && (
                      <em>{t("Default model")}</em>
                    )}
                  </button>
                ))}
                {!provider.models.length && (
                  <span className={styles.muted}>{t("No models added yet")}</span>
                )}
                <small>{t("Click a model tag to edit its configuration")}</small>
              </div>
              {active && (
                <div className={styles.customPanel}>
                  <div className={styles.panelHeading}>
                    <strong>{t("Model configuration details")}</strong>
                    <code>
                      {provider.name}
                      {editingModel && modelDraft.id ? ` / ${modelDraft.id}` : ""}
                    </code>
                    <span className={styles.connected}>{t("Configuring")}</span>
                  </div>
                  {provider.hasAdvancedSettings && (
                    <p className={styles.help}>
                      {t("Advanced Pi fields are preserved when saving.")}
                    </p>
                  )}
                  {editingProvider && (
                    <ProviderForm
                      draft={providerDraft}
                      setDraft={setProviderDraft}
                      busy={busy}
                      existing
                      onCancel={() => setEditingProvider(false)}
                      onSave={() =>
                        void submit(
                          {
                            op: "model_config.change",
                            action: "provider.save",
                            provider: providerDraft.name,
                            baseUrl: providerDraft.baseUrl,
                            api: providerDraft.api,
                          },
                          t("Provider saved. Reopen tasks to apply changes."),
                        )
                      }
                    />
                  )}
                  {editingModel && (
                    <ModelForm
                      draft={modelDraft}
                      setDraft={setModelDraft}
                      busy={busy}
                      existing={editingExistingModel}
                      onCancel={() => setEditingModel(false)}
                      onRemove={() => {
                        if (window.confirm(t("Remove model {id}?", { id: modelDraft.id })))
                          void submit(
                            {
                              op: "model_config.change",
                              action: "model.remove",
                              provider: provider.name,
                              id: modelDraft.id,
                            },
                            t("Model removed."),
                          );
                      }}
                      onSave={() =>
                        void submit(
                          {
                            op: "model_config.change",
                            action: "model.save",
                            provider: provider.name,
                            ...modelDraft,
                            contextWindow: modelDraft.contextWindow
                              ? Number(modelDraft.contextWindow)
                              : null,
                            maxTokens: modelDraft.maxTokens ? Number(modelDraft.maxTokens) : null,
                          },
                          t("Model saved. Reopen tasks to apply changes."),
                        )
                      }
                    />
                  )}
                  {!editingProvider && !editingModel && (
                    <div className={styles.panelActions}>
                      <button type="button" onClick={() => openProvider(provider)}>
                        {t("Edit provider")}
                      </button>
                      <button type="button" onClick={() => openModel(provider)}>
                        {t("Add model")}
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
                            void submit(
                              {
                                op: "model_config.change",
                                action: "provider.remove",
                                provider: provider.name,
                              },
                              t("Provider removed."),
                            );
                        }}
                      >
                        {t("Remove provider")}
                      </button>
                    </div>
                  )}
                  {!local && (
                    <form
                      className={styles.customKeyForm}
                      onSubmit={(event) => {
                        event.preventDefault();
                        void submit(
                          {
                            op: "model_auth.change",
                            action: "save_key",
                            provider: provider.name,
                            key,
                          },
                          t("API key saved. Reopen tasks to apply changes."),
                        );
                      }}
                    >
                      <label>
                        {credentials.some((item) => item.provider === provider.name)
                          ? t("Update API key")
                          : t("Connect API key")}
                        <input
                          type="password"
                          autoComplete="new-password"
                          value={key}
                          onChange={(event) => setKey(event.target.value)}
                          required
                        />
                      </label>
                      <button type="submit" disabled={!native || busy}>
                        {t("Save key")}
                      </button>
                      {credentials.some(
                        (item) => item.provider === provider.name && item.type === "api_key",
                      ) && (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => {
                            if (
                              window.confirm(t("Remove {name} API key?", { name: provider.name }))
                            )
                              void submit(
                                {
                                  op: "model_auth.change",
                                  action: "remove_key",
                                  provider: provider.name,
                                },
                                t("API key removed."),
                              );
                          }}
                        >
                          {t("Remove key")}
                        </button>
                      )}
                    </form>
                  )}
                </div>
              )}
            </section>
          );
        })}
        {filter !== "connected" && !query.trim() && (
          <section className={styles.localScan} aria-label={t("Local services")}>
            <div className={styles.localScanHead}>
              <div>
                <strong>{t("Local services")}</strong>
                <small>
                  {localScan.status === "scanning"
                    ? t("Scanning local services…")
                    : t("Detected automatically on common local ports")}
                </small>
              </div>
              <button
                type="button"
                className={styles.secondary}
                disabled={localScan.status === "scanning" || !native}
                onClick={() => void scanLocal()}
              >
                ⟳ {t("Scan again")}
              </button>
            </div>
            {localScan.status === "error" && (
              <p className={styles.help}>
                {t("Scan failed: {error}", { error: localScan.error ?? "" })}
              </p>
            )}
            {localScan.status === "done" && localScan.services.length === 0 && (
              <p className={styles.help}>
                {t("No local model service detected. Add a custom endpoint manually below.")}
              </p>
            )}
            {!!localScan.services.length && (
              <div className={styles.localScanList}>
                {localScan.services.map((service) => (
                  <button
                    key={service.name}
                    type="button"
                    className={styles.localService}
                    onClick={() => openDetected(service)}
                  >
                    <span className={`${styles.mark} ${styles.ollama}`}>OL</span>
                    <span>
                      <strong>{service.label}</strong>
                      <small>{service.baseUrl.replace(/^https?:\/\//, "")}</small>
                    </span>
                    <span className={styles.serviceMeta}>
                      {service.modelCount
                        ? t(service.modelCount === 1 ? "{count} model" : "{count} models", {
                            count: service.modelCount,
                          })
                        : t("Endpoint reachable")}
                    </span>
                    <span className={styles.promptArrow}>{t("Connect")} →</span>
                  </button>
                ))}
              </div>
            )}
          </section>
        )}
        {filter === "all" && (
          <button className={styles.addPrompt} type="button" onClick={() => openProvider()}>
            <span className={styles.plus}>
              <Icon name="plus" size={18} />
            </span>
            <strong>{t("Add custom endpoint / private gateway")}</strong>
            <span>{t("Supports OpenAI format, vLLM, LM Studio, and private gateways")}</span>
            <small>{t("Quick setup")} →</small>
          </button>
        )}
        {!visibleBuiltIns.length && !visibleCustom.length && (
          <p className={styles.empty}>{t("No matching providers or models.")}</p>
        )}
      </div>
      {addOpen && (
        <EndpointDialog
          draft={providerDraft}
          setDraft={setProviderDraft}
          apiKey={endpointKey}
          setApiKey={setEndpointKey}
          mode={newProviderMode}
          setMode={setNewProviderMode}
          keyProvider={otherProvider}
          setKeyProvider={setOtherProvider}
          busy={busy || !native}
          probe={probe}
          serviceScan={localScan}
          onRescan={() => void scanLocal()}
          onProbe={() => void testEndpoint()}
          onSave={() => void saveEndpoint()}
          onSaveKey={() => void saveKeyOnly()}
          onClose={() => setAddOpen(false)}
        />
      )}
      {discovery && found && (
        <DiscoveryDialog
          found={discovery}
          provider={found}
          query={discoveryQuery}
          setQuery={setDiscoveryQuery}
          chosen={chosen}
          setChosen={setChosen}
          error={discoveryError}
          busy={busy}
          onRefresh={() => void discover(found)}
          onImport={() =>
            void submit(
              {
                op: "model_config.change",
                action: "model.import",
                provider: found.name,
                models: discovery.models.filter((item) => chosen.includes(item.id)),
              },
              t("Selected models added."),
            )
          }
          onClose={() => setDiscovery(null)}
        />
      )}
    </div>
  );
}

type ProviderDraft = { name: string; baseUrl: string; api: string };
function ProviderForm({
  draft,
  setDraft,
  busy,
  existing = false,
  onCancel,
  onSave,
}: {
  draft: ProviderDraft;
  setDraft: (value: ProviderDraft) => void;
  busy: boolean;
  existing?: boolean;
  onCancel: () => void;
  onSave: () => void;
}) {
  return (
    <form
      className={styles.form}
      onSubmit={(event) => {
        event.preventDefault();
        onSave();
      }}
    >
      <div className={styles.fields}>
        <label>
          {t("Provider ID")}
          <input
            value={draft.name}
            disabled={existing}
            onChange={(event) => setDraft({ ...draft, name: event.target.value })}
            required
          />
        </label>
        <label>
          {t("Base URL")}
          <input
            type="url"
            value={draft.baseUrl}
            onChange={(event) => setDraft({ ...draft, baseUrl: event.target.value })}
            placeholder="http://localhost:11434/v1"
            required
          />
        </label>
        <label>
          {t("API type")}
          <select
            value={draft.api}
            onChange={(event) => setDraft({ ...draft, api: event.target.value })}
          >
            <option value="openai-completions">OpenAI Completions</option>
            <option value="openai-responses">OpenAI Responses</option>
            <option value="anthropic-messages">Anthropic Messages</option>
            <option value="google-generative-ai">Google Generative AI</option>
          </select>
        </label>
      </div>
      <p className={styles.help}>
        {t("Local endpoints use a placeholder key; remote endpoints can use saved Pi credentials.")}
      </p>
      <div className={styles.formActions}>
        <button type="button" onClick={onCancel}>
          {t("Cancel")}
        </button>
        <button className={styles.primary} type="submit" disabled={busy || !native}>
          ✓ {t("Save provider")}
        </button>
      </div>
    </form>
  );
}

type ModelDraft = typeof blankModel;
function ModelForm({
  draft,
  setDraft,
  busy,
  existing,
  onRemove,
  onCancel,
  onSave,
}: {
  draft: ModelDraft;
  setDraft: (value: ModelDraft) => void;
  busy: boolean;
  existing: boolean;
  onRemove?: () => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  return (
    <form
      className={styles.form}
      onSubmit={(event) => {
        event.preventDefault();
        onSave();
      }}
    >
      <div className={styles.fields}>
        <label>
          {t("Model ID")}
          <input
            value={draft.id}
            disabled={existing}
            onChange={(event) => setDraft({ ...draft, id: event.target.value })}
            required
          />
        </label>
        <label>
          {t("Display name")}
          <input
            value={draft.name}
            onChange={(event) => setDraft({ ...draft, name: event.target.value })}
          />
        </label>
        <label>
          {t("Context window")} (Context Window)
          <span className={styles.numberField}>
            <input
              type="number"
              min="1"
              step="1"
              value={draft.contextWindow}
              onChange={(event) => setDraft({ ...draft, contextWindow: event.target.value })}
            />
            <small>tokens</small>
          </span>
        </label>
        <label>
          {t("Max output tokens")} (Max Output Tokens)
          <span className={styles.numberField}>
            <input
              type="number"
              min="1"
              step="1"
              value={draft.maxTokens}
              onChange={(event) => setDraft({ ...draft, maxTokens: event.target.value })}
            />
            <small>tokens</small>
          </span>
        </label>
      </div>
      <div className={styles.checks}>
        <label>
          <input
            type="checkbox"
            checked={draft.reasoning}
            onChange={(event) => setDraft({ ...draft, reasoning: event.target.checked })}
          />
          {t("Supports reasoning")} (Reasoning / CoT)
        </label>
        <label>
          <input
            type="checkbox"
            checked={draft.image}
            onChange={(event) => setDraft({ ...draft, image: event.target.checked })}
          />
          {t("Supports image input")} (Vision / {t("Multimodal")})
        </label>
      </div>
      <div className={styles.formActions}>
        {existing && (
          <button type="button" onClick={onRemove} disabled={busy}>
            {t("Remove model")}
          </button>
        )}
        <button type="button" onClick={onCancel}>
          {t("Cancel")}
        </button>
        <button className={styles.primary} type="submit" disabled={busy || !native}>
          ✓ {t("Save model")}
        </button>
      </div>
    </form>
  );
}
