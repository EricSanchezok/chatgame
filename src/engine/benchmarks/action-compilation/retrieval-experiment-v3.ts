import { createHash } from "node:crypto";
import type {
  ActionCompilationReferenceDataset,
  CandidateRetriever,
} from "./stabilized-behavior";
import {
  DEFAULT_RETRIEVAL_EXPERIMENT_POLICY,
  evaluateActionCompilationRetrieval,
  type RetrievalExperimentCaseResult,
  type RetrievalExperimentPolicy,
  type RetrievalExperimentReport,
} from "./retrieval-experiment";
import { diagnoseGraphMissingKeys, type GraphMissingPathDiagnostic } from "../../algorithms/eager-reference/candidate-retrieval/graph-aware";

export const ACTION_COMPILATION_RETRIEVAL_V3_SCHEMA_VERSION = 3 as const;

export interface BootstrapConfidenceInterval {
  lower: number;
  upper: number;
  samples: number;
  seed: number;
}

export interface RetrievalV3CaseResult extends RetrievalExperimentCaseResult {
  missingPathDiagnostics: GraphMissingPathDiagnostic[];
}

export interface RetrievalV3Report extends Omit<RetrievalExperimentReport, "caseResults" | "kind" | "schemaVersion"> {
  schemaVersion: typeof ACTION_COMPILATION_RETRIEVAL_V3_SCHEMA_VERSION;
  kind: "action-compilation-retrieval-experiment-v3";
  budgetRatio: number;
  confidenceIntervals: {
    microRecall: BootstrapConfidenceInterval | null;
    macroRecall: BootstrapConfidenceInterval | null;
  };
  graphDiagnostics: {
    missingKeys: number;
    byStage: Record<string, number>;
    byExclusionReason: Record<string, number>;
  };
  caseResults: RetrievalV3CaseResult[];
}

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const position = (sorted.length - 1) * p;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower] ?? 0;
  const fraction = position - lower;
  return (sorted[lower] ?? 0) * (1 - fraction) + (sorted[upper] ?? 0) * fraction;
}

function bootstrap(
  values: readonly number[],
  seedText: string,
  statistic: (sample: readonly number[]) => number,
  samples = 1000,
): BootstrapConfidenceInterval | null {
  if (values.length === 0) return null;
  const digest = createHash("sha256").update(seedText).digest();
  const seed = digest.readUInt32BE(0);
  const random = seededRandom(seed);
  const estimates: number[] = [];
  for (let iteration = 0; iteration < samples; iteration += 1) {
    const sample = Array.from({ length: values.length }, () => values[Math.floor(random() * values.length)] ?? 0);
    estimates.push(statistic(sample));
  }
  return { lower: percentile(estimates, 0.025), upper: percentile(estimates, 0.975), samples, seed };
}

