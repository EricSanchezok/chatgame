import type { AgentPerspectiveView } from "../../shared/world-api";

export function perspectiveMessages(perspective?: AgentPerspectiveView) {
  return perspective?.history.flatMap((turn) => {
    const messages: Array<{ id: string; role: "user" | "assistant"; text: string }> = [];
    if (turn.ownAction) messages.push({
      id: `perspective:${perspective.agentId}:${turn.revision}:action`,
      role: "user",
      text: turn.ownAction,
    });
    const observations = turn.observations.map((observation) => observation.summary).filter(Boolean);
    if (observations.length > 0) messages.push({
      id: `perspective:${perspective.agentId}:${turn.revision}:observation`,
      role: "assistant",
      text: observations.join("\n\n"),
    });
    return messages;
  }) ?? [];
}
