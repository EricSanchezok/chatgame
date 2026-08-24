import type {
  AgentBeliefState,
  AgentState,
  BeliefClaim,
  CausalRef,
  FactValue,
  MeterState,
  QuantityState,
  SimulationState,
  TransitionProposal,
  WorldDeltaOperation,
} from "./model";
import { validateCharacterState } from "./character";
import {
  characterPatchSchema,
  checkRequestSchema,
  reactionDecisionSchema,
  reactionRequestSchema,
} from "./llm-schemas";
import { contentHash as contentHashForAudit, isSha256 } from "./model-audit";
import { modelInferenceSchema } from "./model-catalog";
import {
  resolveD20Checks,
  resolveDiscreteRandomRequests,
  validateDiscreteRandomCommitmentBudget,
} from "./random";
import { evaluateProposalCausality } from "./causality";
import { createHistoryReplayBase } from "./history-replay";
import {
  commitmentRoundsSchema,
  discreteRandomRequestSchema,
  discreteRandomResultSchema,
  isSafeId,
} from "./state-schemas";

const playerIntentStatuses = new Set(["active", "completed", "failed", "cancelled"]);
const playerInputKinds = new Set(["goal", "clarification"]);

function assertSafeId(value: string, label: string): void {
  if (!isSafeId(value)) throw new Error(`${label} uses a reserved object key`);
}

function assertUniqueIds(ids: readonly string[], label: string): void {
  if (new Set(ids).size !== ids.length) throw new Error(`${label} contains duplicate ids`);
}

export class TransitionValidationError extends Error {
  constructor(readonly issues: string[]) {
    super(issues.join("; "));
    this.name = "TransitionValidationError";
  }
}

function assertCauses(causes: CausalRef[], label: string): void {
  if (causes.length === 0) throw new Error(`${label} has no causal provenance`);
  for (const cause of causes) {
    if (!cause.id.trim()) throw new Error(`${label} has an empty causal reference`);
    assertSafeId(cause.id, `${label} causal reference`);
  }
}

function assertFactValueReferences(value: FactValue, state: SimulationState, label: string): void {
  if (value.kind === "entity" && !state.truth.entities[value.entityId]) {
    throw new Error(`${label} references unknown entity ${value.entityId}`);
  }
  if (value.kind === "entity") assertSafeId(value.entityId, `${label} entity reference`);
  if (value.kind === "number" && !Number.isFinite(value.value)) {
    throw new Error(`${label} contains a non-finite number`);
  }
}

function quantityKey(definitionId: string, holderId: string): string {
  return `${definitionId}:${holderId}`;
}

function getOrCreateQuantity(
  state: SimulationState,
  definitionId: string,
  holderId: string,
): QuantityState {
  const id = quantityKey(definitionId, holderId);
  const existing = state.truth.quantities[id];
  if (existing) return existing;
  const created: QuantityState = { id, definitionId, holderId, amount: 0 };
  state.truth.quantities[id] = created;
  return created;
}

function thresholdReached(meter: MeterState, operator: "lte" | "gte", value: number): boolean {
  return operator === "lte" ? meter.current <= value : meter.current >= value;
}

function applyThresholds(state: SimulationState, meter: MeterState, causes: CausalRef[]): void {
  const definition = state.truth.mechanics.meters[meter.definitionId];
  for (const threshold of definition.thresholds) {
    if (meter.firedThresholdIds.includes(threshold.id)) continue;
    if (!thresholdReached(meter, threshold.when.operator, threshold.when.value)) continue;
    meter.firedThresholdIds.push(threshold.id);
    for (const effect of threshold.effects) {
      if (effect.kind === "set_lifecycle") {
        state.truth.entities[meter.entityId].lifecycle = effect.lifecycle;
        continue;
      }
      const id = `threshold:${meter.id}:${threshold.id}:${effect.predicate}`;
      state.truth.facts[id] = {
        id,
        subjectId: meter.entityId,
        predicate: effect.predicate,
        value: structuredClone(effect.value),
        description: effect.description,
        access: structuredClone(effect.access ?? { kind: "public" }),
        provenance: [...causes],
      };
    }
  }
}

function validateMeter(state: SimulationState, meter: MeterState): void {
  const definition = state.truth.mechanics.meters[meter.definitionId];
  if (!definition) throw new Error(`unknown meter definition ${meter.definitionId}`);
  if (!state.truth.entities[meter.entityId]) throw new Error(`unknown meter entity ${meter.entityId}`);
  if (!Number.isFinite(meter.current) || meter.current < definition.min || meter.current > definition.max) {
    throw new Error(`meter ${meter.id} is outside ${definition.min}..${definition.max}`);
  }
  const thresholdIds = new Set(definition.thresholds.map((threshold) => threshold.id));
  for (const thresholdId of meter.firedThresholdIds) {
    if (!thresholdIds.has(thresholdId)) throw new Error(`meter ${meter.id} has unknown threshold ${thresholdId}`);
  }
  assertUniqueIds(meter.firedThresholdIds, `meter ${meter.id} fired thresholds`);
}

function validateRating(state: SimulationState, id: string): void {
  const rating = state.truth.ratings[id];
  const definition = rating && state.truth.mechanics.ratings[rating.definitionId];
  if (!rating || !definition) throw new Error(`unknown rating or definition ${id}`);
  if (!state.truth.entities[rating.entityId]) throw new Error(`unknown rating entity ${rating.entityId}`);
  if (!Number.isFinite(rating.value) || rating.value < definition.min || rating.value > definition.max) {
    throw new Error(`rating ${id} is outside ${definition.min}..${definition.max}`);
  }
}

