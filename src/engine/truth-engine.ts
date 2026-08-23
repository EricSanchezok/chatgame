import { truthDirectiveSchema } from "./llm-schemas";
import { z } from "zod";
import {
  combineModelExecutionAudits,
  ModelOutputError,
  ModelTransportError,
  type ModelExecutionScope,
  type StructuredModelProvider,
} from "./model-provider";
import { ModelOverloadedError } from "./model-scheduler";
import type {
  AgentActionProposal,
  CausalRef,
  D20CheckRequest,
  D20CheckResult,
  ModelExecutionAudit,
  SeededRngState,
  SimulationState,
  TransitionProposal,
} from "./model";
import {
  buildTruthContext,
  TRUTH_PROMPT_VERSION,
  TRUTH_SYSTEM,
  validationIssues,
  type PromptValidationIssue,
} from "./prompts";
import { resolveD20Checks } from "./random";
import type { WorldDefinition } from "./world-definition";

export interface TruthResolution {
  proposal: TransitionProposal;
  requests: D20CheckRequest[];
  checks: D20CheckResult[];
  rng: SeededRngState;
  modelAudit: ModelExecutionAudit;
}

export interface TruthResolutionInput {
  definition: WorldDefinition;
  state: SimulationState;
  actions: AgentActionProposal[];
  validateProposal: (proposal: TransitionProposal, checks: readonly D20CheckResult[]) => void;
}

function validateCausalReference(
  cause: CausalRef,
  allowed: Record<CausalRef["kind"], Set<string>>,
  label: string,
): void {
  if (!allowed[cause.kind].has(cause.id)) {
    throw new Error(`${label} references unknown ${cause.kind} ${cause.id}`);
  }
}

function validateCheckRequest(
  state: SimulationState,
  request: D20CheckRequest,
  allowed: Record<CausalRef["kind"], Set<string>>,
  maximumVisibility: WorldDefinition["disclosure"]["defaultCheckVisibility"],
): void {
  const actor = state.truth.entities[request.actorId];
  if (!actor || actor.lifecycle !== "active") throw new Error(`check ${request.id} has inactive actor`);
  if (request.targetId && !state.truth.entities[request.targetId]) {
    throw new Error(`check ${request.id} has unknown target`);
  }
  if (request.ratingId) {
    const rating = state.truth.ratings[request.ratingId];
    if (!rating || rating.entityId !== request.actorId) {
      throw new Error(`check ${request.id} has invalid actor rating`);
    }
  }
  if (request.modifierSources.reduce((total, source) => total + source.amount, 0) !== request.modifier) {
    throw new Error(`check ${request.id} modifier does not equal its declared sources`);
  }
  for (const source of request.modifierSources) {
    const sourceId = source.id;
    if (!state.truth.ratings[sourceId] && !state.truth.facts[sourceId]) {
      throw new Error(`check ${request.id} has unknown modifier source ${sourceId}`);
    }
    const rating = state.truth.ratings[sourceId];
    if (rating && rating.value !== source.amount) {
      throw new Error(`check ${request.id} misstates rating modifier ${sourceId}`);
    }
    const fact = state.truth.facts[sourceId];
    if (fact && fact.value.kind !== "number") {
      throw new Error(`check ${request.id} uses non-numeric fact modifier ${sourceId}`);
    }
    if (fact?.value.kind === "number" && fact.value.value !== source.amount) {
      throw new Error(`check ${request.id} misstates fact modifier ${sourceId}`);
    }
  }
  for (const cause of request.causes) validateCausalReference(cause, allowed, `check ${request.id}`);
  const visibilityRank = { hidden: 0, result_only: 1, full: 2 } as const;
  if (visibilityRank[request.visibility] > visibilityRank[maximumVisibility]) {
    throw new Error(`check ${request.id} exceeds world disclosure policy ${maximumVisibility}`);
  }
}

function validateTransitionEnvelope(
  input: TruthResolutionInput,
  proposal: TransitionProposal,
  checks: readonly D20CheckResult[],
): void {
  const proposalIds = input.actions.map((action) => action.id);
  const outcomeIds = proposal.outcomes.map((outcome) => outcome.proposalId);
  if (new Set(outcomeIds).size !== outcomeIds.length) throw new Error("transition has duplicate action outcomes");
  if (proposalIds.length !== outcomeIds.length || proposalIds.some((id) => !outcomeIds.includes(id))) {
    throw new Error("transition must contain exactly one outcome for every joint action");
  }
  if (proposal.baseRevision !== input.state.revision) throw new Error("transition has a stale base revision");

  const eventIds = new Set(input.state.truth.events.map((event) => event.id));
  const proposedEventIds = new Set<string>();
  for (const event of proposal.events) {
    if (eventIds.has(event.id) || proposedEventIds.has(event.id)) throw new Error(`duplicate event id ${event.id}`);
    if (event.step !== input.state.step + 1) throw new Error(`event ${event.id} has invalid step`);
    proposedEventIds.add(event.id);
  }

  const allowed: Record<CausalRef["kind"], Set<string>> = {
    action: new Set(proposalIds),
    check: new Set(checks.map((check) => check.requestId)),
    event: eventIds,
    fact: new Set(Object.keys(input.state.truth.facts)),
    law: new Set(input.definition.laws.map((law) => law.id)),
  };
  for (const event of proposal.events) {
    for (const cause of event.causes) validateCausalReference(cause, allowed, `event ${event.id}`);
    allowed.event.add(event.id);
  }
  for (const operation of proposal.operations) {
    for (const cause of operation.causes) validateCausalReference(cause, allowed, operation.kind);
    if ((operation.kind === "produce_quantity" || operation.kind === "consume_quantity") &&
      !allowed.law.has(operation.lawId)) {
      throw new Error(`${operation.kind} references unknown law ${operation.lawId}`);
    }
  }
  for (const outcome of proposal.outcomes) {
    for (const cause of outcome.causeRefs) validateCausalReference(cause, allowed, `outcome ${outcome.proposalId}`);
  }
  for (const observation of proposal.observations) {
    for (const eventId of observation.sourceEventIds) {
      if (!allowed.event.has(eventId)) throw new Error(`observation ${observation.id} references unknown event ${eventId}`);
    }
  }

  const playerAction = input.actions.find((action) => action.actorId === "player");
  const playerOutcome = playerAction && proposal.outcomes.find((outcome) => outcome.proposalId === playerAction.id);
  if (!playerOutcome) throw new Error("transition is missing the player outcome");
  if ((playerOutcome.status === "failed" || playerOutcome.status === "blocked") && !playerOutcome.summary.trim()) {
    throw new Error("failed player outcome requires an understandable summary");
  }
  const playerObservationIds = new Set(
    proposal.observations.filter((packet) => packet.observerId === "player").map((packet) => packet.id),
  );
  for (const alternative of playerOutcome.knownAlternatives) {
    if (alternative.basis.kind === "knowledge") {
      for (const evidenceId of alternative.basis.evidenceIds) {
        if (!input.state.player.knowledge.evidence[evidenceId]) {
          throw new Error(`player alternative references unknown evidence ${evidenceId}`);
        }
      }
      continue;
    }
    if (!playerObservationIds.has(alternative.basis.observationId)) {
      throw new Error(`player alternative references unknown observation ${alternative.basis.observationId}`);
    }
  }
}

