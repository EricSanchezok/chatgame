"use client";

// Default right-side floating toolbar: a glass capsule column of panel
// entry points, hovering over the scene background — decoupled from the
// composer. Script ui bundles may replace the whole toolbar via the
// "toolbar" slot.
import type { Catalog, WorldState, AssetManifest } from "../../lib/api";
import { UiIcon } from "./ui-icon";
import type { PanelId } from "./state";
import { SlotRenderer } from "./slots";
import type { ToolbarSlotProps } from "../../lib/script-registry";

export interface ToolbarProps {
  state: WorldState;
  catalog: Catalog;
  scriptId: string;
  assets: AssetManifest;
  panel: PanelId | null;
  onOpenPanel: (panel: PanelId) => void;
}

const ENTRIES: Array<{
  panel: PanelId;
  label: string;
  slot: "inventory" | "character" | "relations" | "tasks" | "map" | "log";
}> = [
  { panel: "inventory", label: "背包", slot: "inventory" },
  { panel: "character", label: "角色", slot: "character" },
  { panel: "relations", label: "关系", slot: "relations" },
  { panel: "tasks", label: "任务", slot: "tasks" },
  { panel: "map", label: "地图", slot: "map" },
  { panel: "log", label: "日志", slot: "log" },
];

function DefaultToolbar({ scriptId, assets, panel, onOpenPanel }: ToolbarProps) {
  return (
    <nav
      data-region="toolbar"
      aria-label="游戏面板"
      className="cg-glass cg-chrome fixed right-3 top-1/2 z-40 flex -translate-y-1/2 flex-col gap-1.5 rounded-2xl border p-1.5"
      style={{ borderColor: "var(--cg-border)" }}
    >
      {ENTRIES.map(({ panel: id, label, slot }) => {
        const active = panel === id;
        return (
          <button
            key={id}
            type="button"
            title={label}
            aria-label={label}
            aria-pressed={active}
            onClick={() => onOpenPanel(id)}
            className="cg-chrome flex h-10 w-10 items-center justify-center rounded-xl text-lg transition-colors"
            style={
              active
                ? { background: "var(--cg-primary)", color: "var(--cg-surface)" }
                : { color: "var(--cg-text)", background: "transparent" }
            }
          >
            <UiIcon slot={slot} scriptId={scriptId} manifest={assets} className="h-5 w-5" />
          </button>
        );
      })}
    </nav>
  );
}

function DefaultToolbarSlot(props: ToolbarSlotProps) {
  return <DefaultToolbar {...props} onOpenPanel={props.openPanel} />;
}

/** Slot-replaceable toolbar entry point. */
export function Toolbar(props: ToolbarProps) {
  return (
    <SlotRenderer
      slot="toolbar"
      fallback={DefaultToolbarSlot}
      slotProps={{
        scriptId: props.scriptId,
        state: props.state,
        catalog: props.catalog,
        assets: props.assets,
        panel: props.panel,
        openPanel: props.onOpenPanel,
      }}
    />
  );
}
