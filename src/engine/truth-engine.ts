import { z } from "zod";
import { evaluateProposalCausality } from "./causality";
import {
  causalVerificationSchema,
  perceptionDirectiveSchema,
  reactionRoutingOutputSchema,
  resolutionDirectiveSchema,
  transitionProposalSchema,
} from "./llm-schemas";
import type {
  AgentActionProposal,
  CausalAssertionResult,
  CausalRef,
  CausalVerification,
  D20CheckRequest,
  D20CheckResult,
  ModelExecutionAudit,
  MechanicResult,
  ObservationPacket,
  ReactionDecision,
  ReactionRequest,
  SeededRngState,
  SimulationState,
  TransitionProposal,
} from "./model";
import {
  combineModelExecutionAudits,
  ModelOutputError,
  ModelTransportError,
  type ModelExecutionScope,
  type StructuredModelProvider,
} from "./model-provider";
import { ModelOverloadedError } from "./model-scheduler";
import { validateObservations } from "./observation";
import {
  CAUSAL_VERIFIER_PROMPT_VERSION,
  CAUSAL_VERIFIER_SYSTEM,
  buildCausalVerificationContext,
  buildTruthContext,
  TRUTH_PROMPT_VERSION,
  TRUTH_SYSTEM,
  validationIssues,
  type PromptValidationIssue,
} from "./prompts";
import { resolveD20Checks } from "./random";
import { createCoreRulePackageRegistry, type RulePackageRegistry } from "./rule-package";
import type { WorldDefinition } from "./world-definition";
import type { ModelRole } from "./model-catalog";

export interface ReactionResolution {
  decisions: ReactionDecision[];
  modelAudits: ModelExecutionAudit[];
}

export interface TruthResolution {
  proposal: TransitionProposal;
  initialActions: AgentActionProposal[];
  actions: AgentActionProposal[];
  reactionRequests: ReactionRequest[];
  reactionDecisions: ReactionDecision[];
  stimulusObservations: ObservationPacket[];
  requests: D20CheckRequest[];
  checks: D20CheckResult[];
  rng: SeededRngState;
  mechanicResults: MechanicResult[];
  causalAssertionResults: CausalAssertionResult[];
  causalVerification: CausalVerification;
  modelAudits: ModelExecutionAudit[];
  reactionModelAudits: ModelExecutionAudit[];
}

export interface TruthResolutionInput {
  definition: WorldDefinition;
  state: SimulationState;
  initialActions: AgentActionProposal[];
  resolveReactions: (requests: readonly ReactionRequest[]) => Promise<ReactionResolution>;
  validateProposal: (
    proposal: TransitionProposal,
    checks: readonly D20CheckResult[],
    actions: readonly AgentActionProposal[],
    stimulusObservations: readonly ObservationPacket[],
  ) => void;
}

export interface TruthEngineOptions {
  repairAttempts?: number;
  maxCheckRounds?: number;
  rulePackages?: RulePackageRegistry;
}

class ReactionExecutionError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ReactionExecutionError";
  }
}

class ModelStageError extends Error {
  constructor(readonly role: ModelRole, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ModelStageError";
  }
}

interface ValidatedCallInput<T> {
  provider: StructuredModelProvider;
  profileId: string;
  role: ModelRole;
  subjectId: string;
  promptVersion: string;
  schemaName: string;
  system: string;
  schema: z.ZodType<T>;
  scope: ModelExecutionScope;
  buildContext: (issues: readonly PromptValidationIssue[]) => unknown;
  validate?: (value: T) => void;
  repairAttempts: number;
}

