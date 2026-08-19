// Module 6: plot.yaml — commitment skeleton.
import { z } from "zod";
import { conditionSchema, effectSchema, extSchema, idSchema } from "./common";

const triggerSchema = z
  .object({
    time: z
      .object({
        day: z.number().int().positive(),
        month: z.number().int().min(1).max(12).optional(),
        hour: z.number().int().min(0).max(23).optional(),
      })
      .strict()
      .optional(),
    condition: conditionSchema.optional(),
  })
  .strict()
  .refine((t) => t.time !== undefined || t.condition !== undefined, {
    message: "trigger must have either time or condition",
  });

const deadlineSchema = z
  .object({
    time: z
      .object({ day: z.number().int().positive(), month: z.number().int().min(1).max(12).optional() })
      .strict()
      .optional(),
    condition: conditionSchema.optional(),
    on_miss: z
      .object({
        escalation_text: z.string().min(1),
        effects: z.array(effectSchema).default([]),
      })
      .strict()
      .optional(),
  })
  .strict()
  .refine((d) => d.time !== undefined || d.condition !== undefined, {
    message: "deadline must have either time or condition",
  });

export const commitmentSchema = z
  .object({
    id: idSchema,
    description: z.string().min(1),
    type: z.string().min(1),
    trigger: triggerSchema,
    must_happen: z.literal(true),
    deadline: deadlineSchema.optional(),
    related: z
      .object({
        secrets: z.array(idSchema).optional(),
        npcs: z.array(idSchema).optional(),
        events: z.array(idSchema).optional(),
        locations: z.array(idSchema).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export const plotSchema = z
  .object({
    commitments: z.array(commitmentSchema).min(1),
    ext: extSchema,
  })
  .strict();

export type Plot = z.infer<typeof plotSchema>;
