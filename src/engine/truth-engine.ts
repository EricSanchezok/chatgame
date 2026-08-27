import { z } from "zod";
import { evaluateProposalCausality } from "./causality";
import {
  causalVerificationSchema,
  perceptionDirectiveSchema,
  reactionRoutingOutputSchema,
  resolutionDirectiveSchema,
  transitionProposalSchema,
  type DiscreteRandomRequestProposal,
  type ReactionRequestDraft,
} from "./llm-schemas";
import type {
  ActionGrounding,
} from "./execution";
import type {
  AgentActionProposal,
  CausalAssertion,
  CausalAssertionResult,
  CausalRef,
  CausalVerification,
  CommitmentRound,
  D20CheckRequest,
  D20CheckRequestDraft,
  D20CheckResult,
  DiscreteRandomRequest,
  DiscreteRandomResult,
  ModelExecutionAudit,
  MechanicResult,
  ObservationPacket,
  ObservationPacketDraft,
  ReactionDecision,
  ReactionRequest,
  SeededRngState,
  SimulationState,
  TransitionProposal,
  TransitionProposalDraft,
  WorldDeltaOperation,
  WorldDeltaOperationDraft,
} from "./model";
import { MAX_COMMITMENT_ROUNDS_PER_STEP } from "./commitment-rounds";
import {
  combineModelExecutionAudits,
  ModelConfigurationError,
  modelInvocationCorrelation,
  modelInvocationIdentity,
  ModelOutputError,
  ModelSemanticRepairError,
  ModelTransportError,
  setModelInvocationOutcome,
  setModelInvocationResultKind,
  type ModelExecutionScope,
  type StructuredModelProvider,
} from "./model-provider";
import { contentHash } from "./model-audit";
import { ModelOverloadedError } from "./model-scheduler";
import { runtimeEventEmitter, serializeRuntimeError } from "./observability";
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
import {
  resolveD20Checks,
  resolveDiscreteRandomRequests,
  validateDiscreteRandomCommitmentBudget,
} from "./random";
import { MAX_RANDOM_REQUESTS_PER_ROUND } from "./random-limits";
import { createCoreRulePackageRegistry, type RulePackageRegistry } from "./rule-package";
import type { WorldDefinition } from "./world-definition";
import type { ModelRole } from "./model-catalog";
import { runtimeId } from "./runtime-id";
import type { TemporalBoundary } from "./temporal";

export interface ReactionResolution {
  decisions: ReactionDecision[];
  modelAudits: ModelExecutionAudit[];
}

export interface ObservationResolution {
  packets: ObservationPacket[];
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
  randomRequests: DiscreteRandomRequest[];
  randomResults: DiscreteRandomResult[];
  commitmentRounds: CommitmentRound[];
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
  temporalBoundary: TemporalBoundary;
  identityOwner: string;
  groundings: readonly ActionGrounding[];
  resolveReactions: (requests: readonly ReactionRequest[]) => Promise<ReactionResolution>;
  renderObservations: (
    proposal: Readonly<TransitionProposal>,
    actions: readonly AgentActionProposal[],
    transitionAttempt: number,
  ) => Promise<ObservationResolution>;
  validateProposal: (
    proposal: TransitionProposal,
    checks: readonly D20CheckResult[],
    randomResults: readonly DiscreteRandomResult[],
    actions: readonly AgentActionProposal[],
    stimulusObservations: readonly ObservationPacket[],
  ) => void;
}

export interface TruthEngineOptions {
  repairAttempts?: number;
  maxCommitmentRounds?: number;
  rulePackages?: RulePackageRegistry;
}

export function normalizeOutcomeAlternativeEvidence(
  state: Readonly<SimulationState>,
  actions: readonly AgentActionProposal[],
  proposal: Readonly<TransitionProposal>,
): { proposal: TransitionProposal; droppedReferences: number; droppedAlternatives: number } {
  const actorByAction = new Map(actions.map((action) => [action.id, action.actorId]));
  let droppedReferences = 0;
  let droppedAlternatives = 0;
  const outcomes = proposal.outcomes.map((outcome) => {
    const actorId = actorByAction.get(outcome.proposalId);
    const evidence = actorId ? state.agents[actorId]?.belief.evidence : undefined;
    const knownAlternatives = outcome.knownAlternatives.flatMap((alternative) => {
      if (alternative.basis.kind !== "knowledge") return [structuredClone(alternative)];
      const seen = new Set<string>();
      const evidenceIds = alternative.basis.evidenceIds.filter((evidenceId) => {
        if (!evidence?.[evidenceId] || seen.has(evidenceId)) {
          droppedReferences += 1;
          return false;
        }
        seen.add(evidenceId);
        return true;
      });
      if (evidenceIds.length === 0) {
        droppedAlternatives += 1;
        return [];
      }
      return [{
        ...structuredClone(alternative),
        basis: { kind: "knowledge" as const, evidenceIds },
      }];
    });
    return { ...structuredClone(outcome), knownAlternatives };
  });
  return {
    proposal: { ...structuredClone(proposal), outcomes },
    droppedReferences,
    droppedAlternatives,
  };
}

class ReactionExecutionError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ReactionExecutionError";
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
  invocationOffset?: number;
}

