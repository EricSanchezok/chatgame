// Module 16: events/ — event pool.
import { z } from "zod";
import { conditionSchema, effectSchema, extSchema, idSchema } from "./common";

const eventNarrativeRefSchema = z
  .object({
    template: idSchema,
  })
  .strict();

const exclusivitySchema = z
  .object({
    group: z.string().min(1),
    mutually_exclusive: z.array(idSchema).default([]),
  })
  .strict();

export const eventSchema = z
  .object({
    id: idSchema,
    name: z.string().min(1),
    type: z.enum(["crisis", "opportunity", "social", "mystery", "ambient", "festival"]),
    tags: z.array(z.string().min(1)).default([]),
    trigger: z.enum(["time", "condition", "director"]),
    conditions: conditionSchema.optional(),
    effects: z.array(effectSchema).default([]),
    narrative: eventNarrativeRefSchema.optional(),
    weight: z.number().nonnegative().default(1),
    cooldown: z.number().nonnegative().default(0),
    repeatable: z.boolean().default(false),
    exclusivity: exclusivitySchema.optional(),
    participants: z.array(idSchema).default([]),
    locations: z.array(idSchema).default([]),
    ext: extSchema,
  })
  .strict();

export type Event = z.infer<typeof eventSchema>;
