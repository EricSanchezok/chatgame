import { AgentMind } from "./agent-mind";
import type {
  AlgorithmManifest,
  BootstrapCandidate,
  BootstrapInput,
  ExecutionContext,
  WorldExecutionAlgorithm,
  WorldStepCandidate,
  WorldStepInput,
} from "./execution";
import { validatePublicInformationBoundary } from "./information-boundary";
import type {
  AgentActionProposal,
  ObservationPacket,
  SimulationState,
  TransitionProposal,
} from "./model";
import { contentHash } from "./model-audit";
import type { StructuredModelProvider } from "./model-provider";
import {
  applyObservationBindings,
  applyPlayerObservationBindings,
  ingestPlayerObservations,
  validateObservations,
} from "./observation";
import type { RulePackageRegistry } from "./rule-package";
import { runtimeId } from "./runtime-id";
import { applyTransitionProposal } from "./transaction";
import { TruthEngine } from "./truth-engine";

const truthComponentBody = { id: "truth-staged-current", version: "1", config: {} } as const;
const mindComponentBody = { id: "agent-mind-current", version: "1", config: {} } as const;

const manifestBody = {
  id: "monolithic-current",
  version: "1",
  config: {
    activation: "all-living-agents",
    observation: "eager-full-materialization",
    mindUpdate: "all-agents",
  },
  components: [
    { ...truthComponentBody, hash: contentHash(truthComponentBody) },
    { ...mindComponentBody, hash: contentHash(mindComponentBody) },
  ],
} as const;

export const MONOLITHIC_CURRENT_MANIFEST: AlgorithmManifest = {
  ...manifestBody,
  hash: contentHash(manifestBody),
};

function observationsFor(
  packets: readonly ObservationPacket[],
  observerId: string,
): ObservationPacket[] {
  return packets.filter((packet) => packet.observerId === observerId);
}

function assertObservationCoverage(state: SimulationState, packets: readonly ObservationPacket[]): void {
  const observerIds = new Set(packets
    .filter((packet) => packet.kind === "outcome")
    .map((packet) => packet.observerId));
  if (!observerIds.has("player")) throw new Error("transition must provide an outcome observation for the player");
  for (const agentId of Object.keys(state.agents)) {
    if (!observerIds.has(agentId)) {
      throw new Error(`transition must provide an outcome observation for agent ${agentId}`);
    }
  }
  for (const packet of packets) {
    if (packet.observerId !== "player" && !state.agents[packet.observerId]) {
      throw new Error(`transition observes inactive agent ${packet.observerId}`);
    }
  }
}

function assertActionSnapshot(state: SimulationState, actions: readonly AgentActionProposal[]): void {
  const ids = new Set<string>();
  const actors = new Set<string>();
  for (const action of actions) {
    if (ids.has(action.id)) throw new Error(`duplicate action id ${action.id}`);
    if (actors.has(action.actorId)) throw new Error(`actor ${action.actorId} proposed more than one action`);
    if (action.baseRevision !== state.revision) {
      throw new Error(`action ${action.id} uses revision ${action.baseRevision}; expected ${state.revision}`);
    }
    ids.add(action.id);
    actors.add(action.actorId);
  }
  if (!actors.has("player")) throw new Error("joint action is missing the player");
  for (const agentId of Object.keys(state.agents)) {
    if (!actors.has(agentId)) throw new Error(`joint action is missing agent ${agentId}`);
  }
  if (actions.length !== Object.keys(state.agents).length + 1) {
    throw new Error("joint action contains an unknown actor");
  }
}

function assertStepAdvancesTime(proposal: TransitionProposal): void {
  const advances = proposal.operations.filter((operation) => operation.kind === "advance_time");
  if (advances.length !== 1) throw new Error("every world step must contain exactly one time advance");
}

async function settledValues<T>(promises: readonly Promise<T>[], label: string): Promise<T[]> {
  const settled = await Promise.allSettled(promises);
  const failures = settled.filter((result): result is PromiseRejectedResult => result.status === "rejected");
  if (failures.length > 0) throw new AggregateError(failures.map((failure) => failure.reason), `${label} batch failed`);
  return settled.map((result) => (result as PromiseFulfilledResult<T>).value);
}