export function applyWorldDeltaOperation(state: SimulationState, operation: WorldDeltaOperation): void {
  assertCauses(operation.causes, operation.kind);
  if (operation.assertions.length === 0) throw new Error(`${operation.kind} has no causal assertions`);
  switch (operation.kind) {
    case "create_entity":
      assertSafeId(operation.entity.id, "entity id");
      if (operation.placementId) assertSafeId(operation.placementId, "entity placement id");
      if (state.truth.entities[operation.entity.id]) throw new Error(`entity already exists: ${operation.entity.id}`);
      if (operation.placementId && !state.truth.entities[operation.placementId]) {
        throw new Error(`unknown placement ${operation.placementId}`);
      }
      state.truth.entities[operation.entity.id] = structuredClone(operation.entity);
      state.truth.placements[operation.entity.id] = operation.placementId;
      return;
    case "retire_entity":
      assertSafeId(operation.entityId, "retired entity id");
      if (!state.truth.entities[operation.entityId]) throw new Error(`unknown entity ${operation.entityId}`);
      state.truth.entities[operation.entityId].lifecycle = "retired";
      return;
    case "place_entity":
      assertSafeId(operation.entityId, "placed entity id");
      if (operation.placementId) assertSafeId(operation.placementId, "placement id");
      if (!state.truth.entities[operation.entityId]) throw new Error(`unknown entity ${operation.entityId}`);
      if (operation.placementId && !state.truth.entities[operation.placementId]) {
        throw new Error(`unknown placement ${operation.placementId}`);
      }
      if (operation.entityId === operation.placementId) throw new Error("entity cannot contain itself");
      state.truth.placements[operation.entityId] = operation.placementId;
      return;
    case "set_fact":
      assertSafeId(operation.fact.id, "fact id");
      assertSafeId(operation.fact.subjectId, "fact subject id");
      if (!state.truth.entities[operation.fact.subjectId]) {
        throw new Error(`unknown fact subject ${operation.fact.subjectId}`);
      }
      assertFactValueReferences(operation.fact.value, state, `fact ${operation.fact.id}`);
      state.truth.facts[operation.fact.id] = {
        ...structuredClone(operation.fact),
        provenance: structuredClone(operation.causes),
      };
      return;
    case "remove_fact":
      assertSafeId(operation.factId, "removed fact id");
      if (!state.truth.facts[operation.factId]) throw new Error(`unknown fact ${operation.factId}`);
      delete state.truth.facts[operation.factId];
      return;
    case "set_meter":
      assertSafeId(operation.meter.id, "meter id");
      assertSafeId(operation.meter.definitionId, "meter definition id");
      assertSafeId(operation.meter.entityId, "meter entity id");
      state.truth.meters[operation.meter.id] = structuredClone(operation.meter);
      validateMeter(state, state.truth.meters[operation.meter.id]);
      applyThresholds(state, state.truth.meters[operation.meter.id], operation.causes);
      return;
    case "adjust_meter": {
      assertSafeId(operation.meterId, "adjusted meter id");
      const meter = state.truth.meters[operation.meterId];
      if (!meter) throw new Error(`unknown meter ${operation.meterId}`);
      meter.current += operation.amount;
      validateMeter(state, meter);
      applyThresholds(state, meter, operation.causes);
      return;
    }
    case "transfer_quantity": {
      assertSafeId(operation.definitionId, "quantity definition id");
      assertSafeId(operation.fromHolderId, "source quantity holder id");
      assertSafeId(operation.toHolderId, "target quantity holder id");
      const definition = state.truth.mechanics.quantities[operation.definitionId];
      if (!definition) throw new Error(`unknown quantity definition ${operation.definitionId}`);
      if (!Number.isFinite(operation.amount) || operation.amount <= 0) throw new Error("transfer amount must be positive");
      if (!state.truth.entities[operation.fromHolderId] || !state.truth.entities[operation.toHolderId]) {
        throw new Error("quantity transfer references an unknown holder");
      }
      const from = getOrCreateQuantity(state, operation.definitionId, operation.fromHolderId);
      const to = getOrCreateQuantity(state, operation.definitionId, operation.toHolderId);
      if (from.amount < operation.amount) throw new Error(`insufficient ${definition.name}`);
      from.amount -= operation.amount;
      to.amount += operation.amount;
      return;
    }
    case "produce_quantity": {
      assertSafeId(operation.definitionId, "quantity definition id");
      assertSafeId(operation.holderId, "quantity holder id");
      assertSafeId(operation.lawId, "production law id");
      const definition = state.truth.mechanics.quantities[operation.definitionId];
      if (!definition?.productionLawIds.includes(operation.lawId)) {
        throw new Error(`law ${operation.lawId} cannot produce ${operation.definitionId}`);
      }
      if (!operation.causes.some((cause) => cause.kind === "law" && cause.id === operation.lawId)) {
        throw new Error(`production must cite authorizing law ${operation.lawId}`);
      }
      if (!state.truth.entities[operation.holderId]) throw new Error(`unknown holder ${operation.holderId}`);
      if (!Number.isFinite(operation.amount) || operation.amount <= 0) throw new Error("production amount must be positive");
      getOrCreateQuantity(state, operation.definitionId, operation.holderId).amount += operation.amount;
      return;
    }
    case "consume_quantity": {
      assertSafeId(operation.definitionId, "quantity definition id");
      assertSafeId(operation.holderId, "quantity holder id");
      assertSafeId(operation.lawId, "consumption law id");
      const definition = state.truth.mechanics.quantities[operation.definitionId];
      if (!definition?.consumptionLawIds.includes(operation.lawId)) {
        throw new Error(`law ${operation.lawId} cannot consume ${operation.definitionId}`);
      }
      if (!operation.causes.some((cause) => cause.kind === "law" && cause.id === operation.lawId)) {
        throw new Error(`consumption must cite authorizing law ${operation.lawId}`);
      }
      if (!Number.isFinite(operation.amount) || operation.amount <= 0) throw new Error("consumption amount must be positive");
      const quantity = getOrCreateQuantity(state, operation.definitionId, operation.holderId);
      if (quantity.amount < operation.amount) throw new Error(`insufficient ${definition.name}`);
      quantity.amount -= operation.amount;
      return;
    }
    case "set_rating":
      assertSafeId(operation.rating.id, "rating id");
      assertSafeId(operation.rating.definitionId, "rating definition id");
      assertSafeId(operation.rating.entityId, "rating entity id");
      state.truth.ratings[operation.rating.id] = structuredClone(operation.rating);
      validateRating(state, operation.rating.id);
      return;
    case "advance_time":
      if (!Number.isSafeInteger(operation.seconds) || operation.seconds <= 0) {
        throw new Error("time advance must be a positive whole number of seconds");
      }
      state.truth.elapsedSeconds += operation.seconds;
      return;
    case "create_agent":
      assertSafeId(operation.agent.id, "agent id");
      assertSafeId(operation.agent.entityId, "agent entity id");
      for (const profileId of Object.values(operation.agent.modelProfiles)) {
        assertSafeId(profileId, "agent model profile id");
      }
      if (state.agents[operation.agent.id]) throw new Error(`agent already exists: ${operation.agent.id}`);
      if (!state.truth.entities[operation.agent.entityId]) throw new Error(`unknown agent entity ${operation.agent.entityId}`);
      if (operation.agent.nextAction !== null) {
        throw new Error(`new agent ${operation.agent.id} must not provide a prepared action`);
      }
      state.agents[operation.agent.id] = structuredClone(operation.agent);
      state.agents[operation.agent.id].character.persona.updatedAtStep = state.step + 1;
      for (const collection of [
        state.agents[operation.agent.id].character.traits,
        state.agents[operation.agent.id].character.values,
        state.agents[operation.agent.id].character.emotions,
        state.agents[operation.agent.id].character.attitudes,
        state.agents[operation.agent.id].character.goals,
        state.agents[operation.agent.id].character.commitments,
      ]) {
        for (const record of Object.values(collection)) {
          record.createdAtStep = state.step + 1;
          record.updatedAtStep = state.step + 1;
        }
      }
      return;
    case "remove_agent":
      assertSafeId(operation.agentId, "removed agent id");
      if (!state.agents[operation.agentId]) throw new Error(`unknown agent ${operation.agentId}`);
      delete state.agents[operation.agentId];
      return;
  }
}

function validatePlacementCycles(state: SimulationState): void {
  for (const placementId of Object.keys(state.truth.placements)) {
    assertSafeId(placementId, "placement owner id");
    if (!state.truth.entities[placementId]) throw new Error(`placement belongs to unknown entity ${placementId}`);
  }
  for (const entityId of Object.keys(state.truth.entities)) {
    if (!(entityId in state.truth.placements)) throw new Error(`entity ${entityId} has no placement entry`);
    const visited = new Set<string>([entityId]);
    let current = state.truth.placements[entityId];
    while (current) {
      assertSafeId(current, `placement for ${entityId}`);
      if (!state.truth.entities[current]) throw new Error(`unknown placement entity ${current}`);
      if (visited.has(current)) throw new Error(`placement cycle detected at ${current}`);
      visited.add(current);
      current = state.truth.placements[current];
    }
  }
}

