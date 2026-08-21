"use client";

import type { Catalog, WorldState, AssetManifest } from "../../lib/api";
import { UiIcon } from "./ui-icon";
import { SlotRenderer } from "./slots";

export interface HudProps {
  state: WorldState;
  catalog: Catalog;
  scriptId: string;
  assets: AssetManifest;
}

function fmtClock(state: WorldState): string {
  const c = state.clock;
  return `第 ${c.day} 日 · ${String(c.hour).padStart(2, "0")}:00`;
}

function HpBar({
  hp,
  max,
  scriptId,
  assets,
}: {
  hp: number;
  max: number;
  scriptId: string;
  assets?: AssetManifest;
}) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (hp / max) * 100)) : 0;
  return (
    <span className="cg-default-hud__resource">
      <span className="cg-default-hud__resource-label">
        <UiIcon slot="hp" scriptId={scriptId} manifest={assets} className="cg-icon" />
        状态
      </span>
      <span className="cg-default-hud__resource-value">{hp}/{max}</span>
      <span className="cg-default-hud__meter" aria-hidden="true">
        <span style={{ width: `${pct}%` }} />
      </span>
    </span>
  );
}

function DefaultHud({ state, catalog, scriptId, assets }: HudProps) {
  const hpStat = catalog?.hpStat ?? "hp";
  const hpMax = catalog?.stats.find((s) => s.name === hpStat)?.max ?? 100;
  const hp = state.player.stats[hpStat] ?? 0;
  const locationName =
    catalog?.locations.find((l) => l.id === state.player.locationId)?.name ??
    state.player.locationId;

  return (
    <header data-region="hud" className="cg-default-hud">
      <div className="cg-default-hud__inner">
        <div className="cg-default-hud__context">
          <strong>{locationName}</strong>
          <span>
            <UiIcon slot="time" scriptId={scriptId} manifest={assets} className="cg-icon" />
            {fmtClock(state)}
          </span>
        </div>
        <div className="cg-default-hud__conditions" aria-label="环境">
          <span>
            <UiIcon slot="location" scriptId={scriptId} manifest={assets} className="cg-icon" />
            {state.clock.weather}
          </span>
          <span>{state.clock.season}</span>
        </div>
        <div className="cg-default-hud__resources">
          <HpBar hp={hp} max={hpMax} scriptId={scriptId} assets={assets} />
        </div>
      </div>
    </header>
  );
}

/** Slot-replaceable HUD entry point. */
export function Hud(props: HudProps) {
  return <SlotRenderer slot="hud" fallback={DefaultHud} slotProps={props} />;
}
