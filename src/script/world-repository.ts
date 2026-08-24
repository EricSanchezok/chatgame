import { validateWorldModelProfiles, type WorldDefinition } from "../engine/world-definition";
import { historyReplayBaseHash } from "../engine/history-replay";
import type { ModelCatalog } from "../engine/model-catalog";
import { createSeededRng } from "../engine/random";
import { createCoreRulePackageRegistry, type RulePackageRegistry } from "../engine/rule-package";

export interface WorldCatalogEntry {
  id: string;
  name: string;
  version: string;
  contentHash: string;
  description: string;
}

export interface WorldRepository {
  readonly rulePackages: RulePackageRegistry;
  list(): WorldCatalogEntry[];
  load(worldId: string, seed: number | undefined, modelCatalog: ModelCatalog): WorldDefinition;
}

export class MemoryWorldRepository implements WorldRepository {
  constructor(
    private readonly definitions: Record<string, WorldDefinition>,
    readonly rulePackages: RulePackageRegistry = createCoreRulePackageRegistry(),
  ) {}

  list(): WorldCatalogEntry[] {
    return Object.values(this.definitions)
      .map((definition) => ({
        id: definition.id,
        name: definition.name,
        version: definition.manifestVersion,
        contentHash: definition.contentHash,
        description: definition.description,
      }))
      .sort((left, right) => left.id.localeCompare(right.id));
  }

  load(worldId: string, seed: number | undefined, modelCatalog: ModelCatalog): WorldDefinition {
    const definition = this.definitions[worldId];
    if (!definition) throw new Error(`world not found: ${worldId}`);
    const cloned = structuredClone(definition);
    if (seed !== undefined) {
      cloned.initialState.truth.rng = createSeededRng(seed);
      cloned.historyBaseHash = historyReplayBaseHash(cloned.initialState);
    }
    validateWorldModelProfiles(cloned, modelCatalog);
    return cloned;
  }
}
