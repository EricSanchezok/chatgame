// Module 15: factions/ — factions.
import { z } from "zod";
import { effectSchema, extSchema, idSchema } from "./common";

const factionRelationSchema = z
  .object({
    target: idSchema,
    value: z.number().min(-100).max(100),
  })
  .strict();

const reputationThresholdSchema = z
  .object({
    value: z.number(),
    label: z.string().min(1),
    effects: z.array(effectSchema).default([]),
  })
  .strict();

export const factionSchema = z
  .object({
    id: idSchema,
    name: z.string().min(1),
    description: z.string().min(1),
    goals: z.array(z.string().min(1)).default([]),
    members: z.array(idSchema).default([]),
    relations: z.array(factionRelationSchema).default([]),
    reputation: z
      .object({
        thresholds: z.array(reputationThresholdSchema).default([]),
        decay: z.number().nonnegative().default(0),
      })
      .strict()
      .optional(),
    ext: extSchema,
  })
  .strict();

export type Faction = z.infer<typeof factionSchema>;
