import type {
  ActionCompilationReferenceAudit,
  ModelExecutionAudit,
} from "../../contracts/model";
import {
  ACTION_COMPILATION_PROJECTION,
  ACTION_COMPILATION_CANDIDATE_KEY_VERSION,
} from "../../contracts/model-context";
import { DEFAULT_SYMBOL_REPAIR_POLICY } from "../../contracts/symbol-repair";
import type { ExecutionRecord } from "../../../server/execution-ledger";
import type { RuntimeEvent } from "../../runtime/observability";
import { contentHash } from "../../models/model-audit";
import type {
  ActionCompilationReferenceCase,
  ActionCompilationReferenceContextRecord,
} from "./stabilized-behavior";

export interface LedgerActionCompilationSource {
  execution: ExecutionRecord;
  events: readonly RuntimeEvent[];
}

export interface LedgerActionCompilationExportCase extends ActionCompilationReferenceCase {
  /** Runtime action identity is provenance only and is not part of the dataset contract. */
  actionId: string;
}

export interface LedgerActionCompilationExportStats {
  sourceExecutionIds: string[];
  providerRequests: number;
  transportAttempts: number;
  logicalInvocations: number;
  repairCalls: number;
  rootContexts: number;
  acceptedSlots: number;
  rejectedSlots: number;
}

export interface LedgerActionCompilationExport {
  cases: LedgerActionCompilationExportCase[];
  contexts: ActionCompilationReferenceContextRecord[];
  stats: LedgerActionCompilationExportStats;
  source: {
    worldId: string;
    worldHash: string;
    initialStateHash: string;
    modelCatalogHash: string;
    registrySnapshotHash: string;
    algorithmManifestHash: string;
    promptVersion: string;
    profileId: string;
    modelId: string;
    candidateKeyVersion: string;
    symbolRepairPolicyVersion: string;
  };
}

interface Attempt {
  invocationId: string;
  logicalInvocationId: string;
  semanticRepairAttempt: number;
  sequence: number;
  parentInvocationId?: string;
  repairOf?: string;
  rejected: boolean;
  reference: ActionCompilationReferenceAudit;
}

interface ContextEventPayload {
  context?: unknown;
  promptVersion?: unknown;
  profileId?: unknown;
  modelId?: unknown;
  modelCatalogHash?: unknown;
  registrySnapshotHash?: unknown;
}

function objectRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function eventPayload<T>(event: RuntimeEvent | undefined): T | undefined {
  return event?.payload as T | undefined;
}

function referencePayload(event: RuntimeEvent): ActionCompilationReferenceAudit | undefined {
  const payload = eventPayload<ActionCompilationReferenceAudit>(event);
  return payload?.projection === ACTION_COMPILATION_PROJECTION && Array.isArray(payload.slots)
    ? payload
    : undefined;
}

function contextPayload(event: RuntimeEvent | undefined): (Omit<ContextEventPayload, "context"> & { context: Record<string, unknown> }) | undefined {
  const payload = eventPayload<ContextEventPayload>(event);
  const context = objectRecord(payload?.context);
  return context ? { ...payload, context } : undefined;
}

function auditPayload(event: RuntimeEvent): ModelExecutionAudit | undefined {
  const payload = eventPayload<ModelExecutionAudit>(event);
  return payload && typeof payload.role === "string" && Array.isArray(payload.invocations)
    ? payload
    : undefined;
}

function actionIdFromFailureMessage(message: string | undefined): string[] {
  if (!message) return [];
  return [...new Set(message.match(/rt:action:[a-f0-9]+/gu) ?? [])];
}

function failedActionIds(events: readonly RuntimeEvent[]): Set<string> {
  const ids = new Set<string>();
  for (const event of events) {
    if (event.event !== "execution.failed") continue;
    for (const id of actionIdFromFailureMessage(event.error?.message)) ids.add(id);
  }
  return ids;
}