async function generateValidated<T>(input: ValidatedCallInput<T>): Promise<{
  value: T;
  audit: ModelExecutionAudit;
}> {
  const audits: ModelExecutionAudit[] = [];
  let issues: PromptValidationIssue[] = [];
  let repairCount = 0;
  while (true) {
    const auditCountBeforeAttempt = audits.length;
    try {
      const result = await input.provider.generateStructured({
        profileId: input.profileId,
        workloadId: input.scope.workloadId,
        batchId: input.scope.batchId,
        abortSignal: input.scope.abortSignal,
        role: input.role,
        subjectId: input.subjectId,
        promptVersion: input.promptVersion,
        schemaName: input.schemaName,
        system: input.system,
        context: input.buildContext(issues),
        schema: input.schema,
      });
      audits.push(result.audit);
      input.validate?.(result.value);
      return {
        value: result.value,
        audit: combineModelExecutionAudits(audits, repairCount),
      };
    } catch (error) {
      if (error instanceof ModelTransportError || error instanceof ModelOverloadedError ||
        (error instanceof Error && error.name === "AbortError")) throw error;
      if (error instanceof ModelOutputError && error.audit) audits.push(error.audit);
      if (audits.length === auditCountBeforeAttempt) throw error;
      if (!(error instanceof ModelOutputError) && !(error instanceof z.ZodError) && !(error instanceof Error)) {
        throw error;
      }
      issues = validationIssues(error);
      repairCount += 1;
      if (repairCount > input.repairAttempts) {
        const message = error instanceof Error ? error.message : String(error);
        throw new ModelStageError(input.role, `${input.role} failed after repairs: ${message}`, { cause: error });
      }
    }
  }
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
  const modifierSourceIds = new Set<string>();
  for (const source of request.modifierSources) {
    if (modifierSourceIds.has(source.id)) {
      throw new Error(`check ${request.id} repeats modifier source ${source.id}`);
    }
    modifierSourceIds.add(source.id);
    const rating = state.truth.ratings[source.id];
    const fact = state.truth.facts[source.id];
    if (!rating && !fact) throw new Error(`check ${request.id} has unknown modifier source ${source.id}`);
    if (rating && rating.value !== source.amount) {
      throw new Error(`check ${request.id} misstates rating modifier ${source.id}`);
    }
    if (fact && fact.value.kind !== "number") {
      throw new Error(`check ${request.id} uses non-numeric fact modifier ${source.id}`);
    }
    if (fact?.value.kind === "number" && fact.value.value !== source.amount) {
      throw new Error(`check ${request.id} misstates fact modifier ${source.id}`);
    }
  }
  for (const cause of request.causes) validateCausalReference(cause, allowed, `check ${request.id}`);
  const visibilityRank = { hidden: 0, result_only: 1, full: 2 } as const;
  if (visibilityRank[request.visibility] > visibilityRank[maximumVisibility]) {
    throw new Error(`check ${request.id} exceeds world disclosure policy ${maximumVisibility}`);
  }
}

