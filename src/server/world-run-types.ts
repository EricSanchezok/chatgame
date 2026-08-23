import type { SimulationState } from "../engine/model";
import type { WorldRuntimeContract } from "../engine/world-definition";
import type {
  PublicSessionDetail,
  PublicSessionState,
  PublicSessionSummary,
  WorldRunEvent,
  WorldRunRecordView,
  WorldRunSnapshot,
} from "../shared/world-api";
export type {
  PublicObservationPacket,
  PublicSessionDetail,
  PublicSessionState,
  PublicSessionSummary,
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
  schemaVersion: 7;
  id: string;
  world: WorldRuntimeContract;
  title: string;
  createdAt: string;
  updatedAt: string;
  state: SimulationState;
  runs: Record<string, WorldRunRecord>;
}

export function publicSessionState(document: WorldSessionDocument): PublicSessionState {
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

function publicWorldSummary(document: WorldSessionDocument) {
  return {
    id: document.world.id,
    name: document.world.name,
    version: document.world.manifestVersion,
    contentHash: document.world.contentHash,
    description: document.world.description,
  };
}

export function publicSessionSummary(document: WorldSessionDocument): PublicSessionSummary {
  const activeRun = Object.values(document.runs).find(
    (run) => run.status === "queued" || run.status === "running",
  );
  return {
    id: document.id,
    worldId: document.world.id,
    title: document.title,
    world: publicWorldSummary(document),
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
    revision: document.state.revision,
    step: document.state.step,
    elapsedSeconds: document.state.truth.elapsedSeconds,
    activeRun: activeRun ? { id: activeRun.id, status: activeRun.status as "queued" | "running" } : undefined,
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
    state: publicSessionState(document),
  };
}

export function publicSessionDetail(document: WorldSessionDocument): PublicSessionDetail {
  return {
    summary: publicSessionSummary(document),
    state: publicSessionState(document),
    runs: Object.values(document.runs)
      .map(publicWorldRunRecord)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id)),
  };
}