function validateBelief(
  belief: AgentBeliefState,
  bindings: AgentState["bindings"],
  state: SimulationState,
  label: string,
): void {
  for (const [id, entity] of Object.entries(belief.localEntities)) {
    assertSafeId(id, `${label} local entity id`);
    if (entity.id !== id) throw new Error(`${label} local entity key does not match ${entity.id}`);
    if (state.truth.entities[id]) throw new Error(`${label} local entity ${id} collides with canonical identity`);
  }
  for (const [id, evidence] of Object.entries(belief.evidence)) {
    assertSafeId(id, `${label} evidence id`);
    if (evidence.id !== id) throw new Error(`${label} evidence key does not match ${evidence.id}`);
    if (!Number.isSafeInteger(evidence.step) || evidence.step < 0 || evidence.step > state.step) {
      throw new Error(`${label} evidence ${id} has invalid step`);
    }
  }
  const validateClaim = (id: string, claim: BeliefClaim): void => {
    assertSafeId(id, `${label} claim id`);
    if (claim.id !== id) throw new Error(`${label} claim key does not match ${claim.id}`);
    if (!belief.localEntities[claim.subjectId]) throw new Error(`${label} claim ${id} has unknown subject`);
    if (claim.value.kind === "local_entity" && !belief.localEntities[claim.value.localEntityId]) {
      throw new Error(`${label} claim ${id} has unknown local value`);
    }
    if (!Number.isFinite(claim.confidence) || claim.confidence < 0 || claim.confidence > 1) {
      throw new Error(`${label} claim ${id} has invalid confidence`);
    }
    for (const evidenceId of claim.evidenceIds) {
      if (!belief.evidence[evidenceId]) throw new Error(`${label} claim ${id} has unknown evidence ${evidenceId}`);
    }
    assertUniqueIds(claim.evidenceIds, `${label} claim ${id} evidence`);
  };
  for (const [id, claim] of Object.entries(belief.claims)) validateClaim(id, claim);
  for (const [id, binding] of Object.entries(bindings)) {
    assertSafeId(id, `${label} binding id`);
    if (binding.localEntityId !== id || !belief.localEntities[id]) {
      throw new Error(`${label} has invalid binding ${id}`);
    }
    for (const canonicalId of binding.canonicalEntityIds) {
      if (!state.truth.entities[canonicalId]) throw new Error(`${label} binding ${id} has unknown canonical entity`);
    }
    assertUniqueIds(binding.canonicalEntityIds, `${label} binding ${id}`);
  }
}

function validatePlayerKnowledge(state: SimulationState): void {
  const knowledge = state.player.knowledge;
  for (const [id, entity] of Object.entries(knowledge.localEntities)) {
    assertSafeId(id, "player local entity id");
    if (entity.id !== id) throw new Error(`player local entity key does not match ${entity.id}`);
    if (state.truth.entities[id]) throw new Error(`player local entity ${id} collides with canonical identity`);
  }
  for (const [id, evidence] of Object.entries(knowledge.evidence)) {
    assertSafeId(id, "player evidence id");
    if (evidence.id !== id) throw new Error(`player evidence key does not match ${evidence.id}`);
    if (!Number.isSafeInteger(evidence.step) || evidence.step < 0 || evidence.step > state.step) {
      throw new Error(`player evidence ${id} has invalid step`);
    }
  }
  for (const [id, claim] of Object.entries(knowledge.claims)) {
    assertSafeId(id, "player claim id");
    if (claim.id !== id) throw new Error(`player claim key does not match ${claim.id}`);
    if (!knowledge.localEntities[claim.subjectId]) throw new Error(`player claim ${id} has unknown subject`);
    if (claim.value.kind === "local_entity" && !knowledge.localEntities[claim.value.localEntityId]) {
      throw new Error(`player claim ${id} has unknown local value`);
    }
    for (const evidenceId of claim.evidenceIds) {
      if (!knowledge.evidence[evidenceId]) throw new Error(`player claim ${id} has unknown evidence ${evidenceId}`);
    }
    assertUniqueIds(claim.evidenceIds, `player claim ${id} evidence`);
  }
  for (const observationId of knowledge.observationIds) {
    if (!knowledge.evidence[`observation:${observationId}`]) {
      throw new Error(`player observation ${observationId} has no evidence`);
    }
  }
  assertUniqueIds(knowledge.observationIds, "player observations");
  for (const [id, binding] of Object.entries(state.player.bindings)) {
    assertSafeId(id, "player binding id");
    if (binding.localEntityId !== id || !knowledge.localEntities[id]) {
      throw new Error(`player has invalid binding ${id}`);
    }
    for (const canonicalId of binding.canonicalEntityIds) {
      if (!state.truth.entities[canonicalId]) throw new Error(`player binding ${id} has unknown canonical entity`);
    }
    assertUniqueIds(binding.canonicalEntityIds, `player binding ${id}`);
  }
}

