import { createHash } from "node:crypto";
import { contentHash } from "../../models/model-audit";
import type { CandidateRetriever } from "./stabilized-behavior";

export interface CandidateRetrievalMiddleware {
  readonly version: string;
  readonly role: "action-compilation";
  apply(input: {
    fullContext: Readonly<Record<string, unknown>>;
    slotIndices: readonly number[];
  }): {
    modelContext: Record<string, unknown>;
    selectedKeysBySlot: ReadonlyMap<number, readonly string[]>;
    fullContextHash: string;
    modelContextHash: string;
    shortlistHash: string;
    diagnostics: {
      selectedCount: number;
      visibleCount: number;
      prunedReferenceCount: number;
      anchorCount: number;
      budgetExceeded: boolean;
    };
  };
}

export interface CandidateRetrievalMiddlewareOptions {
  version: string;
  retriever: CandidateRetriever;
  budgetRatio?: number;
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

function mandatoryKeys(context: Readonly<Record<string, unknown>>, slotIndex: number): string[] {
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

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function isDeterministicCanary(instanceId: string, algorithmManifestHash: string, percentage = 30): boolean {
  if (!Number.isSafeInteger(percentage) || percentage < 0 || percentage > 100) throw new Error("canary percentage must be between 0 and 100");
  const bucket = Number.parseInt(sha256(`${instanceId}${algorithmManifestHash}`).slice(0, 8), 16) % 100;
  return bucket < percentage;
}

export function createCandidateRetrievalMiddleware(options: CandidateRetrievalMiddlewareOptions): CandidateRetrievalMiddleware {
  const budgetRatio = options.budgetRatio ?? 0.2;
  if (!Number.isFinite(budgetRatio) || budgetRatio <= 0 || budgetRatio > 0.2) throw new Error("middleware budgetRatio must be in (0, 0.2]");
  return {
    version: options.version,
    role: "action-compilation",
    apply({ fullContext, slotIndices }) {
      const catalog = object(fullContext.referenceCatalog);
      const catalogCandidates = Array.isArray(catalog?.candidates) ? catalog.candidates.flatMap((entry) => {
        const candidate = object(entry);
        return candidate && typeof candidate.candidateKey === "string" ? [candidate] : [];
      }) : [];
      const byKey = new Map(catalogCandidates.map((candidate) => [candidate.candidateKey as string, candidate]));
      const selectedBySlot = new Map<number, readonly string[]>();
      const selected = new Set<string>();
      let anchorCount = 0;
      let budgetExceeded = false;
      for (const slotIndex of [...new Set(slotIndices)].sort((left, right) => left - right)) {
        const result = options.retriever({ context: structuredClone(fullContext), slotIndex });
        if (!Array.isArray(result) || result.some((key) => typeof key !== "string")) throw new Error(`candidate retriever returned invalid output for slot ${slotIndex}`);
        const unique = [...new Set(result)].sort();
        const visibleCandidates = catalogCandidates.filter((candidate) => visible(candidate, slotIndex));
        const visibleKeys = new Set(visibleCandidates.map((candidate) => candidate.candidateKey as string));
        const invalid = unique.filter((key) => !byKey.has(key) || !visibleKeys.has(key));
        if (invalid.length > 0) throw new Error(`candidate retriever returned invalid/private keys for slot ${slotIndex}: ${invalid.join(",")}`);
        const mandatory = mandatoryKeys(fullContext, slotIndex);
        const missingAnchors = mandatory.filter((key) => !unique.includes(key));
        if (missingAnchors.length > 0) throw new Error(`candidate retrieval anchor missing for slot ${slotIndex}: ${missingAnchors.join(",")}`);
        anchorCount += mandatory.length;
        const floorBudget = Math.floor(visibleCandidates.length * budgetRatio);
        const strictBudget = Math.min(floorBudget, Math.max(0, Math.ceil(visibleCandidates.length * budgetRatio) - 1));
        budgetExceeded ||= unique.length > strictBudget;
        selectedBySlot.set(slotIndex, unique);
        unique.forEach((key) => selected.add(key));
      }
      if (budgetExceeded) throw new Error("candidate retrieval exceeded the configured budget");
      const fullContextCopy = structuredClone(fullContext);
      const modelContext = structuredClone(fullContext) as Record<string, unknown>;
      const modelCatalog = object(modelContext.referenceCatalog);
      const counter = { count: 0 };
      if (modelCatalog) {
        (modelCatalog as Record<string, unknown>).candidates = catalogCandidates.filter((candidate) => selected.has(candidate.candidateKey as string)).map((candidate) => prune(candidate, selected, counter));
        modelContext.referenceCatalog = modelCatalog;
      }
      const selectedBySlotJson = [...selectedBySlot.entries()].map(([slot, keys]) => [slot, keys]);
      return {
        modelContext,
        selectedKeysBySlot: selectedBySlot,
        fullContextHash: contentHash(fullContextCopy),
        modelContextHash: contentHash(modelContext),
        shortlistHash: contentHash({ version: options.version, selectedBySlot: selectedBySlotJson }),
        diagnostics: {
          selectedCount: selected.size,
          visibleCount: catalogCandidates.length,
          prunedReferenceCount: counter.count,
          anchorCount,
          budgetExceeded,
        },
      };
    },
  };
}

export function createDeterministicCanaryMiddleware(input: CandidateRetrievalMiddlewareOptions & {
  instanceId: string;
  algorithmManifestHash: string;
  percentage?: number;
}): CandidateRetrievalMiddleware | null {
  return isDeterministicCanary(input.instanceId, input.algorithmManifestHash, input.percentage ?? 30)
    ? createCandidateRetrievalMiddleware(input)
    : null;
}
