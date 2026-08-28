import type {
  InteractionDependency,
  BootstrapCandidate,
  ExecutionRef,
  PolicyBinding,
  WorldStepCandidate,
} from "./execution";
import {
  ActivityFootprintIndex,
  interactionDependencyComponents,
} from "./action-dependency";
import {
  resolutionObservations,
  WORLD_STEP_CANDIDATE_SCHEMA_VERSION,
} from "./execution";
import { validatePublicInformationBoundary } from "./information-boundary";
import { createHistoryReplayBase } from "./history-replay";
import { applyMindCommit } from "./mind-commit";
import type {
  AgentAdmissionCommit,
  AgentActionProposal,
  AgentState,
  CommittedStep,
  ObservationPacket,
  MeterState,
  QuantityState,
  RatingState,
  SimulationState,
  TransitionProposal,
  WorldEntity,
} from "./model";
import { contentHash } from "./model-audit";
import { runtimeId } from "./runtime-id";
import {
  applyObservationBindings,
  pendingObservationsFor,
  validateObservations,
} from "./observation";
import {
  advanceTemporalState,
  cancelActivity,
  createActivity,
  reconcileTemporalOutcomes,
  selectTemporalBoundary,
  settleActivityContexts,
  validateActivityResources,
  validateTemporalPlan,
} from "./temporal";
import { applyAdmissionCommit, applyTransitionProposal, validateSimulationState } from "./transaction";

export function semanticStepHash(step: Readonly<CommittedStep>): string {
  const semantic = structuredClone(step) as Partial<CommittedStep>;
  delete semantic.contentHash;
  delete semantic.semanticHash;
  delete semantic.executionRef;
  return contentHash(semantic);
}

export function attachExecutionRef(
  state: Readonly<SimulationState>,
  reference: Readonly<ExecutionRef>,
  phase: "bootstrap" | "step" | "admission",
): SimulationState {
  const finalized = structuredClone(state) as SimulationState;
  if (phase === "bootstrap") {
    if (finalized.history.length !== 0) throw new Error("bootstrap execution reference cannot attach after a step");
    finalized.bootstrapExecutionRef = structuredClone(reference);
  } else if (phase === "step") {
    const committed = finalized.history.at(-1);
    if (!committed) throw new Error("step execution reference requires a committed step");
    committed.executionRef = structuredClone(reference);
    const payload = { ...committed } as Partial<CommittedStep>;
    delete payload.contentHash;
    committed.contentHash = contentHash(payload);
  } else {
    const admission = finalized.admissions.at(-1);
    if (!admission) throw new Error("admission execution reference requires an admission commit");
    admission.executionRef = structuredClone(reference);
    const payload = { ...admission } as Partial<AgentAdmissionCommit>;
    delete payload.contentHash;
    admission.contentHash = contentHash(payload);
  }
  validateSimulationState(finalized, false, true);
  return finalized;
}

function observationsFor(packets: readonly ObservationPacket[], observerId: string): ObservationPacket[] {
  return packets.filter((packet) => packet.observerId === observerId);
}

function validateUniqueAgentIds(
  ids: readonly string[],
  label: string,
  knownAgentIds: ReadonlySet<string>,
): void {
  if (new Set(ids).size !== ids.length) throw new Error(`${label} contains duplicate Agent ids`);
  for (const agentId of ids) {
    if (!knownAgentIds.has(agentId)) throw new Error(`${label} references unknown Agent ${agentId}`);
  }
}