function validateReactionRequests(
  input: TruthResolutionInput,
  requests: readonly ReactionRequest[],
  checkRequests: readonly D20CheckRequest[],
  checks: readonly D20CheckResult[],
): void {
  const playerAction = input.initialActions.find((action) => action.actorId === "player");
  if (!playerAction) throw new Error("reaction round has no player action");
  const requestedAgents = new Set<string>();
  const requestByCheck = new Map(checkRequests.map((request) => [request.id, request]));
  const resultByCheck = new Map(checks.map((result) => [result.requestId, result]));

  for (const request of requests) {
    if (requestedAgents.has(request.agentId)) throw new Error(`duplicate reaction request for ${request.agentId}`);
    requestedAgents.add(request.agentId);
    const agent = input.state.agents[request.agentId];
    if (!agent) throw new Error(`reaction request has unknown agent ${request.agentId}`);
    if (request.sourceActionId !== playerAction.id) {
      throw new Error(`reaction request for ${request.agentId} does not reference the player action`);
    }
    if (!input.initialActions.some((action) => action.actorId === request.agentId)) {
      throw new Error(`reaction request for ${request.agentId} has no prepared action`);
    }
    if (request.stimulus.observerId !== request.agentId || request.stimulus.kind !== "stimulus") {
      throw new Error(`reaction request for ${request.agentId} has an invalid private stimulus`);
    }
    if (request.stimulus.sourceEventIds.length !== 0) {
      throw new Error(`reaction stimulus ${request.stimulus.id} cannot cite uncommitted events`);
    }

    const basisIds = new Set<string>();
    for (const basis of request.basis) {
      const basisId = basis.kind === "shared_placement"
        ? `${basis.kind}:${basis.placementId}`
        : basis.kind === "fact"
          ? `${basis.kind}:${basis.factId}`
          : `${basis.kind}:${basis.checkId}`;
      if (basisIds.has(basisId)) throw new Error(`reaction request for ${request.agentId} repeats basis ${basisId}`);
      basisIds.add(basisId);

      if (basis.kind === "shared_placement") {
        const playerPlacement = input.state.truth.placements[input.state.player.entityId];
        const agentPlacement = input.state.truth.placements[agent.entityId];
        if (!playerPlacement || playerPlacement !== agentPlacement || playerPlacement !== basis.placementId) {
          throw new Error(`reaction request for ${request.agentId} has no shared direct placement`);
        }
        continue;
      }
      if (basis.kind === "fact") {
        const fact = input.state.truth.facts[basis.factId];
        const accessible = fact && (fact.access.kind === "public" ||
          (fact.access.kind === "agents" && fact.access.agentIds.includes(request.agentId)));
        if (!accessible) throw new Error(`reaction request for ${request.agentId} cites inaccessible fact`);
        const endpoints = new Set([input.state.player.entityId, agent.entityId]);
        const connected = endpoints.has(fact.subjectId) ||
          (fact.value.kind === "entity" && endpoints.has(fact.value.entityId));
        if (!connected) {
          throw new Error(`reaction request for ${request.agentId} cites a fact unrelated to either participant`);
        }
        continue;
      }

      const checkRequest = requestByCheck.get(basis.checkId);
      const result = resultByCheck.get(basis.checkId);
      if (!checkRequest || checkRequest.phase !== "perception" || !result?.succeeded) {
        throw new Error(`reaction request for ${request.agentId} cites no successful perception check`);
      }
      if (checkRequest.actorId !== agent.entityId) {
        throw new Error(`perception check ${basis.checkId} belongs to another observer`);
      }
      const citesPlayerAction = checkRequest.causes.some((cause) =>
        cause.kind === "action" && cause.id === playerAction.id);
      const citesWorldBasis = checkRequest.causes.some((cause) =>
        cause.kind === "fact" || cause.kind === "law");
      if (!citesPlayerAction || !citesWorldBasis) {
        throw new Error(`perception check ${basis.checkId} lacks player-action and world basis`);
      }
    }
  }

  validateObservations(input.state, requests.map((request) => request.stimulus), input.state.step + 1);
}

