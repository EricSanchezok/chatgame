import { z } from "zod";
import {
  accessSchema,
  beliefClaimSchema,
  beliefValueSchema,
  evidenceSchema,
  factValueSchema,
  localEntitySchema,
  safeIdSchema,
  discreteRandomValueSchema,
} from "../engine/state-schemas";

export const scriptManifestSchema = z.object({
  schema_version: z.literal(5),
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  name: z.string().min(1),
  version: z.string().min(1),
  description: z.string().min(1),
  model_profiles: z.object({
    perception: safeIdSchema,
    reaction_routing: safeIdSchema,
    resolution: safeIdSchema,
    transition: safeIdSchema,
    causal_verifier: safeIdSchema,
  }).strict(),
}).strict();

export const lawsFileSchema = z.object({
  disclosure: z.object({
    default_check_visibility: z.enum(["full", "result_only", "hidden"]),
  }).strict(),
  laws: z.array(z.object({
    id: safeIdSchema,
    text: z.string().min(1),
    severity: z.enum(["hard", "soft"]),
  }).strict()).min(1),
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
  rule_packages: z.array(z.object({
    id: safeIdSchema,
    version: z.string().min(1),
    config: z.unknown(),
  }).strict()).min(1),
  meters: z.array(z.object({
    id: safeIdSchema,
    name: z.string().min(1),
    min: z.number().finite(),
    max: z.number().finite(),
    thresholds: z.array(z.object({
      id: safeIdSchema,
      when: z.object({
        operator: z.enum(["lte", "gte"]),
        value: z.number().finite(),
      }).strict(),
      effects: z.array(thresholdEffectSchema),
    }).strict()),
  }).strict()),
  quantities: z.array(z.object({
    id: safeIdSchema,
    name: z.string().min(1),
    unit: z.string().min(1),
    production_law_ids: z.array(safeIdSchema),
    consumption_law_ids: z.array(safeIdSchema),
  }).strict()),
  ratings: z.array(z.object({
    id: safeIdSchema,
    name: z.string().min(1),
    min: z.number().finite(),
    max: z.number().finite(),
  }).strict()),
  random_distributions: z.array(z.object({
    id: safeIdSchema,
    description: z.string().min(1),
    steps: z.array(z.object({
      id: safeIdSchema,
      count: z.number().int().min(1).max(100),
      outcomes: z.array(discreteRandomValueSchema).min(2).max(100),
      aggregate: z.enum(["first", "sum", "values"]),
      when: z.object({
        step_id: safeIdSchema,
        equals: discreteRandomValueSchema,
      }).strict().nullable().default(null),
    }).strict()).min(1).max(100),
  }).strict()).default([]),
}).strict();

const bindingSchema = z.object({
  local_entity_id: safeIdSchema,
  canonical_entity_ids: z.array(safeIdSchema),
}).strict();

const beliefSeedSchema = z.object({
  local_entities: z.array(localEntitySchema),
  evidence: z.array(evidenceSchema),
  claims: z.array(beliefClaimSchema),
  bindings: z.array(bindingSchema),
}).strict();

const characterEvidence = {
  evidence_ids: z.array(safeIdSchema).default([]),
};

const characterFacetSchema = z.object({
  id: safeIdSchema,
  description: z.string().min(1),
  strength: z.number().min(0).max(1),
  status: z.enum(["active", "retired"]).default("active"),
  ...characterEvidence,
}).strict();

const emotionSeedSchema = z.object({
  id: safeIdSchema,
  description: z.string().min(1),
  intensity: z.number().min(0).max(1),
  status: z.enum(["active", "resolved"]).default("active"),
  ...characterEvidence,
}).strict();

const attitudeSeedSchema = z.object({
  id: safeIdSchema,
  subject_id: safeIdSchema,
  description: z.string().min(1),
  intensity: z.number().min(0).max(1),
  status: z.enum(["active", "retired"]).default("active"),
  ...characterEvidence,
}).strict();

const goalSeedSchema = z.object({
  id: safeIdSchema,
  description: z.string().min(1),
  priority: z.number().min(0).max(1),
  progress: z.number().min(0).max(1),
  target_ids: z.array(safeIdSchema).default([]),
  parent_goal_id: safeIdSchema.optional(),
  motivated_by_ids: z.array(safeIdSchema).default([]),
  status: z.enum(["active", "suspended", "completed", "failed", "abandoned"]).default("active"),
  ...characterEvidence,
}).strict();

const commitmentSeedSchema = z.object({
  id: safeIdSchema,
  description: z.string().min(1),
  priority: z.number().min(0).max(1),
  subject_ids: z.array(safeIdSchema).default([]),
  status: z.enum(["active", "fulfilled", "broken", "released"]).default("active"),
  ...characterEvidence,
}).strict();

const characterSeedSchema = z.object({
  persona: z.object({
    summary: z.string().min(1),
    voice: z.string().default(""),
    ...characterEvidence,
  }).strict(),
  traits: z.array(characterFacetSchema).default([]),
  values: z.array(characterFacetSchema).default([]),
  emotions: z.array(emotionSeedSchema).default([]),
  attitudes: z.array(attitudeSeedSchema).default([]),
  goals: z.array(goalSeedSchema).default([]),
  commitments: z.array(commitmentSeedSchema).default([]),
}).strict();

export const entityDocumentSchema = z.object({
  id: safeIdSchema,
  kind: z.string().min(1),
  name: z.string().min(1),
  description: z.string(),
  placement: safeIdSchema.nullable().default(null),
  facts: z.array(z.object({
    id: safeIdSchema,
    predicate: z.string().min(1),
    value: factValueSchema,
    description: z.string(),
    access: accessSchema,
  }).strict()).default([]),
  meters: z.array(z.object({
    id: safeIdSchema,
    definition_id: safeIdSchema,
    current: z.number().finite(),
  }).strict()).default([]),
  quantities: z.array(z.object({
    definition_id: safeIdSchema,
    amount: z.number().nonnegative(),
  }).strict()).default([]),
  ratings: z.array(z.object({
    id: safeIdSchema,
    definition_id: safeIdSchema,
    value: z.number().finite(),
  }).strict()).default([]),
  agent: z.object({
    id: safeIdSchema,
    model_profiles: z.object({
      bootstrap: safeIdSchema,
      mind: safeIdSchema,
      reaction: safeIdSchema,
    }).strict(),
    character: characterSeedSchema,
    belief: beliefSeedSchema,
  }).strict().optional(),
}).strict();

const playerClaimSchema = z.object({
  id: safeIdSchema,
  subjectId: safeIdSchema,
  predicate: z.string().min(1),
  value: beliefValueSchema,
  description: z.string(),
  evidenceIds: z.array(safeIdSchema),
}).strict();

export const playerDocumentSchema = z.object({
  entity_id: safeIdSchema,
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
