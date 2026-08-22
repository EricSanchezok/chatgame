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
  }
}

function assertFactValueReferences(value: FactValue, state: SimulationState, label: string): void {
  if (value.kind === "entity" && !state.truth.entities[value.entityId]) {
    throw new Error(`${label} references unknown entity ${value.entityId}`);
  }
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
        provenance: [...causes, { kind: "law", id: threshold.id }],
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

function applyOperation(state: SimulationState, operation: WorldDeltaOperation): void {
  assertCauses(operation.causes, operation.kind);
  switch (operation.kind) {
    case "create_entity":
      if (state.truth.entities[operation.entity.id]) throw new Error(`entity already exists: ${operation.entity.id}`);
      if (operation.placementId && !state.truth.entities[operation.placementId]) {
        throw new Error(`unknown placement ${operation.placementId}`);
      }
      state.truth.entities[operation.entity.id] = structuredClone(operation.entity);
      state.truth.placements[operation.entity.id] = operation.placementId;
      return;
    case "retire_entity":
      if (!state.truth.entities[operation.entityId]) throw new Error(`unknown entity ${operation.entityId}`);
      state.truth.entities[operation.entityId].lifecycle = "retired";
      return;
    case "place_entity":
      if (!state.truth.entities[operation.entityId]) throw new Error(`unknown entity ${operation.entityId}`);
      if (operation.placementId && !state.truth.entities[operation.placementId]) {
        throw new Error(`unknown placement ${operation.placementId}`);
      }
      if (operation.entityId === operation.placementId) throw new Error("entity cannot contain itself");
      state.truth.placements[operation.entityId] = operation.placementId;
      return;
    case "set_fact":
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
      if (!state.truth.facts[operation.factId]) throw new Error(`unknown fact ${operation.factId}`);
      delete state.truth.facts[operation.factId];
      return;
    case "set_meter":
      state.truth.meters[operation.meter.id] = structuredClone(operation.meter);
      validateMeter(state, state.truth.meters[operation.meter.id]);
      applyThresholds(state, state.truth.meters[operation.meter.id], operation.causes);
      return;
    case "adjust_meter": {
      const meter = state.truth.meters[operation.meterId];
      if (!meter) throw new Error(`unknown meter ${operation.meterId}`);
      meter.current += operation.amount;
      validateMeter(state, meter);
      applyThresholds(state, meter, operation.causes);
      return;
    }
    case "transfer_quantity": {
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
      const definition = state.truth.mechanics.quantities[operation.definitionId];
      if (!definition?.allowProduction) throw new Error(`production is not allowed for ${operation.definitionId}`);
      if (!operation.lawId.trim()) throw new Error("production requires a law id");
      if (!state.truth.entities[operation.holderId]) throw new Error(`unknown holder ${operation.holderId}`);
      if (!Number.isFinite(operation.amount) || operation.amount <= 0) throw new Error("production amount must be positive");
      getOrCreateQuantity(state, operation.definitionId, operation.holderId).amount += operation.amount;
      return;
    }
    case "consume_quantity": {
      const definition = state.truth.mechanics.quantities[operation.definitionId];
      if (!definition?.allowConsumption) throw new Error(`consumption is not allowed for ${operation.definitionId}`);
      if (!operation.lawId.trim()) throw new Error("consumption requires a law id");
      if (!Number.isFinite(operation.amount) || operation.amount <= 0) throw new Error("consumption amount must be positive");
      const quantity = getOrCreateQuantity(state, operation.definitionId, operation.holderId);
      if (quantity.amount < operation.amount) throw new Error(`insufficient ${definition.name}`);
      quantity.amount -= operation.amount;
      return;
    }
    case "set_rating":
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
      if (state.agents[operation.agent.id]) throw new Error(`agent already exists: ${operation.agent.id}`);
      if (!state.truth.entities[operation.agent.entityId]) throw new Error(`unknown agent entity ${operation.agent.entityId}`);
      state.agents[operation.agent.id] = structuredClone(operation.agent);
      return;
    case "remove_agent":
      if (!state.agents[operation.agentId]) throw new Error(`unknown agent ${operation.agentId}`);
      delete state.agents[operation.agentId];
      return;
  }
}

function validatePlacementCycles(state: SimulationState): void {
  for (const placementId of Object.keys(state.truth.placements)) {
    if (!state.truth.entities[placementId]) throw new Error(`placement belongs to unknown entity ${placementId}`);
  }
  for (const entityId of Object.keys(state.truth.entities)) {
    if (!(entityId in state.truth.placements)) throw new Error(`entity ${entityId} has no placement entry`);
    const visited = new Set<string>([entityId]);
    let current = state.truth.placements[entityId];
    while (current) {
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
    if (entity.id !== id) throw new Error(`${label} local entity key does not match ${entity.id}`);
  }
  for (const [id, evidence] of Object.entries(belief.evidence)) {
    if (evidence.id !== id) throw new Error(`${label} evidence key does not match ${evidence.id}`);
    if (!Number.isSafeInteger(evidence.step) || evidence.step < 0 || evidence.step > state.step) {
      throw new Error(`${label} evidence ${id} has invalid step`);
    }
  }
  const validateClaim = (id: string, claim: BeliefClaim): void => {
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
  };
  for (const [id, claim] of Object.entries(belief.claims)) validateClaim(id, claim);
  for (const [id, binding] of Object.entries(bindings)) {
    if (binding.localEntityId !== id || !belief.localEntities[id]) {
      throw new Error(`${label} has invalid binding ${id}`);
    }
    for (const canonicalId of binding.canonicalEntityIds) {
      if (!state.truth.entities[canonicalId]) throw new Error(`${label} binding ${id} has unknown canonical entity`);
    }
  }
}

function validatePlayerKnowledge(state: SimulationState): void {
  const knowledge = state.player.knowledge;
  for (const [id, entity] of Object.entries(knowledge.localEntities)) {
    if (entity.id !== id) throw new Error(`player local entity key does not match ${entity.id}`);
  }
  for (const [id, evidence] of Object.entries(knowledge.evidence)) {
    if (evidence.id !== id) throw new Error(`player evidence key does not match ${evidence.id}`);
    if (!Number.isSafeInteger(evidence.step) || evidence.step < 0 || evidence.step > state.step) {
      throw new Error(`player evidence ${id} has invalid step`);
    }
  }
  for (const [id, claim] of Object.entries(knowledge.claims)) {
    if (claim.id !== id) throw new Error(`player claim key does not match ${claim.id}`);
    if (!knowledge.localEntities[claim.subjectId]) throw new Error(`player claim ${id} has unknown subject`);
    if (claim.value.kind === "local_entity" && !knowledge.localEntities[claim.value.localEntityId]) {
      throw new Error(`player claim ${id} has unknown local value`);
    }
    for (const evidenceId of claim.evidenceIds) {
      if (!knowledge.evidence[evidenceId]) throw new Error(`player claim ${id} has unknown evidence ${evidenceId}`);
    }
  }
  for (const observationId of knowledge.observationIds) {
    if (!knowledge.evidence[`observation:${observationId}`]) {
      throw new Error(`player observation ${observationId} has no evidence`);
    }
  }
  for (const [id, binding] of Object.entries(state.player.bindings)) {
    if (binding.localEntityId !== id || !knowledge.localEntities[id]) {
      throw new Error(`player has invalid binding ${id}`);
    }
    for (const canonicalId of binding.canonicalEntityIds) {
      if (!state.truth.entities[canonicalId]) throw new Error(`player binding ${id} has unknown canonical entity`);
    }
  }
}

function validateHistory(state: SimulationState): void {
  if (state.history.length !== state.revision || state.step !== state.revision) {
    throw new Error("history, revision and step are not aligned");
  }
  for (let index = 0; index < state.history.length; index += 1) {
    const committed = state.history[index];
    if (committed.baseRevision !== index || committed.revision !== index + 1 || committed.step !== index + 1) {
      throw new Error(`history step ${index + 1} has invalid revision metadata`);
    }
    const proposalIds = committed.actions.map((action) => action.id);
    const outcomeIds = committed.outcomes.map((outcome) => outcome.proposalId);
    if (new Set(proposalIds).size !== proposalIds.length || new Set(outcomeIds).size !== outcomeIds.length) {
      throw new Error(`history step ${index + 1} has duplicate actions or outcomes`);
    }
    if (proposalIds.length !== outcomeIds.length || proposalIds.some((id) => !outcomeIds.includes(id))) {
      throw new Error(`history step ${index + 1} does not cover every action`);
    }
    if (committed.actions.some((action) => action.baseRevision !== committed.baseRevision)) {
      throw new Error(`history step ${index + 1} contains a stale action`);
    }
    if (committed.operations.filter((operation) => operation.kind === "advance_time").length !== 1) {
      throw new Error(`history step ${index + 1} has invalid time advancement`);
    }
  }
}

export function validateSimulationState(
  state: SimulationState,
  requireNextActions = false,
  requireHistoryAlignment = false,
): void {
  if (state.schemaVersion !== 1 || !state.worldId.trim()) throw new Error("invalid simulation identity");
  if (!Number.isSafeInteger(state.revision) || state.revision < 0) throw new Error("invalid revision");
  if (!Number.isSafeInteger(state.step) || state.step < 0) throw new Error("invalid step");
  if (!Number.isSafeInteger(state.truth.elapsedSeconds) || state.truth.elapsedSeconds < 0) {
    throw new Error("invalid elapsed time");
  }
  if (!state.truth.entities[state.player.entityId]) throw new Error("player entity is missing");
  if (!Number.isSafeInteger(state.rng.seed) || !Number.isSafeInteger(state.rng.state) ||
    !Number.isSafeInteger(state.rng.draws) || state.rng.seed < 0 || state.rng.state < 0 || state.rng.draws < 0 ||
    state.rng.seed > 0xffffffff || state.rng.state > 0xffffffff) {
    throw new Error("invalid RNG state");
  }

  validatePlacementCycles(state);
  for (const [definitionId, definition] of Object.entries(state.truth.mechanics.meters)) {
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
    if (definition.id !== definitionId || !definition.name.trim() || !definition.unit.trim()) {
      throw new Error(`invalid quantity definition ${definitionId}`);
    }
  }
  for (const [definitionId, definition] of Object.entries(state.truth.mechanics.ratings)) {
    if (definition.id !== definitionId || !Number.isFinite(definition.min) ||
      !Number.isFinite(definition.max) || definition.max < definition.min) {
      throw new Error(`invalid rating definition ${definitionId}`);
    }
  }
  for (const [entityId, entity] of Object.entries(state.truth.entities)) {
    if (entity.id !== entityId) throw new Error(`entity key does not match ${entity.id}`);
  }
  for (const [factId, fact] of Object.entries(state.truth.facts)) {
    if (fact.id !== factId) throw new Error(`fact key does not match ${fact.id}`);
    if (!state.truth.entities[fact.subjectId]) throw new Error(`unknown fact subject ${fact.subjectId}`);
    assertFactValueReferences(fact.value, state, `fact ${fact.id}`);
    if (fact.provenance.length === 0) throw new Error(`fact ${fact.id} has no provenance`);
  }
  for (const [meterId, meter] of Object.entries(state.truth.meters)) {
    if (meter.id !== meterId) throw new Error(`meter key does not match ${meter.id}`);
    validateMeter(state, meter);
  }
  for (const [quantityId, quantity] of Object.entries(state.truth.quantities)) {
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
    if (rating.id !== id) throw new Error(`rating key does not match ${rating.id}`);
    validateRating(state, id);
  }

  const agentEntities = new Set<string>();
  for (const [agentId, agent] of Object.entries(state.agents)) {
    if (agent.id !== agentId) throw new Error(`agent key does not match ${agent.id}`);
    const entity = state.truth.entities[agent.entityId];
    if (!entity) throw new Error(`agent ${agent.id} has no entity`);
    if (entity.lifecycle !== "active") throw new Error(`agent ${agent.id} belongs to a retired entity`);
    if (agentEntities.has(agent.entityId)) throw new Error(`multiple agents own entity ${agent.entityId}`);
    agentEntities.add(agent.entityId);
    validateBelief(agent.belief, agent.bindings, state, `agent ${agent.id}`);
    if (requireNextActions && !agent.nextAction) throw new Error(`agent ${agent.id} has no next action`);
    if (agent.nextAction && agent.nextAction.actorId !== agent.id) {
      throw new Error(`agent ${agent.id} owns action for ${agent.nextAction.actorId}`);
    }
    if (requireNextActions && agent.nextAction && agent.nextAction.baseRevision !== state.revision) {
      throw new Error(`agent ${agent.id} has an action for revision ${agent.nextAction.baseRevision}`);
    }
    if (requireNextActions && agent.nextAction) {
      for (const targetId of agent.nextAction.targetIds) {
        if (!agent.belief.localEntities[targetId]) {
          throw new Error(`agent ${agent.id} targets unknown local entity ${targetId}`);
        }
      }
    }
  }
  validatePlayerKnowledge(state);
  const eventIds = new Set<string>();
  for (const event of state.events) {
    if (eventIds.has(event.id)) throw new Error(`duplicate world event ${event.id}`);
    if (!Number.isSafeInteger(event.step) || event.step < 1 || event.step > state.step) {
      throw new Error(`world event ${event.id} has invalid step`);
    }
    assertCauses(event.causes, `event ${event.id}`);
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
        applyOperation(next, operation);
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
      next.events.push(...structuredClone(proposal.events));
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