function validateInteractionDependencies(
  source: Readonly<SimulationState>,
  actions: readonly AgentActionProposal[],
  dependencies: readonly InteractionDependency[],
  activities: Readonly<Record<string, import("./temporal").ActivityState>>,
): void {
  const actionById = new Map(actions.map((action) => [action.id, action]));
  if (actionById.size !== actions.length) throw new Error("execution candidate contains duplicate action ids");
  if (new Set(dependencies.map((dependency) => `${dependency.kind}:${dependency.id}`)).size !== dependencies.length) {
    throw new Error("execution candidate contains duplicate interaction dependencies");
  }
  const expectedIds = [...actionById.keys()].sort();
  const actualIds = dependencies.filter((dependency) => dependency.kind === "action")
    .map((dependency) => dependency.id).sort();
  if (contentHash(expectedIds) !== contentHash(actualIds)) {
    throw new Error(
      `execution candidate interaction dependencies must cover every final action exactly once; expected=${expectedIds.join(",")}; actual=${actualIds.join(",")}`,
    );
  }
  const catalogs: Record<Exclude<InteractionDependency["reads"][number]["kind"], "global">, Readonly<Record<string, unknown>>> = {
    entity: source.truth.entities,
    fact: source.truth.facts,
    placement: source.truth.entities,
    meter: source.truth.meters,
    quantity: source.truth.quantities,
    rating: source.truth.ratings,
    condition: source.truth.conditions,
  };
  for (const dependency of dependencies) {
    const expectedActorId = dependency.kind === "action"
      ? actionById.get(dependency.id)?.actorId
      : dependency.kind === "activity"
        ? activities[dependency.id]?.actorId
        : null;
    if (expectedActorId === undefined || dependency.actorId !== expectedActorId) {
      throw new Error(`interaction dependency actor mismatch for ${dependency.kind}:${dependency.id}`);
    }
    if ((dependency.kind === "timer" && !source.truth.timers[dependency.id]) ||
      (dependency.kind === "condition" && !source.truth.conditions[dependency.id])) {
      throw new Error(`interaction dependency references unknown ${dependency.kind} ${dependency.id}`);
    }
    for (const [label, refs] of [["reads", dependency.reads], ["writes", dependency.writes]] as const) {
      const keys = refs.map((ref) => `${ref.kind}:${ref.id}`);
      if (new Set(keys).size !== keys.length) {
        throw new Error(`interaction dependency ${dependency.id} contains duplicate ${label}`);
      }
      for (const ref of refs) {
        if (ref.kind !== "global" && !catalogs[ref.kind][ref.id]) {
          throw new Error(`interaction dependency ${dependency.id} references unknown ${ref.kind} ${ref.id}`);
        }
      }
    }
    if (new Set(dependency.audienceAgentIds).size !== dependency.audienceAgentIds.length) {
      throw new Error(`interaction dependency ${dependency.id} contains duplicate audiences`);
    }
    for (const agentId of dependency.audienceAgentIds) {
      if (!source.agents[agentId]) {
        throw new Error(`interaction dependency ${dependency.id} references unknown audience Agent ${agentId}`);
      }
    }
    if (dependency.actorId !== null && !dependency.audienceAgentIds.includes(dependency.actorId)) {
      throw new Error(`interaction dependency ${dependency.id} must include its actor in the audience`);
    }
    const hasGlobal = [...dependency.reads, ...dependency.writes].some((ref) => ref.kind === "global");
    if (dependency.globalFallback !== hasGlobal) {
      throw new Error(`interaction dependency ${dependency.id} has inconsistent global fallback evidence`);
    }
  }
}

