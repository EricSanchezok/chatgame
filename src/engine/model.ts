import type { ModelInferenceConfig } from "./model-catalog";

export type EntityId = string;
export type AgentId = string;
export type LocalEntityId = string;
export type FactId = string;
export type EventId = string;

export type FactValue =
  | { kind: "text"; value: string }
  | { kind: "number"; value: number }
  | { kind: "boolean"; value: boolean }
  | { kind: "entity"; entityId: EntityId }
  | { kind: "none" };

export type BeliefValue =
  | Exclude<FactValue, { kind: "entity" }>
  | { kind: "local_entity"; localEntityId: LocalEntityId };

export interface CausalRef {
  kind: "action" | "check" | "event" | "fact" | "law";
  id: string;
}

export interface WorldEntity {
  id: EntityId;
  kind: string;
  name: string;
  description: string;
  lifecycle: "active" | "retired";
  createdAtStep: number;
}

export interface WorldFact {
  id: FactId;
  subjectId: EntityId;
  predicate: string;
  value: FactValue;
  description: string;
  access:
    | { kind: "public" }
    | { kind: "private" }
    | { kind: "agents"; agentIds: AgentId[] };
  provenance: CausalRef[];
}

export interface MeterDefinition {
  id: string;
  name: string;
  min: number;
  max: number;
  thresholds: MeterThreshold[];
}

export interface MeterThreshold {
  id: string;
  when: { operator: "lte" | "gte"; value: number };
  effects: ThresholdEffect[];
}

export type ThresholdEffect =
  | { kind: "set_lifecycle"; lifecycle: WorldEntity["lifecycle"] }
  | {
      kind: "set_fact";
      predicate: string;
      value: FactValue;
      description: string;
      access?: WorldFact["access"];
    };

export interface QuantityDefinition {
  id: string;
  name: string;
  unit: string;
  allowProduction: boolean;
  allowConsumption: boolean;
}

export interface RatingDefinition {
  id: string;
  name: string;
  min: number;
  max: number;
}

export interface MechanicsCatalog {
  meters: Record<string, MeterDefinition>;
  quantities: Record<string, QuantityDefinition>;
  ratings: Record<string, RatingDefinition>;
}

export interface MeterState {
  id: string;
  definitionId: string;
  entityId: EntityId;
  current: number;
  firedThresholdIds: string[];
}

export interface QuantityState {
  id: string;
  definitionId: string;
  holderId: EntityId;
  amount: number;
}

export interface RatingState {
  id: string;
  definitionId: string;
  entityId: EntityId;
  value: number;
}

export interface CanonicalWorldState {
  elapsedSeconds: number;
  rng: SeededRngState;
  events: WorldEvent[];
  entities: Record<EntityId, WorldEntity>;
  placements: Record<EntityId, EntityId | null>;
  facts: Record<FactId, WorldFact>;
  mechanics: MechanicsCatalog;
  meters: Record<string, MeterState>;
  quantities: Record<string, QuantityState>;
  ratings: Record<string, RatingState>;
}

export interface LocalEntity {
  id: LocalEntityId;
  name: string;
  description: string;
  status: "observed" | "reported" | "hypothesized";
}

export interface BeliefEvidence {
  id: string;
  kind: "observation" | "testimony" | "inference" | "assumption";
  description: string;
  sourceId: string | null;
  step: number;
}

export interface BeliefClaim {
  id: string;
  subjectId: LocalEntityId;
  predicate: string;
  value: BeliefValue;
  description: string;
  stance: "believed" | "suspected" | "disbelieved";
  confidence: number;
  evidenceIds: string[];
}

export interface AgentBeliefState {
  localEntities: Record<LocalEntityId, LocalEntity>;
  claims: Record<string, BeliefClaim>;
  evidence: Record<string, BeliefEvidence>;
}

export type CharacterImpact = "ordinary" | "significant" | "transformative";

export interface CharacterFacet {
  id: string;
  description: string;
  strength: number;
  status: "active" | "retired";
  createdAtStep: number;
  updatedAtStep: number;
  evidenceIds: string[];
}

export interface EmotionState {
  id: string;
  description: string;
  intensity: number;
  status: "active" | "resolved";
  createdAtStep: number;
  updatedAtStep: number;
  evidenceIds: string[];
}

export interface AttitudeState {
  id: string;
  subjectId: LocalEntityId;
  description: string;
  intensity: number;
  status: "active" | "retired";
  createdAtStep: number;
  updatedAtStep: number;
  evidenceIds: string[];
}

