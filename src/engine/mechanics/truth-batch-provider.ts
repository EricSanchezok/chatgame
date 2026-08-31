import { z } from "zod";
import {
  causalVerificationBatchSchema,
  observationProjectionBatchSchema,
  resolutionPlanVerificationBatchSchema,
  truthResolutionBatchSchema,
  truthTransitionBatchSchema,
} from "../contracts/llm-schemas";
import {
  ContextLimitExceededError,
  ModelConfigurationError,
  ModelOutputError,
  ModelTransportError,
  type StructuredModelProvider,
  type StructuredModelRequest,
  type StructuredModelResult,
} from "../models/model-provider";
import { ModelOverloadedError } from "../models/model-scheduler";
import type { ModelProfileSummary, ModelRole } from "../models/model-catalog";
import { canonicalize, contentHash } from "../models/model-audit";
import { structuredPromptBytes } from "../prompts";

type BatchableSchemaName =
  | "truth_resolution_directive"
  | "resolution_plan_verification"
  | "truth_transition"
  | "causal_verification"
  | "observation_render";

type BatchSchema = z.ZodTypeAny;

interface PendingRequest {
  request: StructuredModelRequest<unknown>;
  key: string;
  resolve: (result: StructuredModelResult<unknown>) => void;
  reject: (error: unknown) => void;
}

interface SplitBatchEnvelope {
  contractVersion: number;
  roleContract: unknown;
  execution: unknown;
  task: Record<string, unknown> & {
    slots: Array<Record<string, unknown> & { slot: number; assignment: unknown; constraints: readonly string[] }>;
  };
  state: {
    slots: Array<{ slot: number; state: unknown }>;
  };
  referenceCatalog: {
    version: number;
    hash: string;
    candidates: readonly unknown[];
  };
  referenceCatalogs: Array<{ slot: number; catalog: unknown }>;
  repair: unknown;
}

const BATCH_PROMPT_SUFFIX = [
  "This is a fixed independent slot batch.",
  "Treat every slot as a separate task with the same complete shared context.",
  "For each numbered slot, use only referenceCatalogs[slot] when resolving handles; a handle from another slot is invalid even when its text matches.",
  "Do not infer, merge, omit, reorder, or transfer causes, actions, plans, proposals, events, observations, or identities between slots.",
  "Return exactly one result for every numbered slot and preserve the input slot numbers.",
].join(" ");

function batchSchemaFor(
  schemaName: string,
): { name: string; schema: BatchSchema } | null {
  switch (schemaName as BatchableSchemaName) {
    case "truth_resolution_directive":
      return {
        name: "truth_resolution_batch",
        schema: truthResolutionBatchSchema,
      };
    case "resolution_plan_verification":
      return {
        name: "resolution_plan_verification_batch",
        schema: resolutionPlanVerificationBatchSchema,
      };
    case "truth_transition":
      return {
        name: "truth_transition_batch",
        schema: truthTransitionBatchSchema,
      };
    case "causal_verification":
      return {
        name: "causal_verification_batch",
        schema: causalVerificationBatchSchema,
      };
    case "observation_render":
      return {
        name: "observation_projection_batch",
        schema: observationProjectionBatchSchema,
      };
    default:
      return null;
  }
}

function batchableRequest(request: StructuredModelRequest<unknown>): boolean {
  return (
    batchSchemaFor(request.schemaName) !== null &&
    !request.schemaName.endsWith("_batch")
  );
}

function contextBoundary(request: StructuredModelRequest<unknown>): string {
  const context = request.context as Record<string, unknown> | null;
  if (!context || typeof context !== "object" || Array.isArray(context))
    return "unknown";
  const execution = context.execution as Record<string, unknown> | undefined;
  const task = context.task as Record<string, unknown> | undefined;
  const state = context.state as Record<string, unknown> | undefined;
  const scope = task?.resolutionScope as
    Record<string, unknown> | null | undefined;
  const observationSlots = Array.isArray(state?.observationSlots)
    ? state.observationSlots
    : null;
  return contentHash({
    contractVersion: context.contractVersion ?? null,
    promptVersion: context.promptVersion ?? request.promptVersion,
    worldId: (execution?.worldId as string | undefined) ?? null,
    instanceId: execution?.instanceId ?? request.workloadId,
    advanceId: execution?.advanceId ?? request.batchId,
    baseRevision: state?.baseRevision ?? execution?.revision ?? null,
    step: state?.step ?? execution?.step ?? null,
    stage: task?.stage ?? request.schemaName,
    resolutionMode: scope?.mode ?? null,
    selectedActionRefs: scope?.selectedActionRefs ?? null,
    observerProjection: observationSlots ? "observation" : null,
  });
}

