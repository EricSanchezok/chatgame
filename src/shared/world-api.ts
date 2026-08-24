export const WORLD_API_VERSION = 4 as const;

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

export const WORLD_RUN_EXECUTING_STATUSES = ["queued", "running"] as const satisfies readonly WorldRunStatus[];
export const WORLD_RUN_STREAM_BOUNDARY_STATUSES = [
  "awaiting_player",
  "completed",
  "goal_failed",
  "step_limit",
  "cancelled",
  "failed",
] as const satisfies readonly WorldRunStatus[];
export const WORLD_RUN_ACTIVE_INTENT_OWNER_STATUSES = [
  ...WORLD_RUN_EXECUTING_STATUSES,
  "awaiting_player",
  "step_limit",
  "failed",
] as const satisfies readonly WorldRunStatus[];

export type WorldRunExecutingStatus = typeof WORLD_RUN_EXECUTING_STATUSES[number];
export type WorldRunStreamBoundaryStatus = typeof WORLD_RUN_STREAM_BOUNDARY_STATUSES[number];
export type WorldRunActiveIntentOwnerStatus = typeof WORLD_RUN_ACTIVE_INTENT_OWNER_STATUSES[number];

const executingStatuses = new Set<WorldRunStatus>(WORLD_RUN_EXECUTING_STATUSES);
const streamBoundaryStatuses = new Set<WorldRunStatus>(WORLD_RUN_STREAM_BOUNDARY_STATUSES);
const activeIntentOwnerStatuses = new Set<WorldRunStatus>(WORLD_RUN_ACTIVE_INTENT_OWNER_STATUSES);

export function isWorldRunExecuting(status: WorldRunStatus): status is WorldRunExecutingStatus {
  return executingStatuses.has(status);
}

export function isWorldRunStreamBoundary(status: WorldRunStatus): status is WorldRunStreamBoundaryStatus {
  return streamBoundaryStatuses.has(status);
}

export function isWorldRunActiveIntentOwner(status: WorldRunStatus): status is WorldRunActiveIntentOwnerStatus {
  return activeIntentOwnerStatuses.has(status);
}

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
      payload: { runId: string; message: string; retriable: boolean };
    };

export type WorldRunFailureEvent = Extract<WorldRunEvent, { type: "run.failed" }>;

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

export function latestWorldRunFailure(
  run: Pick<WorldRunRecordView, "events">,
): WorldRunFailureEvent | undefined {
  const event = run.events.at(-1);
  return event?.type === "run.failed" ? event : undefined;
}

export function isWorldRunRetriable(
  run: Pick<WorldRunRecordView, "status" | "events">,
): boolean {
  return run.status === "step_limit" ||
    (run.status === "failed" && latestWorldRunFailure(run)?.payload.retriable === true);
}
