import { contentHash } from "../../../models/model-audit";

export interface RankedCandidate {
  candidateKey: string;
  score: number;
}

export interface SlotRetrievalResult {
  candidates: readonly RankedCandidate[];
  cache?: {
    passageHits: number;
    passageMisses: number;
    queryHit: boolean;
    readMs: number;
    queryEncodeMs: number;
  };
}

export interface RetrievalDiagnostics {
  selectedCount: number;
  visibleCount: number;
  batchBudget: number;
  batchShortlistRatio: number;
  prunedReferenceCount: number;
  anchorCount: number;
  budgetExceeded: false;
  perSlotSelectedCount: Readonly<Record<string, number>>;
  cache: {
    passageHits: number;
    passageMisses: number;
    queryHits: number;
    queryMisses: number;
    readMs: number;
    queryEncodeMs: number;
  };
}

export interface ActionCompilationRetrievalResult {
  modelContext: Record<string, unknown>;
  selectedKeysBySlot: ReadonlyMap<number, readonly string[]>;
  fullContextHash: string;
  modelContextHash: string;
  shortlistHash: string;
  diagnostics: RetrievalDiagnostics;
}

export interface ActionCompilationRetrievalRuntime {
  readonly version: string;
  readonly role: "action-compilation";
  retrieveBatch(input: {
    worldContentHash: string;
    fullContext: Readonly<Record<string, unknown>>;
    slotIndices: readonly number[];
    signal?: AbortSignal;
  }): Promise<ActionCompilationRetrievalResult>;
}

export interface ActionCompilationRetrievalRuntimeOptions {
  version: string;
  budgetRatio?: number;
  retrieveSlot(input: {
    worldContentHash: string;
    context: Readonly<Record<string, unknown>>;
    slotIndex: number;
    signal?: AbortSignal;
  }): Promise<SlotRetrievalResult>;
}

function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function visible(candidate: Record<string, unknown>, slotIndex: number): boolean {
  const scope = object(candidate.scope);
  if (!scope || scope.kind === "shared") return true;
  return scope.kind === "slot" && scope.slot === slotIndex;
}

function candidateKey(value: unknown): value is string {
  return typeof value === "string" && /^candidate_[0-9a-f]+$/u.test(value);
}

function slotContext(fullContext: Readonly<Record<string, unknown>>, slotIndex: number): Record<string, unknown> {
  const task = object(fullContext.task);
  const slots = Array.isArray(task?.slots) ? task.slots : [];
  return object(slots.find((value) => object(value)?.slot === slotIndex)) ?? object(slots[slotIndex]) ?? {};
}

export function actionCompilationMandatoryKeys(context: Readonly<Record<string, unknown>>, slotIndex: number): readonly string[] {
  const slot = slotContext(context, slotIndex);
  const references = object(slot.actionReferences);
  const result: string[] = [];
  const add = (value: unknown): void => { if (candidateKey(value)) result.push(value); };
  add(references?.actionCandidateKey);
  const actor = object(references?.actor);
  if (actor?.status === "unique") { add(actor.agentCandidateKey); add(actor.boundEntityCandidateKey); }
  if (Array.isArray(references?.targets)) for (const targetValue of references.targets) {
    const target = object(targetValue);
    if (target?.status === "unique" && Array.isArray(target.candidateKeys)) target.candidateKeys.forEach(add);
  }
  if (Array.isArray(slot.temporalProfileEligibility)) for (const profileValue of slot.temporalProfileEligibility) {
    const profile = object(profileValue);
    if (profile?.eligible === true) add(profile.profileRef);
  }
  return [...new Set(result)].sort();
}

function prune(value: unknown, selected: ReadonlySet<string>, counter: { count: number }): unknown {
  if (candidateKey(value) && !selected.has(value)) { counter.count += 1; return null; }
  if (Array.isArray(value)) return value.map((entry) => prune(entry, selected, counter)).filter((entry) => entry !== null);
  const input = object(value);
  if (!input) return value;
  return Object.fromEntries(Object.entries(input).map(([key, entry]) => [key, prune(entry, selected, counter)]));
}

function strictBudget(count: number, ratio: number): number {
  return Math.min(Math.floor(count * ratio), Math.max(0, Math.ceil(count * ratio) - 1));
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw signal.reason ?? new Error("candidate retrieval aborted");
}

