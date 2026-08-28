import { AgentMind } from "./agent-mind";
import {
  ActivityFootprintIndex,
  interactionDependencyComponents,
  forceGlobalInteractionDependency,
  generateInteractionDependency,
  interactionDependencyForActivity,
  interactionDependencyForCondition,
  interactionDependencyForTimer,
  interactionDependenciesConflict,
  resolutionExceedsDeclaredDependencies,
  resolvedComponentsConflict,
} from "./action-dependency";
import { evaluateProposalCausality } from "./causality";
import { defineAlgorithmManifest } from "./execution";
import type {
  InteractionDependency,
  BootstrapCandidate,
  BootstrapInput,
  ExecutionContext,
  ExternalActionInput,
  ExternalReactionInput,
  JsonObject,
  WorldExecutionAlgorithm,
  WorldStepCandidate,
  WorldStepInput,
  WorldStepPreparation,
} from "./execution";
import {
  StepPreparationInvalidatedError,
  WORLD_STEP_CANDIDATE_SCHEMA_VERSION,
  WORLD_STEP_PREPARATION_SCHEMA_VERSION,
} from "./execution";
import type { AgentMindOutput } from "./llm-schemas";
import type {
  AgentActionProposal,
  AgentId,
  AgentState,
  CausalRef,
  CommitmentRound,
  D20CheckRequest,
  D20CheckResult,
  MechanicInvocation,
  ModelExecutionAudit,
  ObservationPacket,
  ReactionDecision,
  ReactionRequest,
  SeededRngState,
  SimulationState,
  TransitionProposal,
} from "./model";
import { contentHash } from "./model-audit";
import { applyMindCommit } from "./mind-commit";
import {
  ModelSemanticRepairError,
  type StructuredModelProvider,
} from "./model-provider";
import { applyObservationBindings, pendingObservationsFor, validateObservations } from "./observation";
import { ObservationRenderer } from "./observation-renderer";
import { createCoreRulePackageRegistry, type RulePackageRegistry } from "./rule-package";
import { runtimeId } from "./runtime-id";
import { applyTransitionProposal } from "./transaction";
import { TruthEngine, type OnsetPerceptionResult, type TruthResolution } from "./truth-engine";
import {
  cancelActivity,
  advanceTemporalState,
  pauseActivity,
  reconcileTemporalOutcomes,
  selectTemporalBoundary,
  settleActivityContexts,
  validateActivityResources,
  evaluateActivityContinuation,
  type TemporalAdvanceResult,
  type TemporalBoundary,
  type ActivityTransition,
  type ScheduledActivityState,
} from "./temporal";
import {
  planTemporalActivity,
} from "./temporal-planner";

const groundingComponent = { id: "interaction-grounding", version: "3", config: { repairAttempts: 2 } } as const;
const temporalComponent = { id: "temporal-planner", version: "2", config: { repairAttempts: 2 } } as const;
const truthComponent = { id: "truth-interaction-component", version: "2", config: { fallback: "global" } } as const;
const mindComponent = {
  id: "agent-mind",
  version: "4",
  config: { externalUpdates: false, repairExhaustion: "empty-patch-and-idle-action" },
} as const;
export const EAGER_REFERENCE_MANIFEST = defineAlgorithmManifest({
  id: "eager-reference",
  version: "5",
  config: {
    activation: "decision-eligible-model-agents",
    grounding: "persisted-interaction-footprints",
    sharedResourceAllocation: "script-policy-with-kernel-capacity",
    resolution: "interaction-components-with-global-fallback",
    observation: "component-bounded",
    mindUpdate: "decision-eligible-model-agents",
  },
  components: [temporalComponent, groundingComponent, truthComponent, mindComponent],
});

function observationsFor(packets: readonly ObservationPacket[], observerId: string): ObservationPacket[] {
  return packets.filter((packet) => packet.observerId === observerId);
}

type EagerMindOutput = AgentMindOutput & { modelAudit: ModelExecutionAudit; fallback: boolean };

interface ComponentResolution {
  resolution: TruthResolution;
}

export function createMindRepairFallback(
  state: Readonly<SimulationState>,
  agent: Readonly<AgentState>,
  audit: ModelExecutionAudit,
  purpose: "bootstrap" | "resume" | "mind",
): EagerMindOutput {
  return {
    beliefPatch: { agentId: agent.id, baseRevision: state.revision, operations: [] },
    characterPatch: { agentId: agent.id, baseRevision: state.revision, operations: [] },
    nextAction: {
      id: runtimeId({
        worldHash: state.worldHash,
        revision: state.revision,
        kind: "action",
        stage: `${purpose}-repair-fallback`,
        owner: agent.id,
        round: 0,
        ordinal: 0,
      }),
      actorId: agent.id,
      baseRevision: state.revision,
      rawText: "观察并等待",
      goal: "在下一次有效决策前不采取新的主动行动",
      means: null,
      targetIds: [],
    },
    modelAudit: structuredClone(audit),
    fallback: true,
  };
}

async function thinkWithFallback(
  state: Readonly<SimulationState>,
  agent: Readonly<AgentState>,
  purpose: "bootstrap" | "resume" | "mind",
  context: ExecutionContext,
  think: () => Promise<AgentMindOutput & { modelAudit: ModelExecutionAudit }>,
): Promise<EagerMindOutput> {
  try {
    return { ...await think(), fallback: false };
  } catch (error) {
    if (!(error instanceof ModelSemanticRepairError) || !error.audit) throw error;
    context.instrumentation.emit({
      event: "algorithm.agent_mind.repair_fallback",
      level: "warn",
      correlation: { ...context.modelScope.correlation, modelSubject: agent.id },
      attributes: { phase: purpose, policy: "empty-patch-and-idle-action" },
      counts: { mindFallbacks: 1 },
      error: { name: error.name, message: error.message },
    });
    return createMindRepairFallback(state, agent, error.audit, purpose);
  }
}

async function settledValues<T>(promises: readonly Promise<T>[], label: string): Promise<T[]> {
  const settled = await Promise.allSettled(promises);
  const failures = settled.filter((result): result is PromiseRejectedResult => result.status === "rejected");
  if (failures.length > 0) throw new AggregateError(failures.map((failure) => failure.reason), `${label} batch failed`);
  return settled.map((result) => (result as PromiseFulfilledResult<T>).value);
}

function materializeExternalAction(
  state: Readonly<SimulationState>,
  input: ExternalActionInput,
  ordinal: number,
  stage: "external" | "replay",
): AgentActionProposal {
  if (!input.rawText.trim() || !input.goal.trim()) throw new Error(`external action for ${input.agentId} is blank`);
  return {
    id: runtimeId({
      worldHash: state.worldHash,
      revision: state.revision,
      kind: "action",
      stage,
      owner: input.agentId,
      round: 0,
      ordinal,
    }),
    actorId: input.agentId,
    baseRevision: state.revision,
    rawText: input.rawText.trim(),
    goal: input.goal.trim(),
    means: input.means?.trim() || null,
    targetIds: [...input.targetIds],
  };
}

function collectActions(
  input: Readonly<WorldStepInput>,
  preparedActions: ReadonlyMap<AgentId, AgentActionProposal>,
  eligibleAgentIds: readonly AgentId[],
): AgentActionProposal[] {
  const state = input.state;
  const agentIds = Object.keys(state.agents).sort();
  const rosterIds = Object.keys(input.policyRoster).sort();
  if (contentHash(agentIds) !== contentHash(rosterIds)) throw new Error("policy roster must cover every Agent exactly once");
  const externalByAgent = new Map<string, ExternalActionInput>();
  for (const external of input.request.externalActions) {
    if (externalByAgent.has(external.agentId)) throw new Error(`duplicate external action for ${external.agentId}`);
    externalByAgent.set(external.agentId, external);
  }
  const eligible = new Set(eligibleAgentIds);
  const actions = agentIds.flatMap((agentId, ordinal) => {
    const binding = input.policyRoster[agentId];
    if (!binding || binding.agentId !== agentId) throw new Error(`invalid policy binding for ${agentId}`);
    if (!eligible.has(agentId)) return [];
    if (binding.kind === "model") {
      const prepared = preparedActions.get(agentId) ?? state.agents[agentId].nextAction;
      if (!prepared) throw new Error(`model Agent ${agentId} has not prepared an action`);
      return [structuredClone(prepared)];
    }
    if (binding.kind === "external" || binding.kind === "replay") {
      const external = externalByAgent.get(agentId);
      if (!external) throw new Error(`${binding.kind} Agent ${agentId} has no supplied action`);
      externalByAgent.delete(agentId);
      return [materializeExternalAction(state, external, ordinal, binding.kind)];
    }
    return [];
  });
  if (externalByAgent.size > 0) throw new Error(`external action targets non-external Agent ${externalByAgent.keys().next().value}`);
  return actions;
}

