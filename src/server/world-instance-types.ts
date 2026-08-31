import type {
  AlgorithmRef,
  ExternalActionInput,
  ExternalReactionInput,
  ParticipantId,
  PolicyBinding,
  WorldAdvanceRequest,
} from "../engine/runtime/execution";
import type { AgentId, SimulationState } from "../engine/contracts/model";
import type { ReactionRequest } from "../engine/contracts/model";
import type { WorldRuntimeContract } from "../engine/runtime/world-definition";

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
  possibleNextActions: [string, string, string];
  generated: boolean;
  createdAt: string;
  executionId?: string;
}

interface ActionWindowBase {
  id: string;
  generation: number;
  baseRevision: number;
  requiredAgentIds: AgentId[];
  deadlineAt: string | null;
  status: "open" | "resolving" | "committed" | "cancelled";
}

export interface DecisionActionWindow extends ActionWindowBase {
  kind: "decision";
  submissions: Record<AgentId, ExternalActionInput>;
}

export interface ReactionActionWindow extends ActionWindowBase {
  kind: "reaction";
  preparedStepId: string;
  preparationArtifactHash: string;
  preparationExecutionId: string;
  sourceStateHash: string;
  algorithmManifestHash: string;
  policyRosterHash: string;
  policyRoster: Record<AgentId, PolicyBinding>;
  advanceRequest: WorldAdvanceRequest;
  requests: Record<AgentId, ReactionRequest>;
  submissions: Record<AgentId, ExternalReactionInput>;
}

export type ActionWindow = DecisionActionWindow | ReactionActionWindow;

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
  | "awaiting-reaction"
  | "preparation-invalidated"
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

export interface ParticipantReactionRecord {
  participantId: ParticipantId;
  agentId: AgentId;
  runId: string;
  preparedStepId: string;
  requestId: string;
  submissionId: string;
  kind: "keep" | "replace";
  text: string | null;
  submittedAt: string;
}

export interface WorldInstanceDocument {
  schemaVersion: 19;
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
  reactionSubmissions: ParticipantReactionRecord[];
}

export interface StoredWorldInstance {
  generation: number;
  document: WorldInstanceDocument;
}
