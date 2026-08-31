import { z } from "zod";
import { CharacterPatchValidationError } from "../cognition/character";
import type {
  ActionOutcome,
  AgentActionProposal,
  AgentState,
  CausalAssertion,
  CausalAssertionResult,
  CausalVerification,
  CommitmentRound,
  D20CheckRequest,
  D20CheckResult,
  DiscreteRandomRequest,
  DiscreteRandomResult,
  MechanicResult,
  ObservationPacket,
  ReactionDecision,
  ReactionRequest,
  SimulationState,
  TransitionProposal,
  WorldDeltaOperation,
  WorldEvent,
} from "./model";
import type { ResolutionPlan, ResolutionReceipt, ResolutionSourceRef } from "../mechanics/resolution";
import type { InteractionDependency } from "../runtime/execution";
import { ObservationValidationError } from "../cognition/observation";
import { projectAgentPerspective } from "../cognition/agent-perspective";
import type { WorldDefinition } from "../runtime/world-definition";
import type { TemporalBoundary } from "../mechanics/temporal";
import { MechanicInputValidationError, type MechanicPromptContract } from "../mechanics/rule-package";
import { promptBundle, type PromptBundleId } from "../prompts";
import {
  MODEL_CONTEXT_CONTRACT_VERSION as MODEL_CONTEXT_VERSION,
  createAgentReferenceResolver,
  createReferenceResolver,
  modelRoleContract,
  type ReferenceCandidateInput,
  type ReferenceResolver,
} from "./model-context";

export const MODEL_CONTEXT_CONTRACT_VERSION = MODEL_CONTEXT_VERSION;

export { promptBundle } from "../prompts";
export type { PromptBundle, PromptBundleId } from "../prompts";

export function promptFor(id: PromptBundleId) {
  return promptBundle(id);
}

export interface PromptValidationIssue {
  code: string;
  path: Array<string | number>;
  message: string;
}

export type TruthContextMode = "scoped" | "full";

export interface ResolutionScope {
  mode: "component" | "global" | "repair";
  selectedActionIds: string[];
  totalActionCount: number;
}

export function validationIssues(error: unknown): PromptValidationIssue[] {
  if (error instanceof MechanicInputValidationError) {
    return error.issues.map((issue) => ({
      code: "mechanic_input_contract",
      path: ["mechanicInvocations", error.invocationId, ...issue.path],
      message: issue.message,
    }));
  }
  if (error instanceof ObservationValidationError || error instanceof CharacterPatchValidationError) {
    return error.issues.map((issue) => ({ ...issue, path: [...issue.path] }));
  }
  if (error instanceof z.ZodError) {
    return error.issues.map((issue) => ({
      code: issue.code,
      path: issue.path.map((part) => typeof part === "symbol" ? part.description ?? "symbol" : part),
      message: issue.message,
    }));
  }
  return [{
    code: error instanceof Error ? error.name || "validation_error" : "validation_error",
    path: [],
    message: error instanceof Error ? error.message : String(error),
  }];
}

function visibleObservation(packet: ObservationPacket): ObservationPacket {
  return {
    ...structuredClone(packet),
    introductions: packet.introductions.map(({ localEntity }) => ({
      localEntity: structuredClone(localEntity),
      canonicalEntityId: null,
    })),
  };
}

function scopedCanonicalTruth(
  state: Readonly<SimulationState>,
  actions: readonly AgentActionProposal[],
  groundings: readonly InteractionDependency[],
): SimulationState["truth"] {
  if (groundings.some((grounding) => grounding.globalFallback)) return structuredClone(state.truth);

  const entityIds = new Set<string>();
  const factIds = new Set<string>();
  const placementIds = new Set<string>();
  const meterIds = new Set<string>();
  const quantityIds = new Set<string>();
  const ratingIds = new Set<string>();
  const conditionIds = new Set<string>();
  const activityIds = new Set<string>();
  const timerIds = new Set<string>();
  const relevantAgentIds = new Set<string>();
  const addRef = (ref: { kind: string; id: string }): void => {
    switch (ref.kind) {
      case "entity": entityIds.add(ref.id); break;
      case "fact": factIds.add(ref.id); break;
      case "placement": placementIds.add(ref.id); break;
      case "meter": meterIds.add(ref.id); break;
      case "quantity": quantityIds.add(ref.id); break;
      case "rating": ratingIds.add(ref.id); break;
      case "condition": conditionIds.add(ref.id); break;
      case "activity": activityIds.add(ref.id); break;
      case "timer": timerIds.add(ref.id); break;
      default: break;
    }
  };
  for (const grounding of groundings) {
    grounding.reads.forEach(addRef);
    grounding.writes.forEach(addRef);
    grounding.audienceAgentIds.forEach((agentId) => relevantAgentIds.add(agentId));
    if (grounding.actorId !== null) relevantAgentIds.add(grounding.actorId);
    if (grounding.kind === "activity") activityIds.add(grounding.id);
    if (grounding.kind === "timer") timerIds.add(grounding.id);
    if (grounding.kind === "condition") conditionIds.add(grounding.id);
  }
  for (const action of actions) {
    relevantAgentIds.add(action.actorId);
    const agent = state.agents[action.actorId];
    if (agent) {
      entityIds.add(agent.entityId);
      const placementId = state.truth.placements[agent.entityId];
      if (placementId) placementIds.add(placementId);
      for (const localId of action.targetIds) {
        for (const entityId of agent.bindings[localId]?.canonicalEntityIds ?? []) entityIds.add(entityId);
      }
    }
  }

  for (const fact of Object.values(state.truth.facts)) {
    if (factIds.has(fact.id)) {
      entityIds.add(fact.subjectId);
      if (fact.value.kind === "entity") entityIds.add(fact.value.entityId);
    }
  }
  for (const fact of Object.values(state.truth.facts)) {
    if (entityIds.has(fact.subjectId) ||
      fact.value.kind === "entity" && entityIds.has(fact.value.entityId)) factIds.add(fact.id);
  }
  for (const entityId of [...entityIds]) {
    let placement = state.truth.placements[entityId];
    const seen = new Set<string>();
    while (placement && !seen.has(placement)) {
      seen.add(placement);
      placementIds.add(placement);
      entityIds.add(placement);
      placement = state.truth.placements[placement];
    }
  }
  const truth = structuredClone(state.truth);
  truth.entities = Object.fromEntries(Object.entries(state.truth.entities)
    .filter(([id]) => entityIds.has(id)));
  truth.placements = Object.fromEntries(Object.entries(state.truth.placements)
    .filter(([id]) => entityIds.has(id) || placementIds.has(id)));
  truth.facts = Object.fromEntries(Object.entries(state.truth.facts)
    .filter(([id]) => factIds.has(id)));
  truth.factTombstones = state.truth.factTombstones.filter((id) => factIds.has(id));
  truth.meters = Object.fromEntries(Object.entries(state.truth.meters)
    .filter(([id, meter]) => meterIds.has(id) || entityIds.has(meter.entityId)));
  truth.quantities = Object.fromEntries(Object.entries(state.truth.quantities)
    .filter(([id, quantity]) => quantityIds.has(id) || entityIds.has(quantity.holderId)));
  truth.ratings = Object.fromEntries(Object.entries(state.truth.ratings)
    .filter(([id, rating]) => ratingIds.has(id) || entityIds.has(rating.entityId)));
  truth.conditions = Object.fromEntries(Object.entries(state.truth.conditions)
    .filter(([id, condition]) => conditionIds.has(id) || entityIds.has(condition.subjectId)));
  truth.activities = Object.fromEntries(Object.entries(state.truth.activities)
    .filter(([id, activity]) => activityIds.has(id) || relevantAgentIds.has(activity.actorId) ||
      activity.participantAgentIds.some((agentId) => relevantAgentIds.has(agentId))));
  truth.timers = Object.fromEntries(Object.entries(state.truth.timers)
    .filter(([id, timer]) => timerIds.has(id) || timer.wakeAgentIds.some((agentId) => relevantAgentIds.has(agentId))));
  truth.sharedActivityResourcePools = Object.fromEntries(Object.entries(state.truth.sharedActivityResourcePools)
    .filter(([id, pool]) => entityIds.has(pool.entityId) || groundings.some((grounding) =>
      grounding.sharedResourceClaims.some((claim) => claim.poolId === id))));
  truth.events = state.truth.events.filter((event) => event.step === state.step ||
    event.causes.some((cause) => groundings.some((grounding) => grounding.id === cause.id)));
  return truth;
}

type ModelReferenceResolvers = {
  existing: ReferenceResolver;
  task?: ReferenceResolver;
};

function modelHandle(
  resolvers: ModelReferenceResolvers,
  kind: Parameters<ReferenceResolver["handleFor"]>[0],
  engineId: string,
): string {
  try {
    return resolvers.existing.handleFor(kind, engineId);
  } catch (error) {
    if (resolvers.task) return resolvers.task.handleFor(kind, engineId);
    throw error;
  }
}

function projectModelFactValue(
  value: Readonly<SimulationState["truth"]["facts"][string]["value"]>,
  resolvers: ModelReferenceResolvers,
): unknown {
  return value.kind === "entity"
    ? { kind: "entity", entityRef: modelHandle(resolvers, "entity", value.entityId) }
    : structuredClone(value);
}

function projectModelCausalRef(
  cause: Readonly<{ kind: string; id: string }>,
  resolvers: ModelReferenceResolvers,
): Record<string, unknown> {
  const kind = cause.kind === "global" ? "world" : cause.kind;
  return {
    kind,
    ref: modelHandle(resolvers, kind as Parameters<ReferenceResolver["handleFor"]>[0], cause.id),
  };
}

