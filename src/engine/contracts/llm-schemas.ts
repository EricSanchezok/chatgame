import { z } from "zod";
import type {
  AgentActionDraft,
  AgentActionProposal,
  BeliefPatch,
  CausalAssertionResult,
  CharacterPatch,
  D20CheckRequest,
  MechanicResult,
  ReactionDecision,
  ReactionRequest,
  TransitionProposal,
  WorldDeltaOperation,
} from "./model";
import type { ResolutionPlan, ResolutionReceipt } from "../mechanics/resolution";
import type { ActionCompilationDraft } from "../runtime/execution";
import { MAX_RANDOM_REQUESTS_PER_ROUND } from "../mechanics/random-limits";
import { isRuntimeId } from "../runtime/runtime-id";
import {
  actionProposalSchema,
  accessSchema,
  agentStateSchema,
  beliefClaimSchema,
  beliefValueSchema,
  causalAssertionSchema,
  causalRefSchema,
  conditionStateSchema,
  entitySchema,
  evidenceSchema,
  factSchema,
  localEntitySchema,
  meterSchema,
  persistedFactIdSchema,
  quantityStateSchema,
  ratingSchema,
  safeIdSchema,
  semanticIdSchema,
  isNormalizedBoundedId,
  runtimeIdSchema,
} from "./state-schemas";
import { existingReferenceHandleSchema, modelReferenceSchema, proposalKeySchema } from "./model-context";
import type { ModelCausalRef } from "./model-context";

const draftAliasSchema = z.string().min(1).refine(
  isNormalizedBoundedId,
  { message: "draft aliases must be NFC, trimmed, control-free, and at most 128 UTF-8 bytes" },
);

export const actionDraftSchema = z.strictObject({
  rawText: z.string().min(1),
  goal: z.string().min(1),
  means: z.string().min(1).nullable(),
  targetHandles: z.array(existingReferenceHandleSchema),
}) as z.ZodType<AgentActionDraft>;

const causalSourceShape = {
  causes: z.array(causalRefSchema).min(1),
  assertions: z.array(causalAssertionSchema).min(1),
};

function makeBeliefPatchOperationSchema(evidence: z.ZodTypeAny) {
  return z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("upsert_local_entity"), entity: localEntitySchema }),
    z.strictObject({ kind: z.literal("remove_local_entity"), localEntityId: semanticIdSchema }),
    z.strictObject({ kind: z.literal("upsert_evidence"), evidence }),
    z.strictObject({ kind: z.literal("upsert_claim"), claim: beliefClaimSchema }),
    z.strictObject({ kind: z.literal("remove_claim"), claimId: semanticIdSchema }),
    z.strictObject({
      kind: z.literal("merge_local_entities"),
      fromId: semanticIdSchema,
      intoId: semanticIdSchema,
    }),
    z.strictObject({
      kind: z.literal("split_local_entity"),
      fromId: semanticIdSchema,
      entities: z.array(localEntitySchema).min(2),
      assignments: z.array(z.strictObject({
        claimId: semanticIdSchema,
        subjectId: semanticIdSchema.nullable(),
        valueId: semanticIdSchema.nullable(),
      })),
    }),
  ]);
}

export const beliefPatchSchema = z.strictObject({
  agentId: semanticIdSchema,
  baseRevision: z.number().int().nonnegative(),
  operations: z.array(makeBeliefPatchOperationSchema(evidenceSchema)),
});

const characterPatchSource = {
  sourceObservationIds: z.array(safeIdSchema).min(1),
  evidenceIds: z.array(safeIdSchema).min(1),
};

export const characterPatchSchema = z.strictObject({
  agentId: semanticIdSchema,
  baseRevision: z.number().int().nonnegative(),
  operations: z.array(z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("replace_persona"), summary: z.string().min(1), voice: z.string(), ...characterPatchSource }),
    z.strictObject({
      kind: z.enum(["create_trait", "create_value"]),
      facet: z.strictObject({ id: semanticIdSchema, description: z.string().min(1), strength: z.number().min(0).max(1) }),
      ...characterPatchSource,
    }),
    z.strictObject({
      kind: z.enum(["update_trait", "update_value"]),
      id: semanticIdSchema,
      description: z.string().min(1).nullable(),
      strength: z.number().min(0).max(1).nullable(),
      ...characterPatchSource,
    }),
    z.strictObject({ kind: z.enum(["retire_trait", "retire_value"]), id: semanticIdSchema, ...characterPatchSource }),
    z.strictObject({
      kind: z.literal("set_emotion"),
      emotion: z.strictObject({ id: semanticIdSchema, description: z.string().min(1), intensity: z.number().min(0).max(1) }),
      ...characterPatchSource,
    }),
    z.strictObject({ kind: z.literal("resolve_emotion"), id: semanticIdSchema, ...characterPatchSource }),
    z.strictObject({
      kind: z.literal("set_attitude"),
      attitude: z.strictObject({
        id: semanticIdSchema,
        subjectId: semanticIdSchema,
        description: z.string().min(1),
        intensity: z.number().min(0).max(1),
      }),
      ...characterPatchSource,
    }),
    z.strictObject({ kind: z.literal("retire_attitude"), id: semanticIdSchema, ...characterPatchSource }),
    z.strictObject({
      kind: z.literal("create_goal"),
      goal: z.strictObject({
        id: semanticIdSchema,
        description: z.string().min(1),
        priority: z.number().min(0).max(1),
        progress: z.number().min(0).max(1),
        targetIds: z.array(semanticIdSchema),
        parentGoalId: semanticIdSchema.nullable(),
        motivatedByIds: z.array(semanticIdSchema),
      }),
      ...characterPatchSource,
    }),
    z.strictObject({
      kind: z.literal("update_goal"),
      id: semanticIdSchema,
      description: z.string().min(1).nullable(),
      priority: z.number().min(0).max(1).nullable(),
      progress: z.number().min(0).max(1).nullable(),
      targetIds: z.array(semanticIdSchema).nullable(),
      parentGoal: z.discriminatedUnion("kind", [
        z.strictObject({ kind: z.literal("unchanged") }),
        z.strictObject({ kind: z.literal("none") }),
        z.strictObject({ kind: z.literal("goal"), goalId: semanticIdSchema }),
      ]),
      motivatedByIds: z.array(semanticIdSchema).nullable(),
      ...characterPatchSource,
    }),
    z.strictObject({
      kind: z.literal("set_goal_status"),
      id: semanticIdSchema,
      status: z.enum(["active", "suspended", "completed", "failed", "abandoned"]),
      ...characterPatchSource,
    }),
    z.strictObject({
      kind: z.literal("create_commitment"),
      commitment: z.strictObject({
        id: semanticIdSchema,
        description: z.string().min(1),
        priority: z.number().min(0).max(1),
        subjectIds: z.array(semanticIdSchema),
      }),
      ...characterPatchSource,
    }),
    z.strictObject({
      kind: z.literal("update_commitment"),
      id: semanticIdSchema,
      description: z.string().min(1).nullable(),
      priority: z.number().min(0).max(1).nullable(),
      subjectIds: z.array(semanticIdSchema).nullable(),
      ...characterPatchSource,
    }),
    z.strictObject({
      kind: z.literal("set_commitment_status"),
      id: semanticIdSchema,
      status: z.enum(["active", "fulfilled", "broken", "released"]),
      ...characterPatchSource,
    }),
  ])),
});

