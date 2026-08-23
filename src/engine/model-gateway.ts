import { z } from "zod";
import { createModelProviderAdapter, type ModelProviderAdapter } from "./model-adapter";
import type { ModelCatalog } from "./model-catalog";
import { canonicalize, contentHash } from "./model-audit";
import type { ModelExecutionAudit } from "./model";
import type {
  StructuredModelProvider,
  StructuredModelRequest,
  StructuredModelResult,
} from "./model-provider";
import { ModelOutputError, ModelTransportError } from "./model-provider";
import {
  FairModelScheduler,
  ModelOverloadedError,
  ModelScheduledExecutionError,
} from "./model-scheduler";

export interface ModelGatewayOptions {
  scheduler?: FairModelScheduler;
  maxTransportAttempts?: number;
  fetch?: typeof fetch;
  now?: () => number;
  random?: () => number;
  sleep?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
}

function defaultSleep(milliseconds: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(abortError());
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(done, milliseconds);
    function done(): void {
      signal?.removeEventListener("abort", aborted);
      resolve();
    }
    function aborted(): void {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", aborted);
      reject(abortError());
    }
    signal?.addEventListener("abort", aborted, { once: true });
  });
}

function abortError(): Error {
  const error = new Error("model request aborted");
  error.name = "AbortError";
  return error;
}

function statusCode(error: unknown): number | undefined {
  if (!error || typeof error !== "object") return undefined;
  const candidate = error as Record<string, unknown>;
  if (typeof candidate.statusCode === "number") return candidate.statusCode;
  if (typeof candidate.status === "number") return candidate.status;
  return statusCode(candidate.cause);
}

function responseHeaders(error: unknown): Record<string, string> | undefined {
  if (!error || typeof error !== "object") return undefined;
  const candidate = error as Record<string, unknown>;
  const headers = candidate.responseHeaders;
  if (headers && typeof headers === "object") return headers as Record<string, string>;
  return responseHeaders(candidate.cause);
}

function retryAfterMs(error: unknown, now: number): number | undefined {
  const headers = responseHeaders(error);
  const raw = headers && Object.entries(headers)
    .find(([key]) => key.toLowerCase() === "retry-after")?.[1];
  if (!raw) return undefined;
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1_000;
  const date = Date.parse(raw);
  if (Number.isFinite(date)) return Math.max(0, date - now);
  return undefined;
}

function isRetryableTransportError(error: unknown, signal?: AbortSignal): boolean {
  if (signal?.aborted || error instanceof ModelOverloadedError) return false;
  const code = statusCode(error);
  if (code !== undefined) return code === 408 || code === 429 || code >= 500;
  if (error instanceof z.ZodError || error instanceof SyntaxError) return false;
  const name = error instanceof Error ? error.name : "";
  return name === "APICallError" || name === "TypeError" || name === "TimeoutError" || name === "AbortError";
}

function isOutputError(error: unknown): boolean {
  if (error instanceof ModelOutputError || error instanceof z.ZodError || error instanceof SyntaxError) return true;
  const name = error instanceof Error ? error.name : "";
  return name === "NoOutputGeneratedError" || name === "NoObjectGeneratedError";
}

function unwrapScheduledError(error: unknown): unknown {
  return error instanceof ModelScheduledExecutionError ? error.cause : error;
}

export class ModelGateway implements StructuredModelProvider {
  readonly catalog: ModelCatalog;
  private readonly adapters = new Map<string, ModelProviderAdapter>();
  private readonly scheduler: FairModelScheduler;
  private readonly maxTransportAttempts: number;
  private readonly now: () => number;
  private readonly random: () => number;
  private readonly sleep: (milliseconds: number, signal?: AbortSignal) => Promise<void>;

  constructor(
    catalog: ModelCatalog,
    env: Readonly<Record<string, string | undefined>>,
    options: ModelGatewayOptions = {},
  ) {
    this.catalog = catalog;
    const keys = catalog.resolveApiKeys(env);
    for (const [providerId, provider] of Object.entries(catalog.providers)) {
      const apiKey = keys.get(providerId);
      if (!apiKey) throw new Error(`model provider ${providerId} has no resolved credential`);
      this.adapters.set(providerId, createModelProviderAdapter(provider, apiKey, options.fetch));
    }
    this.scheduler = options.scheduler ?? new FairModelScheduler({
      globalConcurrency: catalog.scheduler.global_concurrency,
      maxQueuedRequests: catalog.scheduler.max_queued_requests,
      queueTimeoutMs: catalog.scheduler.queue_timeout_ms,
      providerConcurrency: Object.fromEntries(
        Object.entries(catalog.providers).map(([id, provider]) => [id, provider.max_concurrency]),
      ),
    });
    this.maxTransportAttempts = options.maxTransportAttempts ?? 3;
    if (!Number.isSafeInteger(this.maxTransportAttempts) || this.maxTransportAttempts <= 0) {
      throw new Error("max transport attempts must be a positive integer");
    }
    this.now = options.now ?? Date.now;
    this.random = options.random ?? Math.random;
    this.sleep = options.sleep ?? defaultSleep;
  }

