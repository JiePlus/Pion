import type { Location } from "../../core/api.ts";
import type { Runtime } from "../../core/runtime.ts";
import type { useLayout } from "./useLayout.ts";

export function usePanels(runtime: Runtime, layout: ReturnType<typeof useLayout>) {
  const panels = [...runtime.panels.values()];
  return {
    getPanelsAt: (location: Location) => layout.layoutAt(panels, location),
    removePanel: (id: string) => layout.setPanelHidden(id, true),
  };
}