function validateHistory(state: SimulationState): void {
  if (state.history.length !== state.revision || state.step !== state.revision) {
    throw new Error("history, revision and step are not aligned");
  }
  if (state.history.length > 0 && !state.historyBase) {
    throw new Error("committed history is missing its pinned replay base");
  }
  const historyBase = createHistoryReplayBase(state);
  if (historyBase.truth.events.length > 0) {
    throw new Error("history replay base must not contain committed events");
  }
  assertSafeId(historyBase.playerEntityId, "history replay player entity");
  if (!historyBase.truth.entities[historyBase.playerEntityId]) {
    throw new Error("history replay player has no entity");
  }
  const replayAgentEntities = new Set<string>();
  const replayAgents = Object.fromEntries(Object.entries(historyBase.agentEntities).map(([agentId, entityId]) => {
    assertSafeId(agentId, "history replay agent id");
    assertSafeId(entityId, `history replay agent ${agentId} entity`);
    if (historyBase.truth.entities[entityId]?.lifecycle !== "active") {
      throw new Error(`history replay agent ${agentId} has no entity`);
    }
    if (replayAgentEntities.has(entityId)) {
      throw new Error(`history replay entity ${entityId} has multiple agents`);
    }
    replayAgentEntities.add(entityId);
    return [agentId, { id: agentId, entityId } as AgentState];
  }));
  const replayState: SimulationState = {
    schemaVersion: state.schemaVersion,
    worldId: state.worldId,
    worldHash: state.worldHash,
    lawIds: structuredClone(state.lawIds),
    revision: 0,
    step: 0,
    truth: structuredClone(historyBase.truth),
    agents: replayAgents,
    player: { ...structuredClone(state.player), entityId: historyBase.playerEntityId },
    history: [],
    historyBase: structuredClone(historyBase),
    bootstrapModelAudits: [],
  };
  const priorEventIds = new Set<string>();
  const allFactIds = new Set(Object.keys(state.truth.facts));
  for (const committed of state.history) {
    for (const operation of committed.operations) {
      if (operation.kind === "set_fact") allFactIds.add(operation.fact.id);
      if (operation.kind === "remove_fact") allFactIds.add(operation.factId);
    }
  }
  const lawIds = new Set(state.lawIds);
  const historyActionIds = new Set<string>();
  const historyCheckIds = new Set<string>();
  const historyRandomIds = new Set<string>();
  const assertResolved = (
    causes: CausalRef[],
    allowed: Record<CausalRef["kind"], Set<string>>,
    label: string,
  ): void => {
    assertCauses(causes, label);
    for (const cause of causes) {
      if (!allowed[cause.kind].has(cause.id)) throw new Error(`${label} references unknown ${cause.kind} ${cause.id}`);
    }
  };
  for (let index = 0; index < state.history.length; index += 1) {
    const committed = state.history[index];
    const { contentHash: committedHash, ...committedPayload } = committed;
    if (!isSha256(committedHash) || contentHashForAudit(committedPayload) !== committedHash) {
      throw new Error(`history step ${index + 1} has an invalid content hash`);
    }
    if (committed.baseRevision !== index || committed.revision !== index + 1 || committed.step !== index + 1) {
      throw new Error(`history step ${index + 1} has invalid revision metadata`);
    }
    const initialProposalIds = committed.initialActions.map((action) => action.id);
    const proposalIds = committed.actions.map((action) => action.id);
    const outcomeIds = committed.outcomes.map((outcome) => outcome.proposalId);
    if (new Set(initialProposalIds).size !== initialProposalIds.length ||
      new Set(proposalIds).size !== proposalIds.length || new Set(outcomeIds).size !== outcomeIds.length) {
      throw new Error(`history step ${index + 1} has duplicate actions or outcomes`);
    }
    if (proposalIds.length !== outcomeIds.length || proposalIds.some((id) => !outcomeIds.includes(id))) {
      throw new Error(`history step ${index + 1} does not cover every action`);
    }
    if ([...committed.initialActions, ...committed.actions]
      .some((action) => action.baseRevision !== committed.baseRevision)) {
      throw new Error(`history step ${index + 1} contains a stale action`);
    }
    for (const action of [...committed.initialActions, ...committed.actions]) {
      assertUniqueIds(action.targetIds, `history action ${action.id} targets`);
    }
    const initialActors = committed.initialActions.map((action) => action.actorId);
    const finalActors = committed.actions.map((action) => action.actorId);
    if (new Set(initialActors).size !== initialActors.length || new Set(finalActors).size !== finalActors.length ||
      initialActors.length !== finalActors.length || initialActors.some((actorId) => !finalActors.includes(actorId))) {
      throw new Error(`history step ${index + 1} changes the joint actor set`);
    }
    const reactionAgents = committed.reactionRequests.map((request) => request.agentId);
    const decisionAgents = committed.reactionDecisions.map((decision) => decision.agentId);
    for (const request of committed.reactionRequests) reactionRequestSchema.parse(request);
    for (const decision of committed.reactionDecisions) reactionDecisionSchema.parse(decision);
    for (const request of committed.checkRequests) checkRequestSchema.parse(request);
    const parsedCommitmentRounds = commitmentRoundsSchema.safeParse(committed.commitmentRounds);
    if (!parsedCommitmentRounds.success) {
      throw new Error(`history step ${index + 1} has an invalid commitment round ledger`);
    }
    validateDiscreteRandomCommitmentBudget(committed.randomRequests, committed.randomResults);
    for (const request of committed.randomRequests) discreteRandomRequestSchema.parse(request);
    for (const result of committed.randomResults) discreteRandomResultSchema.parse(result);
    for (const patch of committed.characterPatches) characterPatchSchema.parse(patch);
    if (new Set(reactionAgents).size !== reactionAgents.length ||
      new Set(decisionAgents).size !== decisionAgents.length ||
      reactionAgents.length !== decisionAgents.length ||
      reactionAgents.some((agentId) => !decisionAgents.includes(agentId))) {
      throw new Error(`history step ${index + 1} has invalid reaction coverage`);
    }
    const playerInitialAction = committed.initialActions.find((action) => action.actorId === "player");
    for (const request of committed.reactionRequests) {
      if (!playerInitialAction || request.sourceActionId !== playerInitialAction.id ||
        request.stimulus.observerId !== request.agentId || request.stimulus.kind !== "stimulus" ||
        request.stimulus.step !== committed.step || request.stimulus.sourceEventIds.length !== 0 ||
        request.basis.length === 0) {
        throw new Error(`history step ${index + 1} has invalid reaction request for ${request.agentId}`);
      }
      for (const basis of request.basis) {
        if (basis.kind === "shared_placement" && !state.truth.entities[basis.placementId]) {
          throw new Error(`history step ${index + 1} has unknown reaction placement ${basis.placementId}`);
        }
        if (basis.kind === "fact" && !allFactIds.has(basis.factId)) {
          throw new Error(`history step ${index + 1} has unknown reaction fact ${basis.factId}`);
        }
        if (basis.kind === "perception_check") {
          const checkRequest = committed.checkRequests.find((candidate) => candidate.id === basis.checkId);
          const checkResult = committed.checks.find((candidate) => candidate.requestId === basis.checkId);
          if (checkRequest?.phase !== "perception" || !checkResult?.succeeded) {
            throw new Error(`history step ${index + 1} has invalid perception basis ${basis.checkId}`);
          }
        }
      }
    }
    for (const decision of committed.reactionDecisions) {
      const initial = committed.initialActions.find((action) => action.actorId === decision.agentId);
      const final = committed.actions.find((action) => action.actorId === decision.agentId);
      if (!initial || !final || decision.baseRevision !== committed.baseRevision ||
        decision.originalProposalId !== initial.id ||
        (decision.kind === "keep" && contentHashForAudit(final) !== contentHashForAudit(initial)) ||
        (decision.kind === "replace" &&
          (decision.replacementAction.actorId !== decision.agentId ||
            decision.replacementAction.baseRevision !== committed.baseRevision ||
            contentHashForAudit(final) !== contentHashForAudit(decision.replacementAction)))) {
        throw new Error(`history step ${index + 1} has invalid reaction decision for ${decision.agentId}`);
      }
    }
    for (const initial of committed.initialActions) {
      if (reactionAgents.includes(initial.actorId)) continue;
      const final = committed.actions.find((action) => action.actorId === initial.actorId);
      if (!final || contentHashForAudit(final) !== contentHashForAudit(initial)) {
        throw new Error(`history step ${index + 1} mutates action for non-reacting actor ${initial.actorId}`);
      }
    }
    if (committed.operations.filter((operation) => operation.kind === "advance_time").length !== 1) {
      throw new Error(`history step ${index + 1} has invalid time advancement`);
    }
    const requestIds = committed.checkRequests.map((request) => request.id);
    const resultIds = committed.checks.map((result) => result.requestId);
    if (new Set(requestIds).size !== requestIds.length || new Set(resultIds).size !== resultIds.length ||
      requestIds.length !== resultIds.length || requestIds.some((id, requestIndex) => id !== resultIds[requestIndex])) {
      throw new Error(`history step ${index + 1} has invalid check audit coverage`);
    }
    const randomRequestIds = committed.randomRequests.map((request) => request.id);
    const randomResultIds = committed.randomResults.map((result) => result.requestId);
    if (new Set(randomRequestIds).size !== randomRequestIds.length ||
      new Set(randomResultIds).size !== randomResultIds.length ||
      randomRequestIds.some((id) => historyRandomIds.has(id)) ||
      randomRequestIds.length !== randomResultIds.length ||
      randomRequestIds.some((id, requestIndex) => id !== randomResultIds[requestIndex])) {
      throw new Error(`history step ${index + 1} has invalid random audit coverage`);
    }
    for (const request of committed.checkRequests) {
      const modifierSourceIds = request.modifierSources.map((source) => `${source.kind}:${source.id}`);
      if (new Set(modifierSourceIds).size !== modifierSourceIds.length ||
        request.modifierSources.reduce((total, source) => total + source.amount, 0) !== request.modifier) {
        throw new Error(`history step ${index + 1} has invalid modifier sources for ${request.id}`);
      }
      const result = committed.checks.find((candidate) => candidate.requestId === request.id)!;
      const expectedDice = request.mode === "normal" ? 1 : 2;
      const expectedKept = request.mode === "disadvantage" ? Math.min(...result.dice) : Math.max(...result.dice);
      if (result.dice.length !== expectedDice || result.kept !== expectedKept ||
        result.modifier !== request.modifier || result.dc !== request.dc ||
        result.visibility !== request.visibility || result.total !== result.kept + result.modifier ||
        result.succeeded !== (result.total >= result.dc) || result.margin !== result.total - result.dc) {
        throw new Error(`history step ${index + 1} has inconsistent check result ${request.id}`);
      }
    }
    const ledgerCheckIds = parsedCommitmentRounds.data.flatMap((round) =>
      round.kind === "check" ? round.requestIds : []);
    const ledgerRandomIds = parsedCommitmentRounds.data.flatMap((round) =>
      round.kind === "random" ? round.requestIds : []);
    if (requestIds.some((id, requestIndex) => id !== ledgerCheckIds[requestIndex]) ||
      requestIds.length !== ledgerCheckIds.length ||
      randomRequestIds.some((id, requestIndex) => id !== ledgerRandomIds[requestIndex]) ||
      randomRequestIds.length !== ledgerRandomIds.length) {
      throw new Error(`history step ${index + 1} commitment rounds do not exactly cover requests in order`);
    }

    const checkById = new Map(committed.checkRequests.map((request) => [request.id, request]));
    const randomById = new Map(committed.randomRequests.map((request) => [request.id, request]));
    const committedCheckIds = new Set<string>();
    const committedRandomIds = new Set<string>();
    const stepFactIds = new Set(Object.keys(replayState.truth.facts));
    let resolutionStarted = false;
    let randomStarted = false;
    for (const [roundIndex, round] of parsedCommitmentRounds.data.entries()) {
      if (round.kind === "check") {
        if (randomStarted) {
          throw new Error(`history step ${index + 1} has a d20 round after random commitments`);
        }
        if (round.phase === "perception" && resolutionStarted) {
          throw new Error(`history step ${index + 1} reopens perception after resolution`);
        }
        if (round.phase === "resolution") resolutionStarted = true;
        const actionIds = round.phase === "perception"
          ? new Set(initialProposalIds)
          : new Set(proposalIds);
        for (const requestId of round.requestIds) {
          const request = checkById.get(requestId);
          if (!request || request.phase !== round.phase) {
            throw new Error(`history step ${index + 1} has an invalid check round ${roundIndex + 1}`);
          }
          assertResolved(request.causes, {
            action: actionIds,
            check: committedCheckIds,
            random: committedRandomIds,
            event: priorEventIds,
            fact: stepFactIds,
            law: lawIds,
            mechanic: new Set(),
          }, `history check ${request.id}`);
        }
        for (const requestId of round.requestIds) committedCheckIds.add(requestId);
        continue;
      }

      resolutionStarted = true;
      randomStarted = true;
      for (const requestId of round.requestIds) {
        const request = randomById.get(requestId);
        if (!request) {
          throw new Error(`history step ${index + 1} has an invalid random round ${roundIndex + 1}`);
        }
        assertResolved(request.causes, {
          action: new Set(proposalIds),
          check: committedCheckIds,
          random: committedRandomIds,
          event: priorEventIds,
          fact: stepFactIds,
          law: lawIds,
          mechanic: new Set(),
        }, `history random request ${request.id}`);
      }
      for (const requestId of round.requestIds) committedRandomIds.add(requestId);
    }
    const replayedChecks = resolveD20Checks(committed.rngBefore, committed.checkRequests);
    const replayedRandom = resolveDiscreteRandomRequests(replayedChecks.rng, committed.randomRequests);
    if (JSON.stringify(replayedChecks.results) !== JSON.stringify(committed.checks) ||
      JSON.stringify(replayedRandom.results) !== JSON.stringify(committed.randomResults) ||
      JSON.stringify(replayedRandom.rng) !== JSON.stringify(committed.rngAfter)) {
      throw new Error(`history step ${index + 1} has non-reproducible RNG audit`);
    }
    if (index > 0 && JSON.stringify(state.history[index - 1].rngAfter) !== JSON.stringify(committed.rngBefore)) {
      throw new Error(`history step ${index + 1} has discontinuous RNG state`);
    }
    if (JSON.stringify(replayState.truth.rng) !== JSON.stringify(committed.rngBefore)) {
      throw new Error(`history step ${index + 1} does not start from the replayed RNG state`);
    }
    for (const role of [
      "truth-perception",
      "truth-reaction-routing",
      "truth-resolution",
      "truth-transition",
      "causal-verifier",
    ] as const) {
      if (!committed.modelAudits.some((audit) => audit.role === role)) {
        throw new Error(`history step ${index + 1} has no ${role} audit`);
      }
    }
    const patchAgentIds = committed.beliefPatches.map((patch) => patch.agentId);
    const characterPatchAgentIds = committed.characterPatches.map((patch) => patch.agentId);
    const auditAgentIds = committed.modelAudits
      .filter((audit) => audit.role === "agent-mind" || audit.role === "agent-bootstrap")
      .map((audit) => audit.subjectId);
    if (new Set(patchAgentIds).size !== patchAgentIds.length || new Set(auditAgentIds).size !== auditAgentIds.length ||
      patchAgentIds.length !== auditAgentIds.length || patchAgentIds.some((agentId) => !auditAgentIds.includes(agentId)) ||
      characterPatchAgentIds.length !== patchAgentIds.length ||
      patchAgentIds.some((agentId) => !characterPatchAgentIds.includes(agentId)) ||
      committed.beliefPatches.some((patch) => patch.baseRevision !== committed.revision) ||
      committed.characterPatches.some((patch) => patch.baseRevision !== committed.revision)) {
      throw new Error(`history step ${index + 1} has invalid AgentMind audit coverage`);
    }
    const createdAgentIds = new Set(committed.operations
      .filter((operation) => operation.kind === "create_agent")
      .map((operation) => operation.agent.id));
    for (const audit of committed.modelAudits.filter((candidate) =>
      candidate.role === "agent-mind" || candidate.role === "agent-bootstrap")) {
      const expectedRole = createdAgentIds.has(audit.subjectId) ? "agent-bootstrap" : "agent-mind";
      if (audit.role !== expectedRole) {
        throw new Error(`history step ${index + 1} uses ${audit.role} for ${audit.subjectId}; expected ${expectedRole}`);
      }
    }
    const reactionAuditAgentIds = committed.modelAudits
      .filter((audit) => audit.role === "agent-reaction")
      .map((audit) => audit.subjectId);
    if (new Set(reactionAuditAgentIds).size !== reactionAuditAgentIds.length ||
      reactionAuditAgentIds.length !== reactionAgents.length ||
      reactionAgents.some((agentId) => !reactionAuditAgentIds.includes(agentId))) {
      throw new Error(`history step ${index + 1} has invalid Agent reaction audit coverage`);
    }
    for (const audit of committed.modelAudits) validateModelAudit(audit, `history step ${index + 1}`);
    const allowedForEvents: Record<CausalRef["kind"], Set<string>> = {
      action: new Set(proposalIds),
      check: new Set(requestIds),
      random: new Set(randomRequestIds),
      event: new Set(priorEventIds),
      fact: allFactIds,
      law: lawIds,
      mechanic: new Set(),
    };
    for (const invocation of committed.mechanicInvocations) {
      assertResolved(invocation.causes, allowedForEvents, `history mechanic ${invocation.id}`);
      allowedForEvents.mechanic.add(invocation.id);
    }
    for (const event of committed.events) {
      assertResolved(event.causes, allowedForEvents, `history event ${event.id}`);
      allowedForEvents.event.add(event.id);
    }
    for (const operation of committed.operations) {
      assertResolved(operation.causes, allowedForEvents, `history operation ${operation.kind}`);
      if ((operation.kind === "produce_quantity" || operation.kind === "consume_quantity") &&
        !lawIds.has(operation.lawId)) throw new Error(`history operation references unknown law ${operation.lawId}`);
    }
    for (const outcome of committed.outcomes) {
      assertResolved(outcome.causeRefs, allowedForEvents, `history outcome ${outcome.proposalId}`);
    }
    const replayProposal: TransitionProposal = {
      baseRevision: committed.baseRevision,
      outcomes: structuredClone(committed.outcomes),
      mechanicInvocations: structuredClone(committed.mechanicInvocations),
      operations: structuredClone(committed.operations),
      events: structuredClone(committed.events),
      observations: committed.observations
        .filter((observation) => observation.kind === "outcome")
        .map((observation) => structuredClone(observation)),
      intentStatus: committed.intentStatus,
      requiresPlayerDecision: committed.requiresPlayerDecision,
    };
    let replayedCausalAssertions;
    try {
      replayedCausalAssertions = evaluateProposalCausality(
        replayState,
        replayedChecks.results,
        replayedRandom.results,
        replayProposal,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`history step ${index + 1} has invalid causal assurance: ${message}`);
    }
    if (committed.causalVerification.verdict !== "accept" ||
      contentHashForAudit(replayedCausalAssertions) !== contentHashForAudit(committed.causalAssertionResults)) {
      throw new Error(`history step ${index + 1} has invalid causal assurance`);
    }
    const resultInvocationIds = committed.mechanicResults.map((result) => result.invocationId);
    const invocationIds = committed.mechanicInvocations.map((invocation) => invocation.id);
    if (new Set(invocationIds).size !== invocationIds.length ||
      new Set(resultInvocationIds).size !== resultInvocationIds.length ||
      invocationIds.length !== resultInvocationIds.length ||
      invocationIds.some((id) => !resultInvocationIds.includes(id))) {
      throw new Error(`history step ${index + 1} has invalid mechanic result coverage`);
    }
    for (const invocation of committed.mechanicInvocations) {
      const result = committed.mechanicResults.find((candidate) => candidate.invocationId === invocation.id)!;
      if (result.packageId !== invocation.packageId || result.ruleId !== invocation.ruleId) {
        throw new Error(`history mechanic ${invocation.id} has mismatched package or rule`);
      }
      const derived = committed.operations.filter((operation) => operation.causes.some((cause) =>
        cause.kind === "mechanic" && cause.id === invocation.id));
      if (contentHashForAudit(derived) !== contentHashForAudit(result.operations)) {
        throw new Error(`history mechanic ${invocation.id} does not match committed operations`);
      }
    }
    const stimulusIds = new Set(committed.reactionRequests.map((request) => request.stimulus.id));
    const observationIds = new Set<string>();
    for (const observation of committed.observations) {
      if (observationIds.has(observation.id) || observation.step !== committed.step ||
        (observation.kind === "stimulus" && !stimulusIds.has(observation.id)) ||
        (observation.kind === "outcome" && stimulusIds.has(observation.id))) {
        throw new Error(`history step ${index + 1} has invalid observation ${observation.id}`);
      }
      assertUniqueIds(observation.sourceEventIds, `history observation ${observation.id} source events`);
      observationIds.add(observation.id);
    }
    if (stimulusIds.size !== committed.reactionRequests.length ||
      [...stimulusIds].some((id) => !observationIds.has(id))) {
      throw new Error(`history step ${index + 1} does not preserve reaction stimuli`);
    }
    for (const request of committed.reactionRequests) {
      const preserved = committed.observations.find((observation) => observation.id === request.stimulus.id);
      if (JSON.stringify(preserved) !== JSON.stringify(request.stimulus)) {
        throw new Error(`history step ${index + 1} mutates reaction stimulus ${request.stimulus.id}`);
      }
    }
    for (const patch of committed.characterPatches) {
      for (const operation of patch.operations) {
        assertUniqueIds(operation.sourceObservationIds, `${operation.kind} source observations`);
        assertUniqueIds(operation.evidenceIds, `${operation.kind} evidence`);
        if (operation.sourceObservationIds.length === 0 || operation.sourceObservationIds.some((observationId) => {
          const observation = committed.observations.find((candidate) => candidate.id === observationId);
          return !observation || observation.observerId !== patch.agentId || observation.step !== committed.step;
        })) {
          throw new Error(`history step ${index + 1} has an invalid character observation basis`);
        }
      }
    }
    for (const proposalId of proposalIds) historyActionIds.add(proposalId);
    for (const checkId of requestIds) historyCheckIds.add(checkId);
    for (const randomId of randomRequestIds) historyRandomIds.add(randomId);
    for (const event of committed.events) priorEventIds.add(event.id);
    for (const operation of committed.operations) applyWorldDeltaOperation(replayState, operation);
    replayState.revision = committed.revision;
    replayState.step = committed.step;
    replayState.truth.rng = structuredClone(committed.rngAfter);
    replayState.truth.events.push(...structuredClone(committed.events));
    for (const [agentId, agent] of Object.entries(replayState.agents)) {
      if (replayState.truth.entities[agent.entityId]?.lifecycle !== "active") delete replayState.agents[agentId];
    }
  }
  if (state.truth.events.length !== priorEventIds.size ||
    state.truth.events.some((event) => !priorEventIds.has(event.id))) {
    throw new Error("world events do not match committed history");
  }
  if (state.history.length > 0 &&
    JSON.stringify(state.history.at(-1)!.rngAfter) !== JSON.stringify(state.truth.rng)) {
    throw new Error("canonical RNG does not match committed history");
  }
  if (contentHashForAudit(replayState.truth) !== contentHashForAudit(state.truth)) {
    throw new Error("canonical truth does not match replayed committed history");
  }
  const finalReplayAgentEntities = Object.fromEntries(Object.values(replayState.agents)
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((agent) => [agent.id, agent.entityId]));
  const finalAgentEntities = Object.fromEntries(Object.values(state.agents)
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((agent) => [agent.id, agent.entityId]));
  if (contentHashForAudit(finalReplayAgentEntities) !== contentHashForAudit(finalAgentEntities) ||
    replayState.player.entityId !== state.player.entityId) {
    throw new Error("runtime actor identities do not match replayed committed history");
  }
  const allowedFinal: Record<CausalRef["kind"], Set<string>> = {
    action: historyActionIds,
    check: historyCheckIds,
    random: historyRandomIds,
    event: priorEventIds,
    fact: allFactIds,
    law: lawIds,
    mechanic: new Set(state.history.flatMap((step) => step.mechanicInvocations.map((invocation) => invocation.id))),
  };
  for (const fact of Object.values(state.truth.facts)) {
    const runtimeCauses: CausalRef[] = [];
    for (const reference of fact.provenance) {
      if (reference.kind !== "world_seed") {
        runtimeCauses.push(reference);
        continue;
      }
      if (reference.id !== state.worldHash) throw new Error(`fact ${fact.id} references a different world seed`);
    }
    if (runtimeCauses.length > 0) assertResolved(runtimeCauses, allowedFinal, `fact ${fact.id}`);
  }
}

