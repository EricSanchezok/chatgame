import { z } from "zod";
import type {
  AgentActionProposal,
  BeliefPatch,
  CharacterPatch,
  D20CheckRequest,
  ReactionDecision,
  ReactionRequest,
  TransitionProposal,
} from "./model";
import {
  actionProposalSchema,
  agentStateSchema,
  beliefClaimSchema,
  beliefValueSchema,
  causalRefSchema,
  entitySchema,
  evidenceSchema,
  factSchema,
  localEntitySchema,
  meterSchema,
  ratingSchema,
  safeIdSchema,
} from "./state-schemas";

const beliefPatchSchema = z.strictObject({
  agentId: safeIdSchema,
  baseRevision: z.number().int().nonnegative(),
  operations: z.array(z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("upsert_local_entity"), entity: localEntitySchema }),
    z.strictObject({ kind: z.literal("remove_local_entity"), localEntityId: safeIdSchema }),
    z.strictObject({ kind: z.literal("upsert_evidence"), evidence: evidenceSchema }),
    z.strictObject({ kind: z.literal("upsert_claim"), claim: beliefClaimSchema }),
    z.strictObject({ kind: z.literal("remove_claim"), claimId: safeIdSchema }),
    z.strictObject({
      kind: z.literal("merge_local_entities"),
      fromId: safeIdSchema,
      intoId: safeIdSchema,
    }),
    z.strictObject({
      kind: z.literal("split_local_entity"),
      fromId: safeIdSchema,
      entities: z.array(localEntitySchema).min(2),
      assignments: z.array(z.strictObject({
        claimId: safeIdSchema,
        subjectId: safeIdSchema.nullable(),
        valueId: safeIdSchema.nullable(),
      })),
    }),
  ])),
}) as z.ZodType<BeliefPatch>;

const characterPatchSource = {
  sourceObservationIds: z.array(safeIdSchema).min(1),
  evidenceIds: z.array(safeIdSchema).min(1),
};

export const characterPatchSchema = z.strictObject({
  agentId: safeIdSchema,
  baseRevision: z.number().int().nonnegative(),
  operations: z.array(z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("replace_persona"), summary: z.string().min(1), voice: z.string(), ...characterPatchSource }),
    z.strictObject({
      kind: z.enum(["create_trait", "create_value"]),
      facet: z.strictObject({ id: safeIdSchema, description: z.string().min(1), strength: z.number().min(0).max(1) }),
      ...characterPatchSource,
    }),
    z.strictObject({
      kind: z.enum(["update_trait", "update_value"]),
      id: safeIdSchema,
      description: z.string().min(1).nullable(),
      strength: z.number().min(0).max(1).nullable(),
      ...characterPatchSource,
    }),
    z.strictObject({ kind: z.enum(["retire_trait", "retire_value"]), id: safeIdSchema, ...characterPatchSource }),
    z.strictObject({
      kind: z.literal("set_emotion"),
      emotion: z.strictObject({ id: safeIdSchema, description: z.string().min(1), intensity: z.number().min(0).max(1) }),
      ...characterPatchSource,
    }),
    z.strictObject({ kind: z.literal("resolve_emotion"), id: safeIdSchema, ...characterPatchSource }),
    z.strictObject({
      kind: z.literal("set_attitude"),
      attitude: z.strictObject({
        id: safeIdSchema,
        subjectId: safeIdSchema,
        description: z.string().min(1),
        intensity: z.number().min(0).max(1),
      }),
      ...characterPatchSource,
    }),
    z.strictObject({ kind: z.literal("retire_attitude"), id: safeIdSchema, ...characterPatchSource }),
    z.strictObject({
      kind: z.literal("create_goal"),
      goal: z.strictObject({
        id: safeIdSchema,
        description: z.string().min(1),
        priority: z.number().min(0).max(1),
        progress: z.number().min(0).max(1),
        targetIds: z.array(safeIdSchema),
        parentGoalId: safeIdSchema.nullable(),
        motivatedByIds: z.array(safeIdSchema),
      }),
      ...characterPatchSource,
    }),
    z.strictObject({
      kind: z.literal("update_goal"),
      id: safeIdSchema,
      description: z.string().min(1).nullable(),
      priority: z.number().min(0).max(1).nullable(),
      progress: z.number().min(0).max(1).nullable(),
      targetIds: z.array(safeIdSchema).nullable(),
      parentGoal: z.discriminatedUnion("kind", [
        z.strictObject({ kind: z.literal("unchanged") }),
        z.strictObject({ kind: z.literal("none") }),
        z.strictObject({ kind: z.literal("goal"), goalId: safeIdSchema }),
      ]),
      motivatedByIds: z.array(safeIdSchema).nullable(),
      ...characterPatchSource,
    }),
    z.strictObject({
      kind: z.literal("set_goal_status"),
      id: safeIdSchema,
      status: z.enum(["active", "suspended", "completed", "failed", "abandoned"]),
      ...characterPatchSource,
    }),
    z.strictObject({
      kind: z.literal("create_commitment"),
      commitment: z.strictObject({
        id: safeIdSchema,
        description: z.string().min(1),
        priority: z.number().min(0).max(1),
        subjectIds: z.array(safeIdSchema),
      }),
      ...characterPatchSource,
    }),
    z.strictObject({
      kind: z.literal("update_commitment"),
      id: safeIdSchema,
      description: z.string().min(1).nullable(),
      priority: z.number().min(0).max(1).nullable(),
      subjectIds: z.array(safeIdSchema).nullable(),
      ...characterPatchSource,
    }),
    z.strictObject({
      kind: z.literal("set_commitment_status"),
      id: safeIdSchema,
      status: z.enum(["active", "fulfilled", "broken", "released"]),
      ...characterPatchSource,
    }),
  ])),
}) as z.ZodType<CharacterPatch>;

