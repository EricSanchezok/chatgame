import type {
  ExternalActionInput,
  ParticipantId,
  PolicyBinding,
  WorldAdvanceRequest,
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
  simulatedSeconds: number;
  realtimeIntervalMs: number;
  actionWindowMs: number;
}

export interface SchedulerState {
  mode: "paused" | "realtime";
  generation: number;
  nextTickAt: string | null;
}

export interface WorldAdvanceRecord {
  id: string;
  request: WorldAdvanceRequest;
  status: "awaiting_actions" | "queued" | "running" | "committed" | "cancelled" | "failed";
  createdAt: string;
  updatedAt: string;
  executionIds: string[];
  committedRevisions: number[];
  error?: string;
}

export interface ParticipantIntentRecord {
  participantId: ParticipantId;
  submissionId: string;
  revision: number;
  text: string;
  submittedAt: string;
}

export interface WorldInstanceDocument {
  schemaVersion: 12;
  id: string;
  world: WorldRuntimeContract;
  title: string;
  createdAt: string;
  updatedAt: string;
  state: SimulationState;
  participants: Record<ParticipantId, ParticipantRecord>;
  policyBindings: Record<AgentId, PolicyBinding>;
  actionWindow: ActionWindow | null;
  runtime: InstanceRuntimeConfig;
  scheduler: SchedulerState;
  advances: Record<string, WorldAdvanceRecord>;
  participantIntents: ParticipantIntentRecord[];
}

export interface StoredWorldInstance {
  generation: number;
  document: WorldInstanceDocument;
}