function validateModelAudit(
  audit: SimulationState["bootstrapModelAudits"][number],
  label: string,
): void {
  const exactKeys = (value: object, keys: readonly string[]): boolean => {
    const actual = Object.keys(value);
    return actual.length === keys.length && actual.every((key) => keys.includes(key));
  };
  if (!exactKeys(audit, [
    "role",
    "subjectId",
    "profileId",
    "providerId",
    "modelId",
    "catalogSchemaVersion",
    "catalogHash",
    "promptVersion",
    "inference",
    "structuredOutputMode",
    "invocations",
  ])) {
    throw new Error(`${label} has unexpected model audit fields`);
  }
  if (!new Set([
    "truth-perception",
    "truth-reaction-routing",
    "truth-resolution",
    "truth-transition",
    "causal-verifier",
    "agent-bootstrap",
    "agent-mind",
    "agent-reaction",
  ]).has(audit.role)) {
    throw new Error(`${label} has an invalid model audit role`);
  }
  if (!audit.subjectId.trim() || !audit.profileId.trim() || !audit.providerId.trim() ||
    !audit.modelId.trim() || !audit.promptVersion.trim() || audit.catalogSchemaVersion !== 2 ||
    !isSha256(audit.catalogHash) || !modelInferenceSchema.safeParse(audit.inference).success ||
    !new Set(["json-schema-strict", "json-object-zod", "deterministic-test"])
      .has(audit.structuredOutputMode)) {
    throw new Error(`${label} has an incomplete model audit identity`);
  }
  if (audit.invocations.length === 0) throw new Error(`${label} has empty model invocation data`);
  const invocationIds = new Set<string>();
  for (const [invocationIndex, invocation] of audit.invocations.entries()) {
    if (!exactKeys(invocation, [
      "id", "ordinal", "requestHash", "responseHash", "requestUtf8Bytes", "responseUtf8Bytes",
      "context", "transports", "tokenUsage", "finishReason", "providerRequestId", "resultKind",
      "semanticOutcome", "validationIssueCodes",
    ]) || !exactKeys(invocation.context, ["utf8Bytes", "sections", "counts"]) ||
      !exactKeys(invocation.context.counts, [
        "history", "events", "agents", "entities", "facts", "beliefs", "evidence", "observations",
      ]) || !exactKeys(invocation.tokenUsage, [
        "input", "output", "reasoning", "cacheRead", "cacheWrite",
      ]) || !invocation.id.trim() || invocationIds.has(invocation.id) ||
      !Number.isSafeInteger(invocation.ordinal) || invocation.ordinal !== invocationIndex + 1 ||
      !isSha256(invocation.requestHash) ||
      (invocation.responseHash !== null && !isSha256(invocation.responseHash)) ||
      !Number.isSafeInteger(invocation.requestUtf8Bytes) || invocation.requestUtf8Bytes <= 0 ||
      (invocation.responseUtf8Bytes !== null &&
        (!Number.isSafeInteger(invocation.responseUtf8Bytes) || invocation.responseUtf8Bytes < 0)) ||
      !Number.isSafeInteger(invocation.context.utf8Bytes) || invocation.context.utf8Bytes <= 0 ||
      invocation.transports.length === 0 ||
      Object.values(invocation.context.counts).some((count) => !Number.isSafeInteger(count) || count < 0) ||
      Object.values(invocation.tokenUsage).some((value) => value !== null &&
        (!Number.isSafeInteger(value) || value < 0)) ||
      (invocation.finishReason !== null && typeof invocation.finishReason !== "string") ||
      (invocation.providerRequestId !== null && typeof invocation.providerRequestId !== "string") ||
      (invocation.resultKind !== null && typeof invocation.resultKind !== "string") ||
      !new Set(["accepted", "rejected"]).has(invocation.semanticOutcome) ||
      new Set(invocation.validationIssueCodes).size !== invocation.validationIssueCodes.length ||
      invocation.validationIssueCodes.some((code) => typeof code !== "string" || !code.trim()) ||
      (invocation.semanticOutcome === "accepted" && invocation.validationIssueCodes.length > 0) ||
      (invocation.semanticOutcome === "rejected" && invocation.validationIssueCodes.length === 0)) {
      throw new Error(`${label} has invalid model invocation identity, bytes, or outcome`);
    }
    invocationIds.add(invocation.id);
    for (const section of Object.values(invocation.context.sections)) {
      if (!exactKeys(section, ["utf8Bytes", "itemCount"]) ||
        !Number.isSafeInteger(section.utf8Bytes) || section.utf8Bytes < 0 ||
        (section.itemCount !== null && (!Number.isSafeInteger(section.itemCount) || section.itemCount < 0))) {
        throw new Error(`${label} has invalid model context sections`);
      }
    }
    invocation.transports.forEach((transport, index) => {
      if (!exactKeys(transport, [
        "attempt", "queueWaitMs", "executionMs", "retryDelayMs", "status", "errorName", "statusCode",
      ]) || transport.attempt !== index + 1 ||
        !Number.isSafeInteger(transport.queueWaitMs) || transport.queueWaitMs < 0 ||
        !Number.isSafeInteger(transport.executionMs) || transport.executionMs < 0 ||
        !Number.isSafeInteger(transport.retryDelayMs) || transport.retryDelayMs < 0 ||
        !new Set(["succeeded", "retryable_error", "failed"]).has(transport.status) ||
        (transport.status === "succeeded" && (transport.errorName !== null || transport.statusCode !== null)) ||
        (transport.status !== "succeeded" && !transport.errorName) ||
        (transport.statusCode !== null &&
          (!Number.isSafeInteger(transport.statusCode) || transport.statusCode < 100))) {
        throw new Error(`${label} has invalid model transport attempts`);
      }
    });
  }
}

