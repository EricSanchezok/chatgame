import { applyBeliefPatch } from "../../cognition/belief";
import { applyCharacterPatch } from "../../cognition/character";
import {
  agentMindBatchOutputSchema,
  reactionDecisionDraftSchema,
  type AgentMindDraftOutput,
  type AgentMindOutput,
  type ReactionDecisionDraft,
} from "../../contracts/llm-schemas";
import type {
  AgentActionProposal,
  AgentState,
  BeliefPatchOperation,
  ModelExecutionAudit,
  ObservationPacket,
  ReactionDecision,
  ReactionRequest,
  SimulationState,
  WorldEvent,
} from "../../contracts/model";
import {
  eagerRequestBytes,
  eagerSlotBatchOwner,
  EagerSlotAttemptError,
  isTerminalEagerModelError,
  runEagerSlotBatches,
  type EagerSlot,
  type EagerSlotBatchMetrics,
} from "./eager-slot-batching";
import {
  modelInvocationCorrelation,
  modelInvocationIdentity,
  ModelSemanticRepairError,
  setModelInvocationOutcome,
  setModelInvocationResultKind,
  type ModelExecutionScope,
  type StructuredModelProvider,
} from "../../models/model-provider";
import { contentHash } from "../../models/model-audit";
import { fullRuntimePayload, runtimeEventEmitter, serializeRuntimeError } from "../../runtime/observability";
import {
  buildAgentSharedContext,
  buildAgentSlotContext,
  buildReactionContext,
  sanitizeObservationForAgent,
  validationIssues,
  type PromptValidationIssue,
} from "../../contracts/prompts";
import { promptBundle } from "../../prompts";
import { runtimeId } from "../../runtime/runtime-id";
import {
  SemanticRepairExhaustedError,
  runSemanticRepairLoop,
  semanticIssue,
} from "../../models/semantic-repair";

function assertBeliefIdentityHistory(
  state: SimulationState,
  agent: AgentState,
  output: AgentMindDraftOutput,
): void {
  const usedLocalIds = new Set([
    ...Object.keys(state.historyBase?.agents[agent.id]?.belief.localEntities ?? {}),
    ...Object.keys(agent.belief.localEntities),
  ]);
  const claimBindings = new Map(Object.values(state.historyBase?.agents[agent.id]?.belief.claims ?? {})
    .map((claim) => [claim.id, `${claim.subjectId}\u0000${claim.predicate}`]));
  for (const claim of Object.values(agent.belief.claims))
    claimBindings.set(claim.id, `${claim.subjectId}\u0000${claim.predicate}`);
  for (const commit of state.bootstrapAgentCommits) {
    if (commit.agentId !== agent.id) continue;
    for (const operation of commit.beliefPatch.operations) {
      if (operation.kind === "upsert_local_entity") usedLocalIds.add(operation.entity.id);
      if (operation.kind === "split_local_entity") {
        for (const entity of operation.entities) usedLocalIds.add(entity.id);
      }
      if (operation.kind === "upsert_claim") {
        claimBindings.set(operation.claim.id, `${operation.claim.subjectId}\u0000${operation.claim.predicate}`);
      }
    }
  }
  for (const step of state.history) {
    for (const operation of step.operations) {
      if (operation.kind === "create_agent" && operation.agent.id === agent.id) {
        for (const id of Object.keys(operation.agent.belief.localEntities)) usedLocalIds.add(id);
      }
    }
    for (const observation of step.observations) {
      if (observation.observerId !== agent.id) continue;
      for (const introduction of observation.introductions) usedLocalIds.add(introduction.localEntity.id);
    }
    for (const patch of step.beliefPatches) {
      if (patch.agentId !== agent.id) continue;
      for (const operation of patch.operations) {
        if (operation.kind === "upsert_local_entity") usedLocalIds.add(operation.entity.id);
        if (operation.kind === "split_local_entity") {
          for (const entity of operation.entities) usedLocalIds.add(entity.id);
        }
        if (operation.kind === "upsert_claim") {
          claimBindings.set(operation.claim.id, `${operation.claim.subjectId}\u0000${operation.claim.predicate}`);
        }
      }
    }
  }
  const activeLocalIds = new Set(Object.keys(agent.belief.localEntities));
  for (const operation of output.beliefPatch.operations) {
    if (operation.kind === "upsert_local_entity") {
      if (!activeLocalIds.has(operation.entity.id) && usedLocalIds.has(operation.entity.id)) {
        throw new Error(`AgentMind ${agent.id} reuses retired local identity ${operation.entity.id}`);
      }
      activeLocalIds.add(operation.entity.id);
      usedLocalIds.add(operation.entity.id);
    } else if (operation.kind === "remove_local_entity") {
      activeLocalIds.delete(operation.localEntityId);
    } else if (operation.kind === "merge_local_entities") {
      activeLocalIds.delete(operation.fromId);
    } else if (operation.kind === "split_local_entity") {
      activeLocalIds.delete(operation.fromId);
      for (const entity of operation.entities) {
        if (usedLocalIds.has(entity.id)) {
          throw new Error(`AgentMind ${agent.id} reuses retired local identity ${entity.id}`);
        }
        activeLocalIds.add(entity.id);
        usedLocalIds.add(entity.id);
      }
    } else if (operation.kind === "upsert_claim") {
      const binding = `${operation.claim.subjectId}\u0000${operation.claim.predicate}`;
      if (claimBindings.has(operation.claim.id) && claimBindings.get(operation.claim.id) !== binding) {
        throw new Error(`AgentMind ${agent.id} rebinds claim ${operation.claim.id}`);
      }
      claimBindings.set(operation.claim.id, binding);
    }
  }
}

