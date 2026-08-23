import type { SimulationState } from "./model";
import type { ModelCatalog } from "./model-catalog";
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
  truthModelProfileId: string;
  laws: WorldLaw[];
  disclosure: MechanicalDisclosurePolicy;
  rulePackages: RulePackageReference[];
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
  if (!definition.truthModelProfileId.trim()) throw new Error("world Truth Engine model profile is required");
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
}

export function validateWorldModelProfiles(definition: WorldDefinition, catalog: ModelCatalog): void {
  catalog.assertProfile(definition.truthModelProfileId, "truth-engine");
  for (const agent of Object.values(definition.initialState.agents)) {
    catalog.assertProfile(agent.modelProfileId, "agent-mind");
  }
}