function repairBoundary(request: StructuredModelRequest<unknown>): string {
  const context = request.context as Record<string, unknown> | null;
  if (!context || typeof context !== "object" || Array.isArray(context))
    return "normal";
  const repair = context.repair as Record<string, unknown> | null | undefined;
  if (repair?.target) {
    const target = typeof repair.target === "string"
      ? repair.target
      : typeof repair.target === "object" && repair.target !== null && "proposalKey" in repair.target
        ? repair.target.proposalKey
        : JSON.stringify(repair.target);
    return `target:${target}`;
  }
  const issues = repair?.issues;
  return Array.isArray(issues) && issues.length > 0 ? "issues" : "normal";
}

function batchGroupKey(request: StructuredModelRequest<unknown>): string {
  return contentHash({
    profileId: request.profileId,
    role: request.role,
    schemaName: request.schemaName,
    promptVersion: request.promptVersion,
    system: request.system,
    userPrompt: request.userPrompt,
    boundary: contextBoundary(request),
    repair: repairBoundary(request),
    modelRegistrySnapshotHash: request.modelRegistrySnapshotHash ?? null,
    runtimeIdentity: request.runtimeIdentity ?? null,
  });
}

function splitSharedContext(requests: readonly PendingRequest[]): SplitBatchEnvelope {
  const contexts = requests.map((entry) => {
    const context = entry.request.context;
    if (!context || typeof context !== "object" || Array.isArray(context)) {
      throw new ModelOutputError(
        "truth batch requires an object context",
        undefined,
        { rawValue: context },
      );
    }
    return context as Record<string, unknown>;
  });
  const first = contexts[0]!;
  const taskValues = contexts.map((context) => {
    const task = context.task;
    if (!task || typeof task !== "object" || Array.isArray(task)) {
      throw new ModelOutputError("truth batch requires an envelope task", undefined, { rawValue: task });
    }
    return task as Record<string, unknown>;
  });
  const stateValues = contexts.map((context) => {
    const state = context.state;
    if (!state || typeof state !== "object" || Array.isArray(state)) {
      throw new ModelOutputError("truth batch requires an envelope state", undefined, { rawValue: state });
    }
    return state;
  });
  const commonTask: Record<string, unknown> = {};
  const taskKeys = [...new Set(taskValues.flatMap((task) => Object.keys(task)))].sort();
  for (const key of taskKeys) {
    if (key === "assignment" || key === "constraints") continue;
    const values = taskValues.map((task) => task[key]);
    const hashes = values.map((value) => contentHash(value === undefined ? null : canonicalize(value)));
    if (hashes.every((hash) => hash === hashes[0])) commonTask[key] = structuredClone(values[0]);
  }
  const catalogs = contexts.map((context, slot) => ({ slot, catalog: structuredClone(context.referenceCatalog) }));
  const repairs = contexts.map((context) => context.repair).filter((repair) => repair !== null && repair !== undefined);
  const referenceCatalog = { version: 1, hash: contentHash(catalogs), candidates: [] as readonly unknown[] };
  return {
    contractVersion: Number(first.contractVersion ?? 13),
    roleContract: structuredClone(first.roleContract),
    execution: structuredClone(first.execution),
    task: {
      assignment: { targetHandles: [], availableHandles: [], allowedProposalKinds: [] },
      constraints: [],
      ...commonTask,
      slots: taskValues.map((task, slot) => ({
        slot,
        assignment: structuredClone(task.assignment ?? {}),
        constraints: Array.isArray(task.constraints) ? [...task.constraints] : [],
        ...Object.fromEntries(Object.entries(task).filter(([key]) => key !== "assignment" && key !== "constraints")),
      })),
    },
    state: {
      slots: stateValues.map((state, slot) => ({ slot, state: structuredClone(state) })),
    },
    referenceCatalog,
    referenceCatalogs: catalogs,
    repair: repairs.length > 0
      ? { target: null, issues: repairs.flatMap((repair) => {
        const value = repair as { issues?: unknown[] };
        return Array.isArray(value.issues) ? value.issues : [];
      }) }
      : null,
  };
}