export interface AgentGoal {
  id: string;
  description: string;
  priority: number;
  progress: number;
  targetIds: LocalEntityId[];
  parentGoalId?: string;
  motivatedByIds: string[];
  status: "active" | "suspended" | "completed" | "failed" | "abandoned";
  createdAtStep: number;
  updatedAtStep: number;
  evidenceIds: string[];
}

export interface AgentCommitment {
  id: string;
  description: string;
  priority: number;
  subjectIds: LocalEntityId[];
  status: "active" | "fulfilled" | "broken" | "released";
  createdAtStep: number;
  updatedAtStep: number;
  evidenceIds: string[];
}

export interface AgentCharacterState {
  persona: {
    summary: string;
    voice: string;
    updatedAtStep: number;
    evidenceIds: string[];
  };
  traits: Record<string, CharacterFacet>;
  values: Record<string, CharacterFacet>;
  emotions: Record<string, EmotionState>;
  attitudes: Record<string, AttitudeState>;
  goals: Record<string, AgentGoal>;
  commitments: Record<string, AgentCommitment>;
}

export interface EpistemicBinding {
  localEntityId: LocalEntityId;
  canonicalEntityIds: EntityId[];
}

export interface PlayerKnowledgeState {
  localEntities: Record<LocalEntityId, LocalEntity>;
  claims: Record<string, Omit<BeliefClaim, "stance" | "confidence">>;
  evidence: Record<string, BeliefEvidence>;
  observationIds: string[];
}

export interface AgentActionProposal {
  id: string;
  actorId: AgentId | "player";
  baseRevision: number;
  rawText: string;
  goal: string;
  means: string | null;
  targetIds: LocalEntityId[];
}

export interface AgentState {
  id: AgentId;
  entityId: EntityId;
  modelProfileId: string;
  character: AgentCharacterState;
  belief: AgentBeliefState;
  bindings: Record<LocalEntityId, EpistemicBinding>;
  nextAction: AgentActionProposal | null;
}

export interface AgentSelfStateView {
  selfLocalEntityId: LocalEntityId;
  lifecycle: WorldEntity["lifecycle"];
  elapsedSeconds: number;
  location?: {
    localEntityId?: LocalEntityId;
    name: string;
    description: string;
  };
  meters: Array<{
    name: string;
    current: number;
    min: number;
    max: number;
  }>;
  quantities: Array<{
    name: string;
    unit: string;
    amount: number;
  }>;
  ratings: Array<{
    name: string;
    value: number;
    min: number;
    max: number;
  }>;
  facts: Array<{
    predicate: string;
    value: BeliefValue;
    description: string;
  }>;
}

export interface PlayerIntent {
  id: string;
  rawText: string;
  goal: string;
  status: "active" | "completed" | "failed" | "cancelled";
  startedAtStep: number;
}

export interface SeededRngState {
  seed: number;
  state: number;
  draws: number;
}

export interface WorldEvent {
  id: EventId;
  step: number;
  description: string;
  impact: CharacterImpact;
  causes: CausalRef[];
}

export interface SimulationState {
  schemaVersion: 4;
  worldId: string;
  lawIds: string[];
  revision: number;
  step: number;
  truth: CanonicalWorldState;
  agents: Record<AgentId, AgentState>;
  player: {
    entityId: EntityId;
    knowledge: PlayerKnowledgeState;
    bindings: Record<LocalEntityId, EpistemicBinding>;
    intent?: PlayerIntent;
  };
  history: CommittedStep[];
  bootstrapModelAudits: ModelExecutionAudit[];
}

export type CheckVisibility = "full" | "result_only" | "hidden";

export interface D20CheckRequest {
  id: string;
  actorId: EntityId;
  targetId: EntityId | null;
  ratingId: string | null;
  modifier: number;
  modifierSources: Array<{ id: string; amount: number }>;
  dc: number;
  mode: "normal" | "advantage" | "disadvantage";
  stakes: string;
  visibility: CheckVisibility;
  phase: "perception" | "resolution";
  causes: CausalRef[];
}

export interface D20CheckResult {
  requestId: string;
  dice: number[];
  kept: number;
  modifier: number;
  total: number;
  dc: number;
  succeeded: boolean;
  margin: number;
  visibility: CheckVisibility;
}

export interface KnownAlternative {
  description: string;
  basis:
    | { kind: "knowledge"; evidenceIds: string[] }
    | { kind: "observation"; observationId: string };
}

