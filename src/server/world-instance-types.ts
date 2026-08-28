import type {
  AlgorithmRef,
  ExternalActionInput,
  ParticipantId,
  PolicyBinding,
} from "../engine/execution";
import type { AgentId, SimulationState } from "../engine/model";
import type { WorldRuntimeContract } from "../engine/world-definition";

export interface ParticipantRecord {
  id: ParticipantId;
  principalId: string;
  displayName: string;
  agentId: AgentId;
  status: "active" | "released";
  joinedAt: string;
  updatedAt: string;
  controlledSinceRevision: number;
  admissionExecutionId?: string;
  suppressedActionId?: string;
  arrival: ParticipantArrivalRecord;
}

export interface ParticipantArrivalRecord {
  id: string;
  revision: number;
  step: number;
  title: string;
  scene: string;
  suggestions: [string, string, string];
  generated: boolean;
  createdAt: string;
  executionId?: string;
}

export interface ActionWindow {
  id: string;
  generation: number;
  baseRevision: number;
  requiredAgentIds: AgentId[];
  submissions: Record<AgentId, ExternalActionInput>;
  deadlineAt: string | null;
  status: "open" | "resolving" | "committed" | "cancelled";
}

export interface InstanceRuntimeConfig {
  maxAutonomousSpanSeconds: number;
  realtimeIntervalMs: number;
  actionWindowMs: number;
}

export interface SchedulerState {
  mode: "paused" | "realtime";
  generation: number;
  nextTickAt: string | null;
}

export type WorldRunStatus =
  | "queued"
  | "running"
  | "pausing"
  | "paused"
  | "awaiting-decision"
  | "completed"
  | "failed"
  | "budget-paused";

export interface WorldRunLease {
  id: string;
  generation: number;
  startedAt: string;
  maxCommits: number;
  maxWallTimeMs: number;
  commitCount: number;
}

export interface WorldRunRecord {
  id: string;
  generation: number;
  trigger: "manual" | "batch" | "realtime" | "participant_action";
  status: WorldRunStatus;
  rootIntents: ExternalActionInput[];
  activityIds: string[];
  requestedBoundaryCount: number | null;
  createdAt: string;
  updatedAt: string;
  executionIds: string[];
  committedRevisions: number[];
  stopReason: string | null;
  lease: WorldRunLease | null;
  error?: string;
}

export interface ParticipantIntentRecord {
  participantId: ParticipantId;
  agentId: AgentId;
  runId: string;
  submissionId: string;
  revision: number;
  text: string;
  submittedAt: string;
}

export interface WorldInstanceDocument {
  schemaVersion: 16;
  id: string;
  world: WorldRuntimeContract;
  executionAlgorithm: AlgorithmRef;
  title: string;
  createdAt: string;
  updatedAt: string;
  state: SimulationState;
  participants: Record<ParticipantId, ParticipantRecord>;
  policyBindings: Record<AgentId, PolicyBinding>;
  actionWindow: ActionWindow | null;
  runtime: InstanceRuntimeConfig;
  scheduler: SchedulerState;
  runs: Record<string, WorldRunRecord>;
  participantIntents: ParticipantIntentRecord[];
}

export interface StoredWorldInstance {
  generation: number;
  document: WorldInstanceDocument;
}