function validateStepDiagnostics(
  source: Readonly<SimulationState>,
  transitioned: Readonly<SimulationState>,
  actions: readonly AgentActionProposal[],
  candidate: Readonly<WorldStepCandidate>,
  policyRoster: Readonly<Record<string, PolicyBinding>>,
): void {
  const diagnostics = candidate.diagnostics;
  const knownAgentIds = new Set(Object.keys(transitioned.agents));
  validateUniqueAgentIds(diagnostics.activatedAgentIds, "activated Agent diagnostics", knownAgentIds);
  validateUniqueAgentIds(diagnostics.reusedAgentIds, "reused Agent diagnostics", knownAgentIds);
  validateUniqueAgentIds(diagnostics.mindFallbackAgentIds, "mind fallback diagnostics", knownAgentIds);
  if (diagnostics.activatedAgentIds.some((agentId) => diagnostics.reusedAgentIds.includes(agentId))) {
    throw new Error("activated and reused Agent diagnostics must be disjoint");
  }
  if (diagnostics.mindFallbackAgentIds.some((agentId) => !diagnostics.activatedAgentIds.includes(agentId))) {
    throw new Error("mind fallback diagnostics must reference activated Agents");
  }
  const updatedIds = [...diagnostics.activatedAgentIds, ...diagnostics.reusedAgentIds].sort();
  const committedIds = candidate.mindCommits.map((commit) => commit.agentId).sort();
  if (contentHash(updatedIds) !== contentHash(committedIds)) {
    throw new Error("algorithm diagnostics do not match AgentMind commits");
  }
  for (const agentId of diagnostics.activatedAgentIds) {
    if (source.agents[agentId] && policyRoster[agentId]?.kind !== "model") {
      throw new Error(`algorithm activated non-model Agent ${agentId}`);
    }
  }
  if (typeof diagnostics.globalReadjudication !== "boolean") {
    throw new Error("global readjudication diagnostic must be boolean");
  }
  const componentInteractionIds = diagnostics.dependencyComponents.flatMap((component) => {
    if (component.length === 0) throw new Error("dependency diagnostics contain an empty component");
    return component;
  });
  const expectedInteractionIds = candidate.interactionDependencies.map((dependency) => dependency.id).sort();
  if (new Set(componentInteractionIds).size !== componentInteractionIds.length ||
    contentHash([...componentInteractionIds].sort()) !== contentHash(expectedInteractionIds)) {
    throw new Error("dependency diagnostics must partition final interactions");
  }
  if (contentHash(diagnostics.dependencyComponents) !==
    contentHash(interactionDependencyComponents(candidate.interactionDependencies))) {
    throw new Error("dependency diagnostics do not match the final interaction dependency graph");
  }
  if (diagnostics.globalReadjudication && actions.length > 0 && diagnostics.dependencyComponents.length !== 1) {
    throw new Error("global readjudication diagnostics require one dependency component");
  }
}

function isWithinSelf(state: Readonly<SimulationState>, entityId: string, selfEntityId: string): boolean {
  let current = entityId;
  const seen = new Set<string>([entityId]);
  while (true) {
    const placementId = state.truth.placements[current];
    if (!placementId || seen.has(placementId)) return false;
    if (placementId === selfEntityId) return true;
    seen.add(placementId);
    current = placementId;
  }
}

export function validateSelfConsequenceIntroductions(
  source: Readonly<SimulationState>,
  transitioned: Readonly<SimulationState>,
  actions: readonly AgentActionProposal[],
  proposal: Readonly<TransitionProposal>,
  observations: readonly ObservationPacket[],
): void {
  const outcomes = new Map(proposal.outcomes.map((outcome) => [outcome.proposalId, outcome]));
  for (const action of actions) {
    const outcome = outcomes.get(action.id);
    if (!outcome || outcome.status !== "succeeded" && outcome.status !== "partial") continue;
    const agent = source.agents[action.actorId];
    if (!agent) continue;
    const knownCanonicalIds = new Set(Object.values(agent.bindings)
      .flatMap((binding) => binding.canonicalEntityIds));
    const introducedCanonicalIds = new Set(observations
      .filter((observation) => observation.observerId === agent.id)
      .flatMap((observation) => observation.introductions)
      .flatMap((introduction) => introduction.canonicalEntityId ? [introduction.canonicalEntityId] : []));
    const required = new Set<string>();
    for (const operation of proposal.operations) {
      if (!operation.causes.some((cause) => cause.kind === "action" && cause.id === action.id)) continue;
      if (operation.kind === "create_entity" || operation.kind === "place_entity") {
        const entityId = operation.kind === "create_entity" ? operation.entity.id : operation.entityId;
        if (isWithinSelf(transitioned, entityId, agent.entityId)) required.add(entityId);
      }
      if (operation.kind === "set_fact" &&
        (operation.fact.access.kind === "public" ||
          operation.fact.access.kind === "agents" && operation.fact.access.agentIds.includes(agent.id))) {
        if (operation.fact.subjectId === agent.entityId && operation.fact.value.kind === "entity") {
          required.add(operation.fact.value.entityId);
        }
        if (operation.fact.value.kind === "entity" && operation.fact.value.entityId === agent.entityId) {
          required.add(operation.fact.subjectId);
        }
      }
    }
    for (const entityId of required) {
      if (entityId === agent.entityId || knownCanonicalIds.has(entityId) || introducedCanonicalIds.has(entityId)) continue;
      throw new Error(
        `successful self consequence for ${agent.id} references ${entityId} without an observer-local introduction`,
      );
    }
  }
}

