import type {
  CandidateRetriever,
  CandidateRetrieverInput,
} from "../stabilized-behavior";

export type ActionCompilationRetrieverStrategy =
  | "full-catalog"
  | "typed-full"
  | "lexical-topk"
  | "anchor-plus-lexical"
  | "hybrid-rrf"
  | "adaptive-hybrid";

export interface ActionCompilationRetrieverOptions {
  maxCandidates?: number;
}

interface Candidate {
  candidateKey: string;
  kind: string;
  label: string;
  meaning: string;
  allowedUses: string[];
  scope?: { kind?: string; slot?: number };
  details?: unknown;
}

interface ScoredCandidate {
  candidate: Candidate;
  lexical: number;
  token: number;
  character: number;
  hybrid: number;
}

interface CandidateText {
  label: string;
  all: string;
  labelTerms: Set<string>;
  allTerms: Set<string>;
  labelNgrams: Set<string>;
}

// Catalogs are immutable snapshots identified by their content hash. The
// evaluator deliberately clones contexts for every call, so caching by the
// snapshot hash avoids rebuilding token indexes for each strategy/configuration
// while keeping the retriever pure from the caller's perspective.
const catalogCandidatesCache = new Map<string, Candidate[]>();
const candidateTextCache = new WeakMap<Candidate, CandidateText>();
const slotQueryCache = new Map<string, string>();
const scoredCandidatesCache = new Map<string, ScoredCandidate[]>();
const rrfCandidatesCache = new Map<string, ScoredCandidate[]>();

const ACTION_COMPILATION_KINDS = new Set([
  "action",
  "agent",
  "entity",
  "fact",
  "meter",
  "placement",
  "quantity",
  "rating",
  "temporal_profile",
]);

const ACTION_COMPILATION_USES = new Set([
  "assertion",
  "audience",
  "cause",
  "conflict",
  "modifier",
  "profile",
  "source",
  "subject",
  "target",
]);

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function visible(candidate: Candidate, slotIndex: number): boolean {
  if (!candidate.scope || candidate.scope.kind === "shared") return true;
  return candidate.scope.kind === "slot" && candidate.scope.slot === slotIndex;
}

function candidatesFor(context: Readonly<Record<string, unknown>>): Candidate[] {
  const catalog = record(context.referenceCatalog);
  const values = Array.isArray(catalog?.candidates) ? catalog.candidates : [];
  const catalogHash = typeof catalog?.hash === "string" ? catalog.hash : undefined;
  if (catalogHash) {
    const cached = catalogCandidatesCache.get(catalogHash);
    if (cached) return cached;
  }
  const result = values.flatMap((value) => {
    const item = record(value);
    if (!item || typeof item.candidateKey !== "string" || typeof item.kind !== "string") return [];
    return [{
      candidateKey: item.candidateKey,
      kind: item.kind,
      label: typeof item.label === "string" ? item.label : "",
      meaning: typeof item.meaning === "string" ? item.meaning : "",
      allowedUses: Array.isArray(item.allowedUses)
        ? item.allowedUses.filter((use): use is string => typeof use === "string")
        : [],
      scope: record(item.scope) as Candidate["scope"],
      details: item.details,
    }];
  });
  if (catalogHash) catalogCandidatesCache.set(catalogHash, result);
  return result;
}

function slotContext(input: CandidateRetrieverInput): Record<string, unknown> {
  const task = record(input.context.task);
  const slots = Array.isArray(task?.slots) ? task.slots : [];
  const slot = slots.find((value) => record(value)?.slot === input.slotIndex);
  return record(slot) ?? record(slots[input.slotIndex]) ?? {};
}

function isOpaque(value: string): boolean {
  return /^candidate_[0-9a-f]{12}$/u.test(value) || /^ref:/u.test(value);
}

function collectText(value: unknown, key: string | undefined, output: string[], depth = 0): void {
  if (depth > 8 || value === null || value === undefined) return;
  if (typeof value === "string") {
    if (!isOpaque(value) && key !== "hash" && key !== "slot" && !/id$/iu.test(key ?? "")) output.push(value);
    return;
  }
  if (typeof value === "number" || typeof value === "boolean") return;
  if (Array.isArray(value)) {
    value.forEach((entry) => collectText(entry, key, output, depth + 1));
    return;
  }
  const object = record(value);
  if (!object) return;
  for (const [childKey, childValue] of Object.entries(object)) {
    if (/candidatekey|enginehandle|hash/iu.test(childKey)) continue;
    collectText(childValue, childKey, output, depth + 1);
  }
}

