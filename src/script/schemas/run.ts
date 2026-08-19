// Module 9: run.yaml — run policy (death / meta-progression / memory / compaction).
import { z } from "zod";
import { effectSchema, extSchema } from "./common";

const softFailureSchema = z
  .object({
    gauge_ref: z.string().min(1),
    threshold: z.number().positive(),
    consequence: z
      .object({
        location: z.string().min(1),
        effects: z.array(effectSchema).default([]),
        narrative: z.string().min(1),
      })
      .strict(),
  })
  .strict();

const worldContinueSchema = z
  .object({
    succession: z.enum(["heir_pool", "new_character"]),
    state_kept: z.array(z.string().min(1)).default([]),
  })
  .strict();

const hardResetSchema = z
  .object({
    world_reroll: z.enum(["reroll_worldgen", "keep_world"]),
  })
  .strict();

const deathPolicySchema = z
  .object({
    mode: z.enum(["soft_failure", "world_continue", "hard_reset"]),
    soft_failure: softFailureSchema.optional(),
    world_continue: worldContinueSchema.optional(),
    hard_reset: hardResetSchema.optional(),
  })
  .strict()
  .superRefine((policy, ctx) => {
    const mode = policy.mode;
    if (mode === "soft_failure" && !policy.soft_failure) {
      ctx.addIssue({ code: "custom", message: "soft_failure mode requires soft_failure config" });
    }
    if (mode === "world_continue" && !policy.world_continue) {
      ctx.addIssue({ code: "custom", message: "world_continue mode requires world_continue config" });
    }
    if (mode === "hard_reset" && !policy.hard_reset) {
      ctx.addIssue({ code: "custom", message: "hard_reset mode requires hard_reset config" });
    }
  });

const unlockSchema = z
  .object({
    flag: z.string().min(1),
    grant: z.array(z.string().min(1)).default([]),
  })
  .strict();

export const runSchema = z
  .object({
    death_policy: deathPolicySchema,
    meta_progression: z
      .object({
        keep: z.array(z.enum(["flags", "lore", "relations_overview"])).default([]),
        reset: z
          .array(z.enum(["stats", "inventory", "location", "currency"]))
          .default([]),
        unlocks: z.array(unlockSchema).default([]),
      })
      .strict(),
    memory: z
      .object({
        tier_retention_days: z
          .object({
            major: z.number().nonnegative(),
            minor: z.number().nonnegative(),
            trivial: z.number().nonnegative(),
          })
          .strict(),
      })
      .strict(),
    context_compaction: z
      .object({
        policy: z.literal("summarize_archive"),
        retention_tiers: z.array(z.enum(["major", "minor", "trivial"])).min(1),
      })
      .strict(),
    ext: extSchema,
  })
  .strict();

export type Run = z.infer<typeof runSchema>;
