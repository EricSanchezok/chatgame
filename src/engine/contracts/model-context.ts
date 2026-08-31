import { contentHash } from "../models/model-audit";
import { z } from "zod";
import type { AgentState, ObservationPacket } from "./model";

/**
 * The model-facing contract is deliberately separate from the engine's
 * persistence/runtime identifiers. A handle is meaningful only for the
 * request and slot that issued it; the resolver never trusts model supplied
 * ids as canonical identities.
 */
export const MODEL_CONTEXT_CONTRACT_VERSION = 13 as const;
export const MODEL_REFERENCE_CATALOG_VERSION = 1 as const;

export type ExistingReferenceHandle = string & { readonly __existingReferenceHandle: unique symbol };
export type ProposalKey = string & { readonly __proposalKey: unique symbol };
export interface ProposalReference {
  proposalKey: ProposalKey;
}
export type ModelReference = ExistingReferenceHandle | ProposalReference;

/** A causal link in a model response points at an existing request-local
 * handle (or a proposal created in the same response), never at a runtime id. */
export interface ModelCausalRef {
  kind: "action" | "check" | "random" | "event" | "fact" | "law" | "mechanic";
  ref: ModelReference;
}

export const existingReferenceHandleSchema = z.string().regex(
  /^ref:[\p{L}\p{N}_:-]+$/u,
  "must be a handle from the request reference catalog",
) as unknown as z.ZodType<ExistingReferenceHandle>;

export const proposalKeySchema = z.string().min(1).max(128).refine(
  (value) => value === value.normalize("NFC") && value === value.trim() && !/\p{Cc}/u.test(value),
  "must be NFC, trimmed, and control-free",
) as unknown as z.ZodType<ProposalKey>;

/** A model may either select an existing catalog entry or refer to a proposal
 * made earlier in the same response. Proposal references never resolve to a
 * canonical id until the engine has validated the complete patch. */
export const modelReferenceSchema = z.union([
  existingReferenceHandleSchema,
  z.strictObject({ proposalKey: proposalKeySchema }),
]) as z.ZodType<ModelReference>;

export type ModelReferenceKind =
  | "agent"
  | "entity"
  | "local_entity"
  | "fact"
  | "claim"
  | "evidence"
  | "character_facet"
  | "emotion"
  | "attitude"
  | "goal"
  | "commitment"
  | "observation"
  | "action"
  | "event"
  | "check"
  | "random"
  | "random_distribution"
  | "rating"
  | "meter"
  | "quantity"
  | "placement"
  | "condition"
  | "activity"
  | "temporal_profile"
  | "timer"
  | "law"
  | "mechanic"
  | "shared_resource_pool"
  | "outcome"
  | "operation"
  | "plan"
  | "world";

export type ModelReferenceUse =
  | "target"
  | "subject"
  | "actor"
  | "evidence"
  | "cause"
  | "assertion"
  | "conflict"
  | "audience"
  | "modifier"
  | "mechanic"
  | "source"
  | "stimulus"
  | "replacement"
  | "distribution"
  | "profile";

export interface ModelReferenceCandidate {
  handle: ExistingReferenceHandle;
  kind: ModelReferenceKind;
  label: string;
  meaning: string;
  allowedUses: readonly ModelReferenceUse[];
  visibility: "public" | "role" | "slot";
  /** A human-readable state path. It is never used for resolution. */
  statePath?: string;
}

export interface ModelReferenceCatalog {
  version: typeof MODEL_REFERENCE_CATALOG_VERSION;
  hash: string;
  candidates: readonly ModelReferenceCandidate[];
}

export interface ModelRoleContract {
  role: string;
  purpose: string;
  modelOwns: readonly string[];
  engineOwns: readonly string[];
  existingReferenceRule: string;
  proposalRule: string;
  failureRule: string;
}