const modelLocalEntitySchema = z.strictObject({
  proposalKey: proposalKeySchema,
  name: z.string().min(1),
  description: z.string(),
  status: z.enum(["observed", "reported", "hypothesized"]),
});

export const modelBeliefValueSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("text"), value: z.string() }),
  z.strictObject({ kind: z.literal("number"), value: z.number().finite() }),
  z.strictObject({ kind: z.literal("boolean"), value: z.boolean() }),
  z.strictObject({ kind: z.literal("local_entity"), entityRef: modelReferenceSchema }),
  z.strictObject({ kind: z.literal("none") }),
]);

const modelEvidenceSchema = z.strictObject({
  proposalKey: proposalKeySchema,
  kind: z.enum(["observation", "testimony", "inference", "assumption"]),
  description: z.string().min(1),
  sourceRef: modelReferenceSchema.nullable(),
});

const modelClaimSchema = z.strictObject({
  proposalKey: proposalKeySchema,
  subjectRef: modelReferenceSchema,
  predicate: z.string().min(1),
  value: modelBeliefValueSchema,
  description: z.string(),
  stance: z.enum(["believed", "suspected", "disbelieved"]),
  confidence: z.number().min(0).max(1),
  evidenceRefs: z.array(modelReferenceSchema),
});

const modelBeliefChangesSchema = z.strictObject({
  operations: z.array(z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("upsert_local_entity"), entity: modelLocalEntitySchema }),
    z.strictObject({ kind: z.literal("remove_local_entity"), localEntityRef: modelReferenceSchema }),
    z.strictObject({ kind: z.literal("upsert_evidence"), evidence: modelEvidenceSchema }),
    z.strictObject({ kind: z.literal("upsert_claim"), claim: modelClaimSchema }),
    z.strictObject({ kind: z.literal("remove_claim"), claimRef: modelReferenceSchema }),
    z.strictObject({ kind: z.literal("merge_local_entities"), fromRef: modelReferenceSchema, intoRef: modelReferenceSchema }),
    z.strictObject({
      kind: z.literal("split_local_entity"),
      fromRef: modelReferenceSchema,
      entities: z.array(modelLocalEntitySchema).min(2),
      assignments: z.array(z.strictObject({
        claimRef: modelReferenceSchema,
        subjectRef: modelReferenceSchema.nullable(),
        valueRef: modelReferenceSchema.nullable(),
      })),
    }),
  ])),
});

const modelCharacterSource = {
  observationRefs: z.array(modelReferenceSchema).min(1),
  evidenceRefs: z.array(modelReferenceSchema).min(1),
};
const modelNewCharacterId = { proposalKey: proposalKeySchema };
const modelCharacterChangesSchema = z.strictObject({
  operations: z.array(z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("replace_persona"), summary: z.string().min(1), voice: z.string(), ...modelCharacterSource }),
    z.strictObject({ kind: z.enum(["create_trait", "create_value"]), facet: z.strictObject({ ...modelNewCharacterId, description: z.string().min(1), strength: z.number().min(0).max(1) }), ...modelCharacterSource }),
    z.strictObject({ kind: z.enum(["update_trait", "update_value"]), facetRef: modelReferenceSchema, description: z.string().min(1).nullable(), strength: z.number().min(0).max(1).nullable(), ...modelCharacterSource }),
    z.strictObject({ kind: z.enum(["retire_trait", "retire_value"]), facetRef: modelReferenceSchema, ...modelCharacterSource }),
    z.strictObject({ kind: z.literal("set_emotion"), emotion: z.strictObject({ ...modelNewCharacterId, description: z.string().min(1), intensity: z.number().min(0).max(1) }), ...modelCharacterSource }),
    z.strictObject({ kind: z.literal("resolve_emotion"), emotionRef: modelReferenceSchema, ...modelCharacterSource }),
    z.strictObject({ kind: z.literal("set_attitude"), attitude: z.strictObject({ ...modelNewCharacterId, subjectRef: modelReferenceSchema, description: z.string().min(1), intensity: z.number().min(-1).max(1) }), ...modelCharacterSource }),
    z.strictObject({ kind: z.literal("retire_attitude"), attitudeRef: modelReferenceSchema, ...modelCharacterSource }),
    z.strictObject({ kind: z.literal("create_goal"), goal: z.strictObject({ ...modelNewCharacterId, description: z.string().min(1), priority: z.number().min(0).max(1), progress: z.number().min(0).max(1), targetRefs: z.array(modelReferenceSchema), parentGoalRef: modelReferenceSchema.nullable(), motivatedByRefs: z.array(modelReferenceSchema) }), ...modelCharacterSource }),
    z.strictObject({ kind: z.literal("update_goal"), goalRef: modelReferenceSchema, description: z.string().min(1).nullable(), priority: z.number().min(0).max(1).nullable(), progress: z.number().min(0).max(1).nullable(), targetRefs: z.array(modelReferenceSchema).nullable(), parentGoal: z.discriminatedUnion("kind", [z.strictObject({ kind: z.literal("unchanged") }), z.strictObject({ kind: z.literal("none") }), z.strictObject({ kind: z.literal("goal"), goalRef: modelReferenceSchema })]), motivatedByRefs: z.array(modelReferenceSchema).nullable(), ...modelCharacterSource }),
    z.strictObject({ kind: z.literal("set_goal_status"), goalRef: modelReferenceSchema, status: z.enum(["active", "suspended", "completed", "failed", "abandoned"]), ...modelCharacterSource }),
    z.strictObject({ kind: z.literal("create_commitment"), commitment: z.strictObject({ ...modelNewCharacterId, description: z.string().min(1), priority: z.number().min(0).max(1), subjectRefs: z.array(modelReferenceSchema) }), ...modelCharacterSource }),
    z.strictObject({ kind: z.literal("update_commitment"), commitmentRef: modelReferenceSchema, description: z.string().min(1).nullable(), priority: z.number().min(0).max(1).nullable(), subjectRefs: z.array(modelReferenceSchema).nullable(), ...modelCharacterSource }),
    z.strictObject({ kind: z.literal("set_commitment_status"), commitmentRef: modelReferenceSchema, status: z.enum(["active", "fulfilled", "broken", "released"]), ...modelCharacterSource }),
  ])),
});

export interface AgentMindDraftOutput {
  beliefChanges: z.infer<typeof modelBeliefChangesSchema>;
  characterChanges: z.infer<typeof modelCharacterChangesSchema>;
  nextActionIntent: AgentActionDraft;
}