function jointActions(state: SimulationState): AgentActionProposal[] {
  const intent = state.player.intent;
  if (!intent || intent.status !== "active") throw new Error("no active player intent");
  const playerAction: AgentActionProposal = {
    id: runtimeId({
      worldHash: state.worldHash,
      revision: state.revision,
      kind: "action",
      stage: "prepared",
      owner: "player",
      round: 0,
      ordinal: 0,
    }),
    actorId: "player",
    baseRevision: state.revision,
    rawText: intent.latestInput.text,
    goal: intent.goal,
    means: intent.latestInput.kind === "goal" && state.step === intent.startedAtStep
      ? null
      : intent.latestInput.text,
    targetIds: [],
  };
  const actions = [playerAction];
  for (const agent of Object.values(state.agents)) {
    if (!agent.nextAction) throw new Error(`agent ${agent.id} has not prepared an action`);
    actions.push(structuredClone(agent.nextAction));
  }
  const canonicalActions = actions.sort((left, right) =>
    left.actorId.localeCompare(right.actorId) || left.id.localeCompare(right.id));
  assertActionSnapshot(state, canonicalActions);
  return canonicalActions;
}

export class MonolithicCurrentAlgorithm implements WorldExecutionAlgorithm {
  readonly manifest = MONOLITHIC_CURRENT_MANIFEST;
  private readonly truthEngine: TruthEngine;
  private readonly agentMind: AgentMind;

  constructor(provider: StructuredModelProvider, rulePackages?: RulePackageRegistry);
  constructor(truthEngine: TruthEngine, agentMind: AgentMind);
  constructor(
    providerOrTruth: StructuredModelProvider | TruthEngine,
    rulesOrMind?: RulePackageRegistry | AgentMind,
  ) {
    if (providerOrTruth instanceof TruthEngine) {
      if (!(rulesOrMind instanceof AgentMind)) throw new Error("monolithic algorithm requires AgentMind");
      this.truthEngine = providerOrTruth;
      this.agentMind = rulesOrMind;
      return;
    }
    this.truthEngine = new TruthEngine(providerOrTruth, { rulePackages: rulesOrMind as RulePackageRegistry | undefined });
    this.agentMind = new AgentMind(providerOrTruth);
  }

  async bootstrap(
    input: Readonly<BootstrapInput>,
    context: ExecutionContext,
  ): Promise<BootstrapCandidate> {
    const source = structuredClone(input.state);
    const agents = Object.values(source.agents);
    context.trace.emit({
      event: "algorithm.activation.completed",
      attributes: { phase: "bootstrap", policy: "all-living-agents" },
      counts: {
        persistentAgents: agents.length,
        eligibleAgents: agents.length,
        activatedAgents: agents.length,
        skippedAgents: 0,
        reusedAgents: 0,
        noopAgents: 0,
      },
    });
    const outputs = await settledValues(agents.map((agent) => this.agentMind.think(
      source,
      agent,
      [],
      context.modelScope,
      { action: null, outcome: null },
      [],
      "bootstrap",
    )), "AgentMind bootstrap");
    context.trace.emit({
      event: "algorithm.candidate.completed",
      attributes: { phase: "bootstrap", dependencyAnalysis: "not-implemented" },
      counts: {
        actions: 0,
        reactions: 0,
        checks: 0,
        randomResults: 0,
        outcomes: 0,
        operations: 0,
        events: 0,
        observations: 0,
        mindCommits: outputs.length,
        updatedAgents: outputs.length,
        observedAgents: 0,
        audienceCardinality: 0,
        footprintCardinality: 0,
        dependencyNodes: 0,
        dependencyEdges: 0,
        dependencyComponents: 0,
        maxDependencyComponent: 0,
        globalFallbacks: 0,
      },
    });
    return {
      sourceStateHash: contentHash(source),
      agentCommits: outputs.map((output, index) => ({
        agentId: agents[index].id,
        beliefPatch: structuredClone(output.beliefPatch),
        characterPatch: structuredClone(output.characterPatch),
        nextAction: structuredClone(output.nextAction),
      })),
      modelAudits: outputs.map((output) => structuredClone(output.modelAudit)),
    };
  }

