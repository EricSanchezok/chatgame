// Emberfall UI extension: registers a script-styled HUD (ember badge +
// health bar), a launcher cover built from the town-square scene, and a
// copper-paneled inventory panel. Self-contained — only imports react; all
// colors come from the --cg-* variables applied by the theme system. Slot
// props are untyped at the seam, so every component falls back to sensible
// defaults when the host renderer passes nothing.
import { useState, type CSSProperties } from "react";

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

const TOWN_SQUARE_SCENE = "/api/scripts/emberfall/assets/backgrounds/town-square.svg";

interface EmberfallHudProps {
  hp?: number;
  hpMax?: number;
  day?: number;
  hour?: number;
  location?: string;
  [key: string]: unknown;
}

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, value));
}

function EmberfallHud(props: EmberfallHudProps = {}) {
  const [dimmed, setDimmed] = useState(false);
  const hp = typeof props.hp === "number" ? props.hp : 80;
  const hpMax = typeof props.hpMax === "number" ? props.hpMax : 100;
  const percent = clampPercent((hp / Math.max(1, hpMax)) * 100);
  const day = typeof props.day === "number" ? props.day : 1;
  const hour = typeof props.hour === "number" ? props.hour : 8;
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
    fontFamily: "var(--cg-font, serif)",
    letterSpacing: "var(--cg-letter-spacing, 0)",
    opacity: dimmed ? 0.55 : 1,
    transition: "opacity 300ms ease",
  };

  const badge: CSSProperties = {
    width: 34,
    height: 34,
    borderRadius: "50%",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "var(--cg-surface-alt)",
    border: "var(--cg-border-width, 1px) solid var(--cg-border)",
    cursor: "pointer",
  };

  const barTrack: CSSProperties = {
    position: "relative",
    width: 140,
    height: 14,
    borderRadius: 999,
    background: "var(--cg-surface-alt)",
    border: "var(--cg-border-width, 1px) solid var(--cg-border)",
    overflow: "hidden",
  };

  const barFill: CSSProperties = {
    width: `${percent}%`,
    height: "100%",
    borderRadius: "999 0 0 999",
    background: "linear-gradient(90deg, var(--cg-primary), var(--cg-accent))",
    transition: "width 400ms ease",
  };

  const meta: CSSProperties = {
    display: "flex",
    flexDirection: "column",
    gap: 2,
    color: "var(--cg-text-dim)",
    fontSize: "calc(0.78rem * var(--cg-scale, 1))",
    lineHeight: 1.2,
  };

  return (
    <div style={frame} role="status" aria-label="emberfall hud">
      <button
        type="button"
        style={badge}
        onClick={() => setDimmed((v) => !v)}
        aria-label={dimmed ? "show ember gauge" : "hide ember gauge"}
        title="Ember gauge"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
          <path
            d="M12 3 C8 9 6 12 6 16 a6 6 0 0 0 12 0 C18 12 16 9 12 3 Z"
            fill="var(--cg-accent)"
            opacity={dimmed ? 0.4 : 1}
          />
          <path d="M12 9 C10.5 12 9.5 14 9.5 16 a2.5 2.5 0 0 0 5 0 C14.5 14 13.5 12 12 9 Z" fill="var(--cg-surface)" />
        </svg>
      </button>
      <div style={barTrack}>
        <div style={barFill} />
      </div>
      <span style={{ color: "var(--cg-text)", fontSize: "calc(0.82rem * var(--cg-scale, 1))" }}>
        {Math.round(hp)}/{hpMax} HP
      </span>
      <div style={meta}>
        <span>Day {day} · {String(hour).padStart(2, "0")}:00</span>
        {location ? <span style={{ color: "var(--cg-text)" }}>{location}</span> : null}
      </div>
    </div>
  );
}

function EmberfallLauncherBackground() {
  const root: CSSProperties = { position: "absolute", inset: 0, overflow: "hidden" };
  const wash: CSSProperties = {
    position: "absolute",
    inset: 0,
    background:
      "linear-gradient(180deg, var(--cg-background) 0%, transparent 42%, var(--cg-background) 100%)",
  };
  return (
    <div style={root} aria-hidden="true">
      {/* eslint-disable-next-line @next/next/no-img-element -- script ui bundle runs outside the Next image pipeline */}
      <img src={TOWN_SQUARE_SCENE} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
      <div style={wash} />
    </div>
  );
}

interface InventoryItemRow {
  name?: string;
  quantity?: number;
  description?: string;
  [key: string]: unknown;
}

interface EmberfallInventoryProps {
  title?: string;
  items?: InventoryItemRow[];
  [key: string]: unknown;
}

function EmberfallInventoryPanel(props: EmberfallInventoryProps = {}) {
  const items = Array.isArray(props.items) ? props.items : [];
  const title = typeof props.title === "string" ? props.title : "Pack";

  const root: CSSProperties = {
    display: "flex",
    flexDirection: "column",
    gap: "var(--cg-space-2, 8px)",
    padding: "var(--cg-space-3, 12px)",
    borderRadius: "var(--cg-radius-chrome, 12px)",
    background: "var(--cg-surface)",
    border: "var(--cg-border-width, 1px) solid var(--cg-border)",
    fontFamily: "var(--cg-font, serif)",
  };
  const row: CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: "var(--cg-space-2, 8px)",
    padding: "var(--cg-space-2, 8px)",
    borderRadius: "var(--cg-radius, 14px)",
    background: "var(--cg-surface-alt)",
  };
  const name: CSSProperties = { color: "var(--cg-text)", fontSize: "calc(0.9rem * var(--cg-scale, 1))" };
  const count: CSSProperties = {
    marginLeft: "auto",
    color: "var(--cg-accent)",
    fontSize: "calc(0.85rem * var(--cg-scale, 1))",
  };
  const desc: CSSProperties = {
    color: "var(--cg-text-dim)",
    fontSize: "calc(0.75rem * var(--cg-scale, 1))",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  };

  return (
    <div style={root}>
      <header style={{ color: "var(--cg-accent)", fontSize: "calc(0.9rem * var(--cg-scale, 1))" }}>{title}</header>
      {items.length === 0 ? (
        <p style={{ color: "var(--cg-text-dim)", margin: 0, fontSize: "calc(0.8rem * var(--cg-scale, 1))" }}>
          Your pack is empty.
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

export default function registerEmberfallUi(ctx: ScriptUiContext): void {
  ctx.register("hud", { component: EmberfallHud, position: "top", order: 10 });
  ctx.register("launcher:background", { component: EmberfallLauncherBackground, order: 10 });
  ctx.register("panel:inventory", { component: EmberfallInventoryPanel });
}
