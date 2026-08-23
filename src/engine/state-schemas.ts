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

const reservedRecordKeys = new Set([
  ...Object.getOwnPropertyNames(Object.prototype),
  "prototype",
]);

export function isSafeId(value: string): boolean {
  return value.length > 0 && !reservedRecordKeys.has(value);
}

export const safeIdSchema = z.string().min(1).refine(
  isSafeId,
  { message: "reserved object key cannot be used as an id" },
);

export const causalRefSchema = z.strictObject({
  kind: z.enum(["action", "check", "event", "fact", "law"]),
  id: safeIdSchema,
});

export const factProvenanceRefSchema = z.union([
  causalRefSchema,
  z.strictObject({
    kind: z.literal("world_seed"),
    id: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  }),
]);

export const factValueSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("text"), value: z.string() }),
  z.strictObject({ kind: z.literal("number"), value: z.number().finite() }),
  z.strictObject({ kind: z.literal("boolean"), value: z.boolean() }),
  z.strictObject({ kind: z.literal("entity"), entityId: safeIdSchema }),
  z.strictObject({ kind: z.literal("none") }),
]) as z.ZodType<FactValue>;

export const beliefValueSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("text"), value: z.string() }),
  z.strictObject({ kind: z.literal("number"), value: z.number().finite() }),
  z.strictObject({ kind: z.literal("boolean"), value: z.boolean() }),
  z.strictObject({ kind: z.literal("local_entity"), localEntityId: safeIdSchema }),
  z.strictObject({ kind: z.literal("none") }),
]) as z.ZodType<BeliefValue>;

export const accessSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("public") }),
  z.strictObject({ kind: z.literal("private") }),
  z.strictObject({ kind: z.literal("agents"), agentIds: z.array(safeIdSchema) }),
]);

export const localEntitySchema = z.strictObject({
  id: safeIdSchema,
  name: z.string().min(1),
  description: z.string(),
  status: z.enum(["observed", "reported", "hypothesized"]),
}) as z.ZodType<LocalEntity>;

export const evidenceSchema = z.strictObject({
  id: safeIdSchema,
  kind: z.enum(["observation", "testimony", "inference", "assumption"]),
  description: z.string().min(1),
  sourceId: safeIdSchema.nullable(),
  step: z.number().int().nonnegative(),
}) as z.ZodType<BeliefEvidence>;

export const beliefClaimSchema = z.strictObject({
  id: safeIdSchema,
  subjectId: safeIdSchema,
  predicate: z.string().min(1),
  value: beliefValueSchema,
  description: z.string(),
  stance: z.enum(["believed", "suspected", "disbelieved"]),
  confidence: z.number().min(0).max(1),
  evidenceIds: z.array(safeIdSchema),
}) as z.ZodType<BeliefClaim>;

export const actionProposalSchema = z.strictObject({
  id: safeIdSchema,
  actorId: safeIdSchema,
  baseRevision: z.number().int().nonnegative(),
  rawText: z.string().min(1),
  goal: z.string().min(1),
  means: z.string().min(1).nullable(),
  targetIds: z.array(safeIdSchema),
}) as z.ZodType<AgentActionProposal>;

export const entitySchema = z.strictObject({
  id: safeIdSchema,
  kind: z.string().min(1),
  name: z.string().min(1),
  description: z.string(),
  lifecycle: z.enum(["active", "retired"]),
  createdAtStep: z.number().int().nonnegative(),
}) as z.ZodType<WorldEntity>;

export const factSchema = z.strictObject({
  id: safeIdSchema,
  subjectId: safeIdSchema,
  predicate: z.string().min(1),
  value: factValueSchema,
  description: z.string(),
  access: accessSchema,
  provenance: z.array(factProvenanceRefSchema),
}) as z.ZodType<WorldFact>;

export const meterSchema = z.strictObject({
  id: safeIdSchema,
  definitionId: safeIdSchema,
  entityId: safeIdSchema,
  current: z.number().finite(),
  firedThresholdIds: z.array(safeIdSchema),
}) as z.ZodType<MeterState>;

export const ratingSchema = z.strictObject({
  id: safeIdSchema,
  definitionId: safeIdSchema,
  entityId: safeIdSchema,
  value: z.number().finite(),
}) as z.ZodType<RatingState>;

export const beliefStateSchema = z.strictObject({
  localEntities: z.record(safeIdSchema, localEntitySchema),
  claims: z.record(safeIdSchema, beliefClaimSchema),
  evidence: z.record(safeIdSchema, evidenceSchema),
});

const characterRecordBase = {
  id: safeIdSchema,
  description: z.string().min(1),
  createdAtStep: z.number().int().nonnegative(),
  updatedAtStep: z.number().int().nonnegative(),
  evidenceIds: z.array(safeIdSchema),
};

export const characterFacetSchema = z.strictObject({
  ...characterRecordBase,
  strength: z.number().min(0).max(1),
  status: z.enum(["active", "retired"]),
}) as z.ZodType<CharacterFacet>;

export const emotionStateSchema = z.strictObject({
  ...characterRecordBase,
  intensity: z.number().min(0).max(1),
  status: z.enum(["active", "resolved"]),
}) as z.ZodType<EmotionState>;

export const attitudeStateSchema = z.strictObject({
  ...characterRecordBase,
  subjectId: safeIdSchema,
  intensity: z.number().min(0).max(1),
  status: z.enum(["active", "retired"]),
}) as z.ZodType<AttitudeState>;

export const agentGoalSchema = z.strictObject({
  ...characterRecordBase,
  priority: z.number().min(0).max(1),
  progress: z.number().min(0).max(1),
  targetIds: z.array(safeIdSchema),
  parentGoalId: safeIdSchema.optional(),
  motivatedByIds: z.array(safeIdSchema),
  status: z.enum(["active", "suspended", "completed", "failed", "abandoned"]),
}) as z.ZodType<AgentGoal>;

export const agentCommitmentSchema = z.strictObject({
  ...characterRecordBase,
  priority: z.number().min(0).max(1),
  subjectIds: z.array(safeIdSchema),
  status: z.enum(["active", "fulfilled", "broken", "released"]),
}) as z.ZodType<AgentCommitment>;

export const agentCharacterStateSchema = z.strictObject({
  persona: z.strictObject({
    summary: z.string().min(1),
    voice: z.string(),
    updatedAtStep: z.number().int().nonnegative(),
    evidenceIds: z.array(safeIdSchema),
  }),
  traits: z.record(safeIdSchema, characterFacetSchema),
  values: z.record(safeIdSchema, characterFacetSchema),
  emotions: z.record(safeIdSchema, emotionStateSchema),
  attitudes: z.record(safeIdSchema, attitudeStateSchema),
  goals: z.record(safeIdSchema, agentGoalSchema),
  commitments: z.record(safeIdSchema, agentCommitmentSchema),
}) as z.ZodType<AgentCharacterState>;

export const agentStateSchema = z.strictObject({
  id: safeIdSchema,
  entityId: safeIdSchema,
  modelProfileId: safeIdSchema,
  character: agentCharacterStateSchema,
  belief: beliefStateSchema,
  bindings: z.record(
    safeIdSchema,
    z.strictObject({
      localEntityId: safeIdSchema,
      canonicalEntityIds: z.array(safeIdSchema),
    }),
  ),
  nextAction: actionProposalSchema.nullable(),
}) as z.ZodType<AgentState>;
