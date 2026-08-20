// Theme application: a flat ThemeView -> CSS custom properties on an
// element (document.documentElement by default) + optional @font-face
// injection for script-bundled fonts. The UI consumes only semantic
// variables; a 600ms transition in globals.css smooths switches.
// Testable in node via an explicit target (no DOM dependency).

import type {
  FontRole,
  SystemFontRole,
  ThemeEffects,
  ThemeFontFace,
  ThemePalette,
  ThemeView,
} from "../../shared/client-dto";

export type {
  FontRole,
  SystemFontRole,
  ThemeEffects,
  ThemeFontFace,
  ThemeFontFile,
  ThemePalette,
  ThemeTypography,
  ThemeView,
} from "../../shared/client-dto";

/** Element surface we write CSS variables onto (subset of HTMLElement). */
export interface CssTarget {
  style: { setProperty(name: string, value: string): void };
}

export const HOST_THEME: ThemeView = {
  id: "host-programme",
  name: "剧目单后台",
  palette: {
    background: "#10110f",
    surface: "#1b1d1a",
    surface_alt: "#272924",
    primary: "#efe9dc",
    on_primary: "#10110f",
    accent: "#c6a15b",
    text: "#efe9dc",
    text_dim: "#aaa69d",
    border: "#454840",
    focus: "#8ec9ba",
    success: "#82b99e",
    warning: "#e3b55e",
    danger: "#d66a55",
    selected: "#34362f",
  },
  typography: {
    font: "sans",
    scale: 1,
    line_height: 1.65,
    letter_spacing_em: 0,
    faces: [],
    roles: { ui: "sans", narrative: "sans", mono: "mono" },
  },
  effects: {
    bubble_radius: 14,
    chrome_radius: 12,
    glass: 0,
    blur_px: 0,
    shadow: "soft",
    border_width_px: 1,
    density: "cozy",
    motion: "minimal",
    scene_tint: "#10110f",
    overlay_strength: 0.78,
  },
};

export function applyHostTheme(target?: CssTarget): void {
  applyTheme(HOST_THEME, target);
}


/** Resolves a script-relative asset file path to a URL (mirrors lib/api). */
export type AssetUrlFn = (file: string) => string;

const PALETTE_VARS: Record<keyof ThemePalette, string> = {
  background: "--cg-background",
  surface: "--cg-surface",
  surface_alt: "--cg-surface-alt",
  primary: "--cg-primary",
  on_primary: "--cg-on-primary",
  accent: "--cg-accent",
  text: "--cg-text",
  text_dim: "--cg-text-dim",
  border: "--cg-border",
  focus: "--cg-focus",
  success: "--cg-success",
  warning: "--cg-warning",
  danger: "--cg-danger",
  selected: "--cg-selected",
};

/** Font stacks per system font role (CJK-safe fallbacks). */
const FONT_STACKS: Record<SystemFontRole, string> = {
  serif: `Georgia, "Songti SC", "Noto Serif SC", "SimSun", serif`,
  sans: `-apple-system, "PingFang SC", "Noto Sans SC", "Microsoft YaHei", sans-serif`,
  mono: `"SF Mono", Menlo, "Noto Sans Mono CJK SC", monospace`,
};

/** Closed shadow token set (framework maps keywords; authors cannot pass raw CSS). */
const SHADOW_VALUES: Record<ThemeEffects["shadow"], string> = {
  none: "none",
  soft: "0 2px 12px rgba(0, 0, 0, 0.18)",
  medium: "0 8px 28px rgba(0, 0, 0, 0.28)",
  hard: "0 16px 48px rgba(0, 0, 0, 0.45)",
};

/** Closed spacing scale per density tier (--cg-space-1..4). */
const DENSITY_SPACES: Record<ThemeEffects["density"], Record<"1" | "2" | "3" | "4", string>> = {
  compact: { 1: "4px", 2: "8px", 3: "12px", 4: "16px" },
  cozy: { 1: "6px", 2: "12px", 3: "18px", 4: "24px" },
  comfy: { 1: "8px", 2: "16px", 3: "24px", 4: "32px" },
};

/** Resolves a font role to a CSS family list (face family first, system fallback). */
function roleFamily(
  role: FontRole | undefined,
  faces: ThemeFontFace[],
  defaultRole: SystemFontRole,
): string {
  const face = faces.find((f) => f.id === role);
  if (face) return `"${face.family}", ${FONT_STACKS.sans}`;
  const system = role === "serif" || role === "sans" || role === "mono" ? role : defaultRole;
  return FONT_STACKS[system];
}