function bootstrapWeightedRecall(
  pairs: readonly { recalled: number; required: number }[],
  seedText: string,
  samples = 1000,
): BootstrapConfidenceInterval | null {
  if (pairs.length === 0) return null;
  const digest = createHash("sha256").update(seedText).digest();
  const seed = digest.readUInt32BE(0);
  const random = seededRandom(seed);
  const estimates: number[] = [];
  for (let iteration = 0; iteration < samples; iteration += 1) {
    const sample = Array.from({ length: pairs.length }, () => pairs[Math.floor(random() * pairs.length)]!);
    const required = sample.reduce((total, pair) => total + pair.required, 0);
    const recalled = sample.reduce((total, pair) => total + pair.recalled, 0);
    estimates.push(required === 0 ? 0 : recalled / required);
  }
  return { lower: percentile(estimates, 0.025), upper: percentile(estimates, 0.975), samples, seed };
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function diagnostics(
  dataset: ActionCompilationReferenceDataset,
  result: RetrievalExperimentCaseResult,
): GraphMissingPathDiagnostic[] {
  const item = dataset.cases.find((candidate) => candidate.caseId === result.caseId);
  const context = item ? dataset.contexts.get(item.contextHash) : undefined;
  if (!item || !context || result.missingKeys.length === 0) return [];
  return diagnoseGraphMissingKeys({ context: context.context, slotIndex: item.slotIndex }, result.missingKeys);
}

/**
 * V3 is an evaluation/reporting layer over the frozen v1 dataset. It does not
 * alter benchmark records or the v2 evaluator's selection semantics.
 */
export function evaluateActionCompilationRetrievalV3(
  dataset: ActionCompilationReferenceDataset,
  retriever: CandidateRetriever,
  retrieverName: string,
  policy: RetrievalExperimentPolicy = DEFAULT_RETRIEVAL_EXPERIMENT_POLICY,
  options: { enforceBudget?: boolean; bootstrapSamples?: number } = {},
): RetrievalV3Report {
  const base = evaluateActionCompilationRetrieval(dataset, retriever, retrieverName, policy, options);
  const caseResults = base.caseResults.map((result) => ({ ...result, missingPathDiagnostics: diagnostics(dataset, result) }));
  const graphByStage: Record<string, number> = {};
  const graphByReason: Record<string, number> = {};
  for (const result of caseResults) {
    for (const diagnostic of result.missingPathDiagnostics) {
      graphByStage[diagnostic.stage] = (graphByStage[diagnostic.stage] ?? 0) + 1;
      graphByReason[diagnostic.exclusionReason] = (graphByReason[diagnostic.exclusionReason] ?? 0) + 1;
    }
  }
  const recalls = caseResults.filter((result) => result.recall !== null).map((result) => result.recall!);
  const sampleCount = options.bootstrapSamples ?? 1000;
  const microPairs = caseResults.filter((result) => result.requiredCount > 0).map((result) => ({ recalled: result.recalledCount, required: result.requiredCount }));
  const micro = bootstrapWeightedRecall(microPairs, `${dataset.manifest.datasetId}:${dataset.manifest.version}:${retrieverName}:micro`, sampleCount);
  const macro = bootstrap(recalls, `${dataset.manifest.datasetId}:${dataset.manifest.version}:${retrieverName}:macro`, (sample) => sum(sample) / sample.length, sampleCount);
  return {
    ...base,
    schemaVersion: ACTION_COMPILATION_RETRIEVAL_V3_SCHEMA_VERSION,
    kind: "action-compilation-retrieval-experiment-v3",
    budgetRatio: policy.budgetRatio,
    confidenceIntervals: { microRecall: micro, macroRecall: macro },
    graphDiagnostics: {
      missingKeys: caseResults.reduce((count, result) => count + result.missingPathDiagnostics.length, 0),
      byStage: graphByStage,
      byExclusionReason: graphByReason,
    },
    caseResults,
  };
}

export function evaluateFullCatalogControlV3(
  dataset: ActionCompilationReferenceDataset,
  policy: RetrievalExperimentPolicy = DEFAULT_RETRIEVAL_EXPERIMENT_POLICY,
  options: { bootstrapSamples?: number } = {},
): RetrievalV3Report {
  return evaluateActionCompilationRetrievalV3(dataset, (input) => {
    const catalog = input.context.referenceCatalog;
    if (!catalog || typeof catalog !== "object" || Array.isArray(catalog)) return [];
    const values = (catalog as { candidates?: unknown }).candidates;
    if (!Array.isArray(values)) return [];
    return values.flatMap((value) => {
      if (!value || typeof value !== "object" || Array.isArray(value)) return [];
      const key = (value as { candidateKey?: unknown }).candidateKey;
      const scope = (value as { scope?: { kind?: string; slot?: number } }).scope;
      if (typeof key !== "string" || (scope?.kind === "slot" && scope.slot !== input.slotIndex)) return [];
      return [key];
    });
  }, "full-catalog", policy, { enforceBudget: false, bootstrapSamples: options.bootstrapSamples });
}
