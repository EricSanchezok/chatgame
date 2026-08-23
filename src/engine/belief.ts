import type {
  AgentBeliefState,
  BeliefClaim,
  BeliefPatch,
  BeliefValue,
  LocalEntityId,
} from "./model";

function replaceLocalReference(value: BeliefValue, fromId: LocalEntityId, intoId: LocalEntityId): BeliefValue {
  return value.kind === "local_entity" && value.localEntityId === fromId
    ? { kind: "local_entity", localEntityId: intoId }
    : value;
}

function assertClaimReferencesExist(state: AgentBeliefState, claim: BeliefClaim): void {
  if (!state.localEntities[claim.subjectId]) {
    throw new Error(`belief claim ${claim.id} references unknown subject ${claim.subjectId}`);
  }
  if (claim.value.kind === "local_entity" && !state.localEntities[claim.value.localEntityId]) {
    throw new Error(`belief claim ${claim.id} references unknown value ${claim.value.localEntityId}`);
  }
  if (!Number.isFinite(claim.confidence) || claim.confidence < 0 || claim.confidence > 1) {
    throw new Error(`belief claim ${claim.id} has invalid confidence`);
  }
  for (const evidenceId of claim.evidenceIds) {
    if (!state.evidence[evidenceId]) {
      throw new Error(`belief claim ${claim.id} references unknown evidence ${evidenceId}`);
    }
  }
}

export function applyBeliefPatch(
  source: AgentBeliefState,
  patch: BeliefPatch,
): AgentBeliefState {
  const next: AgentBeliefState = structuredClone(source);

  for (const operation of patch.operations) {
    switch (operation.kind) {
      case "upsert_local_entity":
        next.localEntities[operation.entity.id] = structuredClone(operation.entity);
        break;
      case "remove_local_entity": {
        const referenced = Object.values(next.claims).some(
          (claim) =>
            claim.subjectId === operation.localEntityId ||
            (claim.value.kind === "local_entity" && claim.value.localEntityId === operation.localEntityId),
        );
        if (referenced) {
          throw new Error(`cannot remove referenced local entity ${operation.localEntityId}`);
        }
        delete next.localEntities[operation.localEntityId];
        break;
      }
      case "upsert_evidence":
        next.evidence[operation.evidence.id] = structuredClone(operation.evidence);
        break;
      case "upsert_claim":
        assertClaimReferencesExist(next, operation.claim);
        next.claims[operation.claim.id] = structuredClone(operation.claim);
        break;
      case "remove_claim":
        delete next.claims[operation.claimId];
        break;
      case "merge_local_entities": {
        if (operation.fromId === operation.intoId) break;
        if (!next.localEntities[operation.fromId] || !next.localEntities[operation.intoId]) {
          throw new Error(`cannot merge unknown local entities ${operation.fromId} -> ${operation.intoId}`);
        }
        for (const claim of Object.values(next.claims)) {
          if (claim.subjectId === operation.fromId) claim.subjectId = operation.intoId;
          claim.value = replaceLocalReference(claim.value, operation.fromId, operation.intoId);
        }
        delete next.localEntities[operation.fromId];
        break;
      }
      case "split_local_entity": {
        if (!next.localEntities[operation.fromId]) {
          throw new Error(`cannot split unknown local entity ${operation.fromId}`);
        }
        const replacementIds = new Set<string>();
        for (const entity of operation.entities) {
          if (entity.id === operation.fromId || replacementIds.has(entity.id) || next.localEntities[entity.id]) {
            throw new Error(`split local entity has duplicate replacement ${entity.id}`);
          }
          replacementIds.add(entity.id);
        }
        const assignments = new Map(operation.assignments.map((assignment) => [assignment.claimId, assignment]));
        if (assignments.size !== operation.assignments.length) {
          throw new Error(`split local entity ${operation.fromId} has duplicate claim assignments`);
        }
        for (const entity of operation.entities) next.localEntities[entity.id] = structuredClone(entity);
        for (const claim of Object.values(next.claims)) {
          const replacesSubject = claim.subjectId === operation.fromId;
          const replacesValue = claim.value.kind === "local_entity" && claim.value.localEntityId === operation.fromId;
          if (!replacesSubject && !replacesValue) continue;
          const assignment = assignments.get(claim.id);
          if (!assignment) throw new Error(`split local entity ${operation.fromId} does not assign claim ${claim.id}`);
          if (replacesSubject) {
            if (!assignment.subjectId || !replacementIds.has(assignment.subjectId)) {
              throw new Error(`split claim ${claim.id} has an invalid subject assignment`);
            }
            claim.subjectId = assignment.subjectId;
          }
          if (replacesValue) {
            if (!assignment.valueId || !replacementIds.has(assignment.valueId)) {
              throw new Error(`split claim ${claim.id} has an invalid value assignment`);
            }
            claim.value = { kind: "local_entity", localEntityId: assignment.valueId };
          }
        }
        for (const assignment of operation.assignments) {
          const claim = next.claims[assignment.claimId];
          if (!claim) throw new Error(`split references unknown claim ${assignment.claimId}`);
        }
        delete next.localEntities[operation.fromId];
        break;
      }
    }
  }

  for (const claim of Object.values(next.claims)) assertClaimReferencesExist(next, claim);
  return next;
}