/**
 * Applies a theme to the target element's inline style. Every field maps to
 * a `--cg-*` variable; shadow/density land on closed framework token sets;
 * script faces become @font-face rules in a single <style data-cg-fonts>.
 * Family names were whitelisted at the schema layer — no CSS injection.
 */
export function applyTheme(
  theme: ThemeView,
  target?: CssTarget,
  options: { assetUrl?: AssetUrlFn } = {},
): void {
  const el = target ?? (typeof document !== "undefined" ? document.documentElement : undefined);
  if (!el) return;
  for (const [key, cssVar] of Object.entries(PALETTE_VARS) as Array<
    [keyof ThemePalette, string]
  >) {
    el.style.setProperty(cssVar, theme.palette[key]);
  }

  // Typography roles: ui / narrative / mono families.
  const faces = theme.typography.faces;
  const uiRole = theme.typography.roles.ui ?? theme.typography.font;
  const narrativeRole = theme.typography.roles.narrative ?? uiRole;
  const monoRole = theme.typography.roles.mono ?? "mono";
  el.style.setProperty("--cg-font", roleFamily(uiRole, faces, theme.typography.font));
  el.style.setProperty("--cg-font-narrative", roleFamily(narrativeRole, faces, theme.typography.font));
  el.style.setProperty("--cg-font-mono", roleFamily(monoRole, faces, "mono"));

  // Typography metrics.
  el.style.setProperty("--cg-scale", String(theme.typography.scale));
  el.style.setProperty("--cg-line-height", String(theme.typography.line_height));
  el.style.setProperty("--cg-letter-spacing", `${theme.typography.letter_spacing_em}em`);

  // Shape / material tokens.
  el.style.setProperty("--cg-radius", `${theme.effects.bubble_radius}px`);
  el.style.setProperty("--cg-radius-chrome", `${theme.effects.chrome_radius}px`);
  el.style.setProperty("--cg-glass", String(theme.effects.glass));
  el.style.setProperty("--cg-blur", `${theme.effects.blur_px}px`);
  el.style.setProperty("--cg-border-width", `${theme.effects.border_width_px}px`);
  el.style.setProperty("--cg-shadow", theme.effects.shadow);
  el.style.setProperty("--cg-shadow-value", SHADOW_VALUES[theme.effects.shadow]);
  el.style.setProperty("--cg-density", theme.effects.density);
  const spaces = DENSITY_SPACES[theme.effects.density];
  el.style.setProperty("--cg-space-1", spaces["1"]);
  el.style.setProperty("--cg-space-2", spaces["2"]);
  el.style.setProperty("--cg-space-3", spaces["3"]);
  el.style.setProperty("--cg-space-4", spaces["4"]);

  // Ambient / overlay / motion.
  el.style.setProperty("--cg-tint", theme.effects.scene_tint);
  el.style.setProperty("--cg-overlay-strength", String(theme.effects.overlay_strength));
  el.style.setProperty("--cg-motion", theme.effects.motion);

  // Font faces: replace the previous theme's @font-face block (if any).
  if (typeof document !== "undefined" && faces.length > 0 && options.assetUrl) {
    injectFontFaces(theme, options.assetUrl, document);
  } else if (typeof document !== "undefined") {
    document.querySelector("style[data-cg-fonts]")?.remove();
  }
}

/** Builds and swaps the single <style data-cg-fonts> @font-face block. */
function injectFontFaces(theme: ThemeView, assetUrl: AssetUrlFn, doc: Document): void {
  const previous = doc.querySelector("style[data-cg-fonts]");
  if (previous) previous.remove();
  const style = doc.createElement("style");
  style.setAttribute("data-cg-fonts", "");
  const rules = theme.typography.faces
    .flatMap((face) => face.files.map((file) =>
      `@font-face{font-family:"${face.family}";font-style:${file.style};font-weight:${file.weight};font-display:swap;src:url("${assetUrl(file.file)}") format("${fontFormat(file.file)}");}`,
    ))
    .join("\n");
  style.innerHTML = rules;
  doc.head.appendChild(style);
}

/** Maps a font file extension to its CSS format hint. */
function fontFormat(file: string): string {
  const ext = file.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "woff2":
      return "woff2";
    case "woff":
      return "woff";
    case "ttf":
      return "truetype";
    case "otf":
      return "opentype";
    default:
      return "woff2";
  }
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