function ensureSlotCoverage(
  value: unknown,
  count: number,
  audit: StructuredModelResult<unknown>["audit"],
): Array<{ slot: number; result: unknown }> {
  const parsed = z
    .strictObject({
      slots: z.array(
        z.strictObject({
          slot: z.number().int().nonnegative(),
          result: z.unknown(),
        }),
      ),
    })
    .safeParse(value);
  if (!parsed.success) {
    throw new ModelOutputError(
      "truth batch response is not a structured slot envelope",
      audit,
      { cause: parsed.error, rawValue: value },
    );
  }
  const slots = parsed.data.slots;
  if (slots.length !== count) {
    throw new ModelOutputError(
      `truth batch response must contain exactly ${count} slots, received ${slots.length}`,
      audit,
      { rawValue: value },
    );
  }
  const seen = new Set<number>();
  for (const slot of slots) {
    if (slot.slot >= count || seen.has(slot.slot)) {
      throw new ModelOutputError(
        `truth batch response contains duplicate or unknown slot ${slot.slot}`,
        audit,
        { rawValue: value },
      );
    }
    seen.add(slot.slot);
  }
  if (seen.size !== count) {
    throw new ModelOutputError("truth batch response omitted a slot", audit, {
      rawValue: value,
    });
  }
  return slots.sort((left, right) => left.slot - right.slot);
}

function terminal(error: unknown): boolean {
  return (
    error instanceof ContextLimitExceededError ||
    error instanceof ModelConfigurationError ||
    error instanceof ModelTransportError ||
    error instanceof ModelOverloadedError ||
    (error instanceof Error && error.name === "AbortError")
  );
}

function batchPhase(
  schemaName: string,
):
  | "truth-resolution"
  | "truth-plan-verification"
  | "truth-transition"
  | "truth-causal-verification"
  | "observation" {
  if (schemaName === "truth_resolution_directive") return "truth-resolution";
  if (schemaName === "resolution_plan_verification")
    return "truth-plan-verification";
  if (schemaName === "truth_transition") return "truth-transition";
  if (schemaName === "causal_verification") return "truth-causal-verification";
  return "observation";
}

function emitBatchMetric(
  request: StructuredModelRequest<unknown>,
  phase: ReturnType<typeof batchPhase>,
  configuredMaxSlots: number,
  logicalSlots: number,
  repairCalls: number,
  batchSplits: number,
): void {
  request.observer?.emit({
    event: "algorithm.eager_reference.slot_batch_completed",
    attributes: { phase },
    counts: {
      configuredMaxSlots,
      logicalSlots,
      physicalCalls: 1,
      submittedSlots: logicalSlots,
      repairCalls,
      batchSplits,
      partialFailureSlots: 0,
      singletonFailures: 0,
    },
  });
}

/**
 * Coalesces independent Truth Engine provider calls into a typed slot envelope.
 * The logical callers still receive their original schema and therefore retain
 * all existing validation/materialization/repair behavior.
 */
export class TruthBatchCoordinator implements StructuredModelProvider {
  readonly catalog;
  private readonly pending: PendingRequest[] = [];
  private flushScheduled = false;

  constructor(
    private readonly inner: StructuredModelProvider,
    readonly maxSlots: number,
    private readonly structuralRetries = 2,
  ) {
    if (!Number.isSafeInteger(maxSlots) || maxSlots < 1 || maxSlots > 64) {
      throw new RangeError(
        "truthBatchMaxSlots must be an integer from 1 through 64",
      );
    }
    this.catalog = inner.catalog;
  }

  availableProfileSummaries(role?: ModelRole): ModelProfileSummary[] {
    return this.inner.availableProfileSummaries(role);
  }

  async assertProfilesAvailable(profileIds: readonly string[]): Promise<void> {
    return this.inner.assertProfilesAvailable(profileIds);
  }

  async modelRegistryDiagnostics() {
    if (!this.inner.modelRegistryDiagnostics)
      throw new Error("model registry diagnostics are unavailable");
    return this.inner.modelRegistryDiagnostics();
  }

  async refreshModelRegistry() {
    if (!this.inner.refreshModelRegistry)
      throw new Error("model registry refresh is unavailable");
    return this.inner.refreshModelRegistry();
  }

