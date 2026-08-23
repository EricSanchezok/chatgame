import type {
  AgentBeliefState,
  AgentCharacterState,
  AgentGoal,
  CharacterImpact,
  CharacterPatch,
  CharacterPatchOperation,
  ObservationPacket,
  WorldEvent,
} from "./model";
import { isSafeId } from "./state-schemas";

const impactRank: Record<CharacterImpact, number> = {
  ordinary: 0,
  significant: 1,
  transformative: 2,
};

const numericLimits = {
  longTerm: { ordinary: 0.05, significant: 0.25, transformative: 1 },
  shortTerm: { ordinary: 0.35, significant: 0.75, transformative: 1 },
  motivation: { ordinary: 0.25, significant: 0.5, transformative: 1 },
} as const;

const terminalGoalStatuses = new Set<AgentGoal["status"]>(["completed", "failed", "abandoned"]);

function assertUnitInterval(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error(`${label} must be between 0 and 1`);
}

function assertEvidenceExists(belief: AgentBeliefState, evidenceIds: readonly string[], label: string): void {
  for (const evidenceId of evidenceIds) {
    if (!belief.evidence[evidenceId]) throw new Error(`${label} references unknown evidence ${evidenceId}`);
  }
}

function operationImpact(
  operation: CharacterPatchOperation,
  agentId: string,
  step: number,
  observations: readonly ObservationPacket[],
  events: readonly WorldEvent[],
): CharacterImpact {
  if (operation.sourceObservationIds.length === 0) throw new Error(`${operation.kind} has no source observation`);
  const observationMap = new Map(observations.map((packet) => [packet.id, packet]));
  const eventMap = new Map(events.map((event) => [event.id, event]));
  let result: CharacterImpact = "ordinary";
  let currentEventFound = false;
  for (const observationId of operation.sourceObservationIds) {
    const packet = observationMap.get(observationId);
    if (!packet || packet.observerId !== agentId || packet.step !== step) {
      throw new Error(`${operation.kind} references unavailable observation ${observationId}`);
    }
    for (const eventId of packet.sourceEventIds) {
      const event = eventMap.get(eventId);
      if (!event || event.step !== step) continue;
      currentEventFound = true;
      if (impactRank[event.impact] > impactRank[result]) result = event.impact;
    }
  }
  if (!currentEventFound) throw new Error(`${operation.kind} has no current-step event basis`);
  return result;
}

function assertDelta(previous: number, next: number, limit: number, label: string): void {
  assertUnitInterval(next, label);
  if (Math.abs(next - previous) > limit + Number.EPSILON) {
    throw new Error(`${label} changes by more than ${limit}`);
  }
}

function requireSignificantChange(impact: CharacterImpact, changed: boolean, label: string): void {
  if (changed && impactRank[impact] < impactRank.significant) {
    throw new Error(`${label} requires a significant event`);
  }
}

function evidenceFor(operation: CharacterPatchOperation): string[] {
  return [...new Set(operation.evidenceIds)];
}

function assertLocalIds(belief: AgentBeliefState, ids: readonly string[], label: string): void {
  for (const id of ids) {
    if (!belief.localEntities[id]) throw new Error(`${label} references unknown local entity ${id}`);
  }
}

function sameIds(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((id) => right.includes(id));
}

function assertUniqueIds(ids: readonly string[], label: string): void {
  if (new Set(ids).size !== ids.length) throw new Error(`${label} contains duplicate ids`);
}

function assertMotivationsExist(character: AgentCharacterState, ids: readonly string[], label: string): void {
  for (const id of ids) {
    if (!character.traits[id] && !character.values[id] && !character.commitments[id]) {
      throw new Error(`${label} references unknown motivation ${id}`);
    }
  }
}

function assertGoalHierarchy(character: AgentCharacterState): void {
  for (const goal of Object.values(character.goals)) {
    if (!goal.parentGoalId) continue;
    if (!character.goals[goal.parentGoalId]) throw new Error(`goal ${goal.id} has unknown parent ${goal.parentGoalId}`);
    const visited = new Set([goal.id]);
    let parentId: string | undefined = goal.parentGoalId;
    while (parentId) {
      if (visited.has(parentId)) throw new Error(`goal hierarchy cycle at ${parentId}`);
      visited.add(parentId);
      parentId = character.goals[parentId]?.parentGoalId;
    }
  }
}

