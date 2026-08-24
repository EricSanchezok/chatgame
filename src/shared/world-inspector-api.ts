import type {
  AgentState,
  CanonicalWorldState,
  CommittedStep,
  PlayerState,
} from "../engine/model";
import type {
  RuntimeEvent,
  RuntimeObservabilityMode,
} from "../engine/observability";

export const WORLD_INSPECTOR_API_VERSION = 1 as const;

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

export interface WorldInspectorAttemptSummary {
  id: string;
  runId?: string;
  runAttempt?: number;
  revision?: number;
  step?: number;
  status: WorldInspectorAttemptStatus;
  startedAt: string;
  updatedAt: string;
  latestEvent: string;
  eventCount: number;
  modelInvocationCount: number;
  errorMessage?: string;
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
  committed: CommittedStep;
  before: WorldInspectorStateSnapshot;
  after: WorldInspectorStateSnapshot;
  runtimeEvents: RuntimeEvent[];
  trace: WorldInspectorTraceAvailability;
}

export interface WorldInspectorAttemptDetail {
  apiVersion: typeof WORLD_INSPECTOR_API_VERSION;
  summary: WorldInspectorAttemptSummary;
  events: RuntimeEvent[];
  trace: WorldInspectorTraceAvailability;
}

export type WorldInspectorStreamEvent =
  | { type: "runtime"; epoch: string; event: RuntimeEvent }
  | { type: "resync"; epoch: string; reason: "epoch_changed" | "cursor_expired" }
  | { type: "heartbeat"; epoch: string; at: string };
