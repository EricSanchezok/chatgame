import path from "node:path";
import { validateWorldModelProfiles, type WorldDefinition } from "../engine/world-definition";
import type { ModelCatalog } from "../engine/model-catalog";
import { createCoreRulePackageRegistry, type RulePackageRegistry } from "../engine/rule-package";
import { listWorldScripts, loadWorldScript, type WorldScriptSummary } from "./world-loader";

export interface WorldRepository {
  list(): WorldScriptSummary[];
  load(scriptId: string, seed: number | undefined, modelCatalog: ModelCatalog): WorldDefinition;
}

export class FileWorldRepository implements WorldRepository {
  constructor(
    readonly root: string,
    private readonly rulePackages: RulePackageRegistry = createCoreRulePackageRegistry(),
  ) {}

  list(): WorldScriptSummary[] {
    return listWorldScripts(this.root);
  }

  load(scriptId: string, seed: number | undefined, modelCatalog: ModelCatalog): WorldDefinition {
    const summary = this.list().find((candidate) => candidate.id === scriptId);
    if (!summary) throw new Error(`world script not found: ${scriptId}`);
    return loadWorldScript(path.resolve(summary.directory), {
      seed,
      rulePackages: this.rulePackages,
      modelCatalog,
    });
  }
}

export class MemoryWorldRepository implements WorldRepository {
  constructor(private readonly definitions: Record<string, WorldDefinition>) {}

  list(): WorldScriptSummary[] {
    return Object.values(this.definitions)
      .map((definition) => ({
        id: definition.id,
        name: definition.name,
        version: "test",
        description: definition.description,
        directory: "<memory>",
      }))
      .sort((left, right) => left.id.localeCompare(right.id));
  }

  load(scriptId: string, _seed: number | undefined, modelCatalog: ModelCatalog): WorldDefinition {
    const definition = this.definitions[scriptId];
    if (!definition) throw new Error(`world script not found: ${scriptId}`);
    const cloned = structuredClone(definition);
    validateWorldModelProfiles(cloned, modelCatalog);
    return cloned;
  }
}
