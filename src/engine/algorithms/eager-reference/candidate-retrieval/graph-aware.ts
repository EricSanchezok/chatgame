import type {
  ActionCompilationReferenceDataset,
  CandidateRetriever,
  CandidateRetrieverInput,
} from "../../../benchmarks/action-compilation/stabilized-behavior";
import type { LocalEncoderRuntime } from "./local-encoder";
import type { PassageEmbeddingEncoder } from "./embedding-cache";
import { CachedQueryEncoder } from "./local-encoder";
import type { ActionCompilationRetrievalRuntimeOptions, SlotRetrievalResult } from "./runtime";

export const ACTION_COMPILATION_PASSAGE_SCHEMA_VERSION = 1 as const;

/** Relation types exposed by the C3 candidate graph. */
export type CandidateGraphRelation =
  | "agent-entity"
  | "entity-placement"
  | "placement-container"
  | "entity-meter"
  | "entity-quantity"
  | "entity-rating"
  | "fact-subject"
  | "fact-object"
  | "condition-subject"
  | "action-actor"
  | "action-target"
  | "action-profile"
  | "candidate-reference";

export const GRAPH_FEATURE_SCHEMA_VERSION = 1 as const;

export interface CandidateGraphEdge {
  from: string;
  to: string;
  relation: CandidateGraphRelation;
  direction: "forward" | "reverse";
  sourceField: string;
}

export interface GraphAwareRetrieverOptions {
  budgetRatio?: number;
  maxPathDepth?: number;
  encoder?: LocalEncoderRuntime;
  passageEncoder?: PassageEmbeddingEncoder;
  allowPassageCacheWrite?: boolean;
  ranker?: GraphRankerModel;
  allowDiagnosticBudget?: boolean;
}

export type GraphAwareStrategy =
  | "graph-one-hop"
  | "graph-role"
  | "graph-hybrid"
  | "graph-encoder"
  | "graph-learned";

export interface GraphRankerModel {
  schemaVersion: typeof GRAPH_FEATURE_SCHEMA_VERSION;
  featureNames: readonly string[];
  weights: readonly number[];
  bias: number;
  modelHash?: string;
}

