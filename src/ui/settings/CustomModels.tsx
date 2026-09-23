import utilityStyles from "../primitives/Utilities.module.css";
import { Button } from "../primitives/Button.tsx";
import { componentClass } from "../componentClass.ts";
import { useEffect, useState } from "react";
import { t } from "../../core/i18n.ts";
import styles from "./ModelSettings.module.css";
import { host, native } from "../../core/host.ts";
import { blankModel } from "./modelTypes.ts";
import { ModelDiscovery } from "./ModelDiscovery.tsx";
import type { Config, CustomModel, DiscoveredModel, Provider } from "./modelTypes.ts";

export function CustomModels({
  onChanged,
  onSetApiKey,
}: {
  onChanged?: () => void;
  onSetApiKey: (provider: string) => void;
}) {
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
    <section className={componentClass(styles, "model-settings")}>
      <div className={componentClass(styles, "model-settings-heading")}>
        <div>
          <h2>{t("Custom Pi models")}</h2>
          <p className={`settings-note ${utilityStyles.settingsNote}`}>
            {t(
              "Manage custom providers and models in Pi's models.json. Use API key or Pi login to connect them.",
            )}
          </p>
          <p className={`settings-note ${utilityStyles.settingsNote}`}>
            {t("Reopen a task to refresh its available models.")}
          </p>
          {config && (
            <code className={componentClass(styles, "model-config-path")}>{config.path}</code>
          )}
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
        <p className={`settings-note ${utilityStyles.settingsNote}`}>
          {t("Model configuration requires the desktop app.")}
        </p>
      )}
      {native && !config && !error && (
        <p className={`settings-note ${utilityStyles.settingsNote}`}>{t("Loading…")}</p>
      )}
      {editingProvider && (
        <form
          className={componentClass(styles, "model-config-form")}
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
          <p className={`settings-note ${utilityStyles.settingsNote}`}>
            {t(
              "Local endpoints receive a placeholder key. Remote endpoints use your existing Pi authentication.",
            )}
          </p>
          <div className={`button-row ${utilityStyles.buttonRow}`}>
            <Button variant="primary" className="primary" type="submit" disabled={busy}>
              {t("Save provider")}
            </Button>
            <button type="button" onClick={() => setEditingProvider(false)}>
              {t("Cancel")}
            </button>
          </div>
        </form>
      )}
      {config && config.providers.length === 0 && !editingProvider && (
        <p className={`settings-note ${utilityStyles.settingsNote}`}>
          {t("No custom providers configured.")}
        </p>
      )}
      {config && config.providers.length > 0 && (
        <div className={componentClass(styles, "model-config-layout")}>
          <nav
            className={componentClass(styles, "model-provider-list")}
            aria-label={t("Custom providers")}
          >
            {config.providers.map((item) => (
              <button
                key={item.name}
                type="button"
                className={item.name === selected ? componentClass(styles, "selected") : ""}
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
            <div className={componentClass(styles, "model-provider-detail")}>
              <div className={componentClass(styles, "model-provider-title")}>
                <div>
                  <h3>{provider.name}</h3>
                  <p className={`settings-note ${utilityStyles.settingsNote}`}>
                    {provider.api || t("API set per model")} ·{" "}
                    {provider.baseUrl || t("Built-in endpoint")}
                  </p>
                </div>
                <div className={`button-row ${utilityStyles.buttonRow}`}>
                  <button type="button" disabled={busy} onClick={() => onSetApiKey(provider.name)}>
                    {t("Set API key")}
                  </button>
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
                <p className={`settings-note ${utilityStyles.settingsNote}`}>
                  {t("Advanced Pi fields are preserved when you save changes here.")}
                </p>
              )}
              <div
                className={`${componentClass(styles, "model-discovery-actions")} button-row ${utilityStyles.buttonRow}`}
              >
                <Button
                  variant="primary"
                  className="primary"
                  type="button"
                  disabled={busy}
                  onClick={discover}
                >
                  {busy ? t("Loading…") : t("Fetch model list")}
                </Button>
                <button type="button" disabled={busy} onClick={() => editModel()}>
                  {t("Add model")}
                </button>
              </div>
              {found && (
                <ModelDiscovery
                  found={found}
                  provider={provider}
                  query={query}
                  setQuery={setQuery}
                  visible={visible}
                  available={available}
                  chosen={chosen}
                  setChosen={setChosen}
                  busy={busy}
                  importModels={importModels}
                  onClose={() => setDiscovery(null)}
                />
              )}
              <div className={componentClass(styles, "model-list")}>
                {provider.models.map((item) => (
                  <article key={item.id}>
                    <div>
                      <strong>{item.name || item.id}</strong>
                      <small>{item.id}</small>
                    </div>
                    <div className={`button-row ${utilityStyles.buttonRow}`}>
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
                  className={componentClass(styles, "model-config-form")}
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
                  <div className={componentClass(styles, "model-token-fields")}>
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
                  <label className={componentClass(styles, "model-checkbox")}>
                    <input
                      type="checkbox"
                      checked={modelDraft.reasoning}
                      onChange={(event) =>
                        setModelDraft({ ...modelDraft, reasoning: event.target.checked })
                      }
                    />
                    {t("Supports reasoning")}
                  </label>
                  <label className={componentClass(styles, "model-checkbox")}>
                    <input
                      type="checkbox"
                      checked={modelDraft.image}
                      onChange={(event) =>
                        setModelDraft({ ...modelDraft, image: event.target.checked })
                      }
                    />
                    {t("Supports image input")}
                  </label>
                  <div className={`button-row ${utilityStyles.buttonRow}`}>
                    <Button variant="primary" className="primary" type="submit" disabled={busy}>
                      {t("Save model")}
                    </Button>
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
