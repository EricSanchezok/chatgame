import { z } from "zod";
import type {
  AgentBeliefState,
  AgentState,
  BeliefClaim,
  CausalRef,
  CommittedStep,
  FactValue,
  MeterState,
  QuantityState,
  SimulationState,
  TransitionProposal,
  WorldDeltaOperation,
} from "./model";
import { validateCharacterState } from "./character";
import {
  beliefPatchSchema,
  causalAssertionResultSchema,
  causalVerificationSchema,
  characterPatchSchema,
  mechanicResultSchema,
  persistedTransitionProposalSchema,
  persistedCheckRequestSchema,
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
import { applyMindCommit } from "./mind-commit";
import {
  applyObservationBindings,
  applyPlayerObservationBindings,
  ingestPlayerObservations,
} from "./observation";
import { isRuntimeId, quantityId, runtimeId } from "./runtime-id";
import {
  actionProposalSchema,
  agentStateSchema,
  commitmentRoundsSchema,
  discreteRandomRequestSchema,
  discreteRandomResultSchema,
  d20CheckResultSchema,
  isSemanticId,
  isSafeId,
  entitySchema,
  meterSchema,
  localEntitySchema,
  persistedEvidenceSchema,
  persistedFactSchema,
  quantityStateSchema,
  ratingSchema,
} from "./state-schemas";

const playerIntentStatuses = new Set(["active", "completed", "failed", "cancelled"]);
const playerInputKinds = new Set(["goal", "clarification"]);

function assertSafeId(value: string, label: string): void {
  if (!isSafeId(value)) throw new Error(`${label} uses a reserved object key`);
}

function assertSemanticId(value: string, label: string): void {
  assertSafeId(value, label);
  if (!isSemanticId(value)) throw new Error(`${label} is not a valid semantic id`);
}

function assertUniqueIds(ids: readonly string[], label: string): void {
  if (new Set(ids).size !== ids.length) throw new Error(`${label} contains duplicate ids`);
}

function assertExactKeys(
  value: object,
  required: readonly string[],
  optional: readonly string[] = [],
  label = "object",
): void {
  const actual = Object.keys(value);
  const allowed = new Set([...required, ...optional]);
  if (required.some((key) => !actual.includes(key)) || actual.some((key) => !allowed.has(key))) {
    throw new Error(`${label} has unexpected or missing fields`);
  }
}

function validatePlayerIntentSnapshot(
  intent: NonNullable<SimulationState["player"]["intent"]>,
  maxStep: number,
  label = "player intent",
): void {
  assertExactKeys(intent, ["id", "goal", "inputs", "latestInput", "status", "startedAtStep"], [], label);
  if (!intent.id.trim() || !intent.goal.trim() || !Number.isSafeInteger(intent.startedAtStep) ||
    intent.startedAtStep < 0 || intent.startedAtStep > maxStep || !playerIntentStatuses.has(intent.status) ||
    intent.inputs.length === 0) {
    throw new Error(`invalid ${label}`);
  }
  assertSafeId(intent.id, `${label} id`);
  const inputIds = new Set<string>();
  for (const [index, input] of intent.inputs.entries()) {
    assertExactKeys(input, ["id", "text", "kind", "submittedAtStep"], [], `${label} input ${index + 1}`);
    if (!input.id.trim() || !input.text.trim() || inputIds.has(input.id) ||
      !Number.isSafeInteger(input.submittedAtStep) || input.submittedAtStep < intent.startedAtStep ||
      input.submittedAtStep > maxStep || !playerInputKinds.has(input.kind) ||
      (index === 0 && (input.kind !== "goal" || input.text !== intent.goal ||
        input.submittedAtStep !== intent.startedAtStep)) ||
      (index > 0 && input.kind !== "clarification") ||
      (index > 0 && input.submittedAtStep < intent.inputs[index - 1].submittedAtStep)) {
      throw new Error(`invalid ${label} input ledger`);
    }
    assertSafeId(input.id, `${label} input id`);
    inputIds.add(input.id);
  }
  if (contentHashForAudit(intent.latestInput) !== contentHashForAudit(intent.inputs.at(-1)!)) {
    throw new Error(`${label} latest input does not match its immutable ledger`);
  }
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

function quantityKey(state: SimulationState, definitionId: string, holderId: string): string {
  return quantityId(state.worldHash, definitionId, holderId);
}

function getOrCreateQuantity(
  state: SimulationState,
  definitionId: string,
  holderId: string,
): QuantityState {
  const id = quantityKey(state, definitionId, holderId);
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
  for (const [thresholdOrdinal, threshold] of definition.thresholds.entries()) {
    if (meter.firedThresholdIds.includes(threshold.id)) continue;
    if (!thresholdReached(meter, threshold.when.operator, threshold.when.value)) continue;
    meter.firedThresholdIds.push(threshold.id);
    for (const [effectOrdinal, effect] of threshold.effects.entries()) {
      if (effect.kind === "set_lifecycle") {
        state.truth.entities[meter.entityId].lifecycle = effect.lifecycle;
        continue;
      }
      const id = runtimeId({
        worldHash: state.worldHash,
        revision: state.revision,
        kind: "fact",
        stage: "meter-threshold",
        owner: [meter.id, threshold.id, effect.predicate],
        round: thresholdOrdinal,
        ordinal: effectOrdinal,
      });
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

function historicalAgentBindings(state: SimulationState): Map<string, string> {
  const bindings = new Map<string, string>();
  for (const [agentId, agent] of Object.entries(state.historyBase?.agents ?? {})) {
    bindings.set(agentId, agent.entityId);
  }
  for (const [agentId, agent] of Object.entries(state.agents)) bindings.set(agentId, agent.entityId);
  for (const step of state.history) {
    for (const operation of step.operations) {
      if (operation.kind === "create_agent") bindings.set(operation.agent.id, operation.agent.entityId);
    }
  }
  return bindings;
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
      assertSemanticId(operation.entity.id, "entity id");
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
      assertSemanticId(operation.fact.id, "fact id");
      if (state.truth.factTombstones.includes(operation.fact.id)) {
        throw new Error(`fact identity is tombstoned: ${operation.fact.id}`);
      }
      assertSafeId(operation.fact.subjectId, "fact subject id");
      if (!state.truth.entities[operation.fact.subjectId]) {
        throw new Error(`unknown fact subject ${operation.fact.subjectId}`);
      }
      assertFactValueReferences(operation.fact.value, state, `fact ${operation.fact.id}`);
      if (state.truth.facts[operation.fact.id] &&
        (state.truth.facts[operation.fact.id].subjectId !== operation.fact.subjectId ||
          state.truth.facts[operation.fact.id].predicate !== operation.fact.predicate)) {
        throw new Error(`fact ${operation.fact.id} cannot change identity`);
      }
      state.truth.facts[operation.fact.id] = {
        ...structuredClone(operation.fact),
        provenance: structuredClone(operation.causes),
      };
      return;
    case "remove_fact":
      assertSafeId(operation.factId, "removed fact id");
      if (!state.truth.facts[operation.factId]) throw new Error(`unknown fact ${operation.factId}`);
      delete state.truth.facts[operation.factId];
      state.truth.factTombstones.push(operation.factId);
      return;
    case "set_meter":
      assertSemanticId(operation.meter.id, "meter id");
      assertSafeId(operation.meter.definitionId, "meter definition id");
      assertSafeId(operation.meter.entityId, "meter entity id");
      if (state.truth.meters[operation.meter.id] &&
        (state.truth.meters[operation.meter.id].definitionId !== operation.meter.definitionId ||
          state.truth.meters[operation.meter.id].entityId !== operation.meter.entityId)) {
        throw new Error(`meter ${operation.meter.id} cannot change identity`);
      }
      if (state.truth.meters[operation.meter.id] &&
        JSON.stringify(state.truth.meters[operation.meter.id].firedThresholdIds) !==
          JSON.stringify(operation.meter.firedThresholdIds)) {
        throw new Error(`meter ${operation.meter.id} threshold ledger is engine-owned`);
      }
      if (!state.truth.meters[operation.meter.id] && operation.meter.firedThresholdIds.length > 0) {
        throw new Error(`new meter ${operation.meter.id} cannot pre-fire thresholds`);
      }
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
      assertSemanticId(operation.rating.id, "rating id");
      assertSafeId(operation.rating.definitionId, "rating definition id");
      assertSafeId(operation.rating.entityId, "rating entity id");
      if (state.truth.ratings[operation.rating.id] &&
        (state.truth.ratings[operation.rating.id].definitionId !== operation.rating.definitionId ||
          state.truth.ratings[operation.rating.id].entityId !== operation.rating.entityId)) {
        throw new Error(`rating ${operation.rating.id} cannot change identity`);
      }
      state.truth.ratings[operation.rating.id] = structuredClone(operation.rating);
      validateRating(state, operation.rating.id);
      return;
    case "advance_time":
      if (!Number.isSafeInteger(operation.seconds) || operation.seconds <= 0) {
        throw new Error("time advance must be a positive whole number of seconds");
      }
      state.truth.elapsedSeconds += operation.seconds;
      return;
    case "create_agent": {
      assertSemanticId(operation.agent.id, "agent id");
      assertSafeId(operation.agent.entityId, "agent entity id");
      for (const profileId of Object.values(operation.agent.modelProfiles)) {
        assertSafeId(profileId, "agent model profile id");
      }
      if (operation.agent.id === "player") throw new Error("agent id player is reserved");
      if (operation.agent.entityId === state.player.entityId) throw new Error("agent cannot bind the player entity");
      const historicalBindings = historicalAgentBindings(state);
      if (historicalBindings.has(operation.agent.id)) {
        throw new Error(`agent identity was already used: ${operation.agent.id}`);
      }
      if ([...historicalBindings.values()].includes(operation.agent.entityId)) {
        throw new Error(`agent entity was already bound: ${operation.agent.entityId}`);
      }
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
    }
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
    localEntitySchema.parse(entity);
    assertSafeId(id, "player local entity id");
    if (entity.id !== id) throw new Error(`player local entity key does not match ${entity.id}`);
    if (state.truth.entities[id]) throw new Error(`player local entity ${id} collides with canonical identity`);
  }
  for (const [id, evidence] of Object.entries(knowledge.evidence)) {
    persistedEvidenceSchema.parse(evidence);
    assertSafeId(id, "player evidence id");
    if (evidence.id !== id) throw new Error(`player evidence key does not match ${evidence.id}`);
    if (!Number.isSafeInteger(evidence.step) || evidence.step < 0 || evidence.step > state.step) {
      throw new Error(`player evidence ${id} has invalid step`);
    }
  }
  for (const [id, claim] of Object.entries(knowledge.claims)) {
    assertExactKeys(
      claim,
      ["id", "subjectId", "predicate", "value", "description", "evidenceIds"],
      [],
      `player claim ${id}`,
    );
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
    if (!Object.values(knowledge.evidence).some((evidence) =>
      evidence.kind === "observation" && evidence.sourceId === observationId)) {
      throw new Error(`player observation ${observationId} has no evidence`);
    }
  }
  assertUniqueIds(knowledge.observationIds, "player observations");
  for (const [id, binding] of Object.entries(state.player.bindings)) {
    assertExactKeys(binding, ["localEntityId", "canonicalEntityIds"], [], `player binding ${id}`);
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

export interface HistoryReplayVisitor {
  base?(replayedState: Readonly<SimulationState>): void;
  commit?(replayedState: Readonly<SimulationState>, committed: Readonly<CommittedStep>): void;
}

export function replayCommittedHistory(
  state: SimulationState,
  visit?: HistoryReplayVisitor,
): void {
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
  assertSafeId(historyBase.player.entityId, "history replay player entity");
  if (!historyBase.truth.entities[historyBase.player.entityId]) {
    throw new Error("history replay player has no entity");
  }
  const replayAgentEntities = new Set<string>();
  const replayAgents = Object.fromEntries(Object.entries(historyBase.agents).map(([agentId, agent]) => {
    assertSafeId(agentId, "history replay agent id");
    agentStateSchema.parse(agent);
    assertSafeId(agent.entityId, `history replay agent ${agentId} entity`);
    if (historyBase.truth.entities[agent.entityId]?.lifecycle !== "active") {
      throw new Error(`history replay agent ${agentId} has no entity`);
    }
    if (replayAgentEntities.has(agent.entityId)) {
      throw new Error(`history replay entity ${agent.entityId} has multiple agents`);
    }
    replayAgentEntities.add(agent.entityId);
    return [agentId, structuredClone(agent)];
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
    player: structuredClone(historyBase.player),
    history: [],
    historyBase: structuredClone(historyBase),
    bootstrapAgentCommits: [],
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
  const historyMechanicIds = new Set<string>();
  const historyObservationIds = new Set<string>();
  const usedAgentIds = new Set(Object.keys(historyBase.agents));
  const usedAgentEntities = new Set([
    historyBase.player.entityId,
    ...Object.values(historyBase.agents).map((agent) => agent.entityId),
  ]);
  const usedLocalIds = new Map<string, Set<string>>();
  const activeLocalIds = new Map<string, Set<string>>();
  const claimBindingsByObserver = new Map<string, Map<string, string>>();
  const initializeObserverLedger = (
    observerId: string,
    localIds: readonly string[],
    claimBindings: Readonly<Record<string, string>>,
  ): void => {
    if (usedLocalIds.has(observerId)) throw new Error(`history reinitializes observer ${observerId}`);
    usedLocalIds.set(observerId, new Set(localIds));
    activeLocalIds.set(observerId, new Set(localIds));
    claimBindingsByObserver.set(observerId, new Map(Object.entries(claimBindings)));
  };
  initializeObserverLedger(
    "player",
    Object.keys(historyBase.player.knowledge.localEntities),
    Object.fromEntries(Object.values(historyBase.player.knowledge.claims)
      .map((claim) => [claim.id, `${claim.subjectId}\u0000${claim.predicate}`])),
  );
  for (const agentId of Object.keys(historyBase.agents)) {
    initializeObserverLedger(
      agentId,
      Object.keys(historyBase.agents[agentId].belief.localEntities),
      Object.fromEntries(Object.values(historyBase.agents[agentId].belief.claims)
        .map((claim) => [claim.id, `${claim.subjectId}\u0000${claim.predicate}`])),
    );
  }
  const factBindings = new Map(Object.values(historyBase.truth.facts)
    .map((fact) => [fact.id, `${fact.subjectId}\u0000${fact.predicate}`]));
  const applyBeliefIdentityLedger = (patch: SimulationState["bootstrapAgentCommits"][number]["beliefPatch"], label: string): void => {
    const observerUsedLocalIds = usedLocalIds.get(patch.agentId);
    const observerActiveLocalIds = activeLocalIds.get(patch.agentId);
    const observerClaimBindings = claimBindingsByObserver.get(patch.agentId);
    if (!observerUsedLocalIds || !observerActiveLocalIds || !observerClaimBindings) {
      throw new Error(`${label} patches unknown Agent ${patch.agentId}`);
    }
    for (const operation of patch.operations) {
      if (operation.kind === "upsert_local_entity") {
        const id = operation.entity.id;
        if (!observerActiveLocalIds.has(id) && observerUsedLocalIds.has(id)) {
          throw new Error(`${label} reuses local identity ${id} for ${patch.agentId}`);
        }
        observerUsedLocalIds.add(id);
        observerActiveLocalIds.add(id);
      }
      if (operation.kind === "remove_local_entity") observerActiveLocalIds.delete(operation.localEntityId);
      if (operation.kind === "merge_local_entities") observerActiveLocalIds.delete(operation.fromId);
      if (operation.kind === "split_local_entity") {
        observerActiveLocalIds.delete(operation.fromId);
        for (const entity of operation.entities) {
          if (observerUsedLocalIds.has(entity.id)) {
            throw new Error(`${label} reuses local identity ${entity.id} for ${patch.agentId}`);
          }
          observerUsedLocalIds.add(entity.id);
          observerActiveLocalIds.add(entity.id);
        }
      }
      if (operation.kind === "upsert_claim") {
        const binding = `${operation.claim.subjectId}\u0000${operation.claim.predicate}`;
        if (observerClaimBindings.has(operation.claim.id) && observerClaimBindings.get(operation.claim.id) !== binding) {
          throw new Error(`${label} rebinds belief claim ${operation.claim.id}`);
        }
        observerClaimBindings.set(operation.claim.id, binding);
      }
    }
  };
  const modelInvocationIds = new Set<string>();
  for (const audit of state.bootstrapModelAudits) {
    validateModelAudit(audit, "bootstrap", state.worldHash, 0, modelInvocationIds);
  }
  const initialAgentIds = Object.keys(historyBase.agents).sort();
  const bootstrapCompleted = state.history.length > 0 || state.bootstrapModelAudits.length > 0 ||
    state.bootstrapAgentCommits.length > 0;
  if (bootstrapCompleted) {
    const commitSubjects = state.bootstrapAgentCommits.map((commit) => commit.agentId).sort();
    if (commitSubjects.length !== initialAgentIds.length || new Set(commitSubjects).size !== commitSubjects.length ||
      commitSubjects.some((agentId, index) => agentId !== initialAgentIds[index])) {
      throw new Error("bootstrap Agent commits do not exactly cover the initial Agents");
    }
  }
  for (const commit of state.bootstrapAgentCommits) {
    assertExactKeys(
      commit,
      ["agentId", "beliefPatch", "characterPatch", "nextAction"],
      [],
      `bootstrap Agent commit ${commit.agentId}`,
    );
    beliefPatchSchema.parse(commit.beliefPatch);
    characterPatchSchema.parse(commit.characterPatch);
    actionProposalSchema.parse(commit.nextAction);
    const expectedActionId = runtimeId({
      worldHash: state.worldHash,
      revision: 0,
      kind: "action",
      stage: "prepared",
      owner: commit.agentId,
      round: 0,
      ordinal: 0,
    });
    if (commit.beliefPatch.agentId !== commit.agentId || commit.beliefPatch.baseRevision !== 0 ||
      commit.characterPatch.agentId !== commit.agentId || commit.characterPatch.baseRevision !== 0 ||
      commit.nextAction.actorId !== commit.agentId || commit.nextAction.baseRevision !== 0 ||
      commit.nextAction.id !== expectedActionId || !replayState.agents[commit.agentId]) {
      throw new Error(`bootstrap Agent commit ${commit.agentId} has forged ownership or revision`);
    }
    applyBeliefIdentityLedger(commit.beliefPatch, `bootstrap Agent commit ${commit.agentId}`);
    replayState.agents[commit.agentId] = applyMindCommit(
      replayState.agents[commit.agentId],
      commit,
      0,
      [],
      [],
    );
  }
  visit?.base?.(replayState);
  const usedPlayerIntentIds = new Set<string>();
  const usedPlayerInputIds = new Set<string>();
  if (historyBase.player.intent) {
    usedPlayerIntentIds.add(historyBase.player.intent.id);
    for (const input of historyBase.player.intent.inputs) usedPlayerInputIds.add(input.id);
  }
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
    assertExactKeys(committed, [
      "contentHash", "baseRevision", "revision", "step", "initialActions", "reactionRequests",
      "reactionDecisions", "actions", "rngBefore", "rngAfter", "checkRequests", "checks",
      "randomRequests", "randomResults", "commitmentRounds", "outcomes", "mechanicInvocations",
      "mechanicResults", "causalAssertionResults", "causalVerification", "events", "observations",
      "operations", "playerIntent", "intentStatus", "requiresPlayerDecision", "beliefPatches",
      "characterPatches", "nextActions", "modelAudits",
    ], [], `history step ${index + 1}`);
    const { contentHash: committedHash, ...committedPayload } = committed;
    if (!isSha256(committedHash) || contentHashForAudit(committedPayload) !== committedHash) {
      throw new Error(`history step ${index + 1} has an invalid content hash`);
    }
    if (committed.baseRevision !== index || committed.revision !== index + 1 || committed.step !== index + 1) {
      throw new Error(`history step ${index + 1} has invalid revision metadata`);
    }
    assertExactKeys(committed.rngBefore, ["seed", "state", "draws"], [], `history step ${index + 1} rngBefore`);
    assertExactKeys(committed.rngAfter, ["seed", "state", "draws"], [], `history step ${index + 1} rngAfter`);
    for (const action of committed.initialActions) actionProposalSchema.parse(action);
    for (const action of committed.actions) actionProposalSchema.parse(action);
    for (const action of committed.nextActions) actionProposalSchema.parse(action);
    for (const patch of committed.beliefPatches) beliefPatchSchema.parse(patch);
    for (const patch of committed.characterPatches) characterPatchSchema.parse(patch);
    validatePlayerIntentSnapshot(committed.playerIntent, committed.baseRevision, `history step ${index + 1} intent`);
    for (const result of committed.checks) d20CheckResultSchema.parse(result);
    for (const result of committed.mechanicResults) mechanicResultSchema.parse(result);
    for (const result of committed.causalAssertionResults) causalAssertionResultSchema.parse(result);
    causalVerificationSchema.parse(committed.causalVerification);
    const priorIntent = replayState.player.intent;
    const startsNewIntent = !priorIntent || committed.playerIntent.id !== priorIntent.id;
    if (startsNewIntent) {
      if (committed.playerIntent.status !== "active" ||
        committed.playerIntent.startedAtStep !== committed.baseRevision ||
        committed.playerIntent.inputs.length !== 1 ||
        usedPlayerIntentIds.has(committed.playerIntent.id) ||
        usedPlayerInputIds.has(committed.playerIntent.inputs[0].id)) {
        throw new Error(`history step ${index + 1} does not start a canonical player intent`);
      }
    } else {
      if (priorIntent.status !== "active" || committed.playerIntent.status !== "active" ||
        committed.playerIntent.goal !== priorIntent.goal ||
        committed.playerIntent.startedAtStep !== priorIntent.startedAtStep ||
        committed.playerIntent.inputs.length < priorIntent.inputs.length ||
        priorIntent.inputs.some((input, inputIndex) =>
          contentHashForAudit(input) !== contentHashForAudit(committed.playerIntent.inputs[inputIndex])) ||
        committed.playerIntent.inputs.slice(priorIntent.inputs.length)
          .some((input) => usedPlayerInputIds.has(input.id))) {
        throw new Error(`history step ${index + 1} mutates the active player intent ledger`);
      }
    }
    usedPlayerIntentIds.add(committed.playerIntent.id);
    for (const input of committed.playerIntent.inputs) usedPlayerInputIds.add(input.id);
    replayState.player.intent = structuredClone(committed.playerIntent);
    for (const operation of committed.operations) {
      if (operation.kind !== "create_agent") continue;
      if (operation.agent.id === "player" || usedAgentIds.has(operation.agent.id) ||
        usedAgentEntities.has(operation.agent.entityId)) {
        throw new Error(`history step ${index + 1} reuses an actor identity`);
      }
      usedAgentIds.add(operation.agent.id);
      usedAgentEntities.add(operation.agent.entityId);
      initializeObserverLedger(
        operation.agent.id,
        Object.keys(operation.agent.belief.localEntities),
        Object.fromEntries(Object.values(operation.agent.belief.claims)
          .map((claim) => [claim.id, `${claim.subjectId}\u0000${claim.predicate}`])),
      );
    }
    const initialProposalIds = committed.initialActions.map((action) => action.id);
    const proposalIds = committed.actions.map((action) => action.id);
    const outcomeIds = committed.outcomes.map((outcome) => outcome.proposalId);
    const runtimeOutcomeIds = committed.outcomes.map((outcome) => outcome.id);
    if (new Set(initialProposalIds).size !== initialProposalIds.length ||
      new Set(proposalIds).size !== proposalIds.length || new Set(outcomeIds).size !== outcomeIds.length ||
      new Set(runtimeOutcomeIds).size !== runtimeOutcomeIds.length) {
      throw new Error(`history step ${index + 1} has duplicate actions or outcomes`);
    }
    committed.outcomes.forEach((outcome, ordinal) => {
      const expectedId = runtimeId({
        worldHash: state.worldHash,
        revision: committed.baseRevision,
        kind: "outcome",
        stage: "transition",
        owner: outcome.proposalId,
        round: 0,
        ordinal,
      });
      if (outcome.id !== expectedId) {
        throw new Error(`history step ${index + 1} has a forged outcome identity`);
      }
    });
    const stepActionIds = new Set([...initialProposalIds, ...proposalIds]);
    if ([...stepActionIds].some((id) => historyActionIds.has(id) || !isRuntimeId(id, "action"))) {
      throw new Error(`history step ${index + 1} reuses or forges an action identity`);
    }
    for (const action of committed.initialActions) {
      const expectedId = runtimeId({
        worldHash: state.worldHash,
        revision: committed.baseRevision,
        kind: "action",
        stage: "prepared",
        owner: action.actorId,
        round: 0,
        ordinal: 0,
      });
      if (action.id !== expectedId) throw new Error(`history step ${index + 1} has a forged prepared action`);
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
    const expectedActors = [
      "player",
      ...Object.values(replayState.agents)
        .filter((agent) => replayState.truth.entities[agent.entityId]?.lifecycle === "active")
        .map((agent) => agent.id),
    ].sort();
    if (new Set(initialActors).size !== initialActors.length || new Set(finalActors).size !== finalActors.length ||
      initialActors.length !== finalActors.length || initialActors.some((actorId) => !finalActors.includes(actorId))) {
      throw new Error(`history step ${index + 1} changes the joint actor set`);
    }
    if (initialActors.length !== expectedActors.length ||
      [...initialActors].sort().some((actorId, actorIndex) => actorId !== expectedActors[actorIndex])) {
      throw new Error(`history step ${index + 1} does not exactly cover the active actors`);
    }
    for (const action of committed.initialActions) {
      if (action.actorId === "player") continue;
      const prepared = replayState.agents[action.actorId]?.nextAction;
      if (!prepared || contentHashForAudit(prepared) !== contentHashForAudit(action)) {
        throw new Error(`history step ${index + 1} rebinds prepared action ${action.id}`);
      }
    }
    const reactionAgents = committed.reactionRequests.map((request) => request.agentId);
    const decisionAgents = committed.reactionDecisions.map((decision) => decision.agentId);
    for (const request of committed.reactionRequests) reactionRequestSchema.parse(request);
    for (const decision of committed.reactionDecisions) reactionDecisionSchema.parse(decision);
    for (const request of committed.checkRequests) persistedCheckRequestSchema.parse(request);
    const parsedCommitmentRounds = commitmentRoundsSchema.safeParse(committed.commitmentRounds);
    if (!parsedCommitmentRounds.success) {
      throw new Error(`history step ${index + 1} has an invalid commitment round ledger`);
    }
    validateDiscreteRandomCommitmentBudget(committed.randomRequests, committed.randomResults);
    for (const request of committed.randomRequests) discreteRandomRequestSchema.parse(request);
    for (const result of committed.randomResults) discreteRandomResultSchema.parse(result);
    if (new Set(reactionAgents).size !== reactionAgents.length ||
      new Set(decisionAgents).size !== decisionAgents.length ||
      reactionAgents.length !== decisionAgents.length ||
      reactionAgents.some((agentId) => !decisionAgents.includes(agentId))) {
      throw new Error(`history step ${index + 1} has invalid reaction coverage`);
    }
    const playerInitialAction = committed.initialActions.find((action) => action.actorId === "player");
    const expectedPlayerMeans = committed.playerIntent.latestInput.kind === "goal" &&
      committed.baseRevision === committed.playerIntent.startedAtStep
      ? null
      : committed.playerIntent.latestInput.text;
    if (!playerInitialAction || playerInitialAction.rawText !== committed.playerIntent.latestInput.text ||
      playerInitialAction.goal !== committed.playerIntent.goal || playerInitialAction.means !== expectedPlayerMeans ||
      playerInitialAction.targetIds.length !== 0) {
      throw new Error(`history step ${index + 1} player action does not match its committed input`);
    }
    for (const request of committed.reactionRequests) {
      if (!playerInitialAction || request.sourceActionId !== playerInitialAction.id ||
        request.stimulus.observerId !== request.agentId || request.stimulus.kind !== "stimulus" ||
        request.stimulus.step !== committed.step || request.stimulus.sourceEventIds.length !== 0 ||
        request.basis.length === 0) {
        throw new Error(`history step ${index + 1} has invalid reaction request for ${request.agentId}`);
      }
      for (const basis of request.basis) {
        if (basis.kind === "shared_placement" && !replayState.truth.entities[basis.placementId]) {
          throw new Error(`history step ${index + 1} has unknown reaction placement ${basis.placementId}`);
        }
        if (basis.kind === "fact" && !replayState.truth.facts[basis.factId]) {
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
            decision.replacementAction.id !== runtimeId({
              worldHash: state.worldHash,
              revision: committed.baseRevision,
              kind: "action",
              stage: "reaction",
              owner: decision.agentId,
              round: 0,
              ordinal: 0,
            }) ||
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
      requestIds.some((id) => historyCheckIds.has(id) || !isRuntimeId(id, "check")) ||
      requestIds.length !== resultIds.length || requestIds.some((id, requestIndex) => id !== resultIds[requestIndex])) {
      throw new Error(`history step ${index + 1} has invalid check audit coverage`);
    }
    const randomRequestIds = committed.randomRequests.map((request) => request.id);
    const randomResultIds = committed.randomResults.map((result) => result.requestId);
    if (new Set(randomRequestIds).size !== randomRequestIds.length ||
      new Set(randomResultIds).size !== randomResultIds.length ||
      randomRequestIds.some((id) => historyRandomIds.has(id) || !isRuntimeId(id, "random")) ||
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
    for (const [roundIndex, round] of parsedCommitmentRounds.data.entries()) {
      for (const [ordinal, requestId] of round.requestIds.entries()) {
        const expectedId = runtimeId({
          worldHash: state.worldHash,
          revision: committed.baseRevision,
          kind: round.kind === "check" ? "check" : "random",
          stage: round.kind === "check" ? round.phase : "resolution",
          owner: state.worldId,
          round: roundIndex,
          ordinal,
        });
        if (requestId !== expectedId) {
          throw new Error(`history step ${index + 1} has a forged ${round.kind} identity`);
        }
      }
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
      const stageAudits = committed.modelAudits.filter((audit) => audit.role === role);
      if (stageAudits.length !== 1 || stageAudits[0]!.subjectId !== state.worldId) {
        throw new Error(`history step ${index + 1} must have exactly one ${role} audit for ${state.worldId}`);
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
    for (const audit of committed.modelAudits) {
      validateModelAudit(
        audit,
        `history step ${index + 1}`,
        state.worldHash,
        committed.baseRevision,
        modelInvocationIds,
      );
    }
    const allowedForEvents: Record<CausalRef["kind"], Set<string>> = {
      action: new Set(proposalIds),
      check: new Set(requestIds),
      random: new Set(randomRequestIds),
      event: new Set(priorEventIds),
      fact: new Set(Object.keys(replayState.truth.facts)),
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
    persistedTransitionProposalSchema.parse(replayProposal);
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
      invocationIds.some((id) => !resultInvocationIds.includes(id) || historyMechanicIds.has(id) ||
        !isRuntimeId(id, "mechanic"))) {
      throw new Error(`history step ${index + 1} has invalid mechanic result coverage`);
    }
    committed.mechanicInvocations.forEach((invocation, ordinal) => {
      const expectedId = runtimeId({
        worldHash: state.worldHash,
        revision: committed.baseRevision,
        kind: "mechanic",
        stage: "transition",
        owner: state.worldId,
        round: 0,
        ordinal,
      });
      if (invocation.id !== expectedId) throw new Error(`history step ${index + 1} has a forged mechanic identity`);
    });
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
    committed.reactionRequests.forEach((request, ordinal) => {
      const expectedId = runtimeId({
        worldHash: state.worldHash,
        revision: committed.baseRevision,
        kind: "observation",
        stage: "stimulus",
        owner: request.agentId,
        round: 0,
        ordinal,
      });
      if (request.stimulus.id !== expectedId) {
        throw new Error(`history step ${index + 1} has a forged stimulus identity`);
      }
    });
    const outcomeObservations = committed.observations.filter((observation) => observation.kind === "outcome");
    outcomeObservations.forEach((observation, ordinal) => {
      const expectedId = runtimeId({
        worldHash: state.worldHash,
        revision: committed.baseRevision,
        kind: "observation",
        stage: "outcome",
        owner: observation.observerId,
        round: 0,
        ordinal,
      });
      if (observation.id !== expectedId) {
        throw new Error(`history step ${index + 1} has a forged outcome observation identity`);
      }
    });
    for (const observation of committed.observations) {
      const observerUsedLocalIds = usedLocalIds.get(observation.observerId);
      const observerActiveLocalIds = activeLocalIds.get(observation.observerId);
      const observerClaimBindings = claimBindingsByObserver.get(observation.observerId);
      if (!observerUsedLocalIds || !observerActiveLocalIds || !observerClaimBindings) {
        throw new Error(`history step ${index + 1} observes for unknown subject ${observation.observerId}`);
      }
      if (observationIds.has(observation.id) || historyObservationIds.has(observation.id) ||
        !isRuntimeId(observation.id, "observation") || observation.step !== committed.step ||
        (observation.kind === "stimulus" && !stimulusIds.has(observation.id)) ||
        (observation.kind === "outcome" && stimulusIds.has(observation.id))) {
        throw new Error(`history step ${index + 1} has invalid observation ${observation.id}`);
      }
      assertUniqueIds(observation.sourceEventIds, `history observation ${observation.id} source events`);
      const stagePackets = observation.kind === "stimulus"
        ? committed.reactionRequests.map((request) => request.stimulus)
        : outcomeObservations;
      const packetOrdinal = stagePackets.findIndex((packet) => packet.id === observation.id);
      observation.apparentClaims.forEach((claim, claimOrdinal) => {
        const expectedId = runtimeId({
          worldHash: state.worldHash,
          revision: committed.baseRevision,
          kind: "claim",
          stage: observation.kind,
          owner: [observation.observerId, observation.id],
          round: packetOrdinal,
          ordinal: claimOrdinal,
        });
        if (claim.id !== expectedId) {
          throw new Error(`history step ${index + 1} has a forged apparent claim identity`);
        }
        const binding = `${claim.subjectId}\u0000${claim.predicate}`;
        if (observerClaimBindings.has(claim.id)) {
          throw new Error(`history step ${index + 1} reuses apparent claim ${claim.id}`);
        }
        observerClaimBindings.set(claim.id, binding);
      });
      for (const introduction of observation.introductions) {
        const localId = introduction.localEntity.id;
        if (observerUsedLocalIds.has(localId)) {
          throw new Error(`history step ${index + 1} reuses local identity ${localId} for ${observation.observerId}`);
        }
        observerUsedLocalIds.add(localId);
        observerActiveLocalIds.add(localId);
      }
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
    for (const patch of committed.beliefPatches) {
      applyBeliefIdentityLedger(patch, `history step ${index + 1}`);
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
    const beliefAgents = committed.beliefPatches.map((patch) => patch.agentId).sort();
    const characterAgents = committed.characterPatches.map((patch) => patch.agentId).sort();
    const nextActionAgents = committed.nextActions.map((action) => action.actorId).sort();
    if (new Set(beliefAgents).size !== beliefAgents.length ||
      new Set(characterAgents).size !== characterAgents.length ||
      new Set(nextActionAgents).size !== nextActionAgents.length ||
      contentHashForAudit(beliefAgents) !== contentHashForAudit(characterAgents) ||
      contentHashForAudit(beliefAgents) !== contentHashForAudit(nextActionAgents)) {
      throw new Error(`history step ${index + 1} has inconsistent AgentMind commit coverage`);
    }
    for (const action of committed.nextActions) {
      const expectedId = runtimeId({
        worldHash: state.worldHash,
        revision: committed.revision,
        kind: "action",
        stage: "prepared",
        owner: action.actorId,
        round: 0,
        ordinal: 0,
      });
      if (action.baseRevision !== committed.revision || action.id !== expectedId) {
        throw new Error(`history step ${index + 1} has a forged next action for ${action.actorId}`);
      }
    }
    for (const proposalId of proposalIds) historyActionIds.add(proposalId);
    for (const proposalId of initialProposalIds) historyActionIds.add(proposalId);
    for (const checkId of requestIds) historyCheckIds.add(checkId);
    for (const randomId of randomRequestIds) historyRandomIds.add(randomId);
    for (const mechanicId of invocationIds) historyMechanicIds.add(mechanicId);
    for (const observationId of observationIds) historyObservationIds.add(observationId);
    for (const operation of committed.operations) {
      if (operation.kind === "set_fact") {
        const binding = `${operation.fact.subjectId}\u0000${operation.fact.predicate}`;
        if (factBindings.has(operation.fact.id) && factBindings.get(operation.fact.id) !== binding) {
          throw new Error(`history step ${index + 1} rebinds fact ${operation.fact.id}`);
        }
        factBindings.set(operation.fact.id, binding);
      }
    }
    committed.events.forEach((event, ordinal) => {
      const expectedId = runtimeId({
        worldHash: state.worldHash,
        revision: committed.baseRevision,
        kind: "event",
        stage: "transition",
        owner: state.worldId,
        round: 0,
        ordinal,
      });
      if (event.id !== expectedId || priorEventIds.has(event.id)) {
        throw new Error(`history step ${index + 1} has a forged or reused event identity`);
      }
      priorEventIds.add(event.id);
    });
    for (const operation of committed.operations) applyWorldDeltaOperation(replayState, operation);
    replayState.revision = committed.revision;
    replayState.step = committed.step;
    replayState.truth.rng = structuredClone(committed.rngAfter);
    if (!replayState.player.intent) throw new Error(`history step ${index + 1} lost its player intent`);
    replayState.player.intent.status = committed.intentStatus;
    replayState.truth.events.push(...structuredClone(committed.events));
    for (const [agentId, agent] of Object.entries(replayState.agents)) {
      if (replayState.truth.entities[agent.entityId]?.lifecycle !== "active") delete replayState.agents[agentId];
    }
    const expectedMindAgents = Object.keys(replayState.agents).sort();
    if (contentHashForAudit(expectedMindAgents) !== contentHashForAudit(beliefAgents)) {
      throw new Error(`history step ${index + 1} does not commit every active AgentMind output`);
    }
    applyPlayerObservationBindings(replayState, committed.observations);
    replayState.player.knowledge = ingestPlayerObservations(
      replayState,
      committed.observations.filter((observation) => observation.observerId === "player"),
    );
    for (const agentId of expectedMindAgents) {
      const observations = committed.observations.filter((observation) => observation.observerId === agentId);
      const observed = applyObservationBindings(replayState.agents[agentId], observations);
      const beliefPatch = committed.beliefPatches.find((patch) => patch.agentId === agentId)!;
      const characterPatch = committed.characterPatches.find((patch) => patch.agentId === agentId)!;
      const nextAction = committed.nextActions.find((action) => action.actorId === agentId)!;
      if (beliefPatch.baseRevision !== committed.revision || characterPatch.baseRevision !== committed.revision) {
        throw new Error(`history step ${index + 1} has stale AgentMind patches for ${agentId}`);
      }
      replayState.agents[agentId] = applyMindCommit(
        observed,
        { beliefPatch, characterPatch, nextAction },
        committed.step,
        observations,
        committed.events,
      );
    }
    replayState.history.push(structuredClone(committed));
    visit?.commit?.(replayState, committed);
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
  if (contentHashForAudit(replayState.agents) !== contentHashForAudit(state.agents)) {
    throw new Error("Agent state does not match replayed committed cognition");
  }
  const replayPlayerCognition = {
    entityId: replayState.player.entityId,
    knowledge: replayState.player.knowledge,
    bindings: replayState.player.bindings,
  };
  const finalPlayerCognition = {
    entityId: state.player.entityId,
    knowledge: state.player.knowledge,
    bindings: state.player.bindings,
  };
  const replayIntent = replayState.player.intent;
  const finalIntent = state.player.intent;
  const pendingInputs = replayIntent && finalIntent
    ? finalIntent.inputs.slice(replayIntent.inputs.length)
    : [];
  const historicalIntents = [
    ...(historyBase.player.intent ? [historyBase.player.intent] : []),
    ...state.history.map((committed) => committed.playerIntent),
  ];
  const historicalIntentIds = new Set(historicalIntents.map((intent) => intent.id));
  const historicalInputIds = new Set(historicalIntents.flatMap((intent) =>
    intent.inputs.map((input) => input.id)));
  const hasBoundPendingIntentBoundary = Boolean(
    replayIntent && finalIntent && replayIntent.status === "active" &&
    (finalIntent.status === "active" || finalIntent.status === "cancelled") &&
    replayIntent.id === finalIntent.id && replayIntent.goal === finalIntent.goal &&
    replayIntent.startedAtStep === finalIntent.startedAtStep &&
    finalIntent.inputs.length >= replayIntent.inputs.length &&
    replayIntent.inputs.every((input, inputIndex) =>
      contentHashForAudit(input) === contentHashForAudit(finalIntent.inputs[inputIndex])) &&
    pendingInputs.every((input) => input.kind === "clarification" && input.submittedAtStep === state.step) &&
    (pendingInputs.length > 0 || finalIntent.status === "cancelled"),
  );
  const pendingNewGoalInput = finalIntent?.inputs[0];
  const hasBoundPendingNewIntent = Boolean(
    finalIntent && (finalIntent.status === "active" || finalIntent.status === "cancelled") &&
    finalIntent.startedAtStep === state.step && finalIntent.inputs.length === 1 &&
    pendingNewGoalInput?.kind === "goal" && pendingNewGoalInput.submittedAtStep === state.step &&
    pendingNewGoalInput.text === finalIntent.goal && !historicalIntentIds.has(finalIntent.id) &&
    !historicalInputIds.has(pendingNewGoalInput.id),
  );
  const intentMatchesReplay = contentHashForAudit(replayIntent ?? null) ===
      contentHashForAudit(finalIntent ?? null) ||
    hasBoundPendingIntentBoundary || hasBoundPendingNewIntent;
  if (contentHashForAudit(replayPlayerCognition) !== contentHashForAudit(finalPlayerCognition) ||
    (state.history.length > 0 && !intentMatchesReplay)) {
    throw new Error("player state does not match replayed committed cognition and input ledger");
  }
  const validateFinalObserverLedger = (
    observerId: string,
    localEntities: Readonly<Record<string, unknown>>,
    claims: Readonly<Record<string, Pick<BeliefClaim, "id" | "subjectId" | "predicate">>>,
  ): void => {
    const activeIds = activeLocalIds.get(observerId);
    const claimBindings = claimBindingsByObserver.get(observerId);
    if (!activeIds || !claimBindings || activeIds.size !== Object.keys(localEntities).length ||
      Object.keys(localEntities).some((id) => !activeIds.has(id))) {
      throw new Error(`observer ${observerId} local identities do not match history ledger`);
    }
    for (const claim of Object.values(claims)) {
      const binding = `${claim.subjectId}\u0000${claim.predicate}`;
      if (claimBindings.get(claim.id) !== binding) {
        throw new Error(`observer ${observerId} claim ${claim.id} does not match history ledger`);
      }
    }
  };
  validateFinalObserverLedger(
    "player",
    state.player.knowledge.localEntities,
    state.player.knowledge.claims,
  );
  for (const agent of Object.values(state.agents)) {
    validateFinalObserverLedger(agent.id, agent.belief.localEntities, agent.belief.claims);
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
  worldHash: string,
  revision: number,
  seenInvocationIds?: Set<string>,
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
    const expectedInvocationId = runtimeId({
      worldHash,
      revision,
      kind: "model-audit",
      stage: audit.role,
      owner: audit.subjectId,
      round: 0,
      ordinal: invocation.ordinal,
    });
    if (!exactKeys(invocation, [
      "id", "ordinal", "requestHash", "responseHash", "requestUtf8Bytes", "responseUtf8Bytes",
      "context", "transports", "tokenUsage", "finishReason", "providerRequestId", "resultKind",
      "semanticOutcome", "validationIssueCodes",
      ]) || invocation.id !== expectedInvocationId ||
      !exactKeys(invocation.context, ["utf8Bytes", "sections", "counts"]) ||
      !exactKeys(invocation.context.counts, [
        "history", "events", "agents", "entities", "facts", "beliefs", "evidence", "observations",
      ]) || !exactKeys(invocation.tokenUsage, [
        "input", "output", "reasoning", "cacheRead", "cacheWrite",
      ]) || !isRuntimeId(invocation.id, "model-audit") || invocationIds.has(invocation.id) ||
      seenInvocationIds?.has(invocation.id) ||
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
    seenInvocationIds?.add(invocation.id);
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
  assertExactKeys(state, [
    "schemaVersion", "worldId", "worldHash", "lawIds", "revision", "step", "truth", "agents",
    "player", "history", "bootstrapAgentCommits", "bootstrapModelAudits",
  ], ["historyBase"], "simulation state");
  assertExactKeys(state.truth, [
    "elapsedSeconds", "rng", "events", "entities", "placements", "facts", "factTombstones",
    "mechanics", "meters", "quantities", "ratings",
  ], [], "canonical truth");
  assertExactKeys(state.truth.rng, ["seed", "state", "draws"], [], "RNG state");
  assertExactKeys(state.truth.mechanics, ["meters", "quantities", "ratings"], [], "mechanics catalog");
  assertExactKeys(state.player, ["entityId", "knowledge", "bindings"], ["intent"], "player state");
  assertExactKeys(
    state.player.knowledge,
    ["localEntities", "claims", "evidence", "observationIds"],
    [],
    "player knowledge",
  );
  if (state.historyBase) {
    assertExactKeys(state.historyBase, [
      "truth", "agents", "player",
    ], [], "history replay base");
  }
  if (state.schemaVersion !== 8 || !state.worldId.trim() || !/^sha256:[a-f0-9]{64}$/.test(state.worldHash)) {
    throw new Error("invalid simulation identity");
  }
  assertSemanticId(state.worldId, "world id");
  if (state.lawIds.length === 0 || new Set(state.lawIds).size !== state.lawIds.length ||
    state.lawIds.some((lawId) => !lawId.trim())) throw new Error("invalid world law ids");
  for (const lawId of state.lawIds) assertSafeId(lawId, "world law id");
  if (!Number.isSafeInteger(state.revision) || state.revision < 0) throw new Error("invalid revision");
  if (!Number.isSafeInteger(state.step) || state.step < 0) throw new Error("invalid step");
  if (!Number.isSafeInteger(state.truth.elapsedSeconds) || state.truth.elapsedSeconds < 0) {
    throw new Error("invalid elapsed time");
  }
  if (!state.truth.entities[state.player.entityId]) throw new Error("player entity is missing");
  assertSemanticId(state.player.entityId, "player entity id");
  if (state.player.intent) {
    validatePlayerIntentSnapshot(state.player.intent, state.step);
  }
  const bootstrapInvocationIds = new Set<string>();
  for (const audit of state.bootstrapModelAudits) {
    validateModelAudit(audit, "bootstrap", state.worldHash, 0, bootstrapInvocationIds);
    if (audit.role !== "agent-bootstrap") throw new Error("bootstrap has a non-bootstrap audit");
  }
  for (const commit of state.bootstrapAgentCommits) {
    assertExactKeys(
      commit,
      ["agentId", "beliefPatch", "characterPatch", "nextAction"],
      [],
      `bootstrap Agent commit ${commit.agentId}`,
    );
    beliefPatchSchema.parse(commit.beliefPatch);
    characterPatchSchema.parse(commit.characterPatch);
    actionProposalSchema.parse(commit.nextAction);
    if (commit.beliefPatch.agentId !== commit.agentId || commit.beliefPatch.baseRevision !== 0 ||
      commit.characterPatch.agentId !== commit.agentId || commit.characterPatch.baseRevision !== 0 ||
      commit.nextAction.actorId !== commit.agentId || commit.nextAction.baseRevision !== 0 ||
      commit.nextAction.id !== runtimeId({
        worldHash: state.worldHash,
        revision: 0,
        kind: "action",
        stage: "prepared",
        owner: commit.agentId,
        round: 0,
        ordinal: 0,
      })) {
      throw new Error(`bootstrap Agent commit ${commit.agentId} has forged ownership or revision`);
    }
  }
  const initialAgentIds = state.historyBase
    ? Object.keys(state.historyBase.agents).sort()
    : state.revision === 0 || state.bootstrapModelAudits.length === 0
      ? Object.keys(state.agents).sort()
      : state.bootstrapModelAudits.map((audit) => audit.subjectId).sort();
  const currentInitialActions = initialAgentIds
    .map((agentId) => state.agents[agentId]?.nextAction)
    .filter((action) => action !== undefined);
  const preparedInitialAgents = currentInitialActions.filter((action) => action !== null).length;
  if (state.history.length === 0 && preparedInitialAgents > 0 &&
    preparedInitialAgents !== currentInitialActions.length) {
    throw new Error("bootstrap is only partially committed");
  }
  const bootstrapCompleted = state.history.length > 0 || state.bootstrapModelAudits.length > 0 ||
    state.bootstrapAgentCommits.length > 0 ||
    (currentInitialActions.length > 0 && preparedInitialAgents === currentInitialActions.length);
  if (bootstrapCompleted) {
    const auditSubjects = state.bootstrapModelAudits.map((audit) => audit.subjectId).sort();
    const commitSubjects = state.bootstrapAgentCommits.map((commit) => commit.agentId).sort();
    if (auditSubjects.length !== initialAgentIds.length ||
      new Set(auditSubjects).size !== auditSubjects.length ||
      auditSubjects.some((subjectId, index) => subjectId !== initialAgentIds[index]) ||
      commitSubjects.length !== initialAgentIds.length || new Set(commitSubjects).size !== commitSubjects.length ||
      commitSubjects.some((subjectId, index) => subjectId !== initialAgentIds[index])) {
      throw new Error("bootstrap commits and model audits do not exactly cover the initial Agents");
    }
  }
  if (!Number.isSafeInteger(state.truth.rng.seed) || !Number.isSafeInteger(state.truth.rng.state) ||
    !Number.isSafeInteger(state.truth.rng.draws) || state.truth.rng.seed < 0 || state.truth.rng.state < 0 ||
    state.truth.rng.draws < 0 || state.truth.rng.seed > 0xffffffff || state.truth.rng.state > 0xffffffff) {
    throw new Error("invalid RNG state");
  }

  validatePlacementCycles(state);
  for (const [definitionId, definition] of Object.entries(state.truth.mechanics.meters)) {
    assertExactKeys(definition, ["id", "name", "min", "max", "thresholds"], [], `meter definition ${definitionId}`);
    assertSafeId(definitionId, "meter definition id");
    if (definition.id !== definitionId || !Number.isFinite(definition.min) ||
      !Number.isFinite(definition.max) || definition.max <= definition.min) {
      throw new Error(`invalid meter definition ${definitionId}`);
    }
    const thresholdIds = new Set<string>();
    for (const threshold of definition.thresholds) {
      assertExactKeys(threshold, ["id", "when", "effects"], [], `threshold ${threshold.id}`);
      assertExactKeys(threshold.when, ["operator", "value"], [], `threshold ${threshold.id} condition`);
      for (const effect of threshold.effects) {
        assertExactKeys(
          effect,
          effect.kind === "set_lifecycle"
            ? ["kind", "lifecycle"]
            : ["kind", "predicate", "value", "description"],
          effect.kind === "set_fact" ? ["access"] : [],
          `threshold ${threshold.id} effect`,
        );
      }
      if (thresholdIds.has(threshold.id) || threshold.when.value < definition.min ||
        threshold.when.value > definition.max) {
        throw new Error(`invalid threshold ${threshold.id} for ${definitionId}`);
      }
      thresholdIds.add(threshold.id);
    }
  }
  for (const [definitionId, definition] of Object.entries(state.truth.mechanics.quantities)) {
    assertExactKeys(
      definition,
      ["id", "name", "unit", "productionLawIds", "consumptionLawIds"],
      [],
      `quantity definition ${definitionId}`,
    );
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
    assertExactKeys(definition, ["id", "name", "min", "max"], [], `rating definition ${definitionId}`);
    assertSafeId(definitionId, "rating definition id");
    if (definition.id !== definitionId || !Number.isFinite(definition.min) ||
      !Number.isFinite(definition.max) || definition.max < definition.min) {
      throw new Error(`invalid rating definition ${definitionId}`);
    }
  }
  for (const [entityId, entity] of Object.entries(state.truth.entities)) {
    entitySchema.parse(entity);
    assertSemanticId(entityId, "entity id");
    assertSemanticId(entity.id, "entity embedded id");
    if (entity.id !== entityId) throw new Error(`entity key does not match ${entity.id}`);
  }
  for (const [factId, fact] of Object.entries(state.truth.facts)) {
    persistedFactSchema.parse(fact);
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
  assertUniqueIds(state.truth.factTombstones, "fact tombstones");
  for (const factId of state.truth.factTombstones) {
    if (!isSemanticId(factId) && !isRuntimeId(factId, "fact")) {
      throw new Error(`fact tombstone ${factId} is not a persisted Fact identity`);
    }
    if (state.truth.facts[factId]) throw new Error(`fact ${factId} is both active and tombstoned`);
  }
  for (const [meterId, meter] of Object.entries(state.truth.meters)) {
    meterSchema.parse(meter);
    assertSafeId(meterId, "meter id");
    assertSafeId(meter.definitionId, `meter ${meterId} definition`);
    assertSafeId(meter.entityId, `meter ${meterId} entity`);
    if (meter.id !== meterId) throw new Error(`meter key does not match ${meter.id}`);
    validateMeter(state, meter);
  }
  for (const [quantityId, quantity] of Object.entries(state.truth.quantities)) {
    quantityStateSchema.parse(quantity);
    assertSafeId(quantityId, "quantity id");
    assertSafeId(quantity.definitionId, `quantity ${quantityId} definition`);
    assertSafeId(quantity.holderId, `quantity ${quantityId} holder`);
    if (quantity.id !== quantityId ||
      quantity.id !== quantityKey(state, quantity.definitionId, quantity.holderId)) {
      throw new Error(`invalid quantity identity ${quantityId}`);
    }
    if (!state.truth.mechanics.quantities[quantity.definitionId]) {
      throw new Error(`unknown quantity definition ${quantity.definitionId}`);
    }
    if (!state.truth.entities[quantity.holderId]) throw new Error(`unknown quantity holder ${quantity.holderId}`);
    if (!Number.isFinite(quantity.amount) || quantity.amount < 0) throw new Error(`invalid quantity ${quantity.id}`);
  }
  for (const [id, rating] of Object.entries(state.truth.ratings)) {
    ratingSchema.parse(rating);
    assertSafeId(id, "rating id");
    assertSafeId(rating.definitionId, `rating ${id} definition`);
    assertSafeId(rating.entityId, `rating ${id} entity`);
    if (rating.id !== id) throw new Error(`rating key does not match ${rating.id}`);
    validateRating(state, id);
  }

  const agentEntities = new Set<string>();
  const nextActionIds = new Set<string>();
  for (const [agentId, agent] of Object.entries(state.agents)) {
    agentStateSchema.parse(agent);
    assertSemanticId(agentId, "agent id");
    if (agentId === "player") throw new Error("agent id player is reserved");
    assertSafeId(agent.entityId, `agent ${agentId} entity`);
    for (const profileId of Object.values(agent.modelProfiles)) {
      assertSafeId(profileId, `agent ${agentId} model profile`);
    }
    if (agent.id !== agentId) throw new Error(`agent key does not match ${agent.id}`);
    const entity = state.truth.entities[agent.entityId];
    if (!entity) throw new Error(`agent ${agent.id} has no entity`);
    if (entity.lifecycle !== "active") throw new Error(`agent ${agent.id} belongs to a retired entity`);
    if (agent.entityId === state.player.entityId) throw new Error(`agent ${agent.id} owns the player entity`);
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
      const expectedActionId = runtimeId({
        worldHash: state.worldHash,
        revision: state.revision,
        kind: "action",
        stage: "prepared",
        owner: agent.id,
        round: 0,
        ordinal: 0,
      });
      if (agent.nextAction.id !== expectedActionId || nextActionIds.has(agent.nextAction.id)) {
        throw new Error(`agent ${agent.id} has an invalid prepared action identity`);
      }
      nextActionIds.add(agent.nextAction.id);
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
    assertExactKeys(
      event,
      ["id", "step", "description", "impact", "causes", "assertions"],
      [],
      `world event ${event.id}`,
    );
    if (eventIds.has(event.id) || !isRuntimeId(event.id, "event")) {
      throw new Error(`duplicate or invalid world event ${event.id}`);
    }
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
  if (requireHistoryAlignment) replayCommittedHistory(state);
}

/** Strict persisted-state entry point: structural strictness and every ledger invariant share one validator. */
export const simulationStateSchema = z.unknown().transform((value, context) => {
  try {
    validateSimulationState(value as SimulationState, false, true);
    return value as SimulationState;
  } catch (error) {
    context.addIssue({
      code: "custom",
      message: error instanceof Error ? error.message : String(error),
    });
    return z.NEVER;
  }
}) as z.ZodType<SimulationState>;

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
