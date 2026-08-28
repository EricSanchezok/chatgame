import { applyBeliefPatch } from "./belief";
import { applyCharacterPatch } from "./character";
import type {
  AgentActionProposal,
  AgentState,
  BeliefPatch,
  CharacterPatch,
  ObservationPacket,
  WorldEvent,
} from "../contracts/model";

export interface MindCommit {
  beliefPatch: BeliefPatch;
  characterPatch: CharacterPatch;
  nextAction: AgentActionProposal;
}

function mergeBindingsForPatch(agent: AgentState, patch: BeliefPatch): AgentState {
  const next = structuredClone(agent);
  for (const operation of patch.operations) {
    if (operation.kind === "remove_local_entity") {
      delete next.bindings[operation.localEntityId];
      continue;
    }
    if (operation.kind === "split_local_entity") {
      const source = next.bindings[operation.fromId];
      if (source) {
        for (const entity of operation.entities) {
          next.bindings[entity.id] = {
            localEntityId: entity.id,
            canonicalEntityIds: [...source.canonicalEntityIds],
          };
        }
      }
      delete next.bindings[operation.fromId];
      continue;
    }
    if (operation.kind !== "merge_local_entities" || operation.fromId === operation.intoId) continue;
    const from = next.bindings[operation.fromId];
    const into = next.bindings[operation.intoId];
    if (from || into) {
      next.bindings[operation.intoId] = {
        localEntityId: operation.intoId,
        canonicalEntityIds: [...new Set([
          ...(into?.canonicalEntityIds ?? []),
          ...(from?.canonicalEntityIds ?? []),
        ])],
      };
    }
    delete next.bindings[operation.fromId];
  }
  return next;
}

export function applyMindCommit(
  agent: AgentState,
  commit: MindCommit,
  step: number,
  observations: readonly ObservationPacket[],
  events: readonly WorldEvent[],
): AgentState {
  const withBindings = mergeBindingsForPatch(agent, commit.beliefPatch);
  const belief = applyBeliefPatch(withBindings.belief, commit.beliefPatch);
  return {
    ...withBindings,
    belief,
    character: applyCharacterPatch(
      withBindings.character,
      belief,
      commit.characterPatch,
      step,
      observations,
      events,
    ),
    observationCursorStep: step,
    nextAction: structuredClone(commit.nextAction),
  };
}