function invocationStats(sources: readonly LedgerActionCompilationSource[]): Pick<LedgerActionCompilationExportStats, "providerRequests" | "transportAttempts" | "logicalInvocations" | "repairCalls"> {
  let providerRequests = 0;
  let transportAttempts = 0;
  let logicalInvocations = 0;
  let repairCalls = 0;
  for (const source of sources) {
    const auditEvents = source.events.filter((event) => event.event === "model.audit.persisted" &&
      event.correlation?.modelRole === "action-compilation");
    providerRequests += auditEvents.reduce((sum, event) => {
      const audit = auditPayload(event);
      const invocation = audit?.invocations.at(-1);
      return sum + (invocation?.transports.length ?? 0);
    }, 0);
    transportAttempts += auditEvents.reduce((sum, event) => {
      const audit = auditPayload(event);
      const invocation = audit?.invocations.at(-1);
      return sum + (invocation?.transports.length ?? 0);
    }, 0);
    const invocationIds = new Set(auditEvents.map((event) => event.correlation?.modelInvocationId).filter((id): id is string => Boolean(id)));
    logicalInvocations += invocationIds.size;
    repairCalls += source.events.filter((event) => event.event === "model.audit.persisted" &&
      event.correlation?.modelRole === "action-compilation" &&
      (event.correlation.semanticRepairAttempt ?? 0) > 0).length;
  }
  return { providerRequests, transportAttempts, logicalInvocations, repairCalls };
}

function sourceMetadata(
  source: LedgerActionCompilationSource,
  contextEvents: readonly RuntimeEvent[],
): LedgerActionCompilationExport["source"] {
  const execution = source.execution;
  const firstContext = contextEvents.find((event) => (event.correlation?.semanticRepairAttempt ?? 0) === 0);
  const payload = contextPayload(firstContext);
  const algorithmManifest = objectRecord(execution.manifest);
  const algorithmHash = typeof algorithmManifest?.hash === "string" ? algorithmManifest.hash : "";
  const preparation = source.events.find((event) => event.event === "step.preparation.started");
  const preparationDefinition = objectRecord(objectRecord(eventPayload(preparation))?.definition);
  const worldId = typeof preparationDefinition?.id === "string"
    ? preparationDefinition.id
    : "";
  const initialStateHash = preparationDefinition?.initialState !== undefined
    ? contentHash(preparationDefinition.initialState)
    : "";
  const promptVersion = typeof payload?.promptVersion === "string" ? payload.promptVersion : "";
  const profileId = typeof payload?.profileId === "string" ? payload.profileId : "";
  const modelId = typeof payload?.modelId === "string" ? payload.modelId : "";
  const modelCatalogHash = typeof payload?.modelCatalogHash === "string"
    ? payload.modelCatalogHash
    : execution.modelCatalogHash;
  const registrySnapshotHash = typeof payload?.registrySnapshotHash === "string"
    ? payload.registrySnapshotHash
    : "";
  if (!worldId || !initialStateHash || !algorithmHash || !promptVersion || !profileId || !modelId || !modelCatalogHash || !registrySnapshotHash) {
    throw new Error(`execution ${execution.id} is missing Action Compilation source fingerprints`);
  }
  return {
    worldId,
    worldHash: execution.worldHash,
    initialStateHash,
    modelCatalogHash,
    registrySnapshotHash,
    algorithmManifestHash: algorithmHash,
    promptVersion,
    profileId,
    modelId,
    candidateKeyVersion: `${ACTION_COMPILATION_PROJECTION}@${ACTION_COMPILATION_CANDIDATE_KEY_VERSION}`,
    symbolRepairPolicyVersion: DEFAULT_SYMBOL_REPAIR_POLICY.version,
  };
}

function assertSameSource(
  expected: LedgerActionCompilationExport["source"],
  actual: LedgerActionCompilationExport["source"],
  executionId: string,
): void {
  if (contentHash(expected) !== contentHash(actual)) {
    throw new Error(`execution ${executionId} has a different world/model/algorithm/prompt fingerprint`);
  }
}

function resolvedKeys(slot: ActionCompilationReferenceAudit["slots"][number]): string[] {
  return [...new Set(slot.selections
    .filter((selection) => selection.status === "resolved")
    .map((selection) => selection.candidateKey))].sort();
}