function projectModelCausalAssertion(
  assertion: Readonly<CausalAssertion>,
  resolvers: ModelReferenceResolvers,
): Record<string, unknown> {
  switch (assertion.kind) {
    case "check_result":
      return { kind: assertion.kind, checkRef: modelHandle(resolvers, "check", assertion.checkId), expected: assertion.expected };
    case "random_result":
      return {
        kind: assertion.kind,
        requestRef: modelHandle(resolvers, "random", assertion.requestId),
        stepRef: modelHandle(resolvers, "random", assertion.stepId),
        expected: structuredClone(assertion.expected),
      };
    case "fact_matches":
      return { kind: assertion.kind, factRef: modelHandle(resolvers, "fact", assertion.factId), expected: projectModelFactValue(assertion.expected, resolvers) };
    case "fact_absent":
      return { kind: assertion.kind, factRef: modelHandle(resolvers, "fact", assertion.factId) };
    case "entity_absent":
      return { kind: assertion.kind, entityRef: modelHandle(resolvers, "entity", assertion.entityId) };
    case "entity_lifecycle":
      return { kind: assertion.kind, entityRef: modelHandle(resolvers, "entity", assertion.entityId), expected: assertion.expected };
    case "placement_equals":
      return {
        kind: assertion.kind,
        entityRef: modelHandle(resolvers, "entity", assertion.entityId),
        placementRef: assertion.placementId === null ? null : modelHandle(resolvers, "placement", assertion.placementId),
      };
    case "shared_placement":
      return {
        kind: assertion.kind,
        leftEntityRef: modelHandle(resolvers, "entity", assertion.leftEntityId),
        rightEntityRef: modelHandle(resolvers, "entity", assertion.rightEntityId),
      };
    case "meter_compare":
      return { kind: assertion.kind, meterRef: modelHandle(resolvers, "meter", assertion.meterId), operator: assertion.operator, value: assertion.value };
    case "quantity_compare":
      return {
        kind: assertion.kind,
        definitionRef: modelHandle(resolvers, "quantity", assertion.definitionId),
        holderRef: modelHandle(resolvers, "entity", assertion.holderId),
        operator: assertion.operator,
        value: assertion.value,
      };
    case "rating_compare":
      return { kind: assertion.kind, ratingRef: modelHandle(resolvers, "rating", assertion.ratingId), operator: assertion.operator, value: assertion.value };
    case "shared_resource_capacity_compare":
      return { kind: assertion.kind, poolRef: modelHandle(resolvers, "shared_resource_pool", assertion.poolId), operator: assertion.operator, value: assertion.value };
    case "elapsed_seconds_compare":
      return structuredClone(assertion);
  }
}

function projectModelCheckRequest(
  request: Readonly<D20CheckRequest>,
  resolvers: ModelReferenceResolvers,
): Record<string, unknown> {
  return {
    checkRef: modelHandle(resolvers, "check", request.id),
    actorRef: modelHandle(resolvers, "entity", request.actorId),
    targetRef: request.targetId === null ? null : modelHandle(resolvers, "entity", request.targetId),
    ratingRef: request.ratingId === null ? null : modelHandle(resolvers, "rating", request.ratingId),
    modifier: request.modifier,
    modifierSources: request.modifierSources.map((source) => ({
      kind: source.kind,
      ratingRef: modelHandle(resolvers, "rating", source.id),
      amount: source.amount,
    })),
    dc: request.dc,
    mode: request.mode,
    stakes: request.stakes,
    visibility: request.visibility,
    phase: request.phase,
    causes: request.causes.map((cause) => projectModelCausalRef(cause, resolvers)),
  };
}

function projectModelCheckResult(
  result: Readonly<D20CheckResult>,
  resolvers: ModelReferenceResolvers,
): Record<string, unknown> {
  return {
    checkRef: modelHandle(resolvers, "check", result.requestId),
    dice: [...result.dice],
    kept: result.kept,
    modifier: result.modifier,
    total: result.total,
    dc: result.dc,
    succeeded: result.succeeded,
    margin: result.margin,
    visibility: result.visibility,
  };
}

function projectModelRandomRequest(
  request: Readonly<DiscreteRandomRequest>,
  resolvers: ModelReferenceResolvers,
): Record<string, unknown> {
  return {
    randomRef: modelHandle(resolvers, "random", request.id),
    distributionId: request.distributionId,
    distribution: {
      description: request.distribution.description,
      steps: request.distribution.steps.map((step) => ({
        stepRef: modelHandle(resolvers, "random", step.id),
        count: step.count,
        outcomes: [...step.outcomes],
        aggregate: step.aggregate,
        when: step.when ? {
          stepRef: modelHandle(resolvers, "random", step.when.stepId),
          equals: step.when.equals,
        } : null,
      })),
    },
    causes: request.causes.map((cause) => projectModelCausalRef(cause, resolvers)),
  };
}

function projectModelRandomResult(
  result: Readonly<DiscreteRandomResult>,
  resolvers: ModelReferenceResolvers,
): Record<string, unknown> {
  return {
    randomRef: modelHandle(resolvers, "random", result.requestId),
    distributionId: result.distributionId,
    steps: result.steps.map((step) => ({
      stepRef: modelHandle(resolvers, "random", step.stepId),
      skipped: step.skipped,
      draws: step.draws.map((draw) => ({ ...draw })),
      aggregate: structuredClone(step.aggregate),
    })),
  };
}

function projectModelOutcome(
  outcome: Readonly<ActionOutcome>,
  resolvers: ModelReferenceResolvers,
): Record<string, unknown> {
  return {
    outcomeRef: modelHandle(resolvers, "outcome", outcome.id),
    actionRef: modelHandle(resolvers, "action", outcome.proposalId),
    status: outcome.status,
    summary: outcome.summary,
    causes: outcome.causeRefs.map((cause) => projectModelCausalRef(cause, resolvers)),
    assertions: outcome.assertions.map((assertion) => projectModelCausalAssertion(assertion, resolvers)),
    knownAlternatives: outcome.knownAlternatives.map((alternative) => ({
      description: alternative.description,
      basis: alternative.basis.kind === "knowledge"
        ? { kind: alternative.basis.kind, evidenceRefs: alternative.basis.evidenceIds.map((id) => modelHandle(resolvers, "evidence", id)) }
        : { kind: alternative.basis.kind, observationRef: modelHandle(resolvers, "observation", alternative.basis.observationId) },
    })),
  };
}

function projectModelObservation(
  observation: Readonly<ObservationPacket>,
  resolvers: ModelReferenceResolvers,
): Record<string, unknown> {
  return {
    observationRef: modelHandle(resolvers, "observation", observation.id),
    observerRef: modelHandle(resolvers, "agent", observation.observerId),
    step: observation.step,
    kind: observation.kind,
    summary: observation.summary,
    introductions: observation.introductions.map(({ localEntity, canonicalEntityId }) => ({
      name: localEntity.name,
      description: localEntity.description,
      status: localEntity.status,
      canonicalEntityRef: canonicalEntityId === null ? null : modelHandle(resolvers, "entity", canonicalEntityId),
    })),
    apparentClaims: observation.apparentClaims.map((claim) => ({
      subject: claim.subjectId,
      predicate: claim.predicate,
      value: claim.value.kind === "local_entity"
        ? { kind: "local_entity", name: claim.value.localEntityId }
        : structuredClone(claim.value),
      description: claim.description,
    })),
    sourceEventRefs: observation.sourceEventIds.map((id) => modelHandle(resolvers, "event", id)),
  };
}

function maybeModelHandle(
  resolvers: ModelReferenceResolvers,
  kind: Parameters<ReferenceResolver["handleFor"]>[0],
  engineId: string | null | undefined,
): string | null {
  if (!engineId) return null;
  try {
    return modelHandle(resolvers, kind, engineId);
  } catch {
    return null;
  }
}

function projectModelSourceRef(
  source: Readonly<ResolutionSourceRef>,
  resolvers: ModelReferenceResolvers,
): Record<string, unknown> {
  return {
    kind: source.kind,
    ref: modelHandle(resolvers, source.kind, source.id),
  };
}

function projectModelEffect(
  effect: Readonly<NonNullable<ResolutionPlan["primaryEffect"] | ResolutionPlan["threatenedEffect"]>>,
  resolvers: ModelReferenceResolvers,
): Record<string, unknown> {
  return {
    kind: effect.kind,
    effectId: effect.id,
    targetRef: modelHandle(resolvers, "entity", effect.targetId),
    channel: effect.channel,
    label: effect.label,
    description: effect.description,
    sourceRefs: effect.sourceRefs.map((source) => projectModelSourceRef(source, resolvers)),
    ...(effect.kind === "meter"
      ? {
          meterRef: modelHandle(resolvers, "meter", effect.meterId),
          impactProfileRef: modelHandle(resolvers, "mechanic", effect.impactProfileId),
        }
      : {
          conditionRef: modelHandle(resolvers, "condition", effect.conditionId),
          conditionProfileRef: maybeModelHandle(resolvers, "mechanic", effect.conditionProfileId),
          durationProfileRef: modelHandle(resolvers, "mechanic", effect.durationProfileId),
          access: effect.access.kind === "agents"
            ? { kind: effect.access.kind, agentRefs: effect.access.agentIds.map((id) => modelHandle(resolvers, "agent", id)) }
            : { kind: effect.access.kind },
        }),
  };
}