export interface GraphMissingPathDiagnostic {
  candidateKey: string;
  shortestPathDepth: number | null;
  relationPath: CandidateGraphRelation[];
  stage: "anchor" | "graph" | "lexical" | "encoder" | "unseen";
  exclusionReason: "not-visible" | "not-typed" | "not-seeded" | "not-reachable" | "unknown";
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

interface GraphIndex {
  hash: string;
  candidates: Candidate[];
  byKey: Map<string, Candidate>;
  edges: Map<string, CandidateGraphEdge[]>;
  reverseEdges: Map<string, CandidateGraphEdge[]>;
  fields: Map<string, FieldText>;
  documentFrequency: Map<string, number>;
  averageFieldLength: number;
}

interface FieldText {
  label: string;
  meaning: string;
  details: string;
  metadata: string;
}

interface PathEvidence {
  depth: number;
  priority: number;
  relations: CandidateGraphRelation[];
}

export interface CandidateFeatures {
  anchor: number;
  role: number;
  pathDepth: number;
  relationPriority: number;
  lexical: number;
  encoder: number;
  reverseReference: number;
  stateOwner: number;
  graphDegree: number;
  kindCoverage: number;
  useCoverage: number;
}

export interface GraphCandidateFeatureRow {
  candidateKey: string;
  features: CandidateFeatures;
  kind: string;
  allowedUses: readonly string[];
  relationPath: CandidateGraphRelation[];
}

export const GRAPH_FEATURE_NAMES: readonly string[] = [
  "anchor",
  "role",
  "pathDepth",
  "relationPriority",
  "lexical",
  "encoder",
  "reverseReference",
  "stateOwner",
  "graphDegree",
  "kindCoverage",
  "useCoverage",
];

const SUPPORTED_KINDS = new Set([
  "action",
  "agent",
  "entity",
  "condition",
  "fact",
  "meter",
  "placement",
  "quantity",
  "rating",
  "temporal_profile",
]);

const SUPPORTED_USES = new Set([
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

const RELATION_PRIORITY: Readonly<Record<CandidateGraphRelation, number>> = {
  "action-actor": 100,
  "action-target": 100,
  "action-profile": 100,
  "agent-entity": 90,
  "entity-placement": 80,
  "placement-container": 70,
  "entity-meter": 65,
  "entity-quantity": 65,
  "entity-rating": 65,
  "fact-subject": 60,
  "fact-object": 60,
  "condition-subject": 55,
  "candidate-reference": 35,
};

const catalogCache = new Map<string, GraphIndex>();

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
  return SUPPORTED_KINDS.has(candidate.kind) && candidate.allowedUses.some((use) => SUPPORTED_USES.has(use));
}

function normalize(value: string): string {
  return value.normalize("NFC").toLocaleLowerCase("zh-CN");
}

function isOpaque(value: string): boolean {
  return /^candidate_[0-9a-f]{12}$/u.test(value) || /^ref:/u.test(value);
}

function tokens(value: string): string[] {
  const normalized = normalize(value);
  const output = new Set<string>();
  for (const segment of normalized.split(/[^\p{L}\p{N}]+/u).filter(Boolean)) {
    output.add(segment);
    if (/\p{Script=Han}/u.test(segment)) {
      for (const character of segment) output.add(character);
      for (let index = 0; index + 1 < segment.length; index += 1) output.add(segment.slice(index, index + 2));
    } else if (segment.length >= 3) {
      for (let index = 0; index + 2 < segment.length; index += 1) output.add(segment.slice(index, index + 3));
    }
  }
  return [...output];
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

function identityTerms(candidate: Candidate): Set<string> {
  const values: string[] = [candidate.label];
  const details = record(candidate.details);
  if (typeof details?.name === "string") values.push(details.name);
  if (typeof details?.displayName === "string") values.push(details.displayName);
  return new Set(values.flatMap(tokens).filter((token) => token.length >= 2));
}

function relationForField(field: string, candidate: Candidate): CandidateGraphRelation {
  if (field === "entityRef" && candidate.kind === "agent") return "agent-entity";
  if (field === "entityRef" && candidate.kind === "placement") return "entity-placement";
  if (field === "placementRef" && candidate.kind === "entity") return "entity-placement";
  if (field === "containerRef") return "placement-container";
  if (field === "entityRef" && candidate.kind === "meter") return "entity-meter";
  if (field === "holderRef") return "entity-quantity";
  if (field === "entityRef" && candidate.kind === "rating") return "entity-rating";
  if (field === "subjectRef" && candidate.kind === "condition") return "condition-subject";
  if (field === "subjectRef" && candidate.kind === "fact") return "fact-subject";
  if (field === "value" && candidate.kind === "fact") return "fact-object";
  return "candidate-reference";
}

function candidateFields(candidate: Candidate): FieldText {
  const details: string[] = [];
  collectText(candidate.details, "details", details);
  return {
    label: normalize(candidate.label),
    meaning: normalize(candidate.meaning),
    details: normalize(details.join(" ")),
    metadata: normalize([candidate.kind, ...candidate.allowedUses].join(" ")),
  };
}

function buildCatalogIndex(context: Readonly<Record<string, unknown>>): GraphIndex {
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
  const edges = new Map<string, CandidateGraphEdge[]>();
  const reverseEdges = new Map<string, CandidateGraphEdge[]>();
  const fields = new Map<string, FieldText>();
  const documentFrequency = new Map<string, number>();
  let totalFieldLength = 0;
  const addEdge = (edge: CandidateGraphEdge): void => {
    const outgoing = edges.get(edge.from) ?? [];
    outgoing.push(edge);
    edges.set(edge.from, outgoing);
    const incoming = reverseEdges.get(edge.to) ?? [];
    incoming.push(edge);
    reverseEdges.set(edge.to, incoming);
  };
  for (const candidate of candidates) {
    const fieldText = candidateFields(candidate);
    fields.set(candidate.candidateKey, fieldText);
    const candidateTokens = tokens(`${fieldText.label} ${fieldText.meaning} ${fieldText.details} ${fieldText.metadata}`);
    totalFieldLength += candidateTokens.length;
    for (const token of new Set(candidateTokens)) documentFrequency.set(token, (documentFrequency.get(token) ?? 0) + 1);
    const details = record(candidate.details);
    if (details) {
      for (const [field, value] of Object.entries(details)) {
        const references = collectCandidateReferences(value);
        for (const reference of references) {
          if (!byKey.has(reference)) continue;
          const relation = relationForField(field, candidate);
          addEdge({ from: candidate.candidateKey, to: reference, relation, direction: "forward", sourceField: field });
          addEdge({ from: reference, to: candidate.candidateKey, relation, direction: "reverse", sourceField: field });
        }
      }
    }
  }
  // Some catalogs encode the agent/entity identity only in labels (for
  // example `governor-tyrilas` ↔ `总督 Tyrilas`) rather than an explicit
  // entityRef. Add a conservative identity edge for one shared token; opaque
  // keys never participate in this comparison.
  const identityCandidates = candidates.filter((candidate) => candidate.kind === "agent" || candidate.kind === "entity");
  for (const left of identityCandidates) {
    const leftTerms = identityTerms(left);
    for (const right of identityCandidates) {
      if (left.candidateKey >= right.candidateKey || left.kind === right.kind) continue;
      const overlap = [...leftTerms].some((term) => term.length >= 4 && identityTerms(right).has(term));
      if (!overlap) continue;
      addEdge({ from: left.candidateKey, to: right.candidateKey, relation: "agent-entity", direction: "forward", sourceField: "identity.label" });
      addEdge({ from: right.candidateKey, to: left.candidateKey, relation: "agent-entity", direction: "reverse", sourceField: "identity.label" });
    }
  }
  for (const collection of [edges, reverseEdges]) {
    for (const [key, valuesForKey] of collection) {
      collection.set(key, valuesForKey.sort((left, right) =>
        left.relation.localeCompare(right.relation) || left.to.localeCompare(right.to) || left.sourceField.localeCompare(right.sourceField)));
    }
  }
  const index: GraphIndex = {
    hash,
    candidates,
    byKey,
    edges,
    reverseEdges,
    fields,
    documentFrequency,
    averageFieldLength: candidates.length === 0 ? 1 : totalFieldLength / candidates.length,
  };
  catalogCache.set(hash, index);
  return index;
}

function slotContext(input: CandidateRetrieverInput): Record<string, unknown> {
  const task = record(input.context.task);
  const slots = Array.isArray(task?.slots) ? task.slots : [];
  return record(slots.find((value) => record(value)?.slot === input.slotIndex)) ?? record(slots[input.slotIndex]) ?? {};
}

function queryText(input: CandidateRetrieverInput): string {
  const values: string[] = [];
  collectText(slotContext(input), undefined, values);
  return normalize(values.join(" "));
}

function anchorKeys(input: CandidateRetrieverInput, index: GraphIndex): { keys: Set<string>; roles: Map<string, Set<string>> } {
  const slot = slotContext(input);
  const references = record(slot.actionReferences);
  const keys = new Set<string>();
  const roles = new Map<string, Set<string>>();
  const add = (value: unknown, role: string): void => {
    if (typeof value !== "string") return;
    const candidate = index.byKey.get(value);
    if (!candidate || !visible(candidate, input.slotIndex) || !typed(candidate)) return;
    keys.add(value);
    const candidateRoles = roles.get(value) ?? new Set<string>();
    candidateRoles.add(role);
    roles.set(value, candidateRoles);
  };
  add(references?.actionCandidateKey, "action");
  const actor = record(references?.actor);
  if (actor?.status === "unique") {
    add(actor.agentCandidateKey, "actor");
    add(actor.boundEntityCandidateKey, "actor");
  }
  const targets = Array.isArray(references?.targets) ? references.targets : [];
  for (const value of targets) {
    const target = record(value);
    if (target?.status === "unique" && Array.isArray(target.candidateKeys)) target.candidateKeys.forEach((key) => add(key, "target"));
  }
  const profiles = Array.isArray(slot.temporalProfileEligibility) ? slot.temporalProfileEligibility : [];
  for (const value of profiles) {
    const profile = record(value);
    if (profile?.eligible === true) add(profile.profileRef, "profile");
  }
  return { keys, roles };
}

function aliases(input: CandidateRetrieverInput, index: GraphIndex, anchors: ReadonlySet<string>): string[] {
  const output: string[] = [];
  const slot = slotContext(input);
  const references = record(slot.actionReferences);
  const targets = Array.isArray(references?.targets) ? references.targets : [];
  for (const value of targets) {
    const target = record(value);
    if (target?.status === "unique" && typeof target.label === "string") output.push(target.label);
  }
  for (const key of anchors) {
    const candidate = index.byKey.get(key);
    if (!candidate) continue;
    output.push(candidate.label, candidate.meaning);
    const details = record(candidate.details);
    if (typeof details?.name === "string") output.push(details.name);
    collectText(details?.aliases, "alias", output);
  }
  collectText(record(slot.actorPerspective)?.self, undefined, output);
  collectText(record(slot.actorPerspective)?.knowledge, undefined, output);
  return [...new Set(output.flatMap(tokens))].sort();
}

function relationAllowed(relation: CandidateGraphRelation, role: string | undefined, candidate: Candidate): boolean {
  if (role === "profile") return relation === "action-profile" && candidate.kind === "temporal_profile";
  if (role === "target") return relation !== "action-profile" && candidate.allowedUses.includes("target");
  if (role === "actor") return relation !== "action-profile" && (candidate.kind === "agent" || candidate.kind === "entity" || candidate.allowedUses.includes("subject"));
  if (role === "action") return relation !== "action-profile" || candidate.kind === "temporal_profile";
  return true;
}

/**
 * Action references live on the slot rather than in candidate.details.  They
 * are still part of the C3 relationship graph, so expose them as ephemeral
 * edges during retrieval.  Keeping them out of the catalog index prevents a
 * slot-local reference from leaking into another slot or snapshot.
 */
function slotRoleEdges(input: CandidateRetrieverInput, index: GraphIndex): CandidateGraphEdge[] {
  const slot = slotContext(input);
  const references = record(slot.actionReferences);
  if (!references) return [];
  const output: CandidateGraphEdge[] = [];
  const action = typeof references.actionCandidateKey === "string" ? references.actionCandidateKey : undefined;
  const add = (from: unknown, to: unknown, relation: CandidateGraphRelation, sourceField: string): void => {
    if (typeof from !== "string" || typeof to !== "string" || from === to) return;
    const fromCandidate = index.byKey.get(from);
    const toCandidate = index.byKey.get(to);
    if (!fromCandidate || !toCandidate || !visible(fromCandidate, input.slotIndex) || !visible(toCandidate, input.slotIndex)) return;
    if (!typed(fromCandidate) || !typed(toCandidate)) return;
    output.push({ from, to, relation, direction: "forward", sourceField });
    output.push({ from: to, to: from, relation, direction: "reverse", sourceField });
  };
  const actor = record(references.actor);
  if (action && actor?.status === "unique") {
    add(action, actor.agentCandidateKey, "action-actor", "actionReferences.actor.agentCandidateKey");
    add(action, actor.boundEntityCandidateKey, "action-actor", "actionReferences.actor.boundEntityCandidateKey");
  }
  if (action && Array.isArray(references.targets)) {
    references.targets.forEach((targetValue, targetIndex) => {
      const target = record(targetValue);
      if (target?.status !== "unique" || !Array.isArray(target.candidateKeys)) return;
      target.candidateKeys.forEach((key) => add(action, key, "action-target", `actionReferences.targets[${targetIndex}]`));
    });
  }
  if (action && Array.isArray(slot.temporalProfileEligibility)) {
    slot.temporalProfileEligibility.forEach((profileValue, profileIndex) => {
      const profile = record(profileValue);
      if (profile?.eligible === true) add(action, profile.profileRef, "action-profile", `temporalProfileEligibility[${profileIndex}]`);
    });
  }
  return output.sort((left, right) =>
    left.from.localeCompare(right.from) || left.to.localeCompare(right.to) ||
    left.relation.localeCompare(right.relation) || left.direction.localeCompare(right.direction));
}

function graphPaths(
  index: GraphIndex,
  input: CandidateRetrieverInput,
  seeds: ReadonlySet<string>,
  roles: ReadonlyMap<string, ReadonlySet<string>>,
  maxDepth: number,
): Map<string, PathEvidence> {
  const paths = new Map<string, PathEvidence>();
  const ephemeralEdges = slotRoleEdges(input, index);
  const ephemeralByFrom = new Map<string, CandidateGraphEdge[]>();
  for (const edge of ephemeralEdges) {
    const values = ephemeralByFrom.get(edge.from) ?? [];
    values.push(edge);
    ephemeralByFrom.set(edge.from, values);
  }
  const queue: Array<{ key: string; depth: number; priority: number; relations: CandidateGraphRelation[]; role?: string }> = [];
  for (const seed of seeds) {
    const seedRole = [...(roles.get(seed) ?? [])].sort()[0];
    paths.set(seed, { depth: 0, priority: 100, relations: [] });
    queue.push({ key: seed, depth: 0, priority: 100, relations: [], role: seedRole });
  }
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current.depth >= maxDepth) continue;
    const outgoing = [...(index.edges.get(current.key) ?? []), ...(ephemeralByFrom.get(current.key) ?? [])]
      .sort((left, right) => left.relation.localeCompare(right.relation) || left.to.localeCompare(right.to));
    for (const edge of outgoing) {
      const candidate = index.byKey.get(edge.to);
      if (!candidate || !visible(candidate, input.slotIndex) || !typed(candidate)) continue;
      if (!relationAllowed(edge.relation, current.role, candidate)) continue;
      const nextDepth = current.depth + 1;
      const nextPriority = Math.max(1, current.priority * 0.6 + RELATION_PRIORITY[edge.relation] * 0.4);
      const nextRelations = [...current.relations, edge.relation];
      const existing = paths.get(edge.to);
      if (existing && (existing.depth < nextDepth || existing.depth === nextDepth && existing.priority >= nextPriority)) continue;
      paths.set(edge.to, { depth: nextDepth, priority: nextPriority, relations: nextRelations });
      queue.push({ key: edge.to, depth: nextDepth, priority: nextPriority, relations: nextRelations, role: current.role });
    }
  }
  return paths;
}

function bm25(index: GraphIndex, candidate: Candidate, terms: readonly string[]): number {
  if (terms.length === 0) return 0;
  const fields = index.fields.get(candidate.candidateKey);
  if (!fields) return 0;
  const candidateTerms = tokens(`${fields.label} ${fields.meaning} ${fields.details} ${fields.metadata}`);
  const counts = new Map<string, number>();
  for (const token of candidateTerms) counts.set(token, (counts.get(token) ?? 0) + 1);
  let score = 0;
  for (const term of terms) {
    const frequency = counts.get(term) ?? 0;
    if (frequency === 0) continue;
    const df = index.documentFrequency.get(term) ?? 0;
    const idf = Math.log(1 + (index.candidates.length - df + 0.5) / (df + 0.5));
    score += idf * (frequency / (frequency + 0.5 + 0.5 * candidateTerms.length / index.averageFieldLength));
  }
  return score;
}

function normalizeScores(values: ReadonlyMap<string, number>): Map<string, number> {
  const entries = [...values.entries()];
  const max = Math.max(...entries.map(([, value]) => value), 0);
  const min = Math.min(...entries.map(([, value]) => value), 0);
  const span = max - min;
  return new Map(entries.map(([key, value]) => [key, span === 0 ? 0 : (value - min) / span]));
}

function dot(left: readonly number[], right: readonly number[]): number {
  const length = Math.min(left.length, right.length);
  let result = 0;
  for (let index = 0; index < length; index += 1) result += left[index]! * right[index]!;
  return result;
}

function candidateText(index: GraphIndex, candidate: Candidate): string {
  const fields = index.fields.get(candidate.candidateKey);
  return [fields?.label, fields?.meaning, fields?.details, fields?.metadata].filter(Boolean).join(" ");
}

export function actionCompilationPassageEntriesForContext(
  context: Readonly<Record<string, unknown>>,
): readonly { candidateKey: string; passage: string }[] {
  const index = buildCatalogIndex(context);
  return index.candidates
    .filter((candidate) => typed(candidate) && candidate.kind !== "action")
    .sort((left, right) => left.candidateKey.localeCompare(right.candidateKey))
    .map((candidate) => ({
      candidateKey: candidate.candidateKey,
      passage: `passage: ${candidateText(index, candidate)}`,
    }));
}

function featureVector(features: CandidateFeatures): number[] {
  return [
    features.anchor,
    features.role,
    features.pathDepth,
    features.relationPriority,
    features.lexical,
    features.encoder,
    features.reverseReference,
    features.stateOwner,
    features.graphDegree,
    features.kindCoverage,
    features.useCoverage,
  ];
}

function scoreFeatures(features: CandidateFeatures, strategy: GraphAwareStrategy, ranker?: GraphRankerModel): number {
  if (strategy === "graph-learned" && ranker) {
    const values = featureVector(features);
    let score = ranker.bias;
    for (let index = 0; index < Math.min(values.length, ranker.weights.length); index += 1) score += values[index]! * ranker.weights[index]!;
    return score;
  }
  const graph = features.anchor * 1000 + features.role * 300 + features.relationPriority * 2 + (features.pathDepth === 0 ? 100 : 50 / features.pathDepth);
  const lexical = features.lexical * 120;
  const encoder = features.encoder * (strategy === "graph-encoder" || strategy === "graph-hybrid" ? 140 : 30);
  const coverage = features.kindCoverage * 18 + features.useCoverage * 8;
  return graph + lexical + encoder + coverage + features.reverseReference * 20 + features.stateOwner * 35 - features.graphDegree * 0.01;
}

function selectBudgeted(
  candidates: readonly Candidate[],
  mandatory: ReadonlySet<string>,
  scores: ReadonlyMap<string, number>,
  budget: number,
): string[] {
  if (budget <= 0) return [];
  const selected = new Set([...mandatory].filter((key) => candidates.some((candidate) => candidate.candidateKey === key)));
  const coveredKinds = new Set<string>();
  const coveredUses = new Set<string>();
  for (const candidate of candidates) {
    if (!selected.has(candidate.candidateKey)) continue;
    coveredKinds.add(candidate.kind);
    candidate.allowedUses.forEach((use) => coveredUses.add(use));
  }
  while (selected.size < budget) {
    let best: Candidate | undefined;
    let bestValue = Number.NEGATIVE_INFINITY;
    for (const candidate of candidates) {
      if (selected.has(candidate.candidateKey)) continue;
      const kindGain = coveredKinds.has(candidate.kind) ? 0 : 1;
      const useGain = candidate.allowedUses.some((use) => !coveredUses.has(use)) ? 1 : 0;
      const value = (scores.get(candidate.candidateKey) ?? 0) + kindGain * 25 + useGain * 10;
      if (value > bestValue || (value === bestValue && candidate.candidateKey.localeCompare(best?.candidateKey ?? "") < 0)) {
        best = candidate;
        bestValue = value;
      }
    }
    if (!best) break;
    selected.add(best.candidateKey);
    coveredKinds.add(best.kind);
    best.allowedUses.forEach((use) => coveredUses.add(use));
  }
  return [...selected].sort((left, right) => left.localeCompare(right));
}

interface PreparedEncoderData {
  candidateVectors: ReadonlyMap<string, ReadonlyMap<string, readonly number[]>>;
  queryVectors: ReadonlyMap<string, readonly number[]>;
}

let encoderDataCache = new WeakMap<object, Map<string, Promise<PreparedEncoderData>>>();

async function prepareEncoderDataUncached(
  dataset: ActionCompilationReferenceDataset,
  encoder: LocalEncoderRuntime,
  passageEncoder?: PassageEmbeddingEncoder,
  allowPassageCacheWrite = true,
): Promise<PreparedEncoderData> {
  const indexes = new Map<string, GraphIndex>();
  const contextsByCatalogHash = new Map<string, Readonly<Record<string, unknown>>>();
  for (const context of dataset.contexts.values()) {
    const index = buildCatalogIndex(context.context);
    indexes.set(index.hash, index);
    contextsByCatalogHash.set(index.hash, context.context);
  }
  // Candidate descriptions repeat heavily between neighboring snapshots. We
  // encode each distinct passage once, then materialize the per-catalog map.
  // The catalog-hash map remains the authoritative cache boundary for lookup,
  // while text-level de-duplication keeps local CPU evaluation tractable.
  const passageByText = new Map<string, string>();
  const candidateTexts = new Map<string, Map<string, string>>();
  for (const [hash] of [...indexes.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    const texts = new Map<string, string>();
    const context = contextsByCatalogHash.get(hash);
    if (!context) throw new Error(`catalog ${hash} context disappeared during encoder preparation`);
    for (const entry of actionCompilationPassageEntriesForContext(context)) {
      texts.set(entry.candidateKey, entry.passage);
      passageByText.set(entry.passage, entry.passage);
    }
    candidateTexts.set(hash, texts);
  }
  const uniquePassages = [...passageByText.keys()].sort((left, right) => left.localeCompare(right));
  let passageVectors: readonly (readonly number[])[];
  if (passageEncoder) {
    if (passageEncoder.encoder.modelHash !== encoder.modelHash) throw new Error("passage cache encoder does not match the graph encoder");
    const worldHashes = [...new Set(dataset.cases.map((item) => item.source.worldHash))].sort();
    if (worldHashes.length !== 1) throw new Error("one graph encoder preparation may contain only one world content hash");
    passageVectors = (await passageEncoder.encodePassages({
      worldContentHash: worldHashes[0]!,
      passages: uniquePassages,
      allowWrite: allowPassageCacheWrite,
    })).vectors;
  } else {
    passageVectors = await encoder.encodeBatch(uniquePassages);
  }
  const vectorsByText = new Map(uniquePassages.map((text, index) => [text, passageVectors[index] ?? []]));
  const candidateVectors = new Map<string, ReadonlyMap<string, readonly number[]>>();
  for (const [hash, texts] of candidateTexts) {
    candidateVectors.set(hash, new Map([...texts.entries()].map(([candidateKey, text]) => [candidateKey, vectorsByText.get(text) ?? []])));
  }
  const queryVectors = new Map<string, readonly number[]>();
  const queries = new Set<string>();
  for (const item of dataset.cases) {
    const context = dataset.contexts.get(item.contextHash);
    if (!context) throw new Error(`case ${item.caseId} context disappeared during encoder preparation`);
    queries.add(queryText({ context: context.context, slotIndex: item.slotIndex }));
  }
  const uniqueQueries = [...queries].sort((left, right) => left.localeCompare(right));
  const queryOutputs = await encoder.encodeBatch(uniqueQueries.map((query) => `query: ${query}`));
  uniqueQueries.forEach((query, index) => {
    queryVectors.set(query, queryOutputs[index] ?? []);
  });
  return { candidateVectors, queryVectors };
}

async function prepareEncoderData(
  dataset: ActionCompilationReferenceDataset,
  encoder: LocalEncoderRuntime,
  passageEncoder?: PassageEmbeddingEncoder,
  allowPassageCacheWrite = true,
): Promise<PreparedEncoderData> {
  const byModel = encoderDataCache.get(dataset) ?? new Map<string, Promise<PreparedEncoderData>>();
  encoderDataCache.set(dataset, byModel);
  const cacheIdentity = passageEncoder
    ? `${encoder.modelHash}:${passageEncoder.encoderFingerprint}:${allowPassageCacheWrite ? "warm" : "readonly"}`
    : encoder.modelHash;
  const existing = byModel.get(cacheIdentity);
  if (existing) return existing;
  const pending = prepareEncoderDataUncached(dataset, encoder, passageEncoder, allowPassageCacheWrite);
  byModel.set(cacheIdentity, pending);
  try {
    return await pending;
  } catch (error) {
    byModel.delete(cacheIdentity);
    throw error;
  }
}

function scoreCandidates(
  strategy: GraphAwareStrategy,
  input: CandidateRetrieverInput,
  index: GraphIndex,
  encoderData: PreparedEncoderData | undefined,
  options: Required<Pick<GraphAwareRetrieverOptions, "maxPathDepth">> & Pick<GraphAwareRetrieverOptions, "ranker">,
): { candidates: readonly Candidate[]; anchors: ReadonlySet<string>; scores: ReadonlyMap<string, number> } {
  const candidates = index.candidates.filter((candidate) => visible(candidate, input.slotIndex) && typed(candidate));
  const { keys: anchors, roles } = anchorKeys(input, index);
  const pathEvidence = graphPaths(index, input, anchors, roles, strategy === "graph-one-hop" ? 1 : options.maxPathDepth);
  const aliasTerms = aliases(input, index, anchors);
  const queryTerms = [...new Set(tokens(`${queryText(input)} ${aliasTerms.join(" ")}`))];
  const lexicalScores = normalizeScores(new Map(candidates.map((candidate) => [candidate.candidateKey, bm25(index, candidate, queryTerms)])));
  const query = queryText(input);
  const vectors = encoderData?.candidateVectors.get(index.hash);
  const queryVector = encoderData?.queryVectors.get(query);
  const encoderScores = normalizeScores(new Map(candidates.map((candidate) => [
    candidate.candidateKey,
    vectors && queryVector ? dot(vectors.get(candidate.candidateKey) ?? [], queryVector) : 0,
  ])));
  const selectedKinds = new Set([...anchors].map((key) => index.byKey.get(key)?.kind).filter((kind): kind is string => Boolean(kind)));
  const selectedUses = new Set([...anchors].flatMap((key) => index.byKey.get(key)?.allowedUses ?? []));
  const scores = new Map<string, number>();
  for (const candidate of candidates) {
    const evidence = pathEvidence.get(candidate.candidateKey);
    const relationPriority = evidence ? evidence.priority : 0;
    const role = candidate.allowedUses.some((use) => selectedUses.has(use)) ? 1 : 0;
    const reverseReference = (index.reverseEdges.get(candidate.candidateKey) ?? []).length > 0 ? 1 : 0;
    const details = record(candidate.details);
    const stateOwner = details && ["entityRef", "holderRef", "subjectRef", "placementRef", "containerRef"].some((field) => typeof details[field] === "string") ? 1 : 0;
    const graphDegree = (index.edges.get(candidate.candidateKey) ?? []).length + (index.reverseEdges.get(candidate.candidateKey) ?? []).length;
    const features: CandidateFeatures = {
      anchor: anchors.has(candidate.candidateKey) ? 1 : 0,
      role,
      pathDepth: evidence?.depth ?? options.maxPathDepth + 1,
      relationPriority,
      lexical: lexicalScores.get(candidate.candidateKey) ?? 0,
      encoder: encoderScores.get(candidate.candidateKey) ?? 0,
      reverseReference,
      stateOwner,
      graphDegree,
      kindCoverage: selectedKinds.has(candidate.kind) ? 0 : 1,
      useCoverage: role === 1 ? 0 : 1,
    };
    scores.set(candidate.candidateKey, scoreFeatures(features, strategy, options.ranker));
  }
  return { candidates, anchors, scores };
}

function retrieve(
  strategy: GraphAwareStrategy,
  input: CandidateRetrieverInput,
  index: GraphIndex,
  encoderData: PreparedEncoderData | undefined,
  options: Required<Pick<GraphAwareRetrieverOptions, "budgetRatio" | "maxPathDepth">> & Pick<GraphAwareRetrieverOptions, "ranker">,
): string[] {
  const visibleCount = index.candidates.filter((candidate) => visible(candidate, input.slotIndex)).length;
  const requestedBudget = Math.floor(visibleCount * options.budgetRatio);
  // The experiment gate is strict (< 0.20), so an exactly divisible catalog
  // must leave one slot unused. This is still within the floor(20%) budget and
  // avoids an otherwise unavoidable p95 boundary failure.
  const budget = Math.min(requestedBudget, Math.max(0, Math.ceil(visibleCount * options.budgetRatio) - 1));
  const scored = scoreCandidates(strategy, input, index, encoderData, options);
  return selectBudgeted(scored.candidates, scored.anchors, scored.scores, budget);
}

export interface RuntimeGraphSlotRetrieverOptions {
  strategy: GraphAwareStrategy;
  encoder: LocalEncoderRuntime;
  passageEncoder: PassageEmbeddingEncoder;
  queryEncoder?: CachedQueryEncoder;
  maxPathDepth?: number;
  ranker?: GraphRankerModel;
}

/** Build the production slot scorer. Candidate passages must already be in
 * the persistent cache; only the current dynamic slot query may be encoded. */
export function createRuntimeGraphSlotRetriever(
  options: RuntimeGraphSlotRetrieverOptions,
): ActionCompilationRetrievalRuntimeOptions["retrieveSlot"] {
  if (options.passageEncoder.encoder.modelHash !== options.encoder.modelHash) {
    throw new Error("passage cache encoder does not match the graph encoder");
  }
  const maxPathDepth = options.maxPathDepth ?? 3;
  if (!Number.isSafeInteger(maxPathDepth) || maxPathDepth < 1 || maxPathDepth > 4) {
    throw new Error("maxPathDepth must be an integer from 1 to 4");
  }
  const queryEncoder = options.queryEncoder ?? new CachedQueryEncoder(options.encoder);
  return async ({ worldContentHash, context, slotIndex, signal }): Promise<SlotRetrievalResult> => {
    if (signal?.aborted) throw signal.reason ?? new Error("candidate retrieval aborted");
    const index = buildCatalogIndex(context);
    const entries = actionCompilationPassageEntriesForContext(context);
    const readStartedAt = performance.now();
    const cached = await options.passageEncoder.encodePassages({
      worldContentHash,
      passages: entries.map((entry) => entry.passage),
      allowWrite: false,
    });
    const readMs = Math.max(0, performance.now() - readStartedAt);
    const vectors = new Map(entries.map((entry, position) => [entry.candidateKey, cached.vectors[position] ?? []]));
    const query = queryText({ context, slotIndex });
    const queryStartedAt = performance.now();
    const encodedQuery = await queryEncoder.encode(query);
    const queryEncodeMs = Math.max(0, performance.now() - queryStartedAt);
    const encoderData: PreparedEncoderData = {
      candidateVectors: new Map([[index.hash, vectors]]),
      queryVectors: new Map([[query, encodedQuery.vector]]),
    };
    const scored = scoreCandidates(options.strategy, { context, slotIndex }, index, encoderData, {
      maxPathDepth,
      ranker: options.ranker,
    });
    return {
      candidates: scored.candidates.map((candidate) => ({
        candidateKey: candidate.candidateKey,
        score: scored.scores.get(candidate.candidateKey) ?? 0,
      })).sort((left, right) => right.score - left.score || left.candidateKey.localeCompare(right.candidateKey)),
      cache: {
        passageHits: cached.hits,
        passageMisses: cached.misses,
        queryHit: encodedQuery.cacheHit,
        readMs,
        queryEncodeMs,
      },
    };
  };
}

/** Return deterministic graph/lexical feature rows for a slot. Encoder scores
 * can be overlaid by the caller's ranker; this helper intentionally performs
 * no model or network work and is suitable for exploratory training. */
export function extractGraphCandidateFeatureRows(
  input: CandidateRetrieverInput,
  options: { maxPathDepth?: number } = {},
): GraphCandidateFeatureRow[] {
  const index = buildCatalogIndex(input.context);
  const candidates = index.candidates.filter((candidate) => visible(candidate, input.slotIndex) && typed(candidate));
  const depth = Math.max(1, Math.min(4, options.maxPathDepth ?? 3));
  const { keys: anchors, roles } = anchorKeys(input, index);
  const pathEvidence = graphPaths(index, input, anchors, roles, depth);
  const queryTerms = tokens(queryText(input));
  const lexicalScores = normalizeScores(new Map(candidates.map((candidate) => [candidate.candidateKey, bm25(index, candidate, queryTerms)])));
  const selectedKinds = new Set([...anchors].map((key) => index.byKey.get(key)?.kind).filter((kind): kind is string => Boolean(kind)));
  const selectedUses = new Set([...anchors].flatMap((key) => index.byKey.get(key)?.allowedUses ?? []));
  return candidates.map((candidate) => {
    const evidence = pathEvidence.get(candidate.candidateKey);
    const role = candidate.allowedUses.some((use) => selectedUses.has(use)) ? 1 : 0;
    const details = record(candidate.details);
    const features: CandidateFeatures = {
      anchor: anchors.has(candidate.candidateKey) ? 1 : 0,
      role,
      pathDepth: evidence?.depth ?? depth + 1,
      relationPriority: evidence?.priority ?? 0,
      lexical: lexicalScores.get(candidate.candidateKey) ?? 0,
      encoder: 0,
      reverseReference: (index.reverseEdges.get(candidate.candidateKey) ?? []).length > 0 ? 1 : 0,
      stateOwner: details && ["entityRef", "holderRef", "subjectRef", "placementRef", "containerRef"].some((field) => typeof details[field] === "string") ? 1 : 0,
      graphDegree: (index.edges.get(candidate.candidateKey) ?? []).length + (index.reverseEdges.get(candidate.candidateKey) ?? []).length,
      kindCoverage: selectedKinds.has(candidate.kind) ? 0 : 1,
      useCoverage: role === 1 ? 0 : 1,
    };
    return {
      candidateKey: candidate.candidateKey,
      features,
      kind: candidate.kind,
      allowedUses: candidate.allowedUses,
      relationPath: evidence?.relations ?? [],
    };
  }).sort((left, right) => left.candidateKey.localeCompare(right.candidateKey));
}

/** Explain why a reference was not part of a graph retriever shortlist.
 * This is deliberately diagnostic-only: it never changes selection behavior.
 */
export function diagnoseGraphMissingKeys(
  input: CandidateRetrieverInput,
  requiredKeys: readonly string[],
  maxPathDepth = 2,
): GraphMissingPathDiagnostic[] {
  const index = buildCatalogIndex(input.context);
  const { keys: anchors, roles } = anchorKeys(input, index);
  const paths = graphPaths(index, input, anchors, roles, Math.max(1, Math.min(4, maxPathDepth)));
  const termsForQuery = tokens(queryText(input));
  return [...new Set(requiredKeys)].sort().map((candidateKey) => {
    const candidate = index.byKey.get(candidateKey);
    if (!candidate) return { candidateKey, shortestPathDepth: null, relationPath: [], stage: "unseen", exclusionReason: "unknown" };
    if (!visible(candidate, input.slotIndex)) return { candidateKey, shortestPathDepth: null, relationPath: [], stage: "unseen", exclusionReason: "not-visible" };
    if (!typed(candidate)) return { candidateKey, shortestPathDepth: null, relationPath: [], stage: "unseen", exclusionReason: "not-typed" };
    if (anchors.has(candidateKey)) return { candidateKey, shortestPathDepth: 0, relationPath: [], stage: "anchor", exclusionReason: "not-seeded" };
    const evidence = paths.get(candidateKey);
    if (evidence) return { candidateKey, shortestPathDepth: evidence.depth, relationPath: evidence.relations, stage: "graph", exclusionReason: "not-reachable" };
    const text = index.fields.get(candidateKey);
    const candidateTerms = text ? tokens(`${text.label} ${text.meaning} ${text.details} ${text.metadata}`) : [];
    const lexicalHit = termsForQuery.some((term) => candidateTerms.includes(term));
    return { candidateKey, shortestPathDepth: null, relationPath: [], stage: lexicalHit ? "lexical" : "unseen", exclusionReason: "not-seeded" };
  });
}

function strategyNeedsEncoder(strategy: GraphAwareStrategy): boolean {
  return strategy === "graph-encoder" || strategy === "graph-hybrid" || strategy === "graph-learned";
}

export async function createGraphAwareActionCompilationRetriever(
  strategy: GraphAwareStrategy,
  dataset: ActionCompilationReferenceDataset,
  options: GraphAwareRetrieverOptions = {},
): Promise<CandidateRetriever> {
  if (strategyNeedsEncoder(strategy) && !options.encoder) throw new Error(`${strategy} requires a local encoder runtime`);
  const budgetRatio = options.budgetRatio ?? 0.2;
  const maximumBudgetRatio = options.allowDiagnosticBudget === true ? 0.3 : 0.2;
  if (!Number.isFinite(budgetRatio) || budgetRatio <= 0 || budgetRatio > maximumBudgetRatio) throw new Error(`budgetRatio must be in (0, ${maximumBudgetRatio}]`);
  const maxPathDepth = options.maxPathDepth ?? 2;
  if (!Number.isSafeInteger(maxPathDepth) || maxPathDepth < 1 || maxPathDepth > 4) throw new Error("maxPathDepth must be an integer from 1 to 4");
  if (options.ranker) {
    if (options.ranker.schemaVersion !== GRAPH_FEATURE_SCHEMA_VERSION ||
      JSON.stringify(options.ranker.featureNames) !== JSON.stringify(GRAPH_FEATURE_NAMES) ||
      options.ranker.weights.length !== GRAPH_FEATURE_NAMES.length ||
      options.ranker.weights.some((weight) => !Number.isFinite(weight)) || !Number.isFinite(options.ranker.bias)) {
      throw new Error("graph ranker feature schema is incompatible");
    }
  }
  const encoderData = options.encoder ? await prepareEncoderData(
    dataset,
    options.encoder,
    options.passageEncoder,
    options.allowPassageCacheWrite ?? true,
  ) : undefined;
  return (input) => retrieve(strategy, input, buildCatalogIndex(input.context), encoderData, {
    budgetRatio,
    maxPathDepth,
    ranker: options.ranker,
  });
}

export function clearGraphAwareRetrieverCaches(): void {
  catalogCache.clear();
  encoderDataCache = new WeakMap<object, Map<string, Promise<PreparedEncoderData>>>();
}

export function graphFeatureVector(features: CandidateFeatures): readonly number[] {
  return featureVector(features);
}
