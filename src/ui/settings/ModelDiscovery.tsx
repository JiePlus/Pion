import utilityStyles from "../primitives/Utilities.module.css";
import { Button } from "../primitives/Button.tsx";
import { componentClass } from "../componentClass.ts";
import type { Dispatch, SetStateAction } from "react";
import { t } from "../../core/i18n.ts";
import styles from "./ModelSettings.module.css";
import type { DiscoveredModel, Provider } from "./modelTypes.ts";

interface ModelDiscoveryProps {
  found: { provider: string; models: DiscoveredModel[]; truncated: boolean };
  provider: Provider;
  query: string;
  setQuery: Dispatch<SetStateAction<string>>;
  visible: DiscoveredModel[];
  available: DiscoveredModel[];
  chosen: string[];
  setChosen: Dispatch<SetStateAction<string[]>>;
  busy: boolean;
  importModels: () => Promise<void>;
  onClose: () => void;
}

export function ModelDiscovery({
  found,
  provider,
  query,
  setQuery,
  visible,
  available,
  chosen,
  setChosen,
  busy,
  importModels,
  onClose,
}: ModelDiscoveryProps) {
  return (
    <div className={componentClass(styles, "model-discovery")}>
      <div className={componentClass(styles, "model-discovery-heading")}>
        <h4>{t("{count} models found", { count: found.models.length })}</h4>
        <button type="button" onClick={onClose}>
          {t("Close")}
        </button>
      </div>
      {found.models.length > 0 ? (
        <>
          <label className={componentClass(styles, "model-discovery-search")}>
            {t("Search available models")}
            <input value={query} onChange={(event) => setQuery(event.target.value)} />
          </label>
          <p className={`settings-note ${utilityStyles.settingsNote}`}>
            {t("Select chat models to add. Existing model settings will be preserved.")}
          </p>
          <div className={componentClass(styles, "model-discovery-list")}>
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
              <p className={`settings-note ${utilityStyles.settingsNote}`}>
                {t("No models match your search.")}
              </p>
            )}
          </div>
          <div className={`button-row ${utilityStyles.buttonRow}`}>
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
            <button type="button" disabled={!chosen.length || busy} onClick={() => setChosen([])}>
              {t("Clear selection")}
            </button>
            <Button
              variant="primary"
              className="primary"
              type="button"
              disabled={!chosen.length || busy}
              onClick={importModels}
            >
              {t("Add selected models ({count})", { count: chosen.length })}
            </Button>
          </div>
          {found.truncated && (
            <p className={`settings-note ${utilityStyles.settingsNote}`}>
              {t("More models are available; only the first page is shown.")}
            </p>
          )}
        </>
      ) : (
        <p className={`settings-note ${utilityStyles.settingsNote}`}>
          {t("No models returned by this endpoint. You can add one manually.")}
        </p>
      )}
    </div>
  );
}
