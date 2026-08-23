import type { SimulationState } from "../engine/model";
import type {
  PublicSessionDetail,
  PublicSessionState,
  PublicSessionSummary,
  WorldRunEvent,
  WorldRunRecordView,
  WorldRunSnapshot,
  WorldSummary,
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

export interface WorldRunRecord extends Omit<WorldRunRecordView, "error"> {
  intentId: string;
  error?: string;
  internalError?: string;
}

export interface WorldSessionDocument {
  schemaVersion: 4;
  id: string;
  scriptId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  state: SimulationState;
  runs: Record<string, WorldRunRecord>;
}

export function publicSessionState(document: WorldSessionDocument): PublicSessionState {
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

export function publicSessionSummary(
  document: WorldSessionDocument,
  world: WorldSummary,
): PublicSessionSummary {
  const activeRun = Object.values(document.runs).find(
    (run) => run.status === "queued" || run.status === "running",
  );
  return {
    id: document.id,
    scriptId: document.scriptId,
    title: document.title,
    world: structuredClone(world),
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
    revision: document.state.revision,
    step: document.state.step,
    elapsedSeconds: document.state.truth.elapsedSeconds,
    activeRun: activeRun ? {
      id: activeRun.id,
      status: activeRun.status === "queued" ? "queued" : "running",
    } : undefined,
  };
}

export function publicWorldRunRecord(run: WorldRunRecord): WorldRunRecordView {
  return {
    id: run.id,
    sessionId: run.sessionId,
    text: run.text,
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

export function publicSessionDetail(
  document: WorldSessionDocument,
  world: WorldSummary,
): PublicSessionDetail {
  return {
    summary: publicSessionSummary(document, world),
    state: publicSessionState(document),
    runs: Object.values(document.runs)
      .map(publicWorldRunRecord)
      .sort((left, right) =>
        left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id)),
  };
}
