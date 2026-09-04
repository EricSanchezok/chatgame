import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  evaluateActionCompilationRecall,
  loadActionCompilationReferenceDataset,
  type ActionCompilationRecallReport,
  type CandidateRetriever,
} from "../../src/engine/benchmarks/action-compilation/stabilized-behavior";
import {
  createActionCompilationRetriever,
  type ActionCompilationRetrieverStrategy,
} from "../../src/engine/benchmarks/action-compilation/retrievers/core";

const STRATEGIES: readonly ActionCompilationRetrieverStrategy[] = [
  "lexical-topk",
  "anchor-plus-lexical",
  "hybrid-rrf",
  "adaptive-hybrid",
];
const DEFAULT_KS = [16, 32, 64, 128];

interface Arguments {
  dataset: string;
  output: string;
  ks: number[];
  force: boolean;
}

interface ShortlistSummary {
  min: number;
  average: number;
  p95: number;
  max: number;
  reductionVsFullCatalog: number;
}

interface ComparisonRun {
  id: string;
  strategy: ActionCompilationRetrieverStrategy;
  maxCandidates: number | null;
  report: ActionCompilationRecallReport;
  shortlist: ShortlistSummary;
  deterministic: boolean;
  hardGate: boolean;
}

interface ComparisonResults {
  schemaVersion: 1;
  kind: "action-compilation-retriever-comparison";
  datasetId: string;
  datasetVersion: number;
  datasetPath: string;
  offline: {
    llmRequests: 0;
    networkRequests: 0;
    worldMutations: 0;
  };
  evaluatedAt: string;
  runs: Array<{
    id: string;
    strategy: ActionCompilationRetrieverStrategy;
    maxCandidates: number | null;
    cases: number;
    requiredKeys: number;
    recalledKeys: number;
    microRecall: number | null;
    macroRecall: number | null;
    invalidOutputCases: number;
    invalidOutputKeys: number;
    shortlist: ShortlistSummary;
    deterministic: boolean;
    hardGate: boolean;
  }>;
  paretoFront: string[];
  recommendation: {
    status: "candidate-selected" | "retain-fullcatalog";
    runId: string | null;
    reason: string;
  };
}

function requiredValue(argv: readonly string[], index: number, option: string): string {
  const value = argv[index];
  if (!value || value.startsWith("--")) throw new Error(`${option} requires a value`);
  return value;
}

function positiveInteger(value: string, label: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new Error(`${label} must be a positive integer`);
  return parsed;
}

function parseKs(value: string): number[] {
  const parsed = value.split(",").map((entry) => positiveInteger(entry.trim(), "k"));
  const unique = [...new Set(parsed)].sort((left, right) => left - right);
  if (unique.length === 0) throw new Error("at least one k is required");
  return unique;
}

function parseArguments(argv: readonly string[]): Arguments {
  let dataset: string | undefined;
  let output = path.resolve("benchmarks/action-compilation/fullcatalog-stabilized/evaluations/retrieval-ab-v1");
  let ks = DEFAULT_KS;
  let force = false;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]!;
    if (argument === "--dataset") dataset = path.resolve(requiredValue(argv, ++index, argument));
    else if (argument === "--output") output = path.resolve(requiredValue(argv, ++index, argument));
    else if (argument === "--ks") ks = parseKs(requiredValue(argv, ++index, argument));
    else if (argument === "--force") force = true;
    else if (argument === "--help") {
      throw new Error("usage: --dataset <directory> [--output <directory>] [--ks 16,32,64,128] [--force]");
    } else throw new Error(`unknown argument: ${argument}`);
  }
  if (!dataset) throw new Error("usage: --dataset <directory> [--output <directory>] [--ks 16,32,64,128] [--force]");
  return { dataset, output, ks, force };
}

function percentile95(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)] ?? 0;
}

function shortlistSummary(report: ActionCompilationRecallReport, fullAverage: number): ShortlistSummary {
  const counts = report.caseResults.map((result) => result.returnedCount);
  const average = counts.length === 0 ? 0 : counts.reduce((sum, value) => sum + value, 0) / counts.length;
  return {
    min: counts.length === 0 ? 0 : Math.min(...counts),
    average,
    p95: percentile95(counts),
    max: Math.max(...counts, 0),
    reductionVsFullCatalog: fullAverage === 0 ? 0 : 1 - average / fullAverage,
  };
}

function deterministicForDataset(
  dataset: ReturnType<typeof loadActionCompilationReferenceDataset>,
  retriever: CandidateRetriever,
): boolean {
  for (const item of dataset.cases) {
    const context = dataset.contexts.get(item.contextHash);
    if (!context) throw new Error(`case ${item.caseId} context disappeared during determinism check`);
    const first = retriever({ context: structuredClone(context.context), slotIndex: item.slotIndex });
    const second = retriever({ context: structuredClone(context.context), slotIndex: item.slotIndex });
    if (JSON.stringify(first) !== JSON.stringify(second)) return false;
  }
  return true;
}

