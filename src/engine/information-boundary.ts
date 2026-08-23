import type { ActionOutcome, ObservationPacket, SimulationState, TransitionProposal } from "./model";

function playerVisibleCorpus(state: SimulationState): string {
  const values: string[] = [];
  const knowledge = state.player.knowledge;
  for (const entity of Object.values(knowledge.localEntities)) {
    values.push(entity.id, entity.name, entity.description);
  }
  for (const evidence of Object.values(knowledge.evidence)) {
    values.push(evidence.id, evidence.description, evidence.sourceId ?? "");
  }
  for (const claim of Object.values(knowledge.claims)) {
    values.push(claim.id, claim.subjectId, claim.predicate, claim.description);
    if (claim.value.kind === "text") values.push(claim.value.value);
    if (claim.value.kind === "local_entity") values.push(claim.value.localEntityId);
  }
  return values.join("\n").toLocaleLowerCase();
}

function protectedTokens(state: SimulationState): Set<string> {
  const tokens = new Set<string>();
  const visible = playerVisibleCorpus(state);
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

function publicText(packet: ObservationPacket, outcome: ActionOutcome): string {
  const values = [packet.summary, outcome.summary];
  for (const introduction of packet.introductions) {
    values.push(introduction.localEntity.name, introduction.localEntity.description);
  }
  for (const claim of packet.apparentClaims) {
    values.push(claim.description);
    if (claim.value.kind === "text") values.push(claim.value.value);
  }
  for (const alternative of outcome.knownAlternatives) values.push(alternative.description);
  return values.join("\n").toLocaleLowerCase();
}

export function validatePublicInformationBoundary(
  state: SimulationState,
  actions: readonly { id: string; actorId: string }[],
  proposal: TransitionProposal,
): void {
  const playerAction = actions.find((action) => action.actorId === "player");
  const outcome = playerAction && proposal.outcomes.find((candidate) => candidate.proposalId === playerAction.id);
  const packets = proposal.observations.filter((packet) => packet.observerId === "player");
  if (!outcome || packets.length === 0) throw new Error("player public output is incomplete");
  const text = packets.map((packet) => publicText(packet, outcome)).join("\n");
  for (const token of protectedTokens(state)) {
    if (text.includes(token)) throw new Error("player public output contains protected world information");
  }
}
