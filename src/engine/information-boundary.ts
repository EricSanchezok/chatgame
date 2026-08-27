import type { ObservationPacket, SimulationState, TransitionProposal } from "./model";

function observerVisibleCorpus(state: SimulationState, observerId: string): string {
  const values: string[] = [];
  const belief = state.agents[observerId]?.belief;
  if (!belief) return "";
  for (const entity of Object.values(belief.localEntities)) {
    values.push(entity.id, entity.name, entity.description);
  }
  for (const evidence of Object.values(belief.evidence)) {
    values.push(evidence.id, evidence.description, evidence.sourceId ?? "");
  }
  for (const claim of Object.values(belief.claims)) {
    values.push(claim.id, claim.subjectId, claim.predicate, claim.description);
    if (claim.value.kind === "text") values.push(claim.value.value);
    if (claim.value.kind === "local_entity") values.push(claim.value.localEntityId);
  }
  return values.join("\n").toLocaleLowerCase();
}

function protectedTokens(state: SimulationState, observerId: string): Set<string> {
  const tokens = new Set<string>();
  const visible = observerVisibleCorpus(state, observerId);
  const protect = (value: unknown): void => {
    if (typeof value !== "string") return;
    const normalized = value.trim().toLocaleLowerCase();
    if (normalized.length >= 3 && !visible.includes(normalized)) tokens.add(normalized);
  };

  for (const entityId of Object.keys(state.truth.entities)) protect(entityId);
  for (const fact of Object.values(state.truth.facts)) {
    if (fact.access.kind === "public") continue;
    protect(fact.id);
    protect(fact.description);
    if (fact.value.kind === "text") protect(fact.value.value);
    if (fact.value.kind === "entity") protect(fact.value.entityId);
  }
  for (const agent of Object.values(state.agents)) {
    if (agent.id === observerId) continue;
    for (const profileId of Object.values(agent.modelProfiles)) protect(profileId);
    protect(agent.character.persona.summary);
    protect(agent.character.persona.voice);
    for (const collection of [
      agent.character.traits,
      agent.character.values,
      agent.character.emotions,
      agent.character.attitudes,
      agent.character.goals,
      agent.character.commitments,
    ]) {
      for (const record of Object.values(collection)) {
        protect(record.id);
        protect(record.description);
      }
    }
    for (const entity of Object.values(agent.belief.localEntities)) {
      protect(entity.id);
      protect(entity.description);
    }
    for (const claim of Object.values(agent.belief.claims)) {
      protect(claim.id);
      protect(claim.description);
      if (claim.value.kind === "text") protect(claim.value.value);
      if (claim.value.kind === "local_entity") protect(claim.value.localEntityId);
    }
  }
  return tokens;
}

function publicText(packet: Pick<ObservationPacket, "summary" | "introductions" | "apparentClaims">): string {
  const values = [packet.summary];
  for (const introduction of packet.introductions) {
    values.push(introduction.localEntity.name, introduction.localEntity.description);
  }
  for (const claim of packet.apparentClaims) {
    values.push(claim.description);
    if (claim.value.kind === "text") values.push(claim.value.value);
  }
  return values.join("\n").toLocaleLowerCase();
}

export function validatePublicInformationBoundary(
  state: SimulationState,
  actions: readonly { id: string; actorId: string }[],
  proposal: TransitionProposal,
): void {
  for (const observerId of new Set(proposal.observations.map((packet) => packet.observerId))) {
    if (!state.agents[observerId]) throw new Error(`observation targets unknown agent ${observerId}`);
    const packets = proposal.observations.filter((packet) => packet.observerId === observerId);
    const text = packets.map(publicText).join("\n");
    for (const token of protectedTokens(state, observerId)) {
      if (text.includes(token)) throw new Error(`observation for ${observerId} contains protected information`);
    }
  }
}
