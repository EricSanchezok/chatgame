// Theme application: a flat ThemeView -> CSS custom properties on an
// element (document.documentElement by default). The UI consumes only
// semantic variables; a 600ms transition in globals.css smooths switches.
// Testable in node via an explicit target (no DOM dependency).

export interface ThemePalette {
  background: string;
  surface: string;
  surface_alt: string;
  primary: string;
  accent: string;
  text: string;
  text_dim: string;
  border: string;
}

export interface ThemeView {
  id: string;
  name: string;
  palette: ThemePalette;
  typography: { font: "serif" | "sans" | "mono"; scale: number };
  effects: {
    bubble_radius: number;
    glass: number;
    motion: "minimal" | "subtle" | "standard" | "playful";
    scene_tint: string;
  };
}

/** Element surface we write CSS variables onto (subset of HTMLElement). */
export interface CssTarget {
  style: { setProperty(name: string, value: string): void };
}

const PALETTE_VARS: Record<keyof ThemePalette, string> = {
  background: "--cg-background",
  surface: "--cg-surface",
  surface_alt: "--cg-surface-alt",
  primary: "--cg-primary",
  accent: "--cg-accent",
  text: "--cg-text",
  text_dim: "--cg-text-dim",
  border: "--cg-border",
};

/** Font stacks per theme typography font (CJK-safe fallbacks). */
const FONT_STACKS: Record<ThemeView["typography"]["font"], string> = {
  serif: `Georgia, "Songti SC", "Noto Serif SC", "SimSun", serif`,
  sans: `-apple-system, "PingFang SC", "Noto Sans SC", "Microsoft YaHei", sans-serif`,
  mono: `"SF Mono", Menlo, "Noto Sans Mono CJK SC", monospace`,
};

/**
 * Applies a theme to the target element's inline style. Every field maps
 * to a `--cg-*` variable; the motion enum lands on a data attribute that
 * CSS keyed animations consult (reduced-motion is respected in CSS).
 */
export function applyTheme(theme: ThemeView, target?: CssTarget): void {
  const el = target ?? (typeof document !== "undefined" ? document.documentElement : undefined);
  if (!el) return;
  for (const [key, cssVar] of Object.entries(PALETTE_VARS) as Array<
    [keyof ThemePalette, string]
  >) {
    el.style.setProperty(cssVar, theme.palette[key]);
  }
  el.style.setProperty("--cg-font", FONT_STACKS[theme.typography.font]);
  el.style.setProperty("--cg-scale", String(theme.typography.scale));
  el.style.setProperty("--cg-radius", `${theme.effects.bubble_radius}px`);
  el.style.setProperty("--cg-glass", String(theme.effects.glass));
  el.style.setProperty("--cg-tint", theme.effects.scene_tint);
  el.style.setProperty("--cg-motion", theme.effects.motion);
}

/** Converts a hex color to an rgba() string with the given alpha. */
export function rgba(hex: string, alpha: number): string {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
