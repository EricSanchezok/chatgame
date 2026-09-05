import type {
  ActionCompilationReferenceDataset,
  CandidateRetriever,
  CandidateRetrieverInput,
} from "../stabilized-behavior";
import type { LocalEncoderRuntime } from "../../../algorithms/eager-reference/candidate-retrieval/local-encoder";

export const ADVANCED_ACTION_COMPILATION_RETRIEVER_STRATEGIES = [
  "structure-closure",
  "structure-bm25f",
  "encoder-anchor",
  "encoder-coverage",
  "hybrid",
  "retrieve-expand-refine",
] as const;

export type AdvancedActionCompilationStrategy = typeof ADVANCED_ACTION_COMPILATION_RETRIEVER_STRATEGIES[number];

export interface AdvancedRetrieverOptions {
  budgetRatio?: number;
  closureDepth?: number;
  encoder?: LocalEncoderRuntime;
  /** Only the explicit 25%/30% diagnostic runs may opt into this. */
  allowDiagnosticBudget?: boolean;
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

interface FieldText {
  label: string;
  meaning: string;
  details: string;
  metadata: string;
}

interface CatalogIndex {
  hash: string;
  candidates: Candidate[];
  byKey: Map<string, Candidate>;
  byReference: Map<string, Set<string>>;
  fields: Map<string, FieldText>;
  documentFrequency: Map<string, number>;
  averageFieldLength: Map<keyof FieldText, number>;
}

interface Score {
  candidate: Candidate;
  lexical: number;
  encoder: number;
  combined: number;
}

const ACTION_KINDS = new Set([
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

const ACTION_USES = new Set([
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

const FIELD_WEIGHTS: Readonly<Record<keyof FieldText, number>> = {
  label: 5,
  meaning: 2,
  details: 2,
  metadata: 1,
};

const catalogCache = new Map<string, CatalogIndex>();

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function visible(candidate: Candidate, slotIndex: number): boolean {
  if (!candidate.scope || candidate.scope.kind === "shared") return true;
  return candidate.scope.kind === "slot" && candidate.scope.slot === slotIndex;
}

function typed(candidate: Candidate): boolean {
  return ACTION_KINDS.has(candidate.kind) && candidate.allowedUses.some((use) => ACTION_USES.has(use));
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

function collectCandidateReferences(value: unknown, output = new Set<string>()): Set<string> {
  if (typeof value === "string") {
    if (/^candidate_[0-9a-f]{12}$/u.test(value)) output.add(value);
    return output;
  }
  if (Array.isArray(value)) {
    value.forEach((entry) => collectCandidateReferences(entry, output));
    return output;
  }
  const object = record(value);
  if (object) Object.values(object).forEach((entry) => collectCandidateReferences(entry, output));
  return output;
}

function normalize(value: string): string {
  return value.normalize("NFC").toLocaleLowerCase("zh-CN");
}

function tokens(value: string): string[] {
  const normalized = normalize(value);
  const result = new Set<string>();
  for (const segment of normalized.split(/[^\p{L}\p{N}]+/u).filter(Boolean)) {
    result.add(segment);
    if (/\p{Script=Han}/u.test(segment)) {
      for (const character of segment) result.add(character);
      for (let index = 0; index + 1 < segment.length; index += 1) result.add(segment.slice(index, index + 2));
    } else if (segment.length >= 3) {
      for (let index = 0; index + 2 < segment.length; index += 1) result.add(segment.slice(index, index + 3));
    }
  }
  return [...result];
}

function candidateFields(candidate: Candidate): FieldText {
  const details: string[] = [];
  collectText(candidate.details, "details", details);
  const metadata = [candidate.kind, ...candidate.allowedUses].join(" ");
  return {
    label: normalize(candidate.label),
    meaning: normalize(candidate.meaning),
    details: normalize(details.join(" ")),
    metadata: normalize(metadata),
  };
}

function buildCatalogIndex(context: Readonly<Record<string, unknown>>): CatalogIndex {
  const catalog = record(context.referenceCatalog);
  const hash = typeof catalog?.hash === "string" ? catalog.hash : "catalog-without-hash";
  const cached = catalogCache.get(hash);
  if (cached) return cached;
  const values = Array.isArray(catalog?.candidates) ? catalog.candidates : [];
  const candidates = values.flatMap((value) => {
    const input = record(value);
    if (!input || typeof input.candidateKey !== "string" || typeof input.kind !== "string") return [];
    return [{
      candidateKey: input.candidateKey,
      kind: input.kind,
      label: typeof input.label === "string" ? input.label : "",
      meaning: typeof input.meaning === "string" ? input.meaning : "",
      allowedUses: Array.isArray(input.allowedUses)
        ? input.allowedUses.filter((use): use is string => typeof use === "string")
        : [],
      scope: record(input.scope) as Candidate["scope"],
      details: input.details,
    } satisfies Candidate];
  });
  const byKey = new Map(candidates.map((candidate) => [candidate.candidateKey, candidate]));
  const byReference = new Map<string, Set<string>>();
  const fields = new Map<string, FieldText>();
  const documentFrequency = new Map<string, number>();
  const lengths = new Map<keyof FieldText, number>([
    ["label", 0], ["meaning", 0], ["details", 0], ["metadata", 0],
  ]);
  for (const candidate of candidates) {
    const candidateFieldsValue = candidateFields(candidate);
    fields.set(candidate.candidateKey, candidateFieldsValue);
    for (const field of Object.keys(FIELD_WEIGHTS) as Array<keyof FieldText>) {
      const fieldTokens = tokens(candidateFieldsValue[field]);
      lengths.set(field, (lengths.get(field) ?? 0) + fieldTokens.length);
      const seen = new Set(fieldTokens);
      for (const term of seen) documentFrequency.set(term, (documentFrequency.get(term) ?? 0) + 1);
    }
    for (const reference of collectCandidateReferences(candidate.details)) {
      const linked = byReference.get(reference) ?? new Set<string>();
      linked.add(candidate.candidateKey);
      byReference.set(reference, linked);
    }
  }
  const averageFieldLength = new Map<keyof FieldText, number>();
  for (const field of Object.keys(FIELD_WEIGHTS) as Array<keyof FieldText>) {
    averageFieldLength.set(field, candidates.length === 0 ? 1 : (lengths.get(field) ?? 0) / candidates.length || 1);
  }
  const index: CatalogIndex = { hash, candidates, byKey, byReference, fields, documentFrequency, averageFieldLength };
  catalogCache.set(hash, index);
  return index;
}

function slotContext(input: CandidateRetrieverInput): Record<string, unknown> {
  const task = record(input.context.task);
  const slots = Array.isArray(task?.slots) ? task.slots : [];
  return record(slots.find((value) => record(value)?.slot === input.slotIndex)) ??
    record(slots[input.slotIndex]) ?? {};
}

function queryText(input: CandidateRetrieverInput): string {
  const values: string[] = [];
  collectText(slotContext(input), undefined, values);
  return normalize(values.join(" "));
}

function anchorKeys(input: CandidateRetrieverInput, index: CatalogIndex): Set<string> {
  const slot = slotContext(input);
  const references = record(slot.actionReferences);
  const anchors = new Set<string>();
  const add = (value: unknown): void => {
    if (typeof value !== "string") return;
    const candidate = index.byKey.get(value);
    if (candidate && visible(candidate, input.slotIndex) && typed(candidate)) anchors.add(value);
  };
  add(references?.actionCandidateKey);
  const actor = record(references?.actor);
  if (actor?.status === "unique") {
    add(actor.agentCandidateKey);
    add(actor.boundEntityCandidateKey);
  }
  const targets = Array.isArray(references?.targets) ? references.targets : [];
  for (const targetValue of targets) {
    const target = record(targetValue);
    if (target?.status === "unique" && Array.isArray(target.candidateKeys)) target.candidateKeys.forEach(add);
  }
  const profiles = Array.isArray(slot.temporalProfileEligibility) ? slot.temporalProfileEligibility : [];
  for (const profileValue of profiles) {
    const profile = record(profileValue);
    if (profile?.eligible === true) add(profile.profileRef);
  }
  return anchors;
}

function identityAliases(input: CandidateRetrieverInput, index: CatalogIndex, anchors: ReadonlySet<string>): string[] {
  const aliases: string[] = [];
  const slot = slotContext(input);
  const references = record(slot.actionReferences);
  const targets = Array.isArray(references?.targets) ? references.targets : [];
  for (const targetValue of targets) {
    const target = record(targetValue);
    if (target?.status === "unique" && typeof target.label === "string") aliases.push(target.label);
  }
  for (const key of anchors) {
    const candidate = index.byKey.get(key);
    if (!candidate) continue;
    aliases.push(candidate.label, candidate.meaning);
    const details = record(candidate.details);
    if (typeof details?.name === "string") aliases.push(details.name);
    collectText(details?.aliases, "alias", aliases);
  }
  collectText(record(slot.actorPerspective)?.self, undefined, aliases);
  collectText(record(slot.actorPerspective)?.knowledge, undefined, aliases);
  return [...new Set(aliases.flatMap(tokens).filter((value) => value.length >= 2))].sort();
}

function expandClosure(
  index: CatalogIndex,
  input: CandidateRetrieverInput,
  depth: number,
  seeds: ReadonlySet<string>,
  aliases: readonly string[],
): Set<string> {
  const visibleTyped = index.candidates.filter((candidate) => visible(candidate, input.slotIndex) && typed(candidate));
  const output = new Set<string>(seeds);
  const queue = [...seeds].map((key) => ({ key, level: 0 }));
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current.level >= depth) continue;
    const candidate = index.byKey.get(current.key);
    const neighbors = new Set<string>([
      ...collectCandidateReferences(candidate?.details),
      ...(index.byReference.get(current.key) ?? []),
    ]);
    for (const neighbor of neighbors) {
      const linked = index.byKey.get(neighbor);
      if (!linked || !visible(linked, input.slotIndex) || !typed(linked) || output.has(neighbor)) continue;
      output.add(neighbor);
      queue.push({ key: neighbor, level: current.level + 1 });
    }
  }
  const stateKinds = new Set(["meter", "rating", "quantity"]);
  const selectedEntities = new Set([...output].filter((key) => {
    const candidate = index.byKey.get(key);
    return candidate?.kind === "entity" || candidate?.kind === "agent";
  }));
  for (const candidate of visibleTyped) {
    if (stateKinds.has(candidate.kind)) {
      const details = record(candidate.details);
      const owner = details?.entityRef ?? details?.holderRef;
      if (typeof owner === "string" && selectedEntities.has(owner)) output.add(candidate.candidateKey);
      const label = normalize(candidate.label);
      if (aliases.some((alias) => alias.length >= 3 && label.includes(alias))) output.add(candidate.candidateKey);
    }
  }
  return output;
}

function bm25(index: CatalogIndex, candidate: Candidate, queryTerms: readonly string[]): number {
  const fields = index.fields.get(candidate.candidateKey);
  if (!fields || queryTerms.length === 0) return 0;
  let score = 0;
  for (const field of Object.keys(FIELD_WEIGHTS) as Array<keyof FieldText>) {
    const fieldTokens = tokens(fields[field]);
    const length = fieldTokens.length || 1;
    const averageLength = index.averageFieldLength.get(field) ?? 1;
    const counts = new Map<string, number>();
    for (const token of fieldTokens) counts.set(token, (counts.get(token) ?? 0) + 1);
    for (const term of queryTerms) {
      const frequency = counts.get(term) ?? 0;
      if (frequency === 0) continue;
      const documentFrequency = index.documentFrequency.get(term) ?? 0;
      const idf = Math.log(1 + (index.candidates.length - documentFrequency + 0.5) / (documentFrequency + 0.5));
      const tf = (frequency * 2.2) / (frequency + 1.2 * (0.25 + 0.75 * length / averageLength));
      score += FIELD_WEIGHTS[field] * idf * tf;
    }
  }
  return score;
}

function candidateTextForEncoder(index: CatalogIndex, candidate: Candidate): string {
  const fields = index.fields.get(candidate.candidateKey);
  return [fields?.label, fields?.meaning, fields?.details, fields?.metadata].filter(Boolean).join(" ");
}

function coverage(candidate: Candidate): Set<string> {
  const details = record(candidate.details);
  const result = new Set<string>([`kind:${candidate.kind}`]);
  candidate.allowedUses.forEach((use) => result.add(`use:${use}`));
  for (const key of ["entityRef", "holderRef", "subjectRef", "placementRef", "containerRef"]) {
    if (typeof details?.[key] === "string") result.add(`${key}:${details[key]}`);
  }
  return result;
}

function normalizeScores(scores: readonly Score[], field: "lexical" | "encoder"): Map<string, number> {
  const values = scores.map((entry) => entry[field]);
  const max = Math.max(...values, 0);
  const min = Math.min(...values, 0);
  const span = max - min;
  return new Map(scores.map((entry) => [entry.candidate.candidateKey, span === 0 ? 0 : (entry[field] - min) / span]));
}

function selectWithCoverage(
  candidates: readonly Candidate[],
  mandatory: ReadonlySet<string>,
  scores: ReadonlyMap<string, number>,
  budget: number,
): string[] {
  if (budget <= 0) return [];
  const mandatoryVisible = [...mandatory].filter((key) => candidates.some((candidate) => candidate.candidateKey === key));
  if (mandatoryVisible.length >= budget) return [...new Set(mandatoryVisible)].sort((left, right) => left.localeCompare(right));
  const selected = new Set(mandatoryVisible);
  const covered = new Set<string>();
  for (const candidate of candidates) if (selected.has(candidate.candidateKey)) coverage(candidate).forEach((feature) => covered.add(feature));
  while (selected.size < budget) {
    let best: Candidate | undefined;
    let bestValue = Number.NEGATIVE_INFINITY;
    for (const candidate of candidates) {
      if (selected.has(candidate.candidateKey)) continue;
      const features = coverage(candidate);
      let gain = 0;
      for (const feature of features) if (!covered.has(feature)) gain += feature.startsWith("kind:") ? 2 : 1;
      const value = (scores.get(candidate.candidateKey) ?? 0) + gain * 0.25;
      if (value > bestValue || (value === bestValue && candidate.candidateKey.localeCompare(best?.candidateKey ?? "") < 0)) {
        best = candidate;
        bestValue = value;
      }
    }
    if (!best) break;
    selected.add(best.candidateKey);
    coverage(best).forEach((feature) => covered.add(feature));
  }
  return [...selected].sort((left, right) => left.localeCompare(right));
}

function selectTop(
  candidates: readonly Candidate[],
  mandatory: ReadonlySet<string>,
  scores: ReadonlyMap<string, number>,
  budget: number,
): string[] {
  if (budget <= 0) return [];
  const selected = [...mandatory].filter((key) => candidates.some((candidate) => candidate.candidateKey === key));
  if (selected.length >= budget) return [...new Set(selected)].sort((left, right) => left.localeCompare(right));
  const ranked = [...candidates].sort((left, right) =>
    (scores.get(right.candidateKey) ?? 0) - (scores.get(left.candidateKey) ?? 0) ||
    left.candidateKey.localeCompare(right.candidateKey));
  for (const candidate of ranked) {
    if (selected.length >= budget) break;
    if (!selected.includes(candidate.candidateKey)) selected.push(candidate.candidateKey);
  }
  return [...new Set(selected)].sort((left, right) => left.localeCompare(right));
}

function visibleTypedCandidates(index: CatalogIndex, slotIndex: number): Candidate[] {
  return index.candidates.filter((candidate) => visible(candidate, slotIndex) && typed(candidate));
}

function strategyNeedsEncoder(strategy: AdvancedActionCompilationStrategy): boolean {
  return strategy === "encoder-anchor" || strategy === "encoder-coverage" || strategy === "hybrid" || strategy === "retrieve-expand-refine";
}

function retrieverForCase(
  strategy: AdvancedActionCompilationStrategy,
  input: CandidateRetrieverInput,
  index: CatalogIndex,
  encoderVectors: ReadonlyMap<string, readonly number[]> | undefined,
  queryVector: readonly number[] | undefined,
  options: Required<Pick<AdvancedRetrieverOptions, "budgetRatio" | "closureDepth">>,
): string[] {
  const candidates = visibleTypedCandidates(index, input.slotIndex);
  const visibleCount = index.candidates.filter((candidate) => visible(candidate, input.slotIndex)).length;
  const budget = Math.floor(visibleCount * options.budgetRatio);
  const anchors = anchorKeys(input, index);
  const aliases = identityAliases(input, index, anchors);
  const query = queryText(input);
  const queryTerms = [...new Set(tokens(`${query} ${aliases.join(" ")}`))];
  const baseScores = candidates.map((candidate): Score => {
    const lexical = bm25(index, candidate, queryTerms);
    const vector = encoderVectors?.get(candidate.candidateKey);
    const encoder = vector && queryVector ? dot(vector, queryVector) : 0;
    return { candidate, lexical, encoder, combined: lexical + encoder };
  });
  const lexicalScores = normalizeScores(baseScores, "lexical");
  const encoderScores = normalizeScores(baseScores, "encoder");
  const hybridScores = new Map(baseScores.map((entry) => [
    entry.candidate.candidateKey,
    (lexicalScores.get(entry.candidate.candidateKey) ?? 0) * 0.45 + (encoderScores.get(entry.candidate.candidateKey) ?? 0) * 0.55,
  ]));
  if (strategy === "structure-closure") {
    return selectWithCoverage(candidates, expandClosure(index, input, options.closureDepth, anchors, aliases), new Map(), budget);
  }
  if (strategy === "structure-bm25f") {
    const closure = expandClosure(index, input, options.closureDepth, anchors, aliases);
    return selectWithCoverage(candidates, closure, lexicalScores, budget);
  }
  if (strategy === "encoder-anchor") {
    return selectTop(candidates, anchors, encoderScores, budget);
  }
  if (strategy === "encoder-coverage") {
    return selectWithCoverage(candidates, anchors, encoderScores, budget);
  }
  const initial = new Set<string>([...anchors]);
  for (const entry of [...baseScores].sort((left, right) => (hybridScores.get(right.candidate.candidateKey) ?? 0) - (hybridScores.get(left.candidate.candidateKey) ?? 0) || left.candidate.candidateKey.localeCompare(right.candidate.candidateKey)).slice(0, Math.max(budget, 1))) {
    initial.add(entry.candidate.candidateKey);
  }
  const expanded = strategy === "retrieve-expand-refine"
    ? expandClosure(index, input, options.closureDepth, initial, aliases)
    : expandClosure(index, input, options.closureDepth, anchors, aliases);
  return selectWithCoverage(candidates, expanded, hybridScores, budget);
}

function dot(left: readonly number[], right: readonly number[]): number {
  const length = Math.min(left.length, right.length);
  let result = 0;
  for (let index = 0; index < length; index += 1) result += left[index]! * right[index]!;
  return result;
}

interface PreparedEncoderData {
  candidateVectors: Map<string, ReadonlyMap<string, readonly number[]>>;
  queryVectors: Map<string, readonly number[]>;
}

async function prepareEncoderData(
  dataset: ActionCompilationReferenceDataset,
  encoder: LocalEncoderRuntime,
): Promise<PreparedEncoderData> {
  const candidateVectors = new Map<string, ReadonlyMap<string, readonly number[]>>();
  const queryVectors = new Map<string, readonly number[]>();
  const indexes = new Map<string, CatalogIndex>();
  for (const contextRecord of dataset.contexts.values()) {
    const index = buildCatalogIndex(contextRecord.context);
    indexes.set(index.hash, index);
  }
  for (const [hash, index] of indexes) {
    const values = index.candidates.filter(typed).map((candidate) => candidateTextForEncoder(index, candidate));
    const vectors = await encoder.encodeBatch(values.map((value) => `passage: ${value}`));
    const byKey = new Map<string, readonly number[]>();
    index.candidates.filter(typed).forEach((candidate, position) => byKey.set(candidate.candidateKey, vectors[position] ?? []));
    candidateVectors.set(hash, byKey);
  }
  for (const item of dataset.cases) {
    const contextRecord = dataset.contexts.get(item.contextHash);
    if (!contextRecord) throw new Error(`case ${item.caseId} context disappeared during encoder preparation`);
    const query = queryText({ context: contextRecord.context, slotIndex: item.slotIndex });
    const values = await encoder.encodeBatch([`query: ${query}`]);
    queryVectors.set(query, values[0] ?? []);
  }
  return { candidateVectors, queryVectors };
}

export async function createActionCompilationAdvancedRetriever(
  strategy: AdvancedActionCompilationStrategy,
  dataset: ActionCompilationReferenceDataset,
  options: AdvancedRetrieverOptions = {},
): Promise<CandidateRetriever> {
  if (strategyNeedsEncoder(strategy) && !options.encoder) {
    throw new Error(`${strategy} requires a local encoder runtime`);
  }
  const budgetRatio = options.budgetRatio ?? 0.2;
  const maximumBudgetRatio = options.allowDiagnosticBudget === true ? 0.3 : 0.2;
  if (!Number.isFinite(budgetRatio) || budgetRatio <= 0 || budgetRatio > maximumBudgetRatio) {
    throw new Error(`budgetRatio must be in (0, ${maximumBudgetRatio}]`);
  }
  const closureDepth = options.closureDepth ?? 3;
  if (!Number.isSafeInteger(closureDepth) || closureDepth < 1 || closureDepth > 8) throw new Error("closureDepth must be an integer from 1 to 8");
  const prepared = options.encoder ? await prepareEncoderData(dataset, options.encoder) : undefined;
  return (input) => {
    const index = buildCatalogIndex(input.context);
    const vectors = prepared?.candidateVectors.get(index.hash);
    const queryVector = prepared?.queryVectors.get(queryText(input));
    return retrieverForCase(strategy, input, index, vectors, queryVector, { budgetRatio, closureDepth });
  };
}

export function clearAdvancedRetrieverCaches(): void {
  catalogCache.clear();
}
