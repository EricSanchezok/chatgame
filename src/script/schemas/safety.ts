// Module 10: safety.yaml — content boundaries (declarative only; enforcement is engine-side).
import { z } from "zod";
import { extSchema } from "./common";

export const contentClassSchema = z.string().min(1);
export const intensitySchema = z.string().min(1);

export const safetySchema = z
  .object({
    content_classes: z.array(contentClassSchema),
    allowed: z.record(contentClassSchema, intensitySchema),
    forbidden: z.array(contentClassSchema),
    age_rating: z.string().min(1),
    ext: extSchema,
  })
  .strict();

export type Safety = z.infer<typeof safetySchema>;