export interface ActionOutcome {
  proposalId: string;
  status: "succeeded" | "partial" | "failed" | "blocked" | "continuing";
  summary: string;
  causeRefs: CausalRef[];
  knownAlternatives: KnownAlternative[];
}

export interface ApparentClaim {
  id: string;
  subjectId: LocalEntityId;
  predicate: string;
  value: BeliefValue;
  description: string;
}

export interface ObservationIntroduction {
  localEntity: LocalEntity;
  canonicalEntityId: EntityId | null;
}

export interface ObservationPacket {
  id: string;
  observerId: AgentId | "player";
  step: number;
  kind: "stimulus" | "outcome";
  summary: string;
  introductions: ObservationIntroduction[];
  apparentClaims: ApparentClaim[];
  sourceEventIds: EventId[];
}

export type BeliefPatchOperation =
  | { kind: "upsert_local_entity"; entity: LocalEntity }
  | { kind: "remove_local_entity"; localEntityId: LocalEntityId }
  | { kind: "upsert_evidence"; evidence: BeliefEvidence }
  | { kind: "upsert_claim"; claim: BeliefClaim }
  | { kind: "remove_claim"; claimId: string }
  | { kind: "merge_local_entities"; fromId: LocalEntityId; intoId: LocalEntityId }
  | {
      kind: "split_local_entity";
      fromId: LocalEntityId;
      entities: LocalEntity[];
      assignments: Array<{
        claimId: string;
        subjectId: LocalEntityId | null;
        valueId: LocalEntityId | null;
      }>;
    };

export interface BeliefPatch {
  agentId: AgentId;
  baseRevision: number;
  operations: BeliefPatchOperation[];
}

type CharacterPatchSource = { sourceObservationIds: string[]; evidenceIds: string[] };

export type CharacterPatchOperation =
  | (CharacterPatchSource & { kind: "replace_persona"; summary: string; voice: string })
  | (CharacterPatchSource & {
      kind: "create_trait" | "create_value";
      facet: Pick<CharacterFacet, "id" | "description" | "strength">;
    })
  | (CharacterPatchSource & {
      kind: "update_trait" | "update_value";
      id: string;
      description: string | null;
      strength: number | null;
    })
  | (CharacterPatchSource & { kind: "retire_trait" | "retire_value"; id: string })
  | (CharacterPatchSource & {
      kind: "set_emotion";
      emotion: Pick<EmotionState, "id" | "description" | "intensity">;
    })
  | (CharacterPatchSource & { kind: "resolve_emotion"; id: string })
  | (CharacterPatchSource & {
      kind: "set_attitude";
      attitude: Pick<AttitudeState, "id" | "subjectId" | "description" | "intensity">;
    })
  | (CharacterPatchSource & { kind: "retire_attitude"; id: string })
  | (CharacterPatchSource & {
      kind: "create_goal";
      goal: Pick<AgentGoal, "id" | "description" | "priority" | "progress" | "targetIds" | "motivatedByIds"> &
        { parentGoalId: string | null };
    })
  | (CharacterPatchSource & {
      kind: "update_goal";
      id: string;
      description: string | null;
      priority: number | null;
      progress: number | null;
      targetIds: LocalEntityId[] | null;
      parentGoal:
        | { kind: "unchanged" }
        | { kind: "none" }
        | { kind: "goal"; goalId: string };
      motivatedByIds: string[] | null;
    })
  | (CharacterPatchSource & { kind: "set_goal_status"; id: string; status: AgentGoal["status"] })
  | (CharacterPatchSource & {
      kind: "create_commitment";
      commitment: Pick<AgentCommitment, "id" | "description" | "priority" | "subjectIds">;
    })
  | (CharacterPatchSource & {
      kind: "update_commitment";
      id: string;
      description: string | null;
      priority: number | null;
      subjectIds: LocalEntityId[] | null;
    })
  | (CharacterPatchSource & {
      kind: "set_commitment_status";
      id: string;
      status: AgentCommitment["status"];
    });

export interface CharacterPatch {
  agentId: AgentId;
  baseRevision: number;
  operations: CharacterPatchOperation[];
}

export interface ReactionRequest {
  agentId: AgentId;
  sourceActionId: string;
  stimulus: ObservationPacket;
  basis: Array<
    | { kind: "shared_placement"; placementId: EntityId }
    | { kind: "fact"; factId: FactId }
    | { kind: "perception_check"; checkId: string }
  >;
}

export type ReactionDecision =
  | {
      agentId: AgentId;
      baseRevision: number;
      originalProposalId: string;
      kind: "keep";
    }
  | {
      agentId: AgentId;
      baseRevision: number;
      originalProposalId: string;
      kind: "replace";
      replacementAction: AgentActionProposal;
    };