interface PreparedInteractionDependency {
  dependency: InteractionDependency;
  audit: ModelExecutionAudit;
}

interface EagerStepPreparationPayload {
  resumedAgentIds: AgentId[];
  resumedOutputs: EagerMindOutput[];
  newActions: AgentActionProposal[];
  temporalPlanning: import("./temporal-planner").PlannedTemporalActivity[];
  dependencyResults: PreparedInteractionDependency[];
  planningState: SimulationState;
  interruptionTransitions: ActivityTransition[];
  reactionRequests: ReactionRequest[];
  onsetPerception: {
    requests: D20CheckRequest[];
    checks: D20CheckResult[];
    commitmentRounds: CommitmentRound[];
    rng: SeededRngState;
  };
}

function eagerPreparationPayload(preparation: Readonly<WorldStepPreparation>): EagerStepPreparationPayload {
  const value = preparation.payload as unknown;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new StepPreparationInvalidatedError("step preparation payload is not an object");
  }
  const payload = value as Partial<EagerStepPreparationPayload>;
  if (!Array.isArray(payload.resumedAgentIds) || !Array.isArray(payload.resumedOutputs) ||
    !Array.isArray(payload.newActions) || !Array.isArray(payload.temporalPlanning) ||
    !Array.isArray(payload.dependencyResults) || !payload.planningState ||
    typeof payload.planningState !== "object" || !Array.isArray(payload.interruptionTransitions) ||
    !Array.isArray(payload.reactionRequests) || !payload.onsetPerception ||
    typeof payload.onsetPerception !== "object" || !Array.isArray(payload.onsetPerception.requests) ||
    !Array.isArray(payload.onsetPerception.checks) ||
    !Array.isArray(payload.onsetPerception.commitmentRounds) || !payload.onsetPerception.rng) {
    throw new StepPreparationInvalidatedError("step preparation payload is incomplete");
  }
  return structuredClone(payload) as EagerStepPreparationPayload;
}

function reactionBasis(
  state: Readonly<SimulationState>,
  trigger: Readonly<AgentActionProposal>,
  observerAgentId: AgentId,
  perception: Readonly<Pick<OnsetPerceptionResult, "requests" | "checks">>,
): ReactionRequest["basis"] {
  const sourceAgent = state.agents[trigger.actorId];
  const observer = state.agents[observerAgentId];
  if (!sourceAgent || !observer || sourceAgent.id === observer.id) return [];
  const sourcePlacement = state.truth.placements[sourceAgent.entityId];
  const observerPlacement = state.truth.placements[observer.entityId];
  if (sourcePlacement && sourcePlacement === observerPlacement) {
    return [{ kind: "shared_placement", placementId: sourcePlacement }];
  }
  const related = Object.values(state.truth.facts)
    .filter((fact) => fact.access.kind === "public" ||
      fact.access.kind === "agents" && fact.access.agentIds.includes(observerAgentId))
    .filter((fact) => {
      if (fact.value.kind !== "entity") return false;
      const endpoints = new Set([fact.subjectId, fact.value.entityId]);
      return endpoints.has(sourceAgent.entityId) && endpoints.has(observer.entityId);
    })
    .sort((left, right) => left.id.localeCompare(right.id));
  if (related[0]) return [{ kind: "fact", factId: related[0].id }];
  const resultById = new Map(perception.checks.map((result) => [result.requestId, result]));
  const successful = perception.requests.filter((request) =>
    request.phase === "perception" && request.actorId === observer.entityId &&
    resultById.get(request.id)?.succeeded &&
    request.causes.some((cause) => cause.kind === "action" && cause.id === trigger.id) &&
    request.causes.some((cause) => cause.kind === "fact" || cause.kind === "law"))
    .sort((left, right) => left.id.localeCompare(right.id));
  return successful[0] ? [{ kind: "perception_check", checkId: successful[0].id }] : [];
}

interface OnsetReactionCandidate {
  agentId: AgentId;
  trigger: AgentActionProposal;
  originalIntent: ReactionRequest["originalIntent"];
  description: string;
}

function collectOnsetReactionCandidates(input: {
  state: Readonly<SimulationState>;
  planningState: Readonly<SimulationState>;
  actions: readonly AgentActionProposal[];
  dependencies: readonly InteractionDependency[];
}): OnsetReactionCandidate[] {
  const requestInputs: OnsetReactionCandidate[] = [];
  const dependencyByAction = new Map(input.dependencies.map((dependency) => [dependency.id, dependency]));
  const actionById = new Map(input.actions.map((action) => [action.id, action]));
  for (const action of input.actions) {
    const activity = Object.values(input.planningState.truth.activities)
      .find((candidate): candidate is ScheduledActivityState =>
        candidate.status === "active" && candidate.sourceActionId === action.id);
    if (!activity?.plan.interruptible) continue;
    const dependency = dependencyByAction.get(action.id);
    if (!dependency) continue;
    const triggerDependency = input.dependencies.find((candidate) =>
      candidate.id !== dependency.id && candidate.actorId !== action.actorId &&
      candidate.audienceAgentIds.includes(action.actorId) &&
      interactionDependenciesConflict(dependency, candidate));
    const trigger = triggerDependency && actionById.get(triggerDependency.id);
    if (trigger) {
      requestInputs.push({
        agentId: action.actorId,
        trigger,
        originalIntent: { kind: "prepared_action", actionId: action.id },
        description: activity.plan.description,
      });
    }
  }
  for (const activity of Object.values(input.state.truth.activities)
    .filter((candidate): candidate is ScheduledActivityState =>
      candidate.status === "active" && candidate.plan.interruptible)
    .sort((left, right) => left.id.localeCompare(right.id))) {
    if (input.actions.some((action) => action.actorId === activity.actorId)) continue;
    const triggerDependency = input.dependencies.find((dependency) =>
      dependency.actorId !== activity.actorId &&
      dependency.audienceAgentIds.includes(activity.actorId) &&
      interactionDependenciesConflict(activity.interactionFootprint, dependency));
    const trigger = triggerDependency && actionById.get(triggerDependency.id);
    if (!trigger) continue;
    requestInputs.push({
      agentId: activity.actorId,
      trigger,
      originalIntent: {
        kind: "ongoing_activity",
        activityId: activity.id,
        sourceActionId: activity.sourceActionId,
      },
      description: activity.plan.description,
    });
  }
  const unique = [...new Map(requestInputs
    .sort((left, right) => left.agentId.localeCompare(right.agentId) || left.trigger.id.localeCompare(right.trigger.id))
    .map((entry) => [entry.agentId, entry])).values()];
  return unique;
}

function materializeOnsetReactionRequests(
  state: Readonly<SimulationState>,
  candidates: readonly OnsetReactionCandidate[],
  perception: Readonly<Pick<OnsetPerceptionResult, "requests" | "checks">>,
): ReactionRequest[] {
  return candidates.flatMap((entry, ordinal): ReactionRequest[] => {
    const basis = reactionBasis(state, entry.trigger, entry.agentId, perception);
    if (basis.length === 0) return [];
    const id = runtimeId({
      worldHash: state.worldHash,
      revision: state.revision,
      kind: "reaction-request",
      stage: "action-onset",
      owner: [entry.agentId, entry.trigger.id],
      round: 0,
      ordinal,
    });
    return [{
      id,
      agentId: entry.agentId,
      triggerActionId: entry.trigger.id,
      originalIntent: structuredClone(entry.originalIntent),
      stimulus: {
        id: runtimeId({
          worldHash: state.worldHash,
          revision: state.revision,
          kind: "observation",
          stage: "reaction-stimulus",
          owner: entry.agentId,
          round: 0,
          ordinal,
        }),
        observerId: entry.agentId,
        step: state.step + 1,
        kind: "stimulus",
        summary: `你察觉到附近的行动“${entry.trigger.rawText}”正在开始，可能影响你当前的“${entry.description}”。`,
        introductions: [],
        apparentClaims: [],
        sourceEventIds: [],
      },
      basis,
    }];
  });
}