function projectModelResolutionPlan(
  plan: Readonly<ResolutionPlan>,
  resolvers: ModelReferenceResolvers,
): Record<string, unknown> {
  return {
    planRef: modelHandle(resolvers, "plan", plan.id),
    actionRef: modelHandle(resolvers, "action", plan.actionId),
    actorRef: modelHandle(resolvers, "entity", plan.actorId),
    targetRefs: plan.targetIds.map((id) => modelHandle(resolvers, "entity", id)),
    goal: plan.goal,
    means: plan.means.map((mean) => ({ description: mean.description, source: projectModelSourceRef(mean.source, resolvers) })),
    mode: plan.mode,
    difficulty: plan.difficulty === null
      ? null
      : plan.difficulty.kind === "environment"
        ? { kind: plan.difficulty.kind, band: plan.difficulty.band, source: projectModelSourceRef(plan.difficulty.source, resolvers) }
        : {
            kind: plan.difficulty.kind,
            targetRef: modelHandle(resolvers, "entity", plan.difficulty.targetId),
            ratingRef: modelHandle(resolvers, "rating", plan.difficulty.ratingId),
            source: projectModelSourceRef(plan.difficulty.source, resolvers),
          },
    actorRatingRef: maybeModelHandle(resolvers, "rating", plan.actorRatingId),
    factors: plan.factors.map((factor) => ({
      source: projectModelSourceRef(factor.source, resolvers),
      role: factor.role,
      direction: factor.direction,
      steps: factor.steps,
      authority: factor.authority,
      channel: factor.channel,
      explanation: factor.explanation,
    })),
    risk: plan.risk,
    baseEffect: plan.baseEffect,
    primaryEffect: plan.primaryEffect ? projectModelEffect(plan.primaryEffect, resolvers) : null,
    secondaryEffect: plan.secondaryEffect ? projectModelEffect(plan.secondaryEffect, resolvers) : null,
    threatenedEffect: plan.threatenedEffect ? projectModelEffect(plan.threatenedEffect, resolvers) : null,
    visibility: plan.visibility,
    causes: plan.causes.map((cause) => projectModelCausalRef(cause, resolvers)),
  };
}

function projectModelOperation(
  operation: Readonly<WorldDeltaOperation>,
  operationRef: string,
  resolvers: ModelReferenceResolvers,
): Record<string, unknown> {
  const base = {
    operationRef,
    kind: operation.kind,
    causes: operation.causes.map((cause) => projectModelCausalRef(cause, resolvers)),
    assertions: operation.assertions.map((assertion) => projectModelCausalAssertion(assertion, resolvers)),
  };
  switch (operation.kind) {
    case "create_entity":
      return { ...base, entity: { entityRef: maybeModelHandle(resolvers, "entity", operation.entity.id), kind: operation.entity.kind, name: operation.entity.name, description: operation.entity.description }, placementRef: operation.placementId === null ? null : modelHandle(resolvers, "placement", operation.placementId) };
    case "retire_entity":
      return { ...base, entityRef: modelHandle(resolvers, "entity", operation.entityId) };
    case "place_entity":
      return { ...base, entityRef: modelHandle(resolvers, "entity", operation.entityId), placementRef: operation.placementId === null ? null : modelHandle(resolvers, "placement", operation.placementId) };
    case "set_fact":
      return { ...base, fact: { factRef: maybeModelHandle(resolvers, "fact", operation.fact.id), subjectRef: modelHandle(resolvers, "entity", operation.fact.subjectId), predicate: operation.fact.predicate, value: projectModelFactValue(operation.fact.value, resolvers), description: operation.fact.description } };
    case "remove_fact":
      return { ...base, factRef: modelHandle(resolvers, "fact", operation.factId) };
    case "create_agent":
      return { ...base, agent: { agentRef: maybeModelHandle(resolvers, "agent", operation.agent.id), entityRef: modelHandle(resolvers, "entity", operation.agent.entityId) } };
    case "remove_agent":
      return { ...base, agentRef: modelHandle(resolvers, "agent", operation.agentId) };
    default:
      return base;
  }
}

function projectModelHistory(
  state: Readonly<SimulationState>,
  resolvers: ModelReferenceResolvers,
): unknown[] {
  return state.history.map((step) => ({
    revision: step.revision,
    step: step.step,
    actions: step.actions.map((action) => projectModelAction(action, resolvers.existing)),
    outcomes: step.outcomes.map((outcome) => projectModelOutcome(outcome, resolvers)),
    checks: step.checks.map((check) => projectModelCheckResult(check, resolvers)),
    randomResults: step.randomResults.map((result) => projectModelRandomResult(result, resolvers)),
    resolutionPlans: step.resolutionPlans.map((plan) => projectModelResolutionPlan(plan, resolvers)),
    events: step.events.map((event) => projectModelEvent(event, resolvers.existing)),
    observations: step.observations.map((observation) => projectModelObservation(observation, resolvers)),
    operations: step.operations.map((operation, index) => projectModelOperation(
      operation,
      modelHandle(resolvers, "operation", `${step.revision}:${index}:${operation.kind}`),
      resolvers,
    )),
  }));
}

function projectModelTransitionProposal(
  proposal: Readonly<TransitionProposal>,
  resolvers: ModelReferenceResolvers,
): Record<string, unknown> {
  const operationRefs = proposal.operations.map((operation, index) =>
    modelHandle(resolvers, "operation", `${index}:${operation.kind}`));
  return {
    baseRevision: proposal.baseRevision,
    outcomes: proposal.outcomes.map((outcome) => projectModelOutcome(outcome, resolvers)),
    mechanicInvocations: proposal.mechanicInvocations.map((invocation) => ({
      invocationRef: modelHandle(resolvers, "mechanic", invocation.id),
      packageId: invocation.packageId,
      ruleId: invocation.ruleId,
      input: structuredClone(invocation.input),
      causes: invocation.causes.map((cause) => projectModelCausalRef(cause, resolvers)),
      assertions: invocation.assertions.map((assertion) => projectModelCausalAssertion(assertion, resolvers)),
    })),
    operations: proposal.operations.map((operation, index) => projectModelOperation(operation, operationRefs[index]!, resolvers)),
    events: proposal.events.map((event) => ({
      eventRef: modelHandle(resolvers, "event", event.id),
      description: event.description,
      impact: event.impact,
      causes: event.causes.map((cause) => projectModelCausalRef(cause, resolvers)),
    })),
    observations: proposal.observations.map((observation) => projectModelObservation(observation, resolvers)),
    decisionRequests: proposal.decisionRequests.map((request) => ({
      agentRef: modelHandle(resolvers, "agent", request.agentId),
      prompt: request.prompt,
      suggestions: [...request.suggestions],
    })),
  };
}

function projectModelAssertionResult(
  result: Readonly<CausalAssertionResult>,
  resolvers: ModelReferenceResolvers,
): Record<string, unknown> {
  return {
    target: {
      kind: result.target.kind,
      ref: modelHandle(resolvers, result.target.kind === "activity" ? "activity" : result.target.kind, result.target.id),
    },
    assertion: projectModelCausalAssertion(result.assertion, resolvers),
    passed: result.passed,
    observed: structuredClone(result.observed),
  };
}

function projectModelCommitmentRound(
  round: Readonly<CommitmentRound>,
  resolvers: ModelReferenceResolvers,
): Record<string, unknown> {
  return {
    kind: round.kind,
    ...(round.kind === "check" ? { phase: round.phase } : {}),
    requestRefs: round.requestIds.map((id) => modelHandle(resolvers, round.kind === "check" ? "check" : "random", id)),
  };
}

function resolutionPlanReferenceCandidates(
  plans: readonly ResolutionPlan[],
): ReferenceCandidateInput[] {
  return plans.flatMap((plan) => [
    ...[plan.primaryEffect, plan.secondaryEffect, plan.threatenedEffect]
      .filter((effect): effect is NonNullable<typeof effect> => effect !== null)
      .flatMap((effect) => {
        const profileIds = effect.kind === "meter"
          ? [effect.impactProfileId]
          : [effect.conditionProfileId, effect.durationProfileId].filter((id): id is string => id !== null);
        return [
          { kind: effect.kind === "meter" ? "meter" as const : "condition" as const, engineId: effect.kind === "meter" ? effect.meterId : effect.conditionId, label: effect.label, meaning: "an effect channel named by a committed resolution plan", allowedUses: ["assertion", "source"] as const, visibility: "role" as const },
          ...profileIds.map((id) => ({ kind: "mechanic" as const, engineId: id, label: id, meaning: "an authored mechanic profile used by a committed resolution plan", allowedUses: ["mechanic", "source"] as const, visibility: "role" as const })),
        ];
      }),
    ...(plan.actorRatingId ? [{ kind: "rating" as const, engineId: plan.actorRatingId, label: plan.actorRatingId, meaning: "an actor rating used by a committed resolution plan", allowedUses: ["modifier", "assertion", "source"] as const, visibility: "role" as const }] : []),
    ...(plan.difficulty?.kind === "opposed" ? [{ kind: "rating" as const, engineId: plan.difficulty.ratingId, label: plan.difficulty.ratingId, meaning: "an opposed target rating used by a committed resolution plan", allowedUses: ["modifier", "assertion", "source"] as const, visibility: "role" as const }] : []),
  ]);
}

/** Project canonical truth into the model vocabulary. Engine ids are retained
 * only inside the resolver closure; every cross-record reference in this
 * projection is a request-local handle. Authored mechanic keys remain visible
 * because they are configuration names, not runtime identities. */
