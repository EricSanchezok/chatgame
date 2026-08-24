import { z } from "zod";
import {
  ModelConfigurationError,
  ModelOutputError,
  ModelSemanticRepairError,
  ModelTransportError,
} from "../engine/model-provider";
import {
  ModelOverloadedError,
  ModelScheduledExecutionError,
} from "../engine/model-scheduler";
import { TransitionValidationError } from "../engine/transaction";
import { WorldSessionConflictError } from "./world-session-store";

export type RunFailureKind = "cancelled" | "retriable" | "permanent";

export interface RunFailureClassification {
  kind: RunFailureKind;
  retriable: boolean;
  publicMessage: string;
}

const RETRIABLE_MESSAGE = "模型或世界推演暂时失败；当前步骤未提交，可从同一世界状态重试。";
const PERMANENT_MESSAGE = "世界状态或运行配置无效；当前步骤未提交，请放弃此目标后检查配置或世界包。";

const permanentHttpStatuses = new Set([400, 401, 403, 404, 422]);
const transientErrorNames = new Set(["APICallError", "FetchError", "NetworkError", "TimeoutError"]);
const transientErrorCodes = new Set([
  "ECONNABORTED",
  "ECONNREFUSED",
  "ECONNRESET",
  "EAI_AGAIN",
  "ENETDOWN",
  "ENETRESET",
  "ENETUNREACH",
  "ETIMEDOUT",
  "SQLITE_BUSY",
  "SQLITE_LOCKED",
  "SQLITE_PROTOCOL",
]);

function property(error: unknown, key: string): unknown {
  return error && typeof error === "object" ? (error as Record<string, unknown>)[key] : undefined;
}

function numericStatus(error: unknown): number | undefined {
  const statusCode = property(error, "statusCode");
  if (typeof statusCode === "number" && Number.isSafeInteger(statusCode)) return statusCode;
  const status = property(error, "status");
  return typeof status === "number" && Number.isSafeInteger(status) ? status : undefined;
}

function errorCode(error: unknown): string | undefined {
  const code = property(error, "code");
  return typeof code === "string" ? code.toUpperCase() : undefined;
}

export function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function combine(dispositions: Array<RunFailureKind | undefined>): RunFailureKind | undefined {
  // Cancellation is control flow, not a competing failure severity. Once any
  // recursive branch observes AbortError, the whole attempt must cancel.
  if (dispositions.includes("cancelled")) return "cancelled";
  if (dispositions.includes("permanent")) return "permanent";
  if (dispositions.includes("retriable")) return "retriable";
  return undefined;
}

function localDisposition(error: unknown): RunFailureKind | undefined {
  if (isAbortError(error)) return "cancelled";
  if (error instanceof ModelConfigurationError || error instanceof TransitionValidationError ||
    error instanceof z.ZodError || (error instanceof Error && error.name === "LocalDatabaseInUseError")) {
    return "permanent";
  }
  if (error instanceof ModelOutputError || error instanceof ModelSemanticRepairError ||
    error instanceof ModelOverloadedError ||
    error instanceof WorldSessionConflictError) {
    return "retriable";
  }
  const status = numericStatus(error);
  if (status !== undefined) {
    if (permanentHttpStatuses.has(status)) return "permanent";
    if (status === 408 || status === 429 || status >= 500) return "retriable";
    return "permanent";
  }
  const code = errorCode(error);
  if (code && ([...transientErrorCodes].some((candidate) => code === candidate || code.startsWith(`${candidate}_`)))) {
    return "retriable";
  }
  if (error instanceof Error && transientErrorNames.has(error.name)) {
    return "retriable";
  }
  if (error instanceof ModelTransportError && error.retriable) return "retriable";
  return undefined;
}

function classify(
  error: unknown,
  seen: Set<object>,
): RunFailureKind | undefined {
  if (error && typeof error === "object") {
    if (seen.has(error)) return "permanent";
    seen.add(error);
  }

  // A model semantic repair boundary owns the malformed output beneath it. The
  // underlying validation error is not evidence that persisted state is corrupt.
  // Cancellation remains control flow even when a repair wrapper caught it.
  if (error instanceof ModelOutputError || error instanceof ModelSemanticRepairError) {
    const cause = property(error, "cause");
    return cause !== undefined && classify(cause, seen) === "cancelled" ? "cancelled" : "retriable";
  }

  if (error instanceof AggregateError) {
    const members = error.errors.map((member) => classify(member, seen) ?? "permanent");
    const cause = property(error, "cause");
    if (cause !== undefined) members.push(classify(cause, seen) ?? "permanent");
    return combine(members) ?? "permanent";
  }

  const own = localDisposition(error);
  const cause = error instanceof ModelScheduledExecutionError ? error.cause : property(error, "cause");
  const nested = cause === undefined ? undefined : classify(cause, seen);
  return combine([own, nested]);
}

export function classifyRunFailure(error: unknown): RunFailureClassification {
  const kind = classify(error, new Set()) ?? "permanent";
  return {
    kind,
    retriable: kind === "retriable",
    publicMessage: kind === "retriable" ? RETRIABLE_MESSAGE : PERMANENT_MESSAGE,
  };
}