function originalActionForReaction(
  state: Readonly<SimulationState>,
  actions: readonly AgentActionProposal[],
  request: Readonly<ReactionRequest>,
): AgentActionProposal {
  const intent = request.originalIntent;
  const original = intent.kind === "prepared_action"
    ? actions.find((action) => action.id === intent.actionId)
    : state.truth.activities[intent.activityId]?.sourceAction;
  if (!original) throw new Error(`reaction ${request.id} has no original intent`);
  return structuredClone(original);
}

function fallbackReactionDecision(
  state: Readonly<SimulationState>,
  request: Readonly<ReactionRequest>,
  source: ReactionDecision["source"] = "profile_fallback",
): ReactionDecision {
  const intent = request.originalIntent;
  const activity = intent.kind === "ongoing_activity"
    ? state.truth.activities[intent.activityId]
    : Object.values(state.truth.activities)
      .find((candidate) => candidate.sourceActionId === intent.actionId);
  if (!activity) throw new Error(`reaction ${request.id} has no temporal profile`);
  if (activity.status === "queued" || activity.status === "ready") {
    throw new Error(`reaction ${request.id} targets an Activity that has not started`);
  }
  const profile = state.truth.mechanics.temporalProfiles[activity.plan.profileId];
  if (!profile) throw new Error(`reaction ${request.id} references unknown temporal profile`);
  const disposition = intent.kind === "ongoing_activity"
    ? profile.reactionFallback === "pause"
      ? "pause"
      : profile.reactionFallback === "cancel"
        ? "cancel"
        : "continue"
    : "continue";
  return {
    requestId: request.id,
    source,
    agentId: request.agentId,
    baseRevision: state.revision,
    originalProposalId: intent.kind === "prepared_action" ? intent.actionId : intent.sourceActionId,
    kind: "keep",
    ongoingActivityDisposition: disposition,
  };
}

function materializeExternalReaction(
  state: Readonly<SimulationState>,
  request: Readonly<ReactionRequest>,
  input: Readonly<ExternalReactionInput>,
  ordinal: number,
): ReactionDecision {
  if (input.requestId !== request.id || input.agentId !== request.agentId || !input.submissionId.trim()) {
    throw new Error(`external reaction does not match request ${request.id}`);
  }
  const originalProposalId = request.originalIntent.kind === "prepared_action"
    ? request.originalIntent.actionId
    : request.originalIntent.sourceActionId;
  if (input.kind === "keep") {
    return {
      requestId: request.id,
      source: "external",
      agentId: request.agentId,
      baseRevision: state.revision,
      originalProposalId,
      kind: "keep",
      ongoingActivityDisposition: "continue",
    };
  }
  if (!input.rawText.trim() || !input.goal.trim()) throw new Error(`external reaction ${request.id} is blank`);
  return {
    requestId: request.id,
    source: "external",
    agentId: request.agentId,
    baseRevision: state.revision,
    originalProposalId,
    kind: "replace",
    replacementAction: {
      id: runtimeId({
        worldHash: state.worldHash,
        revision: state.revision,
        kind: "action",
        stage: "external-reaction",
        owner: request.agentId,
        round: 0,
        ordinal,
      }),
      actorId: request.agentId,
      baseRevision: state.revision,
      rawText: input.rawText.trim(),
      goal: input.goal.trim(),
      means: input.means?.trim() || null,
      targetIds: [...input.targetIds],
    },
  };
}

function mergeResolutions(
  source: Readonly<SimulationState>,
  resolutions: readonly TruthResolution[],
  boundary: Readonly<TemporalBoundary>,
  fallbackCause: import("./model").CausalRef,
): TruthResolution {
  const actions = resolutions.flatMap((resolution) => structuredClone(resolution.actions));
  const allMechanicInvocations = resolutions.flatMap((resolution) =>
    structuredClone(resolution.proposal.mechanicInvocations));
  const allMechanicResults = resolutions.flatMap((resolution) => structuredClone(resolution.mechanicResults));
  const conditionAdvances = allMechanicInvocations.filter((invocation) =>
    invocation.packageId === "core-resolution" && invocation.ruleId === "advance-conditions");
  const keptConditionAdvanceId = conditionAdvances[0]?.id;
  if (conditionAdvances.length > 1 && conditionAdvances.some((invocation) =>
    allMechanicResults.find((result) => result.invocationId === invocation.id)?.operations.length !== 0)) {
    throw new Error("condition advancement with effects requires global resolution");
  }
  const mechanicInvocations = allMechanicInvocations.filter((invocation) =>
    invocation.packageId !== "core-resolution" || invocation.ruleId !== "advance-conditions" ||
    invocation.id === keptConditionAdvanceId);
  const mechanicInvocationIds = new Set(mechanicInvocations.map((invocation) => invocation.id));
  const mechanicResults = allMechanicResults.filter((result) => mechanicInvocationIds.has(result.invocationId));
  const proposal: TransitionProposal = {
    baseRevision: source.revision,
    outcomes: resolutions.flatMap((resolution) => structuredClone(resolution.proposal.outcomes)),
    mechanicInvocations,
    operations: [
      ...resolutions.flatMap((resolution) => resolution.proposal.operations
        .filter((operation) => operation.kind !== "advance_time")
        .map((operation) => structuredClone(operation))),
      {
        kind: "advance_time",
        seconds: boundary.deltaSeconds,
        causes: actions.length > 0
          ? actions.map((action) => ({ kind: "action" as const, id: action.id }))
          : [structuredClone(fallbackCause)],
        assertions: [{
          kind: "elapsed_seconds_compare" as const,
          operator: "eq" as const,
          value: source.truth.elapsedSeconds,
        }],
      },
    ],
    events: resolutions.flatMap((resolution) => structuredClone(resolution.proposal.events)),
    observations: resolutions.flatMap((resolution) => structuredClone(resolution.proposal.observations)),
    decisionRequests: resolutions.flatMap((resolution) => structuredClone(resolution.proposal.decisionRequests)),
  };
  const checks = resolutions.flatMap((resolution) => structuredClone(resolution.checks));
  const randomResults = resolutions.flatMap((resolution) => structuredClone(resolution.randomResults));
  return {
    proposal,
    initialActions: resolutions.flatMap((resolution) => structuredClone(resolution.initialActions)),
    actions,
    reactionRequests: resolutions.flatMap((resolution) => structuredClone(resolution.reactionRequests)),
    reactionDecisions: resolutions.flatMap((resolution) => structuredClone(resolution.reactionDecisions)),
    stimulusObservations: resolutions.flatMap((resolution) => structuredClone(resolution.stimulusObservations)),
    requests: resolutions.flatMap((resolution) => structuredClone(resolution.requests)),
    checks,
    randomRequests: resolutions.flatMap((resolution) => structuredClone(resolution.randomRequests)),
    randomResults,
    commitmentRounds: resolutions.flatMap((resolution) => structuredClone(resolution.commitmentRounds)),
    resolutionPlans: resolutions.flatMap((resolution) => structuredClone(resolution.resolutionPlans)),
    resolutionReceipts: resolutions.flatMap((resolution) => structuredClone(resolution.resolutionReceipts)),
    rng: structuredClone(resolutions.at(-1)?.rng ?? source.truth.rng),
    mechanicResults,
    causalAssertionResults: evaluateProposalCausality(source, checks, randomResults, proposal),
    causalVerification: { verdict: "accept", findings: [] },
    modelAudits: resolutions.flatMap((resolution) => structuredClone(resolution.modelAudits)),
    reactionModelAudits: resolutions.flatMap((resolution) => structuredClone(resolution.reactionModelAudits)),
  };
}

export class EagerReferenceAlgorithm implements WorldExecutionAlgorithm {
  readonly manifest = EAGER_REFERENCE_MANIFEST;
  private readonly truthEngine: TruthEngine;
  private readonly agentMind: AgentMind;
  private readonly observationRenderer: ObservationRenderer;
  private readonly provider: StructuredModelProvider;
  private readonly rulePackages: RulePackageRegistry;

  constructor(provider: StructuredModelProvider, rulePackages?: RulePackageRegistry) {
    this.provider = provider;
    this.rulePackages = rulePackages ?? createCoreRulePackageRegistry();
    this.truthEngine = new TruthEngine(provider, { rulePackages: this.rulePackages });
    this.agentMind = new AgentMind(provider);
    this.observationRenderer = new ObservationRenderer(provider);
  }

