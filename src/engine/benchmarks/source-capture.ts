import { contentHash } from "../models/model-audit";
import type { RuntimeEvent, RuntimeObserver } from "../runtime/observability";
import { fullRuntimePayload } from "../runtime/observability";

export const BENCHMARK_SOURCE_CAPTURE_EVENT = "model.action_compilation.context.captured" as const;

export interface RawBenchmarkSource {
  sourceExecutionId: string;
  sourceInvocationId: string;
  logicalInvocationId?: string;
  role: string;
  slotIndices: number[];
  fullContext: Record<string, unknown>;
  stateSnapshot?: unknown;
  actionIds: string[];
  fullContextHash: string;
  modelContextHash?: string;
  shortlistHash?: string;
  algorithmManifestHash?: string;
  worldHash?: string;
  stateHash?: string;
  modelCatalogHash?: string;
  registrySnapshotHash?: string;
  modelId?: string;
  promptVersion?: string;
  profileId?: string;
  outputDisposition?: string;
  rawOutputHash?: string;
  normalizedOutputHash?: string;
  repairCount?: number;
}

export interface RegeneratedActionCompilationReference {
  fullContextHash: string;
  providerRequests: number;
  fullyValidated: true;
  slots: Array<{
    slotIndex: number;
    requiredCandidateKeys: string[];
    repairCount: number;
    rawOutputHash: string;
    normalizedOutputHash: string;
  }>;
}

export interface BenchmarkSourceAdapter<TCapture extends RawBenchmarkSource = RawBenchmarkSource, TReference = unknown> {
  readonly id: string;
  readonly role: string;
  captureLedgerEvidence(events: readonly RuntimeEvent[]): TCapture[];
  regenerateFullReference(source: TCapture): Promise<TReference>;
  validateReference(reference: TReference): void;
}

function hasSecret(value: unknown): boolean {
  return /authorization|api[_-]?key|cookie|bearer\s|x-api-key/iu.test(JSON.stringify(value));
}

export function assertSafeBenchmarkSource(value: unknown): void {
  if (hasSecret(value)) throw new Error("benchmark source contains a credential-like field");
}

export function emitActionCompilationFullContextCapture(
  observer: RuntimeObserver,
  source: Omit<RawBenchmarkSource, "fullContextHash"> & { fullContextHash?: string },
): RawBenchmarkSource {
  assertSafeBenchmarkSource(source.fullContext);
  const fullContextHash = source.fullContextHash ?? contentHash(source.fullContext);
  const captured = { ...source, fullContextHash };
  observer.emit({
    event: BENCHMARK_SOURCE_CAPTURE_EVENT,
    level: "debug",
    hashes: {
      fullContext: fullContextHash,
      ...(source.modelContextHash ? { modelContext: source.modelContextHash } : {}),
      ...(source.shortlistHash ? { shortlist: source.shortlistHash } : {}),
    },
    counts: { slots: source.slotIndices.length, actions: source.actionIds.length },
    payload: fullRuntimePayload(observer, captured),
  });
  return captured;
}

export function readActionCompilationCapturedSources(events: readonly RuntimeEvent[]): RawBenchmarkSource[] {
  const sources: RawBenchmarkSource[] = [];
  for (const event of events) {
    if (event.event !== BENCHMARK_SOURCE_CAPTURE_EVENT || !event.payload || typeof event.payload !== "object") continue;
    const payload = event.payload as RawBenchmarkSource;
    if (typeof payload.fullContextHash !== "string" || !payload.fullContext || typeof payload.fullContext !== "object") continue;
    assertSafeBenchmarkSource(payload);
    sources.push({
      ...payload,
      slotIndices: [...payload.slotIndices].sort((left, right) => left - right),
      actionIds: [...payload.actionIds].sort(),
    });
  }
  return sources.sort((left, right) => left.fullContextHash.localeCompare(right.fullContextHash) || left.sourceInvocationId.localeCompare(right.sourceInvocationId));
}

export function createActionCompilationSourceAdapter(
  regenerate: (source: RawBenchmarkSource) => Promise<unknown>,
  validate: (reference: unknown) => void,
): BenchmarkSourceAdapter {
  return {
    id: "action-compilation-fullcatalog",
    role: "action-compilation",
    captureLedgerEvidence: readActionCompilationCapturedSources,
    regenerateFullReference: regenerate,
    validateReference: validate,
  };
}
