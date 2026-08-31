import { contentHash } from "../../models/model-audit";

type JsonRecord = Record<string, unknown>;

interface CandidateRecord extends JsonRecord {
  handle: string;
  kind: string;
  label: string;
  meaning?: string;
  allowedUses?: readonly string[];
  visibility?: string;
  slot?: number;
  scope?: { kind: "shared" } | { kind: "slot"; slot: number };
  details?: unknown;
}

export interface ActionCompilationProjectedContext extends JsonRecord {
  referenceCatalog: {
    version: number;
    hash: string;
    candidates: CandidateRecord[];
  };
  task: { slots: JsonRecord[] };
  temporalCalibrations: unknown[];
}

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
  return input && typeof input.handle === "string" && typeof input.kind === "string" &&
    typeof input.label === "string"
    ? input as CandidateRecord
    : null;
}

function withoutKeys(value: JsonRecord, keys: readonly string[]): JsonRecord {
  return Object.fromEntries(Object.entries(value).filter(([key]) => !keys.includes(key)));
}

function normalizedCandidate(value: CandidateRecord, enclosingSlot?: number): CandidateRecord {
  const slot = typeof value.slot === "number"
    ? value.slot
    : value.visibility === "slot"
      ? enclosingSlot
      : undefined;
  return {
    handle: value.handle,
    kind: value.kind,
    label: value.label,
    meaning: typeof value.meaning === "string" ? value.meaning : "",
    allowedUses: Array.isArray(value.allowedUses) ? [...value.allowedUses].sort() : [],
    scope: slot === undefined ? { kind: "shared" } : { kind: "slot", slot },
    details: value.details ?? null,
  };
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
  const world = candidates.find((entry) => entry.kind === "world");
  if (world && typeof state?.currentElapsedSeconds === "number") {
    details.set(world.handle, { currentElapsedSeconds: state.currentElapsedSeconds });
  }
  return details;
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
    return value.map((entry) => typeof entry === "string"
      ? compactRepairReason(entry)
      : compactRepairDiagnostics(entry, key));
  }
  const item = record(value);
  if (!item) return value;
  return Object.fromEntries(Object.entries(item).map(([childKey, childValue]) =>
    [childKey, compactRepairDiagnostics(childValue, childKey)]));
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
  return array(record(context.state)?.slots).flatMap((slotValue) => {
    const action = record(record(slotValue)?.action);
    return [action?.rawText, action?.goal, action?.means]
      .filter((value): value is string => typeof value === "string");
  }).join("\n");
}

const numericSource = "(?:[0-9]+(?:\\.[0-9]+)?|[零一二两三四五六七八九十半]{1,3})";

function hasExplicitQuantity(text: string, aliases: readonly string[]): boolean {
  const alternatives = aliases
    .filter((alias) => alias.trim())
    .sort((left, right) => right.length - left.length)
    .map((alias) => alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|");
  return alternatives.length > 0 && new RegExp(`${numericSource}\\s*(?:${alternatives})`, "iu").test(text);
}

function eligibleTemporalProfileHandles(context: JsonRecord): Set<string> {
  const text = actionText(context);
  const durationAliases = [
    "seconds", "second", "secs", "sec", "秒", "minutes", "minute", "mins", "min", "分钟", "分",
    "hours", "hour", "hrs", "hr", "小时", "时", "days", "day", "天", "日", "weeks", "week", "星期", "周",
  ];
  const result = new Set<string>();
  for (const value of array(record(context.state)?.temporalProfiles)) {
    const profile = record(value);
    if (!profile || typeof profile.profileRef !== "string") continue;
    const requirement = record(profile.selection)?.evidenceRequirement;
    if (requirement === "explicit_duration" || profile.allowExplicitDuration === true) {
      if (hasExplicitQuantity(text, durationAliases)) result.add(profile.profileRef);
    } else if (requirement === "explicit_profile_quantity" || profile.kind === "rate") {
      const aliases = [profile.unit, ...array(profile.unitAliases)]
        .filter((alias): alias is string => typeof alias === "string");
      if (hasExplicitQuantity(text, aliases)) result.add(profile.profileRef);
    } else {
      result.add(profile.profileRef);
    }
  }
  return result;
}

function deterministicDetailHandles(
  context: JsonRecord,
  candidates: readonly CandidateRecord[],
  details: ReadonlyMap<string, unknown>,
): Set<string> {
  const selected = referencedStrings(record(context.state)?.slots);
  const text = actionText(context);
  const eligibleProfiles = eligibleTemporalProfileHandles(context);
  for (const entry of candidates) {
    const label = normalizeText(entry.label);
    if ((entry.kind === "temporal_profile" && eligibleProfiles.has(entry.handle)) || entry.kind === "world" ||
      (label.length >= 2 && normalizeText(text).includes(label))) {
      selected.add(entry.handle);
    }
  }
  const addReferences = (handle: string): void => {
    referencedStrings(details.get(handle)).forEach((reference) => selected.add(reference));
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
    if ([...referencedStrings(value)].some((reference) => selected.has(reference))) selected.add(handle);
  }
  [...selected].forEach(addReferences);
  return selected;
}

export function projectActionCompilationContextForModel(input: unknown): ActionCompilationProjectedContext {
  const context = record(input);
  if (!context) throw new Error("Action Compilation context must be an object");
  const candidates = mergedCandidates(context);
  const details = completeDetails(context, candidates);
  const selected = deterministicDetailHandles(context, candidates, details);
  const projectedCandidates = candidates.map((entry) => ({
    ...entry,
    details: selected.has(entry.handle) ? structuredClone(details.get(entry.handle) ?? null) : null,
  }));
  const output = withoutKeys(structuredClone(context), ["referenceCatalogs"]);
  output.referenceCatalog = {
    version: 2,
    hash: contentHash(projectedCandidates),
    candidates: projectedCandidates,
  };
  const state = record(output.state) ?? {};
  const detailedProfileHandles = new Set(projectedCandidates
    .filter((entry) => entry.kind === "temporal_profile" && entry.details != null)
    .map((entry) => entry.handle));
  output.temporalCalibrations = array(state.temporalCalibrations).filter((value) => {
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
        previousAttempt: repair === null ? null : structuredClone(repair.previousOutput ?? null),
      };
    }),
  };
  delete output.state;
  delete output.repair;
  return output as ActionCompilationProjectedContext;
}

export function actionCompilationContextProjectionMetrics(context: unknown): {
  bytes: number;
  candidates: number;
  detailedCandidates: number;
  slots: number;
} {
  const root = record(context) ?? {};
  const candidates = array(record(root.referenceCatalog)?.candidates)
    .map(candidate).filter((entry): entry is CandidateRecord => entry !== null);
  return {
    bytes: Buffer.byteLength(JSON.stringify(context), "utf8"),
    candidates: candidates.length,
    detailedCandidates: candidates.filter((entry) => entry.details != null).length,
    slots: array(record(root.task)?.slots).length,
  };
}
