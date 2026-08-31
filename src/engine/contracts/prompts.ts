import { z } from "zod";
import { CharacterPatchValidationError } from "../cognition/character";
import type {
  ActionOutcome,
  AgentActionProposal,
  AgentState,
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
  WorldEvent,
} from "./model";
import type { ResolutionPlan, ResolutionReceipt } from "../mechanics/resolution";
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

function semanticHistory(state: SimulationState): unknown[] {
  return state.history.map((step) => ({
    revision: step.revision,
    step: step.step,
    actions: step.actions,
    initialActions: step.initialActions,
    reactionRequests: step.reactionRequests,
    reactionDecisions: step.reactionDecisions,
    checkRequests: step.checkRequests,
    checks: step.checks,
    randomRequests: step.randomRequests,
    randomResults: step.randomResults,
    commitmentRounds: step.commitmentRounds,
    resolutionPlans: step.resolutionPlans,
    resolutionReceipts: step.resolutionReceipts,
    outcomes: step.outcomes,
    events: step.events,
    observations: step.observations,
    operations: step.operations,
    characterPatches: step.characterPatches,
  }));
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
  checkRequests?: readonly D20CheckRequest[];
  contextState?: Readonly<SimulationState>;
  contextActions?: readonly AgentActionProposal[];
  extraCandidates?: readonly ReferenceCandidateInput[];
}): ReferenceResolver {
  const state = input.contextState ?? input.state;
  const actions = input.contextActions ?? input.actions;
  const events = input.events ?? [];
  const checkRequests = input.checkRequests ?? [];
  return createReferenceResolver([
    ...Object.values(state.agents).map((agent) => ({
      kind: "agent" as const, engineId: agent.id, label: agent.id,
      meaning: "an Agent participating in this execution", allowedUses: ["actor", "target", "audience", "cause"] as const,
      visibility: "role" as const, statePath: `state.agents.${agent.id}`,
    })),
    ...Object.values(state.truth.entities).map((entity) => ({
      kind: "entity" as const, engineId: entity.id, label: entity.name,
      meaning: "an existing canonical world entity", allowedUses: ["actor", "target", "subject", "cause", "assertion", "source"] as const,
      visibility: "role" as const, statePath: `state.truth.entities.${entity.id}`,
    })),
    ...[...new Set(Object.values(state.truth.placements).filter((placement): placement is string => placement !== null))].map((placementId) => ({
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
    ...actions.map((action) => ({
      kind: "action" as const, engineId: action.id, label: action.rawText,
      meaning: "an action being adjudicated in this step", allowedUses: ["cause", "assertion", "source"] as const,
      visibility: "role" as const, statePath: `task.actions.${action.id}`,
    })),
    ...checkRequests.map((check) => ({
      kind: "check" as const, engineId: check.id, label: check.stakes,
      meaning: "a committed check result available to the current stage", allowedUses: ["cause", "assertion", "source"] as const,
      visibility: "role" as const, statePath: `execution.checks.${check.id}`,
    })),
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
    state: input.state,
    definition: input.definition,
    actions: input.actions,
    contextState,
    contextActions,
  });
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
      jointActions: "untrusted-action-attempts",
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
    canonicalTruth: contextMode === "full"
      ? structuredClone(contextState.truth)
      : scopedCanonicalTruth(input.state, input.actions, input.groundings),
    semanticHistory: semanticHistory(input.state),
    actors: scopedActors(
      contextMode === "full" ? contextState : input.state,
      contextMode === "full" ? contextActions : input.actions,
      contextMode === "full" ? contextGroundings : input.groundings,
    ),
    initialActions: input.initialActions,
    jointActions: input.outputActions ?? input.actions,
    allInitialActions: contextInitialActions,
    allJointActions: contextActions,
    groundings: input.outputGroundings ?? input.groundings,
    allGroundings: contextGroundings,
    temporalBoundary: input.temporalBoundary,
    reactionRequests: input.reactionRequests,
    reactionDecisions: input.reactionDecisions,
    reactionWindow: input.reactionWindow,
    committedCheckRequests: input.committedCheckRequests,
    checkResults: input.checkResults,
    committedRandomRequests: input.committedRandomRequests,
    randomResults: input.randomResults,
    commitmentRounds: input.commitmentRounds,
    committedResolutionPlans: input.resolutionPlans,
    resolutionReceipts: input.resolutionReceipts,
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
    events: input.proposal.events,
    checkRequests: input.checkRequests,
    extraCandidates: [
      ...input.proposal.operations.map((operation, index) => ({
        kind: "operation" as const,
        engineId: `${index}:${operation.kind}`,
        label: operation.kind,
        meaning: "an operation proposed by the candidate transition",
        allowedUses: ["assertion", "cause"] as const,
        visibility: "role" as const,
        statePath: `candidate.operations.${index}`,
      })),
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
    ],
  });
  return {
    contractVersion: MODEL_CONTEXT_CONTRACT_VERSION,
    promptVersion: promptBundle("causal-verifier").version,
    roleContract: modelRoleContract("causal-verifier"),
    referenceCatalog: referenceResolver.catalog,
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
    canonicalTruth: contextMode === "full"
      ? structuredClone(contextState.truth)
      : scopedCanonicalTruth(input.state, input.actions, input.groundings),
    semanticHistory: semanticHistory(contextState),
    actions: contextActions,
    groundings: contextGroundings,
    committedCheckRequests: input.checkRequests,
    checkResults: input.checkResults,
    committedRandomRequests: input.randomRequests,
    randomResults: input.randomResults,
    commitmentRounds: input.commitmentRounds,
    committedResolutionPlans: input.resolutionPlans,
    resolutionReceipts: input.resolutionReceipts,
    candidate: input.proposal,
    mechanicResults: input.mechanicResults,
    deterministicAssertionResults: input.assertionResults,
    previousReport: input.previousReport,
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
    extraCandidates: input.plans.map((plan) => ({
      kind: "plan" as const,
      engineId: plan.id,
      label: plan.goal,
      meaning: "a committed resolution plan under review",
      allowedUses: ["target", "assertion", "cause"] as const,
      visibility: "role" as const,
      statePath: `candidatePlans.${plan.id}`,
    })),
  });
  const { mechanics, ...canonicalTruth } = contextMode === "full"
    ? structuredClone(contextState.truth)
    : scopedCanonicalTruth(input.state, input.actions, input.groundings);
  return {
    contractVersion: MODEL_CONTEXT_CONTRACT_VERSION,
    promptVersion: promptBundle("resolution-plan-verifier").version,
    roleContract: modelRoleContract("resolution-plan-verifier"),
    referenceCatalog: referenceResolver.catalog,
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
    semanticHistory: semanticHistory(contextState),
    actions: contextActions,
    groundings: contextGroundings,
    candidatePlans: input.plans,
    priorCommitmentRounds: input.commitmentRounds,
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
