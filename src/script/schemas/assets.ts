// Module: assets.yaml — presentation asset index (optional root module).
// Single source of truth for all presentation assets (portraits,
// backgrounds, icons, sprites, voices, ambient, effects, illustrations, ui). Entity YAML
// files stay untouched: every key here references an existing npc/location/
// item/event id (hard validation error); file existence is a soft warning
// (prompt-only placeholders are legal — files can be added later). The `ui`
// section is a fixed chrome-icon slot set, decoupled from entity ids.
import { z } from "zod";
import { idSchema } from "./common";

/** Allowed asset file extensions (whitelist). */
const FILE_EXT_RE = /\.(svg|png|jpe?g|webp|gif|mp3|wav|ogg)$/i;

/** Framework chrome icon slots a script may override via assets.yaml `ui`. */
export const UI_ICON_SLOTS = [
  "inventory",
  "character",
  "relations",
  "tasks",
  "map",
  "log",
  "save",
  "audio_on",
  "audio_off",
  "close",
  "send",
  "warning",
  "hp",
  "location",
  "time",
] as const;

export type UiIconSlot = (typeof UI_ICON_SLOTS)[number];

/** Ui slot keys are validated against UI_ICON_SLOTS in validate-presentation (hard error). */

const fileEntrySchema = z
  .object({
    /** Path relative to the script root, under assets/. */
    file: z.string().regex(FILE_EXT_RE, "asset file must be svg/png/jpg/jpeg/webp/gif/mp3/wav/ogg").optional(),
    /** Image-generation prompt placeholder (used when file is missing and a media provider is configured). */
    prompt: z.string().min(1).optional(),
    /** Accessible alt text for images. */
    alt: z.string().min(1).optional(),
    /** Voice profile hint for TTS (voices only). */
    profile: z.string().min(1).optional(),
  })
  .strict()
  .refine((v) => v.file !== undefined || v.prompt !== undefined, {
    message: "entry must declare a file and/or a prompt",
  });

export const assetsSchema = z
  .object({
    /** Static launcher cover. It must be a local file; generated media is not launcher truth. */
    cover: fileEntrySchema
      .refine((entry) => entry.file !== undefined, { message: "cover must declare a local file" })
      .optional(),
    /** NPC portraits, keyed by npc id. */
    portraits: z.record(idSchema, fileEntrySchema).default({}),
    /** Location background scenes, keyed by location id. */
    backgrounds: z.record(idSchema, fileEntrySchema).default({}),
    /** Item/faction icons, keyed by item id. */
    icons: z.record(idSchema, fileEntrySchema).default({}),
    /** Animated character sprites, keyed by npc id. */
    sprites: z.record(idSchema, fileEntrySchema).default({}),
    /** NPC voices, keyed by npc id. */
    voices: z.record(idSchema, fileEntrySchema).default({}),
    /** Ambient loops per location, keyed by location id. */
    ambient: z.record(idSchema, fileEntrySchema).default({}),
    /** One-shot sound effects per event, keyed by event id. */
    effects: z.record(idSchema, fileEntrySchema).default({}),
    /** Event and encounter illustrations, keyed by event id. */
    illustrations: z.record(idSchema, fileEntrySchema).default({}),
    /** Framework chrome icons, keyed by fixed UI slot (validated semantically). */
    ui: z.record(z.string(), fileEntrySchema).default({}),
  })
  .strict();

export type AssetsManifest = z.infer<typeof assetsSchema>;
export type AssetEntry = z.infer<typeof fileEntrySchema>;

/** Keys of the manifest whose values must reference an entity id. */
export const ASSET_KIND_ENTITY_POOL: Record<string, "npc" | "location" | "item" | "event"> = {
  portraits: "npc",
  sprites: "npc",
  voices: "npc",
  backgrounds: "location",
  ambient: "location",
  icons: "item",
  effects: "event",
  illustrations: "event",
} as const;
