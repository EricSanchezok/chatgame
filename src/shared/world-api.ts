export const WORLD_API_VERSION = 3 as const;

export interface WorldSummary {
  id: string;
  name: string;
  version: string;
  contentHash: string;
  description: string;
}

export interface LocalEntityView {
  id: string;
  name: string;
  description: string;
  status: "observed" | "reported" | "hypothesized";
}

export type BeliefValueView =
  | { kind: "text"; value: string }
  | { kind: "number"; value: number }
  | { kind: "boolean"; value: boolean }
  | { kind: "local_entity"; localEntityId: string }
  | { kind: "none" };

export interface PlayerKnowledgeView {
  localEntities: Record<string, LocalEntityView>;
  claims: Record<string, {
    id: string;
    subjectId: string;
    predicate: string;
    value: BeliefValueView;
    description: string;
    evidenceIds: string[];
  }>;
  evidence: Record<string, {
    id: string;
    kind: "observation" | "testimony" | "inference" | "assumption";
    description: string;
    sourceId?: string | null;
    step: number;
  }>;
  observationIds: string[];
}

export interface PlayerIntentView {
  id: string;
  goal: string;
  latestInput: {
    id: string;
    text: string;
    kind: "goal" | "clarification";
    submittedAtStep: number;
  };
  status: "active" | "completed" | "failed" | "cancelled";
  startedAtStep: number;
}

export interface PublicSessionState {
  id: string;
  worldId: string;
  worldHash: string;
  worldVersion: string;
  revision: number;
  step: number;
  elapsedSeconds: number;
  player: PlayerKnowledgeView;
  activeIntent?: PlayerIntentView;
}

export interface PublicSessionSummary {
  id: string;
  worldId: string;
  title: string;
  world: WorldSummary;
  createdAt: string;
  updatedAt: string;
  revision: number;
  step: number;
  elapsedSeconds: number;
  activeRun?: {
    id: string;
    status: "queued" | "running";
  };
}

export type WorldRunStatus =
  | "queued"
  | "running"
  | "awaiting_player"
  | "completed"
  | "goal_failed"
  | "step_limit"
  | "cancelled"
  | "failed";

export interface PublicObservationPacket {
  id: string;
  observerId: "player";
  step: number;
  summary: string;
  introductions: Array<{ localEntity: LocalEntityView }>;
  apparentClaims: Array<{
    id: string;
    subjectId: string;
    predicate: string;
    value: BeliefValueView;
    description: string;
  }>;
  sourceEventIds: string[];
}

export interface PublicActionOutcome {
  status: "succeeded" | "partial" | "failed" | "blocked" | "continuing";
  summary: string;
}

export type WorldRunEvent =
  | {
      sequence: number;
      type: "player.input";
      at: string;
      payload: {
        id: string;
        kind: "goal" | "clarification";
        text: string;
      };
    }
  | {
      sequence: number;
      type: "run.execution_started";
      at: string;
      payload: {
        runId: string;
        inputId: string;
        reason: "initial" | "player_input" | "retry";
      };
    }
  | {
      sequence: number;
      type: "player.outcome";
      at: string;
      payload: PublicActionOutcome;
    }
  | {
      sequence: number;
      type: "check.resolved";
      at: string;
      payload: {
        requestId: string;
        visibility: "full" | "result_only";
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

export interface WorldRunRecordView {
  id: string;
  sessionId: string;
  inputs: Array<{
    id: string;
    kind: "goal" | "clarification";
    text: string;
    at: string;
  }>;
  status: WorldRunStatus;
  createdAt: string;
  updatedAt: string;
  cancelRequested: boolean;
  error?: string;
  events: WorldRunEvent[];
}

export interface PublicSessionDetail {
  summary: PublicSessionSummary;
  state: PublicSessionState;
  runs: WorldRunRecordView[];
}

export interface StartWorldRunResponse {
  runId: string;
}

export interface ContinueWorldRunInput {
  id: string;
  text: string;
}

export interface WorldRunSnapshot {
  run: WorldRunRecordView;
  state: PublicSessionState;
}