  async step(
    input: Readonly<WorldStepInput>,
    context: ExecutionContext,
  ): Promise<WorldStepCandidate> {
    const source = structuredClone(input.state);
    const initialActions = jointActions(source);
    context.trace.emit({
      event: "algorithm.activation.completed",
      attributes: { phase: "step", policy: "all-living-agents" },
      counts: {
        persistentAgents: Object.keys(source.agents).length,
        eligibleAgents: Object.keys(source.agents).length,
        activatedAgents: Object.keys(source.agents).length,
        skippedAgents: 0,
        reusedAgents: 0,
        noopAgents: 0,
      },
      payload: { actions: initialActions },
    });
    let transitionCandidate: SimulationState | undefined;
    const resolution = await this.truthEngine.resolve({
      definition: input.definition,
      state: source,
      initialActions,
      resolveReactions: async (requests) => {
        const reactionOutputs = await settledValues(requests.map((request) => {
          const sourceAgent = source.agents[request.agentId];
          const agent = applyObservationBindings(sourceAgent, [request.stimulus]);
          const originalAction = initialActions.find((action) => action.actorId === request.agentId);
          if (!originalAction) throw new Error(`agent ${request.agentId} has no prepared action`);
          return this.agentMind.react(source, agent, originalAction, request.stimulus, context.modelScope);
        }), "Agent reaction");
        return {
          decisions: reactionOutputs.map((output) => output.kind === "keep" ? {
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
          }),
          modelAudits: reactionOutputs.map((output) => output.modelAudit),
        };
      },
      validateProposal: (proposal, _checks, _randomResults, finalActions, stimulusObservations) => {
        assertStepAdvancesTime(proposal);
        validatePublicInformationBoundary(source, finalActions, proposal);
        const candidate = applyTransitionProposal(source, proposal);
        validateObservations(candidate, [...stimulusObservations, ...proposal.observations], candidate.step);
        assertObservationCoverage(candidate, proposal.observations);
        transitionCandidate = candidate;
      },
    }, context.modelScope);
    if (!transitionCandidate) throw new Error("TruthEngine returned without a validated transition");

    const candidate = transitionCandidate as SimulationState;
    candidate.truth.rng = structuredClone(resolution.rng);
    const observations = [...resolution.stimulusObservations, ...resolution.proposal.observations];
    applyPlayerObservationBindings(candidate, observations);
    candidate.player.knowledge = ingestPlayerObservations(candidate, observationsFor(observations, "player"));
    const agents = Object.values(candidate.agents).map((agent) =>
      applyObservationBindings(agent, observationsFor(observations, agent.id)));
    const outputs = await settledValues(agents.map((agent) => {
      const action = resolution.actions.find((candidateAction) => candidateAction.actorId === agent.id) ?? null;
      const outcome = action
        ? resolution.proposal.outcomes.find((candidateOutcome) => candidateOutcome.proposalId === action.id) ?? null
        : null;
      return this.agentMind.think(
        candidate,
        agent,
        observationsFor(observations, agent.id),
        context.modelScope,
        { action, outcome: outcome ? { status: outcome.status } : null },
        resolution.proposal.events,
        source.agents[agent.id] ? "mind" : "bootstrap",
      );
    }), "AgentMind");
    context.trace.emit({
      event: "algorithm.candidate.completed",
      attributes: { phase: "step", dependencyAnalysis: "not-implemented" },
      counts: {
        actions: resolution.actions.length,
        reactions: resolution.reactionDecisions.length,
        checks: resolution.checks.length,
        randomResults: resolution.randomResults.length,
        outcomes: resolution.proposal.outcomes.length,
        operations: resolution.proposal.operations.length,
        events: resolution.proposal.events.length,
        observations: observations.length,
        mindCommits: outputs.length,
        updatedAgents: outputs.length,
        observedAgents: new Set(observations.map((observation) => observation.observerId)).size,
        audienceCardinality: new Set(observations.map((observation) => observation.observerId)).size,
        footprintCardinality: 0,
        dependencyNodes: 0,
        dependencyEdges: 0,
        dependencyComponents: 0,
        maxDependencyComponent: 0,
        globalFallbacks: 0,
      },
    });
    return {
      sourceStateHash: contentHash(source),
      resolution: structuredClone(resolution),
      observations: structuredClone(observations),
      mindCommits: outputs.map((output, index) => ({
        agentId: agents[index].id,
        beliefPatch: structuredClone(output.beliefPatch),
        characterPatch: structuredClone(output.characterPatch),
        nextAction: structuredClone(output.nextAction),
      })),
      modelAudits: [
        ...resolution.modelAudits,
        ...resolution.reactionModelAudits,
        ...outputs.map((output) => output.modelAudit),
      ].map((audit) => structuredClone(audit)),
    };
  }
}
