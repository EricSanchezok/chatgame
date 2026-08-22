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
    }
  }

  for (const claim of Object.values(next.claims)) assertClaimReferencesExist(next, claim);
  return next;
}
