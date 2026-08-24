import { AgentMind } from "./agent-mind";
import { validatePublicInformationBoundary } from "./information-boundary";
import { contentHash } from "./model-audit";
import { createHistoryReplayBase } from "./history-replay";
import { applyMindCommit } from "./mind-commit";
import type { ModelExecutionScope } from "./model-provider";
import type {
  AgentActionProposal,
  CommittedStep,
  ObservationPacket,
  SimulationState,
  TransitionProposal,
} from "./model";
import {
  applyObservationBindings,
  applyPlayerObservationBindings,
  ingestPlayerObservations,
  validateObservations,
} from "./observation";
import { applyTransitionProposal, validateSimulationState } from "./transaction";
import { TruthEngine } from "./truth-engine";
import type { WorldDefinition } from "./world-definition";
import { validateWorldDefinition } from "./world-definition";
import { fullRuntimePayload, runtimeEventEmitter, serializeRuntimeError } from "./observability";
import { runtimeId } from "./runtime-id";

export interface WorldStepResult {
  committed: CommittedStep;
  state: SimulationState;
  requiresPlayerDecision: boolean;
}

// A snapshot capability never crosses serialization: only this module can
// register it, the exact content hash detects mutation, and construction
// consumes it once. External/load/restart states therefore always take the
// complete history validator while an unchanged snapshot from a validated
// engine avoids replaying the same ledger immediately before the next step.
const validatedSnapshotHashes = new WeakMap<SimulationState, string>();

function consumeValidatedSnapshot(state: SimulationState): boolean {
  const expectedHash = validatedSnapshotHashes.get(state);
  validatedSnapshotHashes.delete(state);
  return expectedHash !== undefined && expectedHash === contentHash(state);
}

export interface WorldRunResult {
  status: "completed" | "failed" | "awaiting_player" | "step_limit";
  steps: CommittedStep[];
  state: SimulationState;
}

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

export class SimulationEngine {
  private state: SimulationState;

  constructor(
    readonly definition: WorldDefinition,
    private readonly truthEngine: TruthEngine,
    private readonly agentMind: AgentMind,
    initialState: SimulationState = definition.initialState,
  ) {
    validateWorldDefinition(definition);
    if (initialState.worldId !== definition.id) throw new Error("simulation state belongs to another world");
    if (!consumeValidatedSnapshot(initialState)) validateSimulationState(initialState, false, true);
    this.state = structuredClone(initialState);
    this.state.historyBase ??= createHistoryReplayBase(definition.initialState);
  }

  get snapshot(): SimulationState {
    const snapshot = structuredClone(this.state);
    validatedSnapshotHashes.set(snapshot, contentHash(snapshot));
    return snapshot;
  }

  async bootstrapAgents(scope?: ModelExecutionScope): Promise<SimulationState> {
    const source = structuredClone(this.state);
    const executionScope: ModelExecutionScope = {
      ...(scope ?? {
        workloadId: `simulation:${source.worldId}`,
        batchId: `bootstrap:${source.revision}`,
      }),
      runtimeIdentity: { worldHash: source.worldHash, revision: source.revision },
    };
    const startedAt = Date.now();
    const observe = runtimeEventEmitter(executionScope.observer);
    observe?.({
      event: "session.bootstrap.started",
      correlation: executionScope.correlation,
      counts: { agents: Object.keys(source.agents).length },
      hashes: { state: contentHash(source) },
      payload: executionScope.observer
        ? fullRuntimePayload(executionScope.observer, { state: source })
        : undefined,
    });
    try {
      const agents = Object.values(source.agents);
      const outputs = await settledValues(
      agents.map((agent) => this.agentMind.think(
        source,
        agent,
        [],
        executionScope,
        { action: null, outcome: null },
        [],
        "bootstrap",
      )),
      "AgentMind bootstrap",
      );
      observe?.({
        event: "session.bootstrap.agent_batch.completed",
        correlation: executionScope.correlation,
        counts: { agents: agents.length, modelAudits: outputs.length },
        hashes: { outputs: contentHash(outputs) },
      });
      source.bootstrapAgentCommits = outputs.map((output, index) => ({
        agentId: agents[index].id,
        beliefPatch: structuredClone(output.beliefPatch),
        characterPatch: structuredClone(output.characterPatch),
        nextAction: structuredClone(output.nextAction),
      }));
      for (let index = 0; index < agents.length; index += 1) {
        source.agents[agents[index].id] = applyMindCommit(
          agents[index],
          source.bootstrapAgentCommits[index],
          source.step,
          [],
          [],
        );
      }
      source.bootstrapModelAudits = outputs.map((output) => structuredClone(output.modelAudit));
      validateSimulationState(source, true, true);
      this.state = source;
      observe?.({
        event: "session.bootstrap.committed",
        correlation: executionScope.correlation,
        durationMs: Math.max(0, Date.now() - startedAt),
        counts: { agents: agents.length, modelAudits: source.bootstrapModelAudits.length },
        hashes: { state: contentHash(source) },
      });
      return this.snapshot;
    } catch (error) {
      observe?.({
        event: "session.bootstrap.rolled_back",
        level: "error",
        correlation: executionScope.correlation,
        durationMs: Math.max(0, Date.now() - startedAt),
        hashes: { state: contentHash(this.state) },
        error: serializeRuntimeError(error),
      });
      throw error;
    }
  }