function hasInvalidSelection(slot: ActionCompilationReferenceAudit["slots"][number]): boolean {
  return slot.selections.some((selection) => selection.status !== "resolved");
}

function rootContextEvent(events: readonly RuntimeEvent[], logicalInvocationId: string): RuntimeEvent | undefined {
  return events.find((event) => event.event === "model.context.serialized" &&
    event.correlation?.modelRole === "action-compilation" &&
    event.correlation.logicalInvocationId === logicalInvocationId &&
    (event.correlation.semanticRepairAttempt ?? 0) === 0 &&
    objectRecord(eventPayload<ContextEventPayload>(event)?.context));
}

function collectAttempts(events: readonly RuntimeEvent[]): Map<string, Attempt[]> {
  const rejected = new Set(events
    .filter((event) => event.event === "model.semantic.rejected" && event.correlation?.modelInvocationId)
    .map((event) => event.correlation!.modelInvocationId!));
  const attempts = new Map<string, Attempt[]>();
  for (const event of events) {
    if (event.event !== "model.action_compilation.references") continue;
    const reference = referencePayload(event);
    const logicalInvocationId = event.correlation?.logicalInvocationId;
    const invocationId = event.correlation?.modelInvocationId;
    if (!reference || !logicalInvocationId || !invocationId) continue;
    const semanticRepairAttempt = event.correlation?.semanticRepairAttempt ?? 0;
    const list = attempts.get(logicalInvocationId) ?? [];
    const existing = list.find((attempt) => attempt.invocationId === invocationId);
    if (existing) {
      // The post-output audit follows the pre-output audit. Keep the latter's
      // identity/lineage while replacing the empty selection snapshot.
      existing.reference = reference;
      existing.sequence = event.sequence ?? existing.sequence;
      existing.rejected = rejected.has(invocationId);
      existing.parentInvocationId = event.correlation?.parentInvocationId;
      existing.repairOf = event.correlation?.repairOf;
      continue;
    }
    list.push({
      invocationId,
      logicalInvocationId,
      semanticRepairAttempt,
      sequence: event.sequence ?? 0,
      ...(event.correlation?.parentInvocationId ? { parentInvocationId: event.correlation.parentInvocationId } : {}),
      ...(event.correlation?.repairOf ? { repairOf: event.correlation.repairOf } : {}),
      rejected: rejected.has(invocationId),
      reference,
    });
    attempts.set(logicalInvocationId, list);
  }
  for (const list of attempts.values()) {
    list.sort((left, right) => left.semanticRepairAttempt - right.semanticRepairAttempt || left.sequence - right.sequence);
    const seen = new Set<string>();
    for (const attempt of list) {
      if (attempt.semanticRepairAttempt === 0) {
        if (attempt.repairOf || attempt.parentInvocationId) {
          throw new Error(`root invocation ${attempt.invocationId} unexpectedly has a repair parent`);
        }
      } else {
        const parent = attempt.repairOf ?? attempt.parentInvocationId;
        if (parent && !seen.has(parent)) {
          throw new Error(`repair invocation ${attempt.invocationId} has an unknown parent ${parent}`);
        }
      }
      seen.add(attempt.invocationId);
    }
  }
  return attempts;
}

function validateSourceContext(context: Record<string, unknown>, contextHash: string): void {
  const catalog = objectRecord(context.referenceCatalog);
  const candidates = catalog?.candidates;
  if (!Array.isArray(candidates)) throw new Error(`context ${contextHash} has no reference catalog candidates`);
  const keys = new Set<string>();
  for (const [index, candidateValue] of candidates.entries()) {
    const candidate = objectRecord(candidateValue);
    const key = candidate?.candidateKey;
    if (typeof key !== "string" || !/^candidate_[0-9a-f]{12}$/u.test(key)) {
      throw new Error(`context ${contextHash} candidate ${index} has an invalid candidateKey`);
    }
    if (keys.has(key)) throw new Error(`context ${contextHash} contains duplicate candidateKey ${key}`);
    keys.add(key);
  }
  const sensitiveKey = /^(?:authorization|proxy-authorization|api[_-]?key|x-api-key|cookie|set-cookie|access-token|refresh-token|client-secret)$/iu;
  const bearerValue = /^bearer\s+[A-Za-z0-9._~+/=-]+$/u;
  const containsSecret = (value: unknown, parentKey?: string): boolean => {
    if (Array.isArray(value)) return value.some((item) => containsSecret(item, parentKey));
    if (!value || typeof value !== "object") {
      return typeof value === "string" && (bearerValue.test(value) || Boolean(parentKey && sensitiveKey.test(parentKey)));
    }
    return Object.entries(value).some(([key, child]) => sensitiveKey.test(key) || containsSecret(child, key));
  };
  if (containsSecret(context)) throw new Error(`context ${contextHash} contains a credential-like field`);
}

