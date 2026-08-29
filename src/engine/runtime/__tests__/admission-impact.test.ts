import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadWorldScript } from "../../../script/world-loader";
import { DeterministicModelProvider } from "../../testing/model-provider";
import { SimulationEngine } from "../simulation";
import {
  computeAdmissionImpact,
  type AdmissionCandidateState,
} from "../admission-impact";
import type { AgentState, WorldEntity } from "../../contracts/model";
import { EagerReferenceAlgorithm } from "../../algorithms/eager-reference/eager-reference";
import { CanonicalCommitter } from "../canonical-committer";
import { replaySimulationState } from "../transaction";

function candidateFor(
  source: Readonly<import("../../contracts/model").SimulationState>,
  placementId: string | null,
): AdmissionCandidateState {
  const template = structuredClone(source.agents.keeper) as AgentState;
  const selfBinding = Object.values(template.bindings).find((binding) =>
    binding.canonicalEntityIds.includes(template.entityId));
  if (!selfBinding) throw new Error("fixture Agent has no self binding");
  template.id = "new-agent";
  template.entityId = "new-agent";
  template.nextAction = null;
  template.bindings[selfBinding.localEntityId] = {
    localEntityId: selfBinding.localEntityId,
    canonicalEntityIds: ["new-agent"],
  };
  const entity: WorldEntity = {
    id: "new-agent",
    kind: "person",
    name: "新来者",
    description: "刚刚进入世界的人。",
    lifecycle: "active",
    createdAtStep: source.step,
  };
  return {
    entity,
    placementId,
    agent: template,
    meters: [],
    quantities: [],
    ratings: [],
    conditions: [],
  };
}

describe("admission impact proof", () => {
  it("reuses prepared actions when the new Agent is outside every perspective", async () => {
    const provider = new DeterministicModelProvider();
    const definition = loadWorldScript(path.resolve("test/fixtures/open-world-script"), {
      seed: 47,
      modelCatalog: provider.catalog,
    });
    const algorithm = new EagerReferenceAlgorithm(provider);
    const realEngine = new SimulationEngine(definition, algorithm);
    await realEngine.bootstrapAgents();
    const source = realEngine.snapshot;
    const impact = computeAdmissionImpact(source, candidateFor(source, null));
    expect(impact.invalidatedAgentIds).toEqual([]);
    expect(impact.reusedActions).toHaveLength(Object.keys(source.agents).length);
    expect(impact.reusedActions.every((action) => action.baseRevision === source.revision + 1)).toBe(true);
    expect(impact.reusedActions.every((action) => action.rawText.length > 0)).toBe(true);
  });

  it("invalidates the Agent whose visible containment changes", async () => {
    const provider = new DeterministicModelProvider();
    const definition = loadWorldScript(path.resolve("test/fixtures/open-world-script"), {
      seed: 47,
      modelCatalog: provider.catalog,
    });
    const algorithm = new EagerReferenceAlgorithm(provider);
    const engine = new SimulationEngine(definition, algorithm);
    await engine.bootstrapAgents();
    const source = engine.snapshot;
    const impact = computeAdmissionImpact(source, candidateFor(source, source.agents.keeper!.entityId));
    expect(impact.invalidatedAgentIds).toContain("keeper");
    expect(impact.reusedActions.map((action) => action.actorId)).not.toContain("keeper");
  });

  it("rebases retained actions and replays the admission atomically", async () => {
    const provider = new DeterministicModelProvider();
    const definition = loadWorldScript(path.resolve("test/fixtures/open-world-script"), {
      seed: 47,
      modelCatalog: provider.catalog,
    });
    const engine = new SimulationEngine(definition, new EagerReferenceAlgorithm(provider));
    await engine.bootstrapAgents();
    const source = engine.snapshot;
    const priorIds = Object.values(source.agents)
      .flatMap((agent) => agent.nextAction ? [agent.nextAction.id] : [])
      .sort();
    const admitted = new CanonicalCommitter().admit(source, candidateFor(source, null));

    expect(admitted.committed.invalidatedActionIds).toEqual(priorIds);
    expect(admitted.committed.reusedActions.map((action) => action.actorId)).toEqual(
      Object.keys(source.agents).sort(),
    );
    expect(admitted.state.revision).toBe(source.revision + 1);
    for (const action of admitted.committed.reusedActions) {
      expect(admitted.state.agents[action.actorId]!.nextAction).toEqual(action);
      expect(action.baseRevision).toBe(admitted.state.revision);
      expect(action.id).not.toBe(source.agents[action.actorId]!.nextAction!.id);
    }
    expect(() => replaySimulationState(admitted.state)).not.toThrow();
  });

  it("fails closed when a cognitive perspective cannot be projected", async () => {
    const provider = new DeterministicModelProvider();
    const definition = loadWorldScript(path.resolve("test/fixtures/open-world-script"), {
      seed: 47,
      modelCatalog: provider.catalog,
    });
    const engine = new SimulationEngine(definition, new EagerReferenceAlgorithm(provider));
    await engine.bootstrapAgents();
    const source = engine.snapshot;
    const candidate = candidateFor(source, null);
    const selfBinding = Object.values(source.agents.keeper!.bindings).find((binding) =>
      binding.canonicalEntityIds.includes(source.agents.keeper!.entityId));
    if (!selfBinding) throw new Error("fixture Agent has no self binding");
    delete source.agents.keeper!.bindings[selfBinding.localEntityId];

    const impact = computeAdmissionImpact(source, candidate);
    expect(impact.invalidatedAgentIds).toContain("keeper");
    expect(impact.reasons.keeper).toContain("cognitive_input_inconclusive");
  });
});
