import { contentHash } from "../../models/model-audit";

export const ACTION_COMPILATION_CONTEXT_VARIANTS = ["C0", "C1", "C2", "C3", "C4", "C5"] as const;
export type ActionCompilationContextVariant = typeof ACTION_COMPILATION_CONTEXT_VARIANTS[number];

interface CandidateRecord {
  handle: string;
  kind: string;
  label: string;
  meaning?: string;
  allowedUses?: readonly string[];
  visibility?: string;
  slot?: number;
  scope?: { kind: "shared" } | { kind: "slot"; slot: number };
  details?: unknown;
  [key: string]: unknown;
}

type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : null;
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function candidate(value: unknown): CandidateRecord | null {
  const input = record(value);
  return input && typeof input.handle === "string" && typeof input.kind === "string" && typeof input.label === "string"
    ? input as CandidateRecord
    : null;
}

function withoutKeys(value: JsonRecord, keys: readonly string[]): JsonRecord {
  return Object.fromEntries(Object.entries(value).filter(([key]) => !keys.includes(key)));
}

function candidateScope(value: CandidateRecord, enclosingSlot?: number): CandidateRecord["scope"] {
  const slot = typeof value.slot === "number"
    ? value.slot
    : value.visibility === "slot"
      ? enclosingSlot
      : undefined;
  return slot === undefined ? { kind: "shared" } : { kind: "slot", slot };
}

function normalizedCandidate(value: CandidateRecord, enclosingSlot?: number): CandidateRecord {
  return {
    handle: value.handle,
    kind: value.kind,
    label: value.label,
    meaning: typeof value.meaning === "string" ? value.meaning : "",
    allowedUses: Array.isArray(value.allowedUses) ? [...value.allowedUses].sort() : [],
    scope: candidateScope(value, enclosingSlot),
    details: value.details ?? null,
  };
}

export function actionCompilationCandidateNamespace(context: unknown): string[] {
  const root = record(context);
  if (!root) return [];
  const candidates = [
    ...array(record(root.referenceCatalog)?.candidates),
    ...array(root.referenceCatalogs).flatMap((entry) =>
      array(record(record(entry)?.catalog)?.candidates)),
  ].map(candidate).filter((entry): entry is CandidateRecord => entry !== null);
  return [...new Set(candidates.map((entry) => entry.handle))].sort();
}

function mergedCandidates(context: JsonRecord): CandidateRecord[] {
  const byHandle = new Map<string, CandidateRecord>();
  const add = (value: unknown, enclosingSlot?: number): void => {
    const input = candidate(value);
    if (!input) return;
    const normalized = normalizedCandidate(input, enclosingSlot);
    const existing = byHandle.get(normalized.handle);
    if (!existing) {
      byHandle.set(normalized.handle, normalized);
      return;
    }
    if (JSON.stringify(existing) !== JSON.stringify(normalized) &&
      existing.scope?.kind === "slot" && normalized.scope?.kind === "slot" &&
      existing.scope.slot !== normalized.scope.slot) {
      throw new Error(`candidate ${normalized.handle} is private to more than one slot`);
    }
    if (existing.details == null && normalized.details != null) existing.details = normalized.details;
  };
  array(record(context.referenceCatalog)?.candidates).forEach((value) => add(value));
  array(context.referenceCatalogs).forEach((entry) => {
    const item = record(entry);
    const slot = typeof item?.slot === "number" ? item.slot : undefined;
    array(record(item?.catalog)?.candidates).forEach((value) => add(value, slot));
  });
  return [...byHandle.values()].sort((left, right) => left.handle.localeCompare(right.handle));
}

function registerDetails(details: Map<string, unknown>, value: unknown): void {
  const item = record(value);
  if (!item) return;
  const reference = typeof item.ref === "string"
    ? item.ref
    : typeof item.entityRef === "string"
      ? item.entityRef
      : typeof item.profileRef === "string"
        ? item.profileRef
        : typeof item.activityRef === "string"
          ? item.activityRef
          : null;
  if (!reference) return;
  const referenceKey = typeof item.ref === "string"
    ? "ref"
    : typeof item.entityRef === "string"
      ? "entityRef"
      : typeof item.profileRef === "string"
        ? "profileRef"
        : "activityRef";
  details.set(reference, withoutKeys(item, [referenceKey]));
}

