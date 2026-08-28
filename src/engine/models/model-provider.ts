import type { z } from "zod";
import type { ModelCatalog, ModelProfileSummary, ModelRole } from "./model-catalog";
import type {
  ModelExecutionAudit,
  ModelInvocationAudit,
  ModelTokenUsage,
} from "../contracts/model";
import type { RuntimeCorrelation, RuntimeObserver } from "../runtime/observability";
import type { ModelRegistryStatus } from "./model-registry";
import { runtimeId } from "../runtime/runtime-id";

export interface ModelExecutionScope {
  workloadId: string;
  batchId: string;
  abortSignal?: AbortSignal;
  correlation?: RuntimeCorrelation;
  observer?: RuntimeObserver;
  runtimeIdentity?: { worldHash: string; revision: number };
  /** Pins benchmark/replay work to one immutable historical registry snapshot. */
  modelRegistrySnapshotHash?: string;
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

export interface ModelTransportErrorOptions extends ErrorOptions {
  retriable?: boolean;
  statusCode?: number | null;
}

export class ModelTransportError extends Error {
  readonly retriable: boolean;
  readonly statusCode: number | null;

  constructor(message: string, options: ModelTransportErrorOptions = {}) {
    super(message, { cause: options.cause });
    this.name = "ModelTransportError";
    this.retriable = options.retriable ?? false;
    this.statusCode = options.statusCode ?? null;
  }
}

export class ModelConfigurationError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ModelConfigurationError";
  }
}

export interface ModelSemanticRepairErrorOptions extends ErrorOptions {
  audit?: ModelExecutionAudit;
}

export class ModelSemanticRepairError extends Error {
  readonly audit?: ModelExecutionAudit;

  constructor(readonly role: ModelRole, message: string, options: ModelSemanticRepairErrorOptions = {}) {
    super(message, { cause: options.cause });
    this.name = "ModelSemanticRepairError";
    this.audit = options.audit ? structuredClone(options.audit) : undefined;
  }
}

export interface StructuredModelProvider {
  readonly catalog: ModelCatalog;
  availableProfileSummaries(role?: ModelRole): ModelProfileSummary[];
  assertProfilesAvailable(profileIds: readonly string[]): Promise<void>;
  generateStructured<T>(request: StructuredModelRequest<T>): Promise<StructuredModelResult<T>>;
  modelRegistryDiagnostics?(): Promise<ModelRegistryDiagnostics>;
  refreshModelRegistry?(): Promise<ModelRegistryRefreshDiagnostics>;
}

export interface ModelRegistryAccountDiagnostic {
  id: string;
  channel: import("./model-catalog").ModelAccountChannel;
  region: string;
  protocol: import("./model-catalog").ModelProtocol;
  credentialConfigured: boolean;
}

export interface ModelRegistryProfileDiagnostic {
  id: string;
  accountId: string;
  credentialConfigured: boolean;
  resolvedModelId: string | null;
  modelMetadataHash: string | null;
  structuredOutputMode: ModelExecutionAudit["structuredOutputMode"] | null;
  resolutionError: string | null;
}

export interface ModelRegistryDiagnostics {
  catalog: { schemaVersion: 3; hash: string };
  registry: ModelRegistryStatus;
  accounts: ModelRegistryAccountDiagnostic[];
  profiles: ModelRegistryProfileDiagnostic[];
}

export interface ModelRegistryRefreshDiagnostics {
  outcome: import("./model-registry").ModelRegistryRefreshOutcome;
  checkedAt: string;
  error: string | null;
  diagnostics: ModelRegistryDiagnostics;
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
      audit.accountId !== first.accountId || audit.accountChannel !== first.accountChannel ||
      audit.protocol !== first.protocol || audit.dialect !== first.dialect ||
      audit.modelId !== first.modelId || audit.catalogHash !== first.catalogHash ||
      audit.registrySnapshotHash !== first.registrySnapshotHash ||
      audit.modelMetadataHash !== first.modelMetadataHash ||
      audit.catalogSchemaVersion !== first.catalogSchemaVersion ||
      audit.promptVersion !== first.promptVersion ||
      audit.structuredOutputMode !== first.structuredOutputMode ||
      JSON.stringify(audit.selector) !== JSON.stringify(first.selector) ||
      JSON.stringify(audit.requestedInference) !== JSON.stringify(first.requestedInference) ||
      JSON.stringify(audit.resolvedInference) !== JSON.stringify(first.resolvedInference)) {
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
  if (!scope.runtimeIdentity) {
    throw new ModelConfigurationError("canonical model invocation identity requires worldHash and revision");
  }
  const { worldHash, revision } = scope.runtimeIdentity;
  return {
    modelInvocationId: runtimeId({
      worldHash,
      revision,
      kind: "model-audit",
      stage: role,
      // workloadId/batchId are transport correlation (often instance/advance UUIDs),
      // never persisted identity coordinates. A retry of the same semantic
      // model stage must receive the same engine-owned id.
      owner: subjectId,
      round: 0,
      ordinal,
    }),
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