export function modelRoleContract(role: string): ModelRoleContract {
  const contracts: Record<string, ModelRoleContract> = {
    "agent-bootstrap": {
      role,
      purpose: "initialize one Agent's private belief and character state and propose its first action",
      modelOwns: ["evidence-supported private changes", "natural-language action intent"],
      engineOwns: ["Agent identity", "revision", "timestamps", "persistent IDs", "canonical bindings"],
      existingReferenceRule: "select existing private objects with this slot's handles",
      proposalRule: "use proposalKey for new private objects",
      failureRule: "leave uncertain references out and report the exact issue for targeted repair",
    },
    "agent-mind": {
      role,
      purpose: "update one Agent's private state from authorized evidence and propose its next action",
      modelOwns: ["evidence-supported private changes", "natural-language action intent"],
      engineOwns: ["Agent identity", "revision", "timestamps", "persistent IDs", "canonical bindings"],
      existingReferenceRule: "select existing private objects with this slot's handles",
      proposalRule: "use proposalKey for new private objects",
      failureRule: "leave uncertain references out and report the exact issue for targeted repair",
    },
    "agent-reaction": {
      role,
      purpose: "keep or replace one prepared action after one private stimulus",
      modelOwns: ["keep or replace decision", "natural-language replacement intent"],
      engineOwns: ["request identity", "Agent identity", "revision", "action identity"],
      existingReferenceRule: "select targetable local objects with this slot's handles",
      proposalRule: "replacement actions do not create canonical objects",
      failureRule: "return a targeted reference issue instead of guessing",
    },
    "action-compilation": {
      role,
      purpose: "choose an authored temporal profile and describe the existing state footprint for each assigned action",
      modelOwns: ["temporal profile selection", "semantic dependency and resource evidence"],
      engineOwns: ["slot identity", "action identity", "canonical IDs", "state changes", "final conflict validation"],
      existingReferenceRule: "select only existing action, actor, entity, resource-pool, and temporal-profile handles from this slot catalog",
      proposalRule: "action compilation does not create canonical records; do not use proposalKey",
      failureRule: "leave uncertain handles out and report the exact slot issue for targeted repair",
    },
  };
  return contracts[role] ?? {
    role,
    purpose: "complete the assigned semantic decision",
    modelOwns: ["the semantic decision described by the task"],
    engineOwns: ["identity", "revision", "persistence", "validation"],
    existingReferenceRule: "select only candidates from the reference catalog",
    proposalRule: "use proposalKey for newly proposed objects",
    failureRule: "report an exact issue for targeted repair",
  };
}

export interface ModelTaskAssignment {
  slot?: number;
  targetHandles: readonly ExistingReferenceHandle[];
  availableHandles: readonly ExistingReferenceHandle[];
  allowedProposalKinds: readonly ModelReferenceKind[];
}

export interface ModelTask {
  assignment: ModelTaskAssignment;
  constraints: readonly string[];
}

/** The single workset handed to a model role.  It is intentionally named by
 * semantic responsibility rather than transport/history implementation
 * details, so a prompt cannot accidentally confuse the complete state with
 * the subset it is allowed to change. */
export interface ModelWorkset<TState = unknown, TAction = unknown, TDependency = unknown> {
  state: TState;
  mode?: "scoped" | "full";
  initialActions: readonly TAction[];
  availableActions: readonly TAction[];
  assignedActions: readonly TAction[];
  availableDependencies: readonly TDependency[];
  assignedDependencies: readonly TDependency[];
}

export interface ModelRepairIssue {
  code: string;
  class: "structure" | "reference" | "mechanic" | "privacy" | "causal" | "semantic";
  path: Array<string | number>;
  originalValue: unknown;
  allowedHandles: readonly ExistingReferenceHandle[];
  reason: string;
}

export interface ModelNormalizationResult<T> {
  value: T;
  issues: ModelRepairIssue[];
  modifiedFieldCount: number;
  resolvedReferenceCount: number;
  proposalCount: number;
  deduplicatedCount: number;
}