  beginPlayerIntent(text: string, inputId?: string): SimulationState {
    const normalized = text.trim();
    if (!normalized) throw new Error("player intent cannot be empty");
    if (this.state.player.intent?.status === "active") {
      throw new Error("a player intent is already active");
    }
    const next = structuredClone(this.state);
    const intentId = inputId ? `intent:${inputId}` : `intent:${next.revision}:${next.step}`;
    next.player.intent = {
      id: intentId,
      goal: normalized,
      inputs: [{
        id: inputId ?? `input:${intentId}:1`,
        text: normalized,
        kind: "goal",
        submittedAtStep: next.step,
      }],
      latestInput: {
        id: inputId ?? `input:${intentId}:1`,
        text: normalized,
        kind: "goal",
        submittedAtStep: next.step,
      },
      status: "active",
      startedAtStep: next.step,
    };
    this.state = next;
    return this.snapshot;
  }

  continuePlayerIntent(text: string, inputId: string): SimulationState {
    const normalized = text.trim();
    if (!normalized) throw new Error("player intent input cannot be empty");
    const intent = this.state.player.intent;
    if (!intent || intent.status !== "active") throw new Error("no active player intent");
    const next = structuredClone(this.state);
    const clarification = {
      id: inputId,
      text: normalized,
      kind: "clarification" as const,
      submittedAtStep: next.step,
    };
    if (next.player.intent!.inputs.some((input) => input.id === inputId)) {
      throw new Error(`player intent input id was already used: ${inputId}`);
    }
    next.player.intent!.inputs.push(clarification);
    next.player.intent!.latestInput = clarification;
    this.state = next;
    return this.snapshot;
  }

  cancelPlayerIntent(): SimulationState {
    if (!this.state.player.intent || this.state.player.intent.status !== "active") return this.snapshot;
    const next = structuredClone(this.state);
    next.player.intent!.status = "cancelled";
    this.state = next;
    return this.snapshot;
  }

  private jointActions(): AgentActionProposal[] {
    const intent = this.state.player.intent;
    if (!intent || intent.status !== "active") throw new Error("no active player intent");
    const playerAction: AgentActionProposal = {
      id: runtimeId({
        worldHash: this.state.worldHash,
        revision: this.state.revision,
        kind: "action",
        stage: "prepared",
        owner: "player",
        round: 0,
        ordinal: 0,
      }),
      actorId: "player",
      baseRevision: this.state.revision,
      rawText: intent.latestInput.text,
      goal: intent.goal,
      means: intent.latestInput.kind === "goal" && this.state.step === intent.startedAtStep
        ? null
        : intent.latestInput.text,
      targetIds: [],
    };
    const actions = [playerAction];
    for (const agent of Object.values(this.state.agents)) {
      if (!agent.nextAction) throw new Error(`agent ${agent.id} has not prepared an action`);
      actions.push(structuredClone(agent.nextAction));
    }
    const canonicalActions = actions.sort((left, right) =>
      left.actorId.localeCompare(right.actorId) || left.id.localeCompare(right.id));
    assertActionSnapshot(this.state, canonicalActions);
    return canonicalActions;
  }

