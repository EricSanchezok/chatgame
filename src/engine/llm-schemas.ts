import { z } from "zod";
import type {
  AgentActionDraft,
  AgentActionProposal,
  BeliefPatch,
  CausalAssertionResult,
  CausalVerification,
  CharacterPatch,
  D20CheckRequest,
  MechanicResult,
  ReactionDecision,
  ReactionRequest,
  TransitionProposal,
  TransitionProposalDraft,
} from "./model";
import { MAX_RANDOM_REQUESTS_PER_ROUND } from "./random-limits";
import {
  actionProposalSchema,
  agentCharacterStateSchema,
  beliefClaimSchema,
  beliefValueSchema,
  causalAssertionSchema,
  causalRefSchema,
  entitySchema,
  evidenceSchema,
  factSchema,
  localEntitySchema,
  meterSchema,
  persistedFactIdSchema,
  ratingSchema,
  safeIdSchema,
  semanticIdSchema,
  isNormalizedBoundedId,
  semanticBeliefStateSchema,
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

export const beliefPatchSchema = z.strictObject({
  agentId: semanticIdSchema,
  baseRevision: z.number().int().nonnegative(),
  operations: z.array(z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("upsert_local_entity"), entity: localEntitySchema }),
    z.strictObject({ kind: z.literal("remove_local_entity"), localEntityId: semanticIdSchema }),
    z.strictObject({ kind: z.literal("upsert_evidence"), evidence: evidenceSchema }),
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
  ])),
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
  beliefPatch: Pick<BeliefPatch, "operations">;
  characterPatch: Pick<CharacterPatch, "operations">;
  nextAction: AgentActionDraft;
}

export const agentMindOutputSchema = z.strictObject({
  beliefPatch: beliefPatchSchema.pick({ operations: true }),
  characterPatch: characterPatchSchema.pick({ operations: true }),
  nextAction: actionDraftSchema,
}) as z.ZodType<AgentMindDraftOutput>;

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
  modifierSources: z.array(z.discriminatedUnion("kind", [
    z.strictObject({
      kind: z.literal("rating"),
      id: safeIdSchema,
      amount: z.number().int().min(-100).max(100),
    }),
    z.strictObject({
      kind: z.literal("fact"),
      id: safeIdSchema,
      amount: z.number().int().min(-100).max(100),
    }),
  ])),
  dc: z.number().int().min(0).max(100),
  mode: z.enum(["normal", "advantage", "disadvantage"]),
  stakes: z.string().min(1),
  visibility: z.enum(["full", "result_only", "hidden"]),
  phase: z.enum(["perception", "resolution"]),
  causes: z.array(causalRefSchema).min(1),
};

export const checkRequestSchema = z.strictObject({
  id: draftAliasSchema,
  ...checkRequestShape,
}) as z.ZodType<D20CheckRequest>;

export const persistedCheckRequestSchema = z.strictObject({
  id: runtimeIdSchema,
  ...checkRequestShape,
}) as z.ZodType<D20CheckRequest>;

const agentStateDraftSchema = z.strictObject({
  id: semanticIdSchema,
  entityId: semanticIdSchema,
  modelProfiles: z.strictObject({
    bootstrap: semanticIdSchema,
    mind: semanticIdSchema,
    reaction: semanticIdSchema,
  }),
  character: agentCharacterStateSchema,
  belief: semanticBeliefStateSchema,
  bindings: z.record(semanticIdSchema, z.strictObject({
    localEntityId: semanticIdSchema,
    canonicalEntityIds: z.array(semanticIdSchema),
  })),
  nextAction: z.null(),
});

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
  z.strictObject({ kind: z.literal("set_rating"), rating: ratingSchema, ...causalSourceShape }),
  z.strictObject({ kind: z.literal("advance_time"), seconds: z.number().int().positive(), ...causalSourceShape }),
  z.strictObject({ kind: z.literal("create_agent"), agent: agentStateDraftSchema, ...causalSourceShape }),
  z.strictObject({ kind: z.literal("remove_agent"), agentId: semanticIdSchema, ...causalSourceShape }),
]);

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
const persistedActionOutcomeSchema = z.strictObject({
  id: runtimeIdSchema.refine((id) => id.startsWith("rt:outcome:")),
  ...actionOutcomeSchema.shape,
});

const worldEventSchema = z.strictObject({
  id: draftAliasSchema,
  step: z.number().int().nonnegative(),
  description: z.string(),
  impact: z.enum(["ordinary", "significant", "transformative"]),
  causes: z.array(causalRefSchema).min(1),
  assertions: z.array(causalAssertionSchema).min(1),
});
const persistedWorldEventSchema = z.strictObject({
  ...worldEventSchema.shape,
  id: runtimeIdSchema.refine((id) => id.startsWith("rt:event:")),
});