export interface ModelContextEnvelope<TState = unknown> {
  contractVersion: typeof MODEL_CONTEXT_CONTRACT_VERSION;
  roleContract: ModelRoleContract;
  execution: {
    worldId: string;
    instanceId: string;
    advanceId: string;
    revision: number;
    step: number;
  };
  task: ModelTask;
  /** Complete authoritative input, included once and never duplicated. */
  state: TState;
  referenceCatalog: ModelReferenceCatalog;
  repair: {
    target: string | null;
    issues: readonly ModelRepairIssue[];
  } | null;
}

export interface ReferenceResolution {
  handle: ExistingReferenceHandle;
  kind: ModelReferenceKind;
  engineId: string;
}

export interface ReferenceResolver {
  readonly catalog: ModelReferenceCatalog;
  /** Resolve an engine-owned identity to the one request-local handle exposed
   * to the model. This is used only while projecting context; model output
   * must still go through `resolve`. */
  handleFor(kind: ModelReferenceKind, engineId: string): ExistingReferenceHandle;
  resolve(handle: string, use?: ModelReferenceUse): ReferenceResolution;
  candidatesFor(use: ModelReferenceUse): readonly ModelReferenceCandidate[];
  /** Build a smaller request-local catalog without exposing engine ids to the model. */
  narrow(predicate: (candidate: ReferenceCandidateInput) => boolean): ReferenceResolver;
}

export interface ReferenceCandidateInput {
  kind: ModelReferenceKind;
  engineId: string;
  label: string;
  meaning: string;
  allowedUses: readonly ModelReferenceUse[];
  visibility?: ModelReferenceCandidate["visibility"];
  statePath?: string;
}

function normalizeHandleSeed(value: string): string {
  return value.normalize("NFC").trim().replace(/[^\p{L}\p{N}_:-]+/gu, "-").replace(/^-+|-+$/gu, "");
}

