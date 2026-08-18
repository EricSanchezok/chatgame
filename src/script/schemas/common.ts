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
export const conditionSourceSchema = z.enum([
  "stat",
  "skill",
  "need",
  "flag",
  "fact",
  "relationship",
  "reputation",
  "time",
  "location",
  "inventory",
  "currency",
]);

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
      source: z.infer<typeof conditionSourceSchema>;
      key?: string;
      target?: string;
      op: z.infer<typeof conditionOpSchema>;
      value?: ConditionValue;
    }
  | { all: Condition[] }
  | { any: Condition[] }
  | { not: Condition };

const conditionLeafSchema = z.object({
  source: conditionSourceSchema,
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

export const effectSchema = z.discriminatedUnion("kind", [
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

export type Effect = z.infer<typeof effectSchema>;

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
export const stanceSchema = z.enum([
  "hostile",
  "wary",
  "neutral",
  "friendly",
  "allied",
  "romantic",
]);
