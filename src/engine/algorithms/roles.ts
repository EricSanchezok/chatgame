import type { AgentMindOutput } from "../contracts/llm-schemas";
import type {
  AgentActionProposal,
  AgentState,
  CommitmentRound,
  D20CheckRequest,
  D20CheckResult,
  DiscreteRandomResult,
  ModelExecutionAudit,
  ObservationPacket,
  ReactionDecision,
  ReactionRequest,
  SimulationState,
  TransitionProposal,
  WorldEvent,
} from "../contracts/model";
import type { ResolutionScope } from "../contracts/prompts";
import type { SymbolRepairPolicy } from "../contracts/symbol-repair";
import type { RulePackageRegistry } from "../mechanics/rule-package";
import type {
  ScheduledActivityState,
  TemporalBoundary,
  TemporalPlan,
  TemporalStateSnapshot,
} from "../mechanics/temporal";
import type { ModelExecutionScope, StructuredModelProvider } from "../models/model-provider";
import type {
  InteractionDependency,
  WorldResolutionCandidate,
} from "../runtime/execution";
import type { JsonObject } from "../runtime/json";
import type { WorldDefinition } from "../runtime/world-definition";
import type {
  AlgorithmImplementation,
  AlgorithmRole,
  ResolvedAlgorithm,
} from "./composition";

/** Stable cross-implementation metrics exposed by batched Role capabilities. */
export interface AlgorithmBatchMetrics {
  submittedSlots: number;
  repairCalls: number;
  repeatedFingerprints: number;
  splitCount: number;
  partialFailureSlots: number;
  singletonFailures: number;
}

export interface OutputRecoveryCapability {
  readonly maxRepairs: number;
  readonly exhaustion: "fail-step";
  splitAt(slotCount: number): number;
}

export interface AgentCognitionBatchInput {
  agent: AgentState;
  observations: readonly ObservationPacket[];
  currentResolution: {
    action: AgentActionProposal | null;
    outcome: {
      status: "succeeded" | "partial" | "failed" | "blocked" | "continuing";
    } | null;
  };
  events: readonly WorldEvent[];
}

export interface AgentCognitionBatchResult {
  outputs: Map<string, AgentMindOutput>;
  failures: Array<{ agentId: string; error: unknown }>;
  modelAudits: ModelExecutionAudit[];
  batchCount: number;
  metrics: AlgorithmBatchMetrics;
}

export interface AgentCognitionCapability {
  thinkBatch(
    state: SimulationState,
    inputs: readonly AgentCognitionBatchInput[],
    scope: ModelExecutionScope,
    purpose?: "bootstrap" | "mind" | "resume",
    maxSlots?: number,
  ): Promise<AgentCognitionBatchResult>;
}

export interface ReactionDecisionCapability {
  react(
    state: SimulationState,
    agent: AgentState,
    originalAction: AgentActionProposal,
    request: ReactionRequest,
    scope: ModelExecutionScope,
  ): Promise<ReactionDecision & { modelAudit: ModelExecutionAudit }>;
}

export interface CompiledAction {
  plan: TemporalPlan;
  activity: ScheduledActivityState;
  dependency: InteractionDependency;
}

export interface ActionCompilationResult {
  compilations: CompiledAction[];
  modelAudits: ModelExecutionAudit[];
  batchCount: number;
  metrics: AlgorithmBatchMetrics;
}

export type PlannedTemporalActivity = Pick<CompiledAction, "plan" | "activity">;

export interface ActionCompilationCapability {
  (
    provider: StructuredModelProvider,
    state: Readonly<SimulationState>,
    actions: readonly AgentActionProposal[],
    scope: ModelExecutionScope,
    profileId: string,
    maxSlots: number,
    recovery?: Readonly<OutputRecoveryCapability>,
    symbolRepairPolicy?: Readonly<SymbolRepairPolicy>,
  ): Promise<ActionCompilationResult>;
}

export interface CandidateSelectionDiagnostics {
  selectedCount: number;
  visibleCount: number;
  batchBudget: number;
  batchShortlistRatio: number;
  prunedReferenceCount: number;
  anchorCount: number;
  budgetExceeded: false;
  perSlotSelectedCount: Readonly<Record<string, number>>;
  cache: {
    passageHits: number;
    passageMisses: number;
    queryHits: number;
    queryMisses: number;
    readMs: number;
    queryEncodeMs: number;
  };
}

export interface CandidateSelectionResult {
  modelContext: Record<string, unknown>;
  selectedKeysBySlot: ReadonlyMap<number, readonly string[]>;
  fullContextHash: string;
  modelContextHash: string;
  shortlistHash: string;
  diagnostics: CandidateSelectionDiagnostics;
}

export interface CandidateSelectionCapability {
  readonly version: string;
  readonly role: "candidate-selection";
  retrieveBatch(input: {
    worldContentHash: string;
    fullContext: Readonly<Record<string, unknown>>;
    slotIndices: readonly number[];
    signal?: AbortSignal;
  }): Promise<CandidateSelectionResult>;
}

export interface InteractionGroundingCapability {
  (
    provider: StructuredModelProvider,
    state: Readonly<SimulationState>,
    action: AgentActionProposal,
    scope: ModelExecutionScope,
    profileId: string,
    invocationOffset?: number,
    repairAttempts?: number,
  ): Promise<{ dependency: InteractionDependency; audit: ModelExecutionAudit }>;
}

export interface OnsetPerceptionInput {
  definition: WorldDefinition;
  state: SimulationState;
  actions: AgentActionProposal[];
  temporalBoundary: TemporalBoundary;
  identityOwner: string;
  groundings: readonly InteractionDependency[];
}

