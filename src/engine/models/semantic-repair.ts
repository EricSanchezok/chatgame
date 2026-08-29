import type { ModelExecutionAudit } from "../contracts/model";
import {
  combineModelExecutionAudits,
  ModelConfigurationError,
  ModelOutputError,
  ModelTransportError,
} from "./model-provider";
import type { ModelRole } from "./model-catalog";
import { ModelOverloadedError } from "./model-scheduler";

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
  targetIds?: string[];
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
  invocation.semanticOutcome = "rejected";
  invocation.validationIssueCodes = [...new Set(issues.map((issue) => issue.code))];
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
    try {
      const generated = await input.invoke(context);
      audits.push(generated.audit);
      input.validate?.(generated.value, context);
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
      if (audit) markRejected(audit, issues);
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
  options: Pick<SemanticRepairIssue, "class" | "path" | "targetIds"> = { class: "semantic", path: [] },
): SemanticRepairIssue {
  return { code, message, class: options.class, path: [...options.path], ...(options.targetIds ? { targetIds: [...options.targetIds] } : {}) };
}
