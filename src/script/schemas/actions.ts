// Module 5: actions.yaml — action vocabulary.
import { z } from "zod";
import { conditionSchema, effectSchema, extSchema, idSchema } from "./common";

/** Built-in action ids (framework vocabulary). Scripts may add custom
 *  action ids beyond this set — they must declare a `handler` that the
 *  script's engine extension registers at load time. */
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

/** Built-in action id list (for vocabulary checks). */
export const BUILTIN_ACTION_IDS = builtinActionIdSchema.options;

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

/** Action id: built-in ids use underscores (use_item); custom handler ids
 *  follow the same contract. */
const actionIdSchema = z
  .string()
  .regex(
    /^[a-z][a-z0-9_-]*$/,
    "action id must be lowercase letters, digits, hyphens, or underscores, starting with a letter",
  );

export const actionEntrySchema = z
  .object({
    id: actionIdSchema,
    enabled: z.boolean().default(true),
    display_name: z.string().optional(),
    // resolve is optional when a custom `handler` is declared (the handler
    // owns resolution semantics); otherwise required.
    resolve: resolveSchema.optional(),
    conditions: conditionSchema.optional(),
    costs: costsSchema.optional(),
    effects: z.array(effectSchema).optional(),
    llm_freedom: z.enum(["narration", "process", "result"]).default("narration"),
    cooldown: z.number().nonnegative().optional(),
    /** Custom action handler id (script engine extension); builtin ids use
     *  the framework registry when no handler is declared. */
    handler: idSchema.optional(),
  })
  .strict()
  .refine((a) => a.resolve !== undefined || a.handler !== undefined, {
    message: "action must declare a resolve type or a custom handler",
  });

export type ActionEntry = z.infer<typeof actionEntrySchema>;

export const actionsSchema = z
  .object({
    actions: z.array(actionEntrySchema).min(1),
    ext: extSchema,
  })
  .strict();

export type Actions = z.infer<typeof actionsSchema>;