function validateMindOutput(
  agent: AgentState,
  state: SimulationState,
  observations: readonly ObservationPacket[],
  events: readonly WorldEvent[],
  output: AgentMindDraftOutput,
): AgentMindOutput {
  const { revision, step, worldHash } = state;
  assertBeliefIdentityHistory(state, agent, output);
  const beliefPatch = {
    agentId: agent.id,
    baseRevision: revision,
    operations: output.beliefPatch.operations.map((operation): BeliefPatchOperation =>
      operation.kind === "upsert_evidence"
        ? {
            ...structuredClone(operation),
            evidence: { ...structuredClone(operation.evidence), step },
          }
        : structuredClone(operation)),
  };
  const characterPatch = {
    agentId: agent.id,
    baseRevision: revision,
    operations: structuredClone(output.characterPatch.operations),
  };
  const belief = applyBeliefPatch(agent.belief, beliefPatch);
  // Local identity is an Agent-owned namespace. A model may describe a
  // canonical entity, but it must choose a distinct local alias (for example
  // `守门人` rather than canonical entity id `keeper`). Catch collisions here
  // so the slot can be repaired before a candidate reaches canonical commit.
  for (const localEntityId of Object.keys(belief.localEntities)) {
    if (state.truth.entities[localEntityId]) {
      throw new Error(`AgentMind ${agent.id} local entity ${localEntityId} collides with canonical entity id; choose a local alias`);
    }
  }
  applyCharacterPatch(agent.character, belief, characterPatch, step, observations, events);
  for (const targetId of output.nextAction.targetIds) {
    if (!belief.localEntities[targetId]) {
      throw new Error(`AgentMind ${agent.id} targeted unknown local entity ${targetId}`);
    }
  }
  return {
    beliefPatch,
    characterPatch,
    nextAction: {
      ...output.nextAction,
      id: runtimeId({
        worldHash,
        revision,
        kind: "action",
        stage: "prepared",
        owner: agent.id,
        round: 0,
        ordinal: 0,
      }),
      actorId: agent.id,
      baseRevision: revision,
    },
  };
}

function validateReactionDecision(
  worldHash: string,
  agent: AgentState,
  revision: number,
  originalAction: AgentActionProposal,
  request: ReactionRequest,
  decision: ReactionDecisionDraft,
): ReactionDecision {
  const stimulus = request.stimulus;
  if (decision.kind === "keep") {
    return {
      requestId: request.id,
      source: "model",
      agentId: agent.id,
      baseRevision: revision,
      originalProposalId: originalAction.id,
      kind: "keep",
      ongoingActivityDisposition: "continue",
    };
  }

  const replacement = decision.replacementAction;
  const allowedTargets = new Set([
    ...Object.keys(agent.belief.localEntities),
    ...stimulus.introductions.map((introduction) => introduction.localEntity.id),
  ]);
  for (const targetId of replacement.targetIds) {
    if (!allowedTargets.has(targetId)) {
      throw new Error(`Agent reaction ${agent.id} targeted unknown local entity ${targetId}`);
    }
  }
  return {
    requestId: request.id,
    source: "model",
    agentId: agent.id,
    baseRevision: revision,
    originalProposalId: originalAction.id,
    kind: "replace",
    replacementAction: {
      ...replacement,
      id: runtimeId({
        worldHash,
        revision,
        kind: "action",
        stage: "reaction",
        owner: agent.id,
        round: 0,
        ordinal: 0,
      }),
      actorId: agent.id,
      baseRevision: revision,
    },
  };
}

