import utilityStyles from "../primitives/Utilities.module.css";
import { componentClass } from "../componentClass.ts";
import { useState } from "react";
import { t } from "../../core/i18n.ts";
import styles from "./ModelSettings.module.css";
import { ApiKeyAccess } from "./ApiKeyAccess.tsx";
import { PiLogin } from "./PiLogin.tsx";
import { CustomModels } from "./CustomModels.tsx";

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
  const [keyProvider, setKeyProvider] = useState("");
  return (
    <div className={componentClass(styles, "model-management")}>
      {!embedded && (
        <header className={componentClass(styles, "model-management-header")}>
          <h1>
            {t("Connect Pi models")} <span aria-hidden="true">/ Models</span>
          </h1>
          <p className={`settings-note ${utilityStyles.settingsNote}`}>
            {t(
              "Choose how Pi connects to a model provider. Reopen a task after changing configuration.",
            )}
          </p>
        </header>
      )}
      <nav
        className={componentClass(styles, "model-method-tabs")}
        aria-label={t("Connection methods")}
      >
        {methods.map((item) => (
          <button
            key={item.id}
            type="button"
            className={method === item.id ? componentClass(styles, "selected") : ""}
            aria-current={method === item.id ? "page" : undefined}
            onClick={() => setMethod(item.id)}
          >
            {t(item.label)}
          </button>
        ))}
      </nav>
      {method === "key" && <ApiKeyAccess onChanged={onChanged} initialProvider={keyProvider} />}
      {method === "login" && <PiLogin onChanged={onChanged} />}
      {method === "environment" && (
        <section className={componentClass(styles, "model-method-content")}>
          <h2>{t("Environment variables")}</h2>
          <p>
            {t(
              "Pi can use provider API keys from the environment without saving them in auth.json. Set the variable before launching Pion.",
            )}
          </p>
          <div className={componentClass(styles, "model-env-list")}>
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
          <p className={`settings-note ${utilityStyles.settingsNote}`}>
            {t(
              "When Pion starts from Finder, shell-only environment variables may not be inherited.",
            )}
          </p>
        </section>
      )}
      {method === "custom" && (
        <CustomModels
          onChanged={onChanged}
          onSetApiKey={(provider) => {
            setKeyProvider(provider);
            setMethod("key");
          }}
        />
      )}
      {method === "extension" && (
        <section className={componentClass(styles, "model-method-content")}>
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
