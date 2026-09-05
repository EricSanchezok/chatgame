import { createActionCompilationReferenceResolver } from "../../../contracts/model-context";
import type { AgentActionProposal, SimulationState } from "../../../contracts/model";
import {
  actionGroundingReferenceResolver,
  actionGroundingSharedContext,
} from "../../../mechanics/action-dependency";
import { actionCompilationPassageEntriesForContext } from "./graph-aware";

export function actionCompilationPassagesForState(
  state: Readonly<SimulationState>,
): readonly string[] {
  const passages = new Set<string>();
  const collect = (actions: readonly AgentActionProposal[]): void => {
    const slotByActionId = new Map(actions.map((action, slot) => [action.id, slot]));
    const resolver = actionGroundingReferenceResolver(state, actions, slotByActionId);
    const projected = actionGroundingSharedContext(state, actions, resolver, true).referenceResolver;
    const catalog = createActionCompilationReferenceResolver(projected, projected).catalog;
    actionCompilationPassageEntriesForContext({ referenceCatalog: catalog })
      .forEach(({ passage }) => passages.add(passage));
  };
  collect([]);
  for (const agent of Object.values(state.agents).sort((left, right) => left.id.localeCompare(right.id))) {
    collect([{
      id: `retrieval-cache-warm:${agent.id}`,
      actorId: agent.id,
      baseRevision: state.revision,
      rawText: "cache warmup",
      goal: "prepare action compilation candidate passages",
      means: null,
      targetIds: Object.keys(agent.belief.localEntities).sort(),
    }]);
  }
  return [...passages].sort();
}
