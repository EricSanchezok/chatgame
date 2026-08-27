import type { PublicInstanceSummary, WorldSummary } from "./world-api";

export interface ObserverAgentSummary {
  id: string;
  name: string;
  description: string;
  location: string | null;
  policy: "model" | "idle" | "replay";
}

export interface ObserverTurn {
  id: string;
  revision: number;
  step: number;
  action: string | null;
  observation: string | null;
}

export interface ObserverAgentPerspective {
  agent: ObserverAgentSummary;
  character: unknown;
  belief: unknown;
  turns: ObserverTurn[];
}

export interface WorldObserverDetail {
  summary: PublicInstanceSummary;
  world: WorldSummary;
  agents: ObserverAgentSummary[];
  selected?: ObserverAgentPerspective;
}
