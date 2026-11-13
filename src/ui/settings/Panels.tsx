import utilityStyles from "../primitives/Utilities.module.css";
import { Select } from "../primitives/Select.tsx";
import controlStyles from "../primitives/Controls.module.css";
import { componentClass } from "../componentClass.ts";
import managementStyles from "./Management.module.css";
import { Card, EmptyState, PageHero } from "./PageKit.tsx";
import type { ReactNode } from "react";
import type { Json, Location } from "../../core/api.ts";
import { locations } from "../../core/api.ts";
import { localized, t } from "../../core/i18n.ts";
import type { PanelView } from "../../core/runtime.ts";
import type { Layout } from "../hooks/useLayout.ts";
import { locationLabels } from "../primitives/Panel.tsx";

interface PanelsProps {
  panels: PanelView[];
  layout: Layout;
  at: (location: Location) => PanelView[];
  panel: (view: PanelView) => ReactNode;
  action: (id: string, args?: Json) => void;
}

export function Panels({ panels, layout, at, panel, action }: PanelsProps) {
  return (
    <main className={`${componentClass(managementStyles, "management")} settings`}>
      <PageHero
        eyebrow="Extension panels"
        title={t("Extension panels")}
        description={t(
          "Show, hide, and place the panels contributed by installed desktop plugins.",
        )}
        stat={{
          value: panels.filter((item) => item.owner !== "agent-chat").length,
          caption: "panels",
          tone: "purple",
        }}
      />
      <Card icon="sliders">
        <div className={componentClass(managementStyles, "panel-management-list")}>
          {!panels.filter((item) => item.owner !== "agent-chat").length && (
            <EmptyState icon="sliders">{t("No extension panels are available.")}</EmptyState>
          )}
          {panels
            .filter((item) => item.owner !== "agent-chat")
            .map((item) => (
              <article key={item.id}>
                <div>
                  <strong>{localized(item.title, item.titleI18n)}</strong>
                  <small>{item.id}</small>
                </div>
                <label className={`compact-field ${controlStyles.compactField}`}>
                  <span className="sr-only">
                    {t("Move {title}", { title: localized(item.title, item.titleI18n) })}
                  </span>
                  <Select
                    compact
                    label={t("Move {title}", { title: localized(item.title, item.titleI18n) })}
                    value={layout[item.id]?.location ?? item.location}
                    onChange={(location) => action("core.layout", { id: item.id, location })}
                    options={locations.map((location) => ({
                      value: location,
                      label: t(locationLabels[location]),
                    }))}
                  />
                </label>
                <button
                  type="button"
                  onClick={() =>
                    action("core.layout", {
                      id: item.id,
                      hidden: !layout[item.id]?.hidden,
                    })
                  }
                >
                  {t(layout[item.id]?.hidden ? "Show" : "Hide")}
                </button>
              </article>
            ))}
        </div>
      </Card>
      {at("settings").map(panel)}
    </main>
  );
}