function validateCandidateBoundary(
  source: SimulationState,
  actions: readonly AgentActionProposal[],
  candidate: WorldStepCandidate,
  transitioned: SimulationState,
  maxAutonomousSpanSeconds: number,
  observations: readonly ObservationPacket[],
): void {
  if (candidate.schemaVersion !== WORLD_STEP_CANDIDATE_SCHEMA_VERSION) {
    throw new Error(`world step candidate schema v${WORLD_STEP_CANDIDATE_SCHEMA_VERSION} required`);
  }
  if (candidate.sourceStateHash !== contentHash(source)) throw new Error("execution candidate uses another source state");
  if (new Set(actions.map((action) => action.actorId)).size !== actions.length) {
    throw new Error("execution candidate contains multiple actions for one Agent");
  }
  validateInteractionDependencies(source, actions, candidate.interactionDependencies, candidate.temporalState.activities);
  const advances = candidate.resolution.proposal.operations.filter((operation) => operation.kind === "advance_time");
  if (advances.length !== 1) throw new Error("every world step must contain exactly one time advance");
  validatePublicInformationBoundary(source, actions, candidate.resolution.proposal);
  validateObservations(transitioned, observations, transitioned.step);
  validateSelfConsequenceIntroductions(
    source,
    transitioned,
    actions,
    candidate.resolution.proposal,
    observations,
  );
  const outcomeObservers = new Set(candidate.resolution.proposal.observations
    .filter((packet) => packet.kind === "outcome")
    .map((packet) => packet.observerId));
  for (const agentId of new Set(actions.map((action) => action.actorId))) {
    if (!outcomeObservers.has(agentId)) throw new Error(`transition must provide an outcome observation for agent ${agentId}`);
  }
  const advance = advances[0]!;
  if (advance.seconds !== candidate.temporalBoundary.deltaSeconds ||
    candidate.temporalBoundary.fromElapsedSeconds !== source.truth.elapsedSeconds ||
    candidate.temporalBoundary.toElapsedSeconds !== transitioned.truth.elapsedSeconds) {
    throw new Error("candidate time advance does not match its temporal boundary");
  }
  if (contentHash(candidate.temporalState.activities) !== contentHash(transitioned.truth.activities) ||
    contentHash(candidate.temporalState.timers) !== contentHash(transitioned.truth.timers)) {
    throw new Error("candidate temporal state was not applied atomically");
  }
  const planIds = candidate.temporalPlans.map((plan) => plan.id);
  if (new Set(planIds).size !== planIds.length) throw new Error("candidate contains duplicate temporal plans");
  const planningActivities = structuredClone(source.truth.activities);
  const cancellationTransitions = [] as typeof candidate.activityTransitions;
  for (const transition of candidate.activityTransitions) {
    if (transition.fromElapsedSeconds !== source.truth.elapsedSeconds ||
      transition.toElapsedSeconds !== source.truth.elapsedSeconds) continue;
    if (transition.kind !== "cancelled") {
      throw new Error(`candidate has unsupported zero-time activity transition ${transition.kind}`);
    }
    const existing = planningActivities[transition.activityId];
    if (!existing || existing.actorId !== transition.actorId) {
      throw new Error(`candidate cancels unknown activity ${transition.activityId}`);
    }
    const cancelled = cancelActivity(existing, source.truth.elapsedSeconds);
    if (contentHash(cancelled.transition) !== contentHash(transition)) {
      throw new Error(`candidate cancellation does not match activity ${transition.activityId}`);
    }
    planningActivities[transition.activityId] = cancelled.activity;
    cancellationTransitions.push(structuredClone(cancelled.transition));
  }
  for (const plan of candidate.temporalPlans) {
    validateTemporalPlan(
      plan,
      source.truth.mechanics.temporalProfiles,
      source.truth.mechanics.activityResources,
    );
    if (plan.startsAtSeconds !== source.truth.elapsedSeconds) {
      throw new Error(`candidate temporal plan ${plan.id} does not start at the current clock`);
    }
    const persisted = Object.values(candidate.temporalState.activities)
      .filter((activity) => activity.plan.id === plan.id);
    if (persisted.length !== 1 || contentHash(persisted[0]!.plan) !== contentHash(plan)) {
      throw new Error(`candidate temporal plan ${plan.id} has no unique matching activity`);
    }
    const finalActivity = persisted[0]!;
    if (planningActivities[finalActivity.id]) {
      throw new Error(`candidate temporal plan reuses activity ${finalActivity.id}`);
    }
    planningActivities[finalActivity.id] = createActivity({
      id: finalActivity.id,
      plan,
      sourceAction: finalActivity.sourceAction,
      participantAgentIds: finalActivity.participantAgentIds,
      interactionFootprint: finalActivity.interactionFootprint,
    });
  }
  for (const transition of cancellationTransitions) {
    if (!candidate.temporalPlans.some((plan) => plan.actorId === transition.actorId)) {
      throw new Error(`candidate cancels activity ${transition.activityId} without a replacement plan`);
    }
  }
  validateActivityResources(planningActivities, source.truth.mechanics.activityResources);
  const conditionExpiries = Object.fromEntries(Object.values(source.truth.conditions)
    .filter((condition) => condition.expiresAtElapsedSeconds !== null)
    .map((condition) => [condition.id, condition.expiresAtElapsedSeconds!]));
  const expectedBoundary = selectTemporalBoundary({
    elapsedSeconds: source.truth.elapsedSeconds,
    maxAutonomousSpanSeconds,
    activities: planningActivities,
    timers: source.truth.timers,
    conditionExpiries,
  });
  if (contentHash(expectedBoundary) !== contentHash(candidate.temporalBoundary)) {
    throw new Error("candidate did not select the earliest trusted temporal boundary");
  }
  const dueActivityActors = new Set(expectedBoundary.dueActivityIds.map((activityId) => {
    const activity = planningActivities[activityId];
    if (!activity) throw new Error(`trusted boundary references unknown activity ${activityId}`);
    return activity.actorId;
  }));
  const timerDescriptionsByAgent = new Map<string, string[]>();
  for (const timerId of expectedBoundary.dueTimerIds) {
    const timer = source.truth.timers[timerId];
    if (!timer) throw new Error(`trusted boundary references unknown Timer ${timerId}`);
    for (const agentId of timer.wakeAgentIds) {
      const descriptions = timerDescriptionsByAgent.get(agentId) ?? [];
      descriptions.push(timer.description);
      timerDescriptionsByAgent.set(agentId, descriptions);
    }
  }
  [...timerDescriptionsByAgent.entries()]
    .filter(([agentId]) => !dueActivityActors.has(agentId))
    .forEach(([agentId, descriptions], ordinal) => {
      const expectedAction = {
        id: runtimeId({
          worldHash: source.worldHash,
          revision: source.revision,
          kind: "action",
          stage: "timer",
          owner: agentId,
          round: 0,
          ordinal,
        }),
        actorId: agentId,
        baseRevision: source.revision,
        rawText: `处理同时到期的世界定时触发：${descriptions.join("；")}`,
        goal: "根据当前世界事实联合结算已到期触发",
        means: null,
        targetIds: [],
      };
      const actual = actions.find((action) => action.actorId === agentId);
      if (!actual || contentHash(actual) !== contentHash(expectedAction)) {
        throw new Error(`candidate does not adjudicate due Timer for ${agentId}`);
      }
    });
  let expectedTemporal = advanceTemporalState({
    boundary: expectedBoundary,
    activities: planningActivities,
    timers: source.truth.timers,
  });
  expectedTemporal.transitions = [...cancellationTransitions, ...expectedTemporal.transitions];
  expectedTemporal = reconcileTemporalOutcomes(expectedTemporal, candidate.resolution.proposal.outcomes);

  const actionDependencies = candidate.interactionDependencies
    .filter((dependency) => dependency.kind === "action");
  const currentActionIds = new Set(actions.map((action) => action.id));
  const expectedAffectedActivityIds = new ActivityFootprintIndex(planningActivities)
    .affectedBy(actionDependencies)
    .filter((activityId) => !currentActionIds.has(planningActivities[activityId]!.sourceActionId));
  const actualActivityDependencies = candidate.interactionDependencies
    .filter((dependency) => dependency.kind === "activity")
    .sort((left, right) => left.id.localeCompare(right.id));
  if (contentHash(actualActivityDependencies.map((dependency) => dependency.id)) !==
    contentHash(expectedAffectedActivityIds)) {
    throw new Error("candidate Activity interaction dependencies do not match the trusted footprint index");
  }
  for (const dependency of actualActivityDependencies) {
    const expected = planningActivities[dependency.id]?.interactionFootprint;
    if (!expected || contentHash(dependency) !== contentHash(expected)) {
      throw new Error(`candidate changes the persisted footprint of Activity ${dependency.id}`);
    }
  }

  const observedAgentIds = new Set(observations.map((observation) => observation.observerId));
  const relevantExternalObservers = new Set(candidate.interactionDependencies.flatMap((dependency) =>
    dependency.audienceAgentIds.filter((agentId) =>
      agentId !== dependency.actorId && observedAgentIds.has(agentId))));
  const contextActivityIds = [...new Set([
    ...expectedAffectedActivityIds,
    ...expectedBoundary.dueActivityIds,
  ])].sort();
  const preContextState = applyTransitionProposal(source, candidate.resolution.proposal, {
    activities: expectedTemporal.activities,
    timers: expectedTemporal.timers,
  });
  const settled = settleActivityContexts({
    state: preContextState,
    temporal: expectedTemporal,
    activityIds: contextActivityIds,
    relevantObserverIds: relevantExternalObservers,
  });
  expectedTemporal = settled.temporal;
  if (contentHash(expectedTemporal.activities) !== contentHash(candidate.temporalState.activities) ||
    contentHash(expectedTemporal.timers) !== contentHash(candidate.temporalState.timers) ||
    contentHash(expectedTemporal.transitions) !== contentHash(candidate.activityTransitions) ||
    contentHash(expectedTemporal.decisionPoints) !== contentHash(candidate.decisionPoints) ||
    contentHash(settled.dispositions) !== contentHash(candidate.activityDispositions)) {
    throw new Error("candidate temporal transitions do not match the trusted boundary result");
  }
  for (const point of expectedTemporal.decisionPoints) {
    const occupying = Object.values(expectedTemporal.activities).find((activity) =>
      activity.status === "active" && activity.participantAgentIds.includes(point.agentId));
    if (occupying) {
      throw new Error(`decision point for ${point.agentId} conflicts with active Activity ${occupying.id}`);
    }
  }
}

