import { z } from "zod";
import type { ModelExecutionAudit } from "../../contracts/model";
import { contentHash } from "../../models/model-audit";
import {
  ModelConfigurationError,
  ModelOutputError,
  ModelTransportError,
} from "../../models/model-provider";
import { ModelOverloadedError } from "../../models/model-scheduler";
import { structuredPromptBytes } from "../../prompts";

export interface EagerSlot<TPayload, TIssue> {
  key: string;
  payload: TPayload;
  issues: TIssue[];
}

export interface EagerSlotAttemptResult<TResult, TPayload, TIssue> {
  audit: ModelExecutionAudit;
  accepted: Array<{ key: string; result: TResult }>;
  rejected: Array<{ slot: EagerSlot<TPayload, TIssue>; issues: TIssue[] }>;
}

export interface EagerSlotBatchFailure<TPayload, TIssue> {
  slot: EagerSlot<TPayload, TIssue>;
  error: unknown;
  audit?: ModelExecutionAudit;
}

export interface EagerSlotBatchMetrics {
  submittedSlots: number;
  repairCalls: number;
  splitCount: number;
  partialFailureSlots: number;
  singletonFailures: number;
}

export interface EagerSlotBatchResult<TResult, TPayload, TIssue> {
  results: Map<string, TResult>;
  audits: ModelExecutionAudit[];
  failures: Array<EagerSlotBatchFailure<TPayload, TIssue>>;
  batchCount: number;
  metrics: EagerSlotBatchMetrics;
}

export class EagerSlotAttemptError extends Error {
  constructor(
    message: string,
    readonly audit: ModelExecutionAudit | undefined,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "EagerSlotAttemptError";
  }
}

export function eagerRequestBytes(
  system: string,
  userPrompt: string,
  context: unknown,
  schema: z.ZodType,
): number {
  return structuredPromptBytes({ system, userPrompt, context, schema }).requestUtf8Bytes;
}

