import type {
  BootstrapCandidate,
  ExecutionRef,
  WorldStepCandidate,
} from "./execution";
import { validatePublicInformationBoundary } from "./information-boundary";
import { createHistoryReplayBase } from "./history-replay";
import { applyMindCommit } from "./mind-commit";
import type {
  AgentActionProposal,
  CommittedStep,
  ObservationPacket,
  SimulationState,
} from "./model";
import { contentHash } from "./model-audit";
import {
  applyObservationBindings,
  applyPlayerObservationBindings,
  ingestPlayerObservations,
  validateObservations,
} from "./observation";
import { applyTransitionProposal, validateSimulationState } from "./transaction";

export function semanticStepHash(step: Readonly<CommittedStep>): string {
  const semantic = structuredClone(step) as Partial<CommittedStep>;
  delete semantic.contentHash;
  delete semantic.semanticHash;
  delete semantic.executionRef;
  return contentHash(semantic);
}

export function attachExecutionRef(
  state: Readonly<SimulationState>,
  reference: Readonly<ExecutionRef>,
  phase: "bootstrap" | "step",
): SimulationState {
  const finalized = structuredClone(state) as SimulationState;
  if (phase === "bootstrap") {
    if (finalized.history.length !== 0) throw new Error("bootstrap execution reference cannot attach after a step");
    finalized.bootstrapExecutionRef = structuredClone(reference);
  } else {
    const committed = finalized.history.at(-1);
    if (!committed) throw new Error("step execution reference requires a committed step");
    committed.executionRef = structuredClone(reference);
    const payload = { ...committed } as Partial<CommittedStep>;
    delete payload.contentHash;
    committed.contentHash = contentHash(payload);
  }
  validateSimulationState(finalized, true, true);
  return finalized;
}

function observationsFor(packets: readonly ObservationPacket[], observerId: string): ObservationPacket[] {
  return packets.filter((packet) => packet.observerId === observerId);
}

function validateCandidateBoundary(
  source: SimulationState,
  actions: readonly AgentActionProposal[],
  candidate: WorldStepCandidate,
  transitioned: SimulationState,
): void {
  if (candidate.sourceStateHash !== contentHash(source)) throw new Error("execution candidate uses another source state");
  const advances = candidate.resolution.proposal.operations.filter((operation) => operation.kind === "advance_time");
  if (advances.length !== 1) throw new Error("every world step must contain exactly one time advance");
  validatePublicInformationBoundary(source, actions, candidate.resolution.proposal);
  validateObservations(transitioned, candidate.observations, transitioned.step);
  const outcomeObservers = new Set(candidate.resolution.proposal.observations
    .filter((packet) => packet.kind === "outcome")
    .map((packet) => packet.observerId));
  if (!outcomeObservers.has("player")) throw new Error("transition must provide an outcome observation for the player");
  for (const agentId of Object.keys(transitioned.agents)) {
    if (!outcomeObservers.has(agentId)) throw new Error(`transition must provide an outcome observation for agent ${agentId}`);
  }
}

export class CanonicalCommitter {
  bootstrap(sourceState: Readonly<SimulationState>, candidate: Readonly<BootstrapCandidate>): SimulationState {
    const source = structuredClone(sourceState) as SimulationState;
    if (candidate.sourceStateHash !== contentHash(source)) throw new Error("bootstrap candidate uses another source state");
    const commits = candidate.agentCommits.map((commit) => structuredClone(commit))
      .sort((left, right) => left.agentId.localeCompare(right.agentId));
    const expectedAgents = Object.keys(source.agents).sort((left, right) => left.localeCompare(right));
    const committedAgents = commits.map((commit) => commit.agentId);
    if (contentHash(expectedAgents) !== contentHash(committedAgents)) {
      throw new Error("bootstrap candidate does not update every agent exactly once");
    }
    source.bootstrapAgentCommits = commits.map((commit) => ({
      agentId: commit.agentId,
      beliefPatch: structuredClone(commit.beliefPatch),
      characterPatch: structuredClone(commit.characterPatch),
      nextAction: structuredClone(commit.nextAction),
    }));
    for (const commit of source.bootstrapAgentCommits) {
      source.agents[commit.agentId] = applyMindCommit(
        source.agents[commit.agentId],
        commit,
        source.step,
        [],
        [],
      );
    }
    validateSimulationState(source, true, true);
    return source;
  }