export const agentMindOutputSchema = z.strictObject({
  beliefChanges: modelBeliefChangesSchema,
  characterChanges: modelCharacterChangesSchema,
  nextActionIntent: actionDraftSchema,
}) as z.ZodType<AgentMindDraftOutput>;

export interface AgentMindBatchDraftOutput {
  slots: Array<AgentMindDraftOutput & { slot: number }>;
}

export const agentMindBatchOutputSchema = z.strictObject({
  slots: z.array(z.strictObject({
    slot: z.number().int().nonnegative(),
    beliefChanges: modelBeliefChangesSchema,
    characterChanges: modelCharacterChangesSchema,
    nextActionIntent: actionDraftSchema,
  })),
}) as z.ZodType<AgentMindBatchDraftOutput>;

export interface AgentMindOutput {
  beliefPatch: BeliefPatch;
  characterPatch: CharacterPatch;
  nextAction: AgentActionProposal;
}

export const modelCausalRefSchema = z.strictObject({
  kind: z.enum(["action", "check", "random", "event", "fact", "law", "mechanic"]),
  ref: modelReferenceSchema,
});
export type { ModelCausalRef };

export const modelFactValueSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("text"), value: z.string() }),
  z.strictObject({ kind: z.literal("number"), value: z.number().finite() }),
  z.strictObject({ kind: z.literal("boolean"), value: z.boolean() }),
  z.strictObject({ kind: z.literal("entity"), entityRef: modelReferenceSchema }),
  z.strictObject({ kind: z.literal("none") }),
]);
export type ModelFactValue = z.infer<typeof modelFactValueSchema>;

/** Access policy in the model vocabulary. Agent membership is expressed with
 * request-local references so a model never has to copy engine Agent IDs. */
export const modelAccessSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("public") }),
  z.strictObject({ kind: z.literal("private") }),
  z.strictObject({ kind: z.literal("agents"), agentRefs: z.array(modelReferenceSchema) }),
]);
export type ModelAccess = z.infer<typeof modelAccessSchema>;

export const modelCausalAssertionSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("check_result"), checkRef: modelReferenceSchema, expected: z.enum(["succeeded", "failed"]) }),
  z.strictObject({ kind: z.literal("random_result"), requestRef: modelReferenceSchema, stepRef: modelReferenceSchema, expected: z.json() }),
  z.strictObject({ kind: z.literal("fact_matches"), factRef: modelReferenceSchema, expected: modelFactValueSchema }),
  z.strictObject({ kind: z.literal("fact_absent"), factRef: modelReferenceSchema }),
  z.strictObject({ kind: z.literal("entity_absent"), entityRef: modelReferenceSchema }),
  z.strictObject({ kind: z.literal("entity_lifecycle"), entityRef: modelReferenceSchema, expected: z.enum(["active", "retired"]) }),
  z.strictObject({ kind: z.literal("placement_equals"), entityRef: modelReferenceSchema, placementRef: modelReferenceSchema.nullable() }),
  z.strictObject({ kind: z.literal("placement_not_equals"), entityRef: modelReferenceSchema, placementRef: modelReferenceSchema.nullable() }),
  z.strictObject({ kind: z.literal("shared_placement"), leftEntityRef: modelReferenceSchema, rightEntityRef: modelReferenceSchema }),
  z.strictObject({ kind: z.literal("meter_compare"), meterRef: modelReferenceSchema, operator: z.enum(["eq", "ne", "lt", "lte", "gt", "gte"]), value: z.number().finite() }),
  z.strictObject({ kind: z.literal("quantity_compare"), quantityRef: modelReferenceSchema, operator: z.enum(["eq", "ne", "lt", "lte", "gt", "gte"]), value: z.number().finite() }),
  z.strictObject({ kind: z.literal("rating_compare"), ratingRef: modelReferenceSchema, operator: z.enum(["eq", "ne", "lt", "lte", "gt", "gte"]), value: z.number().finite() }),
  z.strictObject({ kind: z.literal("shared_resource_capacity_compare"), poolRef: modelReferenceSchema, operator: z.enum(["eq", "ne", "lt", "lte", "gt", "gte"]), value: z.number().finite() }),
  z.strictObject({ kind: z.literal("elapsed_seconds_compare"), operator: z.enum(["eq", "ne", "lt", "lte", "gt", "gte"]), value: z.number().finite() }),
]);

export type ModelCausalAssertion = z.infer<typeof modelCausalAssertionSchema>;

/* Model-facing transition records use handles and proposal keys. The
 * persistence schemas below intentionally remain engine-owned and are never
 * supplied to a model. */
const modelTransitionCausalSourceShape = {
  causes: z.array(modelCausalRefSchema).min(1),
  assertions: z.array(modelCausalAssertionSchema).min(1),
};
const modelTransitionEntitySchema = z.strictObject({
  proposalKey: proposalKeySchema,
  kind: z.string().min(1),
  name: z.string().min(1),
  description: z.string(),
});
const modelTransitionFactSchema = z.strictObject({
  proposalKey: proposalKeySchema,
  subjectRef: modelReferenceSchema,
  predicate: z.string().min(1),
  value: modelFactValueSchema,
  description: z.string(),
  access: modelAccessSchema,
});

