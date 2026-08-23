import { z } from "zod";
import { applyBeliefPatch } from "./belief";
import { agentMindOutputSchema, type AgentMindOutput } from "./llm-schemas";
import type {
  AgentActionProposal,
  AgentState,
  ModelExecutionAudit,
  ObservationPacket,
  SimulationState,
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
  buildAgentContext,
  sanitizeObservationForAgent,
  validationIssues,
  type PromptValidationIssue,
} from "./prompts";

function validateMindOutput(agent: AgentState, revision: number, output: AgentMindOutput): AgentMindOutput {
  if (output.beliefPatch.agentId !== agent.id) {
    throw new Error(`AgentMind ${agent.id} returned patch for ${output.beliefPatch.agentId}`);
  }
  if (output.beliefPatch.baseRevision !== revision) {
    throw new Error(`AgentMind ${agent.id} returned stale belief patch`);
  }
  if (output.nextAction.actorId !== agent.id) {
    throw new Error(`AgentMind ${agent.id} returned action for ${output.nextAction.actorId}`);
  }
  if (output.nextAction.baseRevision !== revision) {
    throw new Error(`AgentMind ${agent.id} returned action for revision ${output.nextAction.baseRevision}`);
  }
  const belief = applyBeliefPatch(agent.belief, output.beliefPatch);
  for (const targetId of output.nextAction.targetIds) {
    if (!belief.localEntities[targetId]) {
      throw new Error(`AgentMind ${agent.id} targeted unknown local entity ${targetId}`);
    }
  }
  return output;
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
  ): Promise<AgentMindOutput & { modelAudit: ModelExecutionAudit }> {
    let issues: PromptValidationIssue[] = [];
    const audits: ModelExecutionAudit[] = [];
    let lastError = "unknown AgentMind validation failure";

    for (let attempt = 0; attempt <= this.repairAttempts; attempt += 1) {
      try {
        const result = await this.provider.generateStructured({
          profileId: agent.modelProfileId,
          workloadId: scope.workloadId,
          batchId: scope.batchId,
          abortSignal: scope.abortSignal,
          role: "agent-mind",
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
        const validated = validateMindOutput(agent, state.revision, result.value);
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
}

export { sanitizeObservationForAgent };
