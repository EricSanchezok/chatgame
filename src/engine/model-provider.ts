import type { z } from "zod";
import type { ModelCatalog } from "./model-catalog";
import type {
  ModelExecutionAudit,
  ModelInvocationAudit,
  ModelTokenUsage,
} from "./model";
import type { RuntimeCorrelation, RuntimeObserver } from "./observability";

export interface ModelExecutionScope {
  workloadId: string;
  batchId: string;
  abortSignal?: AbortSignal;
  correlation?: RuntimeCorrelation;
  observer?: RuntimeObserver;
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
  modelInvocationId?: string;
  modelInvocation?: number;
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
): ModelExecutionAudit {
  const first = audits[0];
  if (!first) throw new Error("cannot combine an empty model audit list");
  for (const audit of audits.slice(1)) {
    if (audit.role !== first.role || audit.subjectId !== first.subjectId ||
      audit.profileId !== first.profileId || audit.providerId !== first.providerId ||
      audit.modelId !== first.modelId || audit.catalogHash !== first.catalogHash ||
      audit.catalogSchemaVersion !== first.catalogSchemaVersion ||
      audit.promptVersion !== first.promptVersion ||
      audit.structuredOutputMode !== first.structuredOutputMode ||
      JSON.stringify(audit.inference) !== JSON.stringify(first.inference)) {
      throw new Error("cannot combine model audits with different execution identities");
    }
  }
  return {
    ...structuredClone(first),
    invocations: audits.flatMap((audit) => structuredClone(audit.invocations)),
  };
}

export interface ModelExecutionSummary {
  invocations: number;
  transportAttempts: number;
  repairAttempts: number;
  queueWaitMs: number;
  executionMs: number;
  retryDelayMs: number;
  tokenUsage: ModelTokenUsage;
}

export function summarizeModelExecutionAudit(audit: ModelExecutionAudit): ModelExecutionSummary {
  const invocations = audit.invocations;
  const emptyUsage: ModelTokenUsage = {
    input: null,
    output: null,
    reasoning: null,
    cacheRead: null,
    cacheWrite: null,
  };
  return {
    invocations: invocations.length,
    transportAttempts: invocations.reduce((sum, invocation) => sum + invocation.transports.length, 0),
    repairAttempts: invocations.filter((invocation) => invocation.semanticOutcome === "rejected").length,
    queueWaitMs: invocations.flatMap((invocation) => invocation.transports)
      .reduce((sum, attempt) => sum + attempt.queueWaitMs, 0),
    executionMs: invocations.flatMap((invocation) => invocation.transports)
      .reduce((sum, attempt) => sum + attempt.executionMs, 0),
    retryDelayMs: invocations.flatMap((invocation) => invocation.transports)
      .reduce((sum, attempt) => sum + attempt.retryDelayMs, 0),
    tokenUsage: invocations.reduce((usage, invocation) => ({
      input: addNullable(usage.input, invocation.tokenUsage.input),
      output: addNullable(usage.output, invocation.tokenUsage.output),
      reasoning: addNullable(usage.reasoning, invocation.tokenUsage.reasoning),
      cacheRead: addNullable(usage.cacheRead, invocation.tokenUsage.cacheRead),
      cacheWrite: addNullable(usage.cacheWrite, invocation.tokenUsage.cacheWrite),
    }), emptyUsage),
  };
}

export function setModelInvocationOutcome(
  audit: ModelExecutionAudit,
  outcome: ModelInvocationAudit["semanticOutcome"],
  validationIssueCodes: readonly string[] = [],
): void {
  const invocation = audit.invocations.at(-1);
  if (!invocation) throw new Error("model audit has no invocation to classify");
  invocation.semanticOutcome = outcome;
  invocation.validationIssueCodes = [...new Set(validationIssueCodes)];
}

export function setModelInvocationResultKind(
  audit: ModelExecutionAudit,
  resultKind: string,
): void {
  const invocation = audit.invocations.at(-1);
  if (!invocation) throw new Error("model audit has no invocation to classify");
  invocation.resultKind = resultKind;
}

export function modelInvocationIdentity(
  scope: ModelExecutionScope,
  role: ModelExecutionAudit["role"],
  subjectId: string,
  ordinal: number,
): { modelInvocationId: string; modelInvocation: number } {
  const prefix = scope.correlation?.stepAttemptId ?? `${scope.workloadId}:${scope.batchId}`;
  return {
    modelInvocationId: `${prefix}:${role}:${subjectId}:${ordinal}`,
    modelInvocation: ordinal,
  };
}

export function modelInvocationCorrelation(
  scope: ModelExecutionScope,
  role: ModelExecutionAudit["role"],
  subjectId: string,
  identity?: { modelInvocationId?: string; modelInvocation?: number },
): RuntimeCorrelation {
  return {
    ...scope.correlation,
    modelInvocationId: identity?.modelInvocationId,
    modelRole: role,
    modelSubject: subjectId,
    modelInvocation: identity?.modelInvocation,
  };
}
