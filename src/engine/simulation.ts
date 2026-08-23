import { AgentMind } from "./agent-mind";
import { applyBeliefPatch } from "./belief";
import { applyCharacterPatch } from "./character";
import { validatePublicInformationBoundary } from "./information-boundary";
import { contentHash } from "./model-audit";
import type { AgentMindOutput } from "./llm-schemas";
import type { ModelExecutionScope } from "./model-provider";
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
import {
  fullRuntimePayload,
  runtimeEventEmitter,
  serializeRuntimeError,
} from "./observability";

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
    if (operation.kind === "split_local_entity") {
      const source = next.bindings[operation.fromId];
      if (source) {
        for (const entity of operation.entities) {
          next.bindings[entity.id] = {
            localEntityId: entity.id,
            canonicalEntityIds: [...source.canonicalEntityIds],
          };
        }
      }
      delete next.bindings[operation.fromId];
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

function applyMindOutput(
  agent: AgentState,
  output: AgentMindOutput,
  step: number,
  observations: readonly ObservationPacket[],
  events: TransitionProposal["events"],
): AgentState {
  const withBindings = mergeBindingsForPatch(agent, output.beliefPatch);
  const belief = applyBeliefPatch(withBindings.belief, output.beliefPatch);
  return {
    ...withBindings,
    belief,
    character: applyCharacterPatch(
      withBindings.character,
      belief,
      output.characterPatch,
      step,
      observations,
      events,
    ),
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
    validateSimulationState(initialState, false, true);
    this.state = structuredClone(initialState);
  }

  get snapshot(): SimulationState {
    return structuredClone(this.state);
  }

  async bootstrapAgents(scope?: ModelExecutionScope): Promise<SimulationState> {
    const source = structuredClone(this.state);
    const executionScope = scope ?? {
      workloadId: `simulation:${source.worldId}`,
      batchId: `bootstrap:${source.revision}`,
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
      const batchStartedAt = Date.now();
      const outputs = await settledValues(
        agents.map((agent) => this.agentMind.think(source, agent, [], executionScope)),
        "AgentMind bootstrap",
      );
      observe?.({
        event: "session.bootstrap.agent_batch.completed",
        correlation: executionScope.correlation,
        durationMs: Math.max(0, Date.now() - batchStartedAt),
        counts: { agents: agents.length, modelAudits: outputs.length },
        hashes: { outputs: contentHash(outputs) },
        payload: executionScope.observer
          ? fullRuntimePayload(executionScope.observer, {
              beliefPatches: outputs.map((output) => output.beliefPatch),
              characterPatches: outputs.map((output) => output.characterPatch),
              nextActions: outputs.map((output) => output.nextAction),
            })
          : undefined,
      });
      for (let index = 0; index < agents.length; index += 1) {
        source.agents[agents[index].id] = applyMindOutput(
          agents[index],
          outputs[index],
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
        payload: executionScope.observer
          ? fullRuntimePayload(executionScope.observer, { state: source })
          : undefined,
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
      means: this.state.step === intent.startedAtStep ? null : "继续此前已经开始的目标",
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
    const executionScope = scope ?? {
      workloadId: `simulation:${source.worldId}`,
      batchId: `step:${source.revision}:${source.step + 1}`,
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
      const actionsStartedAt = Date.now();
      const initialActions = this.jointActions();
      observe?.({
        event: "step.joint_actions.generated",
        correlation: executionScope.correlation,
        durationMs: Math.max(0, Date.now() - actionsStartedAt),
        counts: { actions: initialActions.length, agents: Object.keys(source.agents).length },
        hashes: { jointActions: contentHash(initialActions) },
        payload: executionScope.observer
          ? fullRuntimePayload(executionScope.observer, { actions: initialActions })
          : undefined,
      });
      let transitionCandidate: SimulationState | undefined;
      const truthStartedAt = Date.now();
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
        validateProposal: (proposal, _checks, finalActions, stimulusObservations) => {
          const transitionStartedAt = Date.now();
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
          observe?.({
            event: "step.transition.validated_and_applied",
            correlation: executionScope.correlation,
            durationMs: Math.max(0, Date.now() - transitionStartedAt),
            counts: {
              operations: proposal.operations.length,
              outcomes: proposal.outcomes.length,
              events: proposal.events.length,
              observations: proposal.observations.length,
            },
            hashes: { transition: contentHash(proposal), candidateState: contentHash(candidate) },
            payload: executionScope.observer
              ? fullRuntimePayload(executionScope.observer, { transition: proposal })
              : undefined,
          });
        },
      }, executionScope);
      observe?.({
        event: "step.truth.completed",
        correlation: executionScope.correlation,
        durationMs: Math.max(0, Date.now() - truthStartedAt),
        counts: {
          truthInvocations: resolution.modelAudit.invocations.length,
          reactionAudits: resolution.reactionModelAudits.length,
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
      observe?.({
        event: "step.checks_and_reactions.resolved",
        correlation: executionScope.correlation,
        counts: {
          checkRequests: resolution.requests.length,
          checks: resolution.checks.length,
          reactionRequests: resolution.reactionRequests.length,
          reactionDecisions: resolution.reactionDecisions.length,
        },
        hashes: {
          checks: contentHash(resolution.checks),
          reactions: contentHash(resolution.reactionDecisions),
        },
        payload: executionScope.observer
          ? fullRuntimePayload(executionScope.observer, {
              checkRequests: resolution.requests,
              checks: resolution.checks,
              reactionRequests: resolution.reactionRequests,
              reactionDecisions: resolution.reactionDecisions,
            })
          : undefined,
      });
      const knowledgeStartedAt = Date.now();
      applyPlayerBindings(candidate, observations);
      candidate.player.knowledge = ingestPlayerObservations(
        candidate.player.knowledge,
        observationsFor(observations, "player"),
      );
      observe?.({
        event: "step.player_knowledge.updated",
        correlation: executionScope.correlation,
        durationMs: Math.max(0, Date.now() - knowledgeStartedAt),
        counts: {
          localEntities: Object.keys(candidate.player.knowledge.localEntities).length,
          beliefs: Object.keys(candidate.player.knowledge.claims).length,
          evidence: Object.keys(candidate.player.knowledge.evidence).length,
        },
        hashes: { playerKnowledge: contentHash(candidate.player.knowledge) },
        payload: executionScope.observer
          ? fullRuntimePayload(executionScope.observer, { playerKnowledge: candidate.player.knowledge })
          : undefined,
      });

      const agents = Object.values(candidate.agents).map((agent) =>
        applyObservationBindings(
          agent,
          observationsFor(observations, agent.id),
        ));
      const agentBatchStartedAt = Date.now();
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
            { action, outcome: outcome ? { status: outcome.status, summary: outcome.summary } : null },
            resolution.proposal.events,
          );
        }),
        "AgentMind",
      );
      observe?.({
        event: "step.agent_mind_batch.completed",
        correlation: executionScope.correlation,
        durationMs: Math.max(0, Date.now() - agentBatchStartedAt),
        counts: { agents: agents.length, modelAudits: outputs.length },
        hashes: { patches: contentHash(outputs.map((output) => ({
          beliefPatch: output.beliefPatch,
          characterPatch: output.characterPatch,
        }))) },
        payload: executionScope.observer
          ? fullRuntimePayload(executionScope.observer, {
              beliefPatches: outputs.map((output) => output.beliefPatch),
              characterPatches: outputs.map((output) => output.characterPatch),
            })
          : undefined,
      });
      for (let index = 0; index < agents.length; index += 1) {
        candidate.agents[agents[index].id] = applyMindOutput(
          agents[index],
          outputs[index],
          candidate.step,
          observationsFor(observations, agents[index].id),
          resolution.proposal.events,
        );
      }
      const candidateValidationStartedAt = Date.now();
      validateSimulationState(candidate, true);
      observe?.({
        event: "step.candidate_state.validated",
        correlation: executionScope.correlation,
        durationMs: Math.max(0, Date.now() - candidateValidationStartedAt),
        hashes: { candidateState: contentHash(candidate) },
      });

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
        outcomes: structuredClone(resolution.proposal.outcomes),
        events: structuredClone(resolution.proposal.events),
        observations: structuredClone(observations),
        operations: structuredClone(resolution.proposal.operations),
        beliefPatches: outputs.map((output) => structuredClone(output.beliefPatch)),
        characterPatches: outputs.map((output) => structuredClone(output.characterPatch)),
        modelAudits: [
          structuredClone(resolution.modelAudit),
          ...resolution.reactionModelAudits.map((audit) => structuredClone(audit)),
          ...outputs.map((output) => structuredClone(output.modelAudit)),
        ],
      };
      const committed: CommittedStep = {
        contentHash: contentHash(committedPayload),
        ...committedPayload,
      };
      candidate.history.push(committed);
      const historyValidationStartedAt = Date.now();
      validateSimulationState(candidate, true, true);
      observe?.({
        event: "step.history.validated",
        correlation: executionScope.correlation,
        durationMs: Math.max(0, Date.now() - historyValidationStartedAt),
        counts: { history: candidate.history.length, modelAudits: committed.modelAudits.length },
        hashes: { committedStep: committed.contentHash, state: contentHash(candidate) },
      });
      this.state = candidate;
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
      return {
        committed: structuredClone(committed),
        state: this.snapshot,
        requiresPlayerDecision: resolution.proposal.requiresPlayerDecision,
      };
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
