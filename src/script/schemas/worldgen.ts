// Module 8: worldgen.yaml — initial generation randomization.
import { z } from "zod";
import { extSchema } from "./common";

const randomizeTargetSchema = z.enum([
  "npc_stats",
  "npc_placement",
  "secret_holder",
  "faction_stance",
  "weather",
  "season",
  "item_placement",
  "starting_event",
]);

export const randomizeEntrySchema = z
  .object({
    target: randomizeTargetSchema,
    jitter: z.number().min(0).max(1).optional(),
    pool: z.array(z.string().min(1)).optional(),
    distribution: z.enum(["uniform", "weighted"]).default("uniform"),
  })
  .strict();

export const worldgenSchema = z
  .object({
    randomize: z.array(randomizeEntrySchema).min(1),
    fixed: z.array(z.string().min(1)).min(1),
    seed: z.object({ policy: z.literal("per_run") }).strict(),
    ext: extSchema,
  })
  .strict();

export type Worldgen = z.infer<typeof worldgenSchema>;
