import type {
  ModelReferenceKind,
  ModelReferenceUse,
} from "./model-context";

/** The deterministic policy is versioned because its result affects replay. */
export const SYMBOL_REPAIR_POLICY_VERSION = "symbol-repair-v2" as const;

export type SymbolRepairDomain =
  | "candidate-key"
  | "reference-handle"
  | "enum"
  | "proposal-key"
  | "opaque-id";

export interface SymbolDomainDefinition {
  fuzzy: boolean;
  normalization: "none" | "nfc";
  protectedPrefix: "candidate-key" | "reference-handle" | "none";
}

/** Explicit field-domain policy. Callers must opt a field into one of these
 * domains; arbitrary strings never enter the closest-candidate path. */
export const SYMBOL_DOMAIN_REGISTRY: Readonly<Record<SymbolRepairDomain, SymbolDomainDefinition>> = Object.freeze({
  "candidate-key": { fuzzy: true, normalization: "none", protectedPrefix: "candidate-key" },
  "reference-handle": { fuzzy: true, normalization: "nfc", protectedPrefix: "reference-handle" },
  enum: { fuzzy: false, normalization: "nfc", protectedPrefix: "none" },
  "proposal-key": { fuzzy: false, normalization: "none", protectedPrefix: "none" },
  "opaque-id": { fuzzy: false, normalization: "none", protectedPrefix: "none" },
});

export type SymbolRepairStatus =
  | "exact"
  | "normalized"
  | "repaired"
  | "ambiguous"
  | "unmatched"
  | "postvalidation-rejected";

export interface SymbolRepairPolicy {
  version: typeof SYMBOL_REPAIR_POLICY_VERSION;
  maxDistance: 3;
  minDistanceMargin: 1;
  minPayloadLength: 8;
  allowAdjacentTransposition: true;
  maxAuditCandidates: 8;
}

export const DEFAULT_SYMBOL_REPAIR_POLICY: Readonly<SymbolRepairPolicy> = Object.freeze({
  version: SYMBOL_REPAIR_POLICY_VERSION,
  maxDistance: 3,
  minDistanceMargin: 1,
  minPayloadLength: 8,
  allowAdjacentTransposition: true,
  maxAuditCandidates: 8,
});

export interface SymbolRepairContext {
  domain: SymbolRepairDomain;
  path: Array<string | number>;
  use?: ModelReferenceUse;
  kind?: ModelReferenceKind;
  slot?: number;
  catalogHash: string;
}

export interface SymbolRepairCandidate {
  value: string;
  kind?: ModelReferenceKind;
  allowedUses?: readonly ModelReferenceUse[];
  slot?: number;
}

export interface SymbolRepairCandidateDistance {
  value: string;
  distance: number;
}

export interface SymbolRepairResult {
  status: SymbolRepairStatus;
  originalValue: string;
  normalizedValue: string;
  correctedValue: string | null;
  bestDistance: number | null;
  secondBestDistance: number | null;
  margin: number | null;
  candidates: SymbolRepairCandidateDistance[];
  method: "exact" | "nfc" | "bounded-damerau";
  policyVersion: typeof SYMBOL_REPAIR_POLICY_VERSION;
  reason?: string;
}

/**
 * Compute the optimal string alignment distance with adjacent transposition.
 * The implementation uses code points rather than UTF-16 code units so a
 * malformed non-ASCII handle cannot split a surrogate pair. The caller keeps
 * the candidate set bounded; a full matrix is therefore preferable to a
 * heuristic early exit that could miss a later alignment.
 */
export function boundedDamerauLevenshtein(
  left: string,
  right: string,
  limit: number,
): number {
  const a = Array.from(left);
  const b = Array.from(right);
  if (Math.abs(a.length - b.length) > limit) return limit + 1;

  const maxDistance = a.length + b.length;
  const matrix = Array.from({ length: a.length + 2 }, () =>
    new Array<number>(b.length + 2).fill(0));
  matrix[0]![0] = maxDistance;
  for (let index = 0; index <= a.length; index += 1) {
    matrix[index + 1]![0] = maxDistance;
    matrix[index + 1]![1] = index;
  }
  for (let index = 0; index <= b.length; index += 1) {
    matrix[0]![index + 1] = maxDistance;
    matrix[1]![index + 1] = index;
  }

  const lastSeen = new Map<string, number>();
  for (let i = 1; i <= a.length; i += 1) {
    // `lastMatchingColumn` is the last matching column *before* the current
    // cell. It is the `db` value from the unrestricted Damerau recurrence;
    // updating it before reading the transposition term makes insertion and
    // deletion distances asymmetric when a character repeats.
    let lastMatchingColumn = 0;
    for (let j = 1; j <= b.length; j += 1) {
      const lastMatchingRow = lastSeen.get(b[j - 1]!) ?? 0;
      const transpositionColumn = lastMatchingColumn;
      const substitutionCost = a[i - 1] === b[j - 1] ? 0 : 1;
      if (substitutionCost === 0) lastMatchingColumn = j;
      matrix[i + 1]![j + 1] = Math.min(
        matrix[i]![j]! + substitutionCost,
        matrix[i + 1]![j]! + 1,
        matrix[i]![j + 1]! + 1,
        matrix[lastMatchingRow]![transpositionColumn]! +
          (i - lastMatchingRow - 1) + 1 + (j - transpositionColumn - 1),
      );
    }
    lastSeen.set(a[i - 1]!, i);
  }
  return matrix[a.length + 1]![b.length + 1]! > limit
    ? limit + 1
    : matrix[a.length + 1]![b.length + 1]!;
}

