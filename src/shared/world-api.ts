export const WORLD_API_VERSION = 1 as const;

export interface WorldSummary {
  id: string;
  name: string;
  version: string;
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
    sourceId?: string;
    step: number;
  }>;
  observationIds: string[];
}

export interface PlayerIntentView {
  id: string;
  rawText: string;
  goal: string;
  status: "active" | "completed" | "failed" | "cancelled";
  startedAtStep: number;
}

export interface PublicSessionSnapshot {
  id: string;
  scriptId: string;
  revision: number;
  step: number;
  elapsedSeconds: number;
  player: PlayerKnowledgeView;
  activeIntent?: PlayerIntentView;
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
  text: string;
  status: WorldRunStatus;
  createdAt: string;
  updatedAt: string;
  cancelRequested: boolean;
  error?: string;
  events: WorldRunEvent[];
}
