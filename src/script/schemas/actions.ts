// Module 5: actions.yaml — action vocabulary.
import { z } from "zod";
import { conditionSchema, effectSchema, extSchema, idSchema } from "./common";

export const builtinActionIdSchema = z.enum([
  "talk",
  "ask",
  "move",
  "travel",
  "investigate",
  "search",
  "persuade",
  "intimidate",
  "deceive",
  "attack",
  "defend",
  "flee",
  "use_item",
  "give",
  "take",
  "trade",
  "steal",
  "rest",
  "wait",
  "follow",
  "sneak",
  "gather",
  "craft",
  "repair",
  "cast",
  "disguise",
]);

const resolveSchema = z.discriminatedUnion("type", [
  z
    .object({ type: z.literal("stat_check"), stat: idSchema, dc: z.number() })
    .strict(),
  z
    .object({ type: z.literal("skill_check"), skill: idSchema, dc: z.number() })
    .strict(),
  z
    .object({
      type: z.literal("opposed_check"),
      stat: idSchema,
      npc_stat: idSchema,
    })
    .strict(),
  z.object({ type: z.literal("auto") }).strict(),
  z.object({ type: z.literal("narrative_only") }).strict(),
]);

const costsSchema = z
  .object({
    currency: z.number().nonnegative().optional(),
    items: z
      .array(z.object({ item: idSchema, quantity: z.number().int().positive() }).strict())
      .optional(),
    time: z.number().nonnegative().optional(),
  })
  .strict();

export const actionEntrySchema = z
  .object({
    id: builtinActionIdSchema,
    enabled: z.boolean().default(true),
    display_name: z.string().optional(),
    resolve: resolveSchema,
    conditions: conditionSchema.optional(),
    costs: costsSchema.optional(),
    effects: z.array(effectSchema).optional(),
    llm_freedom: z.enum(["narration", "process", "result"]).default("narration"),
    cooldown: z.number().nonnegative().optional(),
  })
  .strict();

export const actionsSchema = z
  .object({
    actions: z.array(actionEntrySchema).min(1),
    ext: extSchema,
  })
  .strict();

export type Actions = z.infer<typeof actionsSchema>;
