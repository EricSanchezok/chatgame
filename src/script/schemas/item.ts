// Module 14: items/ — items.
import { z } from "zod";
import { conditionSchema, effectSchema, extSchema, idSchema } from "./common";

export const itemSchema = z
  .object({
    id: idSchema,
    name: z.string().min(1),
    type: z.enum([
      "consumable",
      "equipment",
      "quest",
      "material",
      "currency_item",
      "misc",
    ]),
    description: z.string().min(1),
    properties: z
      .object({
        slot: z.string().min(1).optional(),
        stackable: z.boolean().default(false),
      })
      .strict()
      .optional(),
    effects_on_use: z.array(effectSchema).default([]),
    requirements: conditionSchema.optional(),
    rarity: z.enum(["common", "uncommon", "rare", "epic", "legendary"]),
    value: z.number().nonnegative(),
    ext: extSchema,
  })
  .strict();

export type Item = z.infer<typeof itemSchema>;