function queryText(input: CandidateRetrieverInput): string {
  const catalog = record(input.context.referenceCatalog);
  const catalogHash = typeof catalog?.hash === "string" ? catalog.hash : undefined;
  const cacheKey = catalogHash ? `${catalogHash}:${input.slotIndex}` : undefined;
  if (cacheKey) {
    const cached = slotQueryCache.get(cacheKey);
    if (cached !== undefined) return cached;
  }
  const values: string[] = [];
  collectText(slotContext(input), undefined, values);
  const result = values.join(" ").normalize("NFC").toLocaleLowerCase("zh-CN");
  if (cacheKey) slotQueryCache.set(cacheKey, result);
  return result;
}

function terms(text: string): Set<string> {
  const normalized = text.normalize("NFC").toLocaleLowerCase("zh-CN");
  const result = new Set<string>();
  for (const segment of normalized.split(/[^\p{L}\p{N}]+/u).filter(Boolean)) {
    result.add(segment);
    if (/\p{Script=Han}/u.test(segment)) {
      for (const character of segment) result.add(character);
      for (let index = 0; index + 1 < segment.length; index += 1) {
        result.add(segment.slice(index, index + 2));
      }
    } else if (segment.length >= 3) {
      for (let index = 0; index + 2 < segment.length; index += 1) {
        result.add(segment.slice(index, index + 3));
      }
    }
  }
  return result;
}

function candidateText(candidate: Candidate): CandidateText {
  const cached = candidateTextCache.get(candidate);
  if (cached) return cached;
  const detailText: string[] = [];
  collectText(candidate.details, "details", detailText);
  const label = `${candidate.label} ${candidate.meaning}`.normalize("NFC").toLocaleLowerCase("zh-CN");
  const text: CandidateText = {
    label,
    all: `${label} ${detailText.join(" ")}`.normalize("NFC").toLocaleLowerCase("zh-CN"),
    labelTerms: terms(label),
    allTerms: terms(`${label} ${detailText.join(" ")}`),
    labelNgrams: characterNgrams(label),
  };
  candidateTextCache.set(candidate, text);
  return text;
}

function overlap(left: Set<string>, right: Set<string>): number {
  let count = 0;
  for (const value of left) if (right.has(value)) count += 1;
  return count;
}

function characterNgrams(value: string): Set<string> {
  const normalized = value.replace(/\s+/gu, "");
  const result = new Set<string>();
  for (let size = 2; size <= 3; size += 1) {
    for (let index = 0; index + size <= normalized.length; index += 1) {
      result.add(normalized.slice(index, index + size));
    }
  }
  return result;
}

function scoreCandidates(candidates: readonly Candidate[], query: string): ScoredCandidate[] {
  const queryTerms = terms(query);
  const queryNgrams = characterNgrams(query);
  return candidates.map((candidate) => {
    const text = candidateText(candidate);
    const lexical = text.label.length > 0 && (query.includes(text.label) || text.label.includes(query)) ? 100 : 0;
    const token = overlap(queryTerms, text.labelTerms) * 4 + overlap(queryTerms, text.allTerms);
    const character = overlap(queryNgrams, text.labelNgrams);
    return {
      candidate,
      lexical,
      token,
      character,
      hybrid: lexical * 100 + token * 10 + character,
    };
  }).sort((left, right) => right.hybrid - left.hybrid ||
    right.token - left.token || right.character - left.character ||
    left.candidate.candidateKey.localeCompare(right.candidate.candidateKey));
}

function scoreCandidatesCached(
  candidates: readonly Candidate[],
  query: string,
  cacheKey: string | undefined,
): ScoredCandidate[] {
  if (cacheKey) {
    const cached = scoredCandidatesCache.get(cacheKey);
    if (cached) return cached;
  }
  const scored = scoreCandidates(candidates, query);
  if (cacheKey) scoredCandidatesCache.set(cacheKey, scored);
  return scored;
}

function typedCandidates(input: CandidateRetrieverInput): Candidate[] {
  return candidatesFor(input.context)
    .filter((candidate) => visible(candidate, input.slotIndex))
    .filter((candidate) => ACTION_COMPILATION_KINDS.has(candidate.kind))
    .filter((candidate) => candidate.allowedUses.some((use) => ACTION_COMPILATION_USES.has(use)));
}

function anchorKeys(input: CandidateRetrieverInput, candidates: readonly Candidate[]): Set<string> {
  const slot = slotContext(input);
  const anchors = new Set<string>();
  const add = (value: unknown): void => {
    if (typeof value !== "string") return;
    const candidate = candidates.find((entry) => entry.candidateKey === value);
    if (candidate && visible(candidate, input.slotIndex)) anchors.add(value);
  };
  const references = record(slot.actionReferences);
  add(references?.actionCandidateKey);
  const actor = record(references?.actor);
  if (actor?.status === "unique") {
    add(actor.agentCandidateKey);
    add(actor.boundEntityCandidateKey);
  }
  const targets = Array.isArray(references?.targets) ? references.targets : [];
  for (const value of targets) {
    const target = record(value);
    if (target?.status === "unique" && Array.isArray(target.candidateKeys)) {
      target.candidateKeys.forEach(add);
    }
  }
  const profiles = Array.isArray(slot.temporalProfileEligibility) ? slot.temporalProfileEligibility : [];
  for (const value of profiles) {
    const profile = record(value);
    if (profile?.eligible === true) add(profile.profileRef);
  }
  return anchors;
}