export function projectCanonicalTruthForModel(
  truth: Readonly<SimulationState["truth"]>,
  resolver: ReferenceResolver,
  options: { includeMechanics?: boolean } = {},
): Record<string, unknown> {
  const handle = (kind: Parameters<ReferenceResolver["handleFor"]>[0], id: string) => resolver.handleFor(kind, id);
  const factValue = (value: Readonly<SimulationState["truth"]["facts"][string]["value"]>): unknown =>
    value.kind === "entity"
      ? { kind: "entity", entityRef: handle("entity", value.entityId) }
      : structuredClone(value);
  const access = (value: Readonly<SimulationState["truth"]["facts"][string]["access"]>): unknown =>
    value.kind === "agents"
      ? { kind: value.kind, agentRefs: value.agentIds.map((id) => handle("agent", id)) }
      : structuredClone(value);
  const entities = Object.fromEntries(Object.values(truth.entities).map((entity) => [
    handle("entity", entity.id), {
      kind: entity.kind,
      name: entity.name,
      description: entity.description,
      lifecycle: entity.lifecycle,
      placementRef: truth.placements[entity.id] ? handle("placement", truth.placements[entity.id]!) : null,
    },
  ]));
  const placements = Object.fromEntries(Object.entries(truth.placements).map(([entityId, containerId]) => [
    handle("placement", entityId),
    containerId ? handle("placement", containerId) : null,
  ]));
  const facts = Object.fromEntries(Object.values(truth.facts).map((fact) => [
    handle("fact", fact.id), {
      subjectRef: handle("entity", fact.subjectId),
      predicate: fact.predicate,
      value: factValue(fact.value),
      description: fact.description,
      access: access(fact.access),
    },
  ]));
  const meters = Object.fromEntries(Object.values(truth.meters).map((meter) => [
    handle("meter", meter.id), {
      definitionId: meter.definitionId,
      entityRef: handle("entity", meter.entityId),
      current: meter.current,
      firedThresholdIds: [...meter.firedThresholdIds],
    },
  ]));
  const quantities = Object.fromEntries(Object.values(truth.quantities).map((quantity) => [
    handle("quantity", quantity.id), {
      definitionId: quantity.definitionId,
      holderRef: handle("entity", quantity.holderId),
      amount: quantity.amount,
    },
  ]));
  const ratings = Object.fromEntries(Object.values(truth.ratings).map((rating) => [
    handle("rating", rating.id), {
      definitionId: rating.definitionId,
      entityRef: handle("entity", rating.entityId),
      value: rating.value,
    },
  ]));
  const conditions = Object.fromEntries(Object.values(truth.conditions).map((condition) => [
    handle("condition", condition.id), {
      subjectRef: handle("entity", condition.subjectId),
      label: condition.label,
      description: condition.description,
      magnitude: condition.magnitude,
      conditionProfileId: condition.conditionProfileId,
      durationProfileId: condition.durationProfileId,
      access: access(condition.access),
    },
  ]));
  const activities = Object.fromEntries(Object.values(truth.activities).map((activity) => [
    handle("activity", activity.id), {
      actorRef: handle("agent", activity.actorId),
      participantAgentRefs: activity.participantAgentIds.map((id) => handle("agent", id)),
      status: activity.status,
      sourceActionRef: handle("action", activity.sourceActionId),
      description: ("plan" in activity ? activity.plan : activity.planDraft).description,
      completionAtSeconds: "plan" in activity ? activity.plan.completionAtSeconds : null,
    },
  ]));
  const timers = Object.fromEntries(Object.values(truth.timers).map((timer) => [
    handle("timer", timer.id), {
      wakeAgentRefs: timer.wakeAgentIds.map((id) => handle("agent", id)),
      assertions: structuredClone(timer.assertions),
    },
  ]));
  const events = Object.fromEntries(Object.values(truth.events).map((event) => [
    handle("event", event.id), {
      description: event.description,
      impact: event.impact,
      causes: event.causes.map((cause) => ({ kind: cause.kind, ref: handle(cause.kind, cause.id) })),
    },
  ]));
  const projected: Record<string, unknown> = {
    elapsedSeconds: truth.elapsedSeconds,
    entities,
    placements,
    facts,
    factTombstones: truth.factTombstones.map((id) => handle("fact", id)),
    meters,
    quantities,
    ratings,
    conditions,
    activities,
    timers,
    events,
    sharedActivityResourcePools: Object.fromEntries(Object.values(truth.sharedActivityResourcePools).map((pool) => [
      handle("shared_resource_pool", pool.id), {
        definitionId: pool.definitionId,
        entityRef: handle("entity", pool.entityId),
        capacity: pool.capacity,
      },
    ])),
  };
  if (options.includeMechanics !== false) projected.mechanics = structuredClone(truth.mechanics);
  return projected;
}

type ModelActionView = {
  actionRef: string;
  actorRef: string;
  rawText: string;
  goal: string;
  means: string | null;
  targetRefs: string[];
};

export function projectModelAction(
  action: Readonly<AgentActionProposal>,
  resolver: ReferenceResolver,
): ModelActionView {
  const tryHandle = (kind: Parameters<ReferenceResolver["handleFor"]>[0], id: string): string | null => {
    try {
      return resolver.handleFor(kind, id);
    } catch {
      return null;
    }
  };
  return {
    actionRef: resolver.handleFor("action", action.id),
    actorRef: resolver.handleFor("agent", action.actorId),
    rawText: action.rawText,
    goal: action.goal,
    means: action.means,
    targetRefs: action.targetIds
      .map((targetId) => tryHandle("local_entity", `${action.actorId}::${targetId}`))
      .filter((reference): reference is string => reference !== null),
  };
}

export function projectModelEvent(
  event: Readonly<WorldEvent>,
  resolver: ReferenceResolver,
): Record<string, unknown> {
  const refFor = (entry: { kind: string; id: string }): string => {
    const kind = entry.kind === "global" ? "world" : entry.kind;
    return resolver.handleFor(kind as Parameters<ReferenceResolver["handleFor"]>[0], entry.id);
  };
  return {
    eventRef: resolver.handleFor("event", event.id),
    description: event.description,
    impact: event.impact,
    causes: event.causes.map((cause) => ({ kind: cause.kind, ref: refFor(cause) })),
  };
}

function projectModelGrounding(
  grounding: Readonly<InteractionDependency>,
  resolver: ReferenceResolver,
): Record<string, unknown> {
  const kind = grounding.kind;
  const ref = resolver.handleFor(kind, grounding.id);
  const refFor = (entry: { kind: string; id: string }): string => {
    const kind = entry.kind === "global" ? "world" : entry.kind;
    return resolver.handleFor(kind as Parameters<ReferenceResolver["handleFor"]>[0], entry.id);
  };
  return {
    kind,
    ref,
    actorRef: grounding.actorId === null ? null : resolver.handleFor("agent", grounding.actorId),
    requiredExistingRefs: grounding.reads.map(refFor),
    potentiallyAffectedExistingRefs: grounding.writes.map(refFor),
    audienceAgentRefs: grounding.audienceAgentIds.map((agentId) => resolver.handleFor("agent", agentId)),
    sharedResourceClaims: grounding.sharedResourceClaims.map((claim) => ({
      resourcePoolRef: resolver.handleFor("shared_resource_pool", claim.poolId),
      amount: claim.amount,
      unit: claim.basis.kind === "explicit_quantity" ? claim.basis.unit : null,
      basis: claim.basis.kind,
    })),
    requiresWorldWideArbitration: grounding.globalFallback,
  };
}

function projectModelGroundings(
  groundings: readonly InteractionDependency[],
  resolver: ReferenceResolver,
): Record<string, unknown>[] {
  return groundings.map((grounding) => projectModelGrounding(grounding, resolver));
}

function scopedActors(
  state: Readonly<SimulationState>,
  actions: readonly AgentActionProposal[],
  groundings: readonly InteractionDependency[],
): Record<string, { entityId: string; existingLocalEntityIds: string[]; localEntityBindings: Record<string, string[]> }> {
  const ids = new Set<string>(actions.map((action) => action.actorId));
  groundings.forEach((grounding) => {
    if (grounding.actorId !== null) ids.add(grounding.actorId);
    grounding.audienceAgentIds.forEach((agentId) => ids.add(agentId));
  });
  return Object.fromEntries(Object.values(state.agents)
    .filter((agent) => ids.has(agent.id))
    .map((agent) => [agent.id, {
      entityId: agent.entityId,
      existingLocalEntityIds: Object.keys(agent.belief.localEntities).sort(),
      localEntityBindings: Object.fromEntries(Object.entries(agent.bindings)
        .filter(([, binding]) => binding.canonicalEntityIds.length > 0)
        .map(([localId, binding]) => [localId, [...binding.canonicalEntityIds].sort()])),
    }]));
}

function projectModelActors(
  state: Readonly<SimulationState>,
  actions: readonly AgentActionProposal[],
  groundings: readonly InteractionDependency[],
  resolver: ReferenceResolver,
): Record<string, unknown>[] {
  const scoped = scopedActors(state, actions, groundings);
  return Object.entries(scoped).map(([agentId, actor]) => ({
    agentRef: resolver.handleFor("agent", agentId),
    entityRef: resolver.handleFor("entity", actor.entityId),
    availableLocalEntityRefs: actor.existingLocalEntityIds.flatMap((localId) => {
      try {
        return [resolver.handleFor("local_entity", `${agentId}::${localId}`)];
      } catch {
        return [];
      }
    }),
    boundCanonicalEntityRefs: Object.values(actor.localEntityBindings).flatMap((entityIds) =>
      entityIds.map((entityId) => resolver.handleFor("entity", entityId))),
  }));
}

function perceptionCheckConstraints(
  state: Readonly<SimulationState>,
  actions: readonly AgentActionProposal[],
  groundings: readonly InteractionDependency[],
): unknown {
  const actorEntityIds = new Set(Object.values(scopedActors(state, actions, groundings))
    .map((actor) => actor.entityId));
  return {
    actors: [...actorEntityIds].sort().map((actorId) => ({
      actorId,
      ratings: Object.values(state.truth.ratings)
        .filter((rating) => rating.entityId === actorId)
        .sort((left, right) => left.id.localeCompare(right.id))
        .map((rating) => ({ id: rating.id, value: rating.value })),
    })),
  };
}

/** Build the one catalog shared by every Truth role for this execution. The
 * catalog carries human-readable meaning while the resolver keeps engine ids
 * private to the server. Keeping this factory here prevents prompt and
 * materialization code from drifting into different handle namespaces. */
