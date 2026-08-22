import type { SimulationState } from "./model";

export interface WorldLaw {
  id: string;
  text: string;
  severity: "hard" | "soft";
}

export interface MechanicalDisclosurePolicy {
  defaultCheckVisibility: "full" | "result_only" | "hidden";
}

export interface WorldDefinition {
  id: string;
  name: string;
  description: string;
  laws: WorldLaw[];
  disclosure: MechanicalDisclosurePolicy;
  initialState: SimulationState;
}

export function validateWorldDefinition(definition: WorldDefinition): void {
  if (!definition.id.trim() || !definition.name.trim()) throw new Error("world id and name are required");
  const ids = new Set<string>();
  for (const law of definition.laws) {
    if (!law.id.trim() || !law.text.trim()) throw new Error("world laws require id and text");
    if (ids.has(law.id)) throw new Error(`duplicate world law ${law.id}`);
    ids.add(law.id);
  }
  if (definition.initialState.worldId !== definition.id) {
    throw new Error("initial state world id does not match definition");
  }
}
