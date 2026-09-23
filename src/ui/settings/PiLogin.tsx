import utilityStyles from "../primitives/Utilities.module.css";
import { Button } from "../primitives/Button.tsx";
import { componentClass } from "../componentClass.ts";
import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { t } from "../../core/i18n.ts";
import styles from "./ModelSettings.module.css";
import { host, native } from "../../core/host.ts";

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

export function PiLogin({ onChanged }: { onChanged?: () => void }) {
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
    <section className={componentClass(styles, "model-method-content")}>
      <h2>{t("Pi login")}</h2>
      <p className={`settings-note ${utilityStyles.settingsNote}`}>
        {t("Sign in to a subscription or OAuth provider using Pi's own login flow.")}
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className={componentClass(styles, "model-login-controls")}>
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
        <Button
          variant="primary"
          className="primary"
          type="button"
          disabled={!native || !provider || status === "starting" || status === "waiting"}
          onClick={begin}
        >
          {t("Sign in with Pi")}
        </Button>
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
        <p className={`settings-note ${utilityStyles.settingsNote}`} role="status">
          {message}
        </p>
      )}
      {authUrl && (
        <div className={componentClass(styles, "model-login-step")}>
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
        <div className={componentClass(styles, "model-login-step")}>
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
        <div className={componentClass(styles, "model-login-step")}>
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
          className={componentClass(styles, "model-login-step")}
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
          <Button variant="primary" className="primary" type="submit">
            {t("Continue login")}
          </Button>
        </form>
      )}
      {!!providers.length && (
        <div className={componentClass(styles, "model-auth-list")}>
          <h3>{t("Pi login providers")}</h3>
          {providers.map((item) => (
            <div key={item.id}>
              <strong>{item.name}</strong>
              <span className={`settings-note ${utilityStyles.settingsNote}`}>
                {item.credentialType === "oauth" ? t("Signed in") : t("Not signed in")}
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
