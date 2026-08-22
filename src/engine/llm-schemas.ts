import { z } from "zod";
import type {
  AgentActionProposal,
  BeliefPatch,
  D20CheckRequest,
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
    ]),
  ),
}) as z.ZodType<BeliefPatch>;

export interface AgentMindOutput {
  beliefPatch: BeliefPatch;
  nextAction: AgentActionProposal;
}

export const agentMindOutputSchema = z.object({
  beliefPatch: beliefPatchSchema,
  nextAction: actionProposalSchema,
}) as z.ZodType<AgentMindOutput>;

const checkRequestSchema = z.object({
  id: z.string().min(1),
  actorId: z.string().min(1),
  targetId: z.string().min(1).optional(),
  ratingId: z.string().min(1).optional(),
  modifier: z.number().int(),
  modifierSourceIds: z.array(z.string().min(1)),
  dc: z.number().int().min(0).max(100),
  mode: z.enum(["normal", "advantage", "disadvantage"]),
  stakes: z.string().min(1),
  visibility: z.enum(["full", "result_only", "hidden"]),
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
  actionId: z.string().min(1),
  status: z.enum(["succeeded", "partial", "failed", "blocked", "continuing"]),
  summary: z.string(),
  causeRefs: z.array(causalRefSchema),
  knownAlternatives: z.array(z.string()),
});

const worldEventSchema = z.object({
  id: z.string().min(1),
  step: z.number().int().nonnegative(),
  description: z.string(),
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
  | { kind: "transition"; proposal: TransitionProposal };

export const truthDirectiveSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("request_checks"), requests: z.array(checkRequestSchema).min(1) }),
  z.object({ kind: z.literal("transition"), proposal: transitionProposalSchema }),
]) as z.ZodType<TruthDirective>;