export interface AgentMindOutput {
  beliefPatch: BeliefPatch;
  characterPatch: CharacterPatch;
  nextAction: AgentActionProposal;
}

export const agentMindOutputSchema = z.strictObject({
  beliefPatch: beliefPatchSchema,
  characterPatch: characterPatchSchema,
  nextAction: actionProposalSchema,
}) as z.ZodType<AgentMindOutput>;

export const checkRequestSchema = z.strictObject({
  id: safeIdSchema,
  actorId: safeIdSchema,
  targetId: safeIdSchema.nullable(),
  ratingId: safeIdSchema.nullable(),
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
}) as z.ZodType<D20CheckRequest>;

const worldDeltaOperationSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("create_entity"),
    entity: entitySchema,
    placementId: safeIdSchema.nullable(),
    causes: z.array(causalRefSchema).min(1),
  }),
  z.strictObject({ kind: z.literal("retire_entity"), entityId: safeIdSchema, causes: z.array(causalRefSchema).min(1) }),
  z.strictObject({
    kind: z.literal("place_entity"),
    entityId: safeIdSchema,
    placementId: safeIdSchema.nullable(),
    causes: z.array(causalRefSchema).min(1),
  }),
  z.strictObject({ kind: z.literal("set_fact"), fact: factSchema, causes: z.array(causalRefSchema).min(1) }),
  z.strictObject({ kind: z.literal("remove_fact"), factId: safeIdSchema, causes: z.array(causalRefSchema).min(1) }),
  z.strictObject({ kind: z.literal("set_meter"), meter: meterSchema, causes: z.array(causalRefSchema).min(1) }),
  z.strictObject({ kind: z.literal("adjust_meter"), meterId: safeIdSchema, amount: z.number().finite(), causes: z.array(causalRefSchema).min(1) }),
  z.strictObject({
    kind: z.literal("transfer_quantity"),
    definitionId: safeIdSchema,
    fromHolderId: safeIdSchema,
    toHolderId: safeIdSchema,
    amount: z.number().positive(),
    causes: z.array(causalRefSchema).min(1),
  }),
  z.strictObject({
    kind: z.literal("produce_quantity"),
    definitionId: safeIdSchema,
    holderId: safeIdSchema,
    amount: z.number().positive(),
    lawId: safeIdSchema,
    causes: z.array(causalRefSchema).min(1),
  }),
  z.strictObject({
    kind: z.literal("consume_quantity"),
    definitionId: safeIdSchema,
    holderId: safeIdSchema,
    amount: z.number().positive(),
    lawId: safeIdSchema,
    causes: z.array(causalRefSchema).min(1),
  }),
  z.strictObject({ kind: z.literal("set_rating"), rating: ratingSchema, causes: z.array(causalRefSchema).min(1) }),
  z.strictObject({ kind: z.literal("advance_time"), seconds: z.number().int().positive(), causes: z.array(causalRefSchema).min(1) }),
  z.strictObject({ kind: z.literal("create_agent"), agent: agentStateSchema, causes: z.array(causalRefSchema).min(1) }),
  z.strictObject({ kind: z.literal("remove_agent"), agentId: safeIdSchema, causes: z.array(causalRefSchema).min(1) }),
]);

