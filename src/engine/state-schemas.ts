import { z } from "zod";
import type {
  AgentActionProposal,
  AgentState,
  BeliefClaim,
  BeliefEvidence,
  BeliefValue,
  FactValue,
  LocalEntity,
  MeterState,
  RatingState,
  WorldEntity,
  WorldFact,
} from "./model";

export const causalRefSchema = z.strictObject({
  kind: z.enum(["action", "check", "event", "fact", "law"]),
  id: z.string().min(1),
});

export const factValueSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("text"), value: z.string() }),
  z.strictObject({ kind: z.literal("number"), value: z.number().finite() }),
  z.strictObject({ kind: z.literal("boolean"), value: z.boolean() }),
  z.strictObject({ kind: z.literal("entity"), entityId: z.string().min(1) }),
  z.strictObject({ kind: z.literal("none") }),
]) as z.ZodType<FactValue>;

export const beliefValueSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("text"), value: z.string() }),
  z.strictObject({ kind: z.literal("number"), value: z.number().finite() }),
  z.strictObject({ kind: z.literal("boolean"), value: z.boolean() }),
  z.strictObject({ kind: z.literal("local_entity"), localEntityId: z.string().min(1) }),
  z.strictObject({ kind: z.literal("none") }),
]) as z.ZodType<BeliefValue>;

export const accessSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("public") }),
  z.strictObject({ kind: z.literal("private") }),
  z.strictObject({ kind: z.literal("agents"), agentIds: z.array(z.string().min(1)) }),
]);

export const localEntitySchema = z.strictObject({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string(),
  status: z.enum(["observed", "reported", "hypothesized"]),
}) as z.ZodType<LocalEntity>;

export const evidenceSchema = z.strictObject({
  id: z.string().min(1),
  kind: z.enum(["observation", "testimony", "inference", "assumption"]),
  description: z.string().min(1),
  sourceId: z.string().min(1).nullable(),
  step: z.number().int().nonnegative(),
}) as z.ZodType<BeliefEvidence>;

export const beliefClaimSchema = z.strictObject({
  id: z.string().min(1),
  subjectId: z.string().min(1),
  predicate: z.string().min(1),
  value: beliefValueSchema,
  description: z.string(),
  stance: z.enum(["believed", "suspected", "disbelieved"]),
  confidence: z.number().min(0).max(1),
  evidenceIds: z.array(z.string().min(1)),
}) as z.ZodType<BeliefClaim>;

export const actionProposalSchema = z.strictObject({
  id: z.string().min(1),
  actorId: z.string().min(1),
  baseRevision: z.number().int().nonnegative(),
  rawText: z.string().min(1),
  goal: z.string().min(1),
  means: z.string().min(1).nullable(),
  targetIds: z.array(z.string().min(1)),
}) as z.ZodType<AgentActionProposal>;

export const entitySchema = z.strictObject({
  id: z.string().min(1),
  kind: z.string().min(1),
  name: z.string().min(1),
  description: z.string(),
  lifecycle: z.enum(["active", "retired"]),
  createdAtStep: z.number().int().nonnegative(),
}) as z.ZodType<WorldEntity>;

export const factSchema = z.strictObject({
  id: z.string().min(1),
  subjectId: z.string().min(1),
  predicate: z.string().min(1),
  value: factValueSchema,
  description: z.string(),
  access: accessSchema,
  provenance: z.array(causalRefSchema),
}) as z.ZodType<WorldFact>;

export const meterSchema = z.strictObject({
  id: z.string().min(1),
  definitionId: z.string().min(1),
  entityId: z.string().min(1),
  current: z.number().finite(),
  firedThresholdIds: z.array(z.string().min(1)),
}) as z.ZodType<MeterState>;

export const ratingSchema = z.strictObject({
  id: z.string().min(1),
  definitionId: z.string().min(1),
  entityId: z.string().min(1),
  value: z.number().finite(),
}) as z.ZodType<RatingState>;

export const beliefStateSchema = z.strictObject({
  localEntities: z.record(z.string(), localEntitySchema),
  claims: z.record(z.string(), beliefClaimSchema),
  evidence: z.record(z.string(), evidenceSchema),
});

export const agentStateSchema = z.strictObject({
  id: z.string().min(1),
  entityId: z.string().min(1),
  modelProfileId: z.string().min(1),
  persona: z.string(),
  goals: z.array(z.string()),
  belief: beliefStateSchema,
  bindings: z.record(
    z.string(),
    z.strictObject({
      localEntityId: z.string().min(1),
      canonicalEntityIds: z.array(z.string().min(1)),
    }),
  ),
  nextAction: actionProposalSchema.nullable(),
}) as z.ZodType<AgentState>;
