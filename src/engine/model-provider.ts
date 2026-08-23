import type { z } from "zod";
import type { ModelCatalog } from "./model-catalog";
import type { ModelExecutionAudit } from "./model";

export interface ModelExecutionScope {
  workloadId: string;
  batchId: string;
  abortSignal?: AbortSignal;
}

export interface StructuredModelRequest<T> extends ModelExecutionScope {
  profileId: string;
  role: ModelExecutionAudit["role"];
  subjectId: string;
  promptVersion: string;
  schemaName: string;
  system: string;
  context: unknown;
  schema: z.ZodType<T>;
}

export interface StructuredModelResult<T> {
  value: T;
  audit: ModelExecutionAudit;
}

export class ModelOutputError extends Error {
  constructor(message: string, readonly audit?: ModelExecutionAudit, options?: ErrorOptions) {
    super(message, options);
    this.name = "ModelOutputError";
  }
}

export class ModelTransportError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ModelTransportError";
  }
}

export interface StructuredModelProvider {
  readonly catalog: ModelCatalog;
  generateStructured<T>(request: StructuredModelRequest<T>): Promise<StructuredModelResult<T>>;
}

function addNullable(left: number | null, right: number | null): number | null {
  if (left === null && right === null) return null;
  return (left ?? 0) + (right ?? 0);
}

export function combineModelExecutionAudits(
  audits: readonly ModelExecutionAudit[],
  repairAttempts: number,
): ModelExecutionAudit {
  const first = audits[0];
  if (!first) throw new Error("cannot combine an empty model audit list");
  for (const audit of audits.slice(1)) {
    if (audit.role !== first.role || audit.subjectId !== first.subjectId ||
      audit.profileId !== first.profileId || audit.providerId !== first.providerId ||
      audit.modelId !== first.modelId || audit.catalogHash !== first.catalogHash ||
      audit.promptVersion !== first.promptVersion ||
      JSON.stringify(audit.inference) !== JSON.stringify(first.inference)) {
      throw new Error("cannot combine model audits with different execution identities");
    }
  }
  return {
    ...structuredClone(first),
    attempts: audits.reduce((total, audit) => total + audit.attempts, 0),
    transportAttempts: audits.reduce((total, audit) => total + audit.transportAttempts, 0),
    repairAttempts,
    queueWaitMs: audits.reduce((total, audit) => total + audit.queueWaitMs, 0),
    executionMs: audits.reduce((total, audit) => total + audit.executionMs, 0),
    tokenUsage: audits.slice(1).reduce((usage, audit) => ({
      input: addNullable(usage.input, audit.tokenUsage.input),
      output: addNullable(usage.output, audit.tokenUsage.output),
      reasoning: addNullable(usage.reasoning, audit.tokenUsage.reasoning),
      cacheRead: addNullable(usage.cacheRead, audit.tokenUsage.cacheRead),
      cacheWrite: addNullable(usage.cacheWrite, audit.tokenUsage.cacheWrite),
    }), structuredClone(first.tokenUsage)),
    finishReasons: audits.flatMap((audit) => audit.finishReasons),
    providerRequestIds: audits.flatMap((audit) => audit.providerRequestIds),
    requestHashes: audits.flatMap((audit) => audit.requestHashes),
    responseHashes: audits.flatMap((audit) => audit.responseHashes),
  };
}
