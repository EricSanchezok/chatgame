// Starlight UI extension: registers a holographic HUD (hull-integrity bar +
// station clock), a launcher cover built from the bridge scene, and a
// hologram inventory panel. Self-contained — only imports react; all colors
// come from the --cg-* variables applied by the theme system. Slot props are
// untyped at the seam, so every component falls back to sensible defaults
// when the host renderer passes nothing.
import { useEffect, useState, type CSSProperties } from "react";

/** Local mirror of the script-registry slot contract (kept dependency-free). */
type ScriptSlotId = "launcher:background" | "hud" | `panel:${string}`;

interface ScriptSlotDef {
  component: unknown;
  position?: "top" | "bottom" | "left" | "right";
  order?: number;
}

interface ScriptUiContext {
  register(slot: ScriptSlotId, def: ScriptSlotDef): void;
}

const BRIDGE_SCENE = "/api/scripts/starlight/assets/backgrounds/bridge.svg";

interface StarlightHudProps {
  hullIntegrity?: number;
  oxygen?: number;
  day?: number;
  hour?: number;
  location?: string;
  [key: string]: unknown;
}

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, value));
}

function StarlightHud(props: StarlightHudProps = {}) {
  const [clock, setClock] = useState(() => {
    const hour = typeof props.hour === "number" ? props.hour : 6;
    return { day: typeof props.day === "number" ? props.day : 1, hour };
  });

  // Local tick display only — the engine clock stays authoritative on the
  // server; this component never mutates game state.
  useEffect(() => {
    const id = window.setInterval(() => {
      setClock((c) => (c.hour >= 23 ? { day: c.day + 1, hour: 0 } : { ...c, hour: c.hour + 1 }));
    }, 60_000);
    return () => window.clearInterval(id);
  }, []);

  const hull = clampPercent(typeof props.hullIntegrity === "number" ? props.hullIntegrity : 82);
  const oxygen = clampPercent(typeof props.oxygen === "number" ? props.oxygen : 100);
  const location = typeof props.location === "string" ? props.location : "";

  const frame: CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: "var(--cg-space-2, 8px)",
    padding: "var(--cg-space-2, 8px) var(--cg-space-3, 12px)",
    borderRadius: "var(--cg-radius-chrome, 12px)",
    background: "var(--cg-surface)",
    border: "var(--cg-border-width, 1px) solid var(--cg-border)",
    boxShadow: "var(--cg-shadow-value, 0 2px 8px rgba(0,0,0,0.4))",
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
    background: `linear-gradient(90deg, var(--cg-${tone}), var(--cg-accent))`,
    boxShadow: "0 0 8px var(--cg-accent)",
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

function StarlightLauncherBackground() {
  const root: CSSProperties = { position: "absolute", inset: 0, overflow: "hidden" };
  const wash: CSSProperties = {
    position: "absolute",
    inset: 0,
    background:
      "linear-gradient(180deg, var(--cg-background) 0%, transparent 44%, var(--cg-background) 100%)",
  };
  const scanline: CSSProperties = {
    position: "absolute",
    inset: 0,
    background: "repeating-linear-gradient(0deg, transparent 0 3px, var(--cg-border) 3px 4px)",
    opacity: 0.25,
  };
  return (
    <div style={root} aria-hidden="true">
      {/* eslint-disable-next-line @next/next/no-img-element -- script ui bundle runs outside the Next image pipeline */}
      <img src={BRIDGE_SCENE} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
      <div style={wash} />
      <div style={scanline} />
    </div>
  );
}

interface InventoryItemRow {
  name?: string;
  quantity?: number;
  description?: string;
  [key: string]: unknown;
}

interface StarlightInventoryProps {
  title?: string;
  items?: InventoryItemRow[];
  [key: string]: unknown;
}

function StarlightInventoryPanel(props: StarlightInventoryProps = {}) {
  const items = Array.isArray(props.items) ? props.items : [];
  const title = typeof props.title === "string" ? props.title : "Cargo Manifest";

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
  ctx.register("hud", { component: StarlightHud, position: "top", order: 10 });
  ctx.register("launcher:background", { component: StarlightLauncherBackground, order: 10 });
  ctx.register("panel:inventory", { component: StarlightInventoryPanel });
}