function visibleCandidates(input: CandidateRetrieverInput): Candidate[] {
  return candidatesFor(input.context).filter((candidate) => visible(candidate, input.slotIndex));
}

function takeWithAnchors(
  ranked: readonly ScoredCandidate[],
  anchors: ReadonlySet<string>,
  maxCandidates: number,
): string[] {
  const result = [...anchors];
  for (const entry of ranked) {
    if (result.length >= maxCandidates && maxCandidates > 0) break;
    if (!anchors.has(entry.candidate.candidateKey)) result.push(entry.candidate.candidateKey);
  }
  return [...new Set(result)].sort((left, right) => left.localeCompare(right));
}

function rrfRank(scored: readonly ScoredCandidate[], cacheKey?: string): ScoredCandidate[] {
  if (cacheKey) {
    const cached = rrfCandidatesCache.get(cacheKey);
    if (cached) return cached;
  }
  const channels: Array<readonly ScoredCandidate[]> = [
    [...scored].sort((left, right) => right.lexical - left.lexical || right.token - left.token || left.candidate.candidateKey.localeCompare(right.candidate.candidateKey)),
    [...scored].sort((left, right) => right.token - left.token || right.character - left.character || left.candidate.candidateKey.localeCompare(right.candidate.candidateKey)),
    [...scored].sort((left, right) => right.character - left.character || right.token - left.token || left.candidate.candidateKey.localeCompare(right.candidate.candidateKey)),
  ];
  const byKey = new Map<string, ScoredCandidate>();
  channels.forEach((channel) => channel.forEach((entry, index) => {
    const previous = byKey.get(entry.candidate.candidateKey) ?? { ...entry, hybrid: 0 };
    previous.hybrid += 1 / (60 + index + 1);
    byKey.set(entry.candidate.candidateKey, previous);
  }));
  const result = [...byKey.values()].sort((left, right) => right.hybrid - left.hybrid ||
    left.candidate.candidateKey.localeCompare(right.candidate.candidateKey));
  if (cacheKey) rrfCandidatesCache.set(cacheKey, result);
  return result;
}

function maxCandidates(options: ActionCompilationRetrieverOptions): number {
  const value = options.maxCandidates ?? 32;
  if (!Number.isSafeInteger(value) || value < 1) throw new Error("maxCandidates must be a positive integer");
  return value;
}

export function createActionCompilationRetriever(
  strategy: ActionCompilationRetrieverStrategy,
  options: ActionCompilationRetrieverOptions = {},
): CandidateRetriever {
  const limit = maxCandidates(options);
  return (input) => {
    const allVisible = visibleCandidates(input);
    if (strategy === "full-catalog") return allVisible.map((candidate) => candidate.candidateKey);
    const typed = typedCandidates(input);
    if (strategy === "typed-full") return typed.map((candidate) => candidate.candidateKey);
    const query = queryText(input);
    const anchors = anchorKeys(input, allVisible);
    const catalog = record(input.context.referenceCatalog);
    const catalogHash = typeof catalog?.hash === "string" ? catalog.hash : undefined;
    const scoreCacheKey = catalogHash ? `${catalogHash}:${input.slotIndex}:${query}` : undefined;
    const scored = scoreCandidatesCached(typed, query, scoreCacheKey);
    if (strategy === "lexical-topk") return scored.slice(0, limit).map((entry) => entry.candidate.candidateKey).sort();
    if (strategy === "anchor-plus-lexical") return takeWithAnchors(scored, anchors, limit);
    const hybrid = rrfRank(scored, scoreCacheKey ? `${scoreCacheKey}:rrf` : undefined);
    if (strategy === "hybrid-rrf") return takeWithAnchors(hybrid, anchors, limit);
    const shortlist = takeWithAnchors(hybrid, anchors, limit);
    const boundaryIndex = Math.min(Math.max(limit - anchors.size, 0), hybrid.length - 1);
    const boundary = hybrid[boundaryIndex];
    const next = hybrid[boundaryIndex + 1];
    // If the cutoff is tied, do not make an arbitrary irreversible cut. A
    // deterministic full typed view is safer than silently dropping a tie.
    if (boundary && next && boundary.hybrid === next.hybrid) return typed.map((candidate) => candidate.candidateKey);
    return shortlist;
  };
}

export const fullCatalogRetriever = createActionCompilationRetriever("full-catalog");
export const typedFullRetriever = createActionCompilationRetriever("typed-full");
