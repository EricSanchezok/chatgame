import { z } from "zod";
import { evaluateProposalCausality } from "./causality";
import {
  causalVerificationSchema,
  perceptionDirectiveSchema,
  reactionRoutingOutputSchema,
  resolutionDirectiveSchema,
  resolutionPlanVerificationSchema,
  transitionProposalSchema,
  type DiscreteRandomRequestProposal,
  type ReactionRequestDraft,
  type ResolutionPlanDraft,
} from "../contracts/llm-schemas";
import type {
  InteractionDependency,
  WorldResolutionCandidate,
} from "../runtime/execution";
import type {
  AgentActionProposal,
  CausalAssertion,
  CausalRef,
  CausalVerification,
  CommitmentRound,
  D20CheckRequest,
  D20CheckRequestDraft,
  D20CheckResult,
  DiscreteRandomRequest,
  DiscreteRandomResult,
  ModelExecutionAudit,
  MechanicInvocation,
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
} from "../contracts/model";
import {
  deriveCheck,
  deriveResolutionReceipt,
  expectedActionStatus,
  validateResolutionPlan,
  type ResolutionEvidenceIndex,
  type ResolutionPlan,
  type ResolutionReceipt,
  type ResolutionSourceRef,
} from "./resolution";
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
} from "../models/model-provider";
import { contentHash } from "../models/model-audit";
import { ModelOverloadedError } from "../models/model-scheduler";
import { runtimeEventEmitter, serializeRuntimeError } from "../runtime/observability";
import { validateObservations } from "../cognition/observation";
import {
  buildCausalVerificationContext,
  buildResolutionPlanVerificationContext,
  buildTruthContext,
  validationIssues,
  type PromptValidationIssue,
} from "../contracts/prompts";
import { promptBundle, type PromptBundleId } from "../prompts";
import {
  resolveD20Checks,
  resolveDiscreteRandomRequests,
  validateDiscreteRandomCommitmentBudget,
} from "./random";
import { MAX_RANDOM_REQUESTS_PER_ROUND } from "./random-limits";
import { createCoreRulePackageRegistry, type RulePackageRegistry } from "./rule-package";
import type { WorldDefinition } from "../runtime/world-definition";
import type { ModelRole } from "../models/model-catalog";
import { runtimeId } from "../runtime/runtime-id";
import type { TemporalBoundary } from "./temporal";

export interface ReactionResolution {
  decisions: ReactionDecision[];
  groundings: InteractionDependency[];
  modelAudits: ModelExecutionAudit[];
}

export interface ObservationResolution {
  packets: ObservationPacket[];
  modelAudits: ModelExecutionAudit[];
}

export interface TruthResolution extends WorldResolutionCandidate {
  modelAudits: ModelExecutionAudit[];
  reactionModelAudits: ModelExecutionAudit[];
}

export interface TruthResolutionInput {
  definition: WorldDefinition;
  state: SimulationState;
  initialActions: AgentActionProposal[];
  temporalBoundary: TemporalBoundary;
  identityOwner: string;
  groundings: readonly InteractionDependency[];
  enableReactionRouting?: boolean;
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

export interface OnsetPerceptionInput {
  definition: WorldDefinition;
  state: SimulationState;
  actions: AgentActionProposal[];
  temporalBoundary: TemporalBoundary;
  identityOwner: string;
  groundings: readonly InteractionDependency[];
}

export interface OnsetPerceptionResult {
  requests: D20CheckRequest[];
  checks: D20CheckResult[];
  commitmentRounds: CommitmentRound[];
  rng: SimulationState["truth"]["rng"];
  modelAudit: ModelExecutionAudit;
  aliases: Array<[string, string | null]>;
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
  promptId: PromptBundleId;
  schemaName: string;
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
      const prompt = promptBundle(input.promptId);
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
        promptVersion: prompt.version,
        schemaName: input.schemaName,
        system: prompt.system,
        userPrompt: prompt.userPrompt,
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
    const rating = state.truth.ratings[source.id];
    if (!rating) throw new Error(`check ${request.id} has unknown rating modifier ${source.id}`);
    if (rating.value !== source.amount) {
      throw new Error(`check ${request.id} misstates rating modifier ${source.id}`);
    }
  }
  for (const cause of request.causes) validateCausalReference(cause, allowed, `check ${request.id}`);
  const visibilityRank = { hidden: 0, result_only: 1, full: 2 } as const;
  if (visibilityRank[request.visibility] > visibilityRank[maximumVisibility]) {
    throw new Error(`check ${request.id} exceeds world disclosure policy ${maximumVisibility}`);
  }
}