const modelTransitionEvidenceSchema = z.strictObject({
  proposalKey: proposalKeySchema,
  kind: z.enum(["observation", "testimony", "inference", "assumption"]),
  description: z.string().min(1),
  sourceRef: modelReferenceSchema.nullable(),
});
const modelTransitionLocalEntitySchema = z.strictObject({
  proposalKey: proposalKeySchema,
  name: z.string().min(1),
  description: z.string(),
  status: z.enum(["observed", "reported", "hypothesized"]),
});
const modelTransitionBeliefValueSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("text"), value: z.string() }),
  z.strictObject({ kind: z.literal("number"), value: z.number().finite() }),
  z.strictObject({ kind: z.literal("boolean"), value: z.boolean() }),
  z.strictObject({ kind: z.literal("local_entity"), entityRef: modelReferenceSchema }),
  z.strictObject({ kind: z.literal("none") }),
]);
const modelTransitionClaimSchema = z.strictObject({
  proposalKey: proposalKeySchema,
  subjectRef: modelReferenceSchema,
  predicate: z.string().min(1),
  value: modelTransitionBeliefValueSchema,
  description: z.string(),
  stance: z.enum(["believed", "suspected", "disbelieved"]),
  confidence: z.number().min(0).max(1),
  evidenceRefs: z.array(modelReferenceSchema),
});
const modelTransitionEvidenceRefs = { evidenceRefs: z.array(modelReferenceSchema) };
const modelTransitionFacetSchema = z.strictObject({
  proposalKey: proposalKeySchema,
  description: z.string().min(1),
  strength: z.number().min(0).max(1),
  status: z.enum(["active", "retired"]),
  ...modelTransitionEvidenceRefs,
});
const modelTransitionEmotionSchema = z.strictObject({
  proposalKey: proposalKeySchema,
  description: z.string().min(1),
  intensity: z.number().min(0).max(1),
  status: z.enum(["active", "resolved"]),
  ...modelTransitionEvidenceRefs,
});
const modelTransitionAttitudeSchema = z.strictObject({
  proposalKey: proposalKeySchema,
  subjectRef: modelReferenceSchema,
  description: z.string().min(1),
  intensity: z.number().min(-1).max(1),
  status: z.enum(["active", "retired"]),
  ...modelTransitionEvidenceRefs,
});
const modelTransitionGoalSchema = z.strictObject({
  proposalKey: proposalKeySchema,
  description: z.string().min(1),
  priority: z.number().min(0).max(1),
  progress: z.number().min(0).max(1),
  targetRefs: z.array(modelReferenceSchema),
  parentGoalRef: modelReferenceSchema.nullable(),
  motivatedByRefs: z.array(modelReferenceSchema),
  status: z.enum(["active", "suspended", "completed", "failed", "abandoned"]),
  ...modelTransitionEvidenceRefs,
});
const modelTransitionCommitmentSchema = z.strictObject({
  proposalKey: proposalKeySchema,
  description: z.string().min(1),
  priority: z.number().min(0).max(1),
  subjectRefs: z.array(modelReferenceSchema),
  status: z.enum(["active", "fulfilled", "broken", "released"]),
  ...modelTransitionEvidenceRefs,
});
const modelTransitionCharacterSchema = z.strictObject({
  persona: z.strictObject({ summary: z.string().min(1), voice: z.string(), ...modelTransitionEvidenceRefs }),
  traits: z.array(modelTransitionFacetSchema),
  values: z.array(modelTransitionFacetSchema),
  emotions: z.array(modelTransitionEmotionSchema),
  attitudes: z.array(modelTransitionAttitudeSchema),
  goals: z.array(modelTransitionGoalSchema),
  commitments: z.array(modelTransitionCommitmentSchema),
});
const modelTransitionBeliefSchema = z.strictObject({
  localEntities: z.array(modelTransitionLocalEntitySchema),
  claims: z.array(modelTransitionClaimSchema),
  evidence: z.array(modelTransitionEvidenceSchema),
});
const modelTransitionBindingSchema = z.strictObject({
  localEntityRef: modelReferenceSchema,
  canonicalEntityRefs: z.array(modelReferenceSchema),
});
const modelTransitionAgentSchema = z.strictObject({
  proposalKey: proposalKeySchema,
  entityRef: modelReferenceSchema,
  character: modelTransitionCharacterSchema,
  belief: modelTransitionBeliefSchema,
  bindings: z.array(modelTransitionBindingSchema),
});
const modelWorldDeltaOperationSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("create_entity"), entity: modelTransitionEntitySchema, placementRef: modelReferenceSchema.nullable(), ...modelTransitionCausalSourceShape }),
  z.strictObject({ kind: z.literal("retire_entity"), entityRef: modelReferenceSchema, ...modelTransitionCausalSourceShape }),
  z.strictObject({ kind: z.literal("place_entity"), entityRef: modelReferenceSchema, placementRef: modelReferenceSchema.nullable(), ...modelTransitionCausalSourceShape }),
  z.strictObject({ kind: z.literal("set_fact"), fact: modelTransitionFactSchema, ...modelTransitionCausalSourceShape }),
  z.strictObject({ kind: z.literal("remove_fact"), factRef: modelReferenceSchema, ...modelTransitionCausalSourceShape }),
  z.strictObject({ kind: z.literal("create_agent"), agent: modelTransitionAgentSchema, ...modelTransitionCausalSourceShape }),
  z.strictObject({ kind: z.literal("remove_agent"), agentRef: modelReferenceSchema, ...modelTransitionCausalSourceShape }),
]);
const modelMechanicInvocationSchema = z.strictObject({
  proposalKey: proposalKeySchema,
  /** Select one server-authored typed mechanic contract from the catalog. */
  mechanicRef: modelReferenceSchema,
  input: z.json(),
  ...modelTransitionCausalSourceShape,
});
const modelTransitionOutcomeSchema = z.strictObject({
  proposalKey: proposalKeySchema,
  actionRef: modelReferenceSchema,
  status: z.enum(["succeeded", "partial", "failed", "blocked", "continuing"]),
  summary: z.string(),
  causes: z.array(modelCausalRefSchema),
  assertions: z.array(modelCausalAssertionSchema).min(1),
});
const modelWorldEventSchema = z.strictObject({
  proposalKey: proposalKeySchema,
  description: z.string(),
  impact: z.enum(["ordinary", "significant", "transformative"]),
  ...modelTransitionCausalSourceShape,
});
const modelDecisionRequestSchema = z.strictObject({
  agentRef: modelReferenceSchema,
  prompt: z.string().min(1),
  possibleNextActions: z.array(z.string().min(1)).max(3),
});
export const modelTransitionProposalSchema = z.strictObject({
  outcomes: z.array(modelTransitionOutcomeSchema),
  mechanicInvocations: z.array(modelMechanicInvocationSchema),
  operations: z.array(modelWorldDeltaOperationSchema),
  events: z.array(modelWorldEventSchema),
  decisionRequests: z.array(modelDecisionRequestSchema),
});
export type ModelTransitionProposalDraft = z.infer<typeof modelTransitionProposalSchema>;

const modelCheckRequestShape = {
  proposalKey: proposalKeySchema,
  actorRef: modelReferenceSchema,
  targetRef: modelReferenceSchema.nullable(),
  ratingRef: modelReferenceSchema.nullable(),
  modifier: z.number().int(),
  modifierSources: z.array(z.strictObject({
    kind: z.literal("rating"),
    ref: modelReferenceSchema,
    amount: z.number().int().min(-100).max(100),
  })).max(1),
  dc: z.number().int().min(0).max(100),
  mode: z.enum(["normal", "advantage", "disadvantage"]),
  stakes: z.string().min(1),
  visibility: z.enum(["full", "result_only", "hidden"]),
  causes: z.array(modelCausalRefSchema).min(1),
};

export const checkRequestSchema = z.strictObject(modelCheckRequestShape);
export type ModelCheckRequestDraft = z.infer<typeof checkRequestSchema>;

const persistedCheckRequestShape = {
  actorId: semanticIdSchema,
  targetId: semanticIdSchema.nullable(),
  ratingId: semanticIdSchema.nullable(),
  modifier: z.number().int(),
  modifierSources: z.array(z.strictObject({
    kind: z.literal("rating"),
    id: safeIdSchema,
    amount: z.number().int().min(-100).max(100),
  })).max(1),
  dc: z.number().int().min(0).max(100),
  mode: z.enum(["normal", "advantage", "disadvantage"]),
  stakes: z.string().min(1),
  visibility: z.enum(["full", "result_only", "hidden"]),
  causes: z.array(causalRefSchema).min(1),
};

