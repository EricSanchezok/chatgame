// Module 1: script.yaml metadata.
import { z } from "zod";
import { extSchema, idSchema } from "./common";

const extensionNameSchema = z
  .string()
  .regex(/^[a-z][a-z0-9_-]*$/, "extension name must be lowercase and stable");

const engineExtensionSchema = z
  .object({
    api_version: z.literal(2),
    effects: z.array(extensionNameSchema).default([]),
    conditions: z.array(extensionNameSchema).default([]),
    action_handlers: z.array(extensionNameSchema).default([]),
    rule_mechanisms: z.array(extensionNameSchema).default([]),
    lifecycle: z
      .array(z.enum(["session_start", "turn_resolved", "hour", "day_boundary"]))
      .default([]),
  })
  .strict();

export const scriptSchema = z
  .object({
    id: idSchema,
    name: z.string().min(1),
    description: z.string().min(1),
    schema_version: z.literal("1.1"),
    language: z.string().min(2),
    tone: z.array(z.string().min(1)).min(1),
    author: z.string().min(1),
    credits: z.string().optional(),
    engine_extension: engineExtensionSchema.optional(),
    ext: extSchema,
  })
  .strict();

export type Script = z.infer<typeof scriptSchema>;