  async generateStructured<T>(request: StructuredModelRequest<T>): Promise<StructuredModelResult<T>> {
    if (!request.workloadId.trim() || !request.batchId.trim() || !request.subjectId.trim() ||
      !request.promptVersion.trim() || !request.schemaName.trim()) {
      throw new Error("structured model request identity is incomplete");
    }
    this.catalog.assertProfile(request.profileId, request.role);
    const profile = this.catalog.profile(request.profileId);
    const adapter = this.adapters.get(profile.provider_id);
    if (!adapter) throw new Error(`model provider adapter is missing: ${profile.provider_id}`);
    const context = canonicalize(request.context);
    const contextJson = JSON.stringify(context, null, 2);
    const requestHash = contentHash({
      catalogHash: this.catalog.hash,
      workloadId: request.workloadId,
      batchId: request.batchId,
      role: request.role,
      subjectId: request.subjectId,
      profileId: request.profileId,
      profile,
      promptVersion: request.promptVersion,
      schemaName: request.schemaName,
      schema: z.toJSONSchema(request.schema, { target: "draft-07" }),
      system: request.system,
      context,
    });
    let transportAttempts = 0;
    let queueWaitMs = 0;
    let executionMs = 0;

    while (transportAttempts < this.maxTransportAttempts) {
      transportAttempts += 1;
      try {
        const scheduled = await this.scheduler.schedule({
          providerId: profile.provider_id,
          workloadId: request.workloadId,
          abortSignal: request.abortSignal,
          execute: () => adapter.generate(profile, request, contextJson),
        });
        queueWaitMs += scheduled.queueWaitMs;
        executionMs += scheduled.executionMs;
        const output = request.schema.parse(scheduled.value.value);
        return {
          value: output,
          audit: {
            role: request.role,
            subjectId: request.subjectId,
            profileId: request.profileId,
            providerId: profile.provider_id,
            modelId: scheduled.value.responseModelId || profile.model,
            catalogSchemaVersion: this.catalog.schemaVersion,
            catalogHash: this.catalog.hash,
            promptVersion: request.promptVersion,
            inference: structuredClone(profile.inference),
            structuredOutputMode: adapter.structuredOutputMode,
            attempts: 1,
            transportAttempts,
            repairAttempts: 0,
            queueWaitMs,
            executionMs,
            tokenUsage: scheduled.value.tokenUsage,
            finishReasons: [scheduled.value.finishReason],
            providerRequestIds: scheduled.value.responseId ? [scheduled.value.responseId] : [],
            requestHashes: [requestHash],
            responseHashes: [contentHash(output)],
          },
        };
      } catch (scheduledError) {
        if (scheduledError instanceof ModelScheduledExecutionError) {
          queueWaitMs += scheduledError.queueWaitMs;
          executionMs += scheduledError.executionMs;
        }
        const error = unwrapScheduledError(scheduledError);
        if (transportAttempts >= this.maxTransportAttempts ||
          !isRetryableTransportError(error, request.abortSignal)) {
          if (isOutputError(error)) {
            const audit: ModelExecutionAudit = {
              role: request.role,
              subjectId: request.subjectId,
              profileId: request.profileId,
              providerId: profile.provider_id,
              modelId: profile.model,
              catalogSchemaVersion: this.catalog.schemaVersion,
              catalogHash: this.catalog.hash,
              promptVersion: request.promptVersion,
              inference: structuredClone(profile.inference),
              structuredOutputMode: adapter.structuredOutputMode,
              attempts: 1,
              transportAttempts,
              repairAttempts: 0,
              queueWaitMs,
              executionMs,
              tokenUsage: { input: null, output: null, reasoning: null, cacheRead: null, cacheWrite: null },
              finishReasons: [],
              providerRequestIds: [],
              requestHashes: [requestHash],
              responseHashes: [],
            };
            throw new ModelOutputError(
              error instanceof Error ? error.message : String(error),
              audit,
              { cause: error },
            );
          }
          if (error instanceof ModelOverloadedError ||
            (error instanceof Error && error.name === "AbortError")) throw error;
          throw new ModelTransportError(
            error instanceof Error ? error.message : String(error),
            { cause: error },
          );
        }
        const serverDelay = retryAfterMs(error, this.now());
        const exponential = Math.min(10_000, 500 * 2 ** (transportAttempts - 1));
        await this.sleep(serverDelay ?? Math.floor(this.random() * exponential), request.abortSignal);
      }
    }
    throw new Error("model transport attempts exhausted");
  }
}

export function createModelGateway(
  catalog: ModelCatalog,
  env: Readonly<Record<string, string | undefined>> = process.env,
): ModelGateway {
  return new ModelGateway(catalog, env);
}
