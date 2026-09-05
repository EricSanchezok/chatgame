import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  algorithmCatalogMarkdown,
  diffAlgorithmRefs,
  flattenAlgorithmRef,
} from "../../src/engine/algorithms/catalog";
import { DEFAULT_ALGORITHM_REF, registerBuiltinAlgorithms } from "../../src/engine/algorithms/registry";
import { validateAlgorithmRef, WorldExecutionAlgorithmRegistry, type AlgorithmRef } from "../../src/engine/runtime/execution";
import { loadAlgorithmExperimentRegistry } from "../../src/server/experiment-catalog";

const catalogFile = path.resolve("docs/game-design/algorithm-catalog.md");

function usage(): string {
  return "usage: algorithms <list|describe|validate|diff|catalog> [arguments]";
}

function readRef(file: string): AlgorithmRef {
  const value = JSON.parse(readFileSync(path.resolve(file), "utf8")) as AlgorithmRef;
  validateAlgorithmRef(value);
  return value;
}

function registry(): WorldExecutionAlgorithmRegistry {
  return registerBuiltinAlgorithms(new WorldExecutionAlgorithmRegistry());
}

export function runAlgorithmCommand(argv: readonly string[]): string {
  const command = argv[0];
  const algorithms = registry();
  if (command === "list") return `${JSON.stringify(algorithms.catalog(), null, 2)}\n`;
  if (command === "describe") {
    const selector = argv[1];
    if (!selector) throw new Error("describe requires <role/id@version>");
    const definition = algorithms.catalog().find((entry) => `${entry.role}/${entry.id}@${entry.version}` === selector);
    if (!definition) throw new Error(`algorithm is not registered: ${selector}`);
    const nodes = flattenAlgorithmRef(DEFAULT_ALGORITHM_REF)
      .filter(({ ref }) => ref.role === definition.role && ref.id === definition.id && ref.version === definition.version)
      .map(({ path: nodePath, ref }) => ({ path: nodePath, config: ref.config, manifestHash: ref.manifestHash }));
    return `${JSON.stringify({ definition, defaultCompositionNodes: nodes }, null, 2)}\n`;
  }
  if (command === "validate") {
    const file = argv[1];
    const refs = file
      ? [readRef(file)]
      : [
          DEFAULT_ALGORITHM_REF,
          ...loadAlgorithmExperimentRegistry(algorithms).all().flatMap((manifest) =>
            manifest.variants.map((variant) => variant.algorithmRef)),
        ];
    for (const ref of refs) {
      validateAlgorithmRef(ref);
      if (!algorithms.has(ref)) throw new Error(`algorithm Composition is not registered: ${ref.manifestHash}`);
    }
    return `${JSON.stringify({ valid: true, compositions: refs.length }, null, 2)}\n`;
  }
  if (command === "diff") {
    if (!argv[1] || !argv[2]) throw new Error("diff requires <left-ref.json> <right-ref.json>");
    return `${JSON.stringify(diffAlgorithmRefs(readRef(argv[1]), readRef(argv[2])), null, 2)}\n`;
  }
  if (command === "catalog") {
    const generated = algorithmCatalogMarkdown(algorithms, DEFAULT_ALGORITHM_REF);
    if (argv[1] === "--check") {
      const current = readFileSync(catalogFile, "utf8");
      if (current !== generated) throw new Error("algorithm catalog is stale; run npm run algorithms -- catalog");
      return "algorithm catalog is current\n";
    }
    if (argv.length > 1) throw new Error("catalog accepts only --check");
    writeFileSync(catalogFile, generated, "utf8");
    return `${catalogFile}\n`;
  }
  throw new Error(usage());
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  try {
    process.stdout.write(runAlgorithmCommand(process.argv.slice(2)));
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