  private contextOnlyResolution(
    input: Readonly<WorldStepInput>,
    boundary: Readonly<TemporalBoundary>,
    cause: Readonly<CausalRef>,
  ): TruthResolution {
    const invocation: MechanicInvocation = {
      id: runtimeId({
        worldHash: input.state.worldHash,
        revision: input.state.revision,
        kind: "mechanic",
        stage: "condition-advance",
        owner: "context-only",
        round: 0,
        ordinal: 0,
      }),
      packageId: "core-resolution",
      ruleId: "advance-conditions",
      input: { seconds: boundary.deltaSeconds },
      causes: [structuredClone(cause)],
      assertions: [{
        kind: "elapsed_seconds_compare",
        operator: "eq",
        value: input.state.truth.elapsedSeconds,
      }],
    };
    const mechanics = this.rulePackages.resolve(input.definition.rulePackages, {
      state: structuredClone(input.state),
      actions: [],
      resolutionPlans: [],
      resolutionReceipts: [],
      checkRequests: [],
      checkResults: [],
      randomRequests: [],
      randomResults: [],
    }, [invocation], []);
    const proposal: TransitionProposal = {
      baseRevision: input.state.revision,
      outcomes: [],
      mechanicInvocations: mechanics.invocations,
      operations: [
        ...mechanics.operations,
        {
          kind: "advance_time",
          seconds: boundary.deltaSeconds,
          causes: [structuredClone(cause)],
          assertions: [{
            kind: "elapsed_seconds_compare",
            operator: "eq",
            value: input.state.truth.elapsedSeconds,
          }],
        },
      ],
      events: [],
      observations: [],
      decisionRequests: [],
    };
    return {
      proposal,
      initialActions: [],
      actions: [],
      reactionRequests: [],
      reactionDecisions: [],
      stimulusObservations: [],
      requests: [],
      checks: [],
      randomRequests: [],
      randomResults: [],
      commitmentRounds: [],
      resolutionPlans: [],
      resolutionReceipts: [],
      rng: structuredClone(input.state.truth.rng),
      mechanicResults: mechanics.results,
      causalAssertionResults: evaluateProposalCausality(input.state, [], [], proposal),
      causalVerification: { verdict: "accept", findings: [] },
      modelAudits: [],
      reactionModelAudits: [],
    };
  }

  async bootstrap(input: Readonly<BootstrapInput>, context: ExecutionContext): Promise<BootstrapCandidate> {
    const source = structuredClone(input.state);
    const agents = Object.values(source.agents).sort((left, right) => left.id.localeCompare(right.id));
    const outputs = await settledValues(agents.map((agent) => thinkWithFallback(
      source,
      agent,
      "bootstrap",
      context,
      () => this.agentMind.think(
        source,
        agent,
        [],
        context.modelScope,
        { action: null, outcome: null },
        [],
        "bootstrap",
      ),
    )), "AgentMind bootstrap");
    return {
      schemaVersion: WORLD_STEP_CANDIDATE_SCHEMA_VERSION,
      sourceStateHash: contentHash(source),
      agentCommits: outputs.map((output, index) => ({
        agentId: agents[index].id,
        beliefPatch: structuredClone(output.beliefPatch),
        characterPatch: structuredClone(output.characterPatch),
        nextAction: structuredClone(output.nextAction),
      })),
      modelAudits: outputs.map((output) => structuredClone(output.modelAudit)),
      diagnostics: {
        activatedAgentIds: agents.map((agent) => agent.id),
        reusedAgentIds: [],
        mindFallbackAgentIds: outputs.flatMap((output, index) => output.fallback ? [agents[index].id] : []),
      },
    };
  }

  private async resolveComponent(
    input: Readonly<WorldStepInput>,
    actions: readonly AgentActionProposal[],
    dependencies: readonly InteractionDependency[],
    interactionIds: readonly string[],
    rngState: SimulationState["truth"]["rng"],
    context: ExecutionContext,
    globalFallback: boolean,
    temporal: Readonly<TemporalAdvanceResult>,
  ): Promise<ComponentResolution> {
    const componentDependencies = dependencies.filter((dependency) => interactionIds.includes(dependency.id));
    const actorIds = [...new Set(componentDependencies.flatMap((dependency) =>
      dependency.actorId === null ? [] : [dependency.actorId]))].sort();
    const scopedActivities = Object.fromEntries(Object.entries(temporal.activities)
      .filter(([, activity]) => actorIds.includes(activity.actorId))
      .map(([id, activity]) => [id, structuredClone(activity)]));
    const scopedTimers = Object.fromEntries(Object.entries(temporal.timers)
      .filter(([, timer]) => timer.wakeAgentIds.some((agentId) => actorIds.includes(agentId)))
      .map(([id, timer]) => [id, structuredClone(timer)]));
    const scopedDecisionPoints = temporal.decisionPoints.filter((point) => actorIds.includes(point.agentId))
      .map((point) => structuredClone(point));
    const scopedAgentIds = [...new Set([
      ...actorIds,
      ...componentDependencies.flatMap((dependency) => dependency.audienceAgentIds),
      ...Object.values(scopedActivities).flatMap((activity) => [
        ...activity.participantAgentIds,
        ...activity.interactionFootprint.audienceAgentIds,
      ]),
      ...Object.values(scopedTimers).flatMap((timer) => timer.wakeAgentIds),
      ...scopedDecisionPoints.map((point) => point.agentId),
    ])].sort();
    const scopedState = structuredClone(input.state);
    scopedState.truth.rng = structuredClone(rngState);
    scopedState.agents = Object.fromEntries(scopedAgentIds.map((agentId) => {
      const agent = input.state.agents[agentId];
      if (!agent) throw new Error(`interaction component references unknown Agent ${agentId}`);
      return [agentId, structuredClone(agent)];
    }));
    const componentActionIds = new Set(componentDependencies
      .filter((dependency) => dependency.kind === "action")
      .map((dependency) => dependency.id));
    const scopedActions = actions.filter((action) => componentActionIds.has(action.id));
    const scopedDependencies = componentDependencies.map((dependency) => structuredClone(dependency));
    const scopedTemporalBase: TemporalAdvanceResult = {
      ...structuredClone(temporal),
      activities: scopedActivities,
      timers: scopedTimers,
      transitions: temporal.transitions.filter((transition) => actorIds.includes(transition.actorId))
        .map((transition) => structuredClone(transition)),
      decisionPoints: scopedDecisionPoints,
    };
    const identityOwner = globalFallback ? "component-global" : `component-${actorIds.join("+")}`;
    let transitionCandidate: SimulationState | undefined;
    const resolution = await this.truthEngine.resolve({
      definition: input.definition,
      state: scopedState,
      initialActions: scopedActions.map((action) => structuredClone(action)),
      temporalBoundary: temporal.boundary,
      identityOwner,
      groundings: scopedDependencies,
      enableReactionRouting: false,
      resolveReactions: async () => {
        throw new Error("component resolution cannot open a second reaction round");
      },
      renderObservations: async (proposal, finalActions, transitionAttempt) => {
        const resolvedTemporal = reconcileTemporalOutcomes(scopedTemporalBase, proposal.outcomes);
        const observationTemporal = {
          activities: {
            ...structuredClone(temporal.activities),
            ...structuredClone(resolvedTemporal.activities),
          },
          timers: {
            ...structuredClone(temporal.timers),
            ...structuredClone(resolvedTemporal.timers),
          },
        };
        const observerIds = [...new Set([
          ...actorIds,
          ...scopedDependencies.flatMap((dependency) => dependency.audienceAgentIds),
        ])].sort();
        const observationIdentityOwner = `${identityOwner}:transition-${transitionAttempt}`;
        const rendered = await this.observationRenderer.render({
          definition: input.definition,
          state: input.state,
          proposal: structuredClone(proposal),
          actions: structuredClone(finalActions),
          observerIds,
          identityOwner: observationIdentityOwner,
          temporalState: observationTemporal,
        }, context.modelScope);
        context.instrumentation.emit({
          event: "algorithm.observation.rendering_completed",
          attributes: { phase: "observation" },
          counts: {
            observationBatches: rendered.batchCount,
            observations: rendered.packets.length,
          },
        });
        return rendered;
      },
      validateProposal: (proposal, _checks, _randomResults, finalActions, stimulus) => {
        const resolvedTemporal = reconcileTemporalOutcomes(scopedTemporalBase, proposal.outcomes);
        const candidate = applyTransitionProposal(scopedState, proposal, resolvedTemporal);
        const observationCandidate = applyTransitionProposal(input.state, proposal, {
          activities: {
            ...structuredClone(temporal.activities),
            ...structuredClone(resolvedTemporal.activities),
          },
          timers: {
            ...structuredClone(temporal.timers),
            ...structuredClone(resolvedTemporal.timers),
          },
        });
        validateObservations(
          observationCandidate,
          [...stimulus, ...proposal.observations],
          observationCandidate.step,
        );
        const observers = new Set(proposal.observations
          .filter((packet) => packet.kind === "outcome")
          .map((packet) => packet.observerId));
        for (const agentId of actorIds) {
          if (!observers.has(agentId)) throw new Error(`component transition omitted observation for ${agentId}`);
        }
        if (finalActions.length !== scopedActions.length) throw new Error("component transition changed action cardinality");
        const continuingActionIds = new Set(Object.values(resolvedTemporal.activities)
          .filter((activity) => activity.status === "active")
          .map((activity) => activity.sourceActionId));
        for (const actionId of continuingActionIds) {
          const outcome = proposal.outcomes.find((entry) => entry.proposalId === actionId);
          if (outcome && outcome.status !== "continuing") {
            throw new Error(`activity action ${actionId} must remain continuing before completion`);
          }
        }
        for (const operation of proposal.operations) {
          if (operation.kind === "advance_time") continue;
          if (operation.causes.some((cause) => cause.kind === "action" && continuingActionIds.has(cause.id))) {
            throw new Error("continuing activity cannot commit semantic completion effects before its boundary");
          }
        }
        for (const event of proposal.events) {
          if (event.causes.some((cause) => cause.kind === "action" && continuingActionIds.has(cause.id))) {
            throw new Error("continuing activity cannot emit completion events before its boundary");
          }
        }
        transitionCandidate = candidate;
      },
    }, context.modelScope);
    if (!transitionCandidate) throw new Error("component TruthEngine returned no candidate");
    return { resolution };
  }