export const persistedCheckRequestSchema = z.strictObject({
  id: runtimeIdSchema,
  ...persistedCheckRequestShape,
  phase: z.enum(["perception", "resolution"]),
}) as z.ZodType<D20CheckRequest>;

const resolutionSourceRefSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("action"), id: safeIdSchema }),
  z.strictObject({ kind: z.literal("entity"), id: semanticIdSchema }),
  z.strictObject({ kind: z.literal("fact"), id: safeIdSchema }),
  z.strictObject({ kind: z.literal("condition"), id: semanticIdSchema }),
  z.strictObject({ kind: z.literal("rating"), id: semanticIdSchema }),
  z.strictObject({ kind: z.literal("law"), id: semanticIdSchema }),
  z.strictObject({ kind: z.literal("placement"), id: semanticIdSchema }),
]);

const modelResolutionSourceRefSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("action"), ref: modelReferenceSchema }),
  z.strictObject({ kind: z.literal("entity"), ref: modelReferenceSchema }),
  z.strictObject({ kind: z.literal("fact"), ref: modelReferenceSchema }),
  z.strictObject({ kind: z.literal("condition"), ref: modelReferenceSchema }),
  z.strictObject({ kind: z.literal("rating"), ref: modelReferenceSchema }),
  z.strictObject({ kind: z.literal("law"), ref: modelReferenceSchema }),
  z.strictObject({ kind: z.literal("placement"), ref: modelReferenceSchema }),
]);

const resolutionFactorSchema = z.strictObject({
  source: resolutionSourceRefSchema,
  role: z.enum(["permission", "control", "potency", "protection", "secondary", "risk"]),
  direction: z.enum(["helpful", "hindering", "neutral"]),
  steps: z.union([z.literal(0), z.literal(1), z.literal(2)]),
  authority: z.enum(["semantic", "authored"]),
  channel: z.string().min(1).nullable(),
  explanation: z.string().min(1),
});

const effectBaseShape = {
  id: semanticIdSchema,
  targetId: semanticIdSchema,
  channel: z.string().min(1),
  label: z.string().min(1),
  description: z.string().min(1),
  sourceRefs: z.array(resolutionSourceRefSchema).min(1),
};
const magnitudeBandSchema = z.enum(["none", "minor", "standard", "major", "decisive"]);
const meterEffectIntentSchema = z.strictObject({
  kind: z.literal("meter"),
  ...effectBaseShape,
  meterId: semanticIdSchema,
  impactProfileId: semanticIdSchema,
  magnitude: magnitudeBandSchema,
});
const conditionEffectIntentSchema = z.strictObject({
  kind: z.literal("condition"),
  ...effectBaseShape,
  conditionId: semanticIdSchema,
  conditionProfileId: semanticIdSchema.nullable(),
  durationProfileId: semanticIdSchema,
  access: accessSchema,
  magnitude: magnitudeBandSchema,
});
const effectIntentSchema = z.discriminatedUnion("kind", [meterEffectIntentSchema, conditionEffectIntentSchema]);
const threatenedEffectSchema = z.discriminatedUnion("kind", [
  meterEffectIntentSchema.omit({ magnitude: true }),
  conditionEffectIntentSchema.omit({ magnitude: true }),
]);
const resolutionDifficultySchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("environment"),
    band: z.enum(["trivial", "easy", "challenging", "hard", "extreme"]),
    source: resolutionSourceRefSchema,
  }),
  z.strictObject({
    kind: z.literal("opposed"),
    targetId: semanticIdSchema,
    ratingId: semanticIdSchema,
    source: resolutionSourceRefSchema,
  }),
]);

function resolutionPlanSchemaWithId(id: z.ZodType<string>) {
  return z.strictObject({
    id,
    actionId: safeIdSchema,
    actorId: semanticIdSchema,
    targetIds: z.array(semanticIdSchema),
    goal: z.string().min(1),
    means: z.array(z.strictObject({ description: z.string().min(1), source: resolutionSourceRefSchema })),
    mode: z.enum(["automatic", "check", "blocked"]),
    difficulty: resolutionDifficultySchema.nullable(),
    actorRatingId: semanticIdSchema.nullable(),
    factors: z.array(resolutionFactorSchema),
    risk: z.enum(["safe", "risky", "dire"]),
    baseEffect: magnitudeBandSchema,
    primaryEffect: effectIntentSchema.nullable(),
    secondaryEffect: effectIntentSchema.nullable(),
    threatenedEffect: threatenedEffectSchema.nullable(),
    visibility: z.enum(["full", "result_only", "hidden"]),
    causes: z.array(causalRefSchema).min(1),
  });
}

