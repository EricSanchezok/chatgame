// Module 2: world.yaml — world constitution.
import { z } from "zod";
import { extSchema, idSchema } from "./common";

export const BUILTIN_RULE_MECHANISMS = [
  "item_exists",
  "no_matter_creation",
  "npc_present",
  "teleport_target",
  "no_debt",
  "threat_not_full",
] as const;

export const worldRuleSchema = z
  .object({
    id: idSchema,
    text: z.string().min(1),
    mechanism: z.string().optional(),
  })
  .strict();

export const tabooSchema = z
  .object({
    id: idSchema,
    text: z.string().min(1),
    severity: z.enum(["hard", "soft"]),
  })
  .strict();

export const glossaryEntrySchema = z
  .object({
    term: z.string().min(1),
    aliases: z.array(z.string().min(1)).default([]),
    definition: z.string().min(1),
  })
  .strict();

export const worldSchema = z
  .object({
    background: z.string().min(1),
    rules: z.array(worldRuleSchema).min(1),
    taboos: z.array(tabooSchema).min(1),
    glossary: z.array(glossaryEntrySchema).optional(),
    ext: extSchema,
  })
  .strict();

export type World = z.infer<typeof worldSchema>;
