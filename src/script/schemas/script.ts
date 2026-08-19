// Module 1: script.yaml metadata.
import { z } from "zod";
import { extSchema, idSchema } from "./common";

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
    ext: extSchema,
  })
  .strict();

export type Script = z.infer<typeof scriptSchema>;
