import type { PublicInstanceSummary, WorldSummary } from "./world-api";
import type { AgentPerspectiveView } from "./world-api";

export interface ObserverAgentSummary {
  id: string;
  name: string;
  description: string;
  location: string | null;
  policy: "model" | "idle" | "replay";
}

export interface ObserverAgentPerspective {
  agent: ObserverAgentSummary;
  perspective: AgentPerspectiveView;
}

export interface WorldObserverDetail {
  summary: PublicInstanceSummary;
  world: WorldSummary;
  agents: ObserverAgentSummary[];
  selected?: ObserverAgentPerspective;
}