function prefixFor(value: string, context: SymbolRepairContext): string | null {
  const definition = SYMBOL_DOMAIN_REGISTRY[context.domain];
  if (definition.protectedPrefix === "candidate-key") return value.startsWith("candidate_") ? "candidate_" : null;
  if (definition.protectedPrefix === "reference-handle") {
    if (context.kind) {
      const expected = `ref:${context.kind}:`;
      return value.startsWith(expected) ? expected : null;
    }
    if (!value.startsWith("ref:")) return null;
    const separator = value.indexOf(":", 4);
    return separator < 0 ? null : value.slice(0, separator + 1);
  }
  return "";
}

function normalizeValue(value: string, context: SymbolRepairContext): { value: string; method: "exact" | "nfc" } {
  // Protocol keys are ASCII and case-sensitive. NFC is only meaningful for
  // the human-readable handle/enum domains; NFKC and case folding could turn
  // two intentionally distinct protocol symbols into one value.
  if (SYMBOL_DOMAIN_REGISTRY[context.domain].normalization === "nfc") {
    const normalized = value.normalize("NFC");
    return { value: normalized, method: normalized === value ? "exact" : "nfc" };
  }
  return { value, method: "exact" };
}

function resultBase(
  originalValue: string,
  normalizedValue: string,
  method: "exact" | "nfc",
  reason?: string,
): SymbolRepairResult {
  return {
    status: "unmatched",
    originalValue,
    normalizedValue,
    correctedValue: null,
    bestDistance: null,
    secondBestDistance: null,
    margin: null,
    candidates: [],
    method,
    policyVersion: SYMBOL_REPAIR_POLICY_VERSION,
    ...(reason ? { reason } : {}),
  };
}

function candidateMatchesContext(candidate: SymbolRepairCandidate, context: SymbolRepairContext): boolean {
  return (context.kind === undefined || candidate.kind === context.kind) &&
    (context.use === undefined || candidate.allowedUses?.includes(context.use) === true) &&
    (context.slot === undefined || candidate.slot === undefined || candidate.slot === context.slot);
}

function compareCandidateValues(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/**
 * Repair one typed, request-local symbol. This function never resolves an
 * engine id and never mutates caller-owned state; the caller must still run
 * its normal schema and semantic validation after applying correctedValue.
 */
export function repairSymbol(input: {
  value: unknown;
  candidates: readonly SymbolRepairCandidate[];
  context: SymbolRepairContext;
  policy?: Readonly<SymbolRepairPolicy>;
}): SymbolRepairResult {
  const policy = input.policy ?? DEFAULT_SYMBOL_REPAIR_POLICY;
  const originalValue = typeof input.value === "string" ? input.value : String(input.value ?? "");
  if (typeof input.value !== "string") {
    return resultBase(originalValue, originalValue, "exact", "symbol must be a string");
  }
  const normalized = normalizeValue(input.value, input.context);
  const base = resultBase(originalValue, normalized.value, normalized.method);
  const exact = input.candidates.find((candidate) =>
    candidate.value === normalized.value && candidateMatchesContext(candidate, input.context));
  if (exact) {
    return {
      ...base,
      status: normalized.method === "nfc" ? "normalized" : "exact",
      correctedValue: exact.value,
      bestDistance: 0,
      secondBestDistance: null,
      margin: null,
      candidates: [{ value: exact.value, distance: 0 }],
    };
  }

  // proposalKey and opaque/canonical ids are deliberately exact-only. They
  // still pass through this common boundary so every symbol has one audit
  // shape, but they never get a closest-candidate rewrite.
  if (!SYMBOL_DOMAIN_REGISTRY[input.context.domain].fuzzy) {
    return { ...base, reason: "domain is exact-only" };
  }

  const prefix = prefixFor(normalized.value, input.context);
  if (prefix === null) return { ...base, reason: "protected symbol prefix is invalid" };
  const payload = normalized.value.slice(prefix.length);
  if (Array.from(payload).length < policy.minPayloadLength) {
    return { ...base, reason: "symbol payload is shorter than the repair minimum" };
  }

  const eligible = input.candidates
    .filter((candidate) => candidate.value.startsWith(prefix))
    .filter((candidate) => candidateMatchesContext(candidate, input.context))
    .map((candidate) => ({
      value: candidate.value,
      distance: boundedDamerauLevenshtein(payload, candidate.value.slice(prefix.length), policy.maxDistance),
    }))
    .sort((left, right) => left.distance - right.distance || compareCandidateValues(left.value, right.value));
  const shortlist = eligible.slice(0, policy.maxAuditCandidates);
  const best = eligible[0];
  const second = eligible[1];
  if (!best) return { ...base, candidates: shortlist, reason: "no eligible candidates" };
  const secondBestDistance = second?.distance ?? null;
  const margin = second ? second.distance - best.distance : null;
  const unique = !second || margin !== null && margin >= policy.minDistanceMargin;
  if (best.distance <= policy.maxDistance && unique) {
    return {
      ...base,
      status: "repaired",
      correctedValue: best.value,
      bestDistance: best.distance,
      secondBestDistance,
      margin,
      candidates: shortlist,
      method: "bounded-damerau",
    };
  }
  return {
    ...base,
    status: best.distance <= policy.maxDistance ? "ambiguous" : "unmatched",
    bestDistance: best.distance,
    secondBestDistance,
    margin,
    candidates: shortlist,
    method: "bounded-damerau",
    reason: best.distance <= policy.maxDistance
      ? "closest candidates do not satisfy the uniqueness margin"
      : "closest candidate exceeds the distance limit",
  };
}