function applyReactionDecisions(
  input: TruthResolutionInput,
  requests: readonly ReactionRequest[],
  decisions: readonly ReactionDecision[],
): AgentActionProposal[] {
  if (decisions.length !== requests.length) throw new Error("reaction decisions do not cover every request");
  const requestAgents = new Set(requests.map((request) => request.agentId));
  const decisionAgents = new Set<string>();
  const actions = input.initialActions.map((action) => structuredClone(action));

  for (const decision of decisions) {
    if (!requestAgents.has(decision.agentId) || decisionAgents.has(decision.agentId)) {
      throw new Error(`unexpected or duplicate reaction decision for ${decision.agentId}`);
    }
    decisionAgents.add(decision.agentId);
    if (decision.baseRevision !== input.state.revision) throw new Error("reaction decision has stale revision");
    const actionIndex = actions.findIndex((action) => action.actorId === decision.agentId);
    if (actionIndex < 0 || actions[actionIndex].id !== decision.originalProposalId) {
      throw new Error(`reaction decision for ${decision.agentId} references another prepared action`);
    }
    if (decision.kind === "replace") {
      const replacement = decision.replacementAction;
      if (replacement.actorId !== decision.agentId || replacement.baseRevision !== input.state.revision) {
        throw new Error(`reaction replacement for ${decision.agentId} changes actor or revision`);
      }
      const request = requests.find((candidate) => candidate.agentId === decision.agentId)!;
      const allowedTargets = new Set([
        ...Object.keys(input.state.agents[decision.agentId].belief.localEntities),
        ...request.stimulus.introductions.map((introduction) => introduction.localEntity.id),
      ]);
      for (const targetId of replacement.targetIds) {
        if (!allowedTargets.has(targetId)) {
          throw new Error(`reaction replacement for ${decision.agentId} targets unknown local entity ${targetId}`);
        }
      }
      actions[actionIndex] = structuredClone(replacement);
    }
  }

  const ids = new Set<string>();
  const actors = new Set<string>();
  for (const action of actions) {
    if (ids.has(action.id)) throw new Error(`reaction produced duplicate action id ${action.id}`);
    if (actors.has(action.actorId)) throw new Error(`reaction produced duplicate actor ${action.actorId}`);
    if (action.baseRevision !== input.state.revision) throw new Error(`reaction action ${action.id} has stale revision`);
    if (action.actorId !== "player" && !input.state.agents[action.actorId]) {
      throw new Error(`reaction produced action for unknown actor ${action.actorId}`);
    }
    ids.add(action.id);
    actors.add(action.actorId);
  }
  return actions.sort((left, right) =>
    left.actorId.localeCompare(right.actorId) || left.id.localeCompare(right.id));
}

