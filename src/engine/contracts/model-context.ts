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
  const seed = normalizeHandleSeed(`${kind}:${engineId}`);
  /* Runtime IDs are intentionally long for audit integrity but are noise in a
   * prompt. Keep a readable prefix plus a deterministic digest in model
   * handles; action handles stay verbatim because scripted fixtures use them
   * to identify the assigned attempt. */
  if (kind !== "action" && seed.length > 56) {
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
