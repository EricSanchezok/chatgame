"use client";

// Default HUD (top glass bar): health bar, clock badge, location badge.
// All chrome is data-driven from WorldState + Catalog + theme tokens
// (var(--cg-*)); script assets win over fallback icons. The whole HUD is
// slot-replaceable: a script ui bundle may register its own "hud" slot,
// which replaces this default entirely.
import type { Catalog, WorldState, AssetManifest } from "../../lib/api";
import { getSlot } from "../../lib/script-registry";
import { UiIcon } from "./ui-icon";

export interface HudProps {
  state: WorldState;
  catalog?: Catalog;
  scriptId: string;
  assets?: AssetManifest;
}

function fmtClock(state: WorldState): string {
  const c = state.clock;
  return `${c.day} 日 ${c.hour} 时 · ${c.weather} · ${c.season}`;
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
    <span className="flex items-center gap-1.5" style={{ color: "var(--cg-text)" }}>
      <UiIcon slot="hp" scriptId={scriptId} manifest={assets} className="h-4 w-4" />
      <span
        className="relative h-2 w-24 overflow-hidden rounded-full"
        style={{ background: "color-mix(in srgb, var(--cg-border) 60%, transparent)" }}
      >
        <span
          className="absolute inset-y-0 left-0 rounded-full transition-all duration-500"
          style={{ width: `${pct}%`, background: "var(--cg-primary)" }}
        />
      </span>
      <span className="text-xs tabular-nums">
        {hp}/{max}
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
    <header
      data-region="hud"
      className="cg-glass cg-chrome flex shrink-0 items-center justify-between gap-3 px-4 py-2"
      style={{ borderBottom: "var(--cg-border-width) solid var(--cg-border)" }}
    >
      <div className="flex items-center gap-4 text-sm">
        <span className="flex items-center gap-1.5" style={{ color: "var(--cg-text)" }}>
          <UiIcon slot="time" scriptId={scriptId} manifest={assets} className="h-4 w-4" />
          {fmtClock(state)}
        </span>
        <span className="flex items-center gap-1.5" style={{ color: "var(--cg-text-dim)" }}>
          <UiIcon slot="location" scriptId={scriptId} manifest={assets} className="h-4 w-4" />
          {locationName}
        </span>
        <HpBar hp={hp} max={hpMax} scriptId={scriptId} assets={assets} />
      </div>
    </header>
  );
}

/** Slot-replaceable HUD entry point. */
export function Hud(props: HudProps) {
  const def = getSlot("hud");
  if (def) {
    const C = def.component as React.ElementType;
    return <C {...props} />;
  }
  return <DefaultHud {...props} />;
}
