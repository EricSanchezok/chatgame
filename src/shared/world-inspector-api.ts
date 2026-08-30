import type {
  AgentState,
  CanonicalWorldState,
  CommittedStep,
  ModelExecutionAudit,
} from "../engine/contracts/model";
import type {
  RuntimeEvent,
} from "../engine/runtime/observability";
import type { InteractionDependency } from "../engine/runtime/execution";

export const WORLD_INSPECTOR_API_VERSION = 6 as const;

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
  | "attempt"
  | "stage"
  | "model_invocation"
  | "transport_attempt"
  | "validation"
  | "artifact";

export type WorldInspectorEdgeKind =
  | "temporal"
  | "causal"
  | "observes"
  | "updates"
  | "commits"
  | "rollback"
  | "contains"
  | "retry_of"
  | "belongs_to_slot"
  | "produces"
  | "rejected_by";

export interface WorldInspectorActor {
  id: string;
  entityId: string;
  kind: "agent";
  name: string;
  description: string;
  lifecycle: "active" | "retired";
  activity?: {
    steps: number;
    attempts: number;
    modelInvocations: number;
    transportAttempts: number;
    retries: number;
    rejectionCount: number;
    tokenUsage: WorldInspectorTokenUsage;
    durationMs: number;
  };
}

export interface WorldInspectorNodeSummary {
  id: string;
  revision: number;
  laneId: string;
  kind: WorldInspectorNodeKind;
  label: string;
  description: string;
  status?: "succeeded" | "partial" | "failed" | "blocked" | "continuing" | "active" | "rolled_back" | "accepted" | "rejected";
  count?: number;
  relatedActorIds?: string[];
  relatedAttemptId?: string;
  relatedInvocationId?: string;
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

export interface WorldInspectorModelTokenUsage {
  input: number | null;
  output: number | null;
  reasoning: number | null;
  cacheRead: number | null;
  cacheWrite: number | null;
}

export type WorldInspectorModelInvocationStatus = "active" | "accepted" | "rejected" | "failed";

export interface WorldInspectorSlotRef {
  slot: number;
  agentId?: string;
  actionId?: string;
  label?: string;
  unresolvedReason?: string;
}

export interface WorldInspectorContextSectionSummary {
  key: string;
  utf8Bytes: number;
  itemCount: number | null;
  hash?: string;
}

export interface WorldInspectorTransportAttempt {
  attempt: number;
  status: "succeeded" | "retryable_error" | "failed";
  statusCode?: number | null;
  errorName?: string | null;
  queueWaitMs: number;
  executionMs: number;
  retryDelayMs: number;
  eventIds: string[];
}

export interface WorldInspectorModelInvocationSummary {
  id: string;
  ordinal: number;
  role?: string;
  subjectId?: string;
  providerId?: string;
  accountId?: string;
  modelId?: string;
  profileId?: string;
  promptVersion?: string;
  schemaName?: string;
  status: WorldInspectorModelInvocationStatus;
  startedAt?: string;
  updatedAt?: string;
  slotRefs: WorldInspectorSlotRef[];
  transportAttempts: WorldInspectorTransportAttempt[];
  retryCount: number;
  tokenUsage: WorldInspectorModelTokenUsage;
  requestUtf8Bytes?: number | null;
  contextUtf8Bytes?: number | null;
  responseUtf8Bytes?: number | null;
  contextSections: WorldInspectorContextSectionSummary[];
  timings: {
    invocationMs?: number;
    queueWaitMs: number;
    transportMs: number;
    parseMs: number;
    retryDelayMs: number;
  };
  eventIds: string[];
  payloadEventIds: {
    context?: string;
    request?: string;
    response?: string;
    output?: string;
  };
  artifactHashes: {
    context?: string;
    request?: string;
    response?: string;
    output?: string;
  };
  validationIssueCodes: string[];
  errorMessage?: string;
  hasPayload: boolean;
}

export interface WorldInspectorStepSummary {
  revision: number;
  step: number;
  contentHash: string;
  elapsedSeconds: number;
  primaryAction: string;
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
  advanceId?: string;
  advanceAttempt?: number;
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
  transportAttemptCount: number;
  retryCount: number;
  tokenUsage: WorldInspectorTokenUsage;
  actorIds: string[];
  relatedActorIds: string[];
  stages: WorldInspectorAttemptStage[];
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
  mode: "full";
  degraded: false;
  retainedEventCount: number;
  earliestTimestamp?: string;
  latestTimestamp?: string;
  hasFullPayload: true;
}

export interface WorldInspectorWindow {
  apiVersion: typeof WORLD_INSPECTOR_API_VERSION;
  instance: {
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
}

export interface WorldInspectorStepDetail {
  apiVersion: typeof WORLD_INSPECTOR_API_VERSION;
  summary: WorldInspectorStepSummary;
  committed: CommittedStep & { modelAudits: ModelExecutionAudit[] };
  interaction: {
    dependencies: InteractionDependency[];
    components: string[][];
    globalReadjudication: boolean;
  };
  before: WorldInspectorStateSnapshot;
  after: WorldInspectorStateSnapshot;
  runtimeEvents: WorldInspectorRuntimeEventSummary[];
  modelInvocations: WorldInspectorModelInvocationSummary[];
  trace: WorldInspectorTraceAvailability;
}

export interface WorldInspectorAttemptDetail {
  apiVersion: typeof WORLD_INSPECTOR_API_VERSION;
  summary: WorldInspectorAttemptSummary;
  attemptedActions: CommittedStep["initialActions"];
  stages: WorldInspectorAttemptStage[];
  events: WorldInspectorRuntimeEventSummary[];
  modelInvocations: WorldInspectorModelInvocationSummary[];
  trace: WorldInspectorTraceAvailability;
}

export interface WorldInspectorModelInvocationQuery {
  executionId?: string;
  actorId?: string;
  role?: string;
  providerId?: string;
  modelId?: string;
  status?: WorldInspectorModelInvocationStatus;
  minDurationMs?: number;
  maxDurationMs?: number;
  minInputTokens?: number;
  maxInputTokens?: number;
  minRetries?: number;
  sort?: "duration" | "inputTokens" | "outputTokens" | "retries" | "timestamp";
  cursor?: string;
  limit?: number;
}

export interface WorldInspectorModelInvocationResult extends WorldInspectorModelInvocationSummary {
  executionId: string;
  attemptId: string;
  revision?: number;
  step?: number;
  startedAt?: string;
  updatedAt?: string;
}

export interface WorldInspectorModelInvocationQueryResult {
  apiVersion: typeof WORLD_INSPECTOR_API_VERSION;
  items: WorldInspectorModelInvocationResult[];
  nextCursor?: string;
  total: number;
}

export interface WorldInspectorModelInvocationDetail extends WorldInspectorModelInvocationResult {
  eventSummaries: WorldInspectorRuntimeEventSummary[];
}

export type WorldInspectorStreamEvent =
  | { type: "runtime"; epoch: string; event: WorldInspectorRuntimeEventSummary }
  | { type: "resync"; epoch: string; reason: "epoch_changed" | "cursor_expired" }
  | { type: "heartbeat"; epoch: string; at: string };
