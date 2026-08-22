import { z } from "zod";
import type {
  AgentActionProposal,
  BeliefPatch,
  D20CheckRequest,
  TransitionProposal,
} from "./model";

const causalRefSchema = z.object({
  kind: z.enum(["action", "check", "event", "fact", "law"]),
  id: z.string().min(1),
});

const factValueSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("text"), value: z.string() }),
  z.object({ kind: z.literal("number"), value: z.number().finite() }),
  z.object({ kind: z.literal("boolean"), value: z.boolean() }),
  z.object({ kind: z.literal("entity"), entityId: z.string().min(1) }),
  z.object({ kind: z.literal("none") }),
]);

const beliefValueSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("text"), value: z.string() }),
  z.object({ kind: z.literal("number"), value: z.number().finite() }),
  z.object({ kind: z.literal("boolean"), value: z.boolean() }),
  z.object({ kind: z.literal("local_entity"), localEntityId: z.string().min(1) }),
  z.object({ kind: z.literal("none") }),
]);

const accessSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("public") }),
  z.object({ kind: z.literal("private") }),
  z.object({ kind: z.literal("agents"), agentIds: z.array(z.string().min(1)) }),
]);

const localEntitySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string(),
  status: z.enum(["observed", "reported", "hypothesized"]),
});

const evidenceSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(["observation", "testimony", "inference", "assumption"]),
  description: z.string().min(1),
  sourceId: z.string().min(1).optional(),
  step: z.number().int().nonnegative(),
});

const beliefClaimSchema = z.object({
  id: z.string().min(1),
  subjectId: z.string().min(1),
  predicate: z.string().min(1),
  value: beliefValueSchema,
  description: z.string(),
  stance: z.enum(["believed", "suspected", "disbelieved"]),
  confidence: z.number().min(0).max(1),
  evidenceIds: z.array(z.string().min(1)),
});

const actionProposalSchema = z.object({
  id: z.string().min(1),
  actorId: z.string().min(1),
  baseRevision: z.number().int().nonnegative(),
  rawText: z.string().min(1),
  goal: z.string().min(1),
  means: z.string().min(1).optional(),
  targetIds: z.array(z.string().min(1)),
}) as z.ZodType<AgentActionProposal>;

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

const entitySchema = z.object({
  id: z.string().min(1),
  kind: z.string().min(1),
  name: z.string().min(1),
  description: z.string(),
  lifecycle: z.enum(["active", "retired"]),
  createdAtStep: z.number().int().nonnegative(),
});

const factSchema = z.object({
  id: z.string().min(1),
  subjectId: z.string().min(1),
  predicate: z.string().min(1),
  value: factValueSchema,
  description: z.string(),
  access: accessSchema,
  provenance: z.array(causalRefSchema),
});

const meterSchema = z.object({
  id: z.string().min(1),
  definitionId: z.string().min(1),
  entityId: z.string().min(1),
  current: z.number().finite(),
  firedThresholdIds: z.array(z.string().min(1)),
});

const ratingSchema = z.object({
  id: z.string().min(1),
  definitionId: z.string().min(1),
  entityId: z.string().min(1),
  value: z.number().finite(),
});

const agentStateSchema = z.object({
  id: z.string().min(1),
  entityId: z.string().min(1),
  modelProfileId: z.string().min(1),
  persona: z.string(),
  goals: z.array(z.string()),
  belief: z.object({
    localEntities: z.record(z.string(), localEntitySchema),
    claims: z.record(z.string(), beliefClaimSchema),
    evidence: z.record(z.string(), evidenceSchema),
  }),
  bindings: z.record(
    z.string(),
    z.object({
      localEntityId: z.string().min(1),
      canonicalEntityIds: z.array(z.string().min(1)),
    }),
  ),
  nextAction: actionProposalSchema.optional(),
});

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
