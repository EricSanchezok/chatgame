import type {
  AgentState,
  ApparentClaim,
  BeliefEvidence,
  ObservationPacket,
  PlayerKnowledgeState,
  SimulationState,
} from "./model";

function assertLocalClaimReferences(
  localEntities: Record<string, unknown>,
  claim: ApparentClaim,
  packetId: string,
): void {
  if (!localEntities[claim.subjectId]) {
    throw new Error(`observation ${packetId} references unknown local subject ${claim.subjectId}; introduce that private local id in the same packet or use an existing observer-local id`);
  }
  if (claim.value.kind === "local_entity" && !localEntities[claim.value.localEntityId]) {
    throw new Error(`observation ${packetId} references unknown local value ${claim.value.localEntityId}; introduce that private local id in the same packet or use an existing observer-local id`);
  }
}

export function validateObservations(
  state: SimulationState,
  packets: readonly ObservationPacket[],
  expectedStep = state.step + 1,
): void {
  const ids = new Set(state.history.flatMap((committed) =>
    committed.observations.map((observation) => observation.id)));
  for (const packet of packets) {
    if (ids.has(packet.id)) throw new Error(`duplicate observation id ${packet.id}`);
    ids.add(packet.id);
    if (packet.observerId !== "player" && !state.agents[packet.observerId]) {
      throw new Error(`observation ${packet.id} has unknown observer ${packet.observerId}`);
    }
    if (packet.step !== expectedStep) {
      throw new Error(`observation ${packet.id} targets step ${packet.step}; expected ${expectedStep}`);
    }
    const existing = packet.observerId === "player"
      ? state.player.knowledge.localEntities
      : state.agents[packet.observerId].belief.localEntities;
    const localEntities: Record<string, unknown> = { ...existing };
    for (const introduction of packet.introductions) {
      if (state.truth.entities[introduction.localEntity.id]) {
        throw new Error(`observation ${packet.id} uses canonical id ${introduction.localEntity.id} as a local identity; rename localEntity.id while keeping canonicalEntityId private`);
      }
      localEntities[introduction.localEntity.id] = introduction.localEntity;
      if (introduction.canonicalEntityId && !state.truth.entities[introduction.canonicalEntityId]) {
        throw new Error(`observation ${packet.id} introduces unknown canonical entity`);
      }
    }
    for (const claim of packet.apparentClaims) {
      assertLocalClaimReferences(localEntities, claim, packet.id);
    }
  }
}

export function applyObservationBindings(agent: AgentState, packets: readonly ObservationPacket[]): AgentState {
  const next = structuredClone(agent);
  for (const packet of packets) {
    for (const introduction of packet.introductions) {
      next.belief.localEntities[introduction.localEntity.id] = structuredClone(introduction.localEntity);
      if (!introduction.canonicalEntityId) continue;
      const current = next.bindings[introduction.localEntity.id];
      const canonicalEntityIds = new Set(current?.canonicalEntityIds ?? []);
      canonicalEntityIds.add(introduction.canonicalEntityId);
      next.bindings[introduction.localEntity.id] = {
        localEntityId: introduction.localEntity.id,
        canonicalEntityIds: [...canonicalEntityIds],
      };
    }
  }
  return next;
}

export function ingestPlayerObservations(
  source: PlayerKnowledgeState,
  packets: readonly ObservationPacket[],
): PlayerKnowledgeState {
  const next = structuredClone(source);
  for (const packet of packets) {
    if (packet.observerId !== "player") continue;
    if (!next.observationIds.includes(packet.id)) next.observationIds.push(packet.id);
    for (const introduction of packet.introductions) {
      next.localEntities[introduction.localEntity.id] = structuredClone(introduction.localEntity);
    }
    const evidence: BeliefEvidence = {
      id: `observation:${packet.id}`,
      kind: "observation",
      description: packet.summary,
      sourceId: packet.id,
      step: packet.step,
    };
    next.evidence[evidence.id] = evidence;
    for (const claim of packet.apparentClaims) {
      next.claims[claim.id] = {
        ...structuredClone(claim),
        evidenceIds: [evidence.id],
      };
    }
  }
  return next;
}