async function runOnsetPerceptionStage(input: Readonly<OnsetPerceptionInput> & {
  provider: StructuredModelProvider;
  repairAttempts: number;
  maxCommitmentRounds: number;
  scope: ModelExecutionScope;
}): Promise<OnsetPerceptionResult> {
  const ratingIdsByActor = new Map<string, string[]>();
  for (const rating of Object.values(input.state.truth.ratings)) {
    const ids = ratingIdsByActor.get(rating.entityId) ?? [];
    ids.push(rating.id);
    ratingIdsByActor.set(rating.entityId, ids);
  }
  for (const ids of ratingIdsByActor.values()) ids.sort();
  const perceptionSchema = perceptionDirectiveSchema.superRefine((directive, refinement) => {
    if (directive.kind !== "request_checks") return;
    for (const [index, request] of directive.requests.entries()) {
      if (request.ratingId && !(ratingIdsByActor.get(request.actorId) ?? []).includes(request.ratingId)) {
        const allowed = ratingIdsByActor.get(request.actorId) ?? [];
        refinement.addIssue({
          code: "custom",
          path: ["requests", index, "ratingId"],
          message: `ratingId must be null or one of the actor's ratings: ${allowed.join(", ") || "(none)"}`,
        });
      }
      for (const [sourceIndex, source] of request.modifierSources.entries()) {
        const rating = input.state.truth.ratings[source.id];
        if (!rating || rating.entityId !== request.actorId || rating.value !== source.amount) {
          refinement.addIssue({
            code: "custom",
            path: ["requests", index, "modifierSources", sourceIndex],
            message: "modifier source must name one rating owned by actorId and copy its canonical value",
          });
        }
      }
    }
  });
  const allowed: Record<CausalRef["kind"], Set<string>> = {
    action: new Set(input.actions.map((action) => action.id)),
    check: new Set(),
    random: new Set(),
    event: new Set(input.state.truth.events.map((event) => event.id)),
    fact: new Set(Object.keys(input.state.truth.facts)),
    law: new Set(input.definition.laws.map((law) => law.id)),
    mechanic: new Set(),
  };
  const requests: D20CheckRequest[] = [];
  const checks: D20CheckResult[] = [];
  const commitmentRounds: CommitmentRound[] = [];
  const aliases = new Map<string, string | null>();
  const audits: ModelExecutionAudit[] = [];
  let rng = structuredClone(input.state.truth.rng);

  while (true) {
    const accepted = { round: null as D20CheckRequest[] | null };
    let draftRound: D20CheckRequestDraft[] = [];
    const call = await generateValidated({
      provider: input.provider,
      profileId: input.definition.modelProfiles.perception,
      role: "truth-perception",
      subjectId: input.identityOwner,
      promptId: "truth-perception",
      schemaName: "truth_perception_directive",
      schema: perceptionSchema,
      scope: input.scope,
      buildContext: (issues) => buildTruthContext({
        definition: input.definition,
        state: input.state,
        initialActions: input.actions,
        actions: input.actions,
        reactionRequests: [],
        reactionDecisions: [],
        reactionWindow: "open",
        committedCheckRequests: requests,
        checkResults: checks,
        committedRandomRequests: [],
        randomResults: [],
        commitmentRounds,
        resolutionPlans: [],
        resolutionReceipts: [],
        groundings: input.groundings,
        temporalBoundary: input.temporalBoundary,
        instanceId: input.scope.workloadId,
        advanceId: input.scope.batchId,
        issues,
        stage: "perception",
      }),
      validate: (directive) => {
        if (directive.kind !== "request_checks") return;
        if (commitmentRounds.length >= input.maxCommitmentRounds) {
          throw new Error("maximum commitment rounds exceeded");
        }
        draftRound = structuredClone(directive.requests);
        const roundAliases = new Map<string, string>();
        for (const [ordinal, request] of directive.requests.entries()) {
          if (roundAliases.has(request.id)) throw new Error(`duplicate check request alias ${request.id}`);
          roundAliases.set(request.id, runtimeId({
            worldHash: input.state.worldHash,
            revision: input.state.revision,
            kind: "check",
            stage: "perception",
            owner: input.identityOwner,
            round: commitmentRounds.length,
            ordinal,
          }));
        }
        const normalized = directive.requests.map((request) => ({
          ...structuredClone(request),
          id: roundAliases.get(request.id)!,
          phase: "perception" as const,
          causes: request.causes.map((cause) => cause.kind === "check" && roundAliases.has(cause.id)
            ? { ...cause, id: roundAliases.get(cause.id)! }
            : structuredClone(cause)),
        }));
        for (const request of normalized) {
          validateCheckRequest(
            input.state,
            request,
            allowed,
            input.definition.disclosure.defaultCheckVisibility,
          );
        }
        accepted.round = normalized;
      },
      repairAttempts: input.repairAttempts,
      invocationOffset: audits.reduce((count, audit) => count + audit.invocations.length, 0),
    });
    audits.push(call.audit);
    if (call.value.kind === "done") break;
    const acceptedRound = accepted.round;
    if (!acceptedRound) throw new Error("accepted perception round was not materialized");
    const resolved = resolveD20Checks(rng, acceptedRound);
    rng = resolved.rng;
    requests.push(...structuredClone(acceptedRound));
    checks.push(...resolved.results);
    commitmentRounds.push({
      kind: "check",
      phase: "perception",
      requestIds: acceptedRound.map((request) => request.id),
    });
    acceptedRound.forEach((request) => allowed.check.add(request.id));
    draftRound.forEach((request, index) => {
      const canonicalId = acceptedRound![index]!.id;
      aliases.set(request.id, aliases.has(request.id) ? null : canonicalId);
    });
  }

  return {
    requests,
    checks,
    commitmentRounds,
    rng,
    modelAudit: combineModelExecutionAudits(audits),
    aliases: [...aliases.entries()],
  };
}

function resolutionEvidenceIndex(
  state: SimulationState,
  actions: readonly AgentActionProposal[],
  laws: readonly { id: string }[],
): ResolutionEvidenceIndex {
  return {
    actions: new Set(actions.map((action) => action.id)),
    entities: new Set(Object.keys(state.truth.entities)),
    facts: new Set(Object.keys(state.truth.facts)),
    conditions: new Set(Object.keys(state.truth.conditions)),
    conditionOwners: new Map(Object.values(state.truth.conditions)
      .map((condition) => [condition.id, condition.subjectId])),
    laws: new Set(laws.map((law) => law.id)),
    placements: new Set(Object.keys(state.truth.entities)),
    ratingOwners: new Map(Object.values(state.truth.ratings).map((rating) => [rating.id, rating.entityId])),
    ratingValues: new Map(Object.values(state.truth.ratings).map((rating) => [rating.id, rating.value])),
  };
}

function groundingContainsSource(grounding: InteractionDependency, source: ResolutionSourceRef): boolean {
  if (grounding.globalFallback || source.kind === "action" || source.kind === "law") return true;
  const kind = source.kind === "entity" || source.kind === "fact" || source.kind === "condition" ||
    source.kind === "rating" || source.kind === "placement"
    ? source.kind
    : null;
  return kind !== null && [...grounding.reads, ...grounding.writes]
    .some((reference) => reference.kind === kind && reference.id === source.id);
}

function validatePlanEffect(
  state: SimulationState,
  plan: ResolutionPlan,
  effect: NonNullable<ResolutionPlan["primaryEffect"]> | NonNullable<ResolutionPlan["threatenedEffect"]>,
): void {
  if (effect.kind === "meter") {
    const meter = state.truth.meters[effect.meterId];
    const profile = state.truth.mechanics.impactProfiles[effect.impactProfileId];
    if (!meter || meter.entityId !== effect.targetId || !profile || profile.meterDefinitionId !== meter.definitionId) {
      throw new Error(`plan ${plan.id} has invalid meter effect ${effect.id}`);
    }
    return;
  }
  const duration = state.truth.mechanics.durationProfiles[effect.durationProfileId];
  const profile = effect.conditionProfileId
    ? state.truth.mechanics.conditionProfiles[effect.conditionProfileId]
    : null;
  if (!duration || (effect.conditionProfileId !== null && !profile) ||
    (profile && profile.defaultDurationProfileId !== effect.durationProfileId)) {
    throw new Error(`plan ${plan.id} has invalid condition effect ${effect.id}`);
  }
  const existing = state.truth.conditions[effect.conditionId];
  if (existing && existing.subjectId !== effect.targetId) {
    throw new Error(`plan ${plan.id} reuses condition ${effect.conditionId} for another subject`);
  }
}

function canonicalActionEntityId(
  state: SimulationState,
  action: AgentActionProposal,
  value: string,
): string {
  if (state.truth.entities[value]) return value;
  const binding = state.agents[action.actorId]?.bindings[value];
  const canonicalIds = binding?.canonicalEntityIds.filter((id) => Boolean(state.truth.entities[id])) ?? [];
  return canonicalIds.length === 1 ? canonicalIds[0]! : value;
}

function canonicalResolutionSource(
  state: SimulationState,
  action: AgentActionProposal,
  source: ResolutionSourceRef,
): ResolutionSourceRef {
  if (source.kind !== "entity") return source;
  return { ...source, id: canonicalActionEntityId(state, action, source.id) };
}

function canonicalResolutionEffect<T extends {
  targetId: string;
  sourceRefs: ResolutionSourceRef[];
}>(state: SimulationState, action: AgentActionProposal, effect: T | null): T | null {
  if (!effect) return null;
  return {
    ...effect,
    targetId: canonicalActionEntityId(state, action, effect.targetId),
    sourceRefs: effect.sourceRefs.map((source) => canonicalResolutionSource(state, action, source)),
  };
}