export function validateCharacterState(
  character: AgentCharacterState,
  belief: AgentBeliefState,
  step: number,
  label: string,
): void {
  if (typeof character.persona.summary !== "string" || !character.persona.summary.trim()) {
    throw new Error(`${label} has an empty persona summary`);
  }
  if (typeof character.persona.voice !== "string") throw new Error(`${label} has an invalid persona voice`);
  if (!Number.isSafeInteger(character.persona.updatedAtStep) || character.persona.updatedAtStep < 0 ||
    character.persona.updatedAtStep > step) {
    throw new Error(`${label} persona has an invalid update step`);
  }
  assertEvidenceExists(belief, character.persona.evidenceIds, `${label} persona`);
  assertUniqueIds(character.persona.evidenceIds, `${label} persona evidence`);

  const validateBase = (
    key: string,
    record: { id: string; createdAtStep: number; updatedAtStep: number; evidenceIds: string[] },
    kind: string,
  ): void => {
    if (!isSafeId(key)) throw new Error(`${label} ${kind} uses a reserved object key`);
    if (record.id !== key) throw new Error(`${label} ${kind} key does not match ${record.id}`);
    if (!record.id.trim()) throw new Error(`${label} ${kind} has an empty id`);
    if (!Number.isSafeInteger(record.createdAtStep) || !Number.isSafeInteger(record.updatedAtStep) ||
      record.createdAtStep < 0 || record.updatedAtStep < record.createdAtStep || record.updatedAtStep > step) {
      throw new Error(`${label} ${kind} ${key} has invalid timestamps`);
    }
    assertEvidenceExists(belief, record.evidenceIds, `${label} ${kind} ${key}`);
    assertUniqueIds(record.evidenceIds, `${label} ${kind} ${key} evidence`);
  };

  for (const collection of [character.traits, character.values]) {
    for (const [id, facet] of Object.entries(collection)) {
      validateBase(id, facet, "facet");
      if (!facet.description.trim() || !new Set(["active", "retired"]).has(facet.status)) {
        throw new Error(`${label} facet ${id} has invalid description or status`);
      }
      assertUnitInterval(facet.strength, `${label} facet ${id} strength`);
    }
  }
  for (const [id, emotion] of Object.entries(character.emotions)) {
    validateBase(id, emotion, "emotion");
    if (!emotion.description.trim() || !new Set(["active", "resolved"]).has(emotion.status)) {
      throw new Error(`${label} emotion ${id} has invalid description or status`);
    }
    assertUnitInterval(emotion.intensity, `${label} emotion ${id} intensity`);
  }
  for (const [id, attitude] of Object.entries(character.attitudes)) {
    validateBase(id, attitude, "attitude");
    if (!attitude.description.trim() || !new Set(["active", "retired"]).has(attitude.status)) {
      throw new Error(`${label} attitude ${id} has invalid description or status`);
    }
    assertUnitInterval(attitude.intensity, `${label} attitude ${id} intensity`);
    assertLocalIds(belief, [attitude.subjectId], `${label} attitude ${id}`);
  }
  for (const [id, goal] of Object.entries(character.goals)) {
    validateBase(id, goal, "goal");
    if (!goal.description.trim() ||
      !new Set(["active", "suspended", "completed", "failed", "abandoned"]).has(goal.status)) {
      throw new Error(`${label} goal ${id} has invalid description or status`);
    }
    assertUnitInterval(goal.priority, `${label} goal ${id} priority`);
    assertUnitInterval(goal.progress, `${label} goal ${id} progress`);
    assertLocalIds(belief, goal.targetIds, `${label} goal ${id}`);
    assertMotivationsExist(character, goal.motivatedByIds, `${label} goal ${id}`);
    assertUniqueIds(goal.targetIds, `${label} goal ${id} targets`);
    assertUniqueIds(goal.motivatedByIds, `${label} goal ${id} motivations`);
  }
  for (const [id, commitment] of Object.entries(character.commitments)) {
    validateBase(id, commitment, "commitment");
    if (!commitment.description.trim() ||
      !new Set(["active", "fulfilled", "broken", "released"]).has(commitment.status)) {
      throw new Error(`${label} commitment ${id} has invalid description or status`);
    }
    assertUnitInterval(commitment.priority, `${label} commitment ${id} priority`);
    assertLocalIds(belief, commitment.subjectIds, `${label} commitment ${id}`);
    assertUniqueIds(commitment.subjectIds, `${label} commitment ${id} subjects`);
  }
  assertGoalHierarchy(character);
}