const introductionSchema = z.strictObject({
  localEntity: localEntitySchema,
  canonicalEntityId: semanticIdSchema.nullable(),
});

const observationShape = {
  observerId: semanticIdSchema,
  step: z.number().int().nonnegative(),
  kind: z.enum(["stimulus", "outcome"]),
  summary: z.string(),
  introductions: z.array(introductionSchema),
  sourceEventIds: z.array(safeIdSchema),
};

const observationSchema = z.strictObject({
  id: draftAliasSchema,
  ...observationShape,
  apparentClaims: z.array(z.strictObject({
    id: draftAliasSchema,
    subjectId: semanticIdSchema,
    predicate: z.string().min(1),
    value: beliefValueSchema,
    description: z.string(),
  })),
});

export const persistedObservationSchema = z.strictObject({
  id: runtimeIdSchema,
  ...observationShape,
  apparentClaims: z.array(z.strictObject({
    id: runtimeIdSchema,
    subjectId: semanticIdSchema,
    predicate: z.string().min(1),
    value: beliefValueSchema,
    description: z.string(),
  })),
});

export const reactionRequestSchema = z.strictObject({
  agentId: semanticIdSchema,
  sourceActionId: safeIdSchema,
  stimulus: persistedObservationSchema,
  basis: z.array(z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("shared_placement"), placementId: safeIdSchema }),
    z.strictObject({ kind: z.literal("fact"), factId: safeIdSchema }),
    z.strictObject({ kind: z.literal("perception_check"), checkId: safeIdSchema }),
  ])).min(1),
}) as z.ZodType<ReactionRequest>;

const reactionRequestDraftSchema = z.strictObject({
  agentId: semanticIdSchema,
  stimulus: z.strictObject({
    id: draftAliasSchema,
    summary: z.string(),
    introductions: z.array(introductionSchema),
    apparentClaims: z.array(z.strictObject({
      id: draftAliasSchema,
      subjectId: semanticIdSchema,
      predicate: z.string().min(1),
      value: beliefValueSchema,
      description: z.string(),
    })),
  }),
  basis: z.array(z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("shared_placement"), placementId: safeIdSchema }),
    z.strictObject({ kind: z.literal("fact"), factId: safeIdSchema }),
    z.strictObject({ kind: z.literal("perception_check"), checkId: safeIdSchema }),
  ])).min(1),
});

export type ReactionRequestDraft = z.infer<typeof reactionRequestDraftSchema>;

export const reactionDecisionSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    agentId: semanticIdSchema,
    baseRevision: z.number().int().nonnegative(),
    originalProposalId: safeIdSchema,
    kind: z.literal("keep"),
  }),
  z.strictObject({
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
  baseRevision: z.number().int().nonnegative(),
  outcomes: z.array(actionOutcomeSchema),
  mechanicInvocations: z.array(mechanicInvocationSchema),
  operations: z.array(worldDeltaOperationSchema),
  events: z.array(worldEventSchema),
  observations: z.array(observationSchema),
  intentStatus: z.enum(["active", "completed", "failed", "cancelled"]),
  requiresPlayerDecision: z.boolean(),
}) as z.ZodType<TransitionProposalDraft>;

export const persistedTransitionProposalSchema = z.strictObject({
  baseRevision: z.number().int().nonnegative(),
  outcomes: z.array(persistedActionOutcomeSchema),
  mechanicInvocations: z.array(persistedMechanicInvocationSchema),
  operations: z.array(worldDeltaOperationSchema),
  events: z.array(persistedWorldEventSchema),
  observations: z.array(persistedObservationSchema),
  intentStatus: z.enum(["active", "completed", "failed", "cancelled"]),
  requiresPlayerDecision: z.boolean(),
}) as z.ZodType<TransitionProposal>;

export const perceptionDirectiveSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("request_checks"), requests: z.array(checkRequestSchema).min(1) }),
  z.strictObject({ kind: z.literal("done") }),
]);

export const reactionRoutingOutputSchema = z.strictObject({
  requests: z.array(reactionRequestDraftSchema),
});

export const resolutionDirectiveSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("request_checks"), requests: z.array(checkRequestSchema).min(1) }),
  z.strictObject({
    kind: z.literal("request_random"),
    requests: z.array(discreteRandomRequestProposalSchema).min(1).max(MAX_RANDOM_REQUESTS_PER_ROUND),
  }),
  z.strictObject({ kind: z.literal("done") }),
]);

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
