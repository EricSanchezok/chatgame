// Module: theme.yaml + themes/ — script presentation themes (optional).
// A script may ship a root theme.yaml (the "default" theme) plus extra
// themes under themes/*.yaml. The default theme can remap the visual theme
// per player location via by_location (theme id reference or inline
// palette override). All colors are whitelisted hex; all ranges clamped.
import { z } from "zod";
import { idSchema } from "./common";

/** Hex color: #rgb / #rgba / #rrggbb / #rrggbbaa. Strict whitelist — no CSS injection surface. */
const hexColorSchema = z
  .string()
  .regex(/^#[0-9a-fA-F]{3,8}$/, "color must be a #rgb/#rgba/#rrggbb/#rrggbbaa hex value");

const paletteSchema = z
  .object({
    background: hexColorSchema,
    surface: hexColorSchema,
    surface_alt: hexColorSchema,
    primary: hexColorSchema,
    accent: hexColorSchema,
    text: hexColorSchema,
    text_dim: hexColorSchema,
    border: hexColorSchema,
  })
  .strict();

const typographySchema = z
  .object({
    font: z.enum(["serif", "sans", "mono"]).default("sans"),
    scale: z.number().min(0.85).max(1.3).default(1.0),
  })
  .strict()
  .default({ font: "sans", scale: 1.0 });

const effectsSchema = z
  .object({
    bubble_radius: z.number().min(0).max(24).default(14),
    glass: z.number().min(0).max(1).default(0.65),
    motion: z.enum(["minimal", "subtle", "standard", "playful"]).default("subtle"),
    scene_tint: hexColorSchema.default("#000000"),
  })
  .strict()
  .default({ bubble_radius: 14, glass: 0.65, motion: "subtle", scene_tint: "#000000" });

/** Inline per-location override: any subset of palette fields. */
const paletteOverrideSchema = z
  .object({
    background: hexColorSchema.optional(),
    surface: hexColorSchema.optional(),
    surface_alt: hexColorSchema.optional(),
    primary: hexColorSchema.optional(),
    accent: hexColorSchema.optional(),
    text: hexColorSchema.optional(),
    text_dim: hexColorSchema.optional(),
    border: hexColorSchema.optional(),
  })
  .strict();

/** by_location value: a theme id reference OR an inline palette override. */
const locationThemeSchema = z.union([idSchema, paletteOverrideSchema]);

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
export type PaletteOverride = z.infer<typeof paletteOverrideSchema>;
