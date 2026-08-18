// Module 11: origins/ — player origins.
import { z } from "zod";
import {
  extSchema,
  idSchema,
  stanceSchema,
} from "./common";

const statOverridesSchema = z.record(idSchema, z.number()).optional();
const skillOverridesSchema = z.record(idSchema, z.number()).optional();

const startingRelationSchema = z
  .object({
    npc: idSchema,
    value: z.number().min(-100).max(100),
    stance: stanceSchema.optional(),
    note: z.string().optional(),
  })
  .strict();

export const originSchema = z
  .object({
    id: idSchema,
    name: z.string().min(1),
    description: z.string().min(1),
    difficulty: z.enum(["easy", "normal", "hard"]).optional(),
    stats: statOverridesSchema,
    skills: skillOverridesSchema,
    items: z.array(idSchema).default([]),
    starting_location: idSchema,
    starting_currency: z.number().nonnegative().default(0),
    starting_relations: z.array(startingRelationSchema).default([]),
    starting_knowledge: z.array(idSchema).default([]),
    exclusive_leads: z.array(idSchema).default([]),
    denied_actions: z.array(idSchema).default([]),
    exclusive_to: idSchema.optional(),
    ext: extSchema,
  })
  .strict();

export type Origin = z.infer<typeof originSchema>;
