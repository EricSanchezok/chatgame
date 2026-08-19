// Module 12: npcs/ — NPC definitions.
import { z } from "zod";
import {
  conditionSchema,
  effectSchema,
  extSchema,
  idSchema,
  importanceSchema,
} from "./common";

const traitSchema = z
  .object({
    name: z.string().min(1),
    description: z.string().min(1),
    effects: z.array(effectSchema).optional(),
  })
  .strict();

const relationSchema = z
  .object({
    target: idSchema,
    value: z.number().min(-100).max(100),
    /** Semantic label — free text, authored by the script ("青梅竹马", "酒肉朋友"). */
    type: z.string().min(1),
    /** Static description — the author's natural-language expression of the relationship. */
    description: z.string().optional(),
  })
  .strict();

const memoryEntrySchema = z
  .object({
    text: z.string().min(1),
    importance: importanceSchema,
    tags: z.array(z.string().min(1)).default([]),
  })
  .strict();

const secretSchema = z
  .object({
    id: idSchema,
    content: z.string().min(1),
    reveal: z
      .object({
        logic: conditionSchema,
      })
      .strict(),
  })
  .strict();

const llmConfigSchema = z
  .object({
    personality: z.string().min(1),
    speech_patterns: z.array(z.string().min(1)).default([]),
    knowledge_filter: z.literal(true),
    dialogue_examples: idSchema.optional(),
  })
  .strict();

export const npcSchema = z
  .object({
    id: idSchema,
    name: z.string().min(1),
    base_class: z.string().min(1),
    description: z.string().min(1),
    traits: z.array(traitSchema).default([]),
    stats: z.record(idSchema, z.number()).optional(),
    skills: z.record(idSchema, z.number()).optional(),
    needs: z.record(idSchema, z.number()).optional(),
    occupation: z.string().min(1).optional(),
    schedule: idSchema.optional(),
    home: idSchema.optional(),
    items: z.array(idSchema).default([]),
    relations: z.array(relationSchema).default([]),
    memory: z
      .object({
        initial: z.array(memoryEntrySchema).default([]),
        forget_policy: z
          .object({
            major_keep: z.boolean().default(true),
          })
          .strict()
          .optional(),
      })
      .strict()
      .optional(),
    secrets: z.array(secretSchema).default([]),
    knowledge_flags: z.array(idSchema).default([]),
    llm: llmConfigSchema,
    ext: extSchema,
  })
  .strict();

export type Npc = z.infer<typeof npcSchema>;