export interface OnsetPerceptionResult {
  requests: D20CheckRequest[];
  checks: D20CheckResult[];
  commitmentRounds: CommitmentRound[];
  rng: SimulationState["truth"]["rng"];
  modelAudit: ModelExecutionAudit;
  aliases: Array<[string, string | null]>;
}

export interface OnsetPerceptionCapability {
  perceiveOnset(
    input: Readonly<OnsetPerceptionInput>,
    scope: ModelExecutionScope,
  ): Promise<OnsetPerceptionResult>;
}

export interface ReactionResolution {
  decisions: ReactionDecision[];
  groundings: InteractionDependency[];
  modelAudits: ModelExecutionAudit[];
}

export interface ObservationResolution {
  packets: ObservationPacket[];
  modelAudits: ModelExecutionAudit[];
}

export interface TruthResolution extends WorldResolutionCandidate {
  modelAudits: ModelExecutionAudit[];
  reactionModelAudits: ModelExecutionAudit[];
}

export interface TruthResolutionInput {
  definition: WorldDefinition;
  state: SimulationState;
  initialActions: AgentActionProposal[];
  temporalBoundary: TemporalBoundary;
  identityOwner: string;
  groundings: readonly InteractionDependency[];
  modelWorkset?: {
    state: SimulationState;
    initialActions: readonly AgentActionProposal[];
    availableActions: readonly AgentActionProposal[];
    availableDependencies: readonly InteractionDependency[];
  };
  resolutionScope?: ResolutionScope;
  enableReactionRouting?: boolean;
  resolveReactions: (requests: readonly ReactionRequest[]) => Promise<ReactionResolution>;
  renderObservations: (
    proposal: Readonly<TransitionProposal>,
    actions: readonly AgentActionProposal[],
    transitionAttempt: number,
    observerIds?: readonly string[],
  ) => Promise<ObservationResolution>;
  validateProposal: (
    proposal: TransitionProposal,
    checks: readonly D20CheckResult[],
    randomResults: readonly DiscreteRandomResult[],
    actions: readonly AgentActionProposal[],
    stimulusObservations: readonly ObservationPacket[],
  ) => void;
}

export interface TruthResolutionCapability {
  resolve(input: TruthResolutionInput, scope: ModelExecutionScope): Promise<TruthResolution>;
}

export interface ObservationRenderingInput {
  definition: WorldDefinition;
  state: SimulationState;
  proposal: TransitionProposal;
  actions: readonly AgentActionProposal[];
  observerIds: readonly string[];
  identityOwner: string;
  temporalState?: Readonly<TemporalStateSnapshot>;
}

export interface ObservationRenderingResult {
  packets: ObservationPacket[];
  modelAudits: ModelExecutionAudit[];
  batchCount: number;
}

export interface ObservationRenderingCapability {
  render(
    input: ObservationRenderingInput,
    scope: ModelExecutionScope,
  ): Promise<ObservationRenderingResult>;
}

export interface ConfiguredRoleAlgorithm<R extends AlgorithmRole = AlgorithmRole>
  extends AlgorithmImplementation<R> {
  readonly config: JsonObject;
  readonly children: Readonly<Record<string, ResolvedAlgorithm>>;
}

export interface AgentCognitionRoleAlgorithm extends ConfiguredRoleAlgorithm<"agent-cognition"> {
  create(provider: StructuredModelProvider, recovery: Readonly<OutputRecoveryCapability>): AgentCognitionCapability;
}

export interface ActionCompilationRoleAlgorithm extends ConfiguredRoleAlgorithm<"action-compilation"> {
  readonly compile: ActionCompilationCapability;
}

export interface CandidateSelectionRoleAlgorithm extends ConfiguredRoleAlgorithm<"candidate-selection"> {
  readonly runtime: CandidateSelectionCapability | undefined;
}

export interface WorkBatchingRoleAlgorithm extends ConfiguredRoleAlgorithm<"work-batching"> {
  readonly maxSlots: number;
}

export interface WorkSchedulingRoleAlgorithm extends ConfiguredRoleAlgorithm<"work-scheduling"> {
  readonly maxConcurrent: number;
}

export interface OutputRecoveryRoleAlgorithm extends ConfiguredRoleAlgorithm<"output-recovery"> {
  readonly policy: Readonly<OutputRecoveryCapability>;
}

export interface SymbolRepairRoleAlgorithm extends ConfiguredRoleAlgorithm<"symbol-repair"> {
  readonly policy: Readonly<SymbolRepairPolicy>;
}

export interface InteractionGroundingRoleAlgorithm extends ConfiguredRoleAlgorithm<"interaction-grounding"> {
  readonly ground: InteractionGroundingCapability;
}

export interface OnsetPerceptionRoleAlgorithm extends ConfiguredRoleAlgorithm<"onset-perception"> {
  create(
    provider: StructuredModelProvider,
    rulePackages: RulePackageRegistry,
    recovery: Readonly<OutputRecoveryCapability>,
  ): OnsetPerceptionCapability;
}

export interface ReactionDecisionRoleAlgorithm extends ConfiguredRoleAlgorithm<"reaction-decision"> {
  create(provider: StructuredModelProvider, recovery: Readonly<OutputRecoveryCapability>): ReactionDecisionCapability;
}

export interface TruthResolutionRoleAlgorithm extends ConfiguredRoleAlgorithm<"truth-resolution"> {
  create(
    provider: StructuredModelProvider,
    rulePackages: RulePackageRegistry,
    recovery: Readonly<OutputRecoveryCapability>,
  ): TruthResolutionCapability;
}

export interface ObservationRenderingRoleAlgorithm extends ConfiguredRoleAlgorithm<"observation-rendering"> {
  create(
    provider: StructuredModelProvider,
    recovery: Readonly<OutputRecoveryCapability>,
  ): ObservationRenderingCapability;
}
