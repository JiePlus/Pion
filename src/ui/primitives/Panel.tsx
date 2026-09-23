import { componentClass } from "../componentClass.ts";
import type { Json, Location } from "../../core/api.ts";
import { locations } from "../../core/api.ts";
import { localized, t } from "../../core/i18n.ts";
import type { MessageKey } from "../../core/i18n.ts";
import type { PanelView } from "../../core/runtime.ts";
import { PanelBoundary, ViewRenderer } from "../View.tsx";
import styles from "./Panel.module.css";
import { Button } from "./Button.tsx";

export const locationLabels: Record<Location, MessageKey> = {
  sidebar: "Left sidebar",
  secondarySidebar: "Right sidebar",
  mainPanel: "Main area",
  bottomPanel: "Bottom panel",
  statusBar: "Status bar",
  toolbar: "Toolbar",
  commandPalette: "Commands",
  contextMenu: "Context menu",
  settings: "Settings",
};

export function Panel({
  panel,
  location,
  onMove,
  onHide,
  run,
}: {
  panel: PanelView;
  location: Location;
  onMove: (location: Location) => void;
  onHide: () => void;
  run: (id: string, args?: Json) => Promise<Json>;
}) {
  const conversation = panel.id === "agent-chat.conversation";
  const title = localized(panel.title, panel.titleI18n);
  return (
    <section className={componentClass(styles, "panel")} data-panel={panel.id}>
      {!conversation && (
        <header className={componentClass(styles, "header")}>
          <span>{title}</span>
          <div>
            <select
              aria-label={t("Move {title}", { title })}
              value={location}
              onChange={(event) => onMove(event.target.value as Location)}
            >
              {locations.map((item) => (
                <option key={item} value={item}>
                  {t(locationLabels[item])}
                </option>
              ))}
            </select>
            <Button variant="icon" aria-label={t("Hide {title}", { title })} onClick={onHide}>
              −
            </Button>
          </div>
        </header>
      )}
      <PanelBoundary>
        <ViewRenderer view={panel.view} run={run} />
      </PanelBoundary>
    </section>
  );
}