export interface AgentMindBatchInput {
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

export interface AgentMindBatchResult {
  outputs: Map<string, AgentMindOutput>;
  failures: Array<{ agentId: string; error: unknown }>;
  modelAudits: ModelExecutionAudit[];
  batchCount: number;
  metrics: EagerSlotBatchMetrics;
}

type AgentMindSlot = EagerSlot<AgentMindBatchInput, PromptValidationIssue>;

function agentMindBatchContext(
  state: SimulationState,
  scope: ModelExecutionScope,
  purpose: "bootstrap" | "mind" | "resume",
  slots: readonly AgentMindSlot[],
) {
  return {
    ...buildAgentSharedContext({
      state,
      instanceId: scope.workloadId,
      advanceId: scope.batchId,
      promptId: purpose === "bootstrap" ? "agent-bootstrap" : "agent-mind",
    }),
    purpose,
    slots: slots.map((slot, index) => ({
      slot: index,
      ...buildAgentSlotContext({
        state,
        agent: slot.payload.agent,
        observations: slot.payload.observations,
        events: slot.payload.events,
        currentAction: slot.payload.currentResolution.action,
        currentOutcome: slot.payload.currentResolution.outcome,
        issues: slot.issues,
      }),
    })),
  };
}

function assertAgentMindSlotCoverage(
  slots: readonly AgentMindSlot[],
  drafts: readonly { slot: number }[],
): void {
  if (drafts.length !== slots.length) {
    throw new Error(`AgentMind returned ${drafts.length} items for ${slots.length} slots`);
  }
  const indexes = drafts.map((draft) => draft.slot).sort((left, right) => left - right);
  if (indexes.some((slot, index) => slot !== index)) {
    throw new Error("AgentMind did not cover every slot exactly once");
  }
}

export class AgentMind {
  constructor(
    private readonly provider: StructuredModelProvider,
    private readonly repairAttempts = 2,
  ) {}

