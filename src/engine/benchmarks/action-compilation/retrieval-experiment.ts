import type {
  ActionCompilationReferenceDataset,
  CandidateRetriever,
} from "./stabilized-behavior";
import { allVisibleCandidateRetriever } from "./stabilized-behavior";

export const ACTION_COMPILATION_RETRIEVAL_EXPERIMENT_SCHEMA_VERSION = 2 as const;

export interface RetrievalExperimentPolicy {
  budgetRatio: number;
  minMicroRecall: number;
  minMacroRecall: number;
  minAverageCompression: number;
  maxP95ShortlistRatio: number;
  requireDeterministic: boolean;
  allowFallback: false;
}

export const DEFAULT_RETRIEVAL_EXPERIMENT_POLICY: RetrievalExperimentPolicy = {
  budgetRatio: 0.2,
  minMicroRecall: 0.9,
  minMacroRecall: 0.9,
  minAverageCompression: 0.8,
  maxP95ShortlistRatio: 0.2,
  requireDeterministic: true,
  allowFallback: false,
};

interface CandidateRecord {
  candidateKey: string;
  kind: string;
  allowedUses: string[];
  scope?: { kind?: string; slot?: number };
}

export interface RetrievalExperimentCaseResult {
  caseId: string;
  slotIndex: number;
  batchSize: number;
  fullVisibleCount: number;
  budget: number;
  returnedCount: number;
  normalizedShortlistRatio: number;
  compression: number;
  requiredCount: number;
  recalledCount: number;
  recall: number | null;
  missingKeys: string[];
  missingByKind: Record<string, number>;
  missingByUse: Record<string, number>;
  invalidKeys: string[];
  privateKeys: string[];
  budgetExceeded: boolean;
}

export interface RetrievalExperimentStratumResult {
  cases: number;
  requiredKeys: number;
  recalledKeys: number;
  recall: number | null;
}

export interface RetrievalExperimentBatchUnionResult extends RetrievalExperimentStratumResult {
  contextHash: string;
  batchSize: number;
  slots: number;
  returnedCount: number;
}

export interface RetrievalExperimentReport {
  schemaVersion: typeof ACTION_COMPILATION_RETRIEVAL_EXPERIMENT_SCHEMA_VERSION;
  kind: "action-compilation-retrieval-experiment";
  datasetId: string;
  datasetVersion: number;
  retriever: string;
  policy: RetrievalExperimentPolicy;
  cases: number;
  nonEmptyRequiredCases: number;
  emptyRequiredCases: number;
  requiredKeys: number;
  recalledKeys: number;
  microRecall: number | null;
  macroRecall: number | null;
  averageCompression: number;
  averageShortlistRatio: number;
  p95ShortlistRatio: number;
  minCaseRecall: number | null;
  p05CaseRecall: number | null;
  p10CaseRecall: number | null;
  byKind: Record<string, RetrievalExperimentStratumResult>;
  byUse: Record<string, RetrievalExperimentStratumResult>;
  byBatchSize: Record<string, RetrievalExperimentStratumResult>;
  byBatchUnion: RetrievalExperimentBatchUnionResult[];
  invalidOutputCases: number;
  invalidOutputKeys: number;
  budgetExceededCases: number;
  deterministic: boolean;
  hardGate: boolean;
  caseResults: RetrievalExperimentCaseResult[];
}

interface EvaluatedCase extends RetrievalExperimentCaseResult {
  // Used only while building batch-union diagnostics; never serialized.
  validReturnedKeys: ReadonlySet<string>;
}

function candidateRecord(value: unknown): CandidateRecord | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const input = value as Record<string, unknown>;
  if (typeof input.candidateKey !== "string" || typeof input.kind !== "string") return undefined;
  const scope = input.scope && typeof input.scope === "object" && !Array.isArray(input.scope)
    ? input.scope as { kind?: string; slot?: number }
    : undefined;
  return {
    candidateKey: input.candidateKey,
    kind: input.kind,
    allowedUses: Array.isArray(input.allowedUses)
      ? [...new Set(input.allowedUses.filter((use): use is string => typeof use === "string"))]
      : [],
    ...(scope === undefined ? {} : { scope }),
  };
}

