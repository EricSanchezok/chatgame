import { AgentMind } from "./agent-mind";
import {
  ActivityFootprintIndex,
  interactionDependencyComponents,
  forceGlobalInteractionDependency,
  generateInteractionDependency,
  interactionDependencyForActivity,
  replaceInteractionDependencies,
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
  WorldExecutionAlgorithm,
  WorldStepCandidate,
  WorldStepInput,
} from "./execution";
import { WORLD_STEP_CANDIDATE_SCHEMA_VERSION } from "./execution";
import type { AgentMindOutput } from "./llm-schemas";
import type {
  AgentActionProposal,
  AgentId,
  AgentState,
  ModelExecutionAudit,
  ObservationPacket,
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
import type { RulePackageRegistry } from "./rule-package";
import { runtimeId } from "./runtime-id";
import { applyTransitionProposal } from "./transaction";
import { TruthEngine, type TruthResolution } from "./truth-engine";
import {
  cancelActivity,
  advanceTemporalState,
  reconcileTemporalOutcomes,
  selectTemporalBoundary,
  settleActivityContexts,
  validateActivityResources,
  evaluateActivityContinuation,
  type TemporalAdvanceResult,
  type TemporalBoundary,
} from "./temporal";
import {
  applyTemporalReactionReplacements,
  createTemporalReactionReplacement,
  planTemporalActivity,
  replaceTemporalPlanning,
  type TemporalReactionReplacement,
} from "./temporal-planner";

const groundingComponent = { id: "interaction-grounding", version: "2", config: { repairAttempts: 2 } } as const;
const temporalComponent = { id: "temporal-planner", version: "2", config: { repairAttempts: 2 } } as const;
const truthComponent = { id: "truth-interaction-component", version: "2", config: { fallback: "global" } } as const;
const mindComponent = {
  id: "agent-mind",
  version: "4",
  config: { externalUpdates: false, repairExhaustion: "empty-patch-and-idle-action" },
} as const;
export const EAGER_REFERENCE_MANIFEST = defineAlgorithmManifest({
  id: "eager-reference",
  version: "4",
  config: {
    activation: "decision-eligible-model-agents",
    grounding: "persisted-interaction-footprints",
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

interface ComponentReactionReplacement extends TemporalReactionReplacement {
  dependency: InteractionDependency;
}

interface ComponentResolution {
  resolution: TruthResolution;
  temporalReplacements: ComponentReactionReplacement[];
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

  constructor(provider: StructuredModelProvider, rulePackages?: RulePackageRegistry) {
    this.provider = provider;
    this.truthEngine = new TruthEngine(provider, { rulePackages });
    this.agentMind = new AgentMind(provider);
    this.observationRenderer = new ObservationRenderer(provider);
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
    newActionIds: ReadonlySet<string>,
    freezeReactionRound = false,
  ): Promise<ComponentResolution> {
    const componentDependencies = dependencies.filter((dependency) => interactionIds.includes(dependency.id));
    const actorIds = [...new Set(componentDependencies.flatMap((dependency) =>
      dependency.actorId === null ? [] : [dependency.actorId]))].sort();
    let scopedState = structuredClone(input.state);
    scopedState.truth.rng = structuredClone(rngState);
    scopedState.agents = Object.fromEntries(actorIds.map((agentId) => [agentId, structuredClone(input.state.agents[agentId])]));
    const componentActionIds = new Set(componentDependencies
      .filter((dependency) => dependency.kind === "action")
      .map((dependency) => dependency.id));
    const scopedActions = actions.filter((action) => componentActionIds.has(action.id));
    let scopedDependencies = componentDependencies.map((dependency) => structuredClone(dependency));
    let scopedTemporalBase: TemporalAdvanceResult = {
      ...structuredClone(temporal),
      activities: Object.fromEntries(Object.entries(temporal.activities)
        .filter(([, activity]) => actorIds.includes(activity.actorId))
        .map(([id, activity]) => [id, structuredClone(activity)])),
      timers: Object.fromEntries(Object.entries(temporal.timers)
        .filter(([, timer]) => timer.wakeAgentIds.every((agentId) => actorIds.includes(agentId)))
        .map(([id, timer]) => [id, structuredClone(timer)])),
      transitions: temporal.transitions.filter((transition) => actorIds.includes(transition.actorId))
        .map((transition) => structuredClone(transition)),
      decisionPoints: temporal.decisionPoints.filter((point) => actorIds.includes(point.agentId))
        .map((point) => structuredClone(point)),
    };
    const identityOwner = globalFallback ? "component-global" : `component-${actorIds.join("+")}`;
    let transitionCandidate: SimulationState | undefined;
    const temporalReplacements: ComponentReactionReplacement[] = [];
    const resolution = await this.truthEngine.resolve({
      definition: input.definition,
      state: scopedState,
      initialActions: scopedActions.map((action) => structuredClone(action)),
      temporalBoundary: temporal.boundary,
      identityOwner,
      groundings: scopedDependencies,
      resolveReactions: async (requests) => {
        if (freezeReactionRound) {
          return {
            decisions: requests.map((request) => {
              const original = scopedActions.find((action) => action.actorId === request.agentId);
              if (!original) throw new Error(`frozen reaction Agent ${request.agentId} has no current action`);
              return {
                agentId: request.agentId,
                baseRevision: scopedState.revision,
                originalProposalId: original.id,
                kind: "keep" as const,
              };
            }),
            groundings: [],
            modelAudits: [],
          };
        }
        const continuing = requests.filter((request) => !newActionIds.has(request.sourceActionId));
        const outputs = await settledValues(requests.map((request) => {
          if (continuing.includes(request)) return Promise.resolve(null);
          const agent = applyObservationBindings(scopedState.agents[request.agentId], [request.stimulus]);
          const originalAction = scopedActions.find((action) => action.actorId === request.agentId);
          if (!originalAction) throw new Error(`reaction Agent ${request.agentId} has no prepared action`);
          return this.agentMind.react(scopedState, agent, originalAction, request.stimulus, context.modelScope);
        }), "Agent reaction");
        const reactiveOutputs = outputs.filter((output): output is Exclude<typeof output, null> => output !== null);
        const groundingState = structuredClone(scopedState);
        for (const request of requests) {
          groundingState.agents[request.agentId] = applyObservationBindings(
            groundingState.agents[request.agentId],
            [request.stimulus],
          );
        }
        const replacementActions = reactiveOutputs.flatMap((output) =>
          output.kind === "replace" ? [output.replacementAction] : []);
        const replacementDependencyResults = await settledValues(replacementActions.map((action) =>
          generateInteractionDependency(
            this.provider,
            groundingState,
            action,
            context.modelScope,
            input.definition.modelProfiles.grounding,
            3,
          )), "reaction action grounding");
        const effectiveReplacementDependencies = replacementDependencyResults.map(({ dependency }) =>
          globalFallback ? forceGlobalInteractionDependency(dependency) : structuredClone(dependency));
        const replacementTemporalResults = await settledValues(reactiveOutputs.flatMap((output) =>
          output.kind === "replace" ? [planTemporalActivity(
            this.provider,
            scopedState,
            output.replacementAction,
            context.modelScope,
            input.definition.modelProfiles.resolution,
            3,
          )] : []), "reaction temporal planning");
        let temporalOrdinal = 0;
        for (const output of reactiveOutputs) {
          if (output.kind !== "replace") continue;
          const generated = replacementTemporalResults[temporalOrdinal++]!;
          const originalActivity = Object.values(scopedState.truth.activities)
            .find((activity) => activity.actorId === output.agentId &&
              activity.sourceActionId === output.originalProposalId && activity.status === "active");
          if (!originalActivity) {
            throw new Error(`reaction replacement for ${output.agentId} has no active temporal activity`);
          }
          const temporalReplacement = createTemporalReactionReplacement({
            originalActivity,
            replacementAction: output.replacementAction,
            generated,
            boundary: temporal.boundary,
          });
          const dependency = effectiveReplacementDependencies.find((entry) => entry.actorId === output.agentId);
          if (!dependency) throw new Error(`reaction replacement for ${output.agentId} has no interaction dependency`);
          const applied = applyTemporalReactionReplacements(scopedState, scopedTemporalBase, [temporalReplacement]);
          scopedState = applied.state;
          scopedTemporalBase = applied.temporal;
          temporalReplacements.push({
            ...temporalReplacement,
            dependency: structuredClone(dependency),
          });
        }
        scopedDependencies = replaceInteractionDependencies(scopedDependencies, temporalReplacements);
        return {
          decisions: requests.map((request) => {
            const output = reactiveOutputs.find((candidate) => candidate.agentId === request.agentId);
            if (!output) {
              const original = scopedActions.find((action) => action.actorId === request.agentId);
              if (!original) throw new Error(`reaction Agent ${request.agentId} has no current action`);
              return {
              agentId: request.agentId,
              baseRevision: scopedState.revision,
              originalProposalId: original.id,
              kind: "keep" as const,
              };
            }
            return output.kind === "keep" ? {
            agentId: output.agentId,
            baseRevision: output.baseRevision,
            originalProposalId: output.originalProposalId,
            kind: output.kind,
            } : {
            agentId: output.agentId,
            baseRevision: output.baseRevision,
            originalProposalId: output.originalProposalId,
            kind: output.kind,
            replacementAction: output.replacementAction,
            };
          }),
          groundings: effectiveReplacementDependencies,
          modelAudits: [
            ...reactiveOutputs.map((output) => output.modelAudit),
            ...replacementDependencyResults.map((result) => result.audit),
            ...replacementTemporalResults.map((result) => result.audit),
          ],
        };
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
    return { resolution, temporalReplacements };
  }

  async step(input: Readonly<WorldStepInput>, context: ExecutionContext): Promise<WorldStepCandidate> {
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
    const resumedByAgent = new Map(resumedAgentIds.map((agentId, index) => [agentId, resumedOutputs[index]]));
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
    let temporalPlanning = initialTemporalPlanning;
    let planningState = structuredClone(source);
    const interruptionTransitions = newActions.flatMap((action) => Object.values(planningState.truth.activities)
      .filter((activity) => activity.actorId === action.actorId &&
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
    const newActionIds = new Set(newActions.map((action) => action.id));
    const temporalInput: WorldStepInput = { ...input, state: planningState };
    const newDependencyByAction = new Map(newActions.map((action, index) => [
      action.id,
      newDependencyResults[index]!,
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
    const actionIds = new Set(actions.map((action) => action.id));
    const affectedActivityIds = new ActivityFootprintIndex(planningState.truth.activities)
      .affectedBy(actionDependencies)
      .filter((activityId) => {
        const activity = planningState.truth.activities[activityId];
        return activity?.status === "active" && !actionIds.has(activity.sourceActionId);
      });
    let interactionDependencies = [
      ...actionDependencies,
      ...affectedActivityIds.map((activityId) =>
        structuredClone(planningState.truth.activities[activityId]!.interactionFootprint)),
    ].sort((left, right) => left.id.localeCompare(right.id));
    let components = interactionDependencyComponents(interactionDependencies);
    let componentResults: ComponentResolution[] = [];
    let rng = structuredClone(source.truth.rng);
    for (const component of components) {
      const result = await this.resolveComponent(
        temporalInput,
        actions,
        interactionDependencies,
        component,
        rng,
        context,
        false,
        temporal,
        newActionIds,
      );
      componentResults.push(result);
      rng = structuredClone(result.resolution.rng);
    }
    let temporalReplacements = componentResults.flatMap((result) => result.temporalReplacements);
    interactionDependencies = replaceInteractionDependencies(
      interactionDependencies,
      temporalReplacements,
    );
    let resolutions = componentResults.map((result) => result.resolution);
    let fallback = false;
    if (contentHash(interactionDependencyComponents(interactionDependencies)) !== contentHash(components)) fallback = true;
    for (let left = 0; left < resolutions.length; left += 1) {
      for (let right = left + 1; right < resolutions.length; right += 1) {
        if (resolvedComponentsConflict(source, resolutions[left], resolutions[right])) fallback = true;
      }
    }
    for (const [index, resolution] of resolutions.entries()) {
      const componentDependencies = interactionDependencies.filter((dependency) =>
        components[index].includes(dependency.id));
      if (resolutionExceedsDeclaredDependencies(source, resolution, componentDependencies)) fallback = true;
    }
    if (fallback) {
      actions = [...new Map(resolutions.flatMap((entry) => entry.actions)
        .map((action) => [action.id, structuredClone(action)])).values()]
        .sort((left, right) => left.actorId.localeCompare(right.actorId) || left.id.localeCompare(right.id));
      const globalDependencies = interactionDependencies.map((dependency) =>
        forceGlobalInteractionDependency(dependency));
      components = [globalDependencies.map((dependency) => dependency.id).sort()];
      componentResults = [await this.resolveComponent(
        temporalInput,
        actions,
        globalDependencies,
        components[0],
        source.truth.rng,
        context,
        true,
        temporal,
        new Set(actions.map((action) => action.id)),
        true,
      )];
      resolutions = componentResults.map((result) => result.resolution);
      temporalReplacements = [
        ...temporalReplacements,
        ...componentResults.flatMap((result) => result.temporalReplacements),
      ];
      interactionDependencies = replaceInteractionDependencies(
        globalDependencies,
        temporalReplacements,
      );
    }
    temporalPlanning = replaceTemporalPlanning(temporalPlanning, temporalReplacements);
    const appliedReplacements = applyTemporalReactionReplacements(planningState, temporal, temporalReplacements);
    planningState = appliedReplacements.state;
    temporal = appliedReplacements.temporal;
    const fallbackLaw = input.definition.laws[0];
    if (!fallbackLaw) throw new Error("temporal advancement requires at least one world law");
    const resolution = mergeResolutions(
      planningState,
      resolutions,
      temporalBoundary,
      { kind: "law", id: fallbackLaw.id },
    );
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
    const observations = [...resolution.stimulusObservations, ...resolution.proposal.observations];
    const preContextCandidate = applyTransitionProposal(source, resolution.proposal, temporal);
    preContextCandidate.truth.rng = structuredClone(resolution.rng);
    validateObservations(preContextCandidate, observations, preContextCandidate.step);
    const observedAgentIds = new Set(observations.map((observation) => observation.observerId));
    const relevantExternalObservers = new Set(interactionDependencies.flatMap((dependency) =>
      dependency.audienceAgentIds.filter((agentId) =>
        dependency.actorId !== agentId && observedAgentIds.has(agentId))));
    const contextSettlement = settleActivityContexts({
      state: preContextCandidate,
      temporal,
      activityIds: [...new Set([...affectedActivityIds, ...temporalBoundary.dueActivityIds])],
      relevantObserverIds: relevantExternalObservers,
    });
    temporal = contextSettlement.temporal;
    const activityDispositions = contextSettlement.dispositions;
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
        ...resumedOutputs.map((output) => output.modelAudit),
        ...temporalPlanning.map((result) => result.audit),
        ...dependencyResults.map((result) => result.audit),
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