const actionOutcomeSchema = z.strictObject({
  proposalId: safeIdSchema,
  status: z.enum(["succeeded", "partial", "failed", "blocked", "continuing"]),
  summary: z.string(),
  causeRefs: z.array(causalRefSchema),
  knownAlternatives: z.array(z.strictObject({
    description: z.string().min(1),
    basis: z.discriminatedUnion("kind", [
      z.strictObject({ kind: z.literal("knowledge"), evidenceIds: z.array(safeIdSchema).min(1) }),
      z.strictObject({ kind: z.literal("observation"), observationId: safeIdSchema }),
    ]),
  })),
});

const worldEventSchema = z.strictObject({
  id: safeIdSchema,
  step: z.number().int().nonnegative(),
  description: z.string(),
  impact: z.enum(["ordinary", "significant", "transformative"]),
  causes: z.array(causalRefSchema).min(1),
});

const introductionSchema = z.strictObject({
  localEntity: localEntitySchema,
  canonicalEntityId: safeIdSchema.nullable(),
});

const observationSchema = z.strictObject({
  id: safeIdSchema,
  observerId: safeIdSchema,
  step: z.number().int().nonnegative(),
  kind: z.enum(["stimulus", "outcome"]),
  summary: z.string(),
  introductions: z.array(introductionSchema),
  apparentClaims: z.array(z.strictObject({
    id: safeIdSchema,
    subjectId: safeIdSchema,
    predicate: z.string().min(1),
    value: beliefValueSchema,
    description: z.string(),
  })),
  sourceEventIds: z.array(safeIdSchema),
});

export const reactionRequestSchema = z.strictObject({
  agentId: safeIdSchema,
  sourceActionId: safeIdSchema,
  stimulus: observationSchema,
  basis: z.array(z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("shared_placement"), placementId: safeIdSchema }),
    z.strictObject({ kind: z.literal("fact"), factId: safeIdSchema }),
    z.strictObject({ kind: z.literal("perception_check"), checkId: safeIdSchema }),
  ])).min(1),
}) as z.ZodType<ReactionRequest>;

export const reactionDecisionSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    agentId: safeIdSchema,
    baseRevision: z.number().int().nonnegative(),
    originalProposalId: safeIdSchema,
    kind: z.literal("keep"),
  }),
  z.strictObject({
    agentId: safeIdSchema,
    baseRevision: z.number().int().nonnegative(),
    originalProposalId: safeIdSchema,
    kind: z.literal("replace"),
    replacementAction: actionProposalSchema,
  }),
]) as z.ZodType<ReactionDecision>;

export const transitionProposalSchema = z.strictObject({
  baseRevision: z.number().int().nonnegative(),
  outcomes: z.array(actionOutcomeSchema),
  operations: z.array(worldDeltaOperationSchema),
  events: z.array(worldEventSchema),
  observations: z.array(observationSchema),
  intentStatus: z.enum(["active", "completed", "failed", "cancelled"]),
  requiresPlayerDecision: z.boolean(),
}) as z.ZodType<TransitionProposal>;

export type TruthDirective =
  | { kind: "request_checks"; requests: D20CheckRequest[] }
  | { kind: "request_reactions"; requests: ReactionRequest[] }
  | { kind: "transition"; proposal: TransitionProposal };

export const truthDirectiveSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("request_checks"), requests: z.array(checkRequestSchema).min(1) }),
  z.strictObject({ kind: z.literal("request_reactions"), requests: z.array(reactionRequestSchema).min(1) }),
  z.strictObject({ kind: z.literal("transition"), proposal: transitionProposalSchema }),
]) as z.ZodType<TruthDirective>;
