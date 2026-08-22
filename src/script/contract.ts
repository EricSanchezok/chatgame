import { z } from "zod";
import {
  accessSchema,
  beliefClaimSchema,
  beliefValueSchema,
  evidenceSchema,
  factValueSchema,
  localEntitySchema,
} from "../engine/state-schemas";

export const scriptManifestSchema = z.object({
  schema_version: z.literal(2),
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  name: z.string().min(1),
  version: z.string().min(1),
  description: z.string().min(1),
}).strict();

export const lawsFileSchema = z.object({
  disclosure: z.object({
    default_check_visibility: z.enum(["full", "result_only", "hidden"]),
  }).strict(),
  laws: z.array(z.object({
    id: z.string().min(1),
    text: z.string().min(1),
    severity: z.enum(["hard", "soft"]),
  }).strict()),
}).strict();

const thresholdEffectSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("set_lifecycle"),
    lifecycle: z.enum(["active", "retired"]),
  }).strict(),
  z.object({
    kind: z.literal("set_fact"),
    predicate: z.string().min(1),
    value: factValueSchema,
    description: z.string(),
    access: accessSchema.optional(),
  }).strict(),
]);

export const mechanicsFileSchema = z.object({
  meters: z.array(z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    min: z.number().finite(),
    max: z.number().finite(),
    thresholds: z.array(z.object({
      id: z.string().min(1),
      when: z.object({
        operator: z.enum(["lte", "gte"]),
        value: z.number().finite(),
      }).strict(),
      effects: z.array(thresholdEffectSchema),
    }).strict()),
  }).strict()),
  quantities: z.array(z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    unit: z.string().min(1),
    allow_production: z.boolean(),
    allow_consumption: z.boolean(),
  }).strict()),
  ratings: z.array(z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    min: z.number().finite(),
    max: z.number().finite(),
  }).strict()),
}).strict();

const bindingSchema = z.object({
  local_entity_id: z.string().min(1),
  canonical_entity_ids: z.array(z.string().min(1)),
}).strict();

const beliefSeedSchema = z.object({
  local_entities: z.array(localEntitySchema),
  evidence: z.array(evidenceSchema),
  claims: z.array(beliefClaimSchema),
  bindings: z.array(bindingSchema),
}).strict();

export const entityDocumentSchema = z.object({
  id: z.string().min(1),
  kind: z.string().min(1),
  name: z.string().min(1),
  description: z.string(),
  placement: z.string().min(1).nullable().default(null),
  facts: z.array(z.object({
    id: z.string().min(1),
    predicate: z.string().min(1),
    value: factValueSchema,
    description: z.string(),
    access: accessSchema,
  }).strict()).default([]),
  meters: z.array(z.object({
    id: z.string().min(1),
    definition_id: z.string().min(1),
    current: z.number().finite(),
  }).strict()).default([]),
  quantities: z.array(z.object({
    definition_id: z.string().min(1),
    amount: z.number().nonnegative(),
  }).strict()).default([]),
  ratings: z.array(z.object({
    id: z.string().min(1),
    definition_id: z.string().min(1),
    value: z.number().finite(),
  }).strict()).default([]),
  agent: z.object({
    id: z.string().min(1),
    model_profile_id: z.string().min(1).default("agent-default"),
    persona: z.string(),
    goals: z.array(z.string()),
    belief: beliefSeedSchema,
  }).strict().optional(),
}).strict();

const playerClaimSchema = z.object({
  id: z.string().min(1),
  subjectId: z.string().min(1),
  predicate: z.string().min(1),
  value: beliefValueSchema,
  description: z.string(),
  evidenceIds: z.array(z.string().min(1)),
}).strict();

export const playerDocumentSchema = z.object({
  entity_id: z.string().min(1),
  local_entities: z.array(localEntitySchema),
  evidence: z.array(evidenceSchema),
  claims: z.array(playerClaimSchema),
  bindings: z.array(bindingSchema),
}).strict();

export type ScriptManifestDocument = z.infer<typeof scriptManifestSchema>;
export type LawsDocument = z.infer<typeof lawsFileSchema>;
export type MechanicsDocument = z.infer<typeof mechanicsFileSchema>;
export type EntityDocument = z.infer<typeof entityDocumentSchema>;
export type PlayerDocument = z.infer<typeof playerDocumentSchema>;