export class TruthEngine {
  constructor(
    private readonly provider: StructuredModelProvider,
    private readonly repairAttempts = 2,
    private readonly maxCheckRounds = 4,
  ) {}

  async resolve(input: TruthResolutionInput, scope: ModelExecutionScope): Promise<TruthResolution> {
    const lawIds = new Set(input.definition.laws.map((law) => law.id));
    const proposalIds = new Set(input.actions.map((action) => action.id));
    const allowedForChecks: Record<CausalRef["kind"], Set<string>> = {
      action: proposalIds,
      check: new Set(),
      event: new Set(input.state.truth.events.map((event) => event.id)),
      fact: new Set(Object.keys(input.state.truth.facts)),
      law: lawIds,
    };
    let rng = structuredClone(input.state.truth.rng);
    const checks: D20CheckResult[] = [];
    const requests: D20CheckRequest[] = [];
    const requestIds = new Set<string>();
    let checkRounds = 0;
    let repairCount = 0;
    let issues: PromptValidationIssue[] = [];
    let lastError = "unknown Truth Engine validation failure";
    const audits: ModelExecutionAudit[] = [];

    while (true) {
      try {
        const result = await this.provider.generateStructured({
          profileId: input.definition.truthModelProfileId,
          workloadId: scope.workloadId,
          batchId: scope.batchId,
          abortSignal: scope.abortSignal,
          role: "truth-engine",
          subjectId: input.definition.id,
          promptVersion: TRUTH_PROMPT_VERSION,
          schemaName: "truth_directive",
          system: TRUTH_SYSTEM,
          context: buildTruthContext({
            definition: input.definition,
            state: input.state,
            actions: input.actions,
            committedCheckRequests: requests,
            checkResults: checks,
            allowedAgentProfiles: this.provider.catalog.profileSummaries("agent-mind"),
            sessionId: scope.workloadId,
            runId: scope.batchId,
            issues,
          }),
          schema: truthDirectiveSchema,
        });
        audits.push(result.audit);
        const directive = result.value;
        if (directive.kind === "request_checks") {
          if (checkRounds >= this.maxCheckRounds) throw new Error("maximum check rounds exceeded");
          for (const request of directive.requests) {
            if (requestIds.has(request.id)) throw new Error(`duplicate check request ${request.id}`);
            validateCheckRequest(
              input.state,
              request,
              allowedForChecks,
              input.definition.disclosure.defaultCheckVisibility,
            );
          }
          const resolved = resolveD20Checks(rng, directive.requests);
          rng = resolved.rng;
          requests.push(...directive.requests);
          checks.push(...resolved.results);
          for (const request of directive.requests) {
            requestIds.add(request.id);
            allowedForChecks.check.add(request.id);
          }
          checkRounds += 1;
          issues = [];
          continue;
        }

        for (const operation of directive.proposal.operations) {
          if (operation.kind === "create_agent") {
            this.provider.catalog.assertProfile(operation.agent.modelProfileId, "agent-mind");
          }
        }
        validateTransitionEnvelope(input, directive.proposal, checks);
        input.validateProposal(directive.proposal, checks);
        return {
          proposal: directive.proposal,
          requests,
          checks,
          rng,
          modelAudit: combineModelExecutionAudits(audits, repairCount),
        };
      } catch (error) {
        if (error instanceof ModelTransportError || error instanceof ModelOverloadedError ||
          (error instanceof Error && error.name === "AbortError")) throw error;
        if (error instanceof ModelOutputError && error.audit) audits.push(error.audit);
        if (!(error instanceof ModelOutputError) && !(error instanceof z.ZodError) &&
          !(error instanceof Error)) throw error;
        lastError = error instanceof Error ? error.message : String(error);
        issues = validationIssues(error);
        repairCount += 1;
        if (repairCount > this.repairAttempts) {
          throw new Error(`TruthEngine failed after repairs: ${lastError}`);
        }
      }
    }
  }
}
