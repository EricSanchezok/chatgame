// Module 7: director.yaml — director system.
import { z } from "zod";
import { extSchema } from "./common";

export const directorSchema = z
  .object({
    tension: z
      .object({
        variables: z
          .array(
            z
              .object({
                name: z.string().min(1),
                source: z.string().min(1),
                min: z.number(),
                max: z.number(),
                initial: z.number(),
              })
              .strict(),
          )
          .min(1),
      })
      .strict(),
    event_selection: z
      .object({
        policy: z.literal("weighted_by_band"),
        bands: z
          .array(
            z
              .object({
                band: z.tuple([z.number(), z.number()]),
                weight_multiplier: z.number().nonnegative(),
              })
              .strict(),
          )
          .min(1),
      })
      .strict(),
    pacing: z
      .object({
        crisis_density: z.number().min(0).max(1),
        breather_min_interval: z.number().nonnegative(),
        difficulty_ramp: z.number().nonnegative(),
      })
      .strict(),
    novelty: z
      .object({
        seen_tracking: z.literal(true),
        cooldown_default: z.number().nonnegative(),
      })
      .strict(),
    ext: extSchema,
  })
  .strict();

export type Director = z.infer<typeof directorSchema>;