function handleDigest(value: string): string {
  // Handles are presentation identities, not audit hashes. A tiny stable
  // string hash keeps large Agent catalogs cheap to build while the engine's
  // canonical ids remain behind the resolver for validation and audit.
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function referenceHandleFor(kind: ModelReferenceKind, engineId: string): ExistingReferenceHandle {
  // Test fixtures and materializers may already carry a request-local handle;
  // keep it stable instead of wrapping it as a second reference layer.
  if (engineId.startsWith("ref:")) return engineId as ExistingReferenceHandle;
  const seed = normalizeHandleSeed(`${kind}:${engineId}`);
  /* Runtime IDs are intentionally long for audit integrity but are noise in a
   * prompt. Keep a readable prefix plus a deterministic digest in model
   * handles for every kind, including actions. */
  if (seed.length > 56) {
    const prefix = seed.slice(0, 28).replace(/[:-]+$/u, "");
    return `ref:${prefix}-${handleDigest(`${kind}:${engineId}`)}` as ExistingReferenceHandle;
  }
  return `ref:${seed}` as ExistingReferenceHandle;
}

/**
 * Builds a deterministic, request-local catalog and keeps the engine id only
 * in the resolver closure. The model receives labels and meaning, not a
 * second copy of the underlying state.
 */
export function createReferenceResolver(
  candidates: readonly ReferenceCandidateInput[],
): ReferenceResolver {
  const uniqueCandidates = new Map<string, ReferenceCandidateInput>();
  for (const candidate of candidates) {
    const key = `${candidate.kind}:${candidate.engineId}`;
    const existing = uniqueCandidates.get(key);
    if (!existing) {
      uniqueCandidates.set(key, candidate);
      continue;
    }
    uniqueCandidates.set(key, {
      ...existing,
      label: existing.label || candidate.label,
      meaning: existing.meaning || candidate.meaning,
      allowedUses: [...new Set([...existing.allowedUses, ...candidate.allowedUses])],
      visibility: existing.visibility === "public" || candidate.visibility === "public" ? "public" :
        existing.visibility === "role" || candidate.visibility === "role" ? "role" : "slot",
      statePath: existing.statePath ?? candidate.statePath,
    });
  }
  candidates = [...uniqueCandidates.values()];
  const used = new Set<string>();
  const resolutions = new Map<string, ReferenceResolution>();
  const handlesByEngineKey = new Map<string, ExistingReferenceHandle>();
  const visibleCandidates = candidates.map((candidate) => {
    const baseHandle = referenceHandleFor(candidate.kind, candidate.engineId);
    let handle = baseHandle;
    let suffix = 2;
    while (used.has(handle)) handle = `${baseHandle}:${suffix++}` as ExistingReferenceHandle;
    used.add(handle);
    resolutions.set(handle, { handle, kind: candidate.kind, engineId: candidate.engineId });
    const engineKey = `${candidate.kind}:${candidate.engineId}`;
    if (!handlesByEngineKey.has(engineKey)) handlesByEngineKey.set(engineKey, handle);
    return {
      handle,
      kind: candidate.kind,
      label: candidate.label,
      meaning: candidate.meaning,
      allowedUses: [...new Set(candidate.allowedUses)],
      visibility: candidate.visibility ?? "role",
    } satisfies ModelReferenceCandidate;
  });
  const catalog: ModelReferenceCatalog = {
    version: MODEL_REFERENCE_CATALOG_VERSION,
    hash: contentHash(visibleCandidates),
    candidates: visibleCandidates,
  };
  const byHandle = new Map(visibleCandidates.map((candidate) => [candidate.handle, candidate]));
  return {
    catalog,
    handleFor(kind: ModelReferenceKind, engineId: string): ExistingReferenceHandle {
      const handle = handlesByEngineKey.get(`${kind}:${engineId}`);
      if (!handle) {
        throw new ModelReferenceError({
          code: "reference.projection_missing",
          originalValue: engineId,
          allowedHandles: visibleCandidates.map((entry) => entry.handle),
          reason: `No ${kind} candidate exists for the requested context projection.`,
        });
      }
      return handle;
    },
    resolve(handle: string, use?: ModelReferenceUse): ReferenceResolution {
      const typedHandle = handle as ExistingReferenceHandle;
      const candidate = byHandle.get(typedHandle);
      const resolution = resolutions.get(typedHandle);
      if (!candidate || !resolution) {
        throw new ModelReferenceError({
          code: "reference.unknown_handle",
          originalValue: handle,
          allowedHandles: visibleCandidates.map((entry) => entry.handle),
          reason: "The value is not a handle from this request's reference catalog.",
        });
      }
      if (use && !candidate.allowedUses.includes(use)) {
        throw new ModelReferenceError({
          code: "reference.disallowed_use",
          originalValue: handle,
          allowedHandles: visibleCandidates.filter((entry) => entry.allowedUses.includes(use)).map((entry) => entry.handle),
          reason: `The ${candidate.kind} candidate cannot be used as ${use}.`,
        });
      }
      return resolution;
    },
    candidatesFor(use: ModelReferenceUse): readonly ModelReferenceCandidate[] {
      return visibleCandidates.filter((candidate) => candidate.allowedUses.includes(use));
    },
    narrow(predicate: (candidate: ReferenceCandidateInput) => boolean): ReferenceResolver {
      return createReferenceResolver(candidates.filter(predicate));
    },
  };
}

export class ModelReferenceError extends Error {
  readonly code: string;
  readonly originalValue: unknown;
  readonly allowedHandles: readonly ExistingReferenceHandle[];

  constructor(input: {
    code: string;
    originalValue: unknown;
    allowedHandles: readonly ExistingReferenceHandle[];
    reason: string;
  }) {
    super(input.reason);
    this.name = "ModelReferenceError";
    this.code = input.code;
    this.originalValue = input.originalValue;
    this.allowedHandles = [...input.allowedHandles];
  }
}

function isReferenceField(key: string): boolean {
  return key === "ref" || key.endsWith("Ref") || key.endsWith("Refs") || key === "evidenceHandles";
}

/** Validate every model-facing reference in a parsed value against the
 * request-local catalog.  This is deliberately exact: there is no fuzzy
 * matching, global fallback, dropping, or conversion of an unknown handle to
 * a new object. */
export function resolveModelReferences<T>(value: T, resolver: ReferenceResolver): ModelRepairIssue[] {
  const issues: ModelRepairIssue[] = [];
  const visit = (current: unknown, path: Array<string | number>): void => {
    if (Array.isArray(current)) {
      current.forEach((item, index) => visit(item, [...path, index]));
      return;
    }
    if (!current || typeof current !== "object") return;
    for (const [key, child] of Object.entries(current as Record<string, unknown>)) {
      const childPath = [...path, key];
      if (isReferenceField(key)) {
        const values = Array.isArray(child) ? child : [child];
        values.forEach((reference, index) => {
          if (reference === null) return;
          // Structured references such as `{ kind, ref }` are traversed
          // below; the nested `ref` field is the value that must be resolved.
          // Treating the wrapper as a direct handle produces a misleading
          // invalid-shape issue for every causes/sourceRefs array.
          if (typeof reference === "object" && reference !== null && "ref" in reference && !("proposalKey" in reference)) return;
          if (typeof reference === "object" && reference !== null && "proposalKey" in reference) {
            try { proposalKeySchema.parse((reference as { proposalKey: unknown }).proposalKey); }
            catch (error) {
              issues.push({ code: "proposal.invalid", class: "reference", path: [...childPath, ...(Array.isArray(child) ? [index] : [])], originalValue: reference, allowedHandles: [], reason: error instanceof Error ? error.message : String(error) });
            }
            return;
          }
          if (typeof reference !== "string") {
            issues.push({ code: "reference.invalid_shape", class: "reference", path: [...childPath, ...(Array.isArray(child) ? [index] : [])], originalValue: reference, allowedHandles: resolver.catalog.candidates.map((candidate) => candidate.handle), reason: "Existing references must be exact catalog handles or proposal references." });
            return;
          }
          try { resolver.resolve(reference); }
          catch (error) {
            if (error instanceof ModelReferenceError) issues.push(modelRepairIssueFromReferenceError(error, [...childPath, ...(Array.isArray(child) ? [index] : [])]));
            else issues.push({ code: "reference.invalid", class: "reference", path: childPath, originalValue: reference, allowedHandles: [], reason: error instanceof Error ? error.message : String(error) });
          }
        });
      }
      visit(child, childPath);
    }
  };
  visit(value, []);
  return issues;
}

/** Apply only deterministic, semantics-preserving repairs.  The function is
 * intentionally generic so every model role records the same repair counts;
 * role-specific materializers still own domain validation and id assignment. */
export function normalizeModelOutput<T>(value: T, options: {
  resolver?: ReferenceResolver;
  dedupeArrays?: boolean;
} = {}): ModelNormalizationResult<T> {
  let modifiedFieldCount = 0;
  let deduplicatedCount = 0;
  let proposalCount = 0;
  const proposalPaths = new Map<string, Array<string | number>>();
  const proposalIssues: ModelRepairIssue[] = [];
  const normalize = (current: unknown, path: Array<string | number>): unknown => {
    if (Array.isArray(current)) {
      const normalized = current.map((item, index) => normalize(item, [...path, index]));
      const arrayKey = path.at(-1);
      const canDedupe = options.dedupeArrays === true && typeof arrayKey === "string" &&
        (arrayKey.endsWith("Refs") || arrayKey.endsWith("Handles"));
      if (canDedupe) {
        const seen = new Set<string>();
        const unique = normalized.filter((item) => {
          const key = JSON.stringify(item);
          if (seen.has(key)) { deduplicatedCount += 1; return false; }
          seen.add(key); return true;
        });
        return unique;
      }
      return normalized;
    }
    if (!current || typeof current !== "object") return current;
    const output: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(current as Record<string, unknown>)) {
      // `{ proposalKey }` is a reference when it is the complete object (for
      // example an effect's derived conditionRef), not a declaration. Only a
      // record carrying additional fields declares a new object. Treating
      // both shapes as declarations made every internal proposal reference
      // look like a duplicate declaration during normalization.
      const isProposalReferenceObject = key === "proposalKey" &&
        typeof child === "string" && Object.keys(current as Record<string, unknown>).length === 1;
      if (key === "proposalKey" && typeof child === "string" && !isProposalReferenceObject) {
        const normalizedKey = child.normalize("NFC").trim();
        if (normalizedKey !== child) modifiedFieldCount += 1;
        proposalCount += 1;
        const existingPath = proposalPaths.get(normalizedKey);
        if (existingPath) {
          proposalIssues.push({
            code: "proposal.duplicate",
            class: "reference",
            path: [...path, key],
            originalValue: child,
            allowedHandles: [],
            reason: `proposalKey ${normalizedKey} is already declared at ${JSON.stringify(existingPath)}.`,
          });
        } else {
          proposalPaths.set(normalizedKey, [...path, key]);
        }
        output[key] = normalizedKey;
      } else {
        output[key] = normalize(child, [...path, key]);
      }
    }
    return output;
  };
  const normalized = normalize(value, []) as T;
  const validateProposalReferences = (current: unknown, path: Array<string | number>): void => {
    if (Array.isArray(current)) {
      current.forEach((item, index) => validateProposalReferences(item, [...path, index]));
      return;
    }
    if (!current || typeof current !== "object") return;
    const record = current as Record<string, unknown>;
    if (Object.keys(record).length === 1 && typeof record.proposalKey === "string" &&
      !proposalPaths.has(record.proposalKey)) {
      proposalIssues.push({
        code: "proposal.unknown_reference",
        class: "reference",
        path,
        originalValue: structuredClone(record),
        allowedHandles: [],
        reason: `proposalKey ${record.proposalKey} is not declared by this output.`,
      });
    }
    Object.entries(record).forEach(([key, child]) =>
      validateProposalReferences(child, [...path, key]));
  };
  validateProposalReferences(normalized, []);
  const issues = [
    ...proposalIssues,
    ...(options.resolver ? resolveModelReferences(normalized, options.resolver) : []),
  ];
  return {
    value: normalized,
    issues,
    modifiedFieldCount,
    resolvedReferenceCount: options.resolver ? countResolvedReferences(normalized, options.resolver) : 0,
    proposalCount,
    deduplicatedCount,
  };
}

