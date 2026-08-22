"use client";

import type { Catalog, WorldState, AssetManifest } from "../../lib/api";
import { UiIcon } from "./ui-icon";
import type { PanelId } from "./state";
import { SlotRenderer } from "./slots";
import type { ToolbarSlotProps } from "../../lib/script-registry";
import { Pause } from "lucide-react";

export interface ToolbarProps {
  state: WorldState;
  catalog: Catalog;
  scriptId: string;
  assets: AssetManifest;
  panel: PanelId | null;
  onOpenPanel: (panel: PanelId) => void;
  onOpenPause: () => void;
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

function DefaultToolbar({ scriptId, assets, panel, onOpenPanel, onOpenPause }: ToolbarProps) {
  return (
    <nav
      data-region="toolbar"
      aria-label="游戏面板"
      className="cg-toolbar"
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
            className="cg-toolbar__action"
          >
            <UiIcon slot={slot} scriptId={scriptId} manifest={assets} className="cg-icon" />
            <span>{label}</span>
          </button>
        );
      })}
      <button
        type="button"
        title="暂停"
        aria-label="暂停"
        onClick={onOpenPause}
        className="cg-toolbar__action"
      >
        <Pause className="cg-icon" aria-hidden="true" />
        <span>暂停</span>
      </button>
    </nav>
  );
}

function DefaultToolbarSlot(props: ToolbarSlotProps) {
  return <DefaultToolbar {...props} onOpenPanel={props.openPanel} onOpenPause={props.openPause} />;
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
        openPause: props.onOpenPause,
      }}
    />
  );
}
