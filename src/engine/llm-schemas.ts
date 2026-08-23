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
} from "./state-schemas";

const beliefPatchSchema = z.object({
  agentId: z.string().min(1),
  baseRevision: z.number().int().nonnegative(),
  operations: z.array(
    z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("upsert_local_entity"), entity: localEntitySchema }),
      z.object({ kind: z.literal("remove_local_entity"), localEntityId: z.string().min(1) }),
      z.object({ kind: z.literal("upsert_evidence"), evidence: evidenceSchema }),
      z.object({ kind: z.literal("upsert_claim"), claim: beliefClaimSchema }),
      z.object({ kind: z.literal("remove_claim"), claimId: z.string().min(1) }),
      z.object({
        kind: z.literal("merge_local_entities"),
        fromId: z.string().min(1),
        intoId: z.string().min(1),
      }),
      z.object({
        kind: z.literal("split_local_entity"),
        fromId: z.string().min(1),
        entities: z.array(localEntitySchema).min(2),
        assignments: z.array(z.object({
          claimId: z.string().min(1),
          subjectId: z.string().min(1).optional(),
          valueId: z.string().min(1).optional(),
        })),
      }),
    ]),
  ),
}) as z.ZodType<BeliefPatch>;

const characterPatchSource = {
  sourceObservationIds: z.array(z.string().min(1)).min(1),
  evidenceIds: z.array(z.string().min(1)),
};

export const characterPatchSchema = z.object({
  agentId: z.string().min(1),
  baseRevision: z.number().int().nonnegative(),
  operations: z.array(z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("replace_persona"), summary: z.string().min(1), voice: z.string(), ...characterPatchSource }),
    z.object({
      kind: z.enum(["create_trait", "create_value"]),
      facet: z.object({ id: z.string().min(1), description: z.string().min(1), strength: z.number().min(0).max(1) }),
      ...characterPatchSource,
    }),
    z.object({
      kind: z.enum(["update_trait", "update_value"]),
      id: z.string().min(1),
      description: z.string().min(1).optional(),
      strength: z.number().min(0).max(1).optional(),
      ...characterPatchSource,
    }),
    z.object({ kind: z.enum(["retire_trait", "retire_value"]), id: z.string().min(1), ...characterPatchSource }),
    z.object({
      kind: z.literal("set_emotion"),
      emotion: z.object({ id: z.string().min(1), description: z.string().min(1), intensity: z.number().min(0).max(1) }),
      ...characterPatchSource,
    }),
    z.object({ kind: z.literal("resolve_emotion"), id: z.string().min(1), ...characterPatchSource }),
    z.object({
      kind: z.literal("set_attitude"),
      attitude: z.object({
        id: z.string().min(1),
        subjectId: z.string().min(1),
        description: z.string().min(1),
        intensity: z.number().min(0).max(1),
      }),
      ...characterPatchSource,
    }),
    z.object({ kind: z.literal("retire_attitude"), id: z.string().min(1), ...characterPatchSource }),
    z.object({
      kind: z.literal("create_goal"),
      goal: z.object({
        id: z.string().min(1),
        description: z.string().min(1),
        priority: z.number().min(0).max(1),
        progress: z.number().min(0).max(1),
        targetIds: z.array(z.string().min(1)),
        parentGoalId: z.string().min(1).optional(),
        motivatedByIds: z.array(z.string().min(1)),
      }),
      ...characterPatchSource,
    }),
    z.object({
      kind: z.literal("update_goal"),
      id: z.string().min(1),
      description: z.string().min(1).optional(),
      priority: z.number().min(0).max(1).optional(),
      progress: z.number().min(0).max(1).optional(),
      targetIds: z.array(z.string().min(1)).optional(),
      parentGoalId: z.string().min(1).nullable().optional(),
      motivatedByIds: z.array(z.string().min(1)).optional(),
      ...characterPatchSource,
    }),
    z.object({
      kind: z.literal("set_goal_status"),
      id: z.string().min(1),
      status: z.enum(["active", "suspended", "completed", "failed", "abandoned"]),
      ...characterPatchSource,
    }),
    z.object({
      kind: z.literal("create_commitment"),
      commitment: z.object({
        id: z.string().min(1),
        description: z.string().min(1),
        priority: z.number().min(0).max(1),
        subjectIds: z.array(z.string().min(1)),
      }),
      ...characterPatchSource,
    }),
    z.object({
      kind: z.literal("update_commitment"),
      id: z.string().min(1),
      description: z.string().min(1).optional(),
      priority: z.number().min(0).max(1).optional(),
      subjectIds: z.array(z.string().min(1)).optional(),
      ...characterPatchSource,
    }),
    z.object({
      kind: z.literal("set_commitment_status"),
      id: z.string().min(1),
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

export const agentMindOutputSchema = z.object({
  beliefPatch: beliefPatchSchema,
  characterPatch: characterPatchSchema,
  nextAction: actionProposalSchema,
}) as z.ZodType<AgentMindOutput>;

export const checkRequestSchema = z.object({
  id: z.string().min(1),
  actorId: z.string().min(1),
  targetId: z.string().min(1).optional(),
  ratingId: z.string().min(1).optional(),
  modifier: z.number().int(),
  modifierSources: z.array(z.object({
    id: z.string().min(1),
    amount: z.number().int().min(-100).max(100),
  })),
  dc: z.number().int().min(0).max(100),
  mode: z.enum(["normal", "advantage", "disadvantage"]),
  stakes: z.string().min(1),
  visibility: z.enum(["full", "result_only", "hidden"]),
  phase: z.enum(["perception", "resolution"]),
  causes: z.array(causalRefSchema).min(1),
}) as z.ZodType<D20CheckRequest>;

const worldDeltaOperationSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("create_entity"),
    entity: entitySchema,
    placementId: z.string().min(1).nullable(),
    causes: z.array(causalRefSchema).min(1),
  }),
  z.object({ kind: z.literal("retire_entity"), entityId: z.string().min(1), causes: z.array(causalRefSchema).min(1) }),
  z.object({
    kind: z.literal("place_entity"),
    entityId: z.string().min(1),
    placementId: z.string().min(1).nullable(),
    causes: z.array(causalRefSchema).min(1),
  }),
  z.object({ kind: z.literal("set_fact"), fact: factSchema, causes: z.array(causalRefSchema).min(1) }),
  z.object({ kind: z.literal("remove_fact"), factId: z.string().min(1), causes: z.array(causalRefSchema).min(1) }),
  z.object({ kind: z.literal("set_meter"), meter: meterSchema, causes: z.array(causalRefSchema).min(1) }),
  z.object({
    kind: z.literal("adjust_meter"),
    meterId: z.string().min(1),
    amount: z.number().finite(),
    causes: z.array(causalRefSchema).min(1),
  }),
  z.object({
    kind: z.literal("transfer_quantity"),
    definitionId: z.string().min(1),
    fromHolderId: z.string().min(1),
    toHolderId: z.string().min(1),
    amount: z.number().positive(),
    causes: z.array(causalRefSchema).min(1),
  }),
  z.object({
    kind: z.literal("produce_quantity"),
    definitionId: z.string().min(1),
    holderId: z.string().min(1),
    amount: z.number().positive(),
    lawId: z.string().min(1),
    causes: z.array(causalRefSchema).min(1),
  }),
  z.object({
    kind: z.literal("consume_quantity"),
    definitionId: z.string().min(1),
    holderId: z.string().min(1),
    amount: z.number().positive(),
    lawId: z.string().min(1),
    causes: z.array(causalRefSchema).min(1),
  }),
  z.object({ kind: z.literal("set_rating"), rating: ratingSchema, causes: z.array(causalRefSchema).min(1) }),
  z.object({ kind: z.literal("advance_time"), seconds: z.number().int().positive(), causes: z.array(causalRefSchema).min(1) }),
  z.object({ kind: z.literal("create_agent"), agent: agentStateSchema, causes: z.array(causalRefSchema).min(1) }),
  z.object({ kind: z.literal("remove_agent"), agentId: z.string().min(1), causes: z.array(causalRefSchema).min(1) }),
]);