export function createTruthReferenceResolver(input: {
  state: Readonly<SimulationState>;
  definition: WorldDefinition;
  actions: readonly AgentActionProposal[];
  events?: readonly WorldEvent[];
  outcomes?: readonly ActionOutcome[];
  checkRequests?: readonly D20CheckRequest[];
  randomRequests?: readonly DiscreteRandomRequest[];
  contextState?: Readonly<SimulationState>;
  contextActions?: readonly AgentActionProposal[];
  includeHistoryActions?: boolean;
  extraCandidates?: readonly ReferenceCandidateInput[];
}): ReferenceResolver {
  const state = input.contextState ?? input.state;
  const actions = input.contextActions ?? input.actions;
  const events = input.events ?? [];
  const outcomes = input.outcomes ?? [];
  const checkRequests = input.checkRequests ?? [];
  const randomRequests = input.randomRequests ?? [];
  const includeHistoryActions = input.includeHistoryActions !== false;
  const compactLabel = (value: string, limit = 160): string =>
    value.length <= limit ? value : `${value.slice(0, limit - 1)}…`;
  const historicalAgentIds = new Set([
    ...state.history.flatMap((step) => step.actions.map((action) => action.actorId)),
    ...state.history.flatMap((step) => step.observations.map((observation) => observation.observerId)),
    ...Object.keys(state.historyBase?.agents ?? {}),
  ]);
  const localTargetsByAgent = new Map<string, Set<string>>();
  for (const action of actions) {
    const targets = localTargetsByAgent.get(action.actorId) ?? new Set<string>();
    action.targetIds.forEach((targetId) => targets.add(targetId));
    localTargetsByAgent.set(action.actorId, targets);
  }
  const relevantAgentIds = new Set(actions.map((action) => action.actorId));
  return createReferenceResolver([
    ...Object.values(state.agents).map((agent) => ({
      kind: "agent" as const, engineId: agent.id, label: agent.id,
      meaning: "an Agent participating in this execution", allowedUses: ["actor", "target", "audience", "cause"] as const,
      visibility: "role" as const, statePath: `state.agents.${agent.id}`,
    })),
    ...[...historicalAgentIds]
      .filter((agentId) => !state.agents[agentId])
      .map((agentId) => ({
        kind: "agent" as const, engineId: agentId, label: agentId,
        meaning: "an Agent referenced by committed history",
        allowedUses: ["actor", "target", "audience", "cause"] as const,
        visibility: "role" as const,
        statePath: `history.agents.${agentId}`,
      })),
    ...Object.values(state.agents).flatMap((agent) => Object.values(agent.belief.localEntities)
      .filter((entity) => relevantAgentIds.has(agent.id) && (localTargetsByAgent.get(agent.id)?.has(entity.id) ?? false))
      .map((entity) => ({
      kind: "local_entity" as const,
      engineId: `${agent.id}::${entity.id}`,
      label: entity.name,
      meaning: "an actor-local name used by that Agent; it is not a canonical identity",
      allowedUses: ["target", "subject"] as const,
      visibility: "role" as const,
      statePath: `state.agents.${agent.id}.belief.localEntities.${entity.id}`,
      }))),
    ...Object.values(state.truth.entities).map((entity) => ({
      kind: "entity" as const, engineId: entity.id, label: entity.name,
      meaning: "an existing canonical world entity", allowedUses: ["actor", "target", "subject", "cause", "assertion", "source"] as const,
      visibility: "role" as const, statePath: `state.truth.entities.${entity.id}`,
    })),
    ...Object.keys(state.truth.placements).map((placementId) => ({
      kind: "placement" as const, engineId: placementId, label: placementId,
      meaning: "an existing world placement/container", allowedUses: ["assertion", "source"] as const,
      visibility: "role" as const, statePath: `state.truth.placements.${placementId}`,
    })),
    ...Object.values(state.truth.facts).map((fact) => ({
      kind: "fact" as const, engineId: fact.id, label: fact.predicate,
      meaning: "an existing canonical world fact", allowedUses: ["cause", "assertion", "source"] as const,
      visibility: "role" as const, statePath: `state.truth.facts.${fact.id}`,
    })),
    ...Object.values(state.truth.ratings).map((rating) => ({
      kind: "rating" as const, engineId: rating.id, label: rating.definitionId,
      meaning: `a rating owned by ${rating.entityId}`, allowedUses: ["modifier", "assertion", "source"] as const,
      visibility: "role" as const, statePath: `state.truth.ratings.${rating.id}`,
    })),
    ...Object.values(state.truth.meters).map((meter) => ({
      kind: "meter" as const, engineId: meter.id, label: meter.definitionId,
      meaning: "an existing world meter", allowedUses: ["assertion", "source"] as const,
      visibility: "role" as const, statePath: `state.truth.meters.${meter.id}`,
    })),
    ...Object.values(state.truth.quantities).map((quantity) => ({
      kind: "quantity" as const, engineId: quantity.id, label: quantity.definitionId,
      meaning: "an existing holder quantity", allowedUses: ["assertion", "source"] as const,
      visibility: "role" as const, statePath: `state.truth.quantities.${quantity.id}`,
    })),
    ...Object.values(state.truth.conditions).map((condition) => ({
      kind: "condition" as const, engineId: condition.id, label: condition.label,
      meaning: "an existing world condition", allowedUses: ["assertion", "source"] as const,
      visibility: "role" as const, statePath: `state.truth.conditions.${condition.id}`,
    })),
    ...Object.values(state.truth.sharedActivityResourcePools).map((pool) => ({
      kind: "shared_resource_pool" as const, engineId: pool.id, label: pool.definitionId,
      meaning: "an existing shared activity resource pool", allowedUses: ["assertion", "source"] as const,
      visibility: "role" as const, statePath: `state.truth.sharedActivityResourcePools.${pool.id}`,
    })),
    ...Object.values(state.truth.activities).map((activity) => ({
      kind: "activity" as const, engineId: activity.id, label: ("plan" in activity ? activity.plan : activity.planDraft).description,
      meaning: "an existing scheduled activity whose continuation state may affect this decision",
      allowedUses: ["cause", "assertion", "source"] as const,
      visibility: "role" as const, statePath: `state.truth.activities.${activity.id}`,
    })),
    ...Object.values(state.truth.timers).map((timer) => ({
      kind: "timer" as const, engineId: timer.id, label: timer.id,
      meaning: "an existing timer that may wake an Agent or advance a condition",
      allowedUses: ["cause", "assertion", "source"] as const,
      visibility: "role" as const, statePath: `state.truth.timers.${timer.id}`,
    })),
    ...Object.values(state.truth.events).map((event) => ({
      kind: "event" as const, engineId: event.id, label: event.description,
      meaning: "an already committed world event", allowedUses: ["cause", "assertion", "source"] as const,
      visibility: "role" as const, statePath: `state.truth.events.${event.id}`,
    })),
    ...events.map((event) => ({
      kind: "event" as const, engineId: event.id, label: event.description,
      meaning: "an event produced by the current transition proposal", allowedUses: ["cause", "assertion", "source"] as const,
      visibility: "role" as const, statePath: `proposal.events.${event.id}`,
    })),
    ...outcomes.map((outcome) => ({
      kind: "outcome" as const, engineId: outcome.id, label: compactLabel(outcome.summary),
      meaning: "an action outcome proposed by the current transition", allowedUses: ["cause", "assertion", "source"] as const,
      visibility: "role" as const, statePath: `proposal.outcomes.${outcome.id}`,
    })),
    ...randomRequests.map((request) => ({
      kind: "random" as const,
      engineId: request.id,
      label: request.distributionId,
      meaning: "a committed random request available to the current stage",
      allowedUses: ["cause", "assertion", "source"] as const,
      visibility: "role" as const,
      statePath: `execution.randomRequests.${request.id}`,
    })),
    ...randomRequests.flatMap((request) => request.distribution.steps.map((randomStep) => ({
      kind: "random" as const,
      engineId: randomStep.id,
      label: `${request.distributionId}/${randomStep.id}`,
      meaning: "a step inside the current random distribution",
      allowedUses: ["assertion", "source"] as const,
      visibility: "role" as const,
      statePath: `execution.randomRequests.${request.id}.distribution.steps.${randomStep.id}`,
    }))),
    ...state.history.flatMap((step) => step.outcomes.map((outcome) => ({
      kind: "outcome" as const,
      engineId: outcome.id,
      label: compactLabel(outcome.summary),
      meaning: "an already committed action outcome",
      allowedUses: ["cause", "assertion", "source"] as const,
      visibility: "role" as const,
      statePath: `history.${step.revision}.outcomes.${outcome.id}`,
    }))),
    ...state.history.flatMap((step) => step.observations.map((observation) => ({
      kind: "observation" as const,
      engineId: observation.id,
      label: compactLabel(observation.summary),
      meaning: "an observation already delivered to an Agent",
      allowedUses: ["cause", "assertion", "source"] as const,
      visibility: "role" as const,
      statePath: `history.${step.revision}.observations.${observation.id}`,
    }))),
    ...state.history.flatMap((step) => step.operations.map((operation, index) => ({
      kind: "operation" as const,
      engineId: `${step.revision}:${index}:${operation.kind}`,
      label: operation.kind,
      meaning: "an already committed deterministic world operation",
      allowedUses: ["cause", "assertion", "source"] as const,
      visibility: "role" as const,
      statePath: `history.${step.revision}.operations.${index}`,
    }))),
    ...state.history.flatMap((step) => step.mechanicInvocations.map((invocation) => ({
      kind: "mechanic" as const,
      engineId: invocation.id,
      label: `${invocation.packageId}/${invocation.ruleId}`,
      meaning: "an already committed mechanic invocation",
      allowedUses: ["cause", "assertion", "source"] as const,
      visibility: "role" as const,
      statePath: `history.${step.revision}.mechanicInvocations.${invocation.id}`,
    }))),
    ...state.history.flatMap((step) => step.resolutionPlans.map((plan) => ({
      kind: "plan" as const,
      engineId: plan.id,
      label: compactLabel(plan.goal),
      meaning: "an already committed resolution plan",
      allowedUses: ["cause", "assertion", "source", "target"] as const,
      visibility: "role" as const,
      statePath: `history.${step.revision}.resolutionPlans.${plan.id}`,
    }))),
    ...[
      ...(includeHistoryActions ? state.history.flatMap((step) => step.actions) : []),
      ...Object.values(state.truth.activities).map((activity) => activity.sourceAction),
      ...actions,
    ].map((action) => ({
      kind: "action" as const, engineId: action.id, label: compactLabel(action.rawText),
      meaning: "an action being adjudicated in this step", allowedUses: ["cause", "assertion", "source"] as const,
      visibility: "role" as const, statePath: `task.actions.${action.id}`,
    })),
    ...checkRequests.map((check) => ({
      kind: "check" as const, engineId: check.id, label: check.stakes,
      meaning: "a committed check result available to the current stage", allowedUses: ["cause", "assertion", "source"] as const,
      visibility: "role" as const, statePath: `execution.checks.${check.id}`,
    })),
    ...state.history.flatMap((step) => step.checks.map((check) => ({
      kind: "check" as const,
      engineId: check.requestId,
      label: check.requestId,
      meaning: "a committed check result available to this stage",
      allowedUses: ["cause", "assertion", "source"] as const,
      visibility: "role" as const,
      statePath: `history.${step.revision}.checks.${check.requestId}`,
    }))),
    ...state.history.flatMap((step) => step.randomRequests.map((request) => ({
      kind: "random" as const,
      engineId: request.id,
      label: request.distributionId,
      meaning: "a committed random request available to this stage",
      allowedUses: ["cause", "assertion", "source"] as const,
      visibility: "role" as const,
      statePath: `history.${step.revision}.randomRequests.${request.id}`,
    }))),
    ...state.history.flatMap((step) => step.randomRequests.flatMap((request) => request.distribution.steps.map((randomStep) => ({
      kind: "random" as const,
      engineId: randomStep.id,
      label: `${request.distributionId}/${randomStep.id}`,
      meaning: "a step inside a committed random distribution",
      allowedUses: ["assertion", "source"] as const,
      visibility: "role" as const,
      statePath: `history.${step.revision}.randomRequests.${request.id}.distribution.steps.${randomStep.id}`,
    })))),
    ...input.definition.laws.map((law) => ({
      kind: "law" as const, engineId: law.id, label: law.id,
      meaning: "an authored world law", allowedUses: ["cause", "assertion", "source"] as const,
      visibility: "role" as const, statePath: `state.world.laws.${law.id}`,
    })),
    ...Object.values(state.truth.mechanics.impactProfiles).map((profile) => ({
      kind: "mechanic" as const, engineId: profile.id, label: profile.id,
      meaning: "an authored impact profile", allowedUses: ["mechanic", "source"] as const,
      visibility: "role" as const, statePath: `state.truth.mechanics.impactProfiles.${profile.id}`,
    })),
    ...Object.values(state.truth.mechanics.durationProfiles).map((profile) => ({
      kind: "mechanic" as const, engineId: profile.id, label: profile.id,
      meaning: "an authored duration profile", allowedUses: ["mechanic", "source"] as const,
      visibility: "role" as const, statePath: `state.truth.mechanics.durationProfiles.${profile.id}`,
    })),
    ...Object.values(state.truth.mechanics.conditionProfiles).map((profile) => ({
      kind: "mechanic" as const, engineId: profile.id, label: profile.id,
      meaning: "an authored condition profile", allowedUses: ["mechanic", "source"] as const,
      visibility: "role" as const, statePath: `state.truth.mechanics.conditionProfiles.${profile.id}`,
    })),
    ...Object.values(state.truth.mechanics.entityMechanicsProfiles).map((profile) => ({
      kind: "mechanic" as const, engineId: profile.id, label: profile.id,
      meaning: "an authored entity mechanics profile", allowedUses: ["mechanic", "source"] as const,
      visibility: "role" as const, statePath: `state.truth.mechanics.entityMechanicsProfiles.${profile.id}`,
    })),
    ...Object.values(state.truth.mechanics.temporalProfiles).map((profile) => ({
      kind: "mechanic" as const, engineId: profile.id, label: profile.id,
      meaning: "an authored temporal profile", allowedUses: ["mechanic", "source"] as const,
      visibility: "role" as const, statePath: `state.truth.mechanics.temporalProfiles.${profile.id}`,
    })),
    { kind: "world" as const, engineId: "world", label: "world", meaning: "world-wide arbitration scope", allowedUses: ["conflict"] as const, visibility: "role" as const },
    ...(input.extraCandidates ?? []),
  ]);
}