  async step(scope?: ModelExecutionScope): Promise<WorldStepResult> {
    const source = structuredClone(this.state);
    const executionScope: ModelExecutionScope = {
      ...(scope ?? {
        workloadId: `simulation:${source.worldId}`,
        batchId: `step:${source.revision}:${source.step + 1}`,
      }),
      runtimeIdentity: { worldHash: source.worldHash, revision: source.revision },
    };
    const startedAt = Date.now();
    const observe = runtimeEventEmitter(executionScope.observer);
    observe?.({
      event: "step.started",
      correlation: executionScope.correlation,
      attributes: { worldId: source.worldId },
      hashes: { state: contentHash(source) },
      payload: executionScope.observer
        ? fullRuntimePayload(executionScope.observer, { state: source })
        : undefined,
    });
    try {
    const initialActions = this.jointActions();
    observe?.({
      event: "step.joint_actions.generated",
      correlation: executionScope.correlation,
      counts: { actions: initialActions.length, agents: Object.keys(source.agents).length },
      hashes: { jointActions: contentHash(initialActions) },
      payload: executionScope.observer
        ? fullRuntimePayload(executionScope.observer, { actions: initialActions })
        : undefined,
    });
    let transitionCandidate: SimulationState | undefined;
    const resolution = await this.truthEngine.resolve({
      definition: this.definition,
      state: source,
      initialActions,
      resolveReactions: async (requests) => {
        const reactionOutputs = await settledValues(requests.map((request) => {
          const sourceAgent = source.agents[request.agentId];
          const agent = applyObservationBindings(sourceAgent, [request.stimulus]);
          const originalAction = initialActions.find((action) => action.actorId === request.agentId);
          if (!originalAction) throw new Error(`agent ${request.agentId} has no prepared action`);
          return this.agentMind.react(source, agent, originalAction, request.stimulus, executionScope);
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
        validateObservations(
          candidate,
          [...stimulusObservations, ...proposal.observations],
          candidate.step,
        );
        assertObservationCoverage(candidate, proposal.observations);
        transitionCandidate = candidate;
      },
    }, executionScope);
    observe?.({
      event: "step.truth.completed",
      correlation: executionScope.correlation,
      counts: {
        truthAudits: resolution.modelAudits.length,
        reactionAudits: resolution.reactionModelAudits.length,
        checks: resolution.checks.length,
        randomResults: resolution.randomResults.length,
      },
      hashes: { proposal: contentHash(resolution.proposal) },
    });
    if (!transitionCandidate) throw new Error("TruthEngine returned without a validated transition");

    const candidate = transitionCandidate as SimulationState;
    candidate.truth.rng = structuredClone(resolution.rng);
    const observations = [
      ...resolution.stimulusObservations,
      ...resolution.proposal.observations,
    ];
    applyPlayerObservationBindings(candidate, observations);
    candidate.player.knowledge = ingestPlayerObservations(
      candidate,
      observationsFor(observations, "player"),
    );

    const agents = Object.values(candidate.agents).map((agent) =>
      applyObservationBindings(
        agent,
        observationsFor(observations, agent.id),
      ));
    const outputs = await settledValues(
      agents.map((agent) => {
        const action = resolution.actions.find((candidateAction) => candidateAction.actorId === agent.id) ?? null;
        const outcome = action
          ? resolution.proposal.outcomes.find((candidateOutcome) => candidateOutcome.proposalId === action.id) ?? null
          : null;
        return this.agentMind.think(
          candidate,
          agent,
          observationsFor(observations, agent.id),
          executionScope,
          { action, outcome: outcome ? { status: outcome.status } : null },
          resolution.proposal.events,
          source.agents[agent.id] ? "mind" : "bootstrap",
        );
      }),
      "AgentMind",
    );
    observe?.({
      event: "step.agent_mind_batch.completed",
      correlation: executionScope.correlation,
      counts: { agents: agents.length, modelAudits: outputs.length },
      hashes: { patches: contentHash(outputs.map((output) => ({
        beliefPatch: output.beliefPatch,
        characterPatch: output.characterPatch,
      }))) },
    });
    for (let index = 0; index < agents.length; index += 1) {
      candidate.agents[agents[index].id] = applyMindCommit(
        agents[index],
        outputs[index],
        candidate.step,
        observationsFor(observations, agents[index].id),
        resolution.proposal.events,
      );
    }
    candidate.historyBase ??= createHistoryReplayBase(source);
    validateSimulationState(candidate, true);

    const committedPayload: Omit<CommittedStep, "contentHash"> = {
      baseRevision: source.revision,
      revision: candidate.revision,
      step: candidate.step,
      initialActions: structuredClone(resolution.initialActions),
      reactionRequests: structuredClone(resolution.reactionRequests),
      reactionDecisions: structuredClone(resolution.reactionDecisions),
      actions: structuredClone(resolution.actions),
      rngBefore: structuredClone(source.truth.rng),
      rngAfter: structuredClone(candidate.truth.rng),
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
      observations: structuredClone(observations),
      operations: structuredClone(resolution.proposal.operations),
      playerIntent: structuredClone(source.player.intent!),
      intentStatus: resolution.proposal.intentStatus,
      requiresPlayerDecision: resolution.proposal.requiresPlayerDecision,
      beliefPatches: outputs.map((output) => structuredClone(output.beliefPatch)),
      characterPatches: outputs.map((output) => structuredClone(output.characterPatch)),
      nextActions: outputs.map((output) => structuredClone(output.nextAction)),
      modelAudits: [
        ...resolution.modelAudits.map((audit) => structuredClone(audit)),
        ...resolution.reactionModelAudits.map((audit) => structuredClone(audit)),
        ...outputs.map((output) => structuredClone(output.modelAudit)),
      ],
    };
    const committed: CommittedStep = {
      contentHash: contentHash(committedPayload),
      ...committedPayload,
    };
    candidate.history.push(committed);
    // Even when the constructor receives a history already validated by the
    // persistence boundary, every newly materialized commit is fully replayed
    // before it can leave the engine.
    validateSimulationState(candidate, true, true);
    this.state = candidate;
    const result = {
      committed: structuredClone(committed),
      state: this.snapshot,
      requiresPlayerDecision: resolution.proposal.requiresPlayerDecision,
    };
    observe?.({
      event: "step.committed",
      correlation: {
        ...executionScope.correlation,
        revision: candidate.revision,
        step: candidate.step,
      },
      durationMs: Math.max(0, Date.now() - startedAt),
      counts: { modelAudits: committed.modelAudits.length },
      hashes: { committedStep: committed.contentHash, state: contentHash(candidate) },
      payload: executionScope.observer
        ? fullRuntimePayload(executionScope.observer, { state: candidate })
        : undefined,
    });
    return result;
    } catch (error) {
      observe?.({
        event: "step.rolled_back",
        level: "error",
        correlation: executionScope.correlation,
        durationMs: Math.max(0, Date.now() - startedAt),
        attributes: { result: "rolled_back" },
        hashes: { state: contentHash(this.state) },
        error: serializeRuntimeError(error),
      });
      throw error;
    }
  }

  async runUntilBoundary(
    maxSteps = 100,
    onStep?: (result: WorldStepResult) => void | Promise<void>,
    scope?: ModelExecutionScope,
  ): Promise<WorldRunResult> {
    if (!Number.isSafeInteger(maxSteps) || maxSteps <= 0) throw new Error("maxSteps must be positive");
    const steps: CommittedStep[] = [];
    for (let index = 0; index < maxSteps; index += 1) {
      const result = await this.step(scope);
      steps.push(result.committed);
      await onStep?.(result);
      const status = this.state.player.intent?.status;
      if (result.requiresPlayerDecision) {
        return { status: "awaiting_player", steps, state: this.snapshot };
      }
      if (status === "completed") return { status: "completed", steps, state: this.snapshot };
      if (status === "failed" || status === "cancelled") {
        return { status: "failed", steps, state: this.snapshot };
      }
    }
    return { status: "step_limit", steps, state: this.snapshot };
  }
}
