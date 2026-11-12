import utilityStyles from "../primitives/Utilities.module.css";
import { Select } from "../primitives/Select.tsx";
import { Button } from "../primitives/Button.tsx";
import { componentClass } from "../componentClass.ts";
import { useEffect, useRef, useState } from "react";
import { t } from "../../core/i18n.ts";
import styles from "./ModelSettings.module.css";
import { host, native } from "../../core/host.ts";
import type { Config } from "./modelTypes.ts";

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

export function ApiKeyAccess({
  onChanged,
  initialProvider,
}: {
  onChanged?: () => void;
  initialProvider: string;
}) {
  const [config, setConfig] = useState<{
    path: string;
    providers: { provider: string; type: string }[];
  } | null>(null);
  const [provider, setProvider] = useState(initialProvider);
  const [customProviders, setCustomProviders] = useState<string[]>([]);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const providerInput = useRef<HTMLInputElement>(null);

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
    host<Config>({ op: "model_config.list" })
      .then((value) => {
        if (mounted) setCustomProviders(value.providers.map((item) => item.name));
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
    <section className={componentClass(styles, "model-method-content")}>
      <h2>{t("API keys")}</h2>
      <p className={`settings-note ${utilityStyles.settingsNote}`}>
        {t(
          "Save a provider API key in Pi's auth.json. Existing keys and OAuth tokens are never shown here.",
        )}
      </p>
      {config && <code className={componentClass(styles, "model-config-path")}>{config.path}</code>}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {!native && (
        <p className={`settings-note ${utilityStyles.settingsNote}`}>
          {t("Model configuration requires the desktop app.")}
        </p>
      )}
      <div className={componentClass(styles, "provider-cards")}>
        {["openai", "anthropic", "google", "deepseek"].map((name) => {
          const connected = config?.providers.some((item) => item.provider === name);
          return (
            <button
              key={name}
              type="button"
              className={provider === name ? componentClass(styles, "selected") : ""}
              aria-pressed={provider === name}
              onClick={() => {
                setProvider(name);
                providerInput.current?.focus();
              }}
            >
              <span className={componentClass(styles, "provider-mark")} aria-hidden="true">
                {name.slice(0, 2).toUpperCase()}
              </span>
              <strong>
                {name === "openai"
                  ? "OpenAI"
                  : name === "google"
                    ? "Google"
                    : name === "deepseek"
                      ? "DeepSeek"
                      : "Anthropic"}
              </strong>
              <small>{connected ? t("Connected") : t("Add API key")}</small>
            </button>
          );
        })}
      </div>
      {customProviders.length > 0 && (
        <label className={componentClass(styles, "model-custom-auth-picker")}>
          {t("Custom provider")}
          <Select
            label={t("Custom provider")}
            value={customProviders.includes(provider) ? provider : ""}
            onChange={setProvider}
            placeholder={t("Choose a custom provider")}
            options={customProviders.map((name) => ({ value: name, label: name }))}
          />
        </label>
      )}
      <form
        className={componentClass(styles, "model-auth-form")}
        onSubmit={(event) => {
          event.preventDefault();
          change("save_key", provider);
        }}
      >
        <label>
          {t("Provider ID")}
          <input
            ref={providerInput}
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
        <Button variant="primary" className="primary" type="submit" disabled={!native || busy}>
          {t("Save API key")}
        </Button>
      </form>
      {config && config.providers.length > 0 && (
        <div className={componentClass(styles, "model-auth-list")}>
          <h3>{t("Saved Pi credentials")}</h3>
          {config.providers.map((item) => (
            <div key={item.provider}>
              <strong>{item.provider}</strong>
              <span className={`settings-note ${utilityStyles.settingsNote}`}>
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