export class CanonicalCommitter {
  admit(sourceState: Readonly<SimulationState>, candidate: Readonly<{
    entity: WorldEntity;
    placementId: string | null;
    agent: AgentState;
    meters: MeterState[];
    quantities: QuantityState[];
    ratings: RatingState[];
    conditions: import("./resolution").ConditionState[];
  }>): { committed: AgentAdmissionCommit; state: SimulationState } {
    const source = structuredClone(sourceState) as SimulationState;
    const semantic = {
      baseRevision: source.revision,
      revision: source.revision + 1,
      step: source.step,
      entity: structuredClone(candidate.entity),
      placementId: candidate.placementId,
      agent: structuredClone(candidate.agent),
      meters: structuredClone(candidate.meters),
      quantities: structuredClone(candidate.quantities),
      ratings: structuredClone(candidate.ratings),
      conditions: structuredClone(candidate.conditions),
      invalidatedActionIds: Object.values(source.agents)
        .flatMap((agent) => agent.nextAction ? [agent.nextAction.id] : [])
        .sort(),
    };
    const committed: AgentAdmissionCommit = {
      contentHash: "",
      semanticHash: contentHash(semantic),
      ...semantic,
    };
    const payload = { ...committed } as Partial<AgentAdmissionCommit>;
    delete payload.contentHash;
    committed.contentHash = contentHash(payload);
    applyAdmissionCommit(source, committed);
    validateSimulationState(source, false, true);
    return { committed: structuredClone(committed), state: source };
  }