function countResolvedReferences(value: unknown, resolver: ReferenceResolver): number {
  let count = 0;
  const visit = (current: unknown): void => {
    if (Array.isArray(current)) { current.forEach(visit); return; }
    if (!current || typeof current !== "object") return;
    for (const [key, child] of Object.entries(current as Record<string, unknown>)) {
      if (isReferenceField(key)) {
        for (const reference of Array.isArray(child) ? child : [child]) {
          if (typeof reference === "string") { try { resolver.resolve(reference); count += 1; } catch { /* issues carry the reason */ } }
        }
      }
      visit(child);
    }
  };
  visit(value);
  return count;
}

export function proposalKey(value: string): ProposalKey {
  const normalized = value.normalize("NFC").trim();
  if (!normalized || normalized.length > 128 || /\p{Cc}/u.test(normalized)) {
    throw new Error("proposalKey must be non-empty, trimmed, control-free, and at most 128 characters");
  }
  return normalized as ProposalKey;
}

export function isProposalReference(value: ModelReference): value is ProposalReference {
  return typeof value === "object" && value !== null && "proposalKey" in value;
}

export function modelRepairIssueFromReferenceError(
  error: ModelReferenceError,
  path: Array<string | number>,
  reason = error.message,
): ModelRepairIssue {
  return {
    code: error.code,
    class: "reference",
    path: [...path],
    originalValue: error.originalValue,
    allowedHandles: [...error.allowedHandles],
    reason,
  };
}

