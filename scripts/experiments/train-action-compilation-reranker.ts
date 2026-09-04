import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  extractGraphCandidateFeatureRows,
  graphFeatureVector,
} from "../../src/engine/benchmarks/action-compilation/retrievers/graph-aware";
import { loadActionCompilationReferenceDataset } from "../../src/engine/benchmarks/action-compilation/stabilized-behavior";
import { trainPairwiseLinearRanker, rankerFeatureSchemaHash } from "../../src/engine/benchmarks/action-compilation/training/linear-ranker";

const DEFAULT_DATASET = path.resolve("benchmarks/action-compilation/fullcatalog-stabilized/v1");
const DEFAULT_OUTPUT = path.resolve(".livingworld-benchmarks/models/action-compilation-reranker/exploratory-v1");

interface Args { dataset: string; output: string; force: boolean; exploratory: boolean; }
function required(argv: readonly string[], index: number, option: string): string {
  const result = argv[index];
  if (!result || result.startsWith("--")) throw new Error(`${option} requires a value`);
  return result;
}
function parse(argv: readonly string[]): Args {
  const args: Args = { dataset: DEFAULT_DATASET, output: DEFAULT_OUTPUT, force: false, exploratory: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]!;
    if (argument === "--dataset") args.dataset = path.resolve(required(argv, ++index, argument));
    else if (argument === "--output") args.output = path.resolve(required(argv, ++index, argument));
    else if (argument === "--force") args.force = true;
    else if (argument === "--exploratory") args.exploratory = true;
    else if (argument === "--help") throw new Error("usage: --dataset <dir> --output <dir> [--exploratory] [--force]");
    else throw new Error(`unknown argument: ${argument}`);
  }
  return args;
}

async function main(argv: readonly string[]): Promise<number> {
  let args: Args;
  try { args = parse(argv); } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.startsWith("usage:")) { process.stdout.write(`${message}\n`); return 0; }
    process.stderr.write(`${message}\n`); return 2;
  }
  try {
    const modelFile = path.join(args.output, "model.json");
    if (!args.force && existsSync(modelFile)) throw new Error(`ranker output already exists: ${modelFile} (use --force to replace it)`);
    const dataset = loadActionCompilationReferenceDataset(args.dataset);
    const positiveUniverse = new Set(dataset.cases.flatMap((item) => item.requiredCandidateKeys));
    const training = [] as Array<{ id: string; positive: readonly number[]; negative: readonly number[] }>;
    const validation = [] as Array<{ id: string; positive: readonly number[]; negative: readonly number[] }>;
    let contextCount = 0;
    for (const item of dataset.cases) {
      const contextRecord = dataset.contexts.get(item.contextHash);
      if (!contextRecord) throw new Error(`case ${item.caseId} context disappeared`);
      const rows = extractGraphCandidateFeatureRows({ context: contextRecord.context, slotIndex: item.slotIndex }, { maxPathDepth: 3 });
      const byKey = new Map(rows.map((row) => [row.candidateKey, row]));
      const negatives = rows
        .filter((row) => !positiveUniverse.has(row.candidateKey))
        .sort((left, right) =>
          right.features.relationPriority - left.features.relationPriority ||
          right.features.lexical - left.features.lexical || left.candidateKey.localeCompare(right.candidateKey))
        .slice(0, 8);
      const isValidation = Number.parseInt(item.contextHash.slice(-2), 16) % 5 === 0;
      for (const positiveKey of [...new Set(item.requiredCandidateKeys)].sort()) {
        const positive = byKey.get(positiveKey);
        if (!positive || negatives.length === 0) continue;
        for (const [negativeIndex, negative] of negatives.entries()) {
          const example = { id: `${item.caseId}:${positiveKey}:${negativeIndex}`, positive: graphFeatureVector(positive.features), negative: graphFeatureVector(negative.features) };
          (isValidation ? validation : training).push(example);
        }
      }
      contextCount += 1;
    }
    const independentSnapshots = new Set(dataset.cases.map((item) => `${item.source.worldHash}:${item.source.catalogHash}`)).size;
    const promotable = dataset.cases.length >= 200 && independentSnapshots >= 3 && !args.exploratory;
    if (!promotable && !args.exploratory && (dataset.cases.length < 200 || independentSnapshots < 3)) {
      throw new Error(`training requires at least 200 cases and 3 independent world/catalog snapshots (got ${dataset.cases.length} cases, ${independentSnapshots} snapshots); pass --exploratory for a non-promotable artifact`);
    }
    const artifact = trainPairwiseLinearRanker(training, {}, validation, promotable);
    const manifest = {
      schemaVersion: 1,
      kind: "action-compilation-reranker-training",
      datasetId: dataset.manifest.datasetId,
      datasetVersion: dataset.manifest.version,
      trainingCases: dataset.cases.length,
      trainingContexts: contextCount,
      independentSnapshots,
      split: { strategy: "context-hash", trainExamples: training.length, validationExamples: validation.length },
      featureSchemaHash: rankerFeatureSchemaHash(),
      seed: artifact.config.seed,
      optimizer: "deterministic-pairwise-logistic-sgd",
      hyperparameters: artifact.config,
      promotable: artifact.promotable,
      note: artifact.promotable ? "eligible for independent test evaluation" : "exploratory only; do not promote to production",
    };
    mkdirSync(args.output, { recursive: true });
    writeFileSync(modelFile, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
    writeFileSync(path.join(args.output, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    process.stdout.write(`${JSON.stringify({ output: args.output, trainingExamples: training.length, validationExamples: validation.length, promotable: artifact.promotable }, null, 2)}\n`);
    return 0;
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); return 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) void main(process.argv.slice(2)).then((code) => { process.exitCode = code; });
