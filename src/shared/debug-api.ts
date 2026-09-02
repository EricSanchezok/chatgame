export const DEBUG_API_VERSION = 1 as const;
export const DEBUG_INDEX_VERSION = 1 as const;

export type DebugIdentifierKind =
  | "invocation"
  | "execution"
  | "request"
  | "trace"
  | "span"
  | "event"
  | "artifact"
  | "issue";

export type DebugOutputFormat = "json" | "ndjson" | "table";

export type DebugComponent =
  | "http"
  | "world-host"
  | "scheduler"
  | "simulation"
  | "algorithm"
  | "model"
  | "persistence"
  | "inspector"
  | "cli"
  | "ui";

export interface DebugQuery {
  invocationId?: string;
  sourceInvocationId?: string;
  executionId?: string;
  instanceId?: string;
  requestId?: string;
  traceId?: string;
  spanId?: string;
  eventSequence?: number;
  artifactHash?: string;
  diagnosticCode?: string;
  component?: DebugComponent;
  operation?: string;
  eventName?: string;
  from?: string;
  to?: string;
  limit?: number;
  cursor?: string;
  includePayload?: boolean;
}

export interface DebugLineageRef {
  kind: "parent" | "child" | "repair" | "retry" | "related";
  id: string;
  executionId: string;
  sourceInvocationId?: string;
}

export interface DebugDiagnostic {
  code: string;
  domain: string;
  owner: string;
  severity: "debug" | "info" | "warn" | "error";
  retryability: "not_retryable" | "retryable" | "unknown";
  message?: string;
  eventSequence?: number;
  artifactHash?: string;
  suggestedCommands: string[];
}

export interface DebugEventSummary {
  sequence: number;
  executionId: string;
  instanceId?: string;
  timestamp: string;
  eventName: string;
  level: string;
  phase?: string;
  component?: string;
  operation?: string;
  requestId?: string;
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  modelInvocationId?: string;
  logicalInvocationId?: string;
  modelRole?: string;
  modelSubject?: string;
  transportAttempt?: number;
  artifactHash?: string;
  hasPayload: boolean;
  diagnosticCodes: string[];
  payload?: unknown;
}

export interface DebugInvocationSummary {
  id: string;
  executionId: string;
  instanceId?: string;
  sourceInvocationId: string;
  logicalInvocationId?: string;
  parentInvocationId?: string;
  repairOf?: string;
  role?: string;
  subjectId?: string;
  providerId?: string;
  profileId?: string;
  modelId?: string;
  status: "active" | "accepted" | "rejected" | "failed";
  firstSequence: number;
  lastSequence: number;
  eventCount: number;
  retryCount: number;
  issueCodes: string[];
  artifactHashes: string[];
  startedAt?: string;
  finishedAt?: string;
  lineage: DebugLineageRef[];
}

export interface DebugSearchResult {
  apiVersion: typeof DEBUG_API_VERSION;
  query: DebugQuery;
  total: number;
  invocations: DebugInvocationSummary[];
  executions: Array<{
    id: string;
    instanceId?: string;
    parentExecutionId?: string;
    status: string;
    kind: string;
    traceId: string;
    startedAt: string;
    finishedAt?: string;
  }>;
  events: DebugEventSummary[];
  nextCursor?: string;
  warnings: string[];
}

export interface DebugInspection extends DebugInvocationSummary {
  apiVersion: typeof DEBUG_API_VERSION;
  events: DebugEventSummary[];
  diagnostics: DebugDiagnostic[];
}

export interface DebugArtifact {
  apiVersion: typeof DEBUG_API_VERSION;
  hash: string;
  executionId: string;
  kind: string;
  mediaType: string;
  encoding: string;
  rawBytes: number;
  storedBytes: number;
  createdAt: string;
  value: unknown;
}

export interface DebugDoctorReport {
  apiVersion: typeof DEBUG_API_VERSION;
  indexVersion: number;
  database: string;
  schemaVersion: number;
  indexFresh: boolean;
  executionCount: number;
  eventCount: number;
  artifactCount: number;
  indexedEventCount: number;
  indexedInvocationCount: number;
  issueCount: number;
  orphanedIndexRows: number;
  missingIndexRows: number;
  orphanedArtifacts: number;
  warnings: string[];
}

export interface DebugCommandError {
  apiVersion: typeof DEBUG_API_VERSION;
  error: {
    code: string;
    message: string;
    retryability: "not_retryable" | "retryable" | "unknown";
    suggestedCommands: string[];
  };
}