  generateStructured<T>(
    request: StructuredModelRequest<T>,
  ): Promise<StructuredModelResult<T>> {
    if (
      !batchableRequest(request as StructuredModelRequest<unknown>)
    ) {
      return this.inner.generateStructured(request);
    }
    return new Promise<StructuredModelResult<T>>((resolve, reject) => {
      this.pending.push({
        request: request as StructuredModelRequest<unknown>,
        key: request.subjectId,
        resolve: resolve as (result: StructuredModelResult<unknown>) => void,
        reject,
      });
      if (this.pending.length >= this.maxSlots) {
        void this.flush();
      } else if (!this.flushScheduled) {
        this.flushScheduled = true;
        queueMicrotask(() => {
          void this.flush();
        });
      }
    });
  }

  private async flush(): Promise<void> {
    this.flushScheduled = false;
    if (this.pending.length === 0) return;
    const entries = this.pending.splice(0);
    const groups = new Map<string, PendingRequest[]>();
    for (const entry of entries) {
      const group = groups.get(batchGroupKey(entry.request)) ?? [];
      group.push(entry);
      groups.set(batchGroupKey(entry.request), group);
    }
    await Promise.all(
      [...groups.values()].map(async (group) => {
        group.sort((left, right) => left.key.localeCompare(right.key));
        // Tail batches are independent physical work. Dispatch every fixed
        // chunk together so a four-batch stage has the latency of one wave,
        // while the provider's own scheduler remains the concurrency gate.
        await Promise.all(
          Array.from({ length: Math.ceil(group.length / this.maxSlots) }, (_, index) => {
            const batch = group.slice(index * this.maxSlots, (index + 1) * this.maxSlots);
            if (batch.length === 1) {
              return (async () => {
                try {
                  emitBatchMetric(
                    batch[0]!.request,
                    batchPhase(batch[0]!.request.schemaName),
                    this.maxSlots,
                    1,
                    repairBoundary(batch[0]!.request) === "normal" ? 0 : 1,
                    0,
                  );
                  batch[0]!.resolve(
                    await this.inner.generateStructured(batch[0]!.request),
                  );
                } catch (error) {
                  batch[0]!.reject(error);
                }
              })();
            }
            return this.executeBatch(batch, 0, "0");
          }),
        );
      }),
    );
    if (this.pending.length > 0) await this.flush();
  }