export function createAgentReferenceResolver(
  agent: Readonly<AgentState>,
  observations: readonly ObservationPacket[] = [],
): ReferenceResolver {
  const candidates: ReferenceCandidateInput[] = [
    ...Object.values(agent.belief.localEntities).map((entity) => ({
      kind: "local_entity" as const,
      engineId: entity.id,
      label: entity.name,
      meaning: "an entity in this Agent's private belief namespace",
      allowedUses: ["target", "subject", "evidence", "assertion"] as const,
      visibility: "slot" as const,
      statePath: `state.agent.belief.localEntities.${entity.id}`,
    })),
    ...Object.values(agent.belief.evidence).map((evidence) => ({
      kind: "evidence" as const,
      engineId: evidence.id,
      label: evidence.description,
      meaning: "private evidence available to this Agent",
      allowedUses: ["evidence", "source"] as const,
      visibility: "slot" as const,
      statePath: `state.agent.belief.evidence.${evidence.id}`,
    })),
    ...Object.values(agent.belief.claims).map((claim) => ({
      kind: "claim" as const,
      engineId: claim.id,
      label: claim.predicate,
      meaning: "a claim in this Agent's private belief state",
      allowedUses: ["target", "subject", "assertion", "source"] as const,
      visibility: "slot" as const,
      statePath: `state.agent.belief.claims.${claim.id}`,
    })),
    ...Object.values(agent.character.traits).map((facet) => ({
      kind: "character_facet" as const,
      engineId: facet.id,
      label: facet.description,
      meaning: "an existing private character trait",
      allowedUses: ["source", "replacement"] as const,
      visibility: "slot" as const,
      statePath: `state.agent.character.traits.${facet.id}`,
    })),
    ...Object.values(agent.character.values).map((facet) => ({
      kind: "character_facet" as const,
      engineId: facet.id,
      label: facet.description,
      meaning: "an existing private character value",
      allowedUses: ["source", "replacement"] as const,
      visibility: "slot" as const,
      statePath: `state.agent.character.values.${facet.id}`,
    })),
    ...Object.values(agent.character.emotions).map((emotion) => ({
      kind: "emotion" as const,
      engineId: emotion.id,
      label: emotion.description,
      meaning: "an existing private emotion",
      allowedUses: ["source", "replacement"] as const,
      visibility: "slot" as const,
      statePath: `state.agent.character.emotions.${emotion.id}`,
    })),
    ...Object.values(agent.character.attitudes).map((attitude) => ({
      kind: "attitude" as const,
      engineId: attitude.id,
      label: attitude.description,
      meaning: "an existing private attitude",
      allowedUses: ["source", "replacement"] as const,
      visibility: "slot" as const,
      statePath: `state.agent.character.attitudes.${attitude.id}`,
    })),
    ...Object.values(agent.character.goals).map((goal) => ({
      kind: "goal" as const,
      engineId: goal.id,
      label: goal.description,
      meaning: "an existing private goal",
      allowedUses: ["source", "replacement"] as const,
      visibility: "slot" as const,
      statePath: `state.agent.character.goals.${goal.id}`,
    })),
    ...Object.values(agent.character.commitments).map((commitment) => ({
      kind: "commitment" as const,
      engineId: commitment.id,
      label: commitment.description,
      meaning: "an existing private commitment",
      allowedUses: ["source", "replacement"] as const,
      visibility: "slot" as const,
      statePath: `state.agent.character.commitments.${commitment.id}`,
    })),
    ...observations.map((observation) => ({
      kind: "observation" as const,
      engineId: observation.id,
      label: observation.summary,
      meaning: "an observation this Agent is allowed to use as evidence",
      allowedUses: ["evidence", "source", "stimulus"] as const,
      visibility: "slot" as const,
      statePath: `state.observations.${observation.id}`,
    })),
  ];
  return createReferenceResolver(candidates);
}
