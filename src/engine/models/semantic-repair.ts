import type { ModelExecutionAudit } from "../contracts/model";
import {
  combineModelExecutionAudits,
  ModelConfigurationError,
  ModelOutputError,
  ModelTransportError,
} from "./model-provider";
import type { ModelRole } from "./model-catalog";
import { ModelOverloadedError } from "./model-scheduler";
import { contentHash } from "./model-audit";

export type SemanticRepairScope = "slot" | "invocation" | "observer" | "component" | "step";

export type SemanticRepairIssueClass =
  | "structure"
  | "reference"
  | "mechanic"
  | "privacy"
  | "causal"
  | "semantic";

export interface SemanticRepairIssue {
  code: string;
  path: Array<string | number>;
  message: string;
  class: SemanticRepairIssueClass;
  /** Optional field-level evidence preserved from deterministic normalization. */
  originalValue?: unknown;
  allowedHandles?: readonly string[];
  targetIds?: string[];
}

export interface SemanticRepairFingerprintIssue {
  code: string;
  path: readonly (string | number)[];
  originalValue?: unknown;
}

/**
 * Identifies an equivalent deterministic failure without depending on prose,
 * provider wording, or attempt number. Contract changes deliberately produce
 * a new fingerprint so an obsolete repair history cannot suppress a new
 * protocol attempt.
 */
export function semanticRepairFingerprint(
  issues: readonly SemanticRepairFingerprintIssue[],
  contractVersion: string | number,
): string {
  return contentHash({
    contractVersion,
    issues: issues
      .map((issue) => ({
        code: issue.code,
        path: [...issue.path],
        originalValue: issue.originalValue === undefined ? null : structuredClone(issue.originalValue),
      }))
      .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))),
  });
}

export interface SemanticRepairContext {
  scope: SemanticRepairScope;
  targetIds: readonly string[];
  attempt: number;
  issues: readonly SemanticRepairIssue[];
}

export interface SemanticRepairLoopInput<T> {
  role: ModelRole;
  repairScope: SemanticRepairScope;
  targetIds: readonly string[];
  maxRepairs: number;
  invoke: (context: SemanticRepairContext) => Promise<{ value: T; audit: ModelExecutionAudit }>;
  validate?: (value: T, context: SemanticRepairContext) => void;
  classify?: (error: unknown) => SemanticRepairIssue[];
  onRejected?: (input: {
    context: SemanticRepairContext;
    issues: readonly SemanticRepairIssue[];
    audit?: ModelExecutionAudit;
    error: unknown;
  }) => void;
}

export interface SemanticRepairLoopResult<T> {
  value: T;
  audit: ModelExecutionAudit;
  attempts: number;
  repairs: number;
}

export class SemanticRepairExhaustedError extends Error {
  readonly audit?: ModelExecutionAudit;
  readonly issues: readonly SemanticRepairIssue[];
  readonly repairScope: SemanticRepairScope;
  readonly targetIds: readonly string[];

  constructor(input: {
    role: ModelRole;
    repairScope: SemanticRepairScope;
    targetIds: readonly string[];
    issues: readonly SemanticRepairIssue[];
    audit?: ModelExecutionAudit;
    cause?: unknown;
  }) {
    const message = input.issues.map((issue) => `${issue.code}: ${issue.message}`).join(" | ");
    super(`${input.role} semantic repair exhausted: ${message || "unknown semantic error"}`, {
      cause: input.cause,
    });
    this.name = "SemanticRepairExhaustedError";
    this.audit = input.audit ? structuredClone(input.audit) : undefined;
    this.issues = structuredClone(input.issues);
    this.repairScope = input.repairScope;
    this.targetIds = [...input.targetIds];
  }
}

function defaultIssues(error: unknown): SemanticRepairIssue[] {
  const message = error instanceof Error ? error.message : String(error);
  return [{ code: error instanceof Error ? error.name || "semantic_error" : "semantic_error", path: [], message, class: "semantic" }];
}

function isTerminal(error: unknown): boolean {
  return error instanceof ModelConfigurationError || error instanceof ModelTransportError ||
    error instanceof ModelOverloadedError || (error instanceof Error && error.name === "AbortError");
}

