import { validateWorldModelProfiles, type WorldDefinition } from "../engine/runtime/world-definition";
import { historyReplayBaseHash } from "../engine/runtime/history-replay";
import type { ModelCatalog } from "../engine/models/model-catalog";
import { createSeededRng } from "../engine/mechanics/random";
import { createCoreRulePackageRegistry, type RulePackageRegistry } from "../engine/mechanics/rule-package";

export interface WorldCatalogEntry {
  id: string;
  name: string;
  version: string;
  contentHash: string;
  description: string;
  participation: "headless" | "open";
}

export interface WorldRepository {
  readonly rulePackages: RulePackageRegistry;
  list(): WorldCatalogEntry[];
  load(worldId: string, seed: number | undefined, modelCatalog: ModelCatalog): WorldDefinition;
  loadVersion(
    worldId: string,
    contentHash: string,
    seed: number | undefined,
    modelCatalog: ModelCatalog,
  ): WorldDefinition;
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
        participation: definition.participation ? "open" as const : "headless" as const,
      }))
      .sort((left, right) => left.id.localeCompare(right.id));
  }

  load(worldId: string, seed: number | undefined, modelCatalog: ModelCatalog): WorldDefinition {
    const definition = this.definitions[worldId];
    if (!definition) throw new Error(`world not found: ${worldId}`);
    return this.cloneDefinition(definition, seed, modelCatalog);
  }

  loadVersion(
    worldId: string,
    contentHash: string,
    seed: number | undefined,
    modelCatalog: ModelCatalog,
  ): WorldDefinition {
    const definition = this.definitions[worldId];
    if (!definition || definition.contentHash !== contentHash) {
      throw new Error(`world version not found: ${worldId}@${contentHash}`);
    }
    return this.cloneDefinition(definition, seed, modelCatalog);
  }

  private cloneDefinition(
    definition: WorldDefinition,
    seed: number | undefined,
    modelCatalog: ModelCatalog,
  ): WorldDefinition {
    const cloned = structuredClone(definition);
    if (seed !== undefined) {
      cloned.initialState.truth.rng = createSeededRng(seed);
      cloned.historyBaseHash = historyReplayBaseHash(cloned.initialState);
    }
    validateWorldModelProfiles(cloned, modelCatalog);
    return cloned;
  }
}