export function buildTruthContext(input: {
  definition: WorldDefinition;
  state: SimulationState;
  initialActions: readonly AgentActionProposal[];
  actions: readonly AgentActionProposal[];
  reactionRequests: readonly ReactionRequest[];
  reactionDecisions: readonly ReactionDecision[];
  reactionWindow: "open" | "closed";
  committedCheckRequests: readonly D20CheckRequest[];
  checkResults: readonly D20CheckResult[];
  committedRandomRequests: readonly DiscreteRandomRequest[];
  randomResults: readonly DiscreteRandomResult[];
  commitmentRounds: readonly CommitmentRound[];
  resolutionPlans: readonly ResolutionPlan[];
  resolutionReceipts: readonly ResolutionReceipt[];
  groundings: readonly InteractionDependency[];
  temporalBoundary: TemporalBoundary;
  instanceId: string;
  advanceId: string;
  issues: readonly PromptValidationIssue[];
  stage?: "perception" | "reaction-routing" | "resolution" | "transition";
  contextMode?: TruthContextMode;
  contextState?: SimulationState;
  contextActions?: readonly AgentActionProposal[];
  contextInitialActions?: readonly AgentActionProposal[];
  contextGroundings?: readonly InteractionDependency[];
  includeHistoryActions?: boolean;
  outputActions?: readonly AgentActionProposal[];
  outputGroundings?: readonly InteractionDependency[];
  resolutionScope?: ResolutionScope;
  mechanicContracts?: readonly MechanicPromptContract[];
  repairTarget?: {
    kind: "mechanic" | "plan" | "operation" | "event" | "outcome" | "observation";
    id: string;
    issueClass: string;
  } | null;
}): unknown {
  const stage = input.stage ?? "transition";
  const contextMode = input.contextMode ?? "scoped";
  const contextState = input.contextState ?? input.state;
  const contextActions = input.contextActions ?? input.actions;
  const contextInitialActions = input.contextInitialActions ?? input.initialActions;
  const contextGroundings = input.contextGroundings ?? input.groundings;
  const referenceResolver = createTruthReferenceResolver({
    state: contextState,
    definition: input.definition,
    actions: contextActions,
    contextState,
    contextActions,
    includeHistoryActions: input.includeHistoryActions,
    checkRequests: input.committedCheckRequests,
    randomRequests: input.committedRandomRequests,
    extraCandidates: [
      ...input.resolutionPlans.map((plan) => ({
        kind: "plan" as const,
        engineId: plan.id,
        label: plan.goal,
        meaning: "a committed resolution plan for this transition",
        allowedUses: ["cause", "assertion", "source", "target"] as const,
        visibility: "role" as const,
      })),
      ...resolutionPlanReferenceCandidates(input.resolutionPlans),
    ],
  });
  const visibleTruth = contextMode === "full"
    ? contextState.truth
    : scopedCanonicalTruth(input.state, input.actions, input.groundings);
  const assignedActions = input.outputActions ?? input.actions;
  const assignedGroundings = input.outputGroundings ?? input.groundings;
  const promptId: PromptBundleId = stage === "perception"
    ? "truth-perception"
    : stage === "reaction-routing"
      ? "truth-reaction-routing"
      : stage === "resolution"
        ? "truth-resolution"
        : "truth-transition";
  return {
    contractVersion: MODEL_CONTEXT_CONTRACT_VERSION,
    promptVersion: promptBundle(promptId).version,
    execution: {
      worldId: input.definition.id,
      instanceId: input.instanceId,
      advanceId: input.advanceId,
    },
    roleContract: modelRoleContract(promptId),
    referenceCatalog: referenceResolver.catalog,
    trustBoundary: {
      externalActions: "untrusted-action-attempts",
      assignedActions: "untrusted-action-attempts",
      authoritativeState: "canonicalTruth-and-committed-history-only",
    },
    world: {
      id: input.definition.id,
      name: input.definition.name,
      description: input.definition.description,
      laws: input.definition.laws,
      disclosure: input.definition.disclosure,
      rulePackages: input.definition.rulePackages,
      randomDistributions: input.definition.randomDistributions,
      mechanicContracts: input.mechanicContracts ? structuredClone(input.mechanicContracts) : [],
    },
    baseRevision: input.state.revision,
    step: input.state.step,
    canonicalTruth: projectCanonicalTruthForModel(visibleTruth, referenceResolver),
    semanticHistory: projectModelHistory(input.state, { existing: referenceResolver }),
    actors: projectModelActors(
      contextMode === "full" ? contextState : input.state,
      contextMode === "full" ? contextActions : input.actions,
      contextMode === "full" ? contextGroundings : input.groundings,
      referenceResolver,
    ),
    task: {
      initialActions: contextInitialActions.map((action) => projectModelAction(action, referenceResolver)),
      assignedActions: assignedActions.map((action) => projectModelAction(action, referenceResolver)),
      availableActions: contextActions.map((action) => projectModelAction(action, referenceResolver)),
      assignedDependencies: projectModelGroundings(assignedGroundings, referenceResolver),
      availableDependencies: projectModelGroundings(contextGroundings, referenceResolver),
    },
    temporalBoundary: input.temporalBoundary,
    reactionRequests: input.reactionRequests.map((request) => ({
      requestRef: maybeModelHandle({ existing: referenceResolver }, "operation", request.id),
      agentRef: maybeModelHandle({ existing: referenceResolver }, "agent", request.agentId),
      triggerActionRef: maybeModelHandle({ existing: referenceResolver }, "action", request.triggerActionId),
      originalIntent: request.originalIntent.kind === "prepared_action"
        ? { kind: request.originalIntent.kind, actionRef: maybeModelHandle({ existing: referenceResolver }, "action", request.originalIntent.actionId) }
        : { kind: request.originalIntent.kind, activityRef: maybeModelHandle({ existing: referenceResolver }, "activity", request.originalIntent.activityId), sourceActionRef: maybeModelHandle({ existing: referenceResolver }, "action", request.originalIntent.sourceActionId) },
      stimulus: projectModelObservation(request.stimulus, { existing: referenceResolver }),
      basis: request.basis.map((basis) => basis.kind === "shared_placement"
        ? { kind: basis.kind, placementRef: modelHandle({ existing: referenceResolver }, "placement", basis.placementId) }
        : basis.kind === "fact"
          ? { kind: basis.kind, factRef: modelHandle({ existing: referenceResolver }, "fact", basis.factId) }
          : { kind: basis.kind, checkRef: modelHandle({ existing: referenceResolver }, "check", basis.checkId) }),
    })),
    reactionDecisions: input.reactionDecisions.map((decision) => ({
      requestRef: maybeModelHandle({ existing: referenceResolver }, "operation", decision.requestId),
      agentRef: maybeModelHandle({ existing: referenceResolver }, "agent", decision.agentId),
      originalActionRef: maybeModelHandle({ existing: referenceResolver }, "action", decision.originalProposalId),
      source: decision.source,
      kind: decision.kind,
      ...(decision.kind === "keep"
        ? { ongoingActivityDisposition: decision.ongoingActivityDisposition }
        : { replacementAction: projectModelAction(decision.replacementAction, referenceResolver) }),
    })),
    reactionWindow: input.reactionWindow,
    committedCheckRequests: input.committedCheckRequests.map((request) => projectModelCheckRequest(request, { existing: referenceResolver })),
    checkResults: input.checkResults.map((result) => projectModelCheckResult(result, { existing: referenceResolver })),
    committedRandomRequests: input.committedRandomRequests.map((request) => projectModelRandomRequest(request, { existing: referenceResolver })),
    randomResults: input.randomResults.map((result) => projectModelRandomResult(result, { existing: referenceResolver })),
    commitmentRounds: input.commitmentRounds.map((round) => projectModelCommitmentRound(round, { existing: referenceResolver })),
    committedResolutionPlans: input.resolutionPlans.map((plan) => projectModelResolutionPlan(plan, { existing: referenceResolver })),
    resolutionReceipts: input.resolutionReceipts.map((receipt) => ({
      plan: projectModelResolutionPlan(receipt.plan, { existing: referenceResolver }),
      settled: receipt.settled,
      checkRef: maybeModelHandle({ existing: referenceResolver }, "check", receipt.checkRequestId),
      outcome: receipt.outcome,
      effectCount: receipt.effects.length,
      operationCount: receipt.operations.length,
    })),
    validationIssues: input.issues,
    resolutionScope: input.resolutionScope ?? null,
    repairTarget: input.repairTarget ? structuredClone(input.repairTarget) : null,
    ...(stage === "perception" ? {
      perceptionCheckConstraints: perceptionCheckConstraints(input.state, input.actions, input.groundings),
    } : {}),
    stage,
  };
}

