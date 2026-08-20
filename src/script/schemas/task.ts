// Module 17: tasks/ — radiant quest templates.
import { z } from "zod";
import { conditionSchema, effectSchema, extSchema, idSchema } from "./common";

const itemTypeSchema = z.enum([
  "consumable",
  "equipment",
  "quest",
  "material",
  "currency_item",
  "misc",
]);

const taskObjectiveSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("gather"),
    target: z.object({ items: z.array(idSchema).min(1).optional(), of_type: itemTypeSchema.optional() }).strict()
      .refine((target) => target.items !== undefined || target.of_type !== undefined, "gather target requires items or of_type"),
    quantity: z.number().int().positive().default(1),
  }).strict(),
  z.object({
    type: z.literal("deliver"),
    target: z.object({ item: idSchema, recipient: idSchema }).strict(),
    quantity: z.number().int().positive().default(1),
  }).strict(),
  z.object({ type: z.literal("hunt"), target: z.object({ npc: idSchema }).strict(), quantity: z.number().int().positive().default(1) }).strict(),
  z.object({
    type: z.literal("escort"),
    target: z.object({ npc: idSchema.optional(), destination: idSchema.optional(), any: z.literal(true).optional() }).strict()
      .refine((target) => target.any === true || target.npc !== undefined, "escort target requires npc or any"),
    quantity: z.number().int().positive().default(1),
  }).strict(),
  z.object({
    type: z.literal("investigate"),
    target: z.union([
      z.object({ marker: z.object({ source: z.enum(["flag", "fact"]), key: idSchema }).strict() }).strict(),
      z.object({ any: z.literal(true) }).strict(),
    ]),
    quantity: z.number().int().positive().default(1),
  }).strict(),
  z.object({ type: z.literal("persuade"), target: z.object({ npc: idSchema }).strict(), quantity: z.number().int().positive().default(1) }).strict(),
  z.object({ type: z.literal("travel"), target: z.object({ location: idSchema }).strict(), quantity: z.number().int().positive().default(1) }).strict(),
]);

const giverSchema = z
  .object({
    pool: z.array(idSchema).min(1),
    condition: conditionSchema.optional(),
  })
  .strict();

const taskNarrativeSchema = z
  .object({
    offer: z.string().min(1),
    complete: z.string().min(1),
    fail: z.string().min(1),
  })
  .strict();

export const taskSchema = z
  .object({
    id: idSchema,
    name: z.string().min(1),
    objective: taskObjectiveSchema,
    giver: giverSchema,
    conditions: conditionSchema.optional(),
    rewards: z.array(effectSchema).default([]),
    repeatable: z.boolean().default(false),
    cooldown: z.number().nonnegative().optional(),
    time_limit: z
      .object({ days: z.number().int().positive() })
      .strict()
      .optional(),
    narrative: taskNarrativeSchema,
    ext: extSchema,
  })
  .strict();

export type Task = z.infer<typeof taskSchema>;