  async prepareStep(input: Readonly<WorldStepInput>, context: ExecutionContext): Promise<WorldStepPreparation> {
    const source = structuredClone(input.state);
    const eligibleAgentIds = [...input.decisionEligibleAgentIds];
    const eligibleAgents = new Set(eligibleAgentIds);
    const resumedAgentIds = Object.entries(input.policyRoster)
      .filter(([agentId, binding]) => eligibleAgents.has(agentId) && binding.kind === "model" &&
        (binding.resumeFromRevision !== undefined || source.agents[agentId]?.nextAction === null))
      .map(([agentId]) => agentId)
      .sort();
    const resumedOutputs = await settledValues(resumedAgentIds.map((agentId) => thinkWithFallback(
      source,
      source.agents[agentId],
      "resume",
      context,
      () => this.agentMind.think(
        source,
        source.agents[agentId],
        pendingObservationsFor(source, source.agents[agentId]),
        context.modelScope,
        { action: null, outcome: null },
        [],
        "resume",
      ),
    )), "AgentMind policy resume");
    const preparedActions = new Map(resumedAgentIds.map((agentId, index) => [
      agentId,
      resumedOutputs[index].nextAction,
    ]));
    const newActions = collectActions(input, preparedActions, eligibleAgentIds);
    const [initialTemporalPlanning, newDependencyResults] = await Promise.all([
      settledValues(newActions.map((action) => planTemporalActivity(
        this.provider,
        source,
        action,
        context.modelScope,
        input.definition.modelProfiles.resolution,
      )), "temporal planning"),
      settledValues(newActions.map((action) => generateInteractionDependency(
        this.provider,
        source,
        action,
        context.modelScope,
        input.definition.modelProfiles.grounding,
      )), "action onset grounding"),
    ]);
    const temporalPlanning = initialTemporalPlanning;
    const planningState = structuredClone(source);
    const interruptionTransitions = newActions.flatMap((action) => Object.values(planningState.truth.activities)
      .filter((activity): activity is ScheduledActivityState => activity.actorId === action.actorId &&
        (activity.status === "active" || activity.status === "paused"))
      .map((activity) => {
        const cancelled = cancelActivity(activity, source.truth.elapsedSeconds);
        planningState.truth.activities[activity.id] = cancelled.activity;
        return cancelled.transition;
      }));
    for (const [index, result] of temporalPlanning.entries()) {
      if (planningState.truth.activities[result.activity.id]) {
        throw new Error(`duplicate activity identity ${result.activity.id}`);
      }
      const dependency = newDependencyResults[index]?.dependency;
      if (!dependency || dependency.id !== result.activity.sourceActionId) {
        throw new Error(`temporal activity ${result.activity.id} has no matching onset grounding`);
      }
      result.activity.interactionFootprint = interactionDependencyForActivity(
        source,
        result.activity,
        dependency,
      );
      if (evaluateActivityContinuation(source, result.activity).some((entry) => !entry.passed)) {
        throw new Error(`temporal activity ${result.activity.id} starts with a failed continuation assertion`);
      }
      planningState.truth.activities[result.activity.id] = structuredClone(result.activity);
    }
    validateActivityResources(
      planningState.truth.activities,
      planningState.truth.mechanics.activityResources,
    );
    const reactionCandidates = collectOnsetReactionCandidates({
      state: source,
      planningState,
      actions: newActions,
      dependencies: newDependencyResults.map((result) => result.dependency),
    });
    const requiresPerceptionCheck = reactionCandidates.some((candidate) =>
      reactionBasis(source, candidate.trigger, candidate.agentId, { requests: [], checks: [] }).length === 0);
    const onsetPerception = requiresPerceptionCheck
      ? await this.truthEngine.perceiveOnset({
          definition: input.definition,
          state: source,
          actions: structuredClone(newActions),
          temporalBoundary: selectTemporalBoundary({
            elapsedSeconds: source.truth.elapsedSeconds,
            maxAutonomousSpanSeconds: input.definition.runtimeDefaults.maxAutonomousSpanSeconds,
            activities: planningState.truth.activities,
            timers: planningState.truth.timers,
            conditionExpiries: Object.fromEntries(Object.values(planningState.truth.conditions)
              .filter((condition) => condition.expiresAtElapsedSeconds !== null)
              .map((condition) => [condition.id, condition.expiresAtElapsedSeconds!])),
          }),
          identityOwner: "action-onset-perception",
          groundings: newDependencyResults.map((result) => structuredClone(result.dependency)),
        }, context.modelScope)
      : null;
    const onsetPerceptionTranscript = onsetPerception ?? {
      requests: [],
      checks: [],
      commitmentRounds: [],
      rng: structuredClone(source.truth.rng),
    };
    const reactionRequests = materializeOnsetReactionRequests(
      source,
      reactionCandidates,
      onsetPerceptionTranscript,
    );
    validateObservations(source, reactionRequests.map((request) => request.stimulus), source.step + 1);
    const reactionResults = await settledValues(reactionRequests.map(async (request) => {
      const policy = input.policyRoster[request.agentId];
      if (!policy) throw new Error(`reaction request ${request.id} has no policy`);
      if (policy.kind === "external") return null;
      if (policy.kind === "idle") {
        return { decision: fallbackReactionDecision(planningState, request), audit: null };
      }
      if (policy.kind === "replay") {
        return { decision: fallbackReactionDecision(planningState, request, "replay"), audit: null };
      }
      const agent = applyObservationBindings(planningState.agents[request.agentId], [request.stimulus]);
      const originalAction = originalActionForReaction(planningState, newActions, request);
      try {
        const output = await this.agentMind.react(
          planningState,
          agent,
          originalAction,
          request,
          context.modelScope,
        );
        const { modelAudit, ...decision } = output;
        return { decision, audit: modelAudit };
      } catch (error) {
        if (!(error instanceof ModelSemanticRepairError) || !error.audit) throw error;
        context.instrumentation.emit({
          event: "algorithm.agent_reaction.repair_fallback",
          level: "warn",
          correlation: { ...context.modelScope.correlation, modelSubject: request.agentId },
          attributes: { phase: "reaction", policy: "temporal-profile-fallback" },
          counts: { reactionFallbacks: 1 },
          error: { name: error.name, message: error.message },
        });
        return {
          decision: fallbackReactionDecision(planningState, request),
          audit: error.audit,
        };
      }
    }), "action-onset reactions");
    const preparedReactionDecisions = reactionResults.flatMap((result) => result ? [result.decision] : []);
    const pendingReactionRequests = reactionRequests.filter((request) =>
      !preparedReactionDecisions.some((decision) => decision.requestId === request.id));
    const payload: EagerStepPreparationPayload = {
      resumedAgentIds: structuredClone(resumedAgentIds),
      resumedOutputs: structuredClone(resumedOutputs),
      newActions: structuredClone(newActions),
      temporalPlanning: structuredClone(temporalPlanning),
      dependencyResults: structuredClone(newDependencyResults),
      planningState: structuredClone(planningState),
      interruptionTransitions: structuredClone(interruptionTransitions),
      reactionRequests: structuredClone(reactionRequests),
      onsetPerception: {
        requests: structuredClone(onsetPerceptionTranscript.requests),
        checks: structuredClone(onsetPerceptionTranscript.checks),
        commitmentRounds: structuredClone(onsetPerceptionTranscript.commitmentRounds),
        rng: structuredClone(onsetPerceptionTranscript.rng),
      },
    };
    return {
      schemaVersion: WORLD_STEP_PREPARATION_SCHEMA_VERSION,
      id: runtimeId({
        worldHash: source.worldHash,
        revision: source.revision,
        kind: "step-preparation",
        stage: "eager-reference",
        owner: context.modelScope.batchId,
        round: 0,
        ordinal: 0,
      }),
      sourceStateHash: contentHash(source),
      algorithmManifestHash: this.manifest.hash,
      policyRosterHash: contentHash(input.policyRoster),
      requestHash: contentHash(input.request),
      pendingReactionRequests: structuredClone(pendingReactionRequests),
      preparedReactionDecisions: structuredClone(preparedReactionDecisions),
      modelAudits: [
        ...resumedOutputs.map((output) => structuredClone(output.modelAudit)),
        ...temporalPlanning.map((result) => structuredClone(result.audit)),
        ...newDependencyResults.map((result) => structuredClone(result.audit)),
        ...(onsetPerception ? [structuredClone(onsetPerception.modelAudit)] : []),
        ...reactionResults.flatMap((result) => result?.audit ? [structuredClone(result.audit)] : []),
      ],
      payload: structuredClone(payload) as unknown as JsonObject,
    };
  }