const actionOutcomeSchema = z.object({
  proposalId: z.string().min(1),
  status: z.enum(["succeeded", "partial", "failed", "blocked", "continuing"]),
  summary: z.string(),
  causeRefs: z.array(causalRefSchema),
  knownAlternatives: z.array(z.object({
    description: z.string().min(1),
    basis: z.discriminatedUnion("kind", [
      z.object({
        kind: z.literal("knowledge"),
        evidenceIds: z.array(z.string().min(1)).min(1),
      }),
      z.object({
        kind: z.literal("observation"),
        observationId: z.string().min(1),
      }),
    ]),
  })),
});

const worldEventSchema = z.object({
  id: z.string().min(1),
  step: z.number().int().nonnegative(),
  description: z.string(),
  impact: z.enum(["ordinary", "significant", "transformative"]),
  causes: z.array(causalRefSchema).min(1),
});

const introductionSchema = z.object({
  localEntity: localEntitySchema,
  canonicalEntityId: z.string().min(1).optional(),
});

const observationSchema = z.object({
  id: z.string().min(1),
  observerId: z.string().min(1),
  step: z.number().int().nonnegative(),
  kind: z.enum(["stimulus", "outcome"]),
  summary: z.string(),
  introductions: z.array(introductionSchema),
  apparentClaims: z.array(
    z.object({
      id: z.string().min(1),
      subjectId: z.string().min(1),
      predicate: z.string().min(1),
      value: beliefValueSchema,
      description: z.string(),
    }),
  ),
  sourceEventIds: z.array(z.string().min(1)),
});

export const reactionRequestSchema = z.object({
  agentId: z.string().min(1),
  sourceActionId: z.string().min(1),
  stimulus: observationSchema,
  basis: z.array(z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("shared_placement"), placementId: z.string().min(1) }),
    z.object({ kind: z.literal("fact"), factId: z.string().min(1) }),
    z.object({ kind: z.literal("perception_check"), checkId: z.string().min(1) }),
  ])).min(1),
}) as z.ZodType<ReactionRequest>;

export const reactionDecisionSchema = z.discriminatedUnion("kind", [
  z.object({
    agentId: z.string().min(1),
    baseRevision: z.number().int().nonnegative(),
    originalProposalId: z.string().min(1),
    kind: z.literal("keep"),
  }),
  z.object({
    agentId: z.string().min(1),
    baseRevision: z.number().int().nonnegative(),
    originalProposalId: z.string().min(1),
    kind: z.literal("replace"),
    replacementAction: actionProposalSchema,
  }),
]) as z.ZodType<ReactionDecision>;

export const transitionProposalSchema = z.object({
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
  z.object({ kind: z.literal("request_checks"), requests: z.array(checkRequestSchema).min(1) }),
  z.object({ kind: z.literal("request_reactions"), requests: z.array(reactionRequestSchema).min(1) }),
  z.object({ kind: z.literal("transition"), proposal: transitionProposalSchema }),
]) as z.ZodType<TruthDirective>;
