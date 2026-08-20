// Starlight UI extension: a mechanically v3-adapted HUD and inventory panel.
import { type CSSProperties } from "react";
import {
  SCRIPT_UI_API_VERSION,
  type HudSlotProps,
  type PanelSlotProps,
  type ScriptUiContext,
} from "@chatgame/ui";

export const apiVersion = SCRIPT_UI_API_VERSION;

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, value));
}

function StarlightHud(props: HudSlotProps) {
  const hpStat = props.catalog?.hpStat ?? "hp";
  const hpMax = props.catalog?.stats.find((stat) => stat.name === hpStat)?.max ?? 100;
  const hull = clampPercent(((props.state?.player.stats[hpStat] ?? 0) / Math.max(1, hpMax)) * 100);
  const oxygen = clampPercent(props.state?.player.needs.oxygen?.value ?? 0);
  const locationId = props.state?.player.locationId ?? "";
  const location = props.catalog?.locations.find((item) => item.id === locationId)?.name ?? locationId;
  const clock = props.state?.clock ?? { day: 1, hour: 6 };

  const frame: CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: "var(--cg-space-2, 8px)",
    padding: "var(--cg-space-2, 8px) var(--cg-space-3, 12px)",
    borderRadius: "var(--cg-radius-chrome, 12px)",
    background: "var(--cg-surface)",
    border: "var(--cg-border-width, 1px) solid var(--cg-border)",
    boxShadow: "var(--cg-shadow-value)",
    fontFamily: "var(--cg-font-mono, var(--cg-font, monospace))",
  };

  const label: CSSProperties = {
    color: "var(--cg-text-dim)",
    fontSize: "calc(0.68rem * var(--cg-scale, 1))",
    textTransform: "uppercase",
    letterSpacing: "0.08em",
    whiteSpace: "nowrap",
  };

  const barTrack: CSSProperties = {
    position: "relative",
    width: 120,
    height: 10,
    borderRadius: 2,
    background: "var(--cg-surface-alt)",
    border: "var(--cg-border-width, 1px) solid var(--cg-border)",
    overflow: "hidden",
  };

  const barFill = (percent: number, tone: "primary" | "accent"): CSSProperties => ({
    width: `${percent}%`,
    height: "100%",
    background: `var(--cg-${tone})`,
    transition: "width 500ms ease",
  });

  const clockStyle: CSSProperties = {
    color: "var(--cg-text)",
    fontSize: "calc(0.86rem * var(--cg-scale, 1))",
    letterSpacing: "0.06em",
    whiteSpace: "nowrap",
  };

  return (
    <div style={frame} role="status" aria-label="starlight hud">
      <span style={label}>Hull</span>
      <div style={barTrack}>
        <div style={barFill(hull, "primary")} />
      </div>
      <span style={clockStyle}>{Math.round(hull)}%</span>
      <span style={{ ...label, marginLeft: "var(--cg-space-2, 8px)" }}>O₂</span>
      <div style={barTrack}>
        <div style={barFill(oxygen, "accent")} />
      </div>
      <span style={clockStyle}>{Math.round(oxygen)}%</span>
      <span style={{ ...clockStyle, marginLeft: "auto" }}>
        {location ? `${location} · ` : ""}D{clock.day} {String(clock.hour).padStart(2, "0")}:00
      </span>
    </div>
  );
}

interface InventoryItemRow {
  name?: string;
  quantity?: number;
  description?: string;
  [key: string]: unknown;
}

function StarlightInventoryPanel(props: PanelSlotProps) {
  const items: InventoryItemRow[] = (props.state?.player.inventory.stacks ?? []).map((stack) => {
    const item = props.catalog?.items.find((entry) => entry.id === stack.itemId);
    return { name: item?.name ?? stack.itemId, description: item?.description, quantity: stack.quantity };
  });
  const title = "Cargo Manifest";

  const root: CSSProperties = {
    display: "flex",
    flexDirection: "column",
    gap: "var(--cg-space-2, 8px)",
    padding: "var(--cg-space-3, 12px)",
    borderRadius: "var(--cg-radius-chrome, 12px)",
    background: "var(--cg-surface)",
    border: "var(--cg-border-width, 1px) solid var(--cg-border)",
    fontFamily: "var(--cg-font-mono, var(--cg-font, monospace))",
  };
  const row: CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: "var(--cg-space-2, 8px)",
    padding: "var(--cg-space-2, 8px)",
    borderRadius: "var(--cg-radius, 14px)",
    background: "var(--cg-surface-alt)",
    borderLeft: "2px solid var(--cg-primary)",
  };
  const name: CSSProperties = {
    color: "var(--cg-text)",
    fontSize: "calc(0.86rem * var(--cg-scale, 1))",
    letterSpacing: "0.04em",
  };
  const count: CSSProperties = {
    marginLeft: "auto",
    color: "var(--cg-accent)",
    fontSize: "calc(0.82rem * var(--cg-scale, 1))",
  };
  const desc: CSSProperties = {
    color: "var(--cg-text-dim)",
    fontSize: "calc(0.72rem * var(--cg-scale, 1))",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  };

  return (
    <div style={root}>
      <header
        style={{
          color: "var(--cg-accent)",
          fontSize: "calc(0.84rem * var(--cg-scale, 1))",
          letterSpacing: "0.1em",
          textTransform: "uppercase",
        }}
      >
        {title}
      </header>
      {items.length === 0 ? (
        <p style={{ color: "var(--cg-text-dim)", margin: 0, fontSize: "calc(0.78rem * var(--cg-scale, 1))" }}>
          No cargo registered.
        </p>
      ) : (
        items.map((item, index) => (
          <div style={row} key={index}>
            <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
              <span style={name}>{typeof item.name === "string" ? item.name : "Item"}</span>
              {typeof item.description === "string" ? <span style={desc}>{item.description}</span> : null}
            </div>
            {typeof item.quantity === "number" ? <span style={count}>×{item.quantity}</span> : null}
          </div>
        ))
      )}
    </div>
  );
}

export default function registerStarlightUi(ctx: ScriptUiContext): void {
  ctx.register("hud", { component: StarlightHud });
  ctx.register("panel:inventory", { component: StarlightInventoryPanel });
}