export function buildCausalVerificationContext(input: {
  definition: WorldDefinition;
  state: SimulationState;
  actions: readonly AgentActionProposal[];
  groundings: readonly InteractionDependency[];
  checkRequests: readonly D20CheckRequest[];
  checkResults: readonly D20CheckResult[];
  randomRequests: readonly DiscreteRandomRequest[];
  randomResults: readonly DiscreteRandomResult[];
  commitmentRounds: readonly CommitmentRound[];
  resolutionPlans: readonly ResolutionPlan[];
  resolutionReceipts: readonly ResolutionReceipt[];
  proposal: TransitionProposal;
  assertionResults: readonly CausalAssertionResult[];
  mechanicResults: readonly MechanicResult[];
  previousReport: CausalVerification | null;
  instanceId: string;
  advanceId: string;
  issues: readonly PromptValidationIssue[];
  contextMode?: TruthContextMode;
  contextState?: SimulationState;
  contextActions?: readonly AgentActionProposal[];
  contextGroundings?: readonly InteractionDependency[];
  resolutionScope?: ResolutionScope;
  mechanicContracts?: readonly MechanicPromptContract[];
  repairTarget?: {
    kind: "mechanic" | "plan" | "operation" | "event" | "outcome" | "observation";
    id: string;
    issueClass: string;
  } | null;
}): unknown {
  const contextMode = input.contextMode ?? "scoped";
  const contextState = input.contextState ?? input.state;
  const contextActions = input.contextActions ?? input.actions;
  const contextGroundings = input.contextGroundings ?? input.groundings;
  const referenceResolver = createTruthReferenceResolver({
    state: input.state,
    definition: input.definition,
    actions: contextActions,
  });
  const taskReferenceResolver = createReferenceResolver([
      ...input.resolutionPlans.map((plan) => ({
        kind: "plan" as const,
        engineId: plan.id,
        label: plan.goal,
        meaning: "a committed resolution plan being verified",
        allowedUses: ["target", "assertion", "cause", "source"] as const,
        visibility: "role" as const,
      })),
      ...resolutionPlanReferenceCandidates(input.resolutionPlans),
      ...input.proposal.events.map((event) => ({
        kind: "event" as const,
        engineId: event.id,
        label: event.description,
        meaning: "an event produced by the candidate transition",
        allowedUses: ["cause", "assertion", "source"] as const,
        visibility: "role" as const,
      })),
      ...input.checkRequests.map((check) => ({
        kind: "check" as const,
        engineId: check.id,
        label: check.stakes,
        meaning: "a committed check result in this candidate",
        allowedUses: ["cause", "assertion", "source"] as const,
        visibility: "role" as const,
      })),
      ...input.randomRequests.map((request) => ({
        kind: "random" as const,
        engineId: request.id,
        label: request.distributionId,
        meaning: "a committed random result in this candidate",
        allowedUses: ["cause", "assertion", "source"] as const,
        visibility: "role" as const,
      })),
      ...input.randomRequests.flatMap((request) => request.distribution.steps.map((step) => ({
        kind: "random" as const,
        engineId: step.id,
        label: `${request.distributionId}/${step.id}`,
        meaning: "a step inside a committed random distribution in this candidate",
        allowedUses: ["assertion", "source"] as const,
        visibility: "role" as const,
      }))),
      ...input.proposal.operations.map((operation, index) => ({
        kind: "operation" as const,
        engineId: `${index}:${operation.kind}`,
        label: operation.kind,
        meaning: "a deterministic world operation proposed by the candidate transition",
        allowedUses: ["assertion", "cause", "source"] as const,
        visibility: "role" as const,
      })),
      ...input.proposal.operations.flatMap((operation): ReferenceCandidateInput[] => {
        if (operation.kind === "create_entity") return [{ kind: "entity" as const, engineId: operation.entity.id, label: operation.entity.name, meaning: "an entity created by the candidate transition", allowedUses: ["target", "subject", "assertion", "cause", "source"] as const, visibility: "role" as const }];
        if (operation.kind === "set_fact") return [{ kind: "fact" as const, engineId: operation.fact.id, label: operation.fact.predicate, meaning: "a fact created by the candidate transition", allowedUses: ["assertion", "cause", "source"] as const, visibility: "role" as const }];
        if (operation.kind === "create_agent") return [
          { kind: "agent" as const, engineId: operation.agent.id, label: operation.agent.id, meaning: "an Agent created by the candidate transition", allowedUses: ["actor", "target", "audience", "cause"] as const, visibility: "role" as const },
          { kind: "entity" as const, engineId: operation.agent.entityId, label: operation.agent.entityId, meaning: "the entity bound to an Agent created by the candidate transition", allowedUses: ["actor", "target", "subject", "assertion", "cause", "source"] as const, visibility: "role" as const },
        ];
        return [];
      }),
      ...input.proposal.mechanicInvocations.map((invocation) => ({
        kind: "mechanic" as const,
        engineId: invocation.id,
        label: `${invocation.packageId}/${invocation.ruleId}`,
        meaning: "a mechanic invocation proposed by the candidate transition",
        allowedUses: ["assertion", "cause", "source"] as const,
        visibility: "role" as const,
        statePath: `candidate.mechanicInvocations.${invocation.id}`,
      })),
      ...input.proposal.outcomes.map((outcome) => ({
        kind: "outcome" as const,
        engineId: outcome.id,
        label: outcome.summary,
        meaning: "an action outcome proposed by the candidate transition",
        allowedUses: ["assertion", "cause"] as const,
        visibility: "role" as const,
        statePath: `candidate.outcomes.${outcome.id}`,
      })),
      ...input.proposal.observations.map((observation) => ({
        kind: "observation" as const,
        engineId: observation.id,
        label: observation.summary,
        meaning: "an observation rendered from the candidate transition",
        allowedUses: ["assertion", "cause"] as const,
        visibility: "role" as const,
        statePath: `candidate.observations.${observation.id}`,
      })),
    ]);
  const visibleTruth = contextMode === "full"
    ? contextState.truth
    : scopedCanonicalTruth(input.state, input.actions, input.groundings);
  const modelRefs: ModelReferenceResolvers = { existing: referenceResolver, task: taskReferenceResolver };
  return {
    contractVersion: MODEL_CONTEXT_CONTRACT_VERSION,
    promptVersion: promptBundle("causal-verifier").version,
    roleContract: modelRoleContract("causal-verifier"),
    referenceCatalog: referenceResolver.catalog,
    taskReferenceCatalog: taskReferenceResolver.catalog,
    execution: {
      worldId: input.definition.id,
      instanceId: input.instanceId,
      advanceId: input.advanceId,
    },
    world: {
      id: input.definition.id,
      laws: input.definition.laws,
      rulePackages: input.definition.rulePackages,
      randomDistributions: input.definition.randomDistributions,
      mechanicContracts: input.mechanicContracts ? structuredClone(input.mechanicContracts) : [],
    },
    baseRevision: input.state.revision,
    canonicalTruth: projectCanonicalTruthForModel(visibleTruth, referenceResolver),
    semanticHistory: projectModelHistory(contextState, modelRefs),
    actions: contextActions.map((action) => projectModelAction(action, referenceResolver)),
    groundings: projectModelGroundings(contextGroundings, referenceResolver),
    committedCheckRequests: input.checkRequests.map((request) => projectModelCheckRequest(request, modelRefs)),
    checkResults: input.checkResults.map((result) => projectModelCheckResult(result, modelRefs)),
    committedRandomRequests: input.randomRequests.map((request) => projectModelRandomRequest(request, modelRefs)),
    randomResults: input.randomResults.map((result) => projectModelRandomResult(result, modelRefs)),
    commitmentRounds: input.commitmentRounds.map((round) => projectModelCommitmentRound(round, modelRefs)),
    committedResolutionPlans: input.resolutionPlans.map((plan) => projectModelResolutionPlan(plan, modelRefs)),
    resolutionReceipts: input.resolutionReceipts.map((receipt) => ({
      planRef: modelHandle(modelRefs, "plan", receipt.plan.id),
      settled: receipt.settled,
      checkRef: maybeModelHandle(modelRefs, "check", receipt.checkRequestId),
      outcome: receipt.outcome,
      effectCount: receipt.effects.length,
      operationCount: receipt.operations.length,
    })),
    candidate: projectModelTransitionProposal(input.proposal, modelRefs),
    mechanicResults: input.mechanicResults.map((result) => ({
      invocationRef: modelHandle(modelRefs, "mechanic", result.invocationId),
      packageId: result.packageId,
      ruleId: result.ruleId,
      code: result.code,
      operationCount: result.operations.length,
    })),
    deterministicAssertionResults: input.assertionResults.map((result) => projectModelAssertionResult(result, modelRefs)),
    previousReport: input.previousReport === null ? null : {
      verdict: input.previousReport.verdict,
      findings: input.previousReport.verdict === "reject"
        ? input.previousReport.findings.map((finding) => ({
            target: {
              kind: finding.target.kind,
              ref: modelHandle(modelRefs, finding.target.kind, finding.target.id),
            },
            code: finding.code,
            message: finding.message,
            repairHint: finding.repairHint,
          }))
        : [],
    },
    validationIssues: input.issues,
    resolutionScope: input.resolutionScope ?? null,
    repairTarget: input.repairTarget ? structuredClone(input.repairTarget) : null,
  };
}

