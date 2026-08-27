export const WORLD_API_VERSION = 6 as const;

export interface WorldSummary {
  id: string;
  name: string;
  version: string;
  contentHash: string;
  description: string;
  participation: "headless" | "open";
}

export interface PublicWorldEvent {
  id: string;
  step: number;
  description: string;
  impact: "ordinary" | "significant" | "transformative";
}

export type WorldAdvanceStatus =
  | "awaiting_actions"
  | "queued"
  | "running"
  | "committed"
  | "cancelled"
  | "failed";

export interface PublicInstanceSummary {
  id: string;
  worldId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  revision: number;
  step: number;
  elapsedSeconds: number;
  participantCount: number;
  schedulerMode: "paused" | "realtime";
  advanceStatus?: WorldAdvanceStatus;
}

export interface PublicActionWindow {
  id: string;
  baseRevision: number;
  requiredAgentIds: string[];
  submittedAgentIds: string[];
  deadlineAt: string | null;
  status: "open" | "resolving";
}

export interface ParticipantSummary {
  id: string;
  displayName: string;
  agentId: string;
  status: "active" | "released";
  joinedAt: string;
}

export interface AgentPublicPreview {
  id: string;
  name: string;
  description: string;
  location: string | null;
  claimable: boolean;
}

export interface OriginView {
  id: string;
  title: string;
  fantasy: string;
  description: string;
  location: string;
  relationshipHooks: string[];
  risks: string[];
  image?: { hash: string; alt: string };
}

export interface AgentPrivateView {
  agentId: string;
  entity: {
    name: string;
    description: string;
    location: string | null;
  };
  character: unknown;
  belief: unknown;
  observations: Array<{ step: number; summary: string }>;
}

export interface PublicInstanceDetail {
  summary: PublicInstanceSummary;
  world: WorldSummary;
  publicEvents: PublicWorldEvent[];
  participants: ParticipantSummary[];
  actionWindow: PublicActionWindow | null;
  origins: OriginView[];
  claimableAgents: AgentPublicPreview[];
  controlledView?: AgentPrivateView;
}

export interface CreateInstanceInput {
  worldId: string;
  title?: string;
}

export interface AdvanceWorldInput {
  expectedRevision: number;
  trigger: "manual" | "batch" | "realtime";
  steps?: number;
  simulatedSeconds?: number;
}

export interface CreateParticipantInput {
  expectedRevision: number;
  displayName: string;
  appearance: string;
  motivation: string;
  originId?: string;
  claimAgentId?: string;
}

export interface SubmitExternalActionInput {
  submissionId: string;
  expectedRevision: number;
  text: string;
}

export interface ReleaseParticipantInput {
  expectedRevision: number;
  disposition: "model" | "idle";
}

export interface ArrivalView {
  title: string;
  scene: string;
  suggestions: [string, string, string];
  generated: boolean;
}
