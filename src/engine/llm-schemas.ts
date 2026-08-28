import { z } from "zod";
import type {
  AgentActionDraft,
  AgentActionProposal,
  AgentCharacterStateDraft,
  AgentStateDraft,
  BeliefPatch,
  BeliefPatchDraftOperation,
  CausalAssertionResult,
  CausalVerification,
  CharacterPatch,
  D20CheckRequest,
  D20CheckRequestDraft,
  MechanicResult,
  ReactionDecision,
  ReactionRequest,
  ReactionStimulusDraft,
  TransitionProposal,
  TransitionProposalDraft,
  ObservationRenderDraft,
  WorldDeltaOperation,
  WorldDeltaOperationDraft,
} from "./model";
import type { ResolutionPlan, ResolutionReceipt } from "./resolution";
import type { ActionCompilationDraft, InteractionDependencyDraft } from "./execution";
import type { TemporalPlanDraft } from "./temporal";
import { MAX_RANDOM_REQUESTS_PER_ROUND } from "./random-limits";
import { isRuntimeId } from "./runtime-id";
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
  factValueSchema,
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

const draftAliasSchema = z.string().min(1).refine(
  isNormalizedBoundedId,
  { message: "draft aliases must be NFC, trimmed, control-free, and at most 128 UTF-8 bytes" },
);

export const actionDraftSchema = z.strictObject({
  rawText: z.string().min(1),
  goal: z.string().min(1),
  means: z.string().min(1).nullable(),
  targetIds: z.array(semanticIdSchema),
}) as z.ZodType<AgentActionDraft>;

const causalSourceShape = {
  causes: z.array(causalRefSchema).min(1),
  assertions: z.array(causalAssertionSchema).min(1),
};

const evidenceDraftSchema = z.strictObject({
  id: semanticIdSchema,
  kind: z.enum(["observation", "testimony", "inference", "assumption"]),
  description: z.string().min(1),
  sourceId: safeIdSchema.nullable(),
});

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

