import type { SimulationState } from "../engine/model";
import type { WorldRuntimeContract } from "../engine/world-definition";
import type {
  PublicSessionSnapshot,
  WorldRunEvent,
  WorldRunRecordView,
  WorldRunSnapshot,
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

export interface WorldRunRecord extends Omit<WorldRunRecordView, "error" | "inputs"> {
  intentId: string;
  error?: string;
  internalError?: string;
}

export interface WorldSessionDocument {
  schemaVersion: 4;
  id: string;
  world: WorldRuntimeContract;
  createdAt: string;
  updatedAt: string;
  state: SimulationState;
  runs: Record<string, WorldRunRecord>;
}

export function publicSessionSnapshot(document: WorldSessionDocument): PublicSessionSnapshot {
  return {
    id: document.id,
    worldId: document.world.id,
    worldHash: document.world.contentHash,
    worldVersion: document.world.manifestVersion,
    revision: document.state.revision,
    step: document.state.step,
    elapsedSeconds: document.state.truth.elapsedSeconds,
    player: structuredClone(document.state.player.knowledge),
    activeIntent: structuredClone(document.state.player.intent),
  };
}

export function publicWorldRunRecord(run: WorldRunRecord): WorldRunRecordView {
  return {
    id: run.id,
    sessionId: run.sessionId,
    inputs: run.events.flatMap((event) => event.type === "player.input"
      ? [{ ...event.payload, at: event.at }]
      : []),
    status: run.status,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    cancelRequested: run.cancelRequested,
    error: run.error,
    events: structuredClone(run.events),
  };
}

export function publicWorldRunSnapshot(
  document: WorldSessionDocument,
  run: WorldRunRecord,
): WorldRunSnapshot {
  return {
    run: publicWorldRunRecord(run),
    state: publicSessionSnapshot(document),
  };
}
