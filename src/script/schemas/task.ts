// Module 17: tasks/ — radiant quest templates.
import { z } from "zod";
import { conditionSchema, effectSchema, extSchema, idSchema } from "./common";

const taskObjectiveSchema = z
  .object({
    type: z.enum(["deliver", "gather", "hunt", "escort", "investigate", "persuade", "travel"]),
    target: z
      .object({
        pool: z.array(idSchema).optional(),
        any: z.boolean().optional(),
        of_type: z
          .enum([
            "consumable",
            "equipment",
            "quest",
            "material",
            "currency_item",
            "misc",
          ])
          .optional(),
      })
      .strict(),
    quantity: z.number().int().positive().default(1),
  })
  .strict();

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