const beliefPatchDraftSchema = z.strictObject({
  operations: z.array(makeBeliefPatchOperationSchema(evidenceDraftSchema)),
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

export interface AgentMindDraftOutput {
  beliefPatch: { operations: BeliefPatchDraftOperation[] };
  characterPatch: Pick<CharacterPatch, "operations">;
  nextAction: AgentActionDraft;
}

export const agentMindOutputSchema = z.strictObject({
  beliefPatch: beliefPatchDraftSchema,
  characterPatch: characterPatchSchema.pick({ operations: true }),
  nextAction: actionDraftSchema,
}) as z.ZodType<AgentMindDraftOutput>;

export interface AgentMindBatchDraftOutput {
  slots: Array<AgentMindDraftOutput & { slot: number }>;
}

export const agentMindBatchOutputSchema = z.strictObject({
  slots: z.array(z.strictObject({
    slot: z.number().int().nonnegative(),
    beliefPatch: beliefPatchDraftSchema,
    characterPatch: characterPatchSchema.pick({ operations: true }),
    nextAction: actionDraftSchema,
  })),
}) as z.ZodType<AgentMindBatchDraftOutput>;

export interface AgentMindOutput {
  beliefPatch: BeliefPatch;
  characterPatch: CharacterPatch;
  nextAction: AgentActionProposal;
}

const checkRequestShape = {
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

export const checkRequestSchema = z.strictObject({
  id: draftAliasSchema,
  ...checkRequestShape,
}) as z.ZodType<D20CheckRequestDraft>;

export const persistedCheckRequestSchema = z.strictObject({
  id: runtimeIdSchema,
  ...checkRequestShape,
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

export type ResolutionPlanDraft = ResolutionPlan;
export const resolutionPlanDraftSchema = resolutionPlanSchemaWithId(draftAliasSchema) as z.ZodType<ResolutionPlanDraft>;
export const resolutionPlanSchema = resolutionPlanSchemaWithId(
  runtimeIdSchema.refine((id) => id.startsWith("rt:resolution-plan:")),
) as z.ZodType<ResolutionPlan>;

const characterRecordDraftShape = {
  id: semanticIdSchema,
  description: z.string().min(1),
  evidenceIds: z.array(safeIdSchema),
};

const characterFacetDraftSchema = z.strictObject({
  ...characterRecordDraftShape,
  strength: z.number().min(0).max(1),
  status: z.enum(["active", "retired"]),
});
const emotionStateDraftSchema = z.strictObject({
  ...characterRecordDraftShape,
  intensity: z.number().min(0).max(1),
  status: z.enum(["active", "resolved"]),
});
const attitudeStateDraftSchema = z.strictObject({
  ...characterRecordDraftShape,
  subjectId: semanticIdSchema,
  intensity: z.number().min(0).max(1),
  status: z.enum(["active", "retired"]),
});
const agentGoalDraftSchema = z.strictObject({
  ...characterRecordDraftShape,
  priority: z.number().min(0).max(1),
  progress: z.number().min(0).max(1),
  targetIds: z.array(semanticIdSchema),
  parentGoalId: semanticIdSchema.optional(),
  motivatedByIds: z.array(semanticIdSchema),
  status: z.enum(["active", "suspended", "completed", "failed", "abandoned"]),
});
const agentCommitmentDraftSchema = z.strictObject({
  ...characterRecordDraftShape,
  priority: z.number().min(0).max(1),
  subjectIds: z.array(semanticIdSchema),
  status: z.enum(["active", "fulfilled", "broken", "released"]),
});
const agentCharacterStateDraftSchema = z.strictObject({
  persona: z.strictObject({
    summary: z.string().min(1),
    voice: z.string(),
    evidenceIds: z.array(safeIdSchema),
  }),
  traits: z.record(semanticIdSchema, characterFacetDraftSchema),
  values: z.record(semanticIdSchema, characterFacetDraftSchema),
  emotions: z.record(semanticIdSchema, emotionStateDraftSchema),
  attitudes: z.record(semanticIdSchema, attitudeStateDraftSchema),
  goals: z.record(semanticIdSchema, agentGoalDraftSchema),
  commitments: z.record(semanticIdSchema, agentCommitmentDraftSchema),
}) as z.ZodType<AgentCharacterStateDraft>;

const beliefStateDraftSchema = z.strictObject({
  localEntities: z.record(semanticIdSchema, localEntitySchema),
  claims: z.record(semanticIdSchema, beliefClaimSchema),
  evidence: z.record(semanticIdSchema, evidenceDraftSchema),
});

const agentStateDraftSchema = z.strictObject({
  id: semanticIdSchema,
  entityId: semanticIdSchema,
  character: agentCharacterStateDraftSchema,
  belief: beliefStateDraftSchema,
  bindings: z.record(semanticIdSchema, z.strictObject({
    localEntityId: semanticIdSchema,
    canonicalEntityIds: z.array(semanticIdSchema),
  })),
}) as z.ZodType<AgentStateDraft>;

const entityDraftSchema = z.strictObject({
  id: semanticIdSchema,
  kind: z.string().min(1),
  name: z.string().min(1),
  description: z.string(),
});

const factDraftSchema = z.strictObject({
  id: semanticIdSchema,
  subjectId: semanticIdSchema,
  predicate: z.string().min(1),
  value: factValueSchema,
  description: z.string(),
  access: accessSchema,
});

export const worldDeltaOperationDraftSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("create_entity"),
    entity: entityDraftSchema,
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
  z.strictObject({ kind: z.literal("set_fact"), fact: factDraftSchema, ...causalSourceShape }),
  z.strictObject({ kind: z.literal("remove_fact"), factId: persistedFactIdSchema, ...causalSourceShape }),
  z.strictObject({ kind: z.literal("create_agent"), agent: agentStateDraftSchema, ...causalSourceShape }),
  z.strictObject({ kind: z.literal("remove_agent"), agentId: semanticIdSchema, ...causalSourceShape }),
]) as z.ZodType<WorldDeltaOperationDraft>;

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

const mechanicInvocationSchema = z.strictObject({
  id: draftAliasSchema,
  packageId: safeIdSchema,
  ruleId: safeIdSchema,
  input: z.json(),
  ...causalSourceShape,
});
const persistedMechanicInvocationSchema = z.strictObject({
  id: runtimeIdSchema.refine((id) => id.startsWith("rt:mechanic:")),
  packageId: safeIdSchema,
  ruleId: safeIdSchema,
  input: z.json(),
  ...causalSourceShape,
});

export const discreteRandomRequestProposalSchema = z.strictObject({
  id: draftAliasSchema,
  distributionId: safeIdSchema,
  causes: z.array(causalRefSchema).min(1).max(16),
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
const transitionActionOutcomeSchema = actionOutcomeSchema.extend({
  knownAlternatives: z.array(z.strictObject({
    description: z.string().min(1),
    basis: z.strictObject({
      kind: z.literal("knowledge"),
      evidenceIds: z.array(safeIdSchema).min(1),
    }),
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

const apparentClaimDraftSchema = z.strictObject({
  subjectId: semanticIdSchema,
  predicate: z.string().min(1),
  value: beliefValueSchema,
  description: z.string(),
});

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
  agentId: semanticIdSchema,
  sourceActionId: safeIdSchema,
  stimulus: z.strictObject({
    summary: z.string(),
    introductions: z.array(introductionSchema),
    apparentClaims: z.array(apparentClaimDraftSchema),
  }) as z.ZodType<ReactionStimulusDraft>,
  basis: z.array(z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("shared_placement"), placementId: safeIdSchema }),
    z.strictObject({ kind: z.literal("fact"), factId: safeIdSchema }),
    z.strictObject({ kind: z.literal("perception_check"), checkId: safeIdSchema }),
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

export const transitionProposalSchema = z.strictObject({
  outcomes: z.array(transitionActionOutcomeSchema),
  mechanicInvocations: z.array(mechanicInvocationSchema),
  operations: z.array(worldDeltaOperationDraftSchema),
  events: z.array(worldEventSchema),
  decisionRequests: z.array(z.strictObject({
    agentId: semanticIdSchema,
    prompt: z.string().min(1),
    suggestions: z.array(z.string().min(1)).max(3),
  })),
}) as z.ZodType<TransitionProposalDraft>;

const observationRenderDraftSchema = z.strictObject({
  summary: z.string().trim().min(1),
  introductions: z.array(introductionSchema),
  apparentClaims: z.array(apparentClaimDraftSchema),
  sourceEventIds: z.array(safeIdSchema),
}) as z.ZodType<ObservationRenderDraft>;

export const observationBatchSchema = z.strictObject({
  observations: z.array(observationRenderDraftSchema),
});

const footprintRefSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("entity"), id: semanticIdSchema }),
  z.strictObject({ kind: z.literal("fact"), id: persistedFactIdSchema }),
  z.strictObject({ kind: z.literal("placement"), id: semanticIdSchema }),
  z.strictObject({ kind: z.literal("meter"), id: semanticIdSchema }),
  z.strictObject({ kind: z.literal("quantity"), id: runtimeIdSchema }),
  z.strictObject({ kind: z.literal("rating"), id: semanticIdSchema }),
  z.strictObject({ kind: z.literal("condition"), id: semanticIdSchema }),
  z.strictObject({
    kind: z.literal("shared_resource_pool"),
    id: runtimeIdSchema.refine((id) => isRuntimeId(id, "shared-resource-pool")),
  }),
  z.strictObject({ kind: z.literal("global"), id: z.literal("world") }),
]);

const sharedActivityResourceClaimDraftSchema = z.strictObject({
  poolId: runtimeIdSchema.refine((id) => isRuntimeId(id, "shared-resource-pool")),
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
  reads: z.array(footprintRefSchema),
  writes: z.array(footprintRefSchema),
  audienceAgentIds: z.array(semanticIdSchema),
  sharedResourceClaims: z.array(sharedActivityResourceClaimDraftSchema),
  globalFallback: z.boolean(),
}) as z.ZodType<InteractionDependencyDraft>;

export const temporalPlanDraftSchema = z.strictObject({
  profileId: semanticIdSchema,
  basis: z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("profile") }),
    z.strictObject({
      kind: z.literal("explicit_duration"),
      seconds: z.number().int().positive(),
      sourceText: z.string().min(1),
    }),
    z.strictObject({
      kind: z.literal("explicit_quantity"),
      amount: z.number().positive(),
      unit: z.string().min(1),
      sourceText: z.string().min(1),
    }),
  ]),
  description: z.string().min(1),
  continuationAssertions: z.array(causalAssertionSchema),
  causes: z.array(causalRefSchema).min(1),
}) as z.ZodType<TemporalPlanDraft>;

export interface ActionCompilationBatchDraft {
  slots: Array<ActionCompilationDraft & { slot: number }>;
}

export const actionCompilationBatchSchema = z.strictObject({
  slots: z.array(z.strictObject({
    slot: z.number().int().nonnegative(),
    temporalPlan: temporalPlanDraftSchema,
    interactionDependency: actionGroundingSchema,
  })),
}) as z.ZodType<ActionCompilationBatchDraft>;

export interface ArrivalDraft {
  title: string;
  scene: string;
  suggestions: [string, string, string];
}

export const arrivalDraftSchema = z.strictObject({
  title: z.string().trim().min(1).max(120),
  scene: z.string().trim().min(1).max(4_000),
  suggestions: z.tuple([
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
    suggestions: z.array(z.string().min(1)).max(3),
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
  planId: safeIdSchema,
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

export type ResolutionPlanVerification = z.infer<typeof resolutionPlanVerificationSchema>;

const causalFindingSchema = z.strictObject({
  target: z.strictObject({
    kind: z.enum(["check", "random", "operation", "mechanic", "event", "outcome", "observation"]),
    id: safeIdSchema,
  }),
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
]) as z.ZodType<CausalVerification>;

export const causalAssertionResultSchema = z.strictObject({
  target: z.strictObject({
    kind: z.enum(["check", "random", "operation", "mechanic", "event", "outcome", "observation"]),
    id: safeIdSchema,
  }),
  assertion: causalAssertionSchema,
  passed: z.boolean(),
  observed: z.json(),
}) as z.ZodType<CausalAssertionResult>;