function markRejected(audit: ModelExecutionAudit, issues: readonly SemanticRepairIssue[]): void {
  const invocation = audit.invocations.at(-1);
  if (!invocation) return;
  invocation.outputDisposition = "rejected";
  invocation.issues = issues.map((issue) => ({
    code: issue.code,
    class: issue.class,
    path: [...issue.path],
    message: issue.message,
    ...(issue.originalValue !== undefined ? { originalValue: structuredClone(issue.originalValue) } : {}),
    ...(issue.allowedHandles ? { allowedHandles: [...issue.allowedHandles] } : {}),
    ...(issue.targetIds ? { targetIds: [...issue.targetIds] } : {}),
  }));
}

function combineAudits(audits: readonly ModelExecutionAudit[]): ModelExecutionAudit {
  if (audits.length === 1) return audits[0]!;
  return combineModelExecutionAudits(audits);
}

/**
 * Runs bounded semantic retries without deciding whether an exhausted result
 * should invalidate a component or the enclosing step. That disposition
 * belongs to the caller that owns the candidate contract.
 */
export async function runSemanticRepairLoop<T>(
  input: SemanticRepairLoopInput<T>,
): Promise<SemanticRepairLoopResult<T>> {
  if (!Number.isSafeInteger(input.maxRepairs) || input.maxRepairs < 0) {
    throw new RangeError("semantic repair maxRepairs must be a non-negative integer");
  }
  const audits: ModelExecutionAudit[] = [];
  let issues: SemanticRepairIssue[] = [];
  for (let attempt = 0; attempt <= input.maxRepairs; attempt += 1) {
    const context: SemanticRepairContext = {
      scope: input.repairScope,
      targetIds: [...input.targetIds],
      attempt,
      issues: structuredClone(issues),
    };
    let generatedAudit: ModelExecutionAudit | undefined;
    try {
      const generated = await input.invoke(context);
      generatedAudit = generated.audit;
      audits.push(generated.audit);
      input.validate?.(generated.value, context);
      if (attempt > 0) {
        const invocation = generated.audit.invocations.at(-1);
        if (invocation) invocation.outputDisposition = "llm-repaired";
      }
      return {
        value: generated.value,
        audit: combineAudits(audits),
        attempts: attempt + 1,
        repairs: attempt,
      };
    } catch (error) {
      if (isTerminal(error)) throw error;
      const audit = error instanceof ModelOutputError && error.audit
        ? error.audit
        : undefined;
      if (audit) audits.push(audit);
      issues = input.classify?.(error) ?? defaultIssues(error);
      // Providers already attach field-level semantic diagnostics to the
      // invocation audit. Preserve those paths instead of replacing them
      // with a generic ModelOutputError at the repair boundary.
      const detailedIssues = audit?.invocations.at(-1)?.issues;
      if (error instanceof ModelOutputError && detailedIssues && detailedIssues.length > 0) {
        issues = detailedIssues.map((issue) => ({
          code: issue.code,
          class: issue.class,
          path: [...issue.path],
          message: issue.message,
          ...(issue.originalValue !== undefined ? { originalValue: structuredClone(issue.originalValue) } : {}),
          ...(issue.allowedHandles ? { allowedHandles: [...issue.allowedHandles] } : {}),
          ...(issue.targetIds ? { targetIds: [...issue.targetIds] } : {}),
        }));
      }
      const rejectedAudit = audit ?? generatedAudit;
      if (rejectedAudit) markRejected(rejectedAudit, issues);
      input.onRejected?.({ context, issues, audit: rejectedAudit, error });
      if (attempt >= input.maxRepairs) {
        throw new SemanticRepairExhaustedError({
          role: input.role,
          repairScope: input.repairScope,
          targetIds: input.targetIds,
          issues,
          audit: audits.length > 0 ? combineAudits(audits) : undefined,
          cause: error,
        });
      }
    }
  }
  throw new Error("unreachable semantic repair loop");
}

export function semanticIssue(
  code: string,
  message: string,
  options: Pick<SemanticRepairIssue, "class" | "path" | "targetIds" | "originalValue" | "allowedHandles"> = { class: "semantic", path: [] },
): SemanticRepairIssue {
  return {
    code,
    message,
    class: options.class,
    path: [...options.path],
    ...(options.originalValue !== undefined ? { originalValue: structuredClone(options.originalValue) } : {}),
    ...(options.allowedHandles ? { allowedHandles: [...options.allowedHandles] } : {}),
    ...(options.targetIds ? { targetIds: [...options.targetIds] } : {}),
  };
}