const modelResolutionEffectBaseShape = {
  proposalKey: proposalKeySchema,
  targetRef: modelReferenceSchema,
  channel: z.string().min(1),
  label: z.string().min(1),
  description: z.string().min(1),
  sourceRefs: z.array(modelResolutionSourceRefSchema).min(1),
};
const modelMeterEffectIntentSchema = z.strictObject({
  kind: z.literal("meter"),
  ...modelResolutionEffectBaseShape,
  meterRef: modelReferenceSchema,
  impactProfileRef: modelReferenceSchema,
  magnitude: magnitudeBandSchema,
});
const modelConditionEffectIntentSchema = z.strictObject({
  kind: z.literal("condition"),
  ...modelResolutionEffectBaseShape,
  conditionRef: modelReferenceSchema,
  conditionProfileRef: modelReferenceSchema.nullable(),
  durationProfileRef: modelReferenceSchema,
  access: modelAccessSchema,
  magnitude: magnitudeBandSchema,
});
const modelEffectIntentSchema = z.discriminatedUnion("kind", [modelMeterEffectIntentSchema, modelConditionEffectIntentSchema]);
const modelThreatenedEffectSchema = z.discriminatedUnion("kind", [
  modelMeterEffectIntentSchema.omit({ magnitude: true }),
  modelConditionEffectIntentSchema.omit({ magnitude: true }),
]);
const modelResolutionDifficultySchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("environment"), band: z.enum(["trivial", "easy", "challenging", "hard", "extreme"]), source: modelResolutionSourceRefSchema }),
  z.strictObject({ kind: z.literal("opposed"), targetRef: modelReferenceSchema, ratingRef: modelReferenceSchema, source: modelResolutionSourceRefSchema }),
]);
const modelResolutionFactorBaseShape = {
  source: modelResolutionSourceRefSchema,
  explanation: z.string().min(1),
};
const modelNonNumericResolutionFactorSchema = (role: "permission" | "secondary" | "risk") => z.strictObject({
  ...modelResolutionFactorBaseShape,
  role: z.literal(role),
  direction: z.literal("neutral"),
  steps: z.literal(0),
  authority: z.enum(["semantic", "authored"]),
  channel: z.string().min(1).nullable(),
});
const modelControlResolutionFactorSchema = z.strictObject({
  ...modelResolutionFactorBaseShape,
  role: z.literal("control"),
  direction: z.enum(["helpful", "hindering"]),
  steps: z.literal(1),
  authority: z.enum(["semantic", "authored"]),
  channel: z.string().min(1).nullable(),
});
const modelMagnitudeResolutionFactorSchema = (role: "potency" | "protection") => z.union([
  z.strictObject({
    ...modelResolutionFactorBaseShape,
    role: z.literal(role),
    direction: z.enum(["helpful", "hindering"]),
    steps: z.literal(1),
    authority: z.literal("semantic"),
    channel: z.string().min(1),
  }),
  z.strictObject({
    ...modelResolutionFactorBaseShape,
    role: z.literal(role),
    direction: z.enum(["helpful", "hindering"]),
    steps: z.union([z.literal(1), z.literal(2)]),
    authority: z.literal("authored"),
    channel: z.string().min(1),
  }),
]);
const modelResolutionFactorSchema = z.union([
  modelNonNumericResolutionFactorSchema("permission"),
  modelNonNumericResolutionFactorSchema("secondary"),
  modelNonNumericResolutionFactorSchema("risk"),
  modelControlResolutionFactorSchema,
  modelMagnitudeResolutionFactorSchema("potency"),
  modelMagnitudeResolutionFactorSchema("protection"),
]);
const modelResolutionPlanBaseShape = {
  proposalKey: proposalKeySchema,
  actionRef: modelReferenceSchema,
  targetRefs: z.array(modelReferenceSchema),
  means: z.array(z.strictObject({ description: z.string().min(1), source: modelResolutionSourceRefSchema })),
  factors: z.array(modelResolutionFactorSchema),
  risk: z.enum(["safe", "risky", "dire"]),
  baseEffect: magnitudeBandSchema,
  primaryEffect: modelEffectIntentSchema.nullable(),
  secondaryEffect: modelEffectIntentSchema.nullable(),
  threatenedEffect: modelThreatenedEffectSchema.nullable(),
  visibility: z.enum(["full", "result_only", "hidden"]),
  causes: z.array(modelCausalRefSchema).min(1),
};
const modelResolutionPlanSchema = z.discriminatedUnion("mode", [
  z.strictObject({
    ...modelResolutionPlanBaseShape,
    mode: z.literal("automatic"),
    difficulty: z.null(),
    actorRatingRef: z.null(),
  }),
  z.strictObject({
    ...modelResolutionPlanBaseShape,
    mode: z.literal("check"),
    difficulty: modelResolutionDifficultySchema,
    actorRatingRef: modelReferenceSchema.nullable(),
  }),
  z.strictObject({
    ...modelResolutionPlanBaseShape,
    mode: z.literal("blocked"),
    difficulty: z.null(),
    actorRatingRef: z.null(),
  }),
]);

export type ResolutionPlanDraft = z.infer<typeof modelResolutionPlanSchema>;
export const resolutionPlanDraftSchema = modelResolutionPlanSchema;
export const resolutionPlanSchema = resolutionPlanSchemaWithId(
  runtimeIdSchema.refine((id) => id.startsWith("rt:resolution-plan:")),
) as z.ZodType<ResolutionPlan>;

export const worldDeltaOperationSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("create_entity"),
    entity: entitySchema,
    placementId: semanticIdSchema.nullable(),
    ...causalSourceShape,
  }),
  z.strictObject({ kind: z.literal("retire_entity"), entityId: semanticIdSchema, ...causalSourceShape }),
  z.strictObject({
    kind: z.literal("place_entity"),
    entityId: semanticIdSchema,
    placementId: semanticIdSchema.nullable(),
    ...causalSourceShape,
  }),
  z.strictObject({ kind: z.literal("set_fact"), fact: factSchema, ...causalSourceShape }),
  z.strictObject({ kind: z.literal("remove_fact"), factId: persistedFactIdSchema, ...causalSourceShape }),
  z.strictObject({ kind: z.literal("set_meter"), meter: meterSchema, ...causalSourceShape }),
  z.strictObject({ kind: z.literal("adjust_meter"), meterId: semanticIdSchema, amount: z.number().finite(), ...causalSourceShape }),
  z.strictObject({
    kind: z.literal("transfer_quantity"),
    definitionId: semanticIdSchema,
    fromHolderId: semanticIdSchema,
    toHolderId: semanticIdSchema,
    amount: z.number().positive(),
    ...causalSourceShape,
  }),
  z.strictObject({
    kind: z.literal("produce_quantity"),
    definitionId: semanticIdSchema,
    holderId: semanticIdSchema,
    amount: z.number().positive(),
    lawId: semanticIdSchema,
    ...causalSourceShape,
  }),
  z.strictObject({
    kind: z.literal("consume_quantity"),
    definitionId: semanticIdSchema,
    holderId: semanticIdSchema,
    amount: z.number().positive(),
    lawId: semanticIdSchema,
    ...causalSourceShape,
  }),
  z.strictObject({ kind: z.literal("set_quantity"), quantity: quantityStateSchema, ...causalSourceShape }),
  z.strictObject({ kind: z.literal("set_rating"), rating: ratingSchema, ...causalSourceShape }),
  z.strictObject({ kind: z.literal("set_condition"), condition: conditionStateSchema, ...causalSourceShape }),
  z.strictObject({ kind: z.literal("remove_condition"), conditionId: semanticIdSchema, ...causalSourceShape }),
  z.strictObject({
    kind: z.literal("set_shared_activity_resource_capacity"),
    poolId: runtimeIdSchema.refine((id) => isRuntimeId(id, "shared-resource-pool")),
    capacity: z.number().finite().nonnegative(),
    ...causalSourceShape,
  }),
  z.strictObject({ kind: z.literal("advance_time"), seconds: z.number().int().positive(), ...causalSourceShape }),
  z.strictObject({ kind: z.literal("create_agent"), agent: agentStateSchema, ...causalSourceShape }),
  z.strictObject({ kind: z.literal("remove_agent"), agentId: semanticIdSchema, ...causalSourceShape }),
]) as z.ZodType<WorldDeltaOperation>;

export const resolutionReceiptSchema = z.strictObject({
  id: runtimeIdSchema.refine((id) => id.startsWith("rt:resolution-receipt:")),
  plan: resolutionPlanSchema,
  settled: z.boolean(),
  checkRequestId: runtimeIdSchema.refine((id) => id.startsWith("rt:check:")).nullable(),
  dc: z.number().int().nullable(),
  modifier: z.number().finite(),
  checkMode: z.enum(["normal", "advantage", "disadvantage"]).nullable(),
  dice: z.array(z.number().int().min(1).max(20)).max(2),
  kept: z.number().int().min(1).max(20).nullable(),
  total: z.number().finite().nullable(),
  margin: z.number().finite().nullable(),
  outcome: z.enum(["exceptional", "full", "mixed", "miss"]).nullable(),
  effects: z.array(z.strictObject({
    role: z.enum(["primary", "secondary", "consequence"]),
    magnitude: magnitudeBandSchema,
    intent: effectIntentSchema,
  })),
  operations: z.array(worldDeltaOperationSchema),
}) as z.ZodType<ResolutionReceipt>;

