// Shared schema primitives for the script format v1.0.
// Machine contract counterpart of docs/game-design/script-format.md.
import { z } from "zod";

/** Global entity id contract: lowercase letters/digits/hyphens, starting with a letter, stable after release. */
export const idSchema = z
  .string()
  .regex(
    /^[a-z][a-z0-9-]*$/,
    "id must be lowercase letters, digits, and hyphens, starting with a letter",
  );

/** Free-form extension slot, consumed by engine versions. */
export const extSchema = z.record(z.string(), z.unknown()).optional();

/** Condition algebra: recursive {all|any|not} logic over typed leaves. */

export const conditionOpSchema = z.enum([
  "gte",
  "lte",
  "gt",
  "lt",
  "eq",
  "neq",
  "has",
  "not_has",
  "in",
  "not_in",
]);

export type ConditionValue = number | string | boolean | Array<number | string>;

export type Condition =
  | {
      /** Built-in source id or a script-registered custom source. */
      source: string;
      key?: string;
      target?: string;
      op: z.infer<typeof conditionOpSchema>;
      value?: ConditionValue;
    }
  | { all: Condition[] }
  | { any: Condition[] }
  | { not: Condition };

const conditionLeafSchema = z.object({
  // Custom sources are allowed when declared and registered by the script's
  // Engine Extension v2; unregistered sources fail validation/runtime.
  source: z.string(),
  key: z.string().optional(),
  target: z.string().optional(),
  op: conditionOpSchema,
  value: z
    .union([
      z.number(),
      z.string(),
      z.boolean(),
      z.array(z.union([z.number(), z.string()])),
    ])
    .optional(),
});

export const conditionSchema: z.ZodType<Condition> = z.lazy(() =>
  z.union([
    conditionLeafSchema.strict(),
    z.object({ all: z.array(conditionSchema) }).strict(),
    z.object({ any: z.array(conditionSchema) }).strict(),
    z.object({ not: conditionSchema }).strict(),
  ]),
);

/** Effect algebra: discriminated by kind, with direction add|remove|set (default add) and explicit target. */
const effectDirectionSchema = z.enum(["add", "remove", "set"]).optional();
const effectTargetSchema = z.string();

/** Built-in effect kinds (validation gate for custom effect branches). */
export const BUILTIN_EFFECT_KINDS = new Set([
  "stat",
  "skill",
  "need",
  "item",
  "currency",
  "relation",
  "reputation",
  "flag",
  "teleport",
  "status",
  "memory",
  "secret",
  "event",
  "narrative",
]);

/** Custom effect kind branch: any kind outside the builtin set, free-form params. */
export const customEffectSchema = z
  .object({ kind: z.string() })
  .passthrough()
  .refine((e) => !BUILTIN_EFFECT_KINDS.has(e.kind), { message: "unknown effect kind" });

const builtinEffectSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("stat"),
      direction: effectDirectionSchema,
      target: effectTargetSchema,
      stat: idSchema,
      value: z.number(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("skill"),
      direction: effectDirectionSchema,
      target: effectTargetSchema,
      skill: idSchema,
      value: z.number(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("need"),
      direction: effectDirectionSchema,
      target: effectTargetSchema,
      need: idSchema,
      value: z.number(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("item"),
      direction: effectDirectionSchema,
      target: effectTargetSchema,
      item: idSchema,
      value: z.number().optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("currency"),
      direction: effectDirectionSchema,
      target: effectTargetSchema,
      value: z.number(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("relation"),
      direction: effectDirectionSchema,
      target: effectTargetSchema,
      npc: idSchema,
      value: z.number(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("reputation"),
      direction: effectDirectionSchema,
      target: effectTargetSchema,
      faction: idSchema,
      value: z.number(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("flag"),
      direction: effectDirectionSchema,
      target: effectTargetSchema,
      flag: idSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("teleport"),
      direction: z.literal("set").optional(),
      target: effectTargetSchema,
      location: idSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("status"),
      direction: effectDirectionSchema,
      target: effectTargetSchema,
      status: idSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("memory"),
      direction: z.literal("add").optional(),
      target: effectTargetSchema,
      text: z.string(),
      importance: z.enum(["major", "minor", "trivial"]).optional(),
      tags: z.array(z.string().min(1)).optional(),
      replaces: z.string().min(1).optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("secret"),
      direction: z.literal("set").optional(),
      target: effectTargetSchema,
      secret: idSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("event"),
      direction: z.literal("set").optional(),
      target: effectTargetSchema,
      event: idSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("narrative"),
      direction: z.literal("set").optional(),
      target: effectTargetSchema,
      text: z.string(),
    })
    .strict(),
]);

export type BuiltinEffect = z.infer<typeof builtinEffectSchema>;
export type CustomEffect = z.infer<typeof customEffectSchema>;
export type Effect = BuiltinEffect | CustomEffect;

/** Type guard: true when the effect is a framework built-in kind. */
export function isBuiltinEffect(effect: Effect): effect is BuiltinEffect {
  return BUILTIN_EFFECT_KINDS.has(effect.kind);
}

export const effectSchema: z.ZodType<Effect> = z.union([
  builtinEffectSchema,
  customEffectSchema,
]);


/** Time-of-day in 24h HH:MM. */
export const timeOfDaySchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "time must be HH:MM in 24h format");

/** Calendar date in MM-DD. */
export const monthDaySchema = z
  .string()
  .regex(/^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/, "date must be MM-DD");

/** Severity levels shared across modules. */
export const importanceSchema = z.enum(["major", "minor", "trivial"]);
