import { AgentMind } from "./agent-mind";
import { applyBeliefPatch } from "./belief";
import type { AgentMindOutput } from "./llm-schemas";
import type {
  AgentActionProposal,
  AgentState,
  BeliefPatch,
  CommittedStep,
  ObservationPacket,
  SimulationState,
  TransitionProposal,
} from "./model";
import {
  applyObservationBindings,
  ingestPlayerObservations,
  validateObservations,
} from "./observation";
import { applyTransitionProposal, validateSimulationState } from "./transaction";
import { TruthEngine } from "./truth-engine";
import type { WorldDefinition } from "./world-definition";
import { validateWorldDefinition } from "./world-definition";

export interface WorldStepResult {
  committed: CommittedStep;
  state: SimulationState;
  requiresPlayerDecision: boolean;
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

function mergeBindingsForPatch(agent: AgentState, patch: BeliefPatch): AgentState {
  const next = structuredClone(agent);
  for (const operation of patch.operations) {
    if (operation.kind === "remove_local_entity") {
      delete next.bindings[operation.localEntityId];
      continue;
    }
    if (operation.kind !== "merge_local_entities" || operation.fromId === operation.intoId) continue;
    const from = next.bindings[operation.fromId];
    const into = next.bindings[operation.intoId];
    if (from || into) {
      next.bindings[operation.intoId] = {
        localEntityId: operation.intoId,
        canonicalEntityIds: [...new Set([
          ...(into?.canonicalEntityIds ?? []),
          ...(from?.canonicalEntityIds ?? []),
        ])],
      };
    }
    delete next.bindings[operation.fromId];
  }
  return next;
}

function applyMindOutput(agent: AgentState, output: AgentMindOutput): AgentState {
  const withBindings = mergeBindingsForPatch(agent, output.beliefPatch);
  return {
    ...withBindings,
    belief: applyBeliefPatch(withBindings.belief, output.beliefPatch),
    nextAction: structuredClone(output.nextAction),
  };
}

function applyPlayerBindings(
  state: SimulationState,
  packets: readonly ObservationPacket[],
): void {
  for (const packet of packets) {
    if (packet.observerId !== "player") continue;
    for (const introduction of packet.introductions) {
      if (!introduction.canonicalEntityId) continue;
      const current = state.player.bindings[introduction.localEntity.id];
      state.player.bindings[introduction.localEntity.id] = {
        localEntityId: introduction.localEntity.id,
        canonicalEntityIds: [...new Set([
          ...(current?.canonicalEntityIds ?? []),
          introduction.canonicalEntityId,
        ])],
      };
    }
  }
}

function assertObservationCoverage(state: SimulationState, packets: readonly ObservationPacket[]): void {
  const observerIds = new Set(packets.map((packet) => packet.observerId));
  if (!observerIds.has("player")) throw new Error("transition must observe the player");
  for (const agentId of Object.keys(state.agents)) {
    if (!observerIds.has(agentId)) throw new Error(`transition must observe agent ${agentId}`);
  }
  for (const observerId of observerIds) {
    if (observerId !== "player" && !state.agents[observerId]) {
      throw new Error(`transition observes inactive agent ${observerId}`);
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

export class SimulationEngine {
  private state: SimulationState;

  constructor(
    readonly definition: WorldDefinition,
    private readonly truthEngine: TruthEngine,
    private readonly agentMind: AgentMind,
    initialState: SimulationState = definition.initialState,
  ) {
    validateWorldDefinition(definition);
    validateSimulationState(initialState, false);
    this.state = structuredClone(initialState);
  }

  get snapshot(): SimulationState {
    return structuredClone(this.state);
  }

  async bootstrapAgents(): Promise<SimulationState> {
    const source = structuredClone(this.state);
    const agents = Object.values(source.agents);
    const outputs = await Promise.all(
      agents.map((agent) => this.agentMind.think(agent, source.revision, source.step, [])),
    );
    for (let index = 0; index < agents.length; index += 1) {
      source.agents[agents[index].id] = applyMindOutput(agents[index], outputs[index]);
    }
    validateSimulationState(source, true);
    this.state = source;
    return this.snapshot;
  }

  beginPlayerIntent(text: string): SimulationState {
    const normalized = text.trim();
    if (!normalized) throw new Error("player intent cannot be empty");
    if (this.state.player.intent?.status === "active") {
      throw new Error("a player intent is already active");
    }
    const next = structuredClone(this.state);
    next.player.intent = {
      id: `intent:${next.revision}:${next.step}`,
      rawText: normalized,
      goal: normalized,
      status: "active",
      startedAtStep: next.step,
    };
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
      id: `player-action:${intent.id}:${this.state.step + 1}`,
      actorId: "player",
      baseRevision: this.state.revision,
      rawText: intent.rawText,
      goal: intent.goal,
      means: this.state.step === intent.startedAtStep ? undefined : "继续此前已经开始的目标",
      targetIds: [],
    };
    const actions = [playerAction];
    for (const agent of Object.values(this.state.agents)) {
      if (!agent.nextAction) throw new Error(`agent ${agent.id} has not prepared an action`);
      actions.push(structuredClone(agent.nextAction));
    }
    assertActionSnapshot(this.state, actions);
    return actions;
  }

  async step(): Promise<WorldStepResult> {
    const source = structuredClone(this.state);
    const actions = this.jointActions();
    let transitionCandidate: SimulationState | undefined;
    const resolution = await this.truthEngine.resolve({
      definition: this.definition,
      state: source,
      actions,
      validateProposal: (proposal) => {
        assertStepAdvancesTime(proposal);
        const candidate = applyTransitionProposal(source, proposal);
        validateObservations(candidate, proposal.observations, candidate.step);
        assertObservationCoverage(candidate, proposal.observations);
        transitionCandidate = candidate;
      },
    });
    if (!transitionCandidate) throw new Error("TruthEngine returned without a validated transition");

    const candidate = transitionCandidate as SimulationState;
    candidate.rng = structuredClone(resolution.rng);
    applyPlayerBindings(candidate, resolution.proposal.observations);
    candidate.player.knowledge = ingestPlayerObservations(
      candidate.player.knowledge,
      observationsFor(resolution.proposal.observations, "player"),
    );

    const agents = Object.values(candidate.agents).map((agent) =>
      applyObservationBindings(
        agent,
        observationsFor(resolution.proposal.observations, agent.id),
      ));
    const outputs = await Promise.all(
      agents.map((agent) =>
        this.agentMind.think(
          agent,
          candidate.revision,
          candidate.step,
          observationsFor(resolution.proposal.observations, agent.id),
        )),
    );
    for (let index = 0; index < agents.length; index += 1) {
      candidate.agents[agents[index].id] = applyMindOutput(agents[index], outputs[index]);
    }
    validateSimulationState(candidate, true);

    const committed: CommittedStep = {
      baseRevision: source.revision,
      revision: candidate.revision,
      step: candidate.step,
      actions: structuredClone(actions),
      checks: structuredClone(resolution.checks),
      outcomes: structuredClone(resolution.proposal.outcomes),
      events: structuredClone(resolution.proposal.events),
      observations: structuredClone(resolution.proposal.observations),
      operations: structuredClone(resolution.proposal.operations),
      beliefPatches: outputs.map((output) => structuredClone(output.beliefPatch)),
    };
    candidate.history.push(committed);
    this.state = candidate;
    return {
      committed: structuredClone(committed),
      state: this.snapshot,
      requiresPlayerDecision: resolution.proposal.requiresPlayerDecision,
    };
  }

  async runUntilBoundary(
    maxSteps = 100,
    onStep?: (result: WorldStepResult) => void | Promise<void>,
  ): Promise<WorldRunResult> {
    if (!Number.isSafeInteger(maxSteps) || maxSteps <= 0) throw new Error("maxSteps must be positive");
    const steps: CommittedStep[] = [];
    for (let index = 0; index < maxSteps; index += 1) {
      const result = await this.step();
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