function candidates(context: Record<string, unknown>): CandidateRecord[] {
  const catalog = context.referenceCatalog;
  if (!catalog || typeof catalog !== "object" || Array.isArray(catalog)) return [];
  const values = (catalog as { candidates?: unknown }).candidates;
  if (!Array.isArray(values)) return [];
  return values.flatMap((value) => {
    const candidate = candidateRecord(value);
    return candidate === undefined ? [] : [candidate];
  });
}

function visible(candidate: CandidateRecord, slotIndex: number): boolean {
  if (!candidate.scope || candidate.scope.kind === "shared") return true;
  return candidate.scope.kind === "slot" && candidate.scope.slot === slotIndex;
}

function percentile(values: readonly number[], percentileValue: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * percentileValue) - 1));
  return sorted[index] ?? 0;
}

function increment(target: Record<string, number>, key: string): void {
  target[key] = (target[key] ?? 0) + 1;
}

function evaluateCase(
  dataset: ActionCompilationReferenceDataset,
  item: ActionCompilationReferenceDataset["cases"][number],
  retriever: CandidateRetriever,
  policy: RetrievalExperimentPolicy,
): EvaluatedCase {
  const contextRecord = dataset.contexts.get(item.contextHash);
  if (!contextRecord) throw new Error(`case ${item.caseId} context disappeared during evaluation`);
  const catalog = candidates(contextRecord.context);
  const byKey = new Map(catalog.map((candidate) => [candidate.candidateKey, candidate]));
  const visibleKeys = new Set(catalog.filter((candidate) => visible(candidate, item.slotIndex)).map((candidate) => candidate.candidateKey));
  const fullVisibleCount = visibleKeys.size;
  const budget = Math.floor(fullVisibleCount * policy.budgetRatio);
  const returned = retriever({ context: structuredClone(contextRecord.context), slotIndex: item.slotIndex });
  if (!Array.isArray(returned) || returned.some((key) => typeof key !== "string")) {
    throw new Error(`retriever returned invalid output for ${item.caseId}`);
  }
  const uniqueReturned = [...new Set(returned)];
  const invalidKeys = uniqueReturned.filter((key) => !byKey.has(key));
  const privateKeys = uniqueReturned.filter((key) => byKey.has(key) && !visibleKeys.has(key));
  const returnedSet = new Set(uniqueReturned.filter((key) => visibleKeys.has(key)));
  const missingKeys = item.requiredCandidateKeys.filter((key) => !returnedSet.has(key));
  const missingByKind: Record<string, number> = {};
  const missingByUse: Record<string, number> = {};
  for (const key of missingKeys) {
    const candidate = byKey.get(key);
    if (!candidate) {
      increment(missingByKind, "unknown");
      continue;
    }
    increment(missingByKind, candidate.kind);
    for (const use of candidate.allowedUses) increment(missingByUse, use);
  }
  const requiredCount = item.requiredCandidateKeys.length;
  const recalledCount = requiredCount - missingKeys.length;
  const recall = requiredCount === 0 ? null : recalledCount / requiredCount;
  const normalizedShortlistRatio = fullVisibleCount === 0 ? 0 : uniqueReturned.length / fullVisibleCount;
  return {
    caseId: item.caseId,
    slotIndex: item.slotIndex,
    batchSize: item.batchSize,
    fullVisibleCount,
    budget,
    returnedCount: uniqueReturned.length,
    normalizedShortlistRatio,
    compression: 1 - normalizedShortlistRatio,
    requiredCount,
    recalledCount,
    recall,
    missingKeys,
    missingByKind,
    missingByUse,
    invalidKeys,
    privateKeys,
    budgetExceeded: uniqueReturned.length > budget,
    validReturnedKeys: returnedSet,
  };
}

function emptyStratum(): RetrievalExperimentStratumResult {
  return { cases: 0, requiredKeys: 0, recalledKeys: 0, recall: null };
}

function addCaseStratum(
  target: Record<string, RetrievalExperimentStratumResult>,
  key: string,
  requiredCount: number,
  recalledCount: number,
): void {
  const current = target[key] ?? emptyStratum();
  current.cases += 1;
  current.requiredKeys += requiredCount;
  current.recalledKeys += recalledCount;
  current.recall = current.requiredKeys === 0 ? null : current.recalledKeys / current.requiredKeys;
  target[key] = current;
}