function runComparison(
  dataset: ReturnType<typeof loadActionCompilationReferenceDataset>,
  strategy: ActionCompilationRetrieverStrategy,
  maxCandidates: number | undefined,
  fullAverage: number,
): ComparisonRun {
  const retriever = createActionCompilationRetriever(strategy, maxCandidates === undefined ? {} : { maxCandidates });
  const id = maxCandidates === undefined ? strategy : `${strategy}-k${maxCandidates}`;
  const report = evaluateActionCompilationRecall(dataset, retriever, id);
  const deterministic = deterministicForDataset(dataset, retriever);
  const hardGate = deterministic && report.microRecall === 1 && report.invalidOutputKeys === 0 &&
    report.caseResults.every((result) => result.missingKeys.length === 0);
  return {
    id,
    strategy,
    maxCandidates: maxCandidates ?? null,
    report,
    shortlist: shortlistSummary(report, fullAverage),
    deterministic,
    hardGate,
  };
}

function paretoFront(runs: readonly ComparisonRun[]): string[] {
  const valid = runs.filter((run) => run.hardGate);
  return valid.filter((candidate) => !valid.some((other) =>
    other.id !== candidate.id &&
    other.shortlist.average <= candidate.shortlist.average &&
    other.shortlist.reductionVsFullCatalog >= candidate.shortlist.reductionVsFullCatalog &&
    (other.shortlist.average < candidate.shortlist.average ||
      other.shortlist.reductionVsFullCatalog > candidate.shortlist.reductionVsFullCatalog))).map((run) => run.id);
}

function serializeRun(run: ComparisonRun) {
  return {
    id: run.id,
    strategy: run.strategy,
    maxCandidates: run.maxCandidates,
    cases: run.report.cases,
    requiredKeys: run.report.requiredKeys,
    recalledKeys: run.report.recalledKeys,
    microRecall: run.report.microRecall,
    macroRecall: run.report.macroRecall,
    invalidOutputCases: run.report.invalidOutputCases,
    invalidOutputKeys: run.report.invalidOutputKeys,
    shortlist: run.shortlist,
    deterministic: run.deterministic,
    hardGate: run.hardGate,
  };
}

async function main(argv: readonly string[]): Promise<number> {
  let args: Arguments;
  try {
    args = parseArguments(argv);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.startsWith("usage:")) {
      process.stdout.write(`${message}\n`);
      return 0;
    }
    process.stderr.write(`${message}\n`);
    return 2;
  }

  try {
    const resultFile = path.join(args.output, "results.json");
    if (!args.force && existsSync(resultFile)) {
      throw new Error(`evaluation output already exists: ${resultFile} (use --force to replace it)`);
    }
    const dataset = loadActionCompilationReferenceDataset(args.dataset);
    const full = runComparison(dataset, "full-catalog", undefined, 0);
    const fullAverage = full.shortlist.average;
    const runs: ComparisonRun[] = [full, runComparison(dataset, "typed-full", undefined, fullAverage)];
    for (const strategy of STRATEGIES) {
      for (const k of args.ks) runs.push(runComparison(dataset, strategy, k, fullAverage));
    }
    const front = paretoFront(runs);
    const compressed = runs.filter((run) => run.hardGate && run.strategy !== "full-catalog");
    const recommendation = compressed.length === 0
      ? {
        status: "retain-fullcatalog" as const,
        runId: null,
        reason: "No deterministic compressed shortlist reached 100% recall with zero invalid/private outputs; retain FullCatalog.",
      }
      : (() => {
        const selected = [...compressed].sort((left, right) => left.shortlist.average - right.shortlist.average || left.id.localeCompare(right.id))[0]!;
        return {
          status: "candidate-selected" as const,
          runId: selected.id,
          reason: "Selected the smallest deterministic shortlist among runs that passed the 100% recall and zero-invalid hard gates.",
        };
      })();
    const output: ComparisonResults = {
      schemaVersion: 1,
      kind: "action-compilation-retriever-comparison",
      datasetId: dataset.manifest.datasetId,
      datasetVersion: dataset.manifest.version,
      datasetPath: path.relative(process.cwd(), dataset.root) || ".",
      offline: { llmRequests: 0, networkRequests: 0, worldMutations: 0 },
      evaluatedAt: new Date().toISOString(),
      runs: runs.map(serializeRun),
      paretoFront: front.sort((left, right) => left.localeCompare(right)),
      recommendation,
    };
    mkdirSync(args.output, { recursive: true });
    writeFileSync(resultFile, `${JSON.stringify(output, null, 2)}\n`, "utf8");
    const reportDirectory = path.join(args.output, "reports");
    mkdirSync(reportDirectory, { recursive: true });
    for (const run of runs) {
      writeFileSync(path.join(reportDirectory, `${run.id}.json`), `${JSON.stringify(run.report, null, 2)}\n`, "utf8");
    }
    process.stdout.write(`${JSON.stringify({
      dataset: output.datasetId,
      cases: dataset.cases.length,
      runs: runs.length,
      recommendation,
      output: resultFile,
    }, null, 2)}\n`);
    return 0;
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void main(process.argv.slice(2)).then((code) => { process.exitCode = code; });
}