  async completeStep(
    input: Readonly<WorldStepInput>,
    preparation: Readonly<WorldStepPreparation>,
    reactions: readonly ExternalReactionInput[],
    context: ExecutionContext,
  ): Promise<WorldStepCandidate> {
    const source = structuredClone(input.state);
    if (preparation.schemaVersion !== WORLD_STEP_PREPARATION_SCHEMA_VERSION ||
      preparation.sourceStateHash !== contentHash(source) ||
      preparation.algorithmManifestHash !== this.manifest.hash ||
      preparation.policyRosterHash !== contentHash(input.policyRoster) ||
      preparation.requestHash !== contentHash(input.request)) {
      throw new StepPreparationInvalidatedError();
    }
    const payload = eagerPreparationPayload(preparation);
    const pendingById = new Map(preparation.pendingReactionRequests.map((request) => [request.id, request]));
    if (new Set(reactions.map((reaction) => reaction.requestId)).size !== reactions.length ||
      reactions.some((reaction) => !pendingById.has(reaction.requestId))) {
      throw new Error("external reactions do not match the pending preparation requests");
    }
    const suppliedById = new Map(reactions.map((reaction) => [reaction.requestId, reaction]));
    const externalDecisions = preparation.pendingReactionRequests.map((request, ordinal) => {
      const supplied = suppliedById.get(request.id);
      return supplied
        ? materializeExternalReaction(source, request, supplied, ordinal)
        : fallbackReactionDecision(payload.planningState, request);
    });
    const reactionDecisions = [
      ...structuredClone(preparation.preparedReactionDecisions),
      ...externalDecisions,
    ].sort((left, right) => left.requestId.localeCompare(right.requestId));
    if (reactionDecisions.length !== payload.reactionRequests.length ||
      new Set(reactionDecisions.map((decision) => decision.requestId)).size !== reactionDecisions.length) {
      throw new Error("reaction decisions do not cover the frozen onset request set");
    }
    const resumedAgentIds = structuredClone(payload.resumedAgentIds);
    const resumedOutputs = structuredClone(payload.resumedOutputs);
    const resumedByAgent = new Map(resumedAgentIds.map((agentId, index) => [agentId, resumedOutputs[index]]));
    let newActions = structuredClone(payload.newActions);
    let temporalPlanning = structuredClone(payload.temporalPlanning);
    let newDependencyResults = structuredClone(payload.dependencyResults);
    const planningState = structuredClone(payload.planningState);
    const interruptionTransitions = structuredClone(payload.interruptionTransitions);
    const reactionDecisionPoints: import("./temporal").DecisionPoint[] = [];
    const reactionActivityIds = new Set<string>();

    for (const decision of reactionDecisions.filter((entry) => entry.kind === "keep")) {
      const request = payload.reactionRequests.find((entry) => entry.id === decision.requestId)!;
      if (request.originalIntent.kind !== "ongoing_activity" ||
        decision.ongoingActivityDisposition === "continue") continue;
      const activity = planningState.truth.activities[request.originalIntent.activityId];
      if (!activity || activity.status !== "active") throw new Error(`reaction ${request.id} cannot settle Activity`);
      const settled = decision.ongoingActivityDisposition === "pause"
        ? pauseActivity(activity, source.truth.elapsedSeconds)
        : cancelActivity(activity, source.truth.elapsedSeconds);
      planningState.truth.activities[activity.id] = settled.activity;
      interruptionTransitions.push(settled.transition);
      reactionDecisionPoints.push({
        agentId: activity.actorId,
        reason: "activity_interrupted",
        activityId: activity.id,
        timerId: null,
      });
      reactionActivityIds.add(activity.id);
    }

    const replacementDecisions = reactionDecisions.filter((decision) => decision.kind === "replace");
    const [replacementPlanning, replacementDependencies] = await Promise.all([
      settledValues(replacementDecisions.map((decision) => planTemporalActivity(
        this.provider,
        planningState,
        decision.replacementAction,
        context.modelScope,
        input.definition.modelProfiles.resolution,
        3,
      )), "reaction temporal planning"),
      settledValues(replacementDecisions.map((decision) => generateInteractionDependency(
        this.provider,
        planningState,
        decision.replacementAction,
        context.modelScope,
        input.definition.modelProfiles.grounding,
        3,
      )), "reaction action grounding"),
    ]);
    for (const [index, decision] of replacementDecisions.entries()) {
      const request = payload.reactionRequests.find((entry) => entry.id === decision.requestId)!;
      const generated = replacementPlanning[index]!;
      const dependency = replacementDependencies[index]!.dependency;
      generated.activity.interactionFootprint = interactionDependencyForActivity(
        planningState,
        generated.activity,
        dependency,
      );
      if (evaluateActivityContinuation(planningState, generated.activity).some((entry) => !entry.passed)) {
        throw new Error(`reaction Activity ${generated.activity.id} starts with a failed continuation assertion`);
      }
      if (request.originalIntent.kind === "prepared_action") {
        const originalActionId = request.originalIntent.actionId;
        const originalActivity = temporalPlanning.find((entry) => entry.plan.actionId === originalActionId)?.activity;
        if (!originalActivity) throw new Error(`reaction ${request.id} has no prepared Activity`);
        delete planningState.truth.activities[originalActivity.id];
        newActions = newActions.filter((action) => action.id !== originalActionId);
        temporalPlanning = temporalPlanning.filter((entry) => entry.plan.actionId !== originalActionId);
        newDependencyResults = newDependencyResults.filter((entry) => entry.dependency.id !== originalActionId);
      } else {
        const originalActivity = planningState.truth.activities[request.originalIntent.activityId];
        if (!originalActivity || originalActivity.status !== "active") {
          throw new Error(`reaction ${request.id} has no active source Activity`);
        }
        const cancelled = cancelActivity(originalActivity, source.truth.elapsedSeconds);
        planningState.truth.activities[originalActivity.id] = cancelled.activity;
        interruptionTransitions.push(cancelled.transition);
        reactionActivityIds.add(originalActivity.id);
      }
      newActions.push(structuredClone(decision.replacementAction));
      temporalPlanning.push(structuredClone(generated));
      newDependencyResults.push(structuredClone(replacementDependencies[index]!));
      planningState.truth.activities[generated.activity.id] = structuredClone(generated.activity);
    }
    newActions.sort((left, right) => left.actorId.localeCompare(right.actorId) || left.id.localeCompare(right.id));
    validateActivityResources(
      planningState.truth.activities,
      planningState.truth.mechanics.activityResources,
    );
    const temporalBoundary = selectTemporalBoundary({
      elapsedSeconds: source.truth.elapsedSeconds,
      maxAutonomousSpanSeconds: input.definition.runtimeDefaults.maxAutonomousSpanSeconds,
      activities: planningState.truth.activities,
      timers: planningState.truth.timers,
      conditionExpiries: Object.fromEntries(Object.values(planningState.truth.conditions)
        .filter((condition) => condition.expiresAtElapsedSeconds !== null)
        .map((condition) => [condition.id, condition.expiresAtElapsedSeconds!])),
    });
    let temporal = advanceTemporalState({
      boundary: temporalBoundary,
      activities: planningState.truth.activities,
      timers: planningState.truth.timers,
    });
    temporal.transitions = [...interruptionTransitions, ...temporal.transitions];
    temporal.decisionPoints = [...new Map([
      ...temporal.decisionPoints,
      ...reactionDecisionPoints,
    ].map((point) => [
      `${point.agentId}:${point.reason}:${point.activityId ?? ""}:${point.timerId ?? ""}`,
      point,
    ])).values()].sort((left, right) => left.agentId.localeCompare(right.agentId));
    const dueActions = temporalBoundary.dueActivityIds.flatMap((activityId) => {
      const activity = planningState.truth.activities[activityId];
      if (!activity) throw new Error(`temporal boundary references unknown activity ${activityId}`);
      return [{ ...structuredClone(activity.sourceAction), baseRevision: source.revision }];
    });
    const dueActivityActors = new Set(dueActions.map((action) => action.actorId));
    const timerDescriptionsByAgent = new Map<AgentId, string[]>();
    for (const timerId of temporalBoundary.dueTimerIds) {
      const timer = planningState.truth.timers[timerId];
      if (!timer) throw new Error(`temporal boundary references unknown Timer ${timerId}`);
      for (const agentId of timer.wakeAgentIds) {
        const descriptions = timerDescriptionsByAgent.get(agentId) ?? [];
        descriptions.push(timer.description);
        timerDescriptionsByAgent.set(agentId, descriptions);
      }
    }
    const timerActions = [...timerDescriptionsByAgent.entries()]
      .filter(([agentId]) => !dueActivityActors.has(agentId))
      .map(([agentId, descriptions], ordinal): AgentActionProposal => ({
        id: runtimeId({
          worldHash: source.worldHash,
          revision: source.revision,
          kind: "action",
          stage: "timer",
          owner: agentId,
          round: 0,
          ordinal,
        }),
        actorId: agentId,
        baseRevision: source.revision,
        rawText: `处理同时到期的世界定时触发：${descriptions.join("；")}`,
        goal: "根据当前世界事实联合结算已到期触发",
        means: null,
        targetIds: [],
      }));
    const timerActionActors = new Set(timerActions.map((action) => action.actorId));
    const adjudicatedNewActions = newActions.filter((action) => !timerActionActors.has(action.actorId));
    let actions = [...new Map([
      ...adjudicatedNewActions,
      ...dueActions,
      ...timerActions,
    ].map((action) => [action.id, action])).values()]
      .sort((left, right) => left.actorId.localeCompare(right.actorId) || left.id.localeCompare(right.id));
    const temporalInputState = structuredClone(planningState);
    temporalInputState.truth.rng = structuredClone(payload.onsetPerception.rng);
    const temporalInput: WorldStepInput = { ...input, state: temporalInputState };
    const newDependencyByAction = new Map(newDependencyResults.map((result) => [
      result.dependency.id,
      result,
    ]));
    const dependencyResults = await settledValues(actions.map((action) => {
      const existing = newDependencyByAction.get(action.id);
      return existing ? Promise.resolve(existing) : generateInteractionDependency(
        this.provider,
        planningState,
        action,
        context.modelScope,
        input.definition.modelProfiles.grounding,
      );
    }), "action grounding");
    const actionDependencies = dependencyResults.map((result) => result.dependency);
    const temporalContextDependencies: InteractionDependency[] = [
      ...temporalBoundary.dueTimerIds.map((timerId) =>
        interactionDependencyForTimer(planningState, planningState.truth.timers[timerId]!)),
      ...temporalBoundary.dueConditionIds.map((conditionId) =>
        interactionDependencyForCondition(planningState, planningState.truth.conditions[conditionId]!)),
    ];
    const actionIds = new Set(actions.map((action) => action.id));
    const affectedActivityIds = new ActivityFootprintIndex(planningState.truth.activities)
      .affectedBy([...actionDependencies, ...temporalContextDependencies])
      .filter((activityId) => {
        const activity = planningState.truth.activities[activityId];
        return Boolean(activity) && activity.status !== "completed" && activity.status !== "blocked" &&
          activity.status !== "failed" && activity.status !== "cancelled" && !actionIds.has(activity.sourceActionId);
      });
    let interactionDependencies = [
      ...actionDependencies,
      ...temporalContextDependencies,
      ...affectedActivityIds.map((activityId) =>
        structuredClone(planningState.truth.activities[activityId]!.interactionFootprint)),
    ].sort((left, right) => left.id.localeCompare(right.id));
    let components = interactionDependencyComponents(interactionDependencies);
    let adjudicatedComponents = components.filter((component) => component.some((interactionId) =>
      actionDependencies.some((dependency) => dependency.id === interactionId)));
    let componentResults: ComponentResolution[] = [];
    let rng = structuredClone(payload.onsetPerception.rng);
    for (const component of adjudicatedComponents) {
      const result = await this.resolveComponent(
        temporalInput,
        actions,
        interactionDependencies,
        component,
        rng,
        context,
        false,
        temporal,
      );
      componentResults.push(result);
      rng = structuredClone(result.resolution.rng);
    }
    let resolutions = componentResults.map((result) => result.resolution);
    const fallbackLaw = input.definition.laws[0];
    if (!fallbackLaw) throw new Error("temporal advancement requires at least one world law");
    let fallback = false;
    if (contentHash(interactionDependencyComponents(interactionDependencies)) !== contentHash(components)) fallback = true;
    for (let left = 0; left < resolutions.length; left += 1) {
      for (let right = left + 1; right < resolutions.length; right += 1) {
        if (resolvedComponentsConflict(source, resolutions[left], resolutions[right])) fallback = true;
      }
    }
    for (const [index, resolution] of resolutions.entries()) {
      const componentDependencies = interactionDependencies.filter((dependency) =>
        adjudicatedComponents[index].includes(dependency.id));
      if (resolutionExceedsDeclaredDependencies(source, resolution, componentDependencies)) fallback = true;
    }
    if (fallback) {
      actions = [...new Map(resolutions.flatMap((entry) => entry.actions)
        .map((action) => [action.id, structuredClone(action)])).values()]
        .sort((left, right) => left.actorId.localeCompare(right.actorId) || left.id.localeCompare(right.id));
      const globalDependencies = interactionDependencies.map((dependency) =>
        forceGlobalInteractionDependency(dependency));
      components = [globalDependencies.map((dependency) => dependency.id).sort()];
      adjudicatedComponents = components;
      componentResults = [await this.resolveComponent(
        temporalInput,
        actions,
        globalDependencies,
        components[0],
        payload.onsetPerception.rng,
        context,
        true,
        temporal,
      )];
      resolutions = componentResults.map((result) => result.resolution);
      interactionDependencies = globalDependencies;
    }
    if (resolutions.length === 0) {
      resolutions = [this.contextOnlyResolution(
        temporalInput,
        temporalBoundary,
        { kind: "law", id: fallbackLaw.id },
      )];
    }
    const resolution = mergeResolutions(
      planningState,
      resolutions,
      temporalBoundary,
      { kind: "law", id: fallbackLaw.id },
    );
    resolution.requests = [
      ...structuredClone(payload.onsetPerception.requests),
      ...resolution.requests,
    ];
    resolution.checks = [
      ...structuredClone(payload.onsetPerception.checks),
      ...resolution.checks,
    ];
    resolution.commitmentRounds = [
      ...structuredClone(payload.onsetPerception.commitmentRounds),
      ...resolution.commitmentRounds,
    ];
    resolution.initialActions = [...new Map([
      ...timerActions,
      ...dueActions,
      ...payload.newActions,
    ].map((action) => [action.actorId, structuredClone(action)])).values()]
      .sort((left, right) => left.actorId.localeCompare(right.actorId) || left.id.localeCompare(right.id));
    resolution.reactionRequests = structuredClone(payload.reactionRequests);
    resolution.reactionDecisions = structuredClone(reactionDecisions);
    resolution.stimulusObservations = payload.reactionRequests.map((request) =>
      structuredClone(request.stimulus));
    temporal = reconcileTemporalOutcomes(temporal, resolution.proposal.outcomes);
    const globalObservationAudits: ModelExecutionAudit[] = [];
    if (components.length > 1) {
      const preview = applyTransitionProposal(planningState, resolution.proposal, temporal);
      const rendered = await this.observationRenderer.render({
        definition: input.definition,
        state: planningState,
        proposal: structuredClone(resolution.proposal),
        actions: structuredClone(resolution.actions),
        observerIds: Object.keys(preview.agents).sort(),
        identityOwner: "step-global-observation",
        temporalState: temporal,
      }, context.modelScope);
      resolution.proposal.observations = structuredClone(rendered.packets);
      globalObservationAudits.push(...structuredClone(rendered.modelAudits));
      context.instrumentation.emit({
        event: "algorithm.observation.global_projection_completed",
        attributes: { phase: "observation", reason: "multiple-conflict-components" },
        counts: {
          observations: rendered.packets.length,
          observationBatches: rendered.batchCount,
          dependencyComponents: components.length,
        },
      });
    }
    let observations = [...resolution.stimulusObservations, ...resolution.proposal.observations];
    const preContextCandidate = applyTransitionProposal(source, resolution.proposal, temporal);
    preContextCandidate.truth.rng = structuredClone(resolution.rng);
    validateObservations(preContextCandidate, observations, preContextCandidate.step);
    const observedAgentIds = new Set(observations.map((observation) => observation.observerId));
    const relevantExternalObservers = new Set(interactionDependencies.flatMap((dependency) =>
      dependency.audienceAgentIds.filter((agentId) =>
        dependency.actorId !== agentId && observedAgentIds.has(agentId))));
    const preserveActiveActivityIds = new Set(reactionDecisions.flatMap((decision) => {
      if (decision.kind !== "keep" || decision.ongoingActivityDisposition !== "continue") return [];
      const request = payload.reactionRequests.find((entry) => entry.id === decision.requestId);
      if (!request) return [];
      if (request.originalIntent.kind === "ongoing_activity") return [request.originalIntent.activityId];
      const preparedActionId = request.originalIntent.actionId;
      const activity = Object.values(temporal.activities).find((entry) =>
        entry.sourceActionId === preparedActionId);
      return activity ? [activity.id] : [];
    }));
    const contextSettlement = settleActivityContexts({
      preTransitionState: planningState,
      state: preContextCandidate,
      temporal,
      activityIds: [...new Set([
        ...affectedActivityIds,
        ...temporalBoundary.dueActivityIds,
        ...reactionActivityIds,
      ])],
      relevantObserverIds: relevantExternalObservers,
      preserveActiveActivityIds,
    });
    temporal = contextSettlement.temporal;
    const activityDispositions = contextSettlement.dispositions;
    const temporallyTerminated = new Set(activityDispositions.flatMap((disposition) => {
      if (disposition.kind !== "block" && disposition.kind !== "fail" && disposition.kind !== "cancel") return [];
      const activity = temporal.activities[disposition.activityId];
      return activity ? [activity.sourceActionId] : [];
    }));
    if (temporallyTerminated.size > 0) {
      const preview = applyTransitionProposal(source, resolution.proposal, temporal);
      const rendered = await this.observationRenderer.render({
        definition: input.definition,
        state: planningState,
        proposal: structuredClone(resolution.proposal),
        actions: structuredClone(resolution.actions),
        observerIds: Object.keys(preview.agents).sort(),
        identityOwner: "step-temporal-disposition-observation",
        temporalState: temporal,
      }, context.modelScope);
      resolution.proposal.observations = structuredClone(rendered.packets);
      globalObservationAudits.push(...structuredClone(rendered.modelAudits));
      observations = [...resolution.stimulusObservations, ...resolution.proposal.observations];
      validateObservations(preview, observations, preview.step);
    }
    const candidate = applyTransitionProposal(source, resolution.proposal, temporal);
    candidate.truth.rng = structuredClone(resolution.rng);
    const postBoundaryDecisionAgents = new Set(temporal.decisionPoints.map((point) => point.agentId));
    const busyAfterBoundary = new Set(Object.values(temporal.activities)
      .filter((activity) => activity.status === "active" || activity.status === "paused")
      .flatMap((activity) => activity.participantAgentIds));
    const modelAgentIds = Object.keys(candidate.agents)
      .filter((agentId) => !source.agents[agentId] ||
        input.policyRoster[agentId]?.kind === "model" &&
        (!busyAfterBoundary.has(agentId) || postBoundaryDecisionAgents.has(agentId)))
      .sort();
    const outputs = await settledValues(modelAgentIds.map((agentId) => {
      let agent = applyObservationBindings(candidate.agents[agentId], observationsFor(observations, agentId));
      const resumed = resumedByAgent.get(agentId);
      if (resumed) {
        agent = applyMindCommit(
          agent,
          resumed,
          source.step,
          [],
          [],
        );
      }
      const action = resolution.actions.find((entry) => entry.actorId === agentId) ?? null;
      const outcome = action
        ? resolution.proposal.outcomes.find((entry) => entry.proposalId === action.id) ?? null
        : null;
      const purpose = source.agents[agentId] ? "mind" : "bootstrap";
      const pendingObservations = pendingObservationsFor(
        candidate,
        agent,
        observationsFor(observations, agentId),
      );
      return thinkWithFallback(candidate, agent, purpose, context, () => this.agentMind.think(
          candidate,
          agent,
          pendingObservations,
          context.modelScope,
          { action, outcome: outcome ? { status: outcome.status } : null },
          resolution.proposal.events,
          purpose,
        ));
    }), "AgentMind");
    const {
      modelAudits: resolutionModelAudits,
      reactionModelAudits,
      ...resolutionCandidate
    } = resolution;
    const finalActionIds = new Set(resolution.actions.map((action) => action.id));
    interactionDependencies = interactionDependencies.filter((dependency) =>
      dependency.kind !== "action" || finalActionIds.has(dependency.id));
    components = interactionDependencyComponents(interactionDependencies);
    return {
      schemaVersion: WORLD_STEP_CANDIDATE_SCHEMA_VERSION,
      sourceStateHash: contentHash(source),
      resolution: resolutionCandidate,
      mindCommits: outputs.map((output, index) => {
        const agentId = modelAgentIds[index];
        const resumed = resumedByAgent.get(agentId);
        return {
          agentId,
          beliefPatch: {
            ...structuredClone(output.beliefPatch),
            operations: [
              ...structuredClone(resumed?.beliefPatch.operations ?? []),
              ...structuredClone(output.beliefPatch.operations),
            ],
          },
          characterPatch: {
            ...structuredClone(output.characterPatch),
            operations: [
              ...structuredClone(resumed?.characterPatch.operations ?? []),
              ...structuredClone(output.characterPatch.operations),
            ],
          },
          nextAction: structuredClone(output.nextAction),
        };
      }),
      modelAudits: [
        ...structuredClone(preparation.modelAudits),
        ...replacementPlanning.map((result) => structuredClone(result.audit)),
        ...replacementDependencies.map((result) => structuredClone(result.audit)),
        ...resolutionModelAudits,
        ...reactionModelAudits,
        ...globalObservationAudits,
        ...outputs.map((output) => output.modelAudit),
      ],
      interactionDependencies: structuredClone(interactionDependencies),
      diagnostics: {
        activatedAgentIds: [...modelAgentIds],
        reusedAgentIds: [],
        mindFallbackAgentIds: outputs.flatMap((output, index) => output.fallback ? [modelAgentIds[index]] : []),
        dependencyComponents: structuredClone(components),
        globalReadjudication: fallback,
      },
      temporalPlans: temporalPlanning.map((result) => structuredClone(result.plan)),
      temporalBoundary: structuredClone(temporalBoundary),
      temporalState: {
        activities: structuredClone(temporal.activities),
        timers: structuredClone(temporal.timers),
      },
      activityTransitions: structuredClone(temporal.transitions),
      activityDispositions: structuredClone(activityDispositions),
      decisionPoints: structuredClone(temporal.decisionPoints),
    };
  }
}