function completeDetails(context: JsonRecord, candidates: readonly CandidateRecord[]): Map<string, unknown> {
  const details = new Map<string, unknown>();
  for (const item of candidates) if (item.details != null) details.set(item.handle, structuredClone(item.details));
  const state = record(context.state);
  const canonicalTruth = record(state?.canonicalTruth);
  if (canonicalTruth) Object.values(canonicalTruth).flatMap(array).forEach((value) => registerDetails(details, value));
  array(state?.actors).forEach((value) => registerDetails(details, value));
  array(state?.temporalProfiles).forEach((value) => registerDetails(details, value));
  array(state?.slots).forEach((slotValue) => {
    const slot = record(slotValue);
    array(slot?.existingActivities).forEach((value) => registerDetails(details, value));
  });
  const elapsedSeconds = state?.currentElapsedSeconds;
  const world = candidates.find((entry) => entry.kind === "world");
  if (world && typeof elapsedSeconds === "number") details.set(world.handle, { currentElapsedSeconds: elapsedSeconds });
  return details;
}

function catalog(candidates: readonly CandidateRecord[]): JsonRecord {
  const stable = candidates.map((entry) => structuredClone(entry));
  return { version: 2, hash: contentHash(stable), candidates: stable };
}

function removeAvailableHandles(taskValue: unknown): unknown {
  if (Array.isArray(taskValue)) return taskValue.map(removeAvailableHandles);
  const task = record(taskValue);
  if (!task) return taskValue;
  return Object.fromEntries(Object.entries(task)
    .filter(([key]) => key !== "availableHandles")
    .map(([key, value]) => [key, removeAvailableHandles(value)]));
}

function compactRepairReason(value: string): string {
  const allowedIndex = value.indexOf(" allowed=");
  const compact = allowedIndex >= 0 ? value.slice(0, allowedIndex) : value;
  return compact.length <= 1_024 ? compact : `${compact.slice(0, 1_021)}...`;
}

function compactRepairDiagnostics(value: unknown, key = ""): unknown {
  if (typeof value === "string") {
    return key === "reason" || key === "constraints" ? compactRepairReason(value) : value;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => typeof entry === "string" ? compactRepairReason(entry) : compactRepairDiagnostics(entry, key));
  }
  const item = record(value);
  if (!item) return value;
  return Object.fromEntries(Object.entries(item).map(([childKey, childValue]) =>
    [childKey, compactRepairDiagnostics(childValue, childKey)]));
}

function normalizedContext(context: JsonRecord, candidates: readonly CandidateRecord[], keepDuplicateState: boolean): JsonRecord {
  const output = withoutKeys(structuredClone(context), ["referenceCatalogs"]);
  output.referenceCatalog = catalog(candidates);
  output.task = removeAvailableHandles(output.task);
  if (keepDuplicateState) return output;
  const state = record(output.state) ?? {};
  const detailedProfileHandles = new Set(candidates
    .filter((entry) => entry.kind === "temporal_profile" && entry.details != null)
    .map((entry) => entry.handle));
  const calibrations = array(state.temporalCalibrations).filter((value) => {
    const profileRef = record(value)?.profileRef;
    return typeof profileRef !== "string" || detailedProfileHandles.has(profileRef);
  });
  const task = record(compactRepairDiagnostics(output.task, "task")) ?? {};
  const taskSlots = array(task.slots).map((value) => record(value) ?? {});
  output.task = {
    slots: array(state.slots).map((value, index) => {
      const slotState = record(value) ?? {};
      const slotTask = taskSlots[index] ?? {};
      const repair = record(slotTask.repair);
      const repairIssues = array(repair?.issues);
      return {
        ...slotState,
        issue: repairIssues[0] ?? (array(slotTask.constraints)[0] ?? null),
        previousAttempt: repair === null
          ? null
          : structuredClone(repair.previousOutput ?? null),
      };
    }),
  };
  delete output.state;
  delete output.repair;
  output.temporalCalibrations = calibrations;
  return output;
}

function normalizeText(value: string): string {
  return value.normalize("NFC").toLocaleLowerCase("en").replace(/\s+/gu, " ").trim();
}

