import path from "node:path";
import {
  allVisibleCandidateRetriever,
  evaluateActionCompilationRecall,
  loadActionCompilationReferenceDataset,
} from "../../src/engine/benchmarks/action-compilation/stabilized-behavior";

function option(argv: readonly string[], name: string, fallback: string): string {
  const index = argv.indexOf(name);
  return index >= 0 ? path.resolve(argv[index + 1] ?? "") : path.resolve(fallback);
}

function main(): void {
  const datasetRoot = option(
    process.argv.slice(2),
    "--dataset",
    "benchmarks/action-compilation/fullcatalog-stabilized/v1",
  );
  const dataset = loadActionCompilationReferenceDataset(datasetRoot);
  const { manifest } = dataset;
  if (manifest.status !== "frozen") throw new Error(`benchmark must be frozen, got ${manifest.status}`);
  if (dataset.cases.length !== manifest.generation.targetCases) {
    throw new Error(`case count ${dataset.cases.length} does not match target ${manifest.generation.targetCases}`);
  }
  if (manifest.generation.providerRequests > manifest.generation.maxProviderRequests) {
    throw new Error("benchmark exceeded its provider request budget");
  }
  const report = evaluateActionCompilationRecall(dataset, allVisibleCandidateRetriever, "FullCatalog");
  if (report.microRecall !== 1 || report.macroRecall !== 1) {
    throw new Error(`FullCatalog recall must be 1.0, got micro=${report.microRecall} macro=${report.macroRecall}`);
  }
  process.stdout.write(`${JSON.stringify({
    dataset: manifest.datasetId,
    version: manifest.version,
    status: manifest.status,
    cases: dataset.cases.length,
    contexts: dataset.contexts.size,
    providerRequests: manifest.generation.providerRequests,
    fullCatalogRecall: report.microRecall,
  }, null, 2)}\n`);
}

try {
  main();
} catch (error) {
  process.stderr.write(`benchmark verification failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
