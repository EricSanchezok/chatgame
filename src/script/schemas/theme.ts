// Module: theme.yaml + themes/ — script presentation themes (optional).
// A script may ship a root theme.yaml (the "default" theme) plus extra
// themes under themes/*.yaml. The default theme can remap the visual theme
// per player location via by_location (theme id reference or inline
// override). All colors are whitelisted hex; all ranges clamped; no
// arbitrary CSS is accepted anywhere (whitelist-only token model).
import { z } from "zod";
import { idSchema } from "./common";

/** Hex color: #rgb / #rgba / #rrggbb / #rrggbbaa. Strict whitelist — no CSS injection surface. */
const hexColorSchema = z
  .string()
  .regex(/^#[0-9a-fA-F]{3,8}$/, "color must be a #rgb/#rgba/#rrggbb/#rrggbbaa hex value");

/** CSS font-family name: printable ASCII word characters/spaces/hyphens, no quote/slash/backslash/control. */
const fontFamilySchema = z
  .string()
  .regex(
    /^[A-Za-z0-9][A-Za-z0-9 _-]{0,62}$/,
    "font family must start with an alphanumeric and contain only letters, digits, spaces, underscores, and hyphens",
  );

/** Allowed local font file extensions (whitelist, script-bundled only). */
const FONT_EXT_RE = /\.(woff2|woff|ttf|otf)$/i;

/** A single font face variant backed by a script-bundled file under assets/fonts/. */
const fontFileSchema = z
  .object({
    /** Path relative to the script root, must live under assets/fonts/. */
    file: z
      .string()
      .regex(FONT_EXT_RE, "font file must be woff2/woff/ttf/otf")
      .refine((p) => p.startsWith("assets/fonts/"), {
        message: "font file must be under assets/fonts/",
      }),
    /** Numeric weight 100–900 (default 400). */
    weight: z.number().int().min(100).max(900).default(400),
    /** Font style. */
    style: z.enum(["normal", "italic"]).default("normal"),
  })
  .strict();

/** A named font face: a stable id + family + one or more local files. */
const fontFaceSchema = z
  .object({
    id: idSchema,
    family: fontFamilySchema,
    files: z.array(fontFileSchema).min(1),
  })
  .strict();

/** System font roles (fallbacks when a script ships no custom faces). */
const systemFontRoleSchema = z.enum(["serif", "sans", "mono"]);

/** CSS font roles: either a declared face id or a system role. */
const fontRoleSchema = z.union([idSchema, systemFontRoleSchema]);

/** Semantic palette consumed exclusively through `--cg-*` variables. */
const paletteSchema = z
  .object({
    background: hexColorSchema,
    surface: hexColorSchema,
    surface_alt: hexColorSchema,
    primary: hexColorSchema,
    on_primary: hexColorSchema,
    accent: hexColorSchema,
    text: hexColorSchema,
    text_dim: hexColorSchema,
    border: hexColorSchema,
    focus: hexColorSchema,
    success: hexColorSchema,
    warning: hexColorSchema,
    danger: hexColorSchema,
    selected: hexColorSchema,
  })
  .strict();

/** Typography: system roles + scale + line-height + letter-spacing + local faces. */
const typographySchema = z
  .object({
    /** System fallback role when no custom face is declared for a role. */
    font: systemFontRoleSchema.default("sans"),
    /** Global type scale multiplier. */
    scale: z.number().min(0.85).max(1.3).default(1.0),
    /** Line-height multiplier. */
    line_height: z.number().min(1.2).max(1.8).default(1.6),
    /** Letter-spacing in em units (signed, clamped). */
    letter_spacing_em: z.number().min(-0.04).max(0.12).default(0),
    /** Optional script-bundled font faces. */
    faces: z.array(fontFaceSchema).default([]),
    /** CSS role → face id or system role. */
    roles: z
      .object({
        ui: fontRoleSchema.optional(),
        narrative: fontRoleSchema.optional(),
        mono: fontRoleSchema.optional(),
      })
      .strict()
      .default({}),
  })
  .strict()
  .default({ font: "sans", scale: 1.0, line_height: 1.6, letter_spacing_em: 0, faces: [], roles: {} });

/** Effects: radius/blur/glass/shadow/border/density/motion/tint/overlay. */
const effectsSchema = z
  .object({
    /** Chat bubble radius (px). */
    bubble_radius: z.number().min(0).max(24).default(14),
    /** Chrome radius (px): shell/buttons/modals. */
    chrome_radius: z.number().min(0).max(24).default(12),
    /** Glass opacity 0–1 (chrome translucency). */
    glass: z.number().min(0).max(1).default(0.65),
    /** Backdrop blur (px) on glass chrome. */
    blur_px: z.number().min(0).max(24).default(8),
    /** Shadow strength keyword (framework maps to a closed token set). */
    shadow: z.enum(["none", "soft", "medium", "hard"]).default("medium"),
    /** Border width (px) for chrome. */
    border_width_px: z.number().int().min(1).max(3).default(1),
    /** Spacing density keyword. */
    density: z.enum(["compact", "cozy", "comfy"]).default("cozy"),
    /** Motion tier. */
    motion: z.enum(["minimal", "subtle", "standard", "playful"]).default("subtle"),
    /** Ambient scene tint color. */
    scene_tint: hexColorSchema.default("#000000"),
    /** Modal/backdrop overlay strength 0–0.8. */
    overlay_strength: z.number().min(0).max(0.8).default(0.45),
  })
  .strict()
  .default({
    bubble_radius: 14,
    chrome_radius: 12,
    glass: 0.65,
    blur_px: 8,
    shadow: "medium",
    border_width_px: 1,
    density: "cozy",
    motion: "subtle",
    scene_tint: "#000000",
    overlay_strength: 0.45,
  });


/** Inline per-location effects override (safe whitelist; no new faces). */
const effectsOverrideSchema = z
  .object({
    bubble_radius: z.number().min(0).max(24).optional(),
    chrome_radius: z.number().min(0).max(24).optional(),
    glass: z.number().min(0).max(1).optional(),
    blur_px: z.number().min(0).max(24).optional(),
    shadow: z.enum(["none", "soft", "medium", "hard"]).optional(),
    border_width_px: z.number().int().min(1).max(3).optional(),
    density: z.enum(["compact", "cozy", "comfy"]).optional(),
    motion: z.enum(["minimal", "subtle", "standard", "playful"]).optional(),
    scene_tint: hexColorSchema.optional(),
    overlay_strength: z.number().min(0).max(0.8).optional(),
  })
  .strict();

/** Inline per-location typography override (safe subset; no new faces). */
const typographyOverrideSchema = z
  .object({
    scale: z.number().min(0.85).max(1.3).optional(),
    line_height: z.number().min(1.2).max(1.8).optional(),
    letter_spacing_em: z.number().min(-0.04).max(0.12).optional(),
    roles: z
      .object({
        ui: fontRoleSchema.optional(),
        narrative: fontRoleSchema.optional(),
        mono: fontRoleSchema.optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

/**
 * Inline per-location override: palette subset + optional effects/typography
 * subsets. faces are NOT inlinable here — use a full theme id reference to
 * swap bundled faces without per-location reload churn.
 */
const locationOverrideSchema = z
  .object({
    background: hexColorSchema.optional(),
    surface: hexColorSchema.optional(),
    surface_alt: hexColorSchema.optional(),
    primary: hexColorSchema.optional(),
    on_primary: hexColorSchema.optional(),
    accent: hexColorSchema.optional(),
    text: hexColorSchema.optional(),
    text_dim: hexColorSchema.optional(),
    border: hexColorSchema.optional(),
    focus: hexColorSchema.optional(),
    success: hexColorSchema.optional(),
    warning: hexColorSchema.optional(),
    danger: hexColorSchema.optional(),
    selected: hexColorSchema.optional(),
    effects: effectsOverrideSchema.optional(),
    typography: typographyOverrideSchema.optional(),
  })
  .strict();

/** by_location value: a theme id reference OR an inline override. */
const locationThemeSchema = z.union([idSchema, locationOverrideSchema]);

export const themeSchema = z
  .object({
    id: idSchema,
    name: z.string().min(1),
    palette: paletteSchema,
    typography: typographySchema,
    effects: effectsSchema,
    by_location: z.record(idSchema, locationThemeSchema).default({}),
  })
  .strict();

export type Theme = z.infer<typeof themeSchema>;
export type ThemePalette = z.infer<typeof paletteSchema>;
export type PaletteOverride = Partial<ThemePalette>;
export type EffectsOverride = z.infer<typeof effectsOverrideSchema>;
export type TypographyOverride = z.infer<typeof typographyOverrideSchema>;
export type FontFace = z.infer<typeof fontFaceSchema>;
export type FontFile = z.infer<typeof fontFileSchema>;
export type FontRole = z.infer<typeof fontRoleSchema>;
export type SystemFontRole = z.infer<typeof systemFontRoleSchema>;
export type LocationTheme = z.infer<typeof locationThemeSchema>;