  async thinkBatch(
    state: SimulationState,
    inputs: readonly AgentMindBatchInput[],
    scope: ModelExecutionScope,
    purpose: "bootstrap" | "mind" | "resume" = "mind",
    maxSlots = 1,
  ): Promise<AgentMindBatchResult> {
    if (inputs.length === 0) {
      return {
        outputs: new Map(),
        failures: [],
        modelAudits: [],
        batchCount: 0,
        metrics: { submittedSlots: 0, repairCalls: 0, splitCount: 0, partialFailureSlots: 0, singletonFailures: 0 },
      };
    }
    const ids = inputs.map((input) => input.agent.id);
    if (new Set(ids).size !== ids.length) throw new Error("AgentMind batch contains duplicate Agents");
    const observe = runtimeEventEmitter(scope.observer);
    const role = purpose === "bootstrap" ? "agent-bootstrap" : "agent-mind";
    const prompt = promptBundle(role);
    const groups = new Map<string, AgentMindSlot[]>();
    for (const input of [...inputs].sort((left, right) => left.agent.id.localeCompare(right.agent.id))) {
      const profileId = purpose === "bootstrap" ? input.agent.modelProfiles.bootstrap : input.agent.modelProfiles.mind;
      const group = groups.get(profileId) ?? [];
      group.push({ key: input.agent.id, payload: input, issues: [] });
      groups.set(profileId, group);
    }
    const groupResults = await Promise.all([...groups.entries()].sort(([left], [right]) => left.localeCompare(right))
      .map(async ([profileId, slots]) => runEagerSlotBatches({
        slots,
        maxSlots,
        maxInputBytes: this.provider.catalog.profile(profileId).max_input_bytes,
        requestBytes: (batch) => eagerRequestBytes(
          prompt.system,
          prompt.userPrompt,
          agentMindBatchContext(state, scope, purpose, batch),
          agentMindBatchOutputSchema,
        ),
        label: `AgentMind ${purpose}`,
        issuesForError: (error) => validationIssues(error),
        maxRepairs: this.repairAttempts,
        invoke: async (batch, attempt) => {
          const owner = eagerSlotBatchOwner(`agent-mind-${purpose}`, batch);
          const identity = modelInvocationIdentity(scope, role, owner, attempt + 1);
          const correlation = modelInvocationCorrelation(scope, role, owner, identity);
          let generated;
          try {
            const contextStartedAt = Date.now();
            const context = agentMindBatchContext(state, scope, purpose, batch);
            observe?.({
              event: "model.context.built",
              correlation,
              durationMs: Math.max(0, Date.now() - contextStartedAt),
              hashes: { context: contentHash(context) },
            });
            generated = await this.provider.generateStructured({
              profileId,
              workloadId: scope.workloadId,
              batchId: scope.batchId,
              abortSignal: scope.abortSignal,
              correlation: scope.correlation,
              observer: scope.observer,
              ...identity,
              role,
              subjectId: owner,
              promptVersion: prompt.version,
              schemaName: "agent_mind_batch_output",
              system: prompt.system,
              userPrompt: prompt.userPrompt,
              context,
              schema: agentMindBatchOutputSchema,
            });
            assertAgentMindSlotCoverage(batch, generated.value.slots);
          } catch (error) {
            if (isTerminalEagerModelError(error)) throw error;
            const audit = error && typeof error === "object" && "audit" in error
              ? (error as { audit?: ModelExecutionAudit }).audit
              : generated?.audit;
            const issues = validationIssues(error);
            if (audit?.invocations.length) {
              setModelInvocationOutcome(audit, "rejected", issues.map((issue) => issue.code));
            }
            observe?.({
              event: "model.semantic.rejected",
              level: "warn",
              correlation,
              attributes: { resultKind: `agent_mind_${purpose}_batch` },
              counts: { validationIssues: issues.length },
              payload: scope.observer ? fullRuntimePayload(scope.observer, { issues }) : undefined,
              error: serializeRuntimeError(error),
            });
            throw new EagerSlotAttemptError(
              error instanceof Error ? error.message : String(error),
              audit,
              { cause: error },
            );
          }

          const accepted: Array<{ key: string; result: AgentMindOutput }> = [];
          const rejected: Array<{ slot: AgentMindSlot; issues: PromptValidationIssue[] }> = [];
          const ordered = [...generated.value.slots].sort((left, right) => left.slot - right.slot);
          for (const [index, draft] of ordered.entries()) {
            const slot = batch[index]!;
            try {
              accepted.push({
                key: slot.key,
                result: validateMindOutput(
                  slot.payload.agent,
                  state,
                  slot.payload.observations,
                  slot.payload.events,
                  draft,
                ),
              });
            } catch (error) {
              rejected.push({ slot, issues: validationIssues(error) });
            }
          }
          setModelInvocationResultKind(generated.audit, `agent_mind_${purpose}_batch`);
          if (rejected.length === 0) {
            setModelInvocationOutcome(generated.audit, "accepted");
            observe?.({
              event: "model.semantic.accepted",
              correlation,
              attributes: { resultKind: `agent_mind_${purpose}_batch` },
              hashes: { response: generated.audit.invocations.at(-1)!.responseHash! },
            });
          } else {
            const issues = rejected.flatMap((entry) => entry.issues);
            setModelInvocationOutcome(generated.audit, "rejected", issues.map((issue) => issue.code));
            observe?.({
              event: "model.semantic.rejected",
              level: "warn",
              correlation,
              attributes: { resultKind: `agent_mind_${purpose}_batch` },
              counts: { validationIssues: issues.length },
              payload: scope.observer ? fullRuntimePayload(scope.observer, { issues }) : undefined,
              error: { name: "AgentMindSlotValidationError", message: `${rejected.length} slot(s) rejected` },
            });
          }
          return { audit: generated.audit, accepted, rejected };
        },
      })));

    const outputs = new Map<string, AgentMindOutput>();
    groupResults.forEach((result) => result.results.forEach((output, agentId) => outputs.set(agentId, output)));
    return {
      outputs,
      failures: groupResults.flatMap((result) => result.failures.map((failure) => ({
        agentId: failure.slot.payload.agent.id,
        error: failure.error,
      }))),
      modelAudits: groupResults.flatMap((result) => result.audits),
      batchCount: groupResults.reduce((total, result) => total + result.batchCount, 0),
      metrics: {
        submittedSlots: groupResults.reduce((total, result) => total + result.metrics.submittedSlots, 0),
        repairCalls: groupResults.reduce((total, result) => total + result.metrics.repairCalls, 0),
        splitCount: groupResults.reduce((total, result) => total + result.metrics.splitCount, 0),
        partialFailureSlots: groupResults.reduce((total, result) => total + result.metrics.partialFailureSlots, 0),
        singletonFailures: groupResults.reduce((total, result) => total + result.metrics.singletonFailures, 0),
      },
    };
  }

