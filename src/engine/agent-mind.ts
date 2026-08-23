import { z } from "zod";
import { applyBeliefPatch } from "./belief";
import { applyCharacterPatch } from "./character";
import {
  agentMindOutputSchema,
  reactionDecisionSchema,
  type AgentMindOutput,
} from "./llm-schemas";
import type {
  AgentActionProposal,
  AgentState,
  ModelExecutionAudit,
  ObservationPacket,
  ReactionDecision,
  SimulationState,
  WorldEvent,
} from "./model";
import {
  combineModelExecutionAudits,
  ModelOutputError,
  ModelTransportError,
  type ModelExecutionScope,
  type StructuredModelProvider,
} from "./model-provider";
import { ModelOverloadedError } from "./model-scheduler";
import {
  AGENT_PROMPT_VERSION,
  AGENT_SYSTEM,
  REACTION_PROMPT_VERSION,
  REACTION_SYSTEM,
  buildAgentContext,
  buildReactionContext,
  sanitizeObservationForAgent,
  validationIssues,
  type PromptValidationIssue,
} from "./prompts";

function validateMindOutput(
  agent: AgentState,
  revision: number,
  step: number,
  observations: readonly ObservationPacket[],
  events: readonly WorldEvent[],
  output: AgentMindOutput,
): AgentMindOutput {
  if (output.beliefPatch.agentId !== agent.id) {
    throw new Error(`AgentMind ${agent.id} returned patch for ${output.beliefPatch.agentId}`);
  }
  if (output.beliefPatch.baseRevision !== revision) {
    throw new Error(`AgentMind ${agent.id} returned stale belief patch`);
  }
  if (output.characterPatch.agentId !== agent.id) {
    throw new Error(`AgentMind ${agent.id} returned character patch for ${output.characterPatch.agentId}`);
  }
  if (output.characterPatch.baseRevision !== revision) {
    throw new Error(`AgentMind ${agent.id} returned stale character patch`);
  }
  if (output.nextAction.actorId !== agent.id) {
    throw new Error(`AgentMind ${agent.id} returned action for ${output.nextAction.actorId}`);
  }
  if (output.nextAction.baseRevision !== revision) {
    throw new Error(`AgentMind ${agent.id} returned action for revision ${output.nextAction.baseRevision}`);
  }
  const belief = applyBeliefPatch(agent.belief, output.beliefPatch);
  applyCharacterPatch(agent.character, belief, output.characterPatch, step, observations, events);
  for (const targetId of output.nextAction.targetIds) {
    if (!belief.localEntities[targetId]) {
      throw new Error(`AgentMind ${agent.id} targeted unknown local entity ${targetId}`);
    }
  }
  return output;
}

function validateReactionDecision(
  agent: AgentState,
  revision: number,
  originalAction: AgentActionProposal,
  stimulus: ObservationPacket,
  decision: ReactionDecision,
): ReactionDecision {
  if (decision.agentId !== agent.id) {
    throw new Error(`Agent reaction ${agent.id} returned decision for ${decision.agentId}`);
  }
  if (decision.baseRevision !== revision) throw new Error(`Agent reaction ${agent.id} used a stale revision`);
  if (decision.originalProposalId !== originalAction.id) {
    throw new Error(`Agent reaction ${agent.id} replaced an unknown proposal`);
  }
  if (decision.kind === "keep") return decision;

  const replacement = decision.replacementAction;
  if (replacement.actorId !== agent.id) throw new Error(`Agent reaction ${agent.id} changed actor`);
  if (replacement.baseRevision !== revision) throw new Error(`Agent reaction ${agent.id} changed revision`);
  const allowedTargets = new Set([
    ...Object.keys(agent.belief.localEntities),
    ...stimulus.introductions.map((introduction) => introduction.localEntity.id),
  ]);
  for (const targetId of replacement.targetIds) {
    if (!allowedTargets.has(targetId)) {
      throw new Error(`Agent reaction ${agent.id} targeted unknown local entity ${targetId}`);
    }
  }
  return decision;
}

function isTerminalModelError(error: unknown): boolean {
  return error instanceof ModelTransportError || error instanceof ModelOverloadedError ||
    (error instanceof Error && error.name === "AbortError");
}

export class AgentMind {
  constructor(
    private readonly provider: StructuredModelProvider,
    private readonly repairAttempts = 2,
  ) {}

