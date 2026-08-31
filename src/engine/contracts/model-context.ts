import { contentHash } from "../models/model-audit";
import { z } from "zod";

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

export const existingReferenceHandleSchema = z.string().regex(
  /^ref:[\p{L}\p{N}_:-]+$/u,
  "must be a handle from the request reference catalog",
) as unknown as z.ZodType<ExistingReferenceHandle>;

export const proposalKeySchema = z.string().min(1).max(128).refine(
  (value) => value === value.normalize("NFC") && value === value.trim() && !/\p{Cc}/u.test(value),
  "must be NFC, trimmed, and control-free",
) as unknown as z.ZodType<ProposalKey>;

export type ModelReferenceKind =
  | "agent"
  | "entity"
  | "local_entity"
  | "fact"
  | "claim"
  | "evidence"
  | "observation"
  | "action"
  | "event"
  | "check"
  | "random"
  | "rating"
  | "meter"
  | "quantity"
  | "placement"
  | "condition"
  | "activity"
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
  | "replacement";

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

export interface ModelRepairIssue {
  code: string;
  class: "structure" | "reference" | "mechanic" | "privacy" | "causal" | "semantic";
  path: Array<string | number>;
  originalValue: unknown;
  allowedHandles: readonly ExistingReferenceHandle[];
  reason: string;
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
  resolve(handle: string, use?: ModelReferenceUse): ReferenceResolution;
  candidatesFor(use: ModelReferenceUse): readonly ModelReferenceCandidate[];
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

export function referenceHandleFor(kind: ModelReferenceKind, engineId: string): ExistingReferenceHandle {
  return `ref:${normalizeHandleSeed(`${kind}:${engineId}`)}` as ExistingReferenceHandle;
}

/**
 * Builds a deterministic, request-local catalog and keeps the engine id only
 * in the resolver closure. The model receives labels and meaning, not a
 * second copy of the underlying state.
 */
export function createReferenceResolver(
  candidates: readonly ReferenceCandidateInput[],
): ReferenceResolver {
  const used = new Set<string>();
  const resolutions = new Map<string, ReferenceResolution>();
  const visibleCandidates = candidates.map((candidate) => {
    const baseHandle = referenceHandleFor(candidate.kind, candidate.engineId);
    let handle = baseHandle;
    let suffix = 2;
    while (used.has(handle)) handle = `${baseHandle}:${suffix++}` as ExistingReferenceHandle;
    used.add(handle);
    resolutions.set(handle, { handle, kind: candidate.kind, engineId: candidate.engineId });
    return {
      handle,
      kind: candidate.kind,
      label: candidate.label,
      meaning: candidate.meaning,
      allowedUses: [...new Set(candidate.allowedUses)],
      visibility: candidate.visibility ?? "role",
      ...(candidate.statePath ? { statePath: candidate.statePath } : {}),
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

export function proposalKey(value: string): ProposalKey {
  const normalized = value.normalize("NFC").trim();
  if (!normalized || normalized.length > 128 || /\p{Cc}/u.test(normalized)) {
    throw new Error("proposalKey must be non-empty, trimmed, control-free, and at most 128 characters");
  }
  return normalized as ProposalKey;
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