async function generateValidated<T>(input: ValidatedCallInput<T>): Promise<{
  value: T;
  audit: ModelExecutionAudit;
}> {
  const audits: ModelExecutionAudit[] = [];
  let issues: PromptValidationIssue[] = [];
  let repairCount = 0;
  const observe = runtimeEventEmitter(input.scope.observer);
  while (true) {
    const auditCountBeforeAttempt = audits.length;
    try {
      const contextStartedAt = Date.now();
      const context = input.buildContext(issues);
      const invocation = (input.invocationOffset ?? 0) +
        audits.reduce((count, audit) => count + audit.invocations.length, 0) + 1;
      const identity = modelInvocationIdentity(input.scope, input.role, input.subjectId, invocation);
      const correlation = modelInvocationCorrelation(input.scope, input.role, input.subjectId, identity);
      observe?.({
        event: "model.context.built",
        correlation,
        durationMs: Math.max(0, Date.now() - contextStartedAt),
        hashes: { context: contentHash(context) },
      });
      const result = await input.provider.generateStructured({
        profileId: input.profileId,
        workloadId: input.scope.workloadId,
        batchId: input.scope.batchId,
        abortSignal: input.scope.abortSignal,
        correlation: input.scope.correlation,
        observer: input.scope.observer,
        ...identity,
        role: input.role,
        subjectId: input.subjectId,
        promptVersion: input.promptVersion,
        schemaName: input.schemaName,
        system: input.system,
        context,
        schema: input.schema,
      });
      audits.push(result.audit);
      input.validate?.(result.value);
      const value = result.value as { kind?: unknown; verdict?: unknown };
      const resultKind = typeof value.kind === "string"
        ? `${input.role}_${value.kind}`
        : typeof value.verdict === "string"
          ? `${input.role}_${value.verdict}`
          : input.role;
      setModelInvocationResultKind(result.audit, resultKind);
      setModelInvocationOutcome(result.audit, "accepted");
      observe?.({
        event: "model.semantic.accepted",
        correlation,
        attributes: { resultKind },
      });
      return {
        value: result.value,
        audit: combineModelExecutionAudits(audits),
      };
    } catch (error) {
      if (error instanceof ModelConfigurationError || error instanceof ModelTransportError ||
        error instanceof ModelOverloadedError ||
        (error instanceof Error && error.name === "AbortError")) throw error;
      if (error instanceof ModelOutputError && error.audit) audits.push(error.audit);
      if (audits.length === auditCountBeforeAttempt) throw error;
      if (!(error instanceof ModelOutputError) && !(error instanceof z.ZodError) && !(error instanceof Error)) {
        throw error;
      }
      issues = validationIssues(error);
      const audit = audits.at(-1);
      if (audit) setModelInvocationOutcome(audit, "rejected", issues.map((issue) => issue.code));
      const invocation = audit?.invocations.at(-1);
      observe?.({
        event: "model.semantic.rejected",
        level: "warn",
        correlation: modelInvocationCorrelation(input.scope, input.role, input.subjectId, {
          modelInvocationId: invocation?.id,
          modelInvocation: invocation?.ordinal,
        }),
        attributes: { resultKind: invocation?.resultKind ?? null },
        counts: { validationIssues: issues.length },
        hashes: invocation?.responseHash ? { response: invocation.responseHash } : undefined,
        error: serializeRuntimeError(error),
      });
      repairCount += 1;
      if (repairCount > input.repairAttempts) {
        const message = error instanceof Error ? error.message : String(error);
        throw new ModelSemanticRepairError(
          input.role,
          `${input.role} failed after repairs: ${message}`,
          { cause: error },
        );
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
    const sourceKey = `${source.kind}:${source.id}`;
    if (modifierSourceIds.has(sourceKey)) {
      throw new Error(`check ${request.id} repeats modifier source ${sourceKey}`);
    }
    modifierSourceIds.add(sourceKey);
    if (source.kind === "rating") {
      const rating = state.truth.ratings[source.id];
      if (!rating) throw new Error(`check ${request.id} has unknown rating modifier ${source.id}`);
      if (rating.value !== source.amount) {
        throw new Error(`check ${request.id} misstates rating modifier ${source.id}`);
      }
      continue;
    }
    const fact = state.truth.facts[source.id];
    if (!fact) throw new Error(`check ${request.id} has unknown fact modifier ${source.id}`);
    if (fact.value.kind !== "number") {
      throw new Error(`check ${request.id} uses non-numeric fact modifier ${source.id}`);
    }
    if (fact.value.value !== source.amount) {
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
  const requestedAgents = new Set<string>();
  const requestByCheck = new Map(checkRequests.map((request) => [request.id, request]));
  const resultByCheck = new Map(checks.map((result) => [result.requestId, result]));

  for (const request of requests) {
    if (requestedAgents.has(request.agentId)) throw new Error(`duplicate reaction request for ${request.agentId}`);
    requestedAgents.add(request.agentId);
    const agent = input.state.agents[request.agentId];
    if (!agent) throw new Error(`reaction request has unknown agent ${request.agentId}`);
    const sourceAction = input.initialActions.find((action) => action.id === request.sourceActionId);
    if (!sourceAction || sourceAction.actorId === request.agentId) {
      throw new Error(`reaction request for ${request.agentId} has an invalid source action`);
    }
    const sourceAgent = input.state.agents[sourceAction.actorId];
    if (!sourceAgent) throw new Error(`reaction request references unknown source actor ${sourceAction.actorId}`);
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
        const sourcePlacement = input.state.truth.placements[sourceAgent.entityId];
        const agentPlacement = input.state.truth.placements[agent.entityId];
        if (!sourcePlacement || sourcePlacement !== agentPlacement || sourcePlacement !== basis.placementId) {
          throw new Error(`reaction request for ${request.agentId} has no shared direct placement`);
        }
        continue;
      }
      if (basis.kind === "fact") {
        const fact = input.state.truth.facts[basis.factId];
        const accessible = fact && (fact.access.kind === "public" ||
          (fact.access.kind === "agents" && fact.access.agentIds.includes(request.agentId)));
        if (!accessible) throw new Error(`reaction request for ${request.agentId} cites inaccessible fact`);
        const endpoints = new Set([sourceAgent.entityId, agent.entityId]);
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
      const citesSourceAction = checkRequest.causes.some((cause) =>
        cause.kind === "action" && cause.id === sourceAction.id);
      const citesWorldBasis = checkRequest.causes.some((cause) =>
        cause.kind === "fact" || cause.kind === "law");
      if (!citesSourceAction || !citesWorldBasis) {
        throw new Error(`perception check ${basis.checkId} lacks source-action and world basis`);
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
    if (!input.state.agents[action.actorId]) {
      throw new Error(`reaction produced action for unknown actor ${action.actorId}`);
    }
    ids.add(action.id);
    actors.add(action.actorId);
  }
  return actions.sort((left, right) =>
    left.actorId.localeCompare(right.actorId) || left.id.localeCompare(right.id));
}

export function materializeObservationPackets(
  state: SimulationState,
  packets: readonly ObservationPacketDraft[],
  stage: "stimulus" | "outcome",
  eventAliases: ReadonlyMap<string, string> = new Map(),
): { packets: ObservationPacket[]; aliases: Map<string, string> } {
  const aliases = new Map<string, string>();
  for (const [ordinal, packet] of packets.entries()) {
    if (aliases.has(packet.id)) throw new Error(`duplicate ${stage} observation alias ${packet.id}`);
    aliases.set(packet.id, runtimeId({
      worldHash: state.worldHash,
      revision: state.revision,
      kind: "observation",
      stage,
      owner: packet.observerId,
      round: 0,
      ordinal,
    }));
  }
  return {
    aliases,
    packets: packets.map((packet, packetOrdinal) => {
      const id = aliases.get(packet.id)!;
      return {
        ...structuredClone(packet),
        id,
        step: state.step + 1,
        kind: stage,
        apparentClaims: packet.apparentClaims.map((claim, claimOrdinal) => ({
          ...structuredClone(claim),
          id: runtimeId({
            worldHash: state.worldHash,
            revision: state.revision,
            kind: "claim",
            stage,
            owner: [packet.observerId, id],
            round: packetOrdinal,
            ordinal: claimOrdinal,
          }),
        })),
        sourceEventIds: packet.sourceEventIds.map((eventId) => eventAliases.get(eventId) ?? eventId),
      };
    }),
  };
}

function materializeReactionRequests(
  state: SimulationState,
  requests: readonly ReactionRequestDraft[],
): ReactionRequest[] {
  const materialized = materializeObservationPackets(
    state,
    requests.map((request, index) => ({
      ...structuredClone(request.stimulus),
      id: `reaction-stimulus-${index}`,
      observerId: request.agentId,
      sourceEventIds: [],
    })),
    "stimulus",
  ).packets;
  return requests.map((request, index) => ({
    agentId: request.agentId,
    sourceActionId: request.sourceActionId,
    stimulus: materialized[index],
    basis: structuredClone(request.basis),
  }));
}

function materializeWorldOperation(
  state: SimulationState,
  definition: WorldDefinition,
  operation: WorldDeltaOperationDraft,
  rewriteCause: (cause: CausalRef) => CausalRef,
  rewriteAssertion: (assertion: CausalAssertion) => CausalAssertion,
): WorldDeltaOperation {
  const causes = operation.causes.map(rewriteCause);
  const assertions = operation.assertions.map(rewriteAssertion);
  const nextStep = state.step + 1;

  switch (operation.kind) {
    case "create_entity":
      return {
        ...structuredClone(operation),
        entity: {
          ...structuredClone(operation.entity),
          lifecycle: "active",
          createdAtStep: nextStep,
        },
        causes,
        assertions,
      };
    case "set_fact":
      return {
        ...structuredClone(operation),
        fact: {
          ...structuredClone(operation.fact),
          provenance: structuredClone(causes),
        },
        causes,
        assertions,
      };
    case "set_meter":
      return {
        ...structuredClone(operation),
        meter: {
          ...structuredClone(operation.meter),
          firedThresholdIds: structuredClone(
            state.truth.meters[operation.meter.id]?.firedThresholdIds ?? [],
          ),
        },
        causes,
        assertions,
      };
    case "create_agent": {
      const stampRecords = <T extends { id: string }>(records: Record<string, T>) =>
        Object.fromEntries(Object.entries(records).map(([id, record]) => [id, {
          ...structuredClone(record),
          createdAtStep: nextStep,
          updatedAtStep: nextStep,
        }]));
      return {
        ...structuredClone(operation),
        agent: {
          ...structuredClone(operation.agent),
          modelProfiles: structuredClone(definition.modelProfiles.dynamicAgent),
          character: {
            persona: {
              ...structuredClone(operation.agent.character.persona),
              updatedAtStep: nextStep,
            },
            traits: stampRecords(operation.agent.character.traits),
            values: stampRecords(operation.agent.character.values),
            emotions: stampRecords(operation.agent.character.emotions),
            attitudes: stampRecords(operation.agent.character.attitudes),
            goals: stampRecords(operation.agent.character.goals),
            commitments: stampRecords(operation.agent.character.commitments),
          },
          belief: {
            ...structuredClone(operation.agent.belief),
            evidence: Object.fromEntries(Object.entries(operation.agent.belief.evidence)
              .map(([id, evidence]) => [id, { ...structuredClone(evidence), step: nextStep }])),
          },
          observationCursorStep: nextStep,
          nextAction: null,
        },
        causes,
        assertions,
      };
    }
    default:
      return {
        ...structuredClone(operation),
        causes,
        assertions,
      };
  }
}

function materializeTransitionProposal(
  definition: WorldDefinition,
  state: SimulationState,
  direct: TransitionProposalDraft,
  checkAliases: ReadonlyMap<string, string | null>,
  randomAliases: ReadonlyMap<string, string | null>,
  identityOwner: string,
): TransitionProposal {
  const mechanicAliases = new Map<string, string>();
  for (const [ordinal, invocation] of direct.mechanicInvocations.entries()) {
    if (mechanicAliases.has(invocation.id)) throw new Error(`duplicate mechanic alias ${invocation.id}`);
    mechanicAliases.set(invocation.id, runtimeId({
      worldHash: state.worldHash,
      revision: state.revision,
      kind: "mechanic",
      stage: "transition",
      owner: identityOwner,
      round: 0,
      ordinal,
    }));
  }
  const eventAliases = new Map<string, string>();
  for (const [ordinal, event] of direct.events.entries()) {
    if (eventAliases.has(event.id)) throw new Error(`duplicate event alias ${event.id}`);
    eventAliases.set(event.id, runtimeId({
      worldHash: state.worldHash,
      revision: state.revision,
      kind: "event",
      stage: "transition",
      owner: identityOwner,
      round: 0,
      ordinal,
    }));
  }
  const rewriteCause = (cause: CausalRef): CausalRef => {
    const checkId = cause.kind === "check" ? checkAliases.get(cause.id) : undefined;
    if (checkId) {
      return { ...cause, id: checkId };
    }
    const randomId = cause.kind === "random" ? randomAliases.get(cause.id) : undefined;
    if (randomId) {
      return { ...cause, id: randomId };
    }
    if (cause.kind === "mechanic" && mechanicAliases.has(cause.id)) {
      return { ...cause, id: mechanicAliases.get(cause.id)! };
    }
    if (cause.kind === "event" && eventAliases.has(cause.id)) {
      return { ...cause, id: eventAliases.get(cause.id)! };
    }
    return structuredClone(cause);
  };
  const rewriteAssertion = (assertion: CausalAssertion): CausalAssertion => {
    const checkId = assertion.kind === "check_result" ? checkAliases.get(assertion.checkId) : undefined;
    if (assertion.kind === "check_result" && checkId) {
      return { ...structuredClone(assertion), checkId };
    }
    const randomId = assertion.kind === "random_result" ? randomAliases.get(assertion.requestId) : undefined;
    if (assertion.kind === "random_result" && randomId) {
      return { ...structuredClone(assertion), requestId: randomId };
    }
    return structuredClone(assertion);
  };
  const rewriteMechanicInput = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(rewriteMechanicInput);
    if (!value || typeof value !== "object") return structuredClone(value);
    return Object.fromEntries(Object.entries(value).map(([key, item]) => {
      if (key === "checkId" && typeof item === "string" && checkAliases.get(item)) {
        return [key, checkAliases.get(item)!];
      }
      if (key === "requestId" && typeof item === "string" && randomAliases.get(item)) {
        return [key, randomAliases.get(item)!];
      }
      return [key, rewriteMechanicInput(item)];
    }));
  };
  return {
    ...structuredClone(direct),
    baseRevision: state.revision,
    mechanicInvocations: direct.mechanicInvocations.map((invocation) => ({
      ...structuredClone(invocation),
      id: mechanicAliases.get(invocation.id)!,
      causes: invocation.causes.map(rewriteCause),
      assertions: invocation.assertions.map(rewriteAssertion),
      input: rewriteMechanicInput(invocation.input),
    })),
    operations: direct.operations.map((operation) =>
      materializeWorldOperation(state, definition, operation, rewriteCause, rewriteAssertion)),
    events: direct.events.map((event) => ({
      ...structuredClone(event),
      id: eventAliases.get(event.id)!,
      step: state.step + 1,
      causes: event.causes.map(rewriteCause),
      assertions: event.assertions.map(rewriteAssertion),
    })),
    outcomes: direct.outcomes.map((outcome, ordinal) => ({
      ...structuredClone(outcome),
      id: runtimeId({
        worldHash: state.worldHash,
        revision: state.revision,
        kind: "outcome",
        stage: "transition",
        owner: outcome.proposalId,
        round: 0,
        ordinal,
      }),
      causeRefs: outcome.causeRefs.map(rewriteCause),
      assertions: outcome.assertions.map(rewriteAssertion),
      knownAlternatives: outcome.knownAlternatives.map((alternative) => structuredClone(alternative)),
    })),
    observations: [],
  };
}

function validateTransitionEnvelope(
  input: TruthResolutionInput,
  actions: readonly AgentActionProposal[],
  proposal: TransitionProposal,
  checks: readonly D20CheckResult[],
  randomResults: readonly DiscreteRandomResult[],
): void {
  const proposalIds = actions.map((action) => action.id);
  const outcomeIds = proposal.outcomes.map((outcome) => outcome.proposalId);
  if (new Set(outcomeIds).size !== outcomeIds.length) throw new Error("transition has duplicate action outcomes");
  if (proposalIds.length !== outcomeIds.length || proposalIds.some((id) => !outcomeIds.includes(id))) {
    throw new Error("transition must contain exactly one outcome for every final joint action");
  }
  if (proposal.baseRevision !== input.state.revision) throw new Error("transition has a stale base revision");

  const historicalAgentIds = new Set([
    ...Object.keys(input.state.historyBase?.agents ?? {}),
    ...Object.keys(input.state.agents),
    ...input.state.history.flatMap((step) => step.operations
      .filter((operation) => operation.kind === "create_agent")
      .map((operation) => operation.agent.id)),
  ]);
  const historicalAgentEntities = new Set([
    ...Object.values(input.state.historyBase?.agents ?? {}).map((agent) => agent.entityId),
    ...Object.values(input.state.agents).map((agent) => agent.entityId),
    ...input.state.history.flatMap((step) => step.operations
      .filter((operation) => operation.kind === "create_agent")
      .map((operation) => operation.agent.entityId)),
  ]);
  for (const operation of proposal.operations) {
    if (operation.kind !== "create_agent") continue;
    if (historicalAgentIds.has(operation.agent.id)) {
      throw new Error(`agent identity was already used: ${operation.agent.id}`);
    }
    if (historicalAgentEntities.has(operation.agent.entityId)) {
      throw new Error(`agent entity was already bound: ${operation.agent.entityId}`);
    }
    historicalAgentIds.add(operation.agent.id);
    historicalAgentEntities.add(operation.agent.entityId);
  }

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
    random: new Set(randomResults.map((result) => result.requestId)),
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

  for (const action of actions) {
    const outcome = proposal.outcomes.find((candidate) => candidate.proposalId === action.id)!;
    if ((outcome.status === "failed" || outcome.status === "blocked") && !outcome.summary.trim()) {
      throw new Error(`failed outcome for ${action.actorId} requires an understandable summary`);
    }
    const observationIds = new Set(proposal.observations
      .filter((packet) => packet.observerId === action.actorId)
      .map((packet) => packet.id));
    const belief = input.state.agents[action.actorId]?.belief;
    for (const alternative of outcome.knownAlternatives) {
      if (alternative.basis.kind === "knowledge") {
        for (const evidenceId of alternative.basis.evidenceIds) {
          if (!belief?.evidence[evidenceId]) {
            throw new Error(`outcome alternative for ${action.actorId} references unknown evidence ${evidenceId}`);
          }
        }
      } else if (!observationIds.has(alternative.basis.observationId)) {
        throw new Error(`outcome alternative for ${action.actorId} references unknown observation ${alternative.basis.observationId}`);
      }
    }
  }
}

export class TruthEngine {
  private readonly repairAttempts: number;
  private readonly maxCommitmentRounds: number;
  private readonly rulePackages: RulePackageRegistry;

  constructor(
    private readonly provider: StructuredModelProvider,
    options: TruthEngineOptions = {},
  ) {
    this.repairAttempts = options.repairAttempts ?? 2;
    this.maxCommitmentRounds = options.maxCommitmentRounds ?? MAX_COMMITMENT_ROUNDS_PER_STEP;
    if (!Number.isSafeInteger(this.maxCommitmentRounds) || this.maxCommitmentRounds < 0 ||
      this.maxCommitmentRounds > MAX_COMMITMENT_ROUNDS_PER_STEP) {
      throw new Error(`maxCommitmentRounds must be an integer from 0 to ${MAX_COMMITMENT_ROUNDS_PER_STEP}`);
    }
    this.rulePackages = options.rulePackages ?? createCoreRulePackageRegistry();
  }

  async resolve(input: TruthResolutionInput, scope: ModelExecutionScope): Promise<TruthResolution> {
    const truthSubject = input.identityOwner;
    let actions = input.initialActions.map((action) => structuredClone(action));
    if (input.temporalBoundary.fromElapsedSeconds !== input.state.truth.elapsedSeconds ||
      input.temporalBoundary.toElapsedSeconds !== input.state.truth.elapsedSeconds + input.temporalBoundary.deltaSeconds ||
      !Number.isSafeInteger(input.temporalBoundary.deltaSeconds) || input.temporalBoundary.deltaSeconds <= 0) {
      throw new Error("truth resolution requires an engine-selected future temporal boundary");
    }
    const allowedForCommitments: Record<CausalRef["kind"], Set<string>> = {
      action: new Set(actions.map((action) => action.id)),
      check: new Set(),
      random: new Set(),
      event: new Set(input.state.truth.events.map((event) => event.id)),
      fact: new Set(Object.keys(input.state.truth.facts)),
      law: new Set(input.definition.laws.map((law) => law.id)),
      mechanic: new Set(),
    };
    let rng = structuredClone(input.state.truth.rng);
    const checks: D20CheckResult[] = [];
    const requests: D20CheckRequest[] = [];
    const requestIds = new Set<string>();
    const checkAliases = new Map<string, string | null>();
    const randomRequests: DiscreteRandomRequest[] = [];
    const randomResults: DiscreteRandomResult[] = [];
    const commitmentRounds: CommitmentRound[] = [];
    const randomRequestIds = new Set(input.state.history.flatMap((step) =>
      step.randomRequests.map((request) => request.id)));
    const randomAliases = new Map<string, string | null>();
    let reactionRequests: ReactionRequest[] = [];
    let reactionDecisions: ReactionDecision[] = [];
    let reactionModelAudits: ModelExecutionAudit[] = [];
    const modelAudits: ModelExecutionAudit[] = [];
    let randomStarted = false;
    let randomRngDrawsBefore: number | null = null;
    const combineStageAudits = (audits: readonly ModelExecutionAudit[]) =>
      combineModelExecutionAudits(audits);

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
      committedRandomRequests: randomRequests,
      randomResults,
      commitmentRounds,
      groundings: input.groundings,
      temporalBoundary: input.temporalBoundary,
      instanceId: scope.workloadId,
      advanceId: scope.batchId,
      issues,
      stage,
    });

    const normalizeCheckRound = (
      round: readonly D20CheckRequestDraft[],
      phase: "perception" | "resolution",
    ): D20CheckRequest[] => {
      if (commitmentRounds.length >= this.maxCommitmentRounds) {
        throw new Error("maximum commitment rounds exceeded");
      }
      if (randomStarted) throw new Error("d20 checks cannot be requested after discrete random commitments");
      const aliases = new Map<string, string>();
      for (const [ordinal, request] of round.entries()) {
        if (aliases.has(request.id)) throw new Error(`duplicate check request alias ${request.id}`);
        const canonicalId = runtimeId({
          worldHash: input.state.worldHash,
          revision: input.state.revision,
          kind: "check",
          stage: phase,
          owner: input.identityOwner,
          round: commitmentRounds.length,
          ordinal,
        });
        aliases.set(request.id, canonicalId);
        // Draft aliases are round-local. A repeated spelling is deliberately
        // marked ambiguous so transition drafts must use the canonical rt id
        // exposed in committed context rather than silently binding a round.
      }
      const normalized = round.map((request) => ({
        ...structuredClone(request),
        id: aliases.get(request.id)!,
        phase,
        causes: request.causes.map((cause) => cause.kind === "check" && aliases.has(cause.id)
          ? { ...cause, id: aliases.get(cause.id)! }
          : structuredClone(cause)),
      }));
      for (const request of normalized) {
        if (requestIds.has(request.id)) throw new Error(`duplicate check request ${request.id}`);
        validateCheckRequest(
          input.state,
          request,
          allowedForCommitments,
          input.definition.disclosure.defaultCheckVisibility,
        );
      }
      return normalized;
    };

    const commitCheckRound = (round: readonly D20CheckRequest[]) => {
      const resolved = resolveD20Checks(rng, round);
      rng = resolved.rng;
      requests.push(...structuredClone(round));
      checks.push(...resolved.results);
      for (const request of round) {
        requestIds.add(request.id);
        allowedForCommitments.check.add(request.id);
      }
      commitmentRounds.push({
        kind: "check",
        phase: round[0]!.phase,
        requestIds: round.map((request) => request.id),
      });
    };

    const registerCheckAliases = (
      draft: readonly D20CheckRequestDraft[],
      normalized: readonly D20CheckRequest[],
    ): void => {
      draft.forEach((request, index) => {
        const canonicalId = normalized[index]!.id;
        checkAliases.set(request.id, checkAliases.has(request.id) ? null : canonicalId);
      });
    };

    const normalizeRandomRound = (
      round: readonly DiscreteRandomRequestProposal[],
    ): DiscreteRandomRequest[] => {
      if (commitmentRounds.length >= this.maxCommitmentRounds) {
        throw new Error("maximum commitment rounds exceeded");
      }
      if (round.length > MAX_RANDOM_REQUESTS_PER_ROUND) {
        throw new Error("discrete random round exceeds request limit");
      }
      const aliases = new Map<string, string>();
      for (const [ordinal, request] of round.entries()) {
        if (aliases.has(request.id)) throw new Error(`duplicate random request alias ${request.id}`);
        const canonicalId = runtimeId({
          worldHash: input.state.worldHash,
          revision: input.state.revision,
          kind: "random",
          stage: "resolution",
          owner: input.identityOwner,
          round: commitmentRounds.length,
          ordinal,
        });
        aliases.set(request.id, canonicalId);
      }
      const normalized = round.map((request) => {
        const canonicalId = aliases.get(request.id)!;
        const causes = request.causes.map((cause) => cause.kind === "random" && aliases.has(cause.id)
          ? { ...cause, id: aliases.get(cause.id)! }
          : structuredClone(cause));
        if (randomRequestIds.has(canonicalId)) {
          throw new Error(`duplicate random request ${canonicalId}`);
        }
        for (const cause of causes) {
          validateCausalReference(cause, allowedForCommitments, `random request ${canonicalId}`);
        }
        const distribution = input.definition.randomDistributions.find((candidate) =>
          candidate.id === request.distributionId);
        if (!distribution) {
          throw new Error(`random request ${canonicalId} references unknown distribution ${request.distributionId}`);
        }
        return {
          ...structuredClone(request),
          id: canonicalId,
          causes,
          distribution: structuredClone(distribution),
        };
      });
      validateDiscreteRandomCommitmentBudget([...randomRequests, ...normalized]);
      return normalized;
    };

    const commitRandomRound = (round: readonly DiscreteRandomRequest[]) => {
      const resolved = resolveDiscreteRandomRequests(rng, round);
      const firstRandomDraw = randomRngDrawsBefore ?? rng.draws;
      validateDiscreteRandomCommitmentBudget(
        [...randomRequests, ...round],
        [...randomResults, ...resolved.results],
        resolved.rng.draws - firstRandomDraw,
      );
      randomRngDrawsBefore = firstRandomDraw;
      rng = resolved.rng;
      randomRequests.push(...structuredClone(round));
      randomResults.push(...resolved.results);
      for (const request of round) {
        randomRequestIds.add(request.id);
        allowedForCommitments.random.add(request.id);
      }
      randomStarted = true;
      commitmentRounds.push({ kind: "random", requestIds: round.map((request) => request.id) });
    };

    const registerRandomAliases = (
      draft: readonly DiscreteRandomRequestProposal[],
      normalized: readonly DiscreteRandomRequest[],
    ): void => {
      draft.forEach((request, index) => {
        const canonicalId = normalized[index]!.id;
        randomAliases.set(request.id, randomAliases.has(request.id) ? null : canonicalId);
      });
    };

    const perceptionAudits: ModelExecutionAudit[] = [];
    while (true) {
      let acceptedRound: D20CheckRequest[] | null = null;
      const call = await generateValidated({
        provider: this.provider,
        profileId: input.definition.modelProfiles.perception,
        role: "truth-perception",
        subjectId: truthSubject,
        promptVersion: TRUTH_PROMPT_VERSION,
        schemaName: "truth_perception_directive",
        system: TRUTH_SYSTEM,
        schema: perceptionDirectiveSchema,
        scope,
        buildContext: (issues) => truthContext("perception", issues),
        validate: (directive) => {
          if (directive.kind === "request_checks") {
            acceptedRound = normalizeCheckRound(directive.requests, "perception");
          }
        },
        repairAttempts: this.repairAttempts,
        invocationOffset: perceptionAudits.reduce((count, audit) => count + audit.invocations.length, 0),
      });
      perceptionAudits.push(call.audit);
      if (call.value.kind === "done") break;
      if (!acceptedRound) throw new Error("accepted perception round was not materialized");
      registerCheckAliases(call.value.requests, acceptedRound);
      commitCheckRound(acceptedRound);
    }
    modelAudits.push(combineStageAudits(perceptionAudits));

    const routing = await generateValidated({
      provider: this.provider,
      profileId: input.definition.modelProfiles.reactionRouting,
      role: "truth-reaction-routing",
      subjectId: truthSubject,
      promptVersion: TRUTH_PROMPT_VERSION,
      schemaName: "truth_reaction_routing",
      system: TRUTH_SYSTEM,
      schema: reactionRoutingOutputSchema,
      scope,
      buildContext: (issues) => truthContext("reaction-routing", issues),
      validate: (output) => validateReactionRequests(
        input,
        materializeReactionRequests(input.state, output.requests),
        requests,
        checks,
      ),
      repairAttempts: this.repairAttempts,
    });
    modelAudits.push(routing.audit);
    reactionRequests = materializeReactionRequests(input.state, routing.value.requests);
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
      allowedForCommitments.action = new Set(actions.map((action) => action.id));
    }

    const resolutionAudits: ModelExecutionAudit[] = [];
    while (true) {
      let acceptedChecks: D20CheckRequest[] | null = null;
      let acceptedRandom: DiscreteRandomRequest[] | null = null;
      const call = await generateValidated({
        provider: this.provider,
        profileId: input.definition.modelProfiles.resolution,
        role: "truth-resolution",
        subjectId: truthSubject,
        promptVersion: TRUTH_PROMPT_VERSION,
        schemaName: "truth_resolution_directive",
        system: TRUTH_SYSTEM,
        schema: resolutionDirectiveSchema,
        scope,
        buildContext: (issues) => truthContext("resolution", issues),
        validate: (directive) => {
          if (directive.kind === "request_checks") {
            acceptedChecks = normalizeCheckRound(directive.requests, "resolution");
          } else if (directive.kind === "request_random") {
            acceptedRandom = normalizeRandomRound(directive.requests);
          }
        },
        repairAttempts: this.repairAttempts,
        invocationOffset: resolutionAudits.reduce((count, audit) => count + audit.invocations.length, 0),
      });
      resolutionAudits.push(call.audit);
      if (call.value.kind === "done") break;
      if (call.value.kind === "request_checks") {
        if (!acceptedChecks) throw new Error("accepted resolution check round was not materialized");
        registerCheckAliases(call.value.requests, acceptedChecks);
        commitCheckRound(acceptedChecks);
      } else {
        if (!acceptedRandom) throw new Error("accepted random round was not materialized");
        registerRandomAliases(call.value.requests, acceptedRandom);
        commitRandomRound(acceptedRandom);
      }
    }
    modelAudits.push(combineStageAudits(resolutionAudits));

    const stimulusObservations = reactionRequests.map((request) => request.stimulus);
    let transitionIssues: PromptValidationIssue[] = [];
    let transitionRepairs = 0;
    let previousReport: CausalVerification | null = null;
    const transitionAudits: ModelExecutionAudit[] = [];
    const verifierAudits: ModelExecutionAudit[] = [];
    const observationAudits: ModelExecutionAudit[] = [];
    const observe = runtimeEventEmitter(scope.observer);

    while (true) {
      const auditCountBeforeAttempt = transitionAudits.length;
      try {
        const contextStartedAt = Date.now();
        const context = truthContext("transition", transitionIssues);
        const invocation = transitionAudits.reduce((count, audit) => count + audit.invocations.length, 0) + 1;
        const identity = modelInvocationIdentity(
          scope,
          "truth-transition",
          truthSubject,
          invocation,
        );
        const correlation = modelInvocationCorrelation(
          scope,
          "truth-transition",
          truthSubject,
          identity,
        );
        observe?.({
          event: "model.context.built",
          correlation,
          durationMs: Math.max(0, Date.now() - contextStartedAt),
          hashes: { context: contentHash(context) },
        });
        const generated = await this.provider.generateStructured({
          profileId: input.definition.modelProfiles.transition,
          workloadId: scope.workloadId,
          batchId: scope.batchId,
          abortSignal: scope.abortSignal,
          correlation: scope.correlation,
          observer: scope.observer,
          ...identity,
          role: "truth-transition",
          subjectId: truthSubject,
          promptVersion: TRUTH_PROMPT_VERSION,
          schemaName: "truth_transition",
          system: TRUTH_SYSTEM,
          context,
          schema: transitionProposalSchema,
        });
        transitionAudits.push(generated.audit);
        setModelInvocationResultKind(generated.audit, "truth-transition_transition");
        const materializedProposal = materializeTransitionProposal(
          input.definition,
          input.state,
          generated.value,
          checkAliases,
          randomAliases,
          input.identityOwner,
        );
        const normalizedAlternatives = normalizeOutcomeAlternativeEvidence(
          input.state,
          actions,
          materializedProposal,
        );
        const directProposal = normalizedAlternatives.proposal;
        if (normalizedAlternatives.droppedReferences > 0 || normalizedAlternatives.droppedAlternatives > 0) {
          observe?.({
            event: "algorithm.outcome.alternative_evidence_normalized",
            level: "warn",
            correlation,
            attributes: { phase: "transition" },
            counts: {
              droppedOutcomeAlternativeEvidenceReferences: normalizedAlternatives.droppedReferences,
              droppedOutcomeAlternatives: normalizedAlternatives.droppedAlternatives,
            },
          });
        }
        const mechanics = this.rulePackages.resolve(input.definition.rulePackages, {
          state: input.state,
          actions,
          checkRequests: requests,
          checkResults: checks,
          randomRequests,
          randomResults,
        }, directProposal.mechanicInvocations, directProposal.operations);
        const proposal: TransitionProposal = {
          ...structuredClone(directProposal),
          mechanicInvocations: mechanics.invocations,
          operations: [
            ...structuredClone(directProposal.operations),
            ...mechanics.operations,
            {
              kind: "advance_time",
              seconds: input.temporalBoundary.deltaSeconds,
              causes: actions.map((action) => ({ kind: "action" as const, id: action.id })),
              assertions: [{
                kind: "elapsed_seconds_compare" as const,
                operator: "eq" as const,
                value: input.state.truth.elapsedSeconds,
              }],
            },
          ],
        };

        const rendered = await input.renderObservations(proposal, actions, transitionRepairs);
        proposal.observations = structuredClone(rendered.packets);
        observationAudits.push(...structuredClone(rendered.modelAudits));

        validateTransitionEnvelope(input, actions, proposal, checks, randomResults);
        const causalAssertionResults = evaluateProposalCausality(input.state, checks, randomResults, proposal);
        input.validateProposal(proposal, checks, randomResults, actions, stimulusObservations);

        const verification = await generateValidated({
          provider: this.provider,
          profileId: input.definition.modelProfiles.causalVerifier,
          role: "causal-verifier",
          subjectId: truthSubject,
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
            randomRequests,
            randomResults,
            commitmentRounds,
            proposal,
            assertionResults: causalAssertionResults,
            mechanicResults: mechanics.results,
            previousReport,
            instanceId: scope.workloadId,
            advanceId: scope.batchId,
            issues,
          }),
          validate: (report) => {
            if (report.verdict !== "reject") return;
            const targets = new Set([
              ...requests.map((request) => `check:${request.id}`),
              ...randomRequests.map((request) => `random:${request.id}`),
              ...proposal.operations.map((operation, index) => `operation:${index}:${operation.kind}`),
              ...proposal.mechanicInvocations.map((invocation) => `mechanic:${invocation.id}`),
              ...proposal.events.map((event) => `event:${event.id}`),
              ...proposal.outcomes.map((outcome) => `outcome:${outcome.id}`),
              ...proposal.observations.map((observation) => `observation:${observation.id}`),
            ]);
            for (const finding of report.findings) {
              if (!targets.has(`${finding.target.kind}:${finding.target.id}`)) {
                throw new Error(`causal verifier references unknown target ${finding.target.kind}:${finding.target.id}`);
              }
            }
          },
          repairAttempts: this.repairAttempts,
          invocationOffset: verifierAudits.reduce((count, audit) => count + audit.invocations.length, 0),
        });
        verifierAudits.push(verification.audit);
        if (verification.value.verdict === "reject") {
          previousReport = structuredClone(verification.value);
          throw new Error(`causal verifier rejected transition: ${verification.value.findings
            .map((finding) => `${finding.code}: ${finding.message}; ${finding.repairHint}`)
            .join(" | ")}`);
        }

        setModelInvocationOutcome(generated.audit, "accepted");
        observe?.({
          event: "model.semantic.accepted",
          correlation,
          attributes: { resultKind: "truth-transition_transition" },
        });
        modelAudits.push(combineModelExecutionAudits(transitionAudits));
        modelAudits.push(...structuredClone(observationAudits));
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
          randomRequests: structuredClone(randomRequests),
          randomResults: structuredClone(randomResults),
          commitmentRounds: structuredClone(commitmentRounds),
          rng,
          mechanicResults: structuredClone(mechanics.results),
          causalAssertionResults: structuredClone(causalAssertionResults),
          causalVerification: structuredClone(verification.value),
          modelAudits,
          reactionModelAudits: structuredClone(reactionModelAudits),
        };
      } catch (error) {
        if (error instanceof ModelSemanticRepairError &&
          (error.role === "causal-verifier" || error.role === "observation-renderer")) throw error;
        if (error instanceof ModelConfigurationError || error instanceof ModelTransportError ||
          error instanceof ModelOverloadedError || (error instanceof Error && error.name === "AbortError")) {
          throw error;
        }
        if (error instanceof ModelOutputError && error.audit) transitionAudits.push(error.audit);
        if (transitionAudits.length === auditCountBeforeAttempt) throw error;
        if (!(error instanceof ModelOutputError) && !(error instanceof z.ZodError) && !(error instanceof Error)) {
          throw error;
        }
        transitionIssues = validationIssues(error);
        const audit = transitionAudits.at(-1);
        if (audit) setModelInvocationOutcome(audit, "rejected", transitionIssues.map((issue) => issue.code));
        const invocation = audit?.invocations.at(-1);
        observe?.({
          event: "model.semantic.rejected",
          level: "warn",
          correlation: modelInvocationCorrelation(scope, "truth-transition", truthSubject, {
            modelInvocationId: invocation?.id,
            modelInvocation: invocation?.ordinal,
          }),
          attributes: { resultKind: invocation?.resultKind ?? null },
          counts: { validationIssues: transitionIssues.length },
          hashes: invocation?.responseHash ? { response: invocation.responseHash } : undefined,
          error: serializeRuntimeError(error),
        });
        transitionRepairs += 1;
        if (transitionRepairs > this.repairAttempts) {
          const message = error instanceof Error ? error.message : String(error);
          throw new ModelSemanticRepairError(
            "truth-transition",
            `truth-transition failed after repairs: ${message}`,
            { cause: error },
          );
        }
      }
    }
  }
}