export const mechanicResultSchema = z.strictObject({
  invocationId: runtimeIdSchema.refine((id) => id.startsWith("rt:mechanic:")),
  packageId: safeIdSchema,
  ruleId: safeIdSchema,
  code: z.string().min(1),
  data: z.json(),
  operations: z.array(worldDeltaOperationSchema),
}) as z.ZodType<MechanicResult>;

export const mechanicInvocationRepairSchema = z.strictObject({
  invocation: modelMechanicInvocationSchema,
});
const persistedMechanicInvocationSchema = z.strictObject({
  id: runtimeIdSchema.refine((id) => id.startsWith("rt:mechanic:")),
  packageId: safeIdSchema,
  ruleId: safeIdSchema,
  input: z.json(),
  ...causalSourceShape,
});

/** Model-facing random requests select an authored distribution from the
 * request catalog. The engine assigns the runtime request id only after the
 * whole round has passed semantic validation. */
export const discreteRandomRequestProposalSchema = z.strictObject({
  proposalKey: proposalKeySchema,
  distributionRef: modelReferenceSchema,
  causes: z.array(modelCausalRefSchema).min(1).max(16),
});

export type DiscreteRandomRequestProposal = z.infer<typeof discreteRandomRequestProposalSchema>;

const actionOutcomeSchema = z.strictObject({
  proposalId: safeIdSchema,
  status: z.enum(["succeeded", "partial", "failed", "blocked", "continuing"]),
  summary: z.string(),
  causeRefs: z.array(causalRefSchema),
  assertions: z.array(causalAssertionSchema).min(1),
  knownAlternatives: z.array(z.strictObject({
    description: z.string().min(1),
    basis: z.discriminatedUnion("kind", [
      z.strictObject({ kind: z.literal("knowledge"), evidenceIds: z.array(safeIdSchema).min(1) }),
      z.strictObject({ kind: z.literal("observation"), observationId: safeIdSchema }),
    ]),
  })),
});
const persistedActionOutcomeSchema = z.strictObject({
  id: runtimeIdSchema.refine((id) => id.startsWith("rt:outcome:")),
  ...actionOutcomeSchema.shape,
});

const worldEventSchema = z.strictObject({
  id: draftAliasSchema,
  description: z.string(),
  impact: z.enum(["ordinary", "significant", "transformative"]),
  causes: z.array(causalRefSchema).min(1),
  assertions: z.array(causalAssertionSchema).min(1),
});
const persistedWorldEventSchema = z.strictObject({
  ...worldEventSchema.shape,
  id: runtimeIdSchema.refine((id) => id.startsWith("rt:event:")),
  step: z.number().int().nonnegative(),
});

const introductionSchema = z.strictObject({
  localEntity: localEntitySchema,
  canonicalEntityId: semanticIdSchema.nullable(),
});

const observationDraftShape = {
  observerId: semanticIdSchema,
  summary: z.string(),
  introductions: z.array(introductionSchema),
  sourceEventIds: z.array(safeIdSchema),
};

const modelObservationIntroductionSchema = z.strictObject({
  localEntity: modelLocalEntitySchema,
  canonicalEntityRef: modelReferenceSchema.nullable(),
});

const modelApparentClaimSchema = z.strictObject({
  subjectRef: modelReferenceSchema,
  predicate: z.string().min(1),
  value: modelBeliefValueSchema,
  description: z.string(),
});

export const modelObservationRenderDraftSchema = z.strictObject({
  summary: z.string().trim().min(1),
  introductions: z.array(modelObservationIntroductionSchema),
  apparentClaims: z.array(modelApparentClaimSchema),
  sourceEventRefs: z.array(modelReferenceSchema),
});
export type ModelObservationRenderDraft = z.infer<typeof modelObservationRenderDraftSchema>;

export const persistedObservationSchema = z.strictObject({
  id: runtimeIdSchema,
  ...observationDraftShape,
  step: z.number().int().nonnegative(),
  kind: z.enum(["stimulus", "outcome"]),
  apparentClaims: z.array(z.strictObject({
    id: runtimeIdSchema,
    subjectId: semanticIdSchema,
    predicate: z.string().min(1),
    value: beliefValueSchema,
    description: z.string(),
  })),
});

export const reactionRequestSchema = z.strictObject({
  id: runtimeIdSchema,
  agentId: semanticIdSchema,
  triggerActionId: safeIdSchema,
  originalIntent: z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("prepared_action"), actionId: safeIdSchema }),
    z.strictObject({
      kind: z.literal("ongoing_activity"),
      activityId: runtimeIdSchema,
      sourceActionId: safeIdSchema,
    }),
  ]),
  stimulus: persistedObservationSchema,
  basis: z.array(z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("shared_placement"), placementId: safeIdSchema }),
    z.strictObject({ kind: z.literal("fact"), factId: safeIdSchema }),
    z.strictObject({ kind: z.literal("perception_check"), checkId: safeIdSchema }),
  ])).min(1),
}) as z.ZodType<ReactionRequest>;

const reactionRequestDraftSchema = z.strictObject({
  agentRef: modelReferenceSchema,
  sourceActionRef: modelReferenceSchema,
  stimulus: modelObservationRenderDraftSchema,
  basis: z.array(z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("shared_placement"), placementRef: modelReferenceSchema }),
    z.strictObject({ kind: z.literal("fact"), factRef: modelReferenceSchema }),
    z.strictObject({ kind: z.literal("perception_check"), checkRef: modelReferenceSchema }),
  ])).min(1),
});

export type ReactionRequestDraft = z.infer<typeof reactionRequestDraftSchema>;

export const reactionDecisionSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    requestId: runtimeIdSchema,
    source: z.enum(["model", "external", "replay", "profile_fallback"]),
    agentId: semanticIdSchema,
    baseRevision: z.number().int().nonnegative(),
    originalProposalId: safeIdSchema,
    kind: z.literal("keep"),
    ongoingActivityDisposition: z.enum(["continue", "pause", "cancel"]),
  }),
  z.strictObject({
    requestId: runtimeIdSchema,
    source: z.enum(["model", "external", "replay", "profile_fallback"]),
    agentId: semanticIdSchema,
    baseRevision: z.number().int().nonnegative(),
    originalProposalId: safeIdSchema,
    kind: z.literal("replace"),
    replacementAction: actionProposalSchema,
  }),
]) as z.ZodType<ReactionDecision>;

export type ReactionDecisionDraft =
  | { kind: "keep" }
  | { kind: "replace"; replacementAction: AgentActionDraft };

export const reactionDecisionDraftSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("keep") }),
  z.strictObject({ kind: z.literal("replace"), replacementAction: actionDraftSchema }),
]) as z.ZodType<ReactionDecisionDraft>;

export const transitionProposalSchema = modelTransitionProposalSchema;

/** Strict engine-owned envelopes for independent Truth Engine slots. */
export const truthTransitionBatchSchema = z.strictObject({
  slots: z.array(z.strictObject({
    slot: z.number().int().nonnegative(),
    result: transitionProposalSchema,
  })),
});