export function partitionEagerSlots<TPayload, TIssue>(input: {
  slots: readonly EagerSlot<TPayload, TIssue>[];
  maxSlots: number;
  maxInputBytes: number;
  requestBytes(slots: readonly EagerSlot<TPayload, TIssue>[]): number;
  label: string;
}): Array<Array<EagerSlot<TPayload, TIssue>>> {
  const batches: Array<Array<EagerSlot<TPayload, TIssue>>> = [];
  let current: Array<EagerSlot<TPayload, TIssue>> = [];
  for (const slot of input.slots) {
    const proposed = [...current, slot];
    if (proposed.length <= input.maxSlots && input.requestBytes(proposed) <= input.maxInputBytes) {
      current = proposed;
      continue;
    }
    if (current.length === 0) {
      throw new ModelConfigurationError(
        `${input.label} slot ${slot.key} exceeds profile max_input_bytes ${input.maxInputBytes}`,
      );
    }
    batches.push(current);
    current = [slot];
    if (input.requestBytes(current) > input.maxInputBytes) {
      throw new ModelConfigurationError(
        `${input.label} slot ${slot.key} exceeds profile max_input_bytes ${input.maxInputBytes}`,
      );
    }
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

export function splitEagerSlots<TPayload, TIssue>(
  slots: readonly EagerSlot<TPayload, TIssue>[],
): [Array<EagerSlot<TPayload, TIssue>>, Array<EagerSlot<TPayload, TIssue>>] {
  const middle = Math.ceil(slots.length / 2);
  return [slots.slice(0, middle), slots.slice(middle)];
}

export function eagerSlotBatchOwner<TPayload, TIssue>(
  role: string,
  slots: readonly EagerSlot<TPayload, TIssue>[],
): string {
  return `${role}-slots-${contentHash(slots.map((slot) => slot.key)).slice("sha256:".length, 23)}`;
}

export function isTerminalEagerModelError(error: unknown): boolean {
  return error instanceof ModelConfigurationError || error instanceof ModelTransportError ||
    error instanceof ModelOverloadedError ||
    (error instanceof Error && error.name === "AbortError");
}

function errorAudit(error: unknown): ModelExecutionAudit | undefined {
  if (error instanceof EagerSlotAttemptError) return error.audit;
  if (error instanceof ModelOutputError) return error.audit;
  return undefined;
}

function mergeBatchResults<TResult, TPayload, TIssue>(
  entries: readonly EagerSlotBatchResult<TResult, TPayload, TIssue>[],
): EagerSlotBatchResult<TResult, TPayload, TIssue> {
  return {
    results: new Map(entries.flatMap((entry) => [...entry.results.entries()])),
    audits: entries.flatMap((entry) => entry.audits),
    failures: entries.flatMap((entry) => entry.failures),
    batchCount: entries.reduce((total, entry) => total + entry.batchCount, 0),
    metrics: {
      submittedSlots: entries.reduce((total, entry) => total + entry.metrics.submittedSlots, 0),
      repairCalls: entries.reduce((total, entry) => total + entry.metrics.repairCalls, 0),
      splitCount: entries.reduce((total, entry) => total + entry.metrics.splitCount, 0),
      partialFailureSlots: entries.reduce((total, entry) => total + entry.metrics.partialFailureSlots, 0),
      singletonFailures: entries.reduce((total, entry) => total + entry.metrics.singletonFailures, 0),
    },
  };
}

export async function runEagerSlotBatches<TPayload, TIssue, TResult>(input: {
  slots: readonly EagerSlot<TPayload, TIssue>[];
  maxSlots: number;
  maxInputBytes: number;
  requestBytes(slots: readonly EagerSlot<TPayload, TIssue>[]): number;
  invoke(
    slots: readonly EagerSlot<TPayload, TIssue>[],
    attempt: number,
  ): Promise<EagerSlotAttemptResult<TResult, TPayload, TIssue>>;
  issuesForError(error: unknown, slot: EagerSlot<TPayload, TIssue>): TIssue[];
  label: string;
  maxRepairs?: number;
}): Promise<EagerSlotBatchResult<TResult, TPayload, TIssue>> {
  const maxRepairs = input.maxRepairs ?? 2;
  if (!Number.isSafeInteger(maxRepairs) || maxRepairs < 0) {
    throw new RangeError("eager slot batch maxRepairs must be a non-negative integer");
  }
  const recover = async (
    sourceSlots: readonly EagerSlot<TPayload, TIssue>[],
  ): Promise<EagerSlotBatchResult<TResult, TPayload, TIssue>> => {
    const fitted = partitionEagerSlots({
      slots: sourceSlots,
      maxSlots: input.maxSlots,
      maxInputBytes: input.maxInputBytes,
      requestBytes: input.requestBytes,
      label: input.label,
    });
    if (fitted.length > 1) return mergeBatchResults(await Promise.all(fitted.map(recover)));

    let pending = fitted[0] ?? [];
    const results = new Map<string, TResult>();
    const audits: ModelExecutionAudit[] = [];
    let batchCount = 0;
    const metrics: EagerSlotBatchMetrics = {
      submittedSlots: 0,
      repairCalls: 0,
      splitCount: 0,
      partialFailureSlots: 0,
      singletonFailures: 0,
    };
    let lastAudit: ModelExecutionAudit | undefined;
    let lastError: unknown = new Error(`${input.label} failed without a model attempt`);
    for (let attempt = 0; attempt <= maxRepairs; attempt += 1) {
      if (pending.length === 0) break;
      const repairedFit = partitionEagerSlots({
        slots: pending,
        maxSlots: input.maxSlots,
        maxInputBytes: input.maxInputBytes,
        requestBytes: input.requestBytes,
        label: input.label,
      });
      if (repairedFit.length > 1) {
        const recovered = mergeBatchResults(await Promise.all(repairedFit.map(recover)));
        recovered.results.forEach((value, key) => results.set(key, value));
        return {
          results,
          audits: [...audits, ...recovered.audits],
          failures: recovered.failures,
          batchCount: batchCount + recovered.batchCount,
          metrics: {
            submittedSlots: metrics.submittedSlots + recovered.metrics.submittedSlots,
            repairCalls: metrics.repairCalls + recovered.metrics.repairCalls,
            splitCount: metrics.splitCount + recovered.metrics.splitCount + 1,
            partialFailureSlots: metrics.partialFailureSlots + recovered.metrics.partialFailureSlots,
            singletonFailures: metrics.singletonFailures + recovered.metrics.singletonFailures,
          },
        };
      }
      pending = repairedFit[0] ?? [];
      try {
        batchCount += 1;
        metrics.submittedSlots += pending.length;
        if (attempt > 0) metrics.repairCalls += 1;
        const attempted = await input.invoke(pending, attempt);
        audits.push(attempted.audit);
        lastAudit = attempted.audit;
        attempted.accepted.forEach((entry) => results.set(entry.key, entry.result));
        if (attempted.accepted.length > 0 && attempted.rejected.length > 0) {
          metrics.partialFailureSlots += attempted.rejected.length;
        }
        pending = attempted.rejected.map((entry) => ({
          ...entry.slot,
          issues: [...entry.issues],
        }));
        lastError = pending.length > 0
          ? new Error(`${input.label} rejected ${pending.length} slot(s): ${JSON.stringify(
              attempted.rejected.map((entry) => ({ key: entry.slot.key, issues: entry.issues })),
            )}`)
          : lastError;
      } catch (error) {
        if (isTerminalEagerModelError(error)) throw error;
        lastError = error;
        const audit = errorAudit(error);
        if (audit) {
          audits.push(audit);
          lastAudit = audit;
        }
        pending = pending.map((slot) => ({
          ...slot,
          issues: input.issuesForError(error, slot),
        }));
      }
    }

    if (pending.length === 0) return { results, audits, failures: [], batchCount, metrics };
    if (pending.length === 1) {
      metrics.singletonFailures += 1;
      return {
        results,
        audits,
        failures: [{ slot: pending[0]!, error: lastError, audit: lastAudit }],
        batchCount,
        metrics,
      };
    }
    const recovered = mergeBatchResults(await Promise.all(splitEagerSlots(pending).map(recover)));
    recovered.results.forEach((value, key) => results.set(key, value));
    return {
      results,
      audits: [...audits, ...recovered.audits],
      failures: recovered.failures,
      batchCount: batchCount + recovered.batchCount,
      metrics: {
        submittedSlots: metrics.submittedSlots + recovered.metrics.submittedSlots,
        repairCalls: metrics.repairCalls + recovered.metrics.repairCalls,
        splitCount: metrics.splitCount + recovered.metrics.splitCount + 1,
        partialFailureSlots: metrics.partialFailureSlots + recovered.metrics.partialFailureSlots,
        singletonFailures: metrics.singletonFailures + recovered.metrics.singletonFailures,
      },
    };
  };

  const initial = partitionEagerSlots({
    slots: input.slots,
    maxSlots: input.maxSlots,
    maxInputBytes: input.maxInputBytes,
    requestBytes: input.requestBytes,
    label: input.label,
  });
  return mergeBatchResults(await Promise.all(initial.map(recover)));
}