  step(sourceState: Readonly<SimulationState>, candidateInput: Readonly<WorldStepCandidate>): {
    committed: CommittedStep;
    state: SimulationState;
  } {
    const source = structuredClone(sourceState) as SimulationState;
    const candidate = structuredClone(candidateInput);
    const mindCommits = candidate.mindCommits
      .sort((left, right) => left.agentId.localeCompare(right.agentId));
    const resolution = candidate.resolution;
    const transitioned = applyTransitionProposal(source, resolution.proposal);
    validateCandidateBoundary(source, resolution.actions, candidate, transitioned);
    transitioned.truth.rng = structuredClone(resolution.rng);
    applyPlayerObservationBindings(transitioned, candidate.observations);
    transitioned.player.knowledge = ingestPlayerObservations(
      transitioned,
      observationsFor(candidate.observations, "player"),
    );
    const expectedAgents = Object.keys(transitioned.agents).sort((left, right) => left.localeCompare(right));
    const committedAgents = mindCommits.map((commit) => commit.agentId);
    if (contentHash(expectedAgents) !== contentHash(committedAgents)) {
      throw new Error("step candidate does not update every agent exactly once");
    }
    for (const commit of mindCommits) {
      const observed = observationsFor(candidate.observations, commit.agentId);
      const agent = applyObservationBindings(transitioned.agents[commit.agentId], observed);
      transitioned.agents[commit.agentId] = applyMindCommit(
        agent,
        commit,
        transitioned.step,
        observed,
        resolution.proposal.events,
      );
    }
    transitioned.historyBase ??= createHistoryReplayBase(source);
    validateSimulationState(transitioned, true);
    const semanticPayload: Omit<CommittedStep, "contentHash" | "semanticHash"> = {
      baseRevision: source.revision,
      revision: transitioned.revision,
      step: transitioned.step,
      initialActions: structuredClone(resolution.initialActions),
      reactionRequests: structuredClone(resolution.reactionRequests),
      reactionDecisions: structuredClone(resolution.reactionDecisions),
      actions: structuredClone(resolution.actions),
      rngBefore: structuredClone(source.truth.rng),
      rngAfter: structuredClone(transitioned.truth.rng),
      checkRequests: structuredClone(resolution.requests),
      checks: structuredClone(resolution.checks),
      randomRequests: structuredClone(resolution.randomRequests),
      randomResults: structuredClone(resolution.randomResults),
      commitmentRounds: structuredClone(resolution.commitmentRounds),
      outcomes: structuredClone(resolution.proposal.outcomes),
      mechanicInvocations: structuredClone(resolution.proposal.mechanicInvocations),
      mechanicResults: structuredClone(resolution.mechanicResults),
      causalAssertionResults: structuredClone(resolution.causalAssertionResults),
      causalVerification: structuredClone(resolution.causalVerification),
      events: structuredClone(resolution.proposal.events),
      observations: structuredClone(candidate.observations),
      operations: structuredClone(resolution.proposal.operations),
      playerIntent: structuredClone(source.player.intent!),
      intentStatus: resolution.proposal.intentStatus,
      requiresPlayerDecision: resolution.proposal.requiresPlayerDecision,
      beliefPatches: mindCommits.map((commit) => structuredClone(commit.beliefPatch)),
      characterPatches: mindCommits.map((commit) => structuredClone(commit.characterPatch)),
      nextActions: mindCommits.map((commit) => structuredClone(commit.nextAction)),
    };
    const committedPayload: Omit<CommittedStep, "contentHash"> = {
      semanticHash: contentHash(semanticPayload),
      ...semanticPayload,
    };
    const committed: CommittedStep = { contentHash: contentHash(committedPayload), ...committedPayload };
    transitioned.history.push(committed);
    validateSimulationState(transitioned, true, true);
    return { committed: structuredClone(committed), state: transitioned };
  }
}
