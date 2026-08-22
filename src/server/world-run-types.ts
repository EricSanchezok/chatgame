import type { SimulationState } from "../engine/model";
import type {
  PublicSessionSnapshot,
  WorldRunEvent,
  WorldRunRecordView,
} from "../shared/world-api";
export type {
  PublicObservationPacket,
  PublicSessionSnapshot,
  WorldRunEvent,
  WorldRunStatus,
} from "../shared/world-api";

export type WorldRunEventInput = WorldRunEvent extends infer Event
  ? Event extends WorldRunEvent
    ? Omit<Event, "sequence" | "at">
    : never
  : never;

export type WorldRunRecord = WorldRunRecordView;

export interface WorldSessionDocument {
  schemaVersion: 1;
  id: string;
  scriptId: string;
  createdAt: string;
  updatedAt: string;
  state: SimulationState;
  runs: Record<string, WorldRunRecord>;
}

export function publicSessionSnapshot(document: WorldSessionDocument): PublicSessionSnapshot {
  return {
    id: document.id,
    scriptId: document.scriptId,
    revision: document.state.revision,
    step: document.state.step,
    elapsedSeconds: document.state.truth.elapsedSeconds,
    player: structuredClone(document.state.player.knowledge),
    activeIntent: structuredClone(document.state.player.intent),
  };
}
