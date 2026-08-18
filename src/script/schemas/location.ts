// Module 13: locations/ — locations.
import { z } from "zod";
import { conditionSchema, extSchema, idSchema } from "./common";

const connectionSchema = z
  .object({
    to: idSchema,
    distance: z.number().nonnegative(),
    travel_time: z.number().nonnegative(),
    condition: conditionSchema.optional(),
  })
  .strict();

export const locationSchema = z
  .object({
    id: idSchema,
    name: z.string().min(1),
    type: z.enum(["indoor", "outdoor", "district", "region"]),
    description: z.string().min(1),
    connections: z.array(connectionSchema).default([]),
    ambient_events: z.array(idSchema).default([]),
    npcs_present: z.array(idSchema).default([]),
    items: z.array(idSchema).default([]),
    danger_level: z.number().min(0).max(10),
    entry_condition: conditionSchema.optional(),
    exit_condition: conditionSchema.optional(),
    ext: extSchema,
  })
  .strict();

export type Location = z.infer<typeof locationSchema>;
