import type { HistoryReplayBase, SimulationState } from "./model";
import { contentHash } from "./model-audit";

export function createHistoryReplayBase(state: SimulationState): HistoryReplayBase {
  if (state.historyBase) return structuredClone(state.historyBase);
  return {
    truth: structuredClone(state.truth),
    agentEntities: Object.fromEntries(Object.values(state.agents)
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((agent) => [agent.id, agent.entityId])),
    playerEntityId: state.player.entityId,
  };
}

export function historyReplayBaseHash(state: SimulationState): string {
  return contentHash(createHistoryReplayBase(state));
}
