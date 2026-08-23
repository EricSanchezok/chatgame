import { z } from "zod";
import type {
  AgentActionProposal,
  AgentCharacterState,
  AgentCommitment,
  AgentGoal,
  AgentState,
  AttitudeState,
  BeliefClaim,
  BeliefEvidence,
  BeliefValue,
  CharacterFacet,
  EmotionState,
  FactValue,
  LocalEntity,
  MeterState,
  RatingState,
  WorldEntity,
  WorldFact,
} from "./model";

export const causalRefSchema = z.object({
  kind: z.enum(["action", "check", "event", "fact", "law"]),
  id: z.string().min(1),
});

export const factValueSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("text"), value: z.string() }),
  z.object({ kind: z.literal("number"), value: z.number().finite() }),
  z.object({ kind: z.literal("boolean"), value: z.boolean() }),
  z.object({ kind: z.literal("entity"), entityId: z.string().min(1) }),
  z.object({ kind: z.literal("none") }),
]) as z.ZodType<FactValue>;

export const beliefValueSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("text"), value: z.string() }),
  z.object({ kind: z.literal("number"), value: z.number().finite() }),
  z.object({ kind: z.literal("boolean"), value: z.boolean() }),
  z.object({ kind: z.literal("local_entity"), localEntityId: z.string().min(1) }),
  z.object({ kind: z.literal("none") }),
]) as z.ZodType<BeliefValue>;

export const accessSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("public") }),
  z.object({ kind: z.literal("private") }),
  z.object({ kind: z.literal("agents"), agentIds: z.array(z.string().min(1)) }),
]);

export const localEntitySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string(),
  status: z.enum(["observed", "reported", "hypothesized"]),
}) as z.ZodType<LocalEntity>;

export const evidenceSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(["observation", "testimony", "inference", "assumption"]),
  description: z.string().min(1),
  sourceId: z.string().min(1).optional(),
  step: z.number().int().nonnegative(),
}) as z.ZodType<BeliefEvidence>;

export const beliefClaimSchema = z.object({
  id: z.string().min(1),
  subjectId: z.string().min(1),
  predicate: z.string().min(1),
  value: beliefValueSchema,
  description: z.string(),
  stance: z.enum(["believed", "suspected", "disbelieved"]),
  confidence: z.number().min(0).max(1),
  evidenceIds: z.array(z.string().min(1)),
}) as z.ZodType<BeliefClaim>;

export const actionProposalSchema = z.object({
  id: z.string().min(1),
  actorId: z.string().min(1),
  baseRevision: z.number().int().nonnegative(),
  rawText: z.string().min(1),
  goal: z.string().min(1),
  means: z.string().min(1).optional(),
  targetIds: z.array(z.string().min(1)),
}) as z.ZodType<AgentActionProposal>;

export const entitySchema = z.object({
  id: z.string().min(1),
  kind: z.string().min(1),
  name: z.string().min(1),
  description: z.string(),
  lifecycle: z.enum(["active", "retired"]),
  createdAtStep: z.number().int().nonnegative(),
}) as z.ZodType<WorldEntity>;

export const factSchema = z.object({
  id: z.string().min(1),
  subjectId: z.string().min(1),
  predicate: z.string().min(1),
  value: factValueSchema,
  description: z.string(),
  access: accessSchema,
  provenance: z.array(causalRefSchema),
}) as z.ZodType<WorldFact>;

export const meterSchema = z.object({
  id: z.string().min(1),
  definitionId: z.string().min(1),
  entityId: z.string().min(1),
  current: z.number().finite(),
  firedThresholdIds: z.array(z.string().min(1)),
}) as z.ZodType<MeterState>;

export const ratingSchema = z.object({
  id: z.string().min(1),
  definitionId: z.string().min(1),
  entityId: z.string().min(1),
  value: z.number().finite(),
}) as z.ZodType<RatingState>;

export const beliefStateSchema = z.object({
  localEntities: z.record(z.string(), localEntitySchema),
  claims: z.record(z.string(), beliefClaimSchema),
  evidence: z.record(z.string(), evidenceSchema),
});

const characterRecordBase = {
  id: z.string().min(1),
  description: z.string().min(1),
  createdAtStep: z.number().int().nonnegative(),
  updatedAtStep: z.number().int().nonnegative(),
  evidenceIds: z.array(z.string().min(1)),
};

export const characterFacetSchema = z.object({
  ...characterRecordBase,
  strength: z.number().min(0).max(1),
  status: z.enum(["active", "retired"]),
}) as z.ZodType<CharacterFacet>;

export const emotionStateSchema = z.object({
  ...characterRecordBase,
  intensity: z.number().min(0).max(1),
  status: z.enum(["active", "resolved"]),
}) as z.ZodType<EmotionState>;

export const attitudeStateSchema = z.object({
  ...characterRecordBase,
  subjectId: z.string().min(1),
  intensity: z.number().min(0).max(1),
  status: z.enum(["active", "retired"]),
}) as z.ZodType<AttitudeState>;

export const agentGoalSchema = z.object({
  ...characterRecordBase,
  priority: z.number().min(0).max(1),
  progress: z.number().min(0).max(1),
  targetIds: z.array(z.string().min(1)),
  parentGoalId: z.string().min(1).optional(),
  motivatedByIds: z.array(z.string().min(1)),
  status: z.enum(["active", "suspended", "completed", "failed", "abandoned"]),
}) as z.ZodType<AgentGoal>;

export const agentCommitmentSchema = z.object({
  ...characterRecordBase,
  priority: z.number().min(0).max(1),
  subjectIds: z.array(z.string().min(1)),
  status: z.enum(["active", "fulfilled", "broken", "released"]),
}) as z.ZodType<AgentCommitment>;

export const agentCharacterStateSchema = z.object({
  persona: z.object({
    summary: z.string().min(1),
    voice: z.string(),
    updatedAtStep: z.number().int().nonnegative(),
    evidenceIds: z.array(z.string().min(1)),
  }),
  traits: z.record(z.string(), characterFacetSchema),
  values: z.record(z.string(), characterFacetSchema),
  emotions: z.record(z.string(), emotionStateSchema),
  attitudes: z.record(z.string(), attitudeStateSchema),
  goals: z.record(z.string(), agentGoalSchema),
  commitments: z.record(z.string(), agentCommitmentSchema),
}) as z.ZodType<AgentCharacterState>;

export const agentStateSchema = z.object({
  id: z.string().min(1),
  entityId: z.string().min(1),
  modelProfileId: z.string().min(1),
  character: agentCharacterStateSchema,
  belief: beliefStateSchema,
  bindings: z.record(
    z.string(),
    z.object({
      localEntityId: z.string().min(1),
      canonicalEntityIds: z.array(z.string().min(1)),
    }),
  ),
  nextAction: actionProposalSchema.optional(),
}) as z.ZodType<AgentState>;