export function createActionCompilationRetrievalRuntime(
  options: ActionCompilationRetrievalRuntimeOptions,
): ActionCompilationRetrievalRuntime {
  const budgetRatio = options.budgetRatio ?? 0.2;
  if (!Number.isFinite(budgetRatio) || budgetRatio <= 0 || budgetRatio > 0.2) {
    throw new Error("runtime budgetRatio must be in (0, 0.2]");
  }
  return {
    version: options.version,
    role: "action-compilation",
    async retrieveBatch({ worldContentHash, fullContext, slotIndices, signal }) {
      throwIfAborted(signal);
      const catalog = object(fullContext.referenceCatalog);
      const catalogCandidates = Array.isArray(catalog?.candidates) ? catalog.candidates.flatMap((entry) => {
        const candidate = object(entry);
        return candidate && candidateKey(candidate.candidateKey) ? [candidate] : [];
      }) : [];
      const byKey = new Map(catalogCandidates.map((candidate) => [candidate.candidateKey as string, candidate]));
      const slots = [...new Set(slotIndices)].sort((left, right) => left - right);
      const perSlot = new Map<number, SlotRetrievalResult>();
      const mandatoryBySlot = new Map<number, readonly string[]>();
      const cache = { passageHits: 0, passageMisses: 0, queryHits: 0, queryMisses: 0, readMs: 0, queryEncodeMs: 0 };
      for (const slotIndex of slots) {
        throwIfAborted(signal);
        const result = await options.retrieveSlot({ worldContentHash, context: fullContext, slotIndex, signal });
        const seen = new Set<string>();
        for (const candidate of result.candidates) {
          if (!candidateKey(candidate.candidateKey) || !Number.isFinite(candidate.score)) {
            throw new Error(`candidate retriever returned invalid output for slot ${slotIndex}`);
          }
          if (seen.has(candidate.candidateKey)) throw new Error(`candidate retriever returned duplicate key ${candidate.candidateKey} for slot ${slotIndex}`);
          seen.add(candidate.candidateKey);
          const catalogCandidate = byKey.get(candidate.candidateKey);
          if (!catalogCandidate || !visible(catalogCandidate, slotIndex)) {
            throw new Error(`candidate retriever returned invalid/private key for slot ${slotIndex}: ${candidate.candidateKey}`);
          }
        }
        const mandatory = actionCompilationMandatoryKeys(fullContext, slotIndex);
        const missing = mandatory.filter((key) => !seen.has(key));
        if (missing.length > 0) throw new Error(`candidate retrieval anchor missing for slot ${slotIndex}: ${missing.join(",")}`);
        mandatoryBySlot.set(slotIndex, mandatory);
        perSlot.set(slotIndex, result);
        if (result.cache) {
          cache.passageHits += result.cache.passageHits;
          cache.passageMisses += result.cache.passageMisses;
          cache.queryHits += result.cache.queryHit ? 1 : 0;
          cache.queryMisses += result.cache.queryHit ? 0 : 1;
          cache.readMs += result.cache.readMs;
          cache.queryEncodeMs += result.cache.queryEncodeMs;
        }
      }

      const batchBudget = strictBudget(catalogCandidates.length, budgetRatio);
      const selected = new Set([...mandatoryBySlot.values()].flat());
      if (selected.size > batchBudget) {
        throw new Error(`candidate retrieval mandatory set exceeds batch budget: ${selected.size} > ${batchBudget}`);
      }
      const aggregates = new Map<string, { coverage: number; score: number; bestRank: number }>();
      for (const result of perSlot.values()) result.candidates.forEach((candidate, rank) => {
        const value = aggregates.get(candidate.candidateKey) ?? { coverage: 0, score: Number.NEGATIVE_INFINITY, bestRank: Number.MAX_SAFE_INTEGER };
        value.coverage += 1;
        value.score = Math.max(value.score, candidate.score);
        value.bestRank = Math.min(value.bestRank, rank);
        aggregates.set(candidate.candidateKey, value);
      });
      const ranked = [...aggregates.entries()].sort(([leftKey, left], [rightKey, right]) =>
        right.coverage - left.coverage || right.score - left.score || left.bestRank - right.bestRank || leftKey.localeCompare(rightKey));
      for (const [key] of ranked) {
        if (selected.size >= batchBudget) break;
        selected.add(key);
      }
      const selectedKeysBySlot = new Map<number, readonly string[]>();
      for (const slotIndex of slots) {
        const eligible = new Set(perSlot.get(slotIndex)!.candidates.map((candidate) => candidate.candidateKey));
        const keys = [...selected].filter((key) => eligible.has(key)).sort();
        for (const mandatory of mandatoryBySlot.get(slotIndex) ?? []) {
          if (!keys.includes(mandatory)) throw new Error(`joint candidate selection dropped anchor ${mandatory} from slot ${slotIndex}`);
        }
        selectedKeysBySlot.set(slotIndex, keys);
      }

      const modelContext = structuredClone(fullContext) as Record<string, unknown>;
      const modelCatalog = object(modelContext.referenceCatalog);
      const counter = { count: 0 };
      if (modelCatalog) {
        modelCatalog.candidates = catalogCandidates
          .filter((candidate) => selected.has(candidate.candidateKey as string))
          .map((candidate) => prune(candidate, selected, counter));
      }
      const fullContextHash = contentHash(fullContext);
      const modelContextHash = contentHash(modelContext);
      const shortlistHash = contentHash({ version: options.version, selectedBySlot: [...selectedKeysBySlot.entries()] });
      return {
        modelContext,
        selectedKeysBySlot,
        fullContextHash,
        modelContextHash,
        shortlistHash,
        diagnostics: {
          selectedCount: selected.size,
          visibleCount: catalogCandidates.length,
          batchBudget,
          batchShortlistRatio: catalogCandidates.length === 0 ? 0 : selected.size / catalogCandidates.length,
          prunedReferenceCount: counter.count,
          anchorCount: new Set([...mandatoryBySlot.values()].flat()).size,
          budgetExceeded: false,
          perSlotSelectedCount: Object.fromEntries([...selectedKeysBySlot].map(([slot, keys]) => [String(slot), keys.length])),
          cache,
        },
      };
    },
  };
}
