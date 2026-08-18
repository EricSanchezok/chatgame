// Module 18: narrative/ — narrative assets (opening, style, lore, examples, event texts).
import { z } from "zod";
import { conditionSchema, extSchema, idSchema } from "./common";

export const openingSchema = z
  .object({
    scene: z.string().min(1),
    first_lines: z.array(z.string().min(1)).default([]),
    hooks: z
      .array(
        z
          .object({
            text: z.string().min(1),
            condition: conditionSchema.optional(),
          })
          .strict(),
      )
      .default([]),
    ext: extSchema,
  })
  .strict();

export const styleSchema = z
  .object({
    voice: z.string().min(1),
    tense: z.string().min(1),
    perspective: z.string().min(1),
    density: z.enum(["sparse", "normal", "dense"]),
    sentence_style: z.array(z.string().min(1)).default([]),
    forbidden_words: z.array(z.string().min(1)).default([]),
    ext: extSchema,
  })
  .strict();

export const loreEntrySchema = z
  .object({
    id: idSchema,
    keywords: z.array(z.string().min(1)).default([]),
    inject_when: z.enum(["always", "on_keyword", "on_location", "on_npc"]),
    locations: z.array(idSchema).optional(),
    npcs: z.array(idSchema).optional(),
    content: z.string().min(1),
    ext: extSchema,
  })
  .strict();

export const exampleExchangeSchema = z
  .object({
    player: z.string().min(1),
    npc: z.string().min(1),
  })
  .strict();

export const exampleDialogueSchema = z
  .object({
    npc_id: z.union([idSchema, z.literal("generic")]),
    exchanges: z.array(exampleExchangeSchema).min(1),
    ext: extSchema,
  })
  .strict();

export const eventTextSchema = z
  .object({
    event_id: idSchema,
    templates: z
      .array(
        z
          .object({
            tone: z.string().min(1),
            text: z.string().min(1),
            slot_vars: z.array(z.string().min(1)).default([]),
          })
          .strict(),
      )
      .min(1),
    ext: extSchema,
  })
  .strict();

export type Opening = z.infer<typeof openingSchema>;
export type Style = z.infer<typeof styleSchema>;
export type LoreEntry = z.infer<typeof loreEntrySchema>;
export type ExampleDialogue = z.infer<typeof exampleDialogueSchema>;
export type EventText = z.infer<typeof eventTextSchema>;