export function validateSimulationState(
  state: SimulationState,
  requireNextActions = false,
  requireHistoryAlignment = false,
): void {
  if (state.schemaVersion !== 7 || !state.worldId.trim() || !/^sha256:[a-f0-9]{64}$/.test(state.worldHash)) {
    throw new Error("invalid simulation identity");
  }
  assertSafeId(state.worldId, "world id");
  if (state.lawIds.length === 0 || new Set(state.lawIds).size !== state.lawIds.length ||
    state.lawIds.some((lawId) => !lawId.trim())) throw new Error("invalid world law ids");
  for (const lawId of state.lawIds) assertSafeId(lawId, "world law id");
  if (!Number.isSafeInteger(state.revision) || state.revision < 0) throw new Error("invalid revision");
  if (!Number.isSafeInteger(state.step) || state.step < 0) throw new Error("invalid step");
  if (!Number.isSafeInteger(state.truth.elapsedSeconds) || state.truth.elapsedSeconds < 0) {
    throw new Error("invalid elapsed time");
  }
  if (!state.truth.entities[state.player.entityId]) throw new Error("player entity is missing");
  if (state.player.intent) {
    const { intent } = state.player;
    if (!intent.id.trim() || !intent.goal.trim() || !intent.latestInput.id.trim() ||
      !intent.latestInput.text.trim() || !Number.isSafeInteger(intent.latestInput.submittedAtStep) ||
      intent.latestInput.submittedAtStep < intent.startedAtStep || intent.latestInput.submittedAtStep > state.step ||
      !Number.isSafeInteger(intent.startedAtStep) || intent.startedAtStep < 0 || intent.startedAtStep > state.step ||
      !playerIntentStatuses.has(intent.status) || !playerInputKinds.has(intent.latestInput.kind) ||
      (intent.latestInput.kind === "goal" &&
        (intent.latestInput.text !== intent.goal || intent.latestInput.submittedAtStep !== intent.startedAtStep))) {
      throw new Error("invalid player intent");
    }
    assertSafeId(intent.id, "player intent id");
    assertSafeId(intent.latestInput.id, "player intent input id");
  }
  for (const audit of state.bootstrapModelAudits) {
    validateModelAudit(audit, "bootstrap");
    if (audit.role !== "agent-bootstrap") throw new Error("bootstrap has a non-bootstrap audit");
  }
  if (!Number.isSafeInteger(state.truth.rng.seed) || !Number.isSafeInteger(state.truth.rng.state) ||
    !Number.isSafeInteger(state.truth.rng.draws) || state.truth.rng.seed < 0 || state.truth.rng.state < 0 ||
    state.truth.rng.draws < 0 || state.truth.rng.seed > 0xffffffff || state.truth.rng.state > 0xffffffff) {
    throw new Error("invalid RNG state");
  }

  validatePlacementCycles(state);
  for (const [definitionId, definition] of Object.entries(state.truth.mechanics.meters)) {
    assertSafeId(definitionId, "meter definition id");
    if (definition.id !== definitionId || !Number.isFinite(definition.min) ||
      !Number.isFinite(definition.max) || definition.max <= definition.min) {
      throw new Error(`invalid meter definition ${definitionId}`);
    }
    const thresholdIds = new Set<string>();
    for (const threshold of definition.thresholds) {
      if (thresholdIds.has(threshold.id) || threshold.when.value < definition.min ||
        threshold.when.value > definition.max) {
        throw new Error(`invalid threshold ${threshold.id} for ${definitionId}`);
      }
      thresholdIds.add(threshold.id);
    }
  }
  for (const [definitionId, definition] of Object.entries(state.truth.mechanics.quantities)) {
    assertSafeId(definitionId, "quantity definition id");
    if (definition.id !== definitionId || !definition.name.trim() || !definition.unit.trim()) {
      throw new Error(`invalid quantity definition ${definitionId}`);
    }
    assertUniqueIds(definition.productionLawIds, `quantity ${definitionId} production laws`);
    assertUniqueIds(definition.consumptionLawIds, `quantity ${definitionId} consumption laws`);
    for (const lawId of [...definition.productionLawIds, ...definition.consumptionLawIds]) {
      if (!state.lawIds.includes(lawId)) throw new Error(`quantity ${definitionId} references unknown law ${lawId}`);
    }
  }
  for (const [definitionId, definition] of Object.entries(state.truth.mechanics.ratings)) {
    assertSafeId(definitionId, "rating definition id");
    if (definition.id !== definitionId || !Number.isFinite(definition.min) ||
      !Number.isFinite(definition.max) || definition.max < definition.min) {
      throw new Error(`invalid rating definition ${definitionId}`);
    }
  }
  for (const [entityId, entity] of Object.entries(state.truth.entities)) {
    assertSafeId(entityId, "entity id");
    assertSafeId(entity.id, "entity embedded id");
    if (entity.id !== entityId) throw new Error(`entity key does not match ${entity.id}`);
  }
  for (const [factId, fact] of Object.entries(state.truth.facts)) {
    assertSafeId(factId, "fact id");
    assertSafeId(fact.id, "fact embedded id");
    assertSafeId(fact.subjectId, `fact ${factId} subject`);
    if (fact.id !== factId) throw new Error(`fact key does not match ${fact.id}`);
    if (!state.truth.entities[fact.subjectId]) throw new Error(`unknown fact subject ${fact.subjectId}`);
    assertFactValueReferences(fact.value, state, `fact ${fact.id}`);
    if (fact.provenance.length === 0) throw new Error(`fact ${fact.id} has no provenance`);
    if (fact.access.kind === "agents") {
      assertUniqueIds(fact.access.agentIds, `fact ${fact.id} access`);
      for (const agentId of fact.access.agentIds) {
        if (!state.agents[agentId]) throw new Error(`fact ${fact.id} grants access to unknown agent ${agentId}`);
      }
    }
  }
  for (const [meterId, meter] of Object.entries(state.truth.meters)) {
    assertSafeId(meterId, "meter id");
    assertSafeId(meter.definitionId, `meter ${meterId} definition`);
    assertSafeId(meter.entityId, `meter ${meterId} entity`);
    if (meter.id !== meterId) throw new Error(`meter key does not match ${meter.id}`);
    validateMeter(state, meter);
  }
  for (const [quantityId, quantity] of Object.entries(state.truth.quantities)) {
    assertSafeId(quantityId, "quantity id");
    assertSafeId(quantity.definitionId, `quantity ${quantityId} definition`);
    assertSafeId(quantity.holderId, `quantity ${quantityId} holder`);
    if (quantity.id !== quantityId || quantity.id !== quantityKey(quantity.definitionId, quantity.holderId)) {
      throw new Error(`invalid quantity identity ${quantityId}`);
    }
    if (!state.truth.mechanics.quantities[quantity.definitionId]) {
      throw new Error(`unknown quantity definition ${quantity.definitionId}`);
    }
    if (!state.truth.entities[quantity.holderId]) throw new Error(`unknown quantity holder ${quantity.holderId}`);
    if (!Number.isFinite(quantity.amount) || quantity.amount < 0) throw new Error(`invalid quantity ${quantity.id}`);
  }
  for (const [id, rating] of Object.entries(state.truth.ratings)) {
    assertSafeId(id, "rating id");
    assertSafeId(rating.definitionId, `rating ${id} definition`);
    assertSafeId(rating.entityId, `rating ${id} entity`);
    if (rating.id !== id) throw new Error(`rating key does not match ${rating.id}`);
    validateRating(state, id);
  }

  const agentEntities = new Set<string>();
  for (const [agentId, agent] of Object.entries(state.agents)) {
    assertSafeId(agentId, "agent id");
    assertSafeId(agent.entityId, `agent ${agentId} entity`);
    for (const profileId of Object.values(agent.modelProfiles)) {
      assertSafeId(profileId, `agent ${agentId} model profile`);
    }
    if (agent.id !== agentId) throw new Error(`agent key does not match ${agent.id}`);
    const entity = state.truth.entities[agent.entityId];
    if (!entity) throw new Error(`agent ${agent.id} has no entity`);
    if (entity.lifecycle !== "active") throw new Error(`agent ${agent.id} belongs to a retired entity`);
    if (agentEntities.has(agent.entityId)) throw new Error(`multiple agents own entity ${agent.entityId}`);
    agentEntities.add(agent.entityId);
    validateBelief(agent.belief, agent.bindings, state, `agent ${agent.id}`);
    const selfBindings = Object.values(agent.bindings)
      .filter((binding) => binding.canonicalEntityIds.includes(agent.entityId));
    if (selfBindings.length !== 1) throw new Error(`agent ${agent.id} must have exactly one self binding`);
    validateCharacterState(agent.character, agent.belief, state.step, `agent ${agent.id}`);
    if (requireNextActions && !agent.nextAction) throw new Error(`agent ${agent.id} has no next action`);
    if (agent.nextAction && agent.nextAction.actorId !== agent.id) {
      throw new Error(`agent ${agent.id} owns action for ${agent.nextAction.actorId}`);
    }
    if (requireNextActions && agent.nextAction && agent.nextAction.baseRevision !== state.revision) {
      throw new Error(`agent ${agent.id} has an action for revision ${agent.nextAction.baseRevision}`);
    }
    if (requireNextActions && agent.nextAction) {
      assertUniqueIds(agent.nextAction.targetIds, `agent ${agent.id} action targets`);
      for (const targetId of agent.nextAction.targetIds) {
        if (!agent.belief.localEntities[targetId]) {
          throw new Error(`agent ${agent.id} targets unknown local entity ${targetId}`);
        }
      }
    }
  }
  validatePlayerKnowledge(state);
  const eventIds = new Set<string>();
  for (const event of state.truth.events) {
    if (eventIds.has(event.id)) throw new Error(`duplicate world event ${event.id}`);
    if (!Number.isSafeInteger(event.step) || event.step < 1 || event.step > state.step) {
      throw new Error(`world event ${event.id} has invalid step`);
    }
    if (!new Set(["ordinary", "significant", "transformative"]).has(event.impact)) {
      throw new Error(`world event ${event.id} has invalid impact`);
    }
    assertCauses(event.causes, `event ${event.id}`);
    if (event.assertions.length === 0) throw new Error(`event ${event.id} has no causal assertions`);
    eventIds.add(event.id);
  }
  if (requireHistoryAlignment) validateHistory(state);
}

