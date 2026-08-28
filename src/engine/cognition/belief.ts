import type {
  AgentBeliefState,
  BeliefClaim,
  BeliefPatch,
  BeliefValue,
  LocalEntityId,
} from "../contracts/model";
import { isSafeId } from "../contracts/state-schemas";
import { contentHash } from "../models/model-audit";

function assertSafeId(value: string): void {
  if (!isSafeId(value)) throw new Error(`belief id ${value} uses a reserved object key`);
}

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
    if ("localEntityId" in operation) assertSafeId(operation.localEntityId);
    if ("claimId" in operation) assertSafeId(operation.claimId);
    if ("fromId" in operation) assertSafeId(operation.fromId);
    if ("intoId" in operation) assertSafeId(operation.intoId);
    switch (operation.kind) {
      case "upsert_local_entity":
        assertSafeId(operation.entity.id);
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
        assertSafeId(operation.evidence.id);
        if (next.evidence[operation.evidence.id] &&
          contentHash(next.evidence[operation.evidence.id]) !== contentHash(operation.evidence)) {
          throw new Error(`belief evidence ${operation.evidence.id} is append-only`);
        }
        next.evidence[operation.evidence.id] = structuredClone(operation.evidence);
        break;
      case "upsert_claim":
        assertSafeId(operation.claim.id);
        assertClaimReferencesExist(next, operation.claim);
        if (next.claims[operation.claim.id] &&
          (next.claims[operation.claim.id].subjectId !== operation.claim.subjectId ||
            next.claims[operation.claim.id].predicate !== operation.claim.predicate)) {
          throw new Error(`belief claim ${operation.claim.id} cannot change identity`);
        }
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
          assertSafeId(entity.id);
          if (entity.id === operation.fromId || replacementIds.has(entity.id) || next.localEntities[entity.id]) {
            throw new Error(`split local entity has duplicate replacement ${entity.id}`);
          }
          replacementIds.add(entity.id);
        }
        for (const assignment of operation.assignments) {
          assertSafeId(assignment.claimId);
          if (assignment.subjectId) assertSafeId(assignment.subjectId);
          if (assignment.valueId) assertSafeId(assignment.valueId);
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
