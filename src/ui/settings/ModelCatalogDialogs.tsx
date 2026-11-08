import { useEffect, useState } from "react";
import { t } from "../../core/i18n.ts";
import { Icon } from "../primitives/Icon.tsx";
import { Dialog } from "../primitives/Dialog.tsx";
import type { DiscoveredModel, LocalScan, Provider } from "./modelTypes.ts";
import styles from "./ModelCatalogDialogs.module.css";

export type EndpointDraft = { name: string; baseUrl: string; api: string };

function useEscape(onClose: () => void) {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);
}

export function EndpointDialog({
  draft,
  setDraft,
  apiKey,
  setApiKey,
  mode,
  setMode,
  keyProvider,
  setKeyProvider,
  busy,
  probe,
  serviceScan,
  onRescan,
  onProbe,
  onSave,
  onSaveKey,
  onClose,
}: {
  draft: EndpointDraft;
  setDraft: (value: EndpointDraft) => void;
  apiKey: string;
  setApiKey: (value: string) => void;
  mode: "endpoint" | "key";
  setMode: (value: "endpoint" | "key") => void;
  keyProvider: string;
  setKeyProvider: (value: string) => void;
  busy: boolean;
  probe: string;
  serviceScan: LocalScan;
  onRescan: () => void;
  onProbe: () => void;
  onSave: () => void;
  onSaveKey: () => void;
  onClose: () => void;
}) {
  const [revealKey, setRevealKey] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  useEscape(onClose);

  function preset(name: string, baseUrl: string, api = "openai-completions") {
    setDraft({ name, baseUrl, api });
  }

  return (
    <Dialog titleId="endpoint-dialog-title" onClose={onClose} className={styles.endpointDialog}>
      <div className={styles.dialogHeading}>
        <span className={styles.headingIcon}>
          <Icon name="sliders" size={24} />
        </span>
        <div>
          <h2 id="endpoint-dialog-title">{t("Add custom endpoint / provider")}</h2>
          <p>{t("Connect a local engine, private gateway, or compatible API proxy")}</p>
        </div>
        <button className={styles.close} type="button" aria-label={t("Close")} onClick={onClose}>
          <Icon name="plus" size={20} className={styles.closeIcon} />
        </button>
      </div>
      <div className={styles.dialogBody}>
        <div className={styles.modeTabs} role="group" aria-label={t("Connection methods")}>
          <button
            type="button"
            aria-pressed={mode === "endpoint"}
            className={mode === "endpoint" ? styles.selected : ""}
            onClick={() => setMode("endpoint")}
          >
            {t("Custom endpoint")}
          </button>
          <button
            type="button"
            aria-pressed={mode === "key"}
            className={mode === "key" ? styles.selected : ""}
            onClick={() => setMode("key")}
          >
            {t("API key only")}
          </button>
        </div>
        {mode === "endpoint" ? (
          <form
            id="endpoint-form"
            onSubmit={(event) => {
              event.preventDefault();
              onSave();
            }}
          >
            <div className={styles.presetHeading}>
              <span>{t("Local services")}</span>
              <small>
                {serviceScan.status === "scanning"
                  ? t("Scanning local services…")
                  : t("Detected automatically. Click to fill, then adjust as needed.")}
              </small>
              <button
                type="button"
                className={styles.rescan}
                disabled={serviceScan.status === "scanning"}
                onClick={onRescan}
              >
                ⟳ {t("Scan again")}
              </button>
            </div>
            {!!serviceScan.services.length && (
              <div className={styles.presets}>
                {serviceScan.services.map((service) => (
                  <button
                    key={service.name}
                    type="button"
                    onClick={() => preset(service.name, service.baseUrl, service.api)}
                  >
                    <strong>{service.label}</strong>
                    <small>{service.baseUrl.replace(/^https?:\/\//, "")}</small>
                  </button>
                ))}
              </div>
            )}
            {(serviceScan.status === "error" ||
              (serviceScan.status === "done" && !serviceScan.services.length)) && (
              <p className={styles.note}>
                {serviceScan.status === "error"
                  ? t("Scan failed: {error}", { error: serviceScan.error ?? "" })
                  : t("No local model service detected. Enter the endpoint manually below.")}
              </p>
            )}
            <div className={styles.formFields}>
              <label>
                {t("Provider ID")}
                <input
                  value={draft.name}
                  onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                  placeholder="ollama-local"
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
                <small className={styles.note}>
                  {t(
                    "Ollama and other OpenAI-compatible endpoints usually need /v1 in the Base URL.",
                  )}
                </small>
              </label>
              <fieldset>
                <legend>{t("API protocol")}</legend>
                <div className={styles.protocols}>
                  <label className={draft.api === "openai-completions" ? styles.selected : ""}>
                    <input
                      type="radio"
                      checked={draft.api === "openai-completions"}
                      onChange={() => setDraft({ ...draft, api: "openai-completions" })}
                    />
                    <span>
                      <strong>OpenAI {t("Compatible")}</strong>
                      <small>/chat/completions</small>
                    </span>
                  </label>
                  <label className={draft.api === "anthropic-messages" ? styles.selected : ""}>
                    <input
                      type="radio"
                      checked={draft.api === "anthropic-messages"}
                      onChange={() => setDraft({ ...draft, api: "anthropic-messages" })}
                    />
                    <span>
                      <strong>Anthropic Messages</strong>
                      <small>/v1/messages</small>
                    </span>
                  </label>
                  <label className={draft.api === "openai-responses" ? styles.selected : ""}>
                    <input
                      type="radio"
                      checked={draft.api === "openai-responses"}
                      onChange={() => setDraft({ ...draft, api: "openai-responses" })}
                    />
                    <span>
                      <strong>OpenAI Responses</strong>
                      <small>/responses</small>
                    </span>
                  </label>
                </div>
              </fieldset>
              <label>
                {t("API key (optional for local endpoints)")}
                <span className={styles.keyField}>
                  <input
                    type={revealKey ? "text" : "password"}
                    autoComplete="new-password"
                    value={apiKey}
                    onChange={(event) => setApiKey(event.target.value)}
                  />
                  <button type="button" onClick={() => setRevealKey(!revealKey)}>
                    {revealKey ? t("Hide") : t("Show")}
                  </button>
                </span>
              </label>
              <button
                className={styles.advanced}
                type="button"
                aria-expanded={advanced}
                onClick={() => setAdvanced(!advanced)}
              >
                {advanced ? "⌄" : "›"} {t("Advanced network settings")}
              </button>
              {advanced && (
                <p className={styles.note}>
                  {t(
                    "Requests use the system network settings and a 10 second connection timeout.",
                  )}
                </p>
              )}
            </div>
          </form>
        ) : (
          <form
            id="endpoint-key-form"
            className={styles.formFields}
            onSubmit={(event) => {
              event.preventDefault();
              onSaveKey();
            }}
          >
            <label>
              {t("Provider ID")}
              <input
                list="endpoint-provider-suggestions"
                value={keyProvider}
                onChange={(event) => setKeyProvider(event.target.value)}
                placeholder="google"
                required
              />
              <datalist id="endpoint-provider-suggestions">
                <option value="google" />
                <option value="openrouter" />
                <option value="xai" />
                <option value="groq" />
                <option value="mistral" />
              </datalist>
            </label>
            <label>
              {t("API key")}
              <input
                type="password"
                autoComplete="new-password"
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
                required
              />
            </label>
          </form>
        )}
      </div>
      <div className={styles.dialogFooter}>
        {mode === "endpoint" && (
          <button type="button" disabled={busy || !draft.baseUrl} onClick={onProbe}>
            {t("Test connection (Ping)")}
          </button>
        )}
        <span className={styles.probe} role="status">
          {probe}
        </span>
        <button type="button" onClick={onClose}>
          {t("Cancel")}
        </button>
        <button
          className={styles.primary}
          type="submit"
          form={mode === "endpoint" ? "endpoint-form" : "endpoint-key-form"}
          disabled={busy}
        >
          {mode === "endpoint" ? t("Save and connect") : t("Save API key")}
        </button>
      </div>
    </Dialog>
  );
}

export function DiscoveryDialog({
  found,
  provider,
  query,
  setQuery,
  chosen,
  setChosen,
  error,
  busy,
  onRefresh,
  onImport,
  onClose,
}: {
  found: { provider: string; models: DiscoveredModel[]; truncated: boolean; latencyMs?: number };
  provider: Provider;
  query: string;
  setQuery: (value: string) => void;
  chosen: string[];
  setChosen: (value: string[]) => void;
  error: string;
  busy: boolean;
  onRefresh: () => void;
  onImport: () => void;
  onClose: () => void;
}) {
  useEscape(onClose);
  const visible = found.models.filter((model) =>
    `${model.name ?? ""} ${model.id}`.toLowerCase().includes(query.toLowerCase()),
  );
  const available = visible.filter(
    (model) => !provider.models.some((item) => item.id === model.id),
  );
  const existing = found.models.filter((model) =>
    provider.models.some((item) => item.id === model.id),
  ).length;
  return (
    <Dialog titleId="discovery-dialog-title" onClose={onClose} className={styles.discoveryDialog}>
      <div className={styles.dialogHeading}>
        <span className={styles.headingIcon}>
          <Icon name="search" size={24} />
        </span>
        <div>
          <h2 id="discovery-dialog-title">{t("Fetch model list")}</h2>
          <p>
            {t("Discover models from {name}", { name: provider.name })}{" "}
            <code>{provider.baseUrl}</code>
          </p>
        </div>
        <button className={styles.close} type="button" aria-label={t("Close")} onClick={onClose}>
          <Icon name="plus" size={20} className={styles.closeIcon} />
        </button>
      </div>
      <div className={styles.dialogBody}>
        <div className={styles.discoveryBanner}>
          <span>
            {t("{count} models found", { count: found.models.length })}
            {existing > 0 && ` · ${existing} ${t("Already added")}`}
            {found.latencyMs !== undefined && ` · ${found.latencyMs}ms`}
          </span>
          <button type="button" disabled={busy} onClick={onRefresh}>
            ⟳ {t("Rescan")}
          </button>
        </div>
        {error && (
          <p className={styles.dialogError} role="alert">
            {error}
          </p>
        )}
        <label className={styles.discoverySearch}>
          <span className="sr-only">{t("Search available models")}</span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("Search available models")}
          />
        </label>
        <div className={styles.discoveryList}>
          {visible.map((model) => {
            const added = provider.models.some((item) => item.id === model.id);
            return (
              <label key={model.id} className={chosen.includes(model.id) ? styles.selected : ""}>
                <input
                  type="checkbox"
                  checked={added || chosen.includes(model.id)}
                  disabled={added || busy}
                  onChange={(event) =>
                    setChosen(
                      event.target.checked
                        ? [...chosen, model.id]
                        : chosen.filter((id) => id !== model.id),
                    )
                  }
                />
                <span>
                  <strong>{model.name || model.id}</strong>
                  <code>{model.id}</code>
                  <small>
                    {model.contextWindow
                      ? `${model.contextWindow.toLocaleString()} ${t("Context window")}`
                      : t("Model details available after import")}
                  </small>
                </span>
                <em>{added ? t("Already added") : t("New model")}</em>
              </label>
            );
          })}
          {!visible.length && <p className={styles.note}>{t("No models match your search.")}</p>}
        </div>
        {found.truncated && (
          <p className={styles.note}>
            {t("More models are available; only the first page is shown.")}
          </p>
        )}
      </div>
      <div className={styles.dialogFooter}>
        <button
          type="button"
          disabled={!available.length || busy}
          onClick={() => setChosen([...new Set([...chosen, ...available.map((item) => item.id)])])}
        >
          {t("Select shown")}
        </button>
        <button type="button" disabled={!chosen.length || busy} onClick={() => setChosen([])}>
          {t("Clear selection")}
        </button>
        <span className={styles.spacer} />
        <button type="button" onClick={onClose}>
          {t("Cancel")}
        </button>
        <button
          className={styles.primary}
          type="button"
          disabled={!chosen.length || busy}
          onClick={onImport}
        >
          {t("Add selected models ({count})", { count: chosen.length })}
        </button>
      </div>
    </Dialog>
  );
}