export function applyTransitionProposal(
  source: SimulationState,
  proposal: TransitionProposal,
): SimulationState {
  const issues: string[] = [];
  if (proposal.baseRevision !== source.revision) {
    issues.push(`stale proposal revision ${proposal.baseRevision}; expected ${source.revision}`);
  }
  const next = structuredClone(source);
  if (issues.length === 0) {
    for (const operation of proposal.operations) {
      try {
        applyWorldDeltaOperation(next, operation);
      } catch (error) {
        issues.push(error instanceof Error ? error.message : String(error));
        break;
      }
    }
  }
  if (issues.length === 0) {
    try {
      next.revision += 1;
      next.step += 1;
      if (next.player.intent) next.player.intent.status = proposal.intentStatus;
      next.truth.events.push(...structuredClone(proposal.events));
      for (const [agentId, agent] of Object.entries(next.agents)) {
        if (next.truth.entities[agent.entityId]?.lifecycle !== "active") delete next.agents[agentId];
      }
      validateSimulationState(next, false);
    } catch (error) {
      issues.push(error instanceof Error ? error.message : String(error));
    }
  }
  if (issues.length > 0) throw new TransitionValidationError(issues);
  return next;
}

export function createEmptyBelief(): AgentState["belief"] {
  return { localEntities: {}, claims: {}, evidence: {} };
}

export function createEmptyCharacter(summary: string, voice = ""): AgentState["character"] {
  if (!summary.trim()) throw new Error("character persona summary cannot be empty");
  return {
    persona: { summary, voice, updatedAtStep: 0, evidenceIds: [] },
    traits: {},
    values: {},
    emotions: {},
    attitudes: {},
    goals: {},
    commitments: {},
  };
}