function deterministicForDataset(
  dataset: ActionCompilationReferenceDataset,
  retriever: CandidateRetriever,
): boolean {
  for (const item of dataset.cases) {
    const contextRecord = dataset.contexts.get(item.contextHash);
    if (!contextRecord) throw new Error(`case ${item.caseId} context disappeared during determinism check`);
    const first = retriever({ context: structuredClone(contextRecord.context), slotIndex: item.slotIndex });
    const second = retriever({ context: structuredClone(contextRecord.context), slotIndex: item.slotIndex });
    if (JSON.stringify(first) !== JSON.stringify(second)) return false;
  }
  return true;
}

export function evaluateActionCompilationRetrieval(
  dataset: ActionCompilationReferenceDataset,
  retriever: CandidateRetriever,
  retrieverName: string,
  policy: RetrievalExperimentPolicy = DEFAULT_RETRIEVAL_EXPERIMENT_POLICY,
  options: { enforceBudget?: boolean } = {},
): RetrievalExperimentReport {
  const enforceBudget = options.enforceBudget ?? true;
  const evaluatedCases = dataset.cases.map((item) => evaluateCase(dataset, item, retriever, policy));
  const caseResults = evaluatedCases.map((evaluated) => {
    const { validReturnedKeys, ...result } = evaluated;
    void validReturnedKeys;
    return result;
  });
  const nonEmpty = caseResults.filter((result) => result.requiredCount > 0);
  const requiredKeys = nonEmpty.reduce((sum, result) => sum + result.requiredCount, 0);
  const recalledKeys = nonEmpty.reduce((sum, result) => sum + result.recalledCount, 0);
  const recalls = nonEmpty.map((result) => result.recall).filter((value): value is number => value !== null);
  const ratios = caseResults.map((result) => result.normalizedShortlistRatio);
  const averageShortlistRatio = ratios.length === 0 ? 0 : ratios.reduce((sum, value) => sum + value, 0) / ratios.length;
  const averageCompression = 1 - averageShortlistRatio;
  const microRecall = requiredKeys === 0 ? null : recalledKeys / requiredKeys;
  const macroRecall = recalls.length === 0 ? null : recalls.reduce((sum, value) => sum + value, 0) / recalls.length;
  const deterministic = deterministicForDataset(dataset, retriever);
  const invalidOutputKeys = caseResults.reduce((sum, result) => sum + result.invalidKeys.length + result.privateKeys.length, 0);
  const budgetExceededCases = caseResults.filter((result) => result.budgetExceeded).length;
  const byKind: Record<string, RetrievalExperimentStratumResult> = {};
  const byUse: Record<string, RetrievalExperimentStratumResult> = {};
  const byBatchSize: Record<string, RetrievalExperimentStratumResult> = {};
  const kindCases = new Map<string, Set<string>>();
  const useCases = new Map<string, Set<string>>();
  const caseById = new Map(dataset.cases.map((item) => [item.caseId, item]));
  for (const result of evaluatedCases) {
    addCaseStratum(byBatchSize, String(result.batchSize), result.requiredCount, result.recalledCount);
    const item = caseById.get(result.caseId);
    const contextRecord = item ? dataset.contexts.get(item.contextHash) : undefined;
    const byKey = contextRecord ? new Map(candidates(contextRecord.context).map((candidate) => [candidate.candidateKey, candidate])) : new Map();
    for (const key of item?.requiredCandidateKeys ?? []) {
      const candidate = byKey.get(key);
      if (!candidate) continue;
      const recalled = result.validReturnedKeys.has(key) ? 1 : 0;
      const kindStratum = byKind[candidate.kind] ?? emptyStratum();
      const kindCaseIds = kindCases.get(candidate.kind) ?? new Set<string>();
      kindCaseIds.add(result.caseId);
      kindCases.set(candidate.kind, kindCaseIds);
      kindStratum.requiredKeys += 1;
      kindStratum.recalledKeys += recalled;
      kindStratum.recall = kindStratum.recalledKeys / kindStratum.requiredKeys;
      byKind[candidate.kind] = kindStratum;
      for (const use of candidate.allowedUses) {
        const useStratum = byUse[use] ?? emptyStratum();
        const useCaseIds = useCases.get(use) ?? new Set<string>();
        useCaseIds.add(result.caseId);
        useCases.set(use, useCaseIds);
        useStratum.requiredKeys += 1;
        useStratum.recalledKeys += recalled;
        useStratum.recall = useStratum.recalledKeys / useStratum.requiredKeys;
        byUse[use] = useStratum;
      }
    }
  }
  for (const [kind, caseIds] of kindCases) byKind[kind]!.cases = caseIds.size;
  for (const [use, caseIds] of useCases) byUse[use]!.cases = caseIds.size;
  const batchGroups = new Map<string, { batchSize: number; cases: EvaluatedCase[] }>();
  for (const result of evaluatedCases) {
    const item = caseById.get(result.caseId);
    if (!item) continue;
    const group = batchGroups.get(item.contextHash) ?? { batchSize: result.batchSize, cases: [] };
    group.cases.push(result);
    batchGroups.set(item.contextHash, group);
  }
  const byBatchUnion: RetrievalExperimentBatchUnionResult[] = [...batchGroups.entries()].map(([contextHash, group]) => {
    const required = new Set(group.cases.flatMap((result) => caseById.get(result.caseId)?.requiredCandidateKeys ?? []));
    const returned = new Set(group.cases.flatMap((result) => [...result.validReturnedKeys]));
    const recalled = [...required].filter((key) => returned.has(key)).length;
    return {
      contextHash,
      batchSize: group.batchSize,
      slots: group.cases.length,
      cases: group.cases.length,
      requiredKeys: required.size,
      recalledKeys: recalled,
      recall: required.size === 0 ? null : recalled / required.size,
      returnedCount: returned.size,
    };
  }).sort((left, right) => left.contextHash.localeCompare(right.contextHash));
  const hardGate = (!policy.requireDeterministic || deterministic) &&
    (microRecall ?? 0) >= policy.minMicroRecall &&
    (macroRecall ?? 0) >= policy.minMacroRecall &&
    averageCompression > policy.minAverageCompression &&
    percentile(ratios, 0.95) < policy.maxP95ShortlistRatio &&
    invalidOutputKeys === 0 &&
    (!enforceBudget || budgetExceededCases === 0) &&
    caseResults.length > 0;
  return {
    schemaVersion: ACTION_COMPILATION_RETRIEVAL_EXPERIMENT_SCHEMA_VERSION,
    kind: "action-compilation-retrieval-experiment",
    datasetId: dataset.manifest.datasetId,
    datasetVersion: dataset.manifest.version,
    retriever: retrieverName,
    policy,
    cases: caseResults.length,
    nonEmptyRequiredCases: nonEmpty.length,
    emptyRequiredCases: caseResults.length - nonEmpty.length,
    requiredKeys,
    recalledKeys,
    microRecall,
    macroRecall,
    averageCompression,
    averageShortlistRatio,
    p95ShortlistRatio: percentile(ratios, 0.95),
    minCaseRecall: recalls.length === 0 ? null : Math.min(...recalls),
    p05CaseRecall: recalls.length === 0 ? null : percentile(recalls, 0.05),
    p10CaseRecall: recalls.length === 0 ? null : percentile(recalls, 0.1),
    byKind,
    byUse,
    byBatchSize,
    byBatchUnion,
    invalidOutputCases: caseResults.filter((result) => result.invalidKeys.length > 0 || result.privateKeys.length > 0).length,
    invalidOutputKeys,
    budgetExceededCases,
    deterministic,
    hardGate,
    caseResults,
  };
}

export function evaluateFullCatalogControl(
  dataset: ActionCompilationReferenceDataset,
  policy: RetrievalExperimentPolicy = DEFAULT_RETRIEVAL_EXPERIMENT_POLICY,
): RetrievalExperimentReport {
  return evaluateActionCompilationRetrieval(dataset, allVisibleCandidateRetriever, "full-catalog", policy, { enforceBudget: false });
}