function candidateVisible(candidate: Record<string, unknown>, slotIndex: number): boolean {
  const scope = objectRecord(candidate.scope);
  if (!scope || scope.kind === "shared") return true;
  return scope.kind === "slot" && scope.slot === slotIndex;
}

function assertCaseKeysVisible(context: Record<string, unknown>, slotIndex: number, keys: readonly string[], label: string): void {
  const catalog = objectRecord(context.referenceCatalog);
  const candidates = Array.isArray(catalog?.candidates) ? catalog.candidates : [];
  const entries = new Map(candidates.flatMap((value) => {
    const candidate = objectRecord(value);
    return typeof candidate?.candidateKey === "string" ? [[candidate.candidateKey, candidate] as const] : [];
  }));
  for (const key of keys) {
    const candidate = entries.get(key);
    if (!candidate) throw new Error(`${label} references candidate absent from catalog: ${key}`);
    if (!candidateVisible(candidate, slotIndex)) throw new Error(`${label} references candidate private to another slot: ${key}`);
  }
}

function contextSlotIndex(reference: ActionCompilationReferenceAudit, actionId: string): number {
  const slot = reference.slots.find((value) => value.actionId === actionId);
  if (!slot) throw new Error(`action ${actionId} is absent from its root reference audit`);
  return slot.slot;
}

