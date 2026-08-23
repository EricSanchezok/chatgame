import path from "node:path";
import type { WorldDefinition } from "../engine/world-definition";
import { createCoreRulePackageRegistry, type RulePackageRegistry } from "../engine/rule-package";
import { listWorldScripts, loadWorldScript, type WorldScriptSummary } from "./world-loader";

export interface WorldRepository {
  list(): WorldScriptSummary[];
  load(scriptId: string, seed?: number): WorldDefinition;
}

export class FileWorldRepository implements WorldRepository {
  constructor(
    readonly root: string,
    private readonly rulePackages: RulePackageRegistry = createCoreRulePackageRegistry(),
  ) {}

  list(): WorldScriptSummary[] {
    return listWorldScripts(this.root);
  }

  load(scriptId: string, seed = 1): WorldDefinition {
    const summary = this.list().find((candidate) => candidate.id === scriptId);
    if (!summary) throw new Error(`world script not found: ${scriptId}`);
    return loadWorldScript(path.resolve(summary.directory), seed, this.rulePackages);
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

  load(scriptId: string): WorldDefinition {
    const definition = this.definitions[scriptId];
    if (!definition) throw new Error(`world script not found: ${scriptId}`);
    return structuredClone(definition);
  }
}