export function buildResolutionPlanVerificationContext(input: {
  definition: WorldDefinition;
  state: SimulationState;
  actions: readonly AgentActionProposal[];
  groundings: readonly InteractionDependency[];
  plans: readonly ResolutionPlan[];
  commitmentRounds: readonly CommitmentRound[];
  instanceId: string;
  advanceId: string;
  issues: readonly PromptValidationIssue[];
  contextMode?: TruthContextMode;
  contextState?: SimulationState;
  contextActions?: readonly AgentActionProposal[];
  contextGroundings?: readonly InteractionDependency[];
  resolutionScope?: ResolutionScope;
}): unknown {
  const contextMode = input.contextMode ?? "scoped";
  const contextState = input.contextState ?? input.state;
  const contextActions = input.contextActions ?? input.actions;
  const contextGroundings = input.contextGroundings ?? input.groundings;
  const referenceResolver = createTruthReferenceResolver({
    state: input.state,
    definition: input.definition,
    actions: contextActions,
  });
  const taskReferenceResolver = createReferenceResolver([
    ...input.plans.map((plan) => ({
      kind: "plan" as const,
      engineId: plan.id,
      label: plan.goal,
      meaning: "a committed resolution plan under review",
      allowedUses: ["target", "assertion", "cause"] as const,
      visibility: "role" as const,
      statePath: `candidatePlans.${plan.id}`,
    })),
    ...resolutionPlanReferenceCandidates(input.plans),
  ]);
  const visibleTruth = contextMode === "full"
    ? contextState.truth
    : scopedCanonicalTruth(input.state, input.actions, input.groundings);
  const modelRefs: ModelReferenceResolvers = { existing: referenceResolver, task: taskReferenceResolver };
  const { mechanics, ...canonicalTruth } = projectCanonicalTruthForModel(visibleTruth, referenceResolver);
  return {
    contractVersion: MODEL_CONTEXT_CONTRACT_VERSION,
    promptVersion: promptBundle("resolution-plan-verifier").version,
    roleContract: modelRoleContract("resolution-plan-verifier"),
    referenceCatalog: referenceResolver.catalog,
    taskReferenceCatalog: taskReferenceResolver.catalog,
    execution: {
      worldId: input.definition.id,
      instanceId: input.instanceId,
      advanceId: input.advanceId,
    },
    world: {
      id: input.definition.id,
      laws: input.definition.laws,
      rulePackages: input.definition.rulePackages,
      mechanics,
    },
    baseRevision: input.state.revision,
    canonicalTruth,
    semanticHistory: projectModelHistory(contextState, modelRefs),
    actions: contextActions.map((action) => projectModelAction(action, referenceResolver)),
    groundings: projectModelGroundings(contextGroundings, referenceResolver),
    candidatePlans: input.plans.map((plan) => projectModelResolutionPlan(plan, modelRefs)),
    priorCommitmentRounds: input.commitmentRounds.map((round) => projectModelCommitmentRound(round, modelRefs)),
    validationIssues: input.issues,
    resolutionScope: input.resolutionScope ?? null,
  };
}

interface AgentContextInput {
  state: SimulationState;
  agent: AgentState;
  observations: readonly ObservationPacket[];
  events: readonly WorldEvent[];
  currentAction: AgentActionProposal | null;
  currentOutcome: Pick<ActionOutcome, "status"> | null;
  instanceId: string;
  advanceId: string;
  issues: readonly PromptValidationIssue[];
}

export function buildAgentSharedContext(input: Pick<AgentContextInput, "state" | "instanceId" | "advanceId"> & {
  promptId?: "agent-bootstrap" | "agent-mind";
}) {
  return {
    contractVersion: MODEL_CONTEXT_CONTRACT_VERSION,
    roleContract: modelRoleContract(input.promptId ?? "agent-mind"),
    execution: {
      worldId: input.state.worldId,
      instanceId: input.instanceId,
      advanceId: input.advanceId,
      revision: input.state.revision,
      step: input.state.step,
    },
  };
}

export function buildAgentSlotContext(input: Omit<AgentContextInput, "instanceId" | "advanceId">) {
  const currentEvents = new Map(input.events
    .filter((event) => event.step === input.state.step)
    .map((event) => [event.id, event]));
  const resolver = createAgentReferenceResolver(input.agent, input.observations);
  return {
    referenceCatalog: resolver.catalog,
    task: {
      assignment: {
        targetHandles: [],
        availableHandles: resolver.catalog.candidates.map((candidate) => candidate.handle),
        allowedProposalKinds: ["local_entity", "claim", "evidence"],
      },
      constraints: input.issues.map((issue) => issue.message),
    },
    state: {
      perspective: projectAgentPerspective(input.state, input.agent),
      currentResolution: {
        ownAction: input.currentAction,
        perceivedOutcome: input.currentOutcome,
      },
      observations: input.observations.map(visibleObservation),
      characterUpdatePolicy: {
        rule: "每个 character change 的 source observation 必须来自 eligible=true 的 Observation；没有 eligible source 时不得修改 character。",
        sources: input.observations.map((observation) => {
          const eventBasis = observation.sourceEventIds.flatMap((eventId) => {
            const event = currentEvents.get(eventId);
            return event ? [{ eventId, impact: event.impact }] : [];
          });
          return {
            observationId: observation.id,
            eligible: observation.observerId === input.agent.id && observation.step === input.state.step &&
              eventBasis.length > 0,
            eventBasis,
          };
        }),
      },
    },
    repair: input.issues.length > 0 ? { target: input.agent.id, issues: input.issues.map((issue) => ({
      code: issue.code,
      class: "semantic" as const,
      path: issue.path,
      originalValue: null,
      allowedHandles: [],
      reason: issue.message,
    })) } : null,
  };
}

export function buildAgentContext(input: AgentContextInput): unknown {
  return {
    ...buildAgentSharedContext(input),
    ...buildAgentSlotContext(input),
  };
}

export function buildReactionContext(input: {
  state: SimulationState;
  agent: AgentState;
  originalAction: AgentActionProposal;
  stimulus: ObservationPacket;
  instanceId: string;
  advanceId: string;
  issues: readonly PromptValidationIssue[];
}): unknown {
  const resolver = createAgentReferenceResolver(input.agent, [input.stimulus]);
  return {
    contractVersion: MODEL_CONTEXT_CONTRACT_VERSION,
    roleContract: modelRoleContract("agent-reaction"),
    execution: {
      worldId: input.state.worldId,
      instanceId: input.instanceId,
      advanceId: input.advanceId,
      revision: input.state.revision,
      step: input.state.step + 1,
    },
    task: {
      assignment: {
        targetHandles: [],
        availableHandles: resolver.catalog.candidates.map((candidate) => candidate.handle),
        allowedProposalKinds: [],
      },
      constraints: input.issues.map((issue) => issue.message),
    },
    state: {
      perspective: projectAgentPerspective(input.state, input.agent),
      preparedAction: input.originalAction,
      stimulus: visibleObservation(input.stimulus),
    },
    referenceCatalog: resolver.catalog,
    repair: input.issues.length > 0 ? { target: input.agent.id, issues: input.issues.map((issue) => ({
      code: issue.code,
      class: "semantic" as const,
      path: issue.path,
      originalValue: null,
      allowedHandles: [],
      reason: issue.message,
    })) } : null,
  };
}

export function sanitizeObservationForAgent(packet: ObservationPacket): ObservationPacket {
  return visibleObservation(packet);
}
