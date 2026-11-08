import { useState } from "react";
import type { Location } from "../../core/api.ts";
import type { PanelView } from "../../core/runtime.ts";

export interface Layout {
  [id: string]: { hidden?: boolean; location?: Location; collapsed?: boolean };
}

function readLayout(): Layout {
  try {
    return JSON.parse(localStorage.getItem("pion.layout") ?? "{}");
  } catch {
    return {};
  }
}

export function useLayout() {
  const [layout, setLayout] = useState<Layout>(readLayout);

  function updatePanel(
    id: string,
    change: { location?: Location; hidden?: boolean; collapsed?: boolean },
  ) {
    setLayout((current) => {
      const next = { ...current, [id]: { ...current[id], ...change } };
      localStorage.setItem("pion.layout", JSON.stringify(next));
      return next;
    });
  }

  function layoutAt(panels: PanelView[], location: Location) {
    return panels.filter(
      (panel) =>
        panel.owner !== "agent-chat" &&
        !layout[panel.id]?.hidden &&
        (layout[panel.id]?.location ?? panel.location) === location,
    );
  }

  return {
    layout,
    updatePanel,
    setPanelLocation: (id: string, location: Location) => updatePanel(id, { location }),
    setPanelHidden: (id: string, hidden: boolean) => updatePanel(id, { hidden }),
    layoutAt,
  };
}