/** One observer slot; batch orchestration is intentionally engine-owned. */
export const observationRenderSchema = modelObservationRenderDraftSchema;

export const observationBatchSchema = z.strictObject({
  observations: z.array(modelObservationRenderDraftSchema),
});

export const observationProjectionBatchSchema = z.strictObject({
  slots: z.array(z.strictObject({
    slot: z.number().int().nonnegative(),
    result: modelObservationRenderDraftSchema,
  })),
});

const sharedActivityResourceClaimDraftSchema = z.strictObject({
  resourcePoolRef: existingReferenceHandleSchema,
  basis: z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("default") }),
    z.strictObject({
      kind: z.literal("explicit_quantity"),
      amount: z.number().positive().finite(),
      unit: z.string().min(1),
      sourceText: z.string().min(1),
    }),
  ]),
});

export const actionGroundingSchema = z.strictObject({
  stateDependencies: z.strictObject({
    requiredExistingRefs: z.array(existingReferenceHandleSchema),
    potentiallyAffectedExistingRefs: z.array(existingReferenceHandleSchema),
  }),
  audienceAgentRefs: z.array(existingReferenceHandleSchema),
  sharedResourceClaims: z.array(sharedActivityResourceClaimDraftSchema),
}) as z.ZodType<ActionCompilationDraft["interactionDependency"]>;

export const temporalPlanDraftSchema = z.strictObject({
  profileRef: modelReferenceSchema,
  basis: z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("profile") }),
    z.strictObject({
      kind: z.literal("action_text_evidence"),
      evidenceKey: z.string().min(1),
    }),
  ]),
  description: z.string().min(1),
  continuationAssertions: z.array(modelCausalAssertionSchema),
  causes: z.array(modelCausalRefSchema).min(1),
}) as unknown as z.ZodType<ActionCompilationDraft["temporalPlan"]>;

export interface ActionCompilationBatchDraft {
  slots: Array<ActionCompilationDraft & { slot: number }>;
}

export const actionCompilationSlotSchema = z.strictObject({
  slot: z.number().int().nonnegative(),
  temporalPlan: temporalPlanDraftSchema,
  interactionDependency: actionGroundingSchema,
});

export const actionCompilationBatchSchema = z.strictObject({
  slots: z.array(actionCompilationSlotSchema),
}) as z.ZodType<ActionCompilationBatchDraft>;

export interface ArrivalDraft {
  title: string;
  scene: string;
  possibleNextActions: [string, string, string];
}

export const arrivalDraftSchema = z.strictObject({
  title: z.string().trim().min(1).max(120),
  scene: z.string().trim().min(1).max(4_000),
  possibleNextActions: z.tuple([
    z.string().trim().min(1).max(500),
    z.string().trim().min(1).max(500),
    z.string().trim().min(1).max(500),
  ]),
});

export const persistedTransitionProposalSchema = z.strictObject({
  baseRevision: z.number().int().nonnegative(),
  outcomes: z.array(persistedActionOutcomeSchema),
  mechanicInvocations: z.array(persistedMechanicInvocationSchema),
  operations: z.array(worldDeltaOperationSchema),
  events: z.array(persistedWorldEventSchema),
  observations: z.array(persistedObservationSchema),
  decisionRequests: z.array(z.strictObject({
    agentId: semanticIdSchema,
    prompt: z.string().min(1),
    possibleNextActions: z.array(z.string().min(1)).max(3),
  })),
}) as z.ZodType<TransitionProposal>;

export const perceptionDirectiveSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("request_checks"), requests: z.array(checkRequestSchema).min(1) }),
  z.strictObject({ kind: z.literal("done") }),
]);

export const reactionRoutingOutputSchema = z.strictObject({
  requests: z.array(reactionRequestDraftSchema),
});

export const resolutionDirectiveSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("commit_plans"), plans: z.array(resolutionPlanDraftSchema).min(1) }),
  z.strictObject({
    kind: z.literal("request_random"),
    requests: z.array(discreteRandomRequestProposalSchema).min(1).max(MAX_RANDOM_REQUESTS_PER_ROUND),
  }),
  z.strictObject({ kind: z.literal("done") }),
]);

const resolutionPlanFindingSchema = z.strictObject({
  planRef: modelReferenceSchema,
  code: z.enum([
    "ungrounded-mean",
    "omitted-factor",
    "irrelevant-factor",
    "duplicated-source",
    "impact-overstated",
    "secondary-reuse",
    "calibration-drift",
  ]),
  message: z.string().min(1),
  repairHint: z.string().min(1),
});

export const resolutionPlanVerificationSchema = z.discriminatedUnion("verdict", [
  z.strictObject({ verdict: z.literal("accept"), findings: z.tuple([]) }),
  z.strictObject({
    verdict: z.literal("reject"),
    findings: z.array(resolutionPlanFindingSchema).min(1),
  }),
]);

export const resolutionPlanVerificationBatchSchema = z.strictObject({
  slots: z.array(z.strictObject({
    slot: z.number().int().nonnegative(),
    result: resolutionPlanVerificationSchema,
  })),
});

export type ResolutionPlanVerification = z.infer<typeof resolutionPlanVerificationSchema>;

const causalFindingSchema = z.strictObject({
  target: z.strictObject({
    kind: z.enum(["check", "random", "operation", "mechanic", "event", "outcome", "observation"]),
    targetHandle: modelReferenceSchema,
  }),
  evidenceHandles: z.array(modelReferenceSchema),
  code: z.enum([
    "irrelevant-cause",
    "missing-precondition",
    "check-result-contradiction",
    "law-violation",
    "effect-mismatch",
    "impact-overstated",
    "observation-mismatch",
  ]),
  message: z.string().min(1),
  repairHint: z.string().min(1),
});

export const causalVerificationSchema = z.discriminatedUnion("verdict", [
  z.strictObject({ verdict: z.literal("accept"), findings: z.tuple([]) }),
  z.strictObject({ verdict: z.literal("reject"), findings: z.array(causalFindingSchema).min(1) }),
]);
export type ModelCausalVerification = z.infer<typeof causalVerificationSchema>;

export const causalVerificationBatchSchema = z.strictObject({
  slots: z.array(z.strictObject({
    slot: z.number().int().nonnegative(),
    result: causalVerificationSchema,
  })),
});

export const truthResolutionBatchSchema = z.strictObject({
  slots: z.array(z.strictObject({
    slot: z.number().int().nonnegative(),
    result: resolutionDirectiveSchema,
  })),
});

export const causalAssertionResultSchema = z.strictObject({
  target: z.strictObject({
    kind: z.enum(["check", "random", "operation", "mechanic", "event", "outcome", "observation"]),
    id: safeIdSchema,
  }),
  assertion: causalAssertionSchema,
  passed: z.boolean(),
  observed: z.json(),
}) as z.ZodType<CausalAssertionResult>;
