import type { CheckVisibility, ObservationPacket, SimulationState } from "../engine/model";

export type WorldRunStatus =
  | "queued"
  | "running"
  | "awaiting_player"
  | "completed"
  | "goal_failed"
  | "step_limit"
  | "cancelled"
  | "failed";

export type PublicObservationPacket = Omit<ObservationPacket, "introductions"> & {
  introductions: Array<{ localEntity: ObservationPacket["introductions"][number]["localEntity"] }>;
};

export type WorldRunEvent =
  | {
      sequence: number;
      type: "run.started";
      at: string;
      payload: { runId: string; text: string };
    }
  | {
      sequence: number;
      type: "check.resolved";
      at: string;
      payload: {
        requestId: string;
        visibility: Exclude<CheckVisibility, "hidden">;
        dice?: number[];
        kept?: number;
        modifier?: number;
        total?: number;
        dc?: number;
        succeeded: boolean;
        margin?: number;
      };
    }
  | {
      sequence: number;
      type: "player.observation";
      at: string;
      payload: PublicObservationPacket;
    }
  | {
      sequence: number;
      type: "step.committed";
      at: string;
      payload: { revision: number; step: number; elapsedSeconds: number };
    }
  | {
      sequence: number;
      type:
        | "run.awaiting_player"
        | "run.completed"
        | "run.goal_failed"
        | "run.step_limit"
        | "run.cancelled";
      at: string;
      payload: { runId: string; revision: number; step: number };
    }
  | {
      sequence: number;
      type: "run.failed";
      at: string;
      payload: { runId: string; message: string; retriable: true };
    };

export type WorldRunEventInput = WorldRunEvent extends infer Event
  ? Event extends WorldRunEvent
    ? Omit<Event, "sequence" | "at">
    : never
  : never;

export interface WorldRunRecord {
  id: string;
  sessionId: string;
  text: string;
  status: WorldRunStatus;
  createdAt: string;
  updatedAt: string;
  cancelRequested: boolean;
  error?: string;
  events: WorldRunEvent[];
}

export interface WorldSessionDocument {
  schemaVersion: 1;
  id: string;
  scriptId: string;
  createdAt: string;
  updatedAt: string;
  state: SimulationState;
  runs: Record<string, WorldRunRecord>;
}

export interface PublicSessionSnapshot {
  id: string;
  scriptId: string;
  revision: number;
  step: number;
  elapsedSeconds: number;
  player: SimulationState["player"]["knowledge"];
  activeIntent?: SimulationState["player"]["intent"];
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