export type WorldDeltaOperation =
  | { kind: "create_entity"; entity: WorldEntity; placementId: EntityId | null; causes: CausalRef[] }
  | { kind: "retire_entity"; entityId: EntityId; causes: CausalRef[] }
  | { kind: "place_entity"; entityId: EntityId; placementId: EntityId | null; causes: CausalRef[] }
  | { kind: "set_fact"; fact: WorldFact; causes: CausalRef[] }
  | { kind: "remove_fact"; factId: FactId; causes: CausalRef[] }
  | { kind: "set_meter"; meter: MeterState; causes: CausalRef[] }
  | { kind: "adjust_meter"; meterId: string; amount: number; causes: CausalRef[] }
  | {
      kind: "transfer_quantity";
      definitionId: string;
      fromHolderId: EntityId;
      toHolderId: EntityId;
      amount: number;
      causes: CausalRef[];
    }
  | {
      kind: "produce_quantity";
      definitionId: string;
      holderId: EntityId;
      amount: number;
      lawId: string;
      causes: CausalRef[];
    }
  | {
      kind: "consume_quantity";
      definitionId: string;
      holderId: EntityId;
      amount: number;
      lawId: string;
      causes: CausalRef[];
    }
  | { kind: "set_rating"; rating: RatingState; causes: CausalRef[] }
  | { kind: "advance_time"; seconds: number; causes: CausalRef[] }
  | { kind: "create_agent"; agent: AgentState; causes: CausalRef[] }
  | { kind: "remove_agent"; agentId: AgentId; causes: CausalRef[] };

export interface TransitionProposal {
  baseRevision: number;
  outcomes: ActionOutcome[];
  operations: WorldDeltaOperation[];
  events: WorldEvent[];
  observations: ObservationPacket[];
  intentStatus: PlayerIntent["status"];
  requiresPlayerDecision: boolean;
}

export interface ModelTokenUsage {
  input: number | null;
  output: number | null;
  reasoning: number | null;
  cacheRead: number | null;
  cacheWrite: number | null;
}

export interface ModelContextSectionAudit {
  utf8Bytes: number;
  itemCount: number | null;
}

export interface ModelContextAudit {
  utf8Bytes: number;
  sections: Record<string, ModelContextSectionAudit>;
  counts: {
    history: number;
    events: number;
    agents: number;
    entities: number;
    facts: number;
    beliefs: number;
    evidence: number;
    observations: number;
  };
}

export interface ModelTransportAttemptAudit {
  attempt: number;
  queueWaitMs: number;
  executionMs: number;
  retryDelayMs: number;
  status: "succeeded" | "retryable_error" | "failed";
  errorName: string | null;
  statusCode: number | null;
}

export interface ModelInvocationAudit {
  id: string;
  ordinal: number;
  requestHash: string;
  responseHash: string | null;
  requestUtf8Bytes: number;
  responseUtf8Bytes: number | null;
  context: ModelContextAudit;
  transports: ModelTransportAttemptAudit[];
  tokenUsage: ModelTokenUsage;
  finishReason: string | null;
  providerRequestId: string | null;
  resultKind: string | null;
  semanticOutcome: "accepted" | "rejected";
  validationIssueCodes: string[];
}

export interface ModelExecutionAudit {
  role: "truth-engine" | "agent-mind" | "agent-reaction";
  subjectId: string;
  profileId: string;
  providerId: string;
  modelId: string;
  catalogSchemaVersion: 1;
  catalogHash: string;
  promptVersion: string;
  inference: ModelInferenceConfig;
  structuredOutputMode: "json-schema-strict" | "json-object-zod" | "deterministic-test";
  invocations: ModelInvocationAudit[];
}

export interface CommittedStep {
  contentHash: string;
  baseRevision: number;
  revision: number;
  step: number;
  initialActions: AgentActionProposal[];
  reactionRequests: ReactionRequest[];
  reactionDecisions: ReactionDecision[];
  actions: AgentActionProposal[];
  rngBefore: SeededRngState;
  rngAfter: SeededRngState;
  checkRequests: D20CheckRequest[];
  checks: D20CheckResult[];
  outcomes: ActionOutcome[];
  events: WorldEvent[];
  observations: ObservationPacket[];
  operations: WorldDeltaOperation[];
  beliefPatches: BeliefPatch[];
  characterPatches: CharacterPatch[];
  modelAudits: ModelExecutionAudit[];
}
