import type {
  AgentState,
  CanonicalWorldState,
  CommittedStep,
  ModelExecutionAudit,
  PlayerState,
} from "../engine/model";
import type {
  RuntimeEvent,
  RuntimeObservabilityMode,
} from "../engine/observability";

export const WORLD_INSPECTOR_API_VERSION = 2 as const;

export type WorldInspectorNodeKind =
  | "commit"
  | "action"
  | "reaction"
  | "check"
  | "random"
  | "mechanic"
  | "operation"
  | "event"
  | "observation"
  | "mind"
  | "attempt";

export type WorldInspectorEdgeKind =
  | "temporal"
  | "causal"
  | "observes"
  | "updates"
  | "commits"
  | "rollback";

export interface WorldInspectorActor {
  id: string;
  entityId: string;
  kind: "player" | "agent";
  name: string;
  description: string;
  lifecycle: "active" | "retired";
}

export interface WorldInspectorNodeSummary {
  id: string;
  revision: number;
  laneId: string;
  kind: WorldInspectorNodeKind;
  label: string;
  description: string;
  status?: "succeeded" | "partial" | "failed" | "blocked" | "continuing" | "active" | "rolled_back";
  count?: number;
  relatedActorIds?: string[];
}

export interface WorldInspectorEdgeSummary {
  id: string;
  source: string;
  target: string;
  kind: WorldInspectorEdgeKind;
  label?: string;
}

export interface WorldInspectorTokenUsage {
  input: number;
  output: number;
  total: number;
  unknown: boolean;
}

export interface WorldInspectorStepSummary {
  revision: number;
  step: number;
  contentHash: string;
  elapsedSeconds: number;
  playerGoal: string;
  actorIds: string[];
  counts: {
    actions: number;
    reactions: number;
    checks: number;
    random: number;
    mechanics: number;
    operations: number;
    events: number;
    observations: number;
    mindUpdates: number;
    modelInvocations: number;
  };
  tokenUsage: WorldInspectorTokenUsage;
  nodeIds: string[];
}

export type WorldInspectorAttemptStatus = "active" | "committed" | "rolled_back" | "failed" | "cancelled";

export type WorldInspectorAttemptStageStatus = "active" | "succeeded" | "failed";

export interface WorldInspectorAttemptStage {
  id: string;
  label: string;
  status: WorldInspectorAttemptStageStatus;
  startedAt: string;
  updatedAt: string;
  eventCount: number;
  modelInvocationCount: number;
  rejectionCount: number;
  repairCount: number;
  modelRole?: string;
  errorMessage?: string;
}

export interface WorldInspectorAttemptSummary {
  id: string;
  runId?: string;
  runAttempt?: number;
  revision?: number;
  step?: number;
  status: WorldInspectorAttemptStatus;
  startedAt: string;
  updatedAt: string;
  terminalAt?: string;
  durationMs?: number;
  latestEvent: string;
  eventCount: number;
  modelInvocationCount: number;
  actorIds: string[];
  relatedActorIds: string[];
  rejectionCount: number;
  repairCount: number;
  failureStage?: string;
  failureStageLabel?: string;
  rollbackVerified?: boolean;
  errorMessage?: string;
}

export interface WorldInspectorRuntimeEventSummary extends Omit<RuntimeEvent, "payload"> {
  id: string;
  hasPayload: boolean;
}

export interface WorldInspectorRuntimeEventDetail {
  apiVersion: typeof WORLD_INSPECTOR_API_VERSION;
  event: RuntimeEvent;
}

export interface WorldInspectorTraceAvailability {
  mode: RuntimeObservabilityMode;
  degraded: boolean;
  retainedEventCount: number;
  earliestTimestamp?: string;
  latestTimestamp?: string;
  hasFullPayload: boolean;
}

export interface WorldInspectorWindow {
  apiVersion: typeof WORLD_INSPECTOR_API_VERSION;
  session: {
    id: string;
    title: string;
    worldId: string;
    worldName: string;
    worldHash: string;
    revision: number;
    step: number;
    elapsedSeconds: number;
    updatedAt: string;
  };
  actors: WorldInspectorActor[];
  steps: WorldInspectorStepSummary[];
  nodes: WorldInspectorNodeSummary[];
  edges: WorldInspectorEdgeSummary[];
  attempts: WorldInspectorAttemptSummary[];
  trace: WorldInspectorTraceAvailability;
  pagination: {
    limit: number;
    hasOlder: boolean;
    oldestRevision?: number;
    newestRevision?: number;
  };
}

export interface WorldInspectorStateSnapshot {
  revision: number;
  step: number;
  truth: CanonicalWorldState;
  agents: Record<string, AgentState>;
  player: PlayerState;
}

export interface WorldInspectorStepDetail {
  apiVersion: typeof WORLD_INSPECTOR_API_VERSION;
  summary: WorldInspectorStepSummary;
  committed: CommittedStep & { modelAudits: ModelExecutionAudit[] };
  before: WorldInspectorStateSnapshot;
  after: WorldInspectorStateSnapshot;
  runtimeEvents: WorldInspectorRuntimeEventSummary[];
  trace: WorldInspectorTraceAvailability;
}

export interface WorldInspectorAttemptDetail {
  apiVersion: typeof WORLD_INSPECTOR_API_VERSION;
  summary: WorldInspectorAttemptSummary;
  attemptedActions: CommittedStep["initialActions"];
  stages: WorldInspectorAttemptStage[];
  events: WorldInspectorRuntimeEventSummary[];
  trace: WorldInspectorTraceAvailability;
}

export type WorldInspectorStreamEvent =
  | { type: "runtime"; epoch: string; event: WorldInspectorRuntimeEventSummary }
  | { type: "resync"; epoch: string; reason: "epoch_changed" | "cursor_expired" }
  | { type: "heartbeat"; epoch: string; at: string };