  bootstrap(sourceState: Readonly<SimulationState>, candidate: Readonly<BootstrapCandidate>): SimulationState {
    const source = structuredClone(sourceState) as SimulationState;
    if (candidate.schemaVersion !== WORLD_STEP_CANDIDATE_SCHEMA_VERSION) {
      throw new Error(`bootstrap candidate schema v${WORLD_STEP_CANDIDATE_SCHEMA_VERSION} required`);
    }
    if (candidate.sourceStateHash !== contentHash(source)) throw new Error("bootstrap candidate uses another source state");
    const commits = candidate.agentCommits.map((commit) => structuredClone(commit))
      .sort((left, right) => left.agentId.localeCompare(right.agentId));
    const expectedAgents = Object.keys(source.agents).sort((left, right) => left.localeCompare(right));
    const committedAgents = commits.map((commit) => commit.agentId);
    if (contentHash(expectedAgents) !== contentHash(committedAgents)) {
      throw new Error("bootstrap candidate does not update every agent exactly once");
    }
    const knownAgentIds = new Set(expectedAgents);
    validateUniqueAgentIds(candidate.diagnostics.activatedAgentIds, "bootstrap activation diagnostics", knownAgentIds);
    validateUniqueAgentIds(candidate.diagnostics.reusedAgentIds, "bootstrap reuse diagnostics", knownAgentIds);
    validateUniqueAgentIds(candidate.diagnostics.mindFallbackAgentIds, "bootstrap fallback diagnostics", knownAgentIds);
    if (candidate.diagnostics.reusedAgentIds.length > 0 ||
      contentHash([...candidate.diagnostics.activatedAgentIds].sort()) !== contentHash(committedAgents) ||
      candidate.diagnostics.mindFallbackAgentIds.some((agentId) =>
        !candidate.diagnostics.activatedAgentIds.includes(agentId))) {
      throw new Error("bootstrap diagnostics do not match AgentMind commits");
    }
    source.bootstrapAgentCommits = commits.map((commit) => ({
      agentId: commit.agentId,
      beliefPatch: structuredClone(commit.beliefPatch),
      characterPatch: structuredClone(commit.characterPatch),
      nextAction: structuredClone(commit.nextAction),
    }));
    for (const commit of source.bootstrapAgentCommits) {
      source.agents[commit.agentId] = applyMindCommit(
        source.agents[commit.agentId],
        commit,
        source.step,
        [],
        [],
      );
    }
    validateSimulationState(source, true, true);
    return source;
  }