export function applyCharacterPatch(
  source: AgentCharacterState,
  belief: AgentBeliefState,
  patch: CharacterPatch,
  step: number,
  observations: readonly ObservationPacket[],
  events: readonly WorldEvent[],
): AgentCharacterState {
  if (!isSafeId(patch.agentId)) throw new Error("character patch uses a reserved agent id");
  const next = structuredClone(source);
  for (const operation of patch.operations) {
    const recordId = "id" in operation
      ? operation.id
      : "facet" in operation
        ? operation.facet.id
        : "emotion" in operation
          ? operation.emotion.id
          : "attitude" in operation
            ? operation.attitude.id
            : "goal" in operation
              ? operation.goal.id
              : "commitment" in operation
                ? operation.commitment.id
                : null;
    if (recordId !== null && !isSafeId(recordId)) {
      throw new Error(`${operation.kind} uses a reserved object key`);
    }
    if (operation.evidenceIds.length === 0) throw new Error(`${operation.kind} has no evidence`);
    assertUniqueIds(operation.sourceObservationIds, `${operation.kind} source observations`);
    assertUniqueIds(operation.evidenceIds, `${operation.kind} evidence`);
    assertEvidenceExists(belief, operation.evidenceIds, operation.kind);
    const evidenceIds = evidenceFor(operation);
    const impact = operationImpact(operation, patch.agentId, step, observations, events);
    const rank = impactRank[impact];

    switch (operation.kind) {
      case "replace_persona":
        if (impact !== "transformative") throw new Error("persona replacement requires a transformative event");
        if (!operation.summary.trim()) throw new Error("persona summary cannot be empty");
        next.persona = { summary: operation.summary, voice: operation.voice, updatedAtStep: step, evidenceIds };
        break;
      case "create_trait":
      case "create_value": {
        if (rank < impactRank.significant) throw new Error(`${operation.kind} requires a significant event`);
        const collection = operation.kind === "create_trait" ? next.traits : next.values;
        if (collection[operation.facet.id]) throw new Error(`${operation.kind} duplicates ${operation.facet.id}`);
        assertDelta(0, operation.facet.strength, numericLimits.longTerm[impact], `${operation.kind} strength`);
        collection[operation.facet.id] = {
          ...structuredClone(operation.facet), status: "active", createdAtStep: step, updatedAtStep: step, evidenceIds,
        };
        break;
      }
      case "update_trait":
      case "update_value": {
        if (operation.description === null && operation.strength === null) {
          throw new Error(`${operation.kind} must change description or strength`);
        }
        const collection = operation.kind === "update_trait" ? next.traits : next.values;
        const facet = collection[operation.id];
        if (!facet || facet.status !== "active") throw new Error(`${operation.kind} references inactive ${operation.id}`);
        const descriptionChanged = operation.description !== null && operation.description !== facet.description;
        const strengthChanged = operation.strength !== null && operation.strength !== facet.strength;
        if (!descriptionChanged && !strengthChanged) throw new Error(`${operation.kind} does not change ${operation.id}`);
        requireSignificantChange(
          impact,
          descriptionChanged,
          `${operation.kind} description`,
        );
        if (operation.strength !== null) {
          assertDelta(facet.strength, operation.strength, numericLimits.longTerm[impact], `${operation.kind} strength`);
          facet.strength = operation.strength;
        }
        if (operation.description !== null) facet.description = operation.description;
        facet.updatedAtStep = step;
        facet.evidenceIds = evidenceIds;
        break;
      }
      case "retire_trait":
      case "retire_value": {
        if (rank < impactRank.significant) throw new Error(`${operation.kind} requires a significant event`);
        const collection = operation.kind === "retire_trait" ? next.traits : next.values;
        const facet = collection[operation.id];
        if (!facet || facet.status !== "active") throw new Error(`${operation.kind} references inactive ${operation.id}`);
        assertDelta(facet.strength, 0, numericLimits.longTerm[impact], `${operation.kind} strength`);
        facet.strength = 0;
        facet.status = "retired";
        facet.updatedAtStep = step;
        facet.evidenceIds = evidenceIds;
        break;
      }
      case "set_emotion": {
        const current = next.emotions[operation.emotion.id];
        if (current?.status === "resolved") throw new Error(`cannot reopen resolved emotion ${current.id}`);
        requireSignificantChange(
          impact,
          Boolean(current && current.description !== operation.emotion.description),
          "emotion description",
        );
        assertDelta(current?.intensity ?? 0, operation.emotion.intensity, numericLimits.shortTerm[impact], "emotion intensity");
        next.emotions[operation.emotion.id] = {
          ...structuredClone(operation.emotion), status: "active", createdAtStep: current?.createdAtStep ?? step,
          updatedAtStep: step, evidenceIds,
        };
        break;
      }
      case "resolve_emotion": {
        const emotion = next.emotions[operation.id];
        if (!emotion || emotion.status !== "active") throw new Error(`resolve_emotion references inactive ${operation.id}`);
        assertDelta(emotion.intensity, 0, numericLimits.shortTerm[impact], "emotion resolution");
        emotion.intensity = 0;
        emotion.status = "resolved";
        emotion.updatedAtStep = step;
        emotion.evidenceIds = evidenceIds;
        break;
      }
      case "set_attitude": {
        assertLocalIds(belief, [operation.attitude.subjectId], "attitude");
        const current = next.attitudes[operation.attitude.id];
        if (current?.status === "retired") throw new Error(`cannot reopen retired attitude ${current.id}`);
        requireSignificantChange(
          impact,
          Boolean(current && (current.subjectId !== operation.attitude.subjectId ||
            current.description !== operation.attitude.description)),
          "attitude identity",
        );
        assertDelta(current?.intensity ?? 0, operation.attitude.intensity, numericLimits.shortTerm[impact], "attitude intensity");
        next.attitudes[operation.attitude.id] = {
          ...structuredClone(operation.attitude), status: "active", createdAtStep: current?.createdAtStep ?? step,
          updatedAtStep: step, evidenceIds,
        };
        break;
      }
      case "retire_attitude": {
        const attitude = next.attitudes[operation.id];
        if (!attitude || attitude.status !== "active") throw new Error(`retire_attitude references inactive ${operation.id}`);
        assertDelta(attitude.intensity, 0, numericLimits.shortTerm[impact], "attitude retirement");
        attitude.intensity = 0;
        attitude.status = "retired";
        attitude.updatedAtStep = step;
        attitude.evidenceIds = evidenceIds;
        break;
      }
      case "create_goal": {
        if (next.goals[operation.goal.id]) throw new Error(`duplicate goal ${operation.goal.id}`);
        assertDelta(0, operation.goal.priority, numericLimits.motivation[impact], "goal priority");
        assertDelta(0, operation.goal.progress, numericLimits.motivation[impact], "goal progress");
        assertLocalIds(belief, operation.goal.targetIds, `goal ${operation.goal.id}`);
        assertMotivationsExist(next, operation.goal.motivatedByIds, `goal ${operation.goal.id}`);
        const { parentGoalId, ...goal } = structuredClone(operation.goal);
        next.goals[operation.goal.id] = {
          ...goal,
          parentGoalId: parentGoalId ?? undefined,
          status: "active",
          createdAtStep: step,
          updatedAtStep: step,
          evidenceIds,
        };
        assertGoalHierarchy(next);
        break;
      }
      case "update_goal": {
        if (operation.description === null && operation.priority === null && operation.progress === null &&
          operation.targetIds === null && operation.parentGoal.kind === "unchanged" &&
          operation.motivatedByIds === null) {
          throw new Error("update_goal must change at least one field");
        }
        const goal = next.goals[operation.id];
        if (!goal || terminalGoalStatuses.has(goal.status)) throw new Error(`update_goal references terminal ${operation.id}`);
        const meaningChanged = (operation.description !== null && operation.description !== goal.description) ||
          (operation.targetIds !== null && !sameIds(operation.targetIds, goal.targetIds)) ||
          (operation.motivatedByIds !== null && !sameIds(operation.motivatedByIds, goal.motivatedByIds)) ||
          (operation.parentGoal.kind === "none" && goal.parentGoalId !== undefined) ||
          (operation.parentGoal.kind === "goal" && operation.parentGoal.goalId !== goal.parentGoalId);
        const numericChanged = (operation.priority !== null && operation.priority !== goal.priority) ||
          (operation.progress !== null && operation.progress !== goal.progress);
        if (!meaningChanged && !numericChanged) throw new Error(`update_goal does not change ${goal.id}`);
        if (operation.priority !== null) {
          assertDelta(goal.priority, operation.priority, numericLimits.motivation[impact], "goal priority");
          goal.priority = operation.priority;
        }
        if (operation.progress !== null) {
          assertDelta(goal.progress, operation.progress, numericLimits.motivation[impact], "goal progress");
          goal.progress = operation.progress;
        }
        requireSignificantChange(
          impact,
          meaningChanged,
          "goal meaning",
        );
        if (operation.description !== null) goal.description = operation.description;
        if (operation.targetIds !== null) {
          assertLocalIds(belief, operation.targetIds, `goal ${goal.id}`);
          goal.targetIds = [...operation.targetIds];
        }
        if (operation.motivatedByIds !== null) {
          assertMotivationsExist(next, operation.motivatedByIds, `goal ${goal.id}`);
          goal.motivatedByIds = [...operation.motivatedByIds];
        }
        if (operation.parentGoal.kind === "none") goal.parentGoalId = undefined;
        if (operation.parentGoal.kind === "goal") goal.parentGoalId = operation.parentGoal.goalId;
        goal.updatedAtStep = step;
        goal.evidenceIds = evidenceIds;
        assertGoalHierarchy(next);
        break;
      }
      case "set_goal_status": {
        const goal = next.goals[operation.id];
        if (!goal) throw new Error(`unknown goal ${operation.id}`);
        if (terminalGoalStatuses.has(goal.status) && operation.status !== goal.status) {
          throw new Error(`cannot reopen terminal goal ${goal.id}`);
        }
        if (operation.status === goal.status) throw new Error(`goal ${goal.id} already has status ${goal.status}`);
        requireSignificantChange(impact, operation.status !== goal.status, "goal status change");
        goal.status = operation.status;
        goal.updatedAtStep = step;
        goal.evidenceIds = evidenceIds;
        break;
      }
      case "create_commitment": {
        if (next.commitments[operation.commitment.id]) throw new Error(`duplicate commitment ${operation.commitment.id}`);
        assertDelta(0, operation.commitment.priority, numericLimits.motivation[impact], "commitment priority");
        assertLocalIds(belief, operation.commitment.subjectIds, `commitment ${operation.commitment.id}`);
        next.commitments[operation.commitment.id] = {
          ...structuredClone(operation.commitment), status: "active", createdAtStep: step, updatedAtStep: step, evidenceIds,
        };
        break;
      }
      case "update_commitment": {
        if (operation.description === null && operation.priority === null && operation.subjectIds === null) {
          throw new Error("update_commitment must change at least one field");
        }
        const commitment = next.commitments[operation.id];
        if (!commitment || commitment.status !== "active") {
          throw new Error(`update_commitment references terminal ${operation.id}`);
        }
        const meaningChanged = (operation.description !== null && operation.description !== commitment.description) ||
          (operation.subjectIds !== null && !sameIds(operation.subjectIds, commitment.subjectIds));
        const numericChanged = operation.priority !== null && operation.priority !== commitment.priority;
        if (!meaningChanged && !numericChanged) {
          throw new Error(`update_commitment does not change ${commitment.id}`);
        }
        if (operation.priority !== null) {
          assertDelta(commitment.priority, operation.priority, numericLimits.motivation[impact], "commitment priority");
          commitment.priority = operation.priority;
        }
        requireSignificantChange(
          impact,
          meaningChanged,
          "commitment meaning",
        );
        if (operation.description !== null) commitment.description = operation.description;
        if (operation.subjectIds !== null) {
          assertLocalIds(belief, operation.subjectIds, `commitment ${commitment.id}`);
          commitment.subjectIds = [...operation.subjectIds];
        }
        commitment.updatedAtStep = step;
        commitment.evidenceIds = evidenceIds;
        break;
      }
      case "set_commitment_status": {
        const commitment = next.commitments[operation.id];
        if (!commitment) throw new Error(`unknown commitment ${operation.id}`);
        if (commitment.status !== "active" && operation.status !== commitment.status) {
          throw new Error(`cannot reopen terminal commitment ${commitment.id}`);
        }
        if (operation.status === commitment.status) {
          throw new Error(`commitment ${commitment.id} already has status ${commitment.status}`);
        }
        requireSignificantChange(impact, operation.status !== commitment.status, "commitment status change");
        commitment.status = operation.status;
        commitment.updatedAtStep = step;
        commitment.evidenceIds = evidenceIds;
        break;
      }
    }
  }
  validateCharacterState(next, belief, step, `agent ${patch.agentId}`);
  return next;
}