function referencedStrings(value: unknown, results = new Set<string>()): Set<string> {
  if (typeof value === "string") {
    if (value.startsWith("ref:")) results.add(value);
    return results;
  }
  if (Array.isArray(value)) {
    value.forEach((entry) => referencedStrings(entry, results));
    return results;
  }
  const item = record(value);
  if (item) Object.values(item).forEach((entry) => referencedStrings(entry, results));
  return results;
}

function actionText(context: JsonRecord): string {
  const state = record(context.state);
  return array(state?.slots).flatMap((slotValue) => {
    const action = record(record(slotValue)?.action);
    return [action?.rawText, action?.goal, action?.means].filter((value): value is string => typeof value === "string");
  }).join("\n");
}

function containsExactAlias(text: string, label: string): boolean {
  const normalizedLabel = normalizeText(label);
  return normalizedLabel.length >= 2 && normalizeText(text).includes(normalizedLabel);
}

const benchmarkNumericSource = "(?:[0-9]+(?:\\.[0-9]+)?|[零一二两三四五六七八九十半]{1,3})";

function hasExplicitQuantity(text: string, aliases: readonly string[]): boolean {
  const alternatives = aliases
    .filter((alias) => alias.trim())
    .sort((left, right) => right.length - left.length)
    .map((alias) => alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|");
  return alternatives.length > 0 && new RegExp(`${benchmarkNumericSource}\\s*(?:${alternatives})`, "iu").test(text);
}

function eligibleTemporalProfileHandles(context: JsonRecord): Set<string> {
  const text = actionText(context);
  const durationAliases = ["seconds", "second", "secs", "sec", "秒", "minutes", "minute", "mins", "min", "分钟", "分", "hours", "hour", "hrs", "hr", "小时", "时", "days", "day", "天", "日", "weeks", "week", "星期", "周"];
  const result = new Set<string>();
  for (const value of array(record(context.state)?.temporalProfiles)) {
    const profile = record(value);
    if (!profile || typeof profile.profileRef !== "string") continue;
    const profileRef = profile.profileRef;
    const selection = record(profile.selection);
    const requirement = selection?.evidenceRequirement;
    if (requirement === "explicit_duration" || profile.allowExplicitDuration === true) {
      if (hasExplicitQuantity(text, durationAliases)) result.add(profileRef);
      continue;
    }
    if (requirement === "explicit_profile_quantity" || profile.kind === "rate") {
      const aliases = [profile.unit, ...array(profile.unitAliases)].filter((alias): alias is string => typeof alias === "string");
      if (hasExplicitQuantity(text, aliases)) result.add(profileRef);
      continue;
    }
    result.add(profileRef);
  }
  return result;
}

function directReferences(value: unknown): string[] {
  return [...referencedStrings(value)];
}

export function deterministicDetailHandles(
  context: JsonRecord,
  candidates: readonly CandidateRecord[],
  details: ReadonlyMap<string, unknown>,
): string[] {
  const selected = referencedStrings(record(context.state)?.slots);
  const text = actionText(context);
  const eligibleProfiles = eligibleTemporalProfileHandles(context);
  for (const entry of candidates) {
    if ((entry.kind === "temporal_profile" && eligibleProfiles.has(entry.handle)) ||
      entry.kind === "world" || containsExactAlias(text, entry.label)) {
      selected.add(entry.handle);
    }
  }

  const addReferences = (handle: string): void => {
    const value = details.get(handle);
    directReferences(value).forEach((reference) => selected.add(reference));
  };
  [...selected].forEach(addReferences);

  const placementContainers = new Set<string>();
  for (const handle of selected) {
    const value = record(details.get(handle));
    if (typeof value?.containerRef === "string") placementContainers.add(value.containerRef);
    if (typeof value?.placementRef === "string") selected.add(value.placementRef);
    if (typeof value?.entityRef === "string") selected.add(value.entityRef);
  }
  for (const [handle, value] of details) {
    const item = record(value);
    if (typeof item?.containerRef === "string" && placementContainers.has(item.containerRef)) selected.add(handle);
  }

  for (const [handle, value] of details) {
    const references = directReferences(value);
    if (references.some((reference) => selected.has(reference))) selected.add(handle);
  }
  [...selected].forEach(addReferences);
  return [...selected].filter((handle) => details.has(handle)).sort();
}

function characterBigrams(value: string): Set<string> {
  const normalized = normalizeText(value).replace(/\s+/gu, "");
  const result = new Set<string>();
  for (let index = 0; index + 1 < normalized.length; index += 1) result.add(normalized.slice(index, index + 2));
  return result;
}

function overlap(left: ReadonlySet<string>, right: ReadonlySet<string>): number {
  if (left.size === 0 || right.size === 0) return 0;
  let shared = 0;
  for (const value of left) if (right.has(value)) shared += 1;
  return shared / Math.min(left.size, right.size);
}

function embeddingSupplementHandles(
  context: JsonRecord,
  candidates: readonly CandidateRecord[],
  details: ReadonlyMap<string, unknown>,
  selected: ReadonlySet<string>,
): string[] {
  const textBigrams = characterBigrams(actionText(context));
  return candidates
    .filter((entry) => details.has(entry.handle) && !selected.has(entry.handle))
    .map((entry) => ({ handle: entry.handle, score: overlap(textBigrams, characterBigrams(entry.label)) }))
    .filter((entry) => entry.score >= 0.6)
    .sort((left, right) => right.score - left.score || left.handle.localeCompare(right.handle))
    .slice(0, 8)
    .map((entry) => entry.handle);
}

export function projectActionCompilationContext(
  input: unknown,
  variant: ActionCompilationContextVariant,
  options: { expansionHandles?: readonly string[] } = {},
): JsonRecord {
  const context = record(input);
  if (!context) throw new Error("Action Compilation context must be an object");
  if (variant === "C0") return structuredClone(context);
  const merged = mergedCandidates(context);
  if (variant === "C1") return normalizedContext(context, merged, true);
  const details = completeDetails(context, merged);
  const complete = merged.map((entry) => ({ ...entry, details: structuredClone(details.get(entry.handle) ?? null) }));
  if (variant === "C2") return normalizedContext(context, complete, false);

  const selected = new Set(deterministicDetailHandles(context, complete, details));
  if (variant === "C4") {
    for (const handle of [...new Set(options.expansionHandles ?? [])].sort().slice(0, 8)) {
      if (!details.has(handle)) throw new Error(`bounded expansion requested an unknown handle: ${handle}`);
      selected.add(handle);
    }
  }
  if (variant === "C5") {
    embeddingSupplementHandles(context, complete, details, selected).forEach((handle) => selected.add(handle));
  }
  const sliced = complete.map((entry) => ({
    ...entry,
    details: selected.has(entry.handle) ? structuredClone(details.get(entry.handle) ?? null) : null,
  }));
  return normalizedContext(context, sliced, false);
}

export function actionCompilationProjectionMetrics(context: unknown): {
  bytes: number;
  candidates: number;
  detailedCandidates: number;
  slots: number;
} {
  const root = record(context) ?? {};
  const candidates = array(record(root.referenceCatalog)?.candidates).map(candidate)
    .filter((entry): entry is CandidateRecord => entry !== null);
  return {
    bytes: Buffer.byteLength(JSON.stringify(context), "utf8"),
    candidates: candidates.length,
    detailedCandidates: candidates.filter((entry) => entry.details != null).length,
    slots: Math.max(array(record(root.state)?.slots).length, array(record(root.task)?.slots).length),
  };
}

export function dynamicEnumExperiment(
  context: unknown,
  mode: "E0" | "E1",
): { mode: "E0" | "E1"; schemaBytes: number; enumFields: number } {
  if (mode === "E0") return { mode, schemaBytes: 0, enumFields: 0 };
  const root = record(context) ?? {};
  const candidates = array(record(root.referenceCatalog)?.candidates).map(candidate)
    .filter((entry): entry is CandidateRecord => entry !== null);
  const smallUses = ["profile", "audience"];
  const fields = smallUses.map((use) => candidates.filter((entry) => entry.allowedUses?.includes(use)).map((entry) => entry.handle))
    .filter((handles) => handles.length > 0 && handles.length <= 64);
  const pools = candidates.filter((entry) => entry.kind === "shared_resource_pool").map((entry) => entry.handle);
  if (pools.length > 0 && pools.length <= 64) fields.push(pools);
  const schema = fields.map((handles) => ({ type: "string", enum: [...handles].sort() }));
  return { mode, schemaBytes: Buffer.byteLength(JSON.stringify(schema), "utf8"), enumFields: schema.length };
}