  async react(
    state: SimulationState,
    agent: AgentState,
    originalAction: AgentActionProposal,
    request: ReactionRequest,
    scope: ModelExecutionScope,
  ): Promise<ReactionDecision & { modelAudit: ModelExecutionAudit }> {
    const stimulus = request.stimulus;
    const observe = runtimeEventEmitter(scope.observer);
    try {
      const result = await runSemanticRepairLoop({
        role: "agent-reaction",
        repairScope: "slot",
        targetIds: [agent.id],
        maxRepairs: this.repairAttempts,
        invoke: async (repairContext) => {
        const contextStartedAt = Date.now();
          const issues = repairContext.issues.map((issue) => ({
            code: issue.code,
            path: issue.path,
            message: issue.message,
          }));
          const context = buildReactionContext({
          state,
          agent,
          originalAction,
          stimulus,
          instanceId: scope.workloadId,
          advanceId: scope.batchId,
          issues,
          });
        const prompt = promptBundle("agent-reaction");
          const identity = modelInvocationIdentity(scope, "agent-reaction", agent.id, repairContext.attempt + 1);
        const correlation = modelInvocationCorrelation(scope, "agent-reaction", agent.id, identity);
        observe?.({
          event: "model.context.built",
          correlation,
          durationMs: Math.max(0, Date.now() - contextStartedAt),
          hashes: { context: contentHash(context) },
        });
        const result = await this.provider.generateStructured({
          profileId: agent.modelProfiles.reaction,
          workloadId: scope.workloadId,
          batchId: scope.batchId,
          abortSignal: scope.abortSignal,
          correlation: scope.correlation,
          observer: scope.observer,
          ...identity,
          role: "agent-reaction",
          subjectId: agent.id,
          promptVersion: prompt.version,
          schemaName: "agent_reaction_decision",
          system: prompt.system,
          userPrompt: prompt.userPrompt,
          context,
          schema: reactionDecisionDraftSchema,
        });
          setModelInvocationResultKind(result.audit, "agent-reaction_decision");
          return result;
        },
        validate: (value) => {
          validateReactionDecision(
            state.worldHash,
            agent,
            state.revision,
            originalAction,
            request,
            value,
          );
        },
        classify: (error) => validationIssues(error).map((issue) => semanticIssue(
          issue.code,
          issue.message,
          { class: "semantic", path: issue.path, targetIds: [agent.id] },
        )),
        onRejected: ({ audit, issues, error }) => {
          if (audit) setModelInvocationOutcome(audit, "rejected", issues.map((issue) => issue.code));
          const invocation = audit?.invocations.at(-1);
          observe?.({
            event: "model.semantic.rejected",
            level: "warn",
            correlation: modelInvocationCorrelation(scope, "agent-reaction", agent.id, {
              modelInvocationId: invocation?.id,
              modelInvocation: invocation?.ordinal,
            }),
            attributes: { resultKind: invocation?.resultKind ?? "agent-reaction_decision" },
            counts: { validationIssues: issues.length },
            payload: scope.observer ? fullRuntimePayload(scope.observer, { issues }) : undefined,
            error: serializeRuntimeError(error),
          });
        },
      });
      const validated = validateReactionDecision(
        state.worldHash,
        agent,
        state.revision,
        originalAction,
        request,
        result.value,
      );
      setModelInvocationOutcome(result.audit, "accepted");
      const invocation = result.audit.invocations.at(-1);
        observe?.({
          event: "model.semantic.accepted",
          correlation: modelInvocationCorrelation(scope, "agent-reaction", agent.id, {
            modelInvocationId: invocation?.id,
            modelInvocation: invocation?.ordinal,
          }),
          attributes: { resultKind: `reaction_${validated.kind}` },
        });
        return {
          ...validated,
          modelAudit: result.audit,
        };
    } catch (error) {
      if (!(error instanceof SemanticRepairExhaustedError)) throw error;
      throw new ModelSemanticRepairError(
        "agent-reaction",
        `Agent reaction ${agent.id} failed after repairs: ${error.message}`,
        { cause: error, audit: error.audit },
      );
    }
  }
}

export { sanitizeObservationForAgent };