export function exportActionCompilationFromLedger(
  sources: readonly LedgerActionCompilationSource[],
  version = 1,
): LedgerActionCompilationExport {
  if (sources.length === 0) throw new Error("at least one Ledger execution is required");
  if (!Number.isSafeInteger(version) || version < 1) throw new Error("dataset version must be a positive integer");
  const failedIds = new Set<string>(sources.flatMap((source) => [...failedActionIds(source.events)]));
  const allCases: LedgerActionCompilationExportCase[] = [];
  const contexts = new Map<string, ActionCompilationReferenceContextRecord>();
  let sourceFingerprint: LedgerActionCompilationExport["source"] | undefined;
  let rootContexts = 0;
  let rejectedSlots = 0;
  for (const source of sources) {
    const actionEvents = source.events.filter((event) => event.correlation?.modelRole === "action-compilation");
    const contextEvents = actionEvents.filter((event) => event.event === "model.context.serialized");
    const metadata = sourceMetadata(source, contextEvents);
    if (sourceFingerprint) assertSameSource(sourceFingerprint, metadata, source.execution.id);
    else sourceFingerprint = metadata;
    const attemptsByLogical = collectAttempts(actionEvents);
    const auditByInvocation = new Map<string, ModelExecutionAudit["invocations"][number]>();
    for (const event of actionEvents) {
      const audit = event.event === "model.audit.persisted" ? auditPayload(event) : undefined;
      for (const invocation of audit?.invocations ?? []) auditByInvocation.set(invocation.id, invocation);
    }
    for (const [logicalInvocationId, attempts] of attemptsByLogical) {
      const root = attempts.find((attempt) => attempt.semanticRepairAttempt === 0);
      const rootContext = rootContextEvent(actionEvents, logicalInvocationId);
      const rootReference = root?.reference;
      const context = contextPayload(rootContext)?.context;
      if (!root || !rootReference || !context) {
        throw new Error(`logical Action Compilation invocation ${logicalInvocationId} is missing its root context or reference audit`);
      }
      rootContexts += 1;
      const rootContextHash = contentHash(context);
      validateSourceContext(context, rootContextHash);
      contexts.set(rootContextHash, {
        contextHash: rootContextHash,
        context,
        source: {
          executionId: source.execution.id,
          invocationId: root.invocationId,
          catalogHash: typeof objectRecord(context.referenceCatalog)?.hash === "string"
            ? objectRecord(context.referenceCatalog)!.hash as string
            : undefined,
        },
      });
      const actionIds = [...new Set(attempts.flatMap((attempt) => attempt.reference.slots.map((slot) => slot.actionId)))];
      for (const actionId of actionIds) {
        let lastIndex = -1;
        for (const [index, attempt] of attempts.entries()) {
          if (attempt.reference.slots.some((slot) => slot.actionId === actionId)) lastIndex = index;
        }
        if (lastIndex < 0) continue;
        const finalAttempt = attempts[lastIndex]!;
        const slot = finalAttempt.reference.slots.find((value) => value.actionId === actionId);
        if (!slot) continue;
        // A rejected attempt may still contain slots that the production
        // compiler accepted. Those slots disappear from the pending set and
        // therefore do not occur in a later repair attempt. An action that is
        // present in the final rejected attempt is still pending and must be
        // excluded, even when its reference audit happens to show resolved
        // references (for example a temporal/mechanic failure).
        const accepted = !hasInvalidSelection(slot) &&
          (!finalAttempt.rejected || lastIndex < attempts.length - 1) &&
          !failedIds.has(actionId);
        if (!accepted) {
          rejectedSlots += 1;
          continue;
        }
        const rootSlotIndex = contextSlotIndex(rootReference, actionId);
        const keys = resolvedKeys(slot);
        assertCaseKeysVisible(context, rootSlotIndex, keys, `${source.execution.id}:${actionId}`);
        allCases.push({
          actionId,
          caseId: "",
          contextHash: rootContextHash,
          slotIndex: rootSlotIndex,
          batchSize: rootReference.slots.length,
          category: "runtime-action",
          requiredCandidateKeys: keys,
          source: {
            catalogHash: typeof objectRecord(context.referenceCatalog)?.hash === "string"
              ? objectRecord(context.referenceCatalog)!.hash as string
              : "",
            worldHash: metadata.worldHash,
            algorithmManifestHash: metadata.algorithmManifestHash,
          },
          provenance: {
            sourceExecutionId: source.execution.id,
            sourceInvocationId: finalAttempt.invocationId,
            repairCount: finalAttempt.semanticRepairAttempt,
            rawOutputHash: auditByInvocation.get(finalAttempt.invocationId)?.rawOutputHash ?? undefined,
            normalizedOutputHash: auditByInvocation.get(finalAttempt.invocationId)?.normalizedOutputHash ?? undefined,
          },
        });
      }
    }
  }
  const deduplicated = new Map<string, LedgerActionCompilationExportCase>();
  for (const item of allCases) {
    const key = `${item.source.worldHash}:${item.actionId}`;
    const existing = deduplicated.get(key);
    if (existing && contentHash(existing) !== contentHash(item)) {
      throw new Error(`runtime action ${item.actionId} produced conflicting accepted outputs`);
    }
    deduplicated.set(key, item);
  }
  const cases = [...deduplicated.values()]
    .sort((left, right) => left.contextHash.localeCompare(right.contextHash) ||
      left.slotIndex - right.slotIndex || left.actionId.localeCompare(right.actionId))
    .map((item, index) => ({ ...item, caseId: `ac-c3-v${version}-${String(index + 1).padStart(6, "0")}` }));
  const contextRecords = [...contexts.values()].sort((left, right) => left.contextHash.localeCompare(right.contextHash));
  const stats = invocationStats(sources);
  return {
    cases,
    contexts: contextRecords,
    stats: {
      sourceExecutionIds: sources.map((source) => source.execution.id).sort(),
      ...stats,
      rootContexts,
      acceptedSlots: cases.length,
      rejectedSlots,
    },
    source: sourceFingerprint!,
  };
}
