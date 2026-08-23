import type { DiscreteRandomDefinition, SimulationState } from "./model";
import { historyReplayBaseHash } from "./history-replay";
import type { ModelCatalog } from "./model-catalog";
import { validateDiscreteRandomDefinitions } from "./random";
import type { RulePackageReference } from "./rule-package";

export interface WorldLaw {
  id: string;
  text: string;
  severity: "hard" | "soft";
}

export interface MechanicalDisclosurePolicy {
  defaultCheckVisibility: "full" | "result_only" | "hidden";
}

export interface WorldRuntimeContract {
  id: string;
  name: string;
  manifestVersion: string;
  description: string;
  contentHash: string;
  modelProfiles: {
    perception: string;
    reactionRouting: string;
    resolution: string;
    transition: string;
    causalVerifier: string;
  };
  laws: WorldLaw[];
  disclosure: MechanicalDisclosurePolicy;
  rulePackages: RulePackageReference[];
  randomDistributions: DiscreteRandomDefinition[];
  historyBaseHash: string;
}

export interface WorldDefinition extends WorldRuntimeContract {
  initialState: SimulationState;
}

export function toWorldRuntimeContract(definition: WorldDefinition): WorldRuntimeContract {
  const contract = structuredClone(definition);
  delete (contract as Partial<WorldDefinition>).initialState;
  return contract;
}

export function validateWorldDefinition(definition: WorldDefinition): void {
  if (!definition.id.trim() || !definition.name.trim()) throw new Error("world id and name are required");
  if (!definition.manifestVersion.trim()) throw new Error("world manifest version is required");
  if (!/^sha256:[a-f0-9]{64}$/.test(definition.contentHash)) throw new Error("invalid world content hash");
  if (!/^[a-f0-9]{64}$/.test(definition.historyBaseHash) ||
    definition.historyBaseHash !== historyReplayBaseHash(definition.initialState)) {
    throw new Error("world history replay base mismatch");
  }
  if (Object.values(definition.modelProfiles).some((profileId) => !profileId.trim())) {
    throw new Error("world model profiles are required");
  }
  const ids = new Set<string>();
  for (const law of definition.laws) {
    if (!law.id.trim() || !law.text.trim()) throw new Error("world laws require id and text");
    if (ids.has(law.id)) throw new Error(`duplicate world law ${law.id}`);
    ids.add(law.id);
  }
  if (definition.initialState.worldId !== definition.id) {
    throw new Error("initial state world id does not match definition");
  }
  if (definition.initialState.worldHash !== definition.contentHash) {
    throw new Error("initial state world hash does not match definition");
  }
  if (definition.initialState.lawIds.length !== ids.size ||
    definition.initialState.lawIds.some((lawId) => !ids.has(lawId))) {
    throw new Error("initial state law ids do not match world definition");
  }
  if (definition.rulePackages.length === 0) throw new Error("at least one rule package is required");
  const packageIds = new Set<string>();
  for (const rulePackage of definition.rulePackages) {
    if (!rulePackage.id.trim() || !rulePackage.version.trim() || packageIds.has(rulePackage.id)) {
      throw new Error(`invalid rule package reference ${rulePackage.id}`);
    }
    packageIds.add(rulePackage.id);
  }
  validateDiscreteRandomDefinitions(definition.randomDistributions);
}

export function validateWorldModelProfiles(definition: WorldDefinition, catalog: ModelCatalog): void {
  catalog.assertProfile(definition.modelProfiles.perception, "truth-perception");
  catalog.assertProfile(definition.modelProfiles.reactionRouting, "truth-reaction-routing");
  catalog.assertProfile(definition.modelProfiles.resolution, "truth-resolution");
  catalog.assertProfile(definition.modelProfiles.transition, "truth-transition");
  catalog.assertProfile(definition.modelProfiles.causalVerifier, "causal-verifier");
  for (const agent of Object.values(definition.initialState.agents)) {
    catalog.assertProfile(agent.modelProfiles.bootstrap, "agent-bootstrap");
    catalog.assertProfile(agent.modelProfiles.mind, "agent-mind");
    catalog.assertProfile(agent.modelProfiles.reaction, "agent-reaction");
  }
}
