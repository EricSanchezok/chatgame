import { z } from "zod";
import {
  accessSchema,
  beliefClaimSchema,
  evidenceSchema,
  factValueSchema,
  localEntitySchema,
  semanticIdSchema as safeIdSchema,
  discreteRandomValueSchema,
} from "../engine/state-schemas";

export const scriptManifestSchema = z.object({
  schema_version: z.literal(9),
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  name: z.string().min(1),
  version: z.string().min(1),
  description: z.string().min(1),
  runtime_defaults: z.object({
    simulated_seconds: z.number().int().min(1).max(86_400),
    realtime_interval_ms: z.number().int().min(1_000).max(86_400_000),
    action_window_ms: z.number().int().min(1_000).max(86_400_000),
  }).strict(),
  model_profiles: z.object({
    perception: safeIdSchema,
    reaction_routing: safeIdSchema,
    resolution: safeIdSchema,
    transition: safeIdSchema,
    causal_verifier: safeIdSchema,
    grounding: safeIdSchema,
    observation: safeIdSchema,
    arrival: safeIdSchema,
    dynamic_agent: z.object({
      bootstrap: safeIdSchema,
      mind: safeIdSchema,
      reaction: safeIdSchema,
    }).strict(),
  }).strict(),
}).strict();

const participationImageSchema = z.object({
  path: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._/-]*$/),
  alt: z.string().trim().min(1).max(300),
}).strict();

export const participationFileSchema = z.object({
  origins: z.array(z.object({
    id: safeIdSchema,
    title: z.string().trim().min(1).max(80),
    fantasy: z.string().trim().min(1).max(160),
    description: z.string().trim().min(1).max(1_000),
    entity_kind: safeIdSchema,
    spawn_entity_id: safeIdSchema,
    persona: z.string().trim().min(1).max(1_000),
    default_goal: z.string().trim().min(1).max(500),
    relationship_hooks: z.array(z.string().trim().min(1).max(300)).max(8).default([]),
    risks: z.array(z.string().trim().min(1).max(300)).max(8).default([]),
    resources: z.array(z.object({
      definition_id: safeIdSchema,
      amount: z.number().nonnegative().finite(),
    }).strict()).max(32).default([]),
    model_profiles: z.object({
      bootstrap: safeIdSchema,
      mind: safeIdSchema,
      reaction: safeIdSchema,
    }).strict().optional(),
    image: participationImageSchema.optional(),
    fallback_arrival: z.string().trim().min(1).max(2_000),
  }).strict()).max(64).default([]),
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

export type ScriptManifestDocument = z.infer<typeof scriptManifestSchema>;
export type ParticipationDocument = z.infer<typeof participationFileSchema>;
export type LawsDocument = z.infer<typeof lawsFileSchema>;
export type MechanicsDocument = z.infer<typeof mechanicsFileSchema>;
export type EntityDocument = z.infer<typeof entityDocumentSchema>;