  async think(
    state: SimulationState,
    agent: AgentState,
    observations: readonly ObservationPacket[],
    scope: ModelExecutionScope,
    currentResolution: {
      action: AgentActionProposal | null;
      outcome: {
        status: "succeeded" | "partial" | "failed" | "blocked" | "continuing";
        summary: string;
      } | null;
    } = { action: null, outcome: null },
    events: readonly WorldEvent[] = [],
    purpose: "bootstrap" | "mind" = "mind",
  ): Promise<AgentMindOutput & { modelAudit: ModelExecutionAudit }> {
    let issues: PromptValidationIssue[] = [];
    const audits: ModelExecutionAudit[] = [];
    let lastError = "unknown AgentMind validation failure";

    for (let attempt = 0; attempt <= this.repairAttempts; attempt += 1) {
      try {
        const result = await this.provider.generateStructured({
          profileId: agent.modelProfiles[purpose],
          workloadId: scope.workloadId,
          batchId: scope.batchId,
          abortSignal: scope.abortSignal,
          role: purpose === "bootstrap" ? "agent-bootstrap" : "agent-mind",
          subjectId: agent.id,
          promptVersion: AGENT_PROMPT_VERSION,
          schemaName: "agent_mind_output",
          system: AGENT_SYSTEM,
          context: buildAgentContext({
            state,
            agent,
            observations,
            currentAction: currentResolution.action,
            currentOutcome: currentResolution.outcome,
            sessionId: scope.workloadId,
            runId: scope.batchId,
            issues,
          }),
          schema: agentMindOutputSchema,
        });
        audits.push(result.audit);
        const validated = validateMindOutput(agent, state.revision, state.step, observations, events, result.value);
        return {
          ...validated,
          modelAudit: combineModelExecutionAudits(audits, attempt),
        };
      } catch (error) {
        if (isTerminalModelError(error)) throw error;
        if (error instanceof ModelOutputError && error.audit) audits.push(error.audit);
        if (!(error instanceof ModelOutputError) && !(error instanceof z.ZodError) &&
          !(error instanceof Error)) throw error;
        lastError = error instanceof Error ? error.message : String(error);
        issues = validationIssues(error);
      }
    }
    throw new Error(`AgentMind ${agent.id} failed after repairs: ${lastError}`);
  }

  async react(
    state: SimulationState,
    agent: AgentState,
    originalAction: AgentActionProposal,
    stimulus: ObservationPacket,
    scope: ModelExecutionScope,
  ): Promise<ReactionDecision & { modelAudit: ModelExecutionAudit }> {
    let issues: PromptValidationIssue[] = [];
    const audits: ModelExecutionAudit[] = [];
    let lastError = "unknown Agent reaction validation failure";

    for (let attempt = 0; attempt <= this.repairAttempts; attempt += 1) {
      try {
        const result = await this.provider.generateStructured({
          profileId: agent.modelProfiles.reaction,
          workloadId: scope.workloadId,
          batchId: scope.batchId,
          abortSignal: scope.abortSignal,
          role: "agent-reaction",
          subjectId: agent.id,
          promptVersion: REACTION_PROMPT_VERSION,
          schemaName: "agent_reaction_decision",
          system: REACTION_SYSTEM,
          context: buildReactionContext({
            state,
            agent,
            originalAction,
            stimulus,
            sessionId: scope.workloadId,
            runId: scope.batchId,
            issues,
          }),
          schema: reactionDecisionSchema,
        });
        audits.push(result.audit);
        const validated = validateReactionDecision(agent, state.revision, originalAction, stimulus, result.value);
        return {
          ...validated,
          modelAudit: combineModelExecutionAudits(audits, attempt),
        };
      } catch (error) {
        if (isTerminalModelError(error)) throw error;
        if (error instanceof ModelOutputError && error.audit) audits.push(error.audit);
        if (!(error instanceof ModelOutputError) && !(error instanceof z.ZodError) &&
          !(error instanceof Error)) throw error;
        lastError = error instanceof Error ? error.message : String(error);
        issues = validationIssues(error);
      }
    }
    throw new Error(`Agent reaction ${agent.id} failed after repairs: ${lastError}`);
  }
}

export { sanitizeObservationForAgent };