  private async executeBatch(
    entries: readonly PendingRequest[],
    attempt: number,
    splitPath: string,
  ): Promise<void> {
    // Once a malformed physical batch has been bisected to one logical slot,
    // send that slot through its original schema/context. There is no value
    // in wrapping a singleton in a batch envelope and retrying the same
    // structural failure again.
    if (entries.length === 1) {
      try {
        entries[0]!.resolve(await this.inner.generateStructured(entries[0]!.request));
      } catch (error) {
        entries[0]!.reject(error);
      }
      return;
    }
    const first = entries[0]!.request;
    const selected = batchSchemaFor(first.schemaName);
    if (!selected)
      throw new Error(`schema ${first.schemaName} is not batchable`);
    let context: SplitBatchEnvelope;
    try {
      context = splitSharedContext(entries);
    } catch (error) {
      entries.forEach((entry) => entry.reject(error));
      return;
    }
    const profile = this.catalog.profile(first.profileId);
    const promptVersion = `${first.promptVersion}:truth-slot-batch-v1`;
    const userPrompt = `${first.userPrompt}\n\n${BATCH_PROMPT_SUFFIX}`;
    const requestBytes = structuredPromptBytes({
      system: first.system,
      userPrompt,
      context,
      schema: selected.schema,
    }).requestUtf8Bytes;
    if (requestBytes > profile.max_input_bytes) {
      const error = new ContextLimitExceededError(
        `truth batch ${entries.map((entry) => entry.key).join(",")} uses ${requestBytes} bytes; ` +
          `profile max_input_bytes is ${profile.max_input_bytes}`,
      );
      // A batch can exceed the provider limit even when each logical slot is
      // individually valid: non-shared context is repeated once per slot.
      // Bisect deterministically until each physical request fits, preserving
      // the caller-visible slot results and avoiding a false terminal failure.
      if (entries.length > 1) {
        const midpoint = Math.ceil(entries.length / 2);
        await Promise.all([
          this.executeBatch(entries.slice(0, midpoint), attempt, `${splitPath}L`),
          this.executeBatch(entries.slice(midpoint), attempt, `${splitPath}R`),
        ]);
      } else {
        entries[0]!.reject(error);
      }
      return;
    }
    const owner = `truth-batch-${contentHash({
      role: first.role,
      schemaName: first.schemaName,
      profileId: first.profileId,
      runtimeIdentity: first.runtimeIdentity ?? null,
      modelRegistrySnapshotHash: first.modelRegistrySnapshotHash ?? null,
      keys: entries.map((entry) => entry.key).sort(),
      splitPath,
    }).slice(0, 16)}`;
    const ordinal =
      Math.max(...entries.map((entry) => entry.request.modelInvocation ?? 1)) +
      attempt;
    // The logical callers already computed canonical identities before they
    // entered this coordinator. Derive a physical identity from those source
    // identities and the canonical batch owner; this remains stable without
    // requiring runtimeIdentity to be present on the transport DTO.
    const modelInvocationId = `rt:model-audit:${contentHash({
      source: first.modelInvocationId ?? null,
      role: first.role,
      owner,
      ordinal,
      attempt,
      splitPath,
    })}`;
    const identity = {
      modelInvocationId,
      modelInvocation: ordinal,
    };
    try {
      emitBatchMetric(
        first,
        batchPhase(first.schemaName),
        this.maxSlots,
        entries.length,
        attempt > 0 || repairBoundary(first) !== "normal" ? 1 : 0,
        splitPath.length > 1 ? 1 : 0,
      );
      const generated = await this.inner.generateStructured({
        ...first,
        ...identity,
        role: first.role,
        subjectId: owner,
        promptVersion,
        schemaName: selected.name,
        userPrompt,
        context,
        schema: selected.schema,
      });
      const deliver = (
        value: unknown,
        audit: StructuredModelResult<unknown>["audit"],
      ): void => {
        const slotsForOutput = ensureSlotCoverage(value, entries.length, audit);
        const bySlot = new Map(
          slotsForOutput.map((entry) => [entry.slot, entry.result]),
        );
        for (const [index, entry] of entries.entries()) {
          const parsed = entry.request.schema.safeParse(bySlot.get(index));
          if (!parsed.success) {
            entry.reject(
              new ModelOutputError(
                `truth batch slot ${entry.key} returned an invalid ${entry.request.schemaName} result`,
                structuredClone(audit),
                { cause: parsed.error, rawValue: bySlot.get(index) },
              ),
            );
            continue;
          }
          // Callers classify and repair slots independently. Give each logical
          // slot an isolated audit view while retaining the physical invocation
          // ID so the execution ledger can deduplicate it back to one request.
          entry.resolve({ value: parsed.data, audit: structuredClone(audit) });
        }
      };
      try {
        deliver(generated.value, generated.audit);
      } catch (error) {
        if (attempt < this.structuralRetries) {
          await this.executeBatch(entries, attempt + 1, splitPath);
          return;
        }
        if (entries.length > 1) {
          const middle = Math.ceil(entries.length / 2);
          await Promise.all([
            this.executeBatch(entries.slice(0, middle), 0, `${splitPath}L`),
            this.executeBatch(entries.slice(middle), 0, `${splitPath}R`),
          ]);
          return;
        }
        if (entries.length === 1) {
          try {
            entries[0]!.resolve(await this.inner.generateStructured(entries[0]!.request));
          } catch (directError) {
            entries[0]!.reject(directError);
          }
        } else {
          entries[0]!.reject(error);
        }
        return;
      }
    } catch (error) {
      if (terminal(error)) {
        entries.forEach((entry) => entry.reject(error));
        return;
      }
      if (attempt < this.structuralRetries) {
        await this.executeBatch(entries, attempt + 1, splitPath);
        return;
      }
      if (entries.length > 1) {
        const middle = Math.ceil(entries.length / 2);
        await Promise.all([
          this.executeBatch(entries.slice(0, middle), 0, `${splitPath}L`),
          this.executeBatch(entries.slice(middle), 0, `${splitPath}R`),
        ]);
        return;
      }
      try {
        entries[0]!.resolve(await this.inner.generateStructured(entries[0]!.request));
      } catch (directError) {
        entries[0]!.reject(directError);
      }
    }
  }
}