function materializeResolutionPlans(input: {
  state: SimulationState;
  definition: WorldDefinition;
  actions: readonly AgentActionProposal[];
  groundings: readonly InteractionDependency[];
  identityOwner: string;
  drafts: readonly ResolutionPlanDraft[];
  allowedCauses: Record<CausalRef["kind"], Set<string>>;
}): ResolutionPlan[] {
  if (input.drafts.length !== input.actions.length) {
    throw new Error(
      `resolution plans must cover every final joint action exactly once (expected ${input.actions.length}, received ${input.drafts.length})`,
    );
  }
  const aliases = new Set<string>();
  const actionIds = new Set<string>();
  const conditionSubjects = new Map<string, string>();
  const evidence = resolutionEvidenceIndex(input.state, input.actions, input.definition.laws);
  const visibilityRank = { hidden: 0, result_only: 1, full: 2 } as const;
  const plans = input.drafts.map((draft, ordinal) => {
    if (aliases.has(draft.id)) throw new Error(`duplicate resolution plan alias ${draft.id}`);
    aliases.add(draft.id);
    if (actionIds.has(draft.actionId)) throw new Error(`duplicate resolution plan for action ${draft.actionId}`);
    actionIds.add(draft.actionId);
    const action = input.actions.find((candidate) => candidate.id === draft.actionId);
    if (!action) throw new Error(`resolution plan references unknown action ${draft.actionId}`);
    const actor = input.state.agents[action.actorId];
    if (!actor) throw new Error(`resolution plan ${draft.id} references unknown action actor ${action.actorId}`);
    // The action binding is authoritative for identity and intent.  These two
    // fields are repeated in the draft for provider readability, but accepting
    // a paraphrase (or a stale actor id) would let a model retarget a plan.
    // targetIds are an optional canonical index for the free-form action.  A
    // local belief alias without a unique canonical binding is still valid in
    // the action's natural-language intent, but cannot be persisted as a
    // Truth reference.  Omit only that unresolved index; effects and explicit
    // difficulty targets remain strict and continue to fail closed.
    const targetIds = [...new Set(draft.targetIds.map((targetId) =>
      canonicalActionEntityId(input.state, action, targetId)))].filter((targetId) =>
        Boolean(input.state.truth.entities[targetId]));
    const difficulty = draft.difficulty
      ? draft.difficulty.kind === "opposed"
        ? {
            ...structuredClone(draft.difficulty),
            targetId: canonicalActionEntityId(input.state, action, draft.difficulty.targetId),
            source: canonicalResolutionSource(input.state, action, draft.difficulty.source),
          }
        : {
            ...structuredClone(draft.difficulty),
            source: canonicalResolutionSource(input.state, action, draft.difficulty.source),
          }
      : null;
    const plan: ResolutionPlan = {
      ...structuredClone(draft),
      actorId: actor.entityId,
      goal: action.goal,
      targetIds,
      difficulty,
      means: draft.means.map((mean) => ({
        ...structuredClone(mean),
        source: canonicalResolutionSource(input.state, action, mean.source),
      })),
      factors: draft.factors.map((factor) => ({
        ...structuredClone(factor),
        source: canonicalResolutionSource(input.state, action, factor.source),
      })),
      primaryEffect: canonicalResolutionEffect(input.state, action, draft.primaryEffect),
      secondaryEffect: canonicalResolutionEffect(input.state, action, draft.secondaryEffect),
      threatenedEffect: canonicalResolutionEffect(input.state, action, draft.threatenedEffect),
      id: runtimeId({
        worldHash: input.state.worldHash,
        revision: input.state.revision,
        kind: "resolution-plan",
        stage: "resolution",
        owner: [input.identityOwner, action.id],
        round: 0,
        ordinal,
      }),
    };
    const grounding = input.groundings.find((candidate) =>
      candidate.kind === "action" && candidate.id === action.id);
    if (!grounding) throw new Error(`resolution plan ${plan.id} has no action grounding`);
    for (const mean of plan.means) {
      if (!groundingContainsSource(grounding, mean.source)) {
        throw new Error(`resolution plan ${plan.id} uses means outside its committed grounding`);
      }
    }
    if (visibilityRank[plan.visibility] > visibilityRank[input.definition.disclosure.defaultCheckVisibility]) {
      throw new Error(`resolution plan ${plan.id} exceeds world disclosure policy`);
    }
    if (!plan.causes.some((cause) => cause.kind === "action" && cause.id === action.id)) {
      throw new Error(`resolution plan ${plan.id} does not cite its action`);
    }
    for (const cause of plan.causes) {
      if (cause.kind === "check" || cause.kind === "random" || cause.kind === "mechanic") {
        throw new Error(`resolution plan ${plan.id} cites post-plan evidence`);
      }
      validateCausalReference(cause, input.allowedCauses, `resolution plan ${plan.id}`);
    }
    validateResolutionPlan(plan, evidence);
    for (const effect of [plan.primaryEffect, plan.secondaryEffect, plan.threatenedEffect]) {
      if (!effect) continue;
      validatePlanEffect(input.state, plan, effect);
      if (effect.kind !== "condition") continue;
      const subject = conditionSubjects.get(effect.conditionId);
      if (subject && subject !== effect.targetId) {
        throw new Error(`resolution plans reuse condition ${effect.conditionId} for multiple subjects`);
      }
      conditionSubjects.set(effect.conditionId, effect.targetId);
    }
    return plan;
  });
  if (input.actions.some((action) => !actionIds.has(action.id))) {
    throw new Error("resolution plans omit a final joint action");
  }
  return plans;
}