  step(
    sourceState: Readonly<SimulationState>,
    candidateInput: Readonly<WorldStepCandidate>,
    policyRoster: Readonly<Record<string, PolicyBinding>>,
    maxAutonomousSpanSeconds: number,
  ): {
    committed: CommittedStep;
    state: SimulationState;
  } {
    const source = structuredClone(sourceState) as SimulationState;
    const candidate = structuredClone(candidateInput);
    const mindCommits = candidate.mindCommits
      .sort((left, right) => left.agentId.localeCompare(right.agentId));
    const resolution = candidate.resolution;
    const observations = resolutionObservations(resolution);
    const transitioned = applyTransitionProposal(source, resolution.proposal, candidate.temporalState);
    validateCandidateBoundary(
      source,
      resolution.actions,
      candidate,
      transitioned,
      maxAutonomousSpanSeconds,
      observations,
    );
    validateStepDiagnostics(
      source,
      transitioned,
      resolution.actions,
      candidate,
      policyRoster,
    );
    transitioned.truth.rng = structuredClone(resolution.rng);
    for (const agentId of Object.keys(transitioned.agents)) {
      transitioned.agents[agentId] = applyObservationBindings(
        transitioned.agents[agentId],
        observationsFor(observations, agentId),
      );
    }
    const committedAgents = mindCommits.map((commit) => commit.agentId);
    if (new Set(committedAgents).size !== committedAgents.length) {
      throw new Error("step candidate contains duplicate AgentMind commits");
    }
    for (const agentId of committedAgents) {
      if (!transitioned.agents[agentId] || source.agents[agentId] && policyRoster[agentId]?.kind !== "model") {
        throw new Error(`step candidate cannot update AgentMind for ${agentId}`);
      }
    }
    for (const commit of mindCommits) {
      const observed = pendingObservationsFor(
        transitioned,
        transitioned.agents[commit.agentId],
        observationsFor(observations, commit.agentId),
      );
      transitioned.agents[commit.agentId] = applyMindCommit(
        transitioned.agents[commit.agentId],
        commit,
        transitioned.step,
        observed,
        resolution.proposal.events,
      );
    }
    transitioned.historyBase ??= createHistoryReplayBase(source);
    validateSimulationState(transitioned, false);
    const semanticPayload: Omit<CommittedStep, "contentHash" | "semanticHash"> = {
      baseRevision: source.revision,
      revision: transitioned.revision,
      step: transitioned.step,
      initialActions: structuredClone(resolution.initialActions),
      reactionRequests: structuredClone(resolution.reactionRequests),
      reactionDecisions: structuredClone(resolution.reactionDecisions),
      actions: structuredClone(resolution.actions),
      rngBefore: structuredClone(source.truth.rng),
      rngAfter: structuredClone(transitioned.truth.rng),
      resolutionPlans: structuredClone(resolution.resolutionPlans),
      resolutionReceipts: structuredClone(resolution.resolutionReceipts),
      temporalPlans: structuredClone(candidate.temporalPlans),
      temporalBoundary: structuredClone(candidate.temporalBoundary),
      temporalState: structuredClone(candidate.temporalState),
      activityTransitions: structuredClone(candidate.activityTransitions),
      activityDispositions: structuredClone(candidate.activityDispositions),
      decisionPoints: structuredClone(candidate.decisionPoints),
      checkRequests: structuredClone(resolution.requests),
      checks: structuredClone(resolution.checks),
      randomRequests: structuredClone(resolution.randomRequests),
      randomResults: structuredClone(resolution.randomResults),
      commitmentRounds: structuredClone(resolution.commitmentRounds),
      outcomes: structuredClone(resolution.proposal.outcomes),
      mechanicInvocations: structuredClone(resolution.proposal.mechanicInvocations),
      mechanicResults: structuredClone(resolution.mechanicResults),
      causalAssertionResults: structuredClone(resolution.causalAssertionResults),
      causalVerification: structuredClone(resolution.causalVerification),
      events: structuredClone(resolution.proposal.events),
      observations: structuredClone(observations),
      operations: structuredClone(resolution.proposal.operations),
      decisionRequests: structuredClone(resolution.proposal.decisionRequests),
      beliefPatches: mindCommits.map((commit) => structuredClone(commit.beliefPatch)),
      characterPatches: mindCommits.map((commit) => structuredClone(commit.characterPatch)),
      nextActions: mindCommits.map((commit) => structuredClone(commit.nextAction)),
    };
    const committedPayload: Omit<CommittedStep, "contentHash"> = {
      semanticHash: contentHash(semanticPayload),
      ...semanticPayload,
    };
    const committed: CommittedStep = { contentHash: contentHash(committedPayload), ...committedPayload };
    transitioned.history.push(committed);
    validateSimulationState(transitioned, false, true);
    return { committed: structuredClone(committed), state: transitioned };
  }
}
