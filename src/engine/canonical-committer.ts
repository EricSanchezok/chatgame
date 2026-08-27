import type {
  BootstrapCandidate,
  ExecutionRef,
  PolicyBinding,
  WorldStepCandidate,
} from "./execution";
import { validatePublicInformationBoundary } from "./information-boundary";
import { createHistoryReplayBase } from "./history-replay";
import { applyMindCommit } from "./mind-commit";
import type {
  AgentAdmissionCommit,
  AgentActionProposal,
  AgentState,
  CommittedStep,
  ObservationPacket,
  MeterState,
  QuantityState,
  RatingState,
  SimulationState,
  WorldEntity,
} from "./model";
import { contentHash } from "./model-audit";
import {
  applyObservationBindings,
  validateObservations,
} from "./observation";
import { applyAdmissionCommit, applyTransitionProposal, validateSimulationState } from "./transaction";

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
  phase: "bootstrap" | "step" | "admission",
): SimulationState {
  const finalized = structuredClone(state) as SimulationState;
  if (phase === "bootstrap") {
    if (finalized.history.length !== 0) throw new Error("bootstrap execution reference cannot attach after a step");
    finalized.bootstrapExecutionRef = structuredClone(reference);
  } else if (phase === "step") {
    const committed = finalized.history.at(-1);
    if (!committed) throw new Error("step execution reference requires a committed step");
    committed.executionRef = structuredClone(reference);
    const payload = { ...committed } as Partial<CommittedStep>;
    delete payload.contentHash;
    committed.contentHash = contentHash(payload);
  } else {
    const admission = finalized.admissions.at(-1);
    if (!admission) throw new Error("admission execution reference requires an admission commit");
    admission.executionRef = structuredClone(reference);
    const payload = { ...admission } as Partial<AgentAdmissionCommit>;
    delete payload.contentHash;
    admission.contentHash = contentHash(payload);
  }
  validateSimulationState(finalized, false, true);
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
  for (const agentId of Object.keys(transitioned.agents)) {
    if (!outcomeObservers.has(agentId)) throw new Error(`transition must provide an outcome observation for agent ${agentId}`);
  }
}

export class CanonicalCommitter {
  admit(sourceState: Readonly<SimulationState>, candidate: Readonly<{
    entity: WorldEntity;
    placementId: string | null;
    agent: AgentState;
    meters: MeterState[];
    quantities: QuantityState[];
    ratings: RatingState[];
    conditions: import("./resolution").ConditionState[];
  }>): { committed: AgentAdmissionCommit; state: SimulationState } {
    const source = structuredClone(sourceState) as SimulationState;
    const semantic = {
      baseRevision: source.revision,
      revision: source.revision + 1,
      step: source.step,
      entity: structuredClone(candidate.entity),
      placementId: candidate.placementId,
      agent: structuredClone(candidate.agent),
      meters: structuredClone(candidate.meters),
      quantities: structuredClone(candidate.quantities),
      ratings: structuredClone(candidate.ratings),
      conditions: structuredClone(candidate.conditions),
      invalidatedActionIds: Object.values(source.agents)
        .flatMap((agent) => agent.nextAction ? [agent.nextAction.id] : [])
        .sort(),
    };
    const committed: AgentAdmissionCommit = {
      contentHash: "",
      semanticHash: contentHash(semantic),
      ...semantic,
    };
    const payload = { ...committed } as Partial<AgentAdmissionCommit>;
    delete payload.contentHash;
    committed.contentHash = contentHash(payload);
    applyAdmissionCommit(source, committed);
    validateSimulationState(source, false, true);
    return { committed: structuredClone(committed), state: source };
  }

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

  step(
    sourceState: Readonly<SimulationState>,
    candidateInput: Readonly<WorldStepCandidate>,
    policyRoster: Readonly<Record<string, PolicyBinding>>,
  ): {
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
    for (const agentId of Object.keys(transitioned.agents)) {
      transitioned.agents[agentId] = applyObservationBindings(
        transitioned.agents[agentId],
        observationsFor(candidate.observations, agentId),
      );
    }
    const expectedAgents = Object.keys(transitioned.agents)
      .filter((agentId) => !source.agents[agentId] || policyRoster[agentId]?.kind === "model")
      .sort((left, right) => left.localeCompare(right));
    const committedAgents = mindCommits.map((commit) => commit.agentId);
    if (contentHash(expectedAgents) !== contentHash(committedAgents)) {
      throw new Error("step candidate does not update every agent exactly once");
    }
    for (const commit of mindCommits) {
      const observed = observationsFor(candidate.observations, commit.agentId);
      transitioned.agents[commit.agentId] = applyMindCommit(
        transitioned.agents[commit.agentId],
        commit,
        transitioned.step,
        observed,
        resolution.proposal.events,
      );
    }
    transitioned.historyBase ??= createHistoryReplayBase(source);
    validateSimulationState(transitioned, false);
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
      resolutionPlans: [],
      resolutionReceipts: [],
      temporalPlans: [],
      temporalBoundary: {
        fromElapsedSeconds: source.truth.elapsedSeconds,
        toElapsedSeconds: transitioned.truth.elapsedSeconds,
        deltaSeconds: transitioned.truth.elapsedSeconds - source.truth.elapsedSeconds,
        reasons: [{ kind: "safety_horizon" }],
        dueActivityIds: [],
        dueTimerIds: [],
        dueConditionIds: [],
      },
      activityTransitions: [],
      decisionPoints: [],
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
      decisionRequests: structuredClone(resolution.proposal.decisionRequests),
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
    validateSimulationState(transitioned, false, true);
    return { committed: structuredClone(committed), state: transitioned };
  }
}