function checkRequestsForPlans(input: {
  state: SimulationState;
  plans: readonly ResolutionPlan[];
  identityOwner: string;
  round: number;
  allowedCauses: Record<CausalRef["kind"], Set<string>>;
  maximumVisibility: WorldDefinition["disclosure"]["defaultCheckVisibility"];
}): D20CheckRequest[] {
  const baseEvidence = resolutionEvidenceIndex(input.state, [], []);
  const evidence: ResolutionEvidenceIndex = {
    ...baseEvidence,
    actions: new Set(input.plans.map((plan) => plan.actionId)),
  };
  return input.plans.filter((plan) => plan.mode === "check").map((plan, ordinal) => {
    const derived = deriveCheck(plan, evidence);
    if (!Number.isSafeInteger(derived.dc) || !Number.isSafeInteger(derived.modifier)) {
      throw new Error(`resolution plan ${plan.id} derives a non-integer d20 value`);
    }
    const id = runtimeId({
      worldHash: input.state.worldHash,
      revision: input.state.revision,
      kind: "check",
      stage: "resolution",
      owner: [input.identityOwner, plan.id],
      round: input.round,
      ordinal,
    });
    const request: D20CheckRequest = {
      id,
      actorId: plan.actorId,
      targetId: plan.difficulty?.kind === "opposed"
        ? plan.difficulty.targetId
        : plan.primaryEffect?.targetId ?? plan.targetIds[0] ?? null,
      ratingId: plan.actorRatingId,
      modifier: derived.modifier,
      modifierSources: plan.actorRatingId
        ? [{ kind: "rating", id: plan.actorRatingId, amount: derived.modifier }]
        : [],
      dc: derived.dc,
      mode: derived.mode,
      stakes: `${plan.risk}: ${plan.primaryEffect?.description ?? plan.goal}`,
      visibility: plan.visibility,
      phase: "resolution",
      causes: structuredClone(plan.causes),
    };
    validateCheckRequest(input.state, request, input.allowedCauses, input.maximumVisibility);
    return request;
  });
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
    const sourceAction = input.initialActions.find((action) => action.id === request.triggerActionId);
    if (!sourceAction || sourceAction.actorId === request.agentId) {
      throw new Error(`reaction request for ${request.agentId} has an invalid source action`);
    }
    const sourceAgent = input.state.agents[sourceAction.actorId];
    if (!sourceAgent) throw new Error(`reaction request references unknown source actor ${sourceAction.actorId}`);
    if (request.originalIntent.kind === "prepared_action") {
      const actionId = request.originalIntent.actionId;
      const original = input.initialActions.find((action) => action.id === actionId);
      if (!original || original.actorId !== request.agentId) {
        throw new Error(`reaction request for ${request.agentId} has no matching prepared action`);
      }
    } else {
      const activity = input.state.truth.activities[request.originalIntent.activityId];
      if (!activity || activity.status !== "active" || activity.actorId !== request.agentId ||
        activity.sourceActionId !== request.originalIntent.sourceActionId || !activity.plan.interruptible) {
        throw new Error(`reaction request for ${request.agentId} has no matching interruptible Activity`);
      }
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
  const requestById = new Map(requests.map((request) => [request.id, request]));
  const decisionAgents = new Set<string>();
  const actions = input.initialActions.map((action) => structuredClone(action));

  for (const decision of decisions) {
    const request = requestById.get(decision.requestId);
    if (!request || request.agentId !== decision.agentId || decisionAgents.has(decision.agentId)) {
      throw new Error(`unexpected or duplicate reaction decision for ${decision.agentId}`);
    }
    decisionAgents.add(decision.agentId);
    if (decision.baseRevision !== input.state.revision) throw new Error("reaction decision has stale revision");
    const originalProposalId = request.originalIntent.kind === "prepared_action"
      ? request.originalIntent.actionId
      : request.originalIntent.sourceActionId;
    if (decision.originalProposalId !== originalProposalId) {
      throw new Error(`reaction decision for ${decision.agentId} references another intent`);
    }
    const preparedActionId = request.originalIntent.kind === "prepared_action"
      ? request.originalIntent.actionId
      : null;
    const actionIndex = preparedActionId !== null
      ? actions.findIndex((action) => action.id === preparedActionId)
      : -1;
    if (request.originalIntent.kind === "prepared_action" && actionIndex < 0) {
      throw new Error(`reaction decision for ${decision.agentId} references another prepared action`);
    }
    if (decision.kind === "replace") {
      const replacement = decision.replacementAction;
      if (replacement.actorId !== decision.agentId || replacement.baseRevision !== input.state.revision) {
        throw new Error(`reaction replacement for ${decision.agentId} changes actor or revision`);
      }
      const allowedTargets = new Set([
        ...Object.keys(input.state.agents[decision.agentId].belief.localEntities),
        ...request.stimulus.introductions.map((introduction) => introduction.localEntity.id),
      ]);
      for (const targetId of replacement.targetIds) {
        if (!allowedTargets.has(targetId)) {
          throw new Error(`reaction replacement for ${decision.agentId} targets unknown local entity ${targetId}`);
        }
      }
      if (actionIndex < 0) actions.push(structuredClone(replacement));
      else actions[actionIndex] = structuredClone(replacement);
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
  input: TruthResolutionInput,
  requests: readonly ReactionRequestDraft[],
): ReactionRequest[] {
  const materialized = materializeObservationPackets(
    input.state,
    requests.map((request, index) => ({
      ...structuredClone(request.stimulus),
      id: `reaction-stimulus-${index}`,
      observerId: request.agentId,
      sourceEventIds: [],
    })),
    "stimulus",
  ).packets;
  return requests.map((request, index) => {
    const prepared = input.initialActions.find((action) => action.actorId === request.agentId);
    const ongoing = Object.values(input.state.truth.activities)
      .find((activity) => activity.status === "active" && activity.actorId === request.agentId);
    if (!prepared && !ongoing) throw new Error(`reaction request for ${request.agentId} has no original intent`);
    return {
      id: runtimeId({
        worldHash: input.state.worldHash,
        revision: input.state.revision,
        kind: "reaction-request",
        stage: "truth-routing",
        owner: [request.agentId, request.sourceActionId],
        round: 0,
        ordinal: index,
      }),
      agentId: request.agentId,
      triggerActionId: request.sourceActionId,
      originalIntent: prepared
        ? { kind: "prepared_action" as const, actionId: prepared.id }
        : {
            kind: "ongoing_activity" as const,
            activityId: ongoing!.id,
            sourceActionId: ongoing!.sourceActionId,
          },
      stimulus: materialized[index],
      basis: structuredClone(request.basis),
    };
  });
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
  resolutionReceipts: readonly ResolutionReceipt[],
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

  const createdEntityIds = new Set(proposal.operations
    .filter((operation) => operation.kind === "create_entity")
    .map((operation) => operation.entity.id));
  const profiledEntityIds = proposal.mechanicInvocations
    .filter((invocation) => invocation.packageId === "core-resolution")
    .flatMap((invocation) => {
      if (invocation.ruleId === "instantiate-entity-profile") {
        const entityId = (invocation.input as { entityId?: unknown }).entityId;
        return typeof entityId === "string" ? [entityId] : [];
      }
      if (invocation.ruleId === "instantiate-entity-cohort") {
        const entityIds = (invocation.input as { entityIds?: unknown }).entityIds;
        return Array.isArray(entityIds) ? entityIds.filter((entityId): entityId is string => typeof entityId === "string") : [];
      }
      return [];
    });
  if (new Set(profiledEntityIds).size !== profiledEntityIds.length) {
    throw new Error("a transition can instantiate at most one mechanics profile per entity");
  }
  for (const operation of proposal.operations) {
    if (operation.kind === "create_agent" && createdEntityIds.has(operation.agent.entityId) &&
      !profiledEntityIds.includes(operation.agent.entityId)) {
      throw new Error(`new Agent entity ${operation.agent.entityId} requires an entity mechanics profile`);
    }
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
    const receipt = resolutionReceipts.find((candidate) => candidate.plan.actionId === action.id);
    if (!receipt || outcome.status !== expectedActionStatus(receipt)) {
      throw new Error(`outcome for ${action.id} contradicts its resolution receipt`);
    }
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

  async perceiveOnset(
    input: Readonly<OnsetPerceptionInput>,
    scope: ModelExecutionScope,
  ): Promise<OnsetPerceptionResult> {
    if (input.temporalBoundary.fromElapsedSeconds !== input.state.truth.elapsedSeconds ||
      input.temporalBoundary.toElapsedSeconds !== input.state.truth.elapsedSeconds + input.temporalBoundary.deltaSeconds ||
      !Number.isSafeInteger(input.temporalBoundary.deltaSeconds) || input.temporalBoundary.deltaSeconds <= 0) {
      throw new Error("onset perception requires an engine-selected future temporal boundary");
    }
    return runOnsetPerceptionStage({
      ...structuredClone(input),
      provider: this.provider,
      repairAttempts: this.repairAttempts,
      maxCommitmentRounds: this.maxCommitmentRounds,
      scope,
    });
  }

  async resolve(input: TruthResolutionInput, scope: ModelExecutionScope): Promise<TruthResolution> {
    const truthSubject = input.identityOwner;
    let actions = input.initialActions.map((action) => structuredClone(action));
    let groundings = input.groundings.map((grounding) => structuredClone(grounding));
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
    let resolutionPlans: ResolutionPlan[] = [];
    let resolutionReceipts: ResolutionReceipt[] = [];
    let reactionRequests: ReactionRequest[] = [];
    let reactionDecisions: ReactionDecision[] = [];
    let reactionModelAudits: ModelExecutionAudit[] = [];
    const modelAudits: ModelExecutionAudit[] = [];
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
      resolutionPlans,
      resolutionReceipts,
      groundings,
      temporalBoundary: input.temporalBoundary,
      instanceId: scope.workloadId,
      advanceId: scope.batchId,
      issues,
      stage,
    });

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
      commitmentRounds.push({ kind: "random", requestIds: round.map((request) => request.id) });
    };

    /**
     * Cardinality recovery for very large joint-action batches. Some providers
     * still compress a 48-slot response down to one plan even after semantic
     * repairs. Retrying the same oversized prompt is wasteful and can starve a
     * playable world, so we resolve each missing action in a one-action scope.
     * This is entered only after the normal joint call exhausts repairs; every
     * plan still goes through the same materializer, verifier, RNG transcript,
     * and final CanonicalCommitter checks.
     */
    const resolveSingleActionPlan = async (action: AgentActionProposal): Promise<{
      plan: ResolutionPlan;
      receipt: ResolutionReceipt;
      requests: D20CheckRequest[];
      checks: D20CheckResult[];
      randomRequests: DiscreteRandomRequest[];
      randomResults: DiscreteRandomResult[];
      commitmentRounds: CommitmentRound[];
      rng: SeededRngState;
      audits: ModelExecutionAudit[];
      verifierAudits: ModelExecutionAudit[];
    }> => {
      const selectedGroundings = groundings.filter((grounding) =>
        grounding.kind !== "action" || grounding.id === action.id);
      const selectedActions = [action];
      const selectedInitialActions = input.initialActions.filter((candidate) => candidate.id === action.id);
      const localAllowed: Record<CausalRef["kind"], Set<string>> = {
        action: new Set([action.id]),
        check: new Set(),
        random: new Set(),
        event: new Set(input.state.truth.events.map((event) => event.id)),
        fact: new Set(Object.keys(input.state.truth.facts)),
        law: new Set(input.definition.laws.map((law) => law.id)),
        mechanic: new Set(),
      };
      const localRequests: D20CheckRequest[] = [];
      const localChecks: D20CheckResult[] = [];
      const localRandomRequests: DiscreteRandomRequest[] = [];
      const localRandomResults: DiscreteRandomResult[] = [];
      const localRounds: CommitmentRound[] = [];
      const localRandomAliases = new Map<string, string | null>();
      const localRandomIds = new Set(randomRequestIds);
      let localRng = structuredClone(rng);
      let localPlans: ResolutionPlan[] = [];
      let localReceipts: ResolutionReceipt[] = [];
      let planIssues: PromptValidationIssue[] = [];
      let verifierIssues: PromptValidationIssue[] = [];
      let planRepairs = 0;
      const audits: ModelExecutionAudit[] = [];
      const verifierAudits: ModelExecutionAudit[] = [];
      const scopedContext = (
        stage: "resolution" | "transition",
        issues: readonly PromptValidationIssue[],
      ) => ({
        ...(buildTruthContext({
          definition: input.definition,
          state: input.state,
          initialActions: selectedInitialActions,
          actions: selectedActions,
          reactionRequests,
          reactionDecisions,
          reactionWindow: "closed",
          committedCheckRequests: localRequests,
          checkResults: localChecks,
          committedRandomRequests: localRandomRequests,
          randomResults: localRandomResults,
          commitmentRounds: localRounds,
          resolutionPlans: localPlans,
          resolutionReceipts: localReceipts,
          groundings: selectedGroundings,
          temporalBoundary: input.temporalBoundary,
          instanceId: scope.workloadId,
          advanceId: scope.batchId,
          issues,
          stage,
        }) as Record<string, unknown>),
        resolutionScope: {
          selectedActionId: action.id,
          selectedActionCount: 1,
          totalActionCount: actions.length,
          allActionIds: actions.map((candidate) => candidate.id).sort(),
        },
      });
      const commitLocalChecks = (round: readonly D20CheckRequest[]) => {
        const resolved = resolveD20Checks(localRng, round);
        localRng = resolved.rng;
        localRequests.push(...structuredClone(round));
        localChecks.push(...structuredClone(resolved.results));
        round.forEach((request) => localAllowed.check.add(request.id));
        localRounds.push({ kind: "check", phase: round[0]!.phase, requestIds: round.map((request) => request.id) });
      };
      const normalizeLocalRandom = (round: readonly DiscreteRandomRequestProposal[]): DiscreteRandomRequest[] => {
        if (localRounds.length >= this.maxCommitmentRounds) throw new Error("maximum commitment rounds exceeded");
        if (round.length > MAX_RANDOM_REQUESTS_PER_ROUND) throw new Error("discrete random round exceeds request limit");
        const aliases = new Map<string, string>();
        for (const [ordinal, request] of round.entries()) {
          if (aliases.has(request.id)) throw new Error(`duplicate random request alias ${request.id}`);
          const canonicalId = runtimeId({
            worldHash: input.state.worldHash,
            revision: input.state.revision,
            kind: "random",
            stage: "resolution-single",
            owner: [input.identityOwner, action.id],
            round: localRounds.length,
            ordinal,
          });
          aliases.set(request.id, canonicalId);
        }
        const normalized = round.map((request) => {
          const id = aliases.get(request.id)!;
          const causes = request.causes.map((cause) => cause.kind === "random" && aliases.has(cause.id)
            ? { ...cause, id: aliases.get(cause.id)! }
            : structuredClone(cause));
          if (localRandomIds.has(id)) throw new Error(`duplicate random request ${id}`);
          causes.forEach((cause) => validateCausalReference(cause, localAllowed, `random request ${id}`));
          const distribution = input.definition.randomDistributions.find((candidate) =>
            candidate.id === request.distributionId);
          if (!distribution) throw new Error(`random request ${id} references unknown distribution ${request.distributionId}`);
          return { ...structuredClone(request), id, causes, distribution: structuredClone(distribution) };
        });
        validateDiscreteRandomCommitmentBudget([...localRandomRequests, ...normalized]);
        registerLocalRandomAliases(round, normalized);
        return normalized;
      };
      const registerLocalRandomAliases = (
        draft: readonly DiscreteRandomRequestProposal[],
        normalized: readonly DiscreteRandomRequest[],
      ) => draft.forEach((request, index) => {
        const canonicalId = normalized[index]!.id;
        localRandomAliases.set(request.id, localRandomAliases.has(request.id) ? null : canonicalId);
      });
      const commitLocalRandom = (round: readonly DiscreteRandomRequest[]) => {
        const resolved = resolveDiscreteRandomRequests(localRng, round);
        localRng = resolved.rng;
        localRandomRequests.push(...structuredClone(round));
        localRandomResults.push(...structuredClone(resolved.results));
        round.forEach((request) => localRandomIds.add(request.id));
        localRounds.push({ kind: "random", requestIds: round.map((request) => request.id) });
      };

      while (true) {
        let acceptedPlans: ResolutionPlan[] = [];
        let acceptedChecks: D20CheckRequest[] = [];
        let acceptedRandom: DiscreteRandomRequest[] | null = null;
        const call = await generateValidated({
          provider: this.provider,
          profileId: input.definition.modelProfiles.resolution,
          role: "truth-resolution",
          subjectId: `${truthSubject}:single:${action.id}`,
          promptId: "truth-resolution",
          schemaName: "truth_resolution_directive",
          schema: resolutionDirectiveSchema,
          scope,
          buildContext: (issues) => scopedContext("resolution", [...planIssues, ...issues]),
          validate: (directive) => {
            if (directive.kind === "commit_plans") {
              acceptedPlans = materializeResolutionPlans({
                state: input.state,
                definition: input.definition,
                actions: selectedActions,
                groundings: selectedGroundings,
                identityOwner: `${input.identityOwner}:single:${action.id}`,
                drafts: directive.plans,
                allowedCauses: localAllowed,
              });
              acceptedChecks = checkRequestsForPlans({
                state: input.state,
                plans: acceptedPlans,
                identityOwner: `${input.identityOwner}:single:${action.id}`,
                round: localRounds.length,
                allowedCauses: localAllowed,
                maximumVisibility: input.definition.disclosure.defaultCheckVisibility,
              });
            } else if (directive.kind === "request_random") {
              if (localPlans.length === 0) throw new Error("resolution plans must be committed before random requests");
              acceptedRandom = normalizeLocalRandom(directive.requests);
            } else if (localPlans.length === 0) {
              throw new Error("resolution plans must be committed before resolution can finish");
            }
          },
          repairAttempts: this.repairAttempts,
          invocationOffset: audits.reduce((count, audit) => count + audit.invocations.length, 0),
        });
        audits.push(call.audit);
        if (call.value.kind === "commit_plans") {
          if (acceptedPlans.length !== 1) throw new Error("single-action resolution did not produce exactly one plan");
          const verification = await generateValidated({
            provider: this.provider,
            profileId: input.definition.modelProfiles.causalVerifier,
            role: "causal-verifier",
            subjectId: `${truthSubject}:single:${action.id}`,
            promptId: "resolution-plan-verifier",
            schemaName: "resolution_plan_verification",
            schema: resolutionPlanVerificationSchema,
            scope,
            buildContext: (issues) => buildResolutionPlanVerificationContext({
              definition: input.definition,
              state: input.state,
              actions: selectedActions,
              groundings: selectedGroundings,
              plans: acceptedPlans,
              commitmentRounds: localRounds,
              instanceId: scope.workloadId,
              advanceId: scope.batchId,
              issues: [...verifierIssues, ...issues],
            }),
            validate: (report) => {
              if (report.verdict === "reject" && report.findings.some((finding) => finding.planId !== acceptedPlans[0]!.id)) {
                throw new Error(`resolution plan verifier references unknown plan ${report.findings[0]!.planId}`);
              }
            },
            repairAttempts: this.repairAttempts,
            invocationOffset: verifierAudits.reduce((count, audit) => count + audit.invocations.length, 0),
          });
          verifierAudits.push(verification.audit);
          if (verification.value.verdict === "reject") {
            verifierIssues = verification.value.findings.map((finding) => ({
              code: finding.code,
              path: ["plans", finding.planId],
              message: `${finding.message} Repair: ${finding.repairHint}`,
            }));
            planRepairs += 1;
            if (planRepairs > this.repairAttempts) {
              throw new ModelSemanticRepairError(
                "truth-resolution",
                `single-action resolution plan verification failed after repairs for ${action.id}`,
              );
            }
            continue;
          }
          planIssues = [];
          verifierIssues = [];
          localPlans = structuredClone(acceptedPlans);
          if (acceptedChecks.length > 0) commitLocalChecks(acceptedChecks);
          let checkOrdinal = 0;
          localReceipts = localPlans.map((plan, ordinal) => {
            const request = plan.mode === "check" ? acceptedChecks[checkOrdinal++]! : null;
            const result = request ? localChecks.find((candidate) => candidate.requestId === request.id) ?? null : null;
            return deriveResolutionReceipt({
              receiptId: runtimeId({
                worldHash: input.state.worldHash,
                revision: input.state.revision,
                kind: "resolution-receipt",
                stage: "resolution-single",
                owner: [input.identityOwner, action.id, plan.id],
                round: 0,
                ordinal,
              }),
              plan,
              checkRequestId: request?.id ?? null,
              check: plan.mode === "check" ? deriveCheck(plan, resolutionEvidenceIndex(input.state, selectedActions, input.definition.laws)) : null,
              result,
            });
          });
        } else if (call.value.kind === "request_random") {
          if (!acceptedRandom) throw new Error("single-action random round was not materialized");
          commitLocalRandom(acceptedRandom);
        } else {
          if (localPlans.length === 0) throw new Error("single-action resolution finished without a plan");
          break;
        }
      }
      return {
        plan: localPlans[0]!,
        receipt: localReceipts[0]!,
        requests: localRequests,
        checks: localChecks,
        randomRequests: localRandomRequests,
        randomResults: localRandomResults,
        commitmentRounds: localRounds,
        rng: localRng,
        audits,
        verifierAudits,
      };
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

    if (input.enableReactionRouting !== false) {
      const perception = await this.perceiveOnset({
        definition: input.definition,
        state: input.state,
        actions,
        temporalBoundary: input.temporalBoundary,
        identityOwner: input.identityOwner,
        groundings,
      }, scope);
      rng = structuredClone(perception.rng);
      requests.push(...structuredClone(perception.requests));
      checks.push(...structuredClone(perception.checks));
      commitmentRounds.push(...structuredClone(perception.commitmentRounds));
      perception.requests.forEach((request) => {
        requestIds.add(request.id);
        allowedForCommitments.check.add(request.id);
      });
      perception.aliases.forEach(([alias, canonicalId]) => checkAliases.set(alias, canonicalId));
      modelAudits.push(structuredClone(perception.modelAudit));

      const routing = await generateValidated({
        provider: this.provider,
        profileId: input.definition.modelProfiles.reactionRouting,
        role: "truth-reaction-routing",
        subjectId: truthSubject,
        promptId: "truth-reaction-routing",
        schemaName: "truth_reaction_routing",
        schema: reactionRoutingOutputSchema,
        scope,
        buildContext: (issues) => truthContext("reaction-routing", issues),
        validate: (output) => validateReactionRequests(
          input,
          materializeReactionRequests(input, output.requests),
          requests,
          checks,
        ),
        repairAttempts: this.repairAttempts,
      });
      modelAudits.push(routing.audit);
      reactionRequests = materializeReactionRequests(input, routing.value.requests);
      if (reactionRequests.length > 0) {
        try {
          const resolved = await input.resolveReactions(reactionRequests);
          reactionDecisions = structuredClone(resolved.decisions);
          reactionModelAudits = structuredClone(resolved.modelAudits);
          actions = applyReactionDecisions(input, reactionRequests, reactionDecisions);
          const replacedActorIds = new Set(reactionDecisions
            .filter((decision) => decision.kind === "replace")
            .map((decision) => decision.agentId));
          const groundedActorIds = new Set(resolved.groundings.flatMap((grounding) =>
            grounding.actorId === null ? [] : [grounding.actorId]));
          if (resolved.groundings.length !== replacedActorIds.size ||
            groundedActorIds.size !== replacedActorIds.size ||
            [...replacedActorIds].some((actorId) => !groundedActorIds.has(actorId)) ||
            resolved.groundings.some((grounding) => {
              const action = actions.find((candidate) => candidate.actorId === grounding.actorId);
              return grounding.actorId === null || !action || !replacedActorIds.has(grounding.actorId) ||
                grounding.kind !== "action" || grounding.id !== action.id;
            })) {
            throw new Error("reaction replacement groundings do not cover replaced actions");
          }
          groundings = [
            ...groundings.filter((grounding) => grounding.actorId === null ||
              !replacedActorIds.has(grounding.actorId)),
            ...resolved.groundings.map((grounding) => structuredClone(grounding)),
          ].sort((left, right) => left.id.localeCompare(right.id));
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          throw new ReactionExecutionError(`reaction execution failed: ${message}`, { cause: error });
        }
        allowedForCommitments.action = new Set(actions.map((action) => action.id));
      }
    }

    const resolutionAudits: ModelExecutionAudit[] = [];
    const resolutionPlanVerifierAudits: ModelExecutionAudit[] = [];
    let resolutionPlanIssues: PromptValidationIssue[] = [];
    let resolutionPlanRepairs = 0;
    let singleActionFallback: Awaited<ReturnType<typeof resolveSingleActionPlan>>[] | null = null;
    const singleResolutionAudits: ModelExecutionAudit[] = [];
    const singleVerifierAudits: ModelExecutionAudit[] = [];
    while (true) {
      let acceptedPlans: ResolutionPlan[] = [];
      let acceptedPlanChecks: D20CheckRequest[] = [];
      let acceptedRandom: DiscreteRandomRequest[] | null = null;
      let call: { value: z.infer<typeof resolutionDirectiveSchema>; audit: ModelExecutionAudit };
      try {
        call = await generateValidated({
          provider: this.provider,
          profileId: input.definition.modelProfiles.resolution,
          role: "truth-resolution",
          subjectId: truthSubject,
          promptId: "truth-resolution",
          schemaName: "truth_resolution_directive",
          schema: resolutionDirectiveSchema,
          scope,
          buildContext: (issues) => truthContext("resolution", [...resolutionPlanIssues, ...issues]),
          validate: (directive) => {
            if (directive.kind === "commit_plans") {
              if (resolutionPlans.length > 0) throw new Error("resolution plans are already committed");
              acceptedPlans = materializeResolutionPlans({
                state: input.state,
                definition: input.definition,
                actions,
                groundings,
                identityOwner: input.identityOwner,
                drafts: directive.plans,
                allowedCauses: allowedForCommitments,
              });
              if (acceptedPlans.some((plan) => plan.mode === "check") &&
                commitmentRounds.length >= this.maxCommitmentRounds) {
                throw new Error("maximum commitment rounds exceeded");
              }
              acceptedPlanChecks = checkRequestsForPlans({
                state: input.state,
                plans: acceptedPlans,
                identityOwner: input.identityOwner,
                round: commitmentRounds.length,
                allowedCauses: allowedForCommitments,
                maximumVisibility: input.definition.disclosure.defaultCheckVisibility,
              });
            } else if (directive.kind === "request_random") {
              if (resolutionPlans.length === 0) throw new Error("resolution plans must be committed before random requests");
              acceptedRandom = normalizeRandomRound(directive.requests);
            } else if (resolutionPlans.length === 0) {
              throw new Error("resolution plans must be committed before resolution can finish");
            }
          },
          repairAttempts: this.repairAttempts,
          invocationOffset: resolutionAudits.reduce((count, audit) => count + audit.invocations.length, 0),
        });
      } catch (error) {
        const cardinalityFailure = error instanceof ModelSemanticRepairError &&
          /resolution plans must cover every final joint action exactly once/.test(error.message);
        if (!cardinalityFailure || actions.length <= 1 || resolutionPlans.length > 0) throw error;
        singleActionFallback = [];
        for (const action of [...actions].sort((left, right) => left.id.localeCompare(right.id))) {
          singleActionFallback.push(await resolveSingleActionPlan(action));
        }
        break;
      }
      resolutionAudits.push(call.audit);
      if (call.value.kind === "done") break;
      if (call.value.kind === "commit_plans") {
        if (acceptedPlans.length === 0) throw new Error("accepted resolution plans were not materialized");
        const verification = await generateValidated({
          provider: this.provider,
          profileId: input.definition.modelProfiles.causalVerifier,
          role: "causal-verifier",
          subjectId: truthSubject,
          promptId: "resolution-plan-verifier",
          schemaName: "resolution_plan_verification",
          schema: resolutionPlanVerificationSchema,
          scope,
          buildContext: (issues) => buildResolutionPlanVerificationContext({
            definition: input.definition,
            state: input.state,
            actions,
            groundings,
            plans: acceptedPlans,
            commitmentRounds,
            instanceId: scope.workloadId,
            advanceId: scope.batchId,
            issues,
          }),
          validate: (report) => {
            if (report.verdict !== "reject") return;
            const planIds = new Set(acceptedPlans.map((plan) => plan.id));
            for (const finding of report.findings) {
              if (!planIds.has(finding.planId)) {
                throw new Error(`resolution plan verifier references unknown plan ${finding.planId}`);
              }
            }
          },
          repairAttempts: this.repairAttempts,
          invocationOffset: resolutionPlanVerifierAudits
            .reduce((count, audit) => count + audit.invocations.length, 0),
        });
        resolutionPlanVerifierAudits.push(verification.audit);
        if (verification.value.verdict === "reject") {
          resolutionPlanIssues = verification.value.findings.map((finding) => ({
            code: finding.code,
            path: ["plans", finding.planId],
            message: `${finding.message} Repair: ${finding.repairHint}`,
          }));
          setModelInvocationOutcome(
            call.audit,
            "rejected",
            resolutionPlanIssues.map((issue) => issue.code),
          );
          resolutionPlanRepairs += 1;
          if (resolutionPlanRepairs > this.repairAttempts) {
            throw new ModelSemanticRepairError(
              "truth-resolution",
              `truth-resolution plan verification failed after repairs: ${resolutionPlanIssues
                .map((issue) => `${issue.code}: ${issue.message}`)
                .join(" | ")}`,
            );
          }
          continue;
        }
        resolutionPlanIssues = [];
        resolutionPlans = structuredClone(acceptedPlans);
        if (acceptedPlanChecks.length > 0) commitCheckRound(acceptedPlanChecks);
        const evidence = resolutionEvidenceIndex(input.state, actions, input.definition.laws);
        let checkOrdinal = 0;
        resolutionReceipts = resolutionPlans.map((plan, ordinal) => {
          const request = plan.mode === "check" ? acceptedPlanChecks[checkOrdinal++]! : null;
          const result = request ? checks.find((candidate) => candidate.requestId === request.id) ?? null : null;
          return deriveResolutionReceipt({
            receiptId: runtimeId({
              worldHash: input.state.worldHash,
              revision: input.state.revision,
              kind: "resolution-receipt",
              stage: "resolution",
              owner: [input.identityOwner, plan.id],
              round: 0,
              ordinal,
            }),
            plan,
            checkRequestId: request?.id ?? null,
            check: plan.mode === "check" ? deriveCheck(plan, evidence) : null,
            result,
          });
        });
      } else {
        if (!acceptedRandom) throw new Error("accepted random round was not materialized");
        registerRandomAliases(call.value.requests, acceptedRandom);
        commitRandomRound(acceptedRandom);
      }
    }
    if (singleActionFallback) {
      resolutionPlans = singleActionFallback.map((entry) => entry.plan);
      resolutionReceipts = singleActionFallback.map((entry) => entry.receipt);
      singleActionFallback.forEach((entry) => {
        requests.push(...entry.requests);
        checks.push(...entry.checks);
        randomRequests.push(...entry.randomRequests);
        randomResults.push(...entry.randomResults);
        commitmentRounds.push(...entry.commitmentRounds);
        singleResolutionAudits.push(...entry.audits.map((audit) => structuredClone(audit)));
        singleVerifierAudits.push(...entry.verifierAudits.map((audit) => structuredClone(audit)));
      });
      rng = structuredClone(singleActionFallback.at(-1)!.rng);
    }
    if (resolutionAudits.length > 0) modelAudits.push(combineStageAudits(resolutionAudits));
    modelAudits.push(...singleResolutionAudits);
    if (resolutionPlanVerifierAudits.length > 0) modelAudits.push(combineStageAudits(resolutionPlanVerifierAudits));
    modelAudits.push(...singleVerifierAudits);

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
        const prompt = promptBundle("truth-transition");
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
          promptVersion: prompt.version,
          schemaName: "truth_transition",
          system: prompt.system,
          userPrompt: prompt.userPrompt,
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
        if (directProposal.mechanicInvocations.some((invocation) =>
          invocation.packageId === "core-resolution" &&
          (invocation.ruleId === "apply-receipt" || invocation.ruleId === "advance-conditions"))) {
          throw new Error("core-resolution settlement invocations are engine-owned");
        }
        const continuingActionIds = new Set(directProposal.outcomes
          .filter((outcome) => outcome.status === "continuing")
          .map((outcome) => outcome.proposalId));
        resolutionReceipts = resolutionReceipts.map((receipt) => ({
          ...structuredClone(receipt),
          settled: !continuingActionIds.has(receipt.plan.actionId),
          operations: [],
        }));
        const settledReceipts = resolutionReceipts.filter((receipt) => receipt.settled);
        const resolutionInvocations: MechanicInvocation[] = settledReceipts.map((receipt, ordinal) => {
          const check = receipt.checkRequestId
            ? checks.find((candidate) => candidate.requestId === receipt.checkRequestId)
            : null;
          return {
            id: runtimeId({
              worldHash: input.state.worldHash,
              revision: input.state.revision,
              kind: "mechanic",
              stage: "resolution-effect",
              owner: [input.identityOwner, receipt.id],
              round: 0,
              ordinal,
            }),
            packageId: "core-resolution",
            ruleId: "apply-receipt",
            input: { receiptId: receipt.id },
            causes: structuredClone(receipt.plan.causes),
            assertions: check ? [{
              kind: "check_result" as const,
              checkId: check.requestId,
              expected: check.succeeded ? "succeeded" as const : "failed" as const,
            }] : [{
              kind: "entity_lifecycle" as const,
              entityId: receipt.plan.actorId,
              expected: input.state.truth.entities[receipt.plan.actorId]?.lifecycle ?? "active",
            }],
          };
        });
        const conditionAdvanceInvocation: MechanicInvocation = {
          id: runtimeId({
            worldHash: input.state.worldHash,
            revision: input.state.revision,
            kind: "mechanic",
            stage: "condition-advance",
            owner: input.identityOwner,
            round: 0,
            ordinal: resolutionInvocations.length,
          }),
          packageId: "core-resolution",
          ruleId: "advance-conditions",
          input: { seconds: input.temporalBoundary.deltaSeconds },
          causes: actions.map((action) => ({ kind: "action" as const, id: action.id })),
          assertions: [{
            kind: "elapsed_seconds_compare",
            operator: "eq",
            value: input.state.truth.elapsedSeconds,
          }],
        };
        const mechanics = this.rulePackages.resolve(input.definition.rulePackages, {
          state: input.state,
          actions,
          resolutionPlans,
          resolutionReceipts,
          checkRequests: requests,
          checkResults: checks,
          randomRequests,
          randomResults,
        }, [
          ...directProposal.mechanicInvocations,
          ...resolutionInvocations,
          conditionAdvanceInvocation,
        ], directProposal.operations);
        resolutionReceipts = resolutionReceipts.map((receipt) => {
          if (!receipt.settled) return { ...structuredClone(receipt), operations: [] };
          const invocation = resolutionInvocations.find((candidate) =>
            (candidate.input as { receiptId: string }).receiptId === receipt.id)!;
          const result = mechanics.results.find((candidate) => candidate.invocationId === invocation.id);
          if (!result) throw new Error(`resolution receipt ${receipt.id} has no trusted mechanic result`);
          return { ...structuredClone(receipt), operations: structuredClone(result.operations) };
        });
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

        validateTransitionEnvelope(input, actions, proposal, checks, randomResults, resolutionReceipts);
        const causalAssertionResults = evaluateProposalCausality(input.state, checks, randomResults, proposal);
        input.validateProposal(proposal, checks, randomResults, actions, stimulusObservations);

        const verification = await generateValidated({
          provider: this.provider,
          profileId: input.definition.modelProfiles.causalVerifier,
          role: "causal-verifier",
          subjectId: truthSubject,
          promptId: "causal-verifier",
          schemaName: "causal_verification",
          schema: causalVerificationSchema,
          scope,
          buildContext: (issues) => buildCausalVerificationContext({
            definition: input.definition,
            state: input.state,
            actions,
            groundings,
            checkRequests: requests,
            checkResults: checks,
            randomRequests,
            randomResults,
            commitmentRounds,
            resolutionPlans,
            resolutionReceipts,
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
          invocationOffset: [resolutionPlanVerifierAudits, verifierAudits]
            .flat()
            .reduce((count, audit) => count + audit.invocations.length, 0),
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
          resolutionPlans: structuredClone(resolutionPlans),
          resolutionReceipts: structuredClone(resolutionReceipts),
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