function validateTransitionEnvelope(
  input: TruthResolutionInput,
  actions: readonly AgentActionProposal[],
  proposal: TransitionProposal,
  checks: readonly D20CheckResult[],
): void {
  const proposalIds = actions.map((action) => action.id);
  const outcomeIds = proposal.outcomes.map((outcome) => outcome.proposalId);
  if (new Set(outcomeIds).size !== outcomeIds.length) throw new Error("transition has duplicate action outcomes");
  if (proposalIds.length !== outcomeIds.length || proposalIds.some((id) => !outcomeIds.includes(id))) {
    throw new Error("transition must contain exactly one outcome for every final joint action");
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
    mechanic: new Set(),
  };
  for (const invocation of proposal.mechanicInvocations) {
    for (const cause of invocation.causes) validateCausalReference(cause, allowed, `mechanic ${invocation.id}`);
    allowed.mechanic.add(invocation.id);
  }
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
    if (observation.kind !== "outcome") throw new Error(`transition observation ${observation.id} is not an outcome`);
    for (const eventId of observation.sourceEventIds) {
      if (!allowed.event.has(eventId)) throw new Error(`observation ${observation.id} references unknown event ${eventId}`);
    }
  }

  const playerAction = actions.find((action) => action.actorId === "player");
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
  private readonly repairAttempts: number;
  private readonly maxCheckRounds: number;
  private readonly rulePackages: RulePackageRegistry;

  constructor(
    private readonly provider: StructuredModelProvider,
    options: TruthEngineOptions = {},
  ) {
    this.repairAttempts = options.repairAttempts ?? 2;
    this.maxCheckRounds = options.maxCheckRounds ?? 4;
    this.rulePackages = options.rulePackages ?? createCoreRulePackageRegistry();
  }

  async resolve(input: TruthResolutionInput, scope: ModelExecutionScope): Promise<TruthResolution> {
    let actions = input.initialActions.map((action) => structuredClone(action));
    const allowedForChecks: Record<CausalRef["kind"], Set<string>> = {
      action: new Set(actions.map((action) => action.id)),
      check: new Set(),
      event: new Set(input.state.truth.events.map((event) => event.id)),
      fact: new Set(Object.keys(input.state.truth.facts)),
      law: new Set(input.definition.laws.map((law) => law.id)),
      mechanic: new Set(),
    };
    let rng = structuredClone(input.state.truth.rng);
    const checks: D20CheckResult[] = [];
    const requests: D20CheckRequest[] = [];
    const requestIds = new Set<string>();
    let reactionRequests: ReactionRequest[] = [];
    let reactionDecisions: ReactionDecision[] = [];
    let reactionModelAudits: ModelExecutionAudit[] = [];
    const modelAudits: ModelExecutionAudit[] = [];
    let checkRounds = 0;
    const combineStageAudits = (audits: readonly ModelExecutionAudit[]) =>
      combineModelExecutionAudits(
        audits,
        audits.reduce((total, audit) => total + audit.repairAttempts, 0),
      );

    const truthContext = (
      stage: "perception" | "reaction-routing" | "resolution" | "transition",
      issues: readonly PromptValidationIssue[],
    ) => buildTruthContext({
      definition: input.definition,
      state: input.state,
      initialActions: input.initialActions,
      actions,
      reactionRequests,
      reactionDecisions,
      reactionWindow: stage === "perception" || stage === "reaction-routing" ? "open" : "closed",
      committedCheckRequests: requests,
      checkResults: checks,
      allowedAgentProfiles: {
        bootstrap: this.provider.catalog.profileSummaries("agent-bootstrap"),
        mind: this.provider.catalog.profileSummaries("agent-mind"),
        reaction: this.provider.catalog.profileSummaries("agent-reaction"),
      },
      sessionId: scope.workloadId,
      runId: scope.batchId,
      issues,
      stage,
    });

    const validateCheckRound = (round: readonly D20CheckRequest[], phase: "perception" | "resolution") => {
      if (checkRounds >= this.maxCheckRounds) throw new Error("maximum check rounds exceeded");
      const roundIds = new Set<string>();
      for (const request of round) {
        if (request.phase !== phase) throw new Error(`${phase} stage emitted ${request.phase} check`);
        if (requestIds.has(request.id) || roundIds.has(request.id)) throw new Error(`duplicate check request ${request.id}`);
        roundIds.add(request.id);
        validateCheckRequest(
          input.state,
          request,
          allowedForChecks,
          input.definition.disclosure.defaultCheckVisibility,
        );
      }
    };

    const commitCheckRound = (round: readonly D20CheckRequest[]) => {
      const resolved = resolveD20Checks(rng, round);
      rng = resolved.rng;
      requests.push(...structuredClone(round));
      checks.push(...resolved.results);
      for (const request of round) {
        requestIds.add(request.id);
        allowedForChecks.check.add(request.id);
      }
      checkRounds += 1;
    };

    const perceptionAudits: ModelExecutionAudit[] = [];
    while (true) {
      const call = await generateValidated({
        provider: this.provider,
        profileId: input.definition.modelProfiles.perception,
        role: "truth-perception",
        subjectId: input.definition.id,
        promptVersion: TRUTH_PROMPT_VERSION,
        schemaName: "truth_perception_directive",
        system: TRUTH_SYSTEM,
        schema: perceptionDirectiveSchema,
        scope,
        buildContext: (issues) => truthContext("perception", issues),
        validate: (directive) => {
          if (directive.kind === "request_checks") {
            validateCheckRound(directive.requests, "perception");
          }
        },
        repairAttempts: this.repairAttempts,
      });
      perceptionAudits.push(call.audit);
      if (call.value.kind === "done") break;
      commitCheckRound(call.value.requests);
    }
    modelAudits.push(combineStageAudits(perceptionAudits));

    const routing = await generateValidated({
      provider: this.provider,
      profileId: input.definition.modelProfiles.reactionRouting,
      role: "truth-reaction-routing",
      subjectId: input.definition.id,
      promptVersion: TRUTH_PROMPT_VERSION,
      schemaName: "truth_reaction_routing",
      system: TRUTH_SYSTEM,
      schema: reactionRoutingOutputSchema,
      scope,
      buildContext: (issues) => truthContext("reaction-routing", issues),
      validate: (output) => validateReactionRequests(input, output.requests, requests, checks),
      repairAttempts: this.repairAttempts,
    });
    modelAudits.push(routing.audit);
    reactionRequests = structuredClone(routing.value.requests);
    if (reactionRequests.length > 0) {
      try {
        const resolved = await input.resolveReactions(reactionRequests);
        reactionDecisions = structuredClone(resolved.decisions);
        reactionModelAudits = structuredClone(resolved.modelAudits);
        actions = applyReactionDecisions(input, reactionRequests, reactionDecisions);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new ReactionExecutionError(`reaction execution failed: ${message}`, { cause: error });
      }
      allowedForChecks.action = new Set(actions.map((action) => action.id));
    }

    const resolutionAudits: ModelExecutionAudit[] = [];
    while (true) {
      const call = await generateValidated({
        provider: this.provider,
        profileId: input.definition.modelProfiles.resolution,
        role: "truth-resolution",
        subjectId: input.definition.id,
        promptVersion: TRUTH_PROMPT_VERSION,
        schemaName: "truth_resolution_directive",
        system: TRUTH_SYSTEM,
        schema: resolutionDirectiveSchema,
        scope,
        buildContext: (issues) => truthContext("resolution", issues),
        validate: (directive) => {
          if (directive.kind === "request_checks") {
            validateCheckRound(directive.requests, "resolution");
          }
        },
        repairAttempts: this.repairAttempts,
      });
      resolutionAudits.push(call.audit);
      if (call.value.kind === "done") break;
      commitCheckRound(call.value.requests);
    }
    modelAudits.push(combineStageAudits(resolutionAudits));

    const stimulusObservations = reactionRequests.map((request) => request.stimulus);
    let transitionIssues: PromptValidationIssue[] = [];
    let transitionRepairs = 0;
    let previousReport: CausalVerification | null = null;
    const transitionAudits: ModelExecutionAudit[] = [];
    const verifierAudits: ModelExecutionAudit[] = [];

    while (true) {
      const auditCountBeforeAttempt = transitionAudits.length;
      try {
        const generated = await this.provider.generateStructured({
          profileId: input.definition.modelProfiles.transition,
          workloadId: scope.workloadId,
          batchId: scope.batchId,
          abortSignal: scope.abortSignal,
          role: "truth-transition",
          subjectId: input.definition.id,
          promptVersion: TRUTH_PROMPT_VERSION,
          schemaName: "truth_transition",
          system: TRUTH_SYSTEM,
          context: truthContext("transition", transitionIssues),
          schema: transitionProposalSchema,
        });
        transitionAudits.push(generated.audit);
        const directProposal = generated.value;
        const mechanics = this.rulePackages.resolve(input.definition.rulePackages, {
          state: input.state,
          actions,
          checkRequests: requests,
          checkResults: checks,
        }, directProposal.mechanicInvocations, directProposal.operations);
        const proposal: TransitionProposal = {
          ...structuredClone(directProposal),
          mechanicInvocations: mechanics.invocations,
          operations: [...structuredClone(directProposal.operations), ...mechanics.operations],
        };

        for (const operation of proposal.operations) {
          if (operation.kind !== "create_agent") continue;
          this.provider.catalog.assertProfile(operation.agent.modelProfiles.bootstrap, "agent-bootstrap");
          this.provider.catalog.assertProfile(operation.agent.modelProfiles.mind, "agent-mind");
          this.provider.catalog.assertProfile(operation.agent.modelProfiles.reaction, "agent-reaction");
          if (operation.agent.nextAction !== null) {
            throw new Error(`new agent ${operation.agent.id} must not provide a prepared action`);
          }
        }
        validateTransitionEnvelope(input, actions, proposal, checks);
        const causalAssertionResults = evaluateProposalCausality(input.state, checks, proposal);
        input.validateProposal(proposal, checks, actions, stimulusObservations);

        const verification = await generateValidated({
          provider: this.provider,
          profileId: input.definition.modelProfiles.causalVerifier,
          role: "causal-verifier",
          subjectId: input.definition.id,
          promptVersion: CAUSAL_VERIFIER_PROMPT_VERSION,
          schemaName: "causal_verification",
          system: CAUSAL_VERIFIER_SYSTEM,
          schema: causalVerificationSchema,
          scope,
          buildContext: (issues) => buildCausalVerificationContext({
            definition: input.definition,
            state: input.state,
            actions,
            checkRequests: requests,
            checkResults: checks,
            proposal,
            assertionResults: causalAssertionResults,
            mechanicResults: mechanics.results,
            previousReport,
            sessionId: scope.workloadId,
            runId: scope.batchId,
            issues,
          }),
          validate: (report) => {
            if (report.verdict !== "reject") return;
            const targets = new Set([
              ...requests.map((request) => `check:${request.id}`),
              ...proposal.operations.map((operation, index) => `operation:${index}:${operation.kind}`),
              ...proposal.mechanicInvocations.map((invocation) => `mechanic:${invocation.id}`),
              ...proposal.events.map((event) => `event:${event.id}`),
              ...proposal.outcomes.map((outcome) => `outcome:${outcome.proposalId}`),
              ...proposal.observations.map((observation) => `observation:${observation.id}`),
            ]);
            for (const finding of report.findings) {
              if (!targets.has(`${finding.target.kind}:${finding.target.id}`)) {
                throw new Error(`causal verifier references unknown target ${finding.target.kind}:${finding.target.id}`);
              }
            }
          },
          repairAttempts: this.repairAttempts,
        });
        verifierAudits.push(verification.audit);
        if (verification.value.verdict === "reject") {
          previousReport = structuredClone(verification.value);
          throw new Error(`causal verifier rejected transition: ${verification.value.findings
            .map((finding) => `${finding.code}: ${finding.message}; ${finding.repairHint}`)
            .join(" | ")}`);
        }

        modelAudits.push(combineModelExecutionAudits(transitionAudits, transitionRepairs));
        modelAudits.push(combineStageAudits(verifierAudits));
        return {
          proposal,
          initialActions: structuredClone(input.initialActions),
          actions: structuredClone(actions),
          reactionRequests: structuredClone(reactionRequests),
          reactionDecisions: structuredClone(reactionDecisions),
          stimulusObservations: structuredClone(stimulusObservations),
          requests: structuredClone(requests),
          checks: structuredClone(checks),
          rng,
          mechanicResults: structuredClone(mechanics.results),
          causalAssertionResults: structuredClone(causalAssertionResults),
          causalVerification: structuredClone(verification.value),
          modelAudits,
          reactionModelAudits: structuredClone(reactionModelAudits),
        };
      } catch (error) {
        if (error instanceof ModelStageError && error.role === "causal-verifier") throw error;
        if (error instanceof ModelTransportError ||
          error instanceof ModelOverloadedError || (error instanceof Error && error.name === "AbortError")) {
          throw error;
        }
        if (error instanceof ModelOutputError && error.audit) transitionAudits.push(error.audit);
        if (transitionAudits.length === auditCountBeforeAttempt) throw error;
        if (!(error instanceof ModelOutputError) && !(error instanceof z.ZodError) && !(error instanceof Error)) {
          throw error;
        }
        transitionIssues = validationIssues(error);
        transitionRepairs += 1;
        if (transitionRepairs > this.repairAttempts) {
          const message = error instanceof Error ? error.message : String(error);
          throw new Error(`truth-transition failed after repairs: ${message}`, { cause: error });
        }
      }
    }
  }
}
