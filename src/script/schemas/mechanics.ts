// Module 4: mechanics.yaml — mechanics configuration.
import { z } from "zod";
import { effectSchema, extSchema, idSchema } from "./common";

export const statDefSchema = z
  .object({
    name: idSchema,
    min: z.number(),
    max: z.number(),
    initial: z.number(),
    description: z.string().optional(),
  })
  .strict();

export const skillDefSchema = statDefSchema;
export type SkillDef = z.infer<typeof skillDefSchema>;

export const needThresholdSchema = z
  .object({
    level: z.number(),
    label: z.string().min(1),
    effects: z.array(effectSchema).default([]),
  })
  .strict();

export const needDefSchema = z
  .object({
    name: idSchema,
    min: z.number(),
    max: z.number(),
    initial: z.number(),
    decay_per_day: z.number(),
    thresholds: z.array(needThresholdSchema).default([]),
  })
  .strict();

export const statusEffectSchema = z
  .object({
    id: idSchema,
    name: z.string().min(1),
    /** Semantic label — free text (buff/debuff/neutral were hardcoded and never read by the engine). */
    kind: z.string().min(1),
    /** Static description of the status effect. */
    description: z.string().optional(),
    effects: z.array(effectSchema).default([]),
    duration: z.number().positive().optional(),
    stackable: z.boolean().default(false),
  })
  .strict();

export const progressionEntrySchema = z
  .object({
    source: z.enum(["stat_check", "skill_check", "task", "event"]),
    target: idSchema,
    amount: z.number(),
    cap: z.number().optional(),
  })
  .strict();

export const mechanicsSchema = z
  .object({
    stats: z.array(statDefSchema).min(1),
    skills: z.array(skillDefSchema).optional(),
    needs: z.array(needDefSchema).optional(),
    status_effects: z.array(statusEffectSchema).optional(),
    inventory: z
      .object({
        capacity: z.number().int().nonnegative(),
        stacking: z.boolean(),
      })
      .strict(),
    currency: z
      .object({
        name: z.string().min(1),
        symbol: z.string().min(1),
        initial: z.number().nonnegative(),
      })
      .strict(),
    combat: z
      .object({
        damage_types: z.array(z.string().min(1)).min(1),
        defense_types: z.array(z.string().min(1)).min(1),
        hp_stat: idSchema,
        threat_gauge: z
          .object({
            max: z.number().positive(),
            on_full: z.string().min(1),
          })
          .strict(),
      })
      .strict(),
    progression: z.array(progressionEntrySchema).optional(),
    ext: extSchema,
  })
  .strict();

export type Mechanics = z.infer<typeof mechanicsSchema>;
