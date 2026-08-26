import { z } from "zod";
import {
  createModelProviderAdapter,
  type ModelAdapterResult,
  type ModelProviderAdapter,
} from "./model-adapter";
import type { ModelCatalog } from "./model-catalog";
import { canonicalize, contentHash, measureModelContext } from "./model-audit";
import type {
  ModelExecutionAudit,
  ModelInvocationAudit,
  ModelTransportAttemptAudit,
} from "./model";
import type {
  StructuredModelProvider,
  StructuredModelRequest,
  StructuredModelResult,
} from "./model-provider";
import {
  ModelConfigurationError,
  modelInvocationIdentity,
  ModelOutputError,
  ModelTransportError,
} from "./model-provider";
import {
  FairModelScheduler,
  ModelOverloadedError,
  ModelScheduledExecutionError,
} from "./model-scheduler";
import {
  NOOP_RUNTIME_OBSERVER,
  fullRuntimePayload,
  runtimeEventEmitter,
  serializeRuntimeError,
  type RuntimeCorrelation,
  type RuntimeObserver,
} from "./observability";

export interface ModelGatewayOptions {
  scheduler?: FairModelScheduler;
  adapters?: ReadonlyMap<string, ModelProviderAdapter>;
  maxTransportAttempts?: number;
  fetch?: typeof fetch;
  now?: () => number;
  random?: () => number;
  sleep?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
  observer?: RuntimeObserver;
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
  private readonly observer: RuntimeObserver;
  private readonly emittedContracts = new Set<string>();

  constructor(
    catalog: ModelCatalog,
    env: Readonly<Record<string, string | undefined>>,
    options: ModelGatewayOptions = {},
  ) {
    this.catalog = catalog;
    for (const [providerId, provider] of Object.entries(catalog.providers)) {
      const configuredAdapter = options.adapters?.get(providerId);
      const apiKey = env[provider.api_key_env]?.trim();
      if (!configuredAdapter && !apiKey) continue;
      const adapter = configuredAdapter ?? createModelProviderAdapter(provider, apiKey!, options.fetch);
      if (adapter.kind !== provider.kind) {
        throw new Error(`model provider adapter kind mismatch: ${providerId}`);
      }
      this.adapters.set(providerId, adapter);
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
    this.observer = options.observer ?? NOOP_RUNTIME_OBSERVER;
  }

  private requireAdapter(providerId: string): ModelProviderAdapter {
    const adapter = this.adapters.get(providerId);
    if (adapter) return adapter;
    const provider = this.catalog.provider(providerId);
    throw new ModelConfigurationError(`model provider ${providerId} requires ${provider.api_key_env}`);
  }

  availableProfileSummaries(role?: Parameters<ModelCatalog["profileSummaries"]>[0]) {
    return this.catalog.profileSummaries(role)
      .filter((profile) => this.adapters.has(profile.providerId));
  }

  assertProfilesAvailable(profileIds: readonly string[]): void {
    const providerIds = new Set(profileIds.map((profileId) =>
      this.catalog.profile(profileId).provider_id));
    for (const providerId of [...providerIds].sort()) this.requireAdapter(providerId);
  }

  async generateStructured<T>(request: StructuredModelRequest<T>): Promise<StructuredModelResult<T>> {
    if (!request.workloadId.trim() || !request.batchId.trim() || !request.subjectId.trim() ||
      !request.promptVersion.trim() || !request.schemaName.trim()) {
      throw new Error("structured model request identity is incomplete");
    }
    this.catalog.assertProfile(request.profileId, request.role);
    const profile = this.catalog.profile(request.profileId);
    const adapter = this.requireAdapter(profile.provider_id);
    const observer = request.observer ?? this.observer;
    const observe = runtimeEventEmitter(observer);
    const modelInvocation = request.modelInvocation ?? 1;
    const modelInvocationId = request.modelInvocationId ?? modelInvocationIdentity(
      request,
      request.role,
      request.subjectId,
      modelInvocation,
    ).modelInvocationId;
    const correlation: RuntimeCorrelation = {
      ...request.correlation,
      modelInvocationId,
      modelRole: request.role,
      modelSubject: request.subjectId,
      modelInvocation,
    };
    const normalizeStartedAt = this.now();
    const context = canonicalize(request.context);
    observe?.({
      event: "model.context.normalized",
      correlation,
      durationMs: Math.max(0, this.now() - normalizeStartedAt),
      hashes: { context: contentHash(context) },
    });
    const serializationStartedAt = this.now();
    const contextJson = JSON.stringify(context, null, 2);
    const schema = canonicalize(z.toJSONSchema(request.schema, { target: "draft-07" }));
    const contextAudit = measureModelContext(context, contextJson);
    const contractHash = contentHash({ system: request.system, schema });
    const requestDocument = {
      catalogHash: this.catalog.hash,
      workloadId: request.workloadId,
      batchId: request.batchId,
      role: request.role,
      subjectId: request.subjectId,
      profileId: request.profileId,
      profile,
      promptVersion: request.promptVersion,
      schemaName: request.schemaName,
      schema,
      system: request.system,
      context,
    };
    const requestHash = contentHash(requestDocument);
    const requestUtf8Bytes = Buffer.byteLength(JSON.stringify(requestDocument, null, 2), "utf8");
    observe?.({
      event: "model.context.serialized",
      correlation,
      durationMs: Math.max(0, this.now() - serializationStartedAt),
      measurements: {
        contextUtf8Bytes: contextAudit.utf8Bytes,
        requestUtf8Bytes,
      },
      counts: contextAudit.counts,
      hashes: { context: contentHash(context), request: requestHash, contract: contractHash },
      payload: fullRuntimePayload(observer, requestDocument),
    });
    const contractEmissionKey = `${observer.mode}:${contractHash}`;
    if (observe && !this.emittedContracts.has(contractEmissionKey)) {
      this.emittedContracts.add(contractEmissionKey);
      observe({
        event: "model.contract.registered",
        correlation,
        hashes: { contract: contractHash },
        measurements: {
          systemUtf8Bytes: Buffer.byteLength(request.system, "utf8"),
          schemaUtf8Bytes: Buffer.byteLength(JSON.stringify(schema), "utf8"),
        },
        payload: fullRuntimePayload(observer, { system: request.system, schema }),
      });
    }
    observe?.({
      event: "model.invocation.started",
      correlation,
      attributes: {
        profileId: request.profileId,
        providerId: profile.provider_id,
        modelId: profile.model,
        promptVersion: request.promptVersion,
        schemaName: request.schemaName,
      },
      hashes: { request: requestHash, contract: contractHash },
      measurements: { requestUtf8Bytes, contextUtf8Bytes: contextAudit.utf8Bytes },
    });
    observer.flush?.();
    const transports: ModelTransportAttemptAudit[] = [];
    let transportAttempts = 0;

    while (transportAttempts < this.maxTransportAttempts) {
      transportAttempts += 1;
      let completedResult: ModelAdapterResult | undefined;
      const transportCorrelation = { ...correlation, transportAttempt: transportAttempts };
      observe?.({
        event: "model.queue.started",
        correlation: transportCorrelation,
        attributes: { providerId: profile.provider_id, modelId: profile.model },
      });
      try {
        const scheduled = await this.scheduler.schedule({
          providerId: profile.provider_id,
          workloadId: request.workloadId,
          abortSignal: request.abortSignal,
          execute: () => {
            observe?.({
              event: "model.transport.started",
              correlation: transportCorrelation,
              attributes: { providerId: profile.provider_id, modelId: profile.model },
            });
            return adapter.generate(profile, request, contextJson);
          },
        });
        transports.push({
          attempt: transportAttempts,
          queueWaitMs: scheduled.queueWaitMs,
          executionMs: scheduled.executionMs,
          retryDelayMs: 0,
          status: "succeeded",
          errorName: null,
          statusCode: null,
        });
        observe?.({
          event: "model.queue.completed",
          correlation: transportCorrelation,
          durationMs: scheduled.queueWaitMs,
          measurements: { queueWaitMs: scheduled.queueWaitMs },
        });
        observe?.({
          event: "model.transport.completed",
          correlation: transportCorrelation,
          durationMs: scheduled.executionMs,
          measurements: {
            queueWaitMs: scheduled.queueWaitMs,
            executionMs: scheduled.executionMs,
          },
          attributes: { status: "succeeded" },
        });
        completedResult = scheduled.value;
        const parseStartedAt = this.now();
        const output = request.schema.parse(scheduled.value.value);
        const responseJson = JSON.stringify(canonicalize(output));
        const responseHash = contentHash(output);
        const invocation: ModelInvocationAudit = {
          id: modelInvocationId,
          ordinal: modelInvocation,
          requestHash,
          responseHash,
          requestUtf8Bytes,
          responseUtf8Bytes: Buffer.byteLength(responseJson, "utf8"),
          context: contextAudit,
          transports,
          tokenUsage: scheduled.value.tokenUsage,
          finishReason: scheduled.value.finishReason,
          providerRequestId: scheduled.value.responseId || null,
          resultKind: null,
          semanticOutcome: "accepted",
          validationIssueCodes: [],
        };
        observe?.({
          event: "model.structured_output.parsed",
          correlation,
          durationMs: Math.max(0, this.now() - parseStartedAt),
          attributes: {
            finishReason: scheduled.value.finishReason,
            providerRequestId: scheduled.value.responseId || null,
          },
          measurements: {
            responseUtf8Bytes: invocation.responseUtf8Bytes,
            inputTokens: scheduled.value.tokenUsage.input,
            outputTokens: scheduled.value.tokenUsage.output,
            reasoningTokens: scheduled.value.tokenUsage.reasoning,
            cacheReadTokens: scheduled.value.tokenUsage.cacheRead,
            cacheWriteTokens: scheduled.value.tokenUsage.cacheWrite,
          },
          hashes: { request: requestHash, response: responseHash },
          payload: fullRuntimePayload(observer, output),
        });
        observe?.({
          event: "model.invocation.provider_completed",
          correlation,
          attributes: { result: "structured_output" },
          counts: { transportAttempts: transports.length },
          measurements: {
            queueWaitMs: transports.reduce((sum, attempt) => sum + attempt.queueWaitMs, 0),
            executionMs: transports.reduce((sum, attempt) => sum + attempt.executionMs, 0),
            retryDelayMs: transports.reduce((sum, attempt) => sum + attempt.retryDelayMs, 0),
          },
          hashes: { request: requestHash, response: responseHash },
        });
        observer.flush?.();
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
            invocations: [invocation],
          },
        };
      } catch (scheduledError) {
        let queueWaitMs = 0;
        let executionMs = 0;
        if (scheduledError instanceof ModelScheduledExecutionError) {
          queueWaitMs = scheduledError.queueWaitMs;
          executionMs = scheduledError.executionMs;
        }
        const error = unwrapScheduledError(scheduledError);
        const retryable = transportAttempts < this.maxTransportAttempts &&
          isRetryableTransportError(error, request.abortSignal);
        const transportCompleted = transports.some((attempt) =>
          attempt.attempt === transportAttempts && attempt.status === "succeeded");
        const transportAudit: ModelTransportAttemptAudit = transportCompleted
          ? transports.at(-1)!
          : {
              attempt: transportAttempts,
              queueWaitMs,
              executionMs,
              retryDelayMs: 0,
              status: retryable ? "retryable_error" : "failed",
              errorName: error instanceof Error ? error.name : "NonError",
              statusCode: statusCode(error) ?? null,
            };
        if (!transportCompleted) {
          transports.push(transportAudit);
          observe?.({
            event: scheduledError instanceof ModelScheduledExecutionError
              ? "model.queue.completed"
              : "model.queue.failed",
            level: scheduledError instanceof ModelScheduledExecutionError ? "info" : "warn",
            correlation: transportCorrelation,
            durationMs: queueWaitMs,
            measurements: { queueWaitMs },
            error: scheduledError instanceof ModelScheduledExecutionError
              ? undefined
              : serializeRuntimeError(error),
          });
          observe?.({
            event: "model.transport.failed",
            level: retryable ? "warn" : "error",
            correlation: transportCorrelation,
            durationMs: executionMs,
            attributes: { status: transportAudit.status },
            measurements: { queueWaitMs, executionMs },
            error: serializeRuntimeError(error),
          });
        }
        if (transportAttempts >= this.maxTransportAttempts ||
          !isRetryableTransportError(error, request.abortSignal)) {
          if (isOutputError(error)) {
            const invocation: ModelInvocationAudit = {
              id: modelInvocationId,
              ordinal: modelInvocation,
              requestHash,
              responseHash: completedResult ? contentHash(completedResult.value) : null,
              requestUtf8Bytes,
              responseUtf8Bytes: completedResult
                ? Buffer.byteLength(JSON.stringify(canonicalize(completedResult.value)), "utf8")
                : null,
              context: contextAudit,
              transports,
              tokenUsage: completedResult?.tokenUsage ?? {
                  input: null,
                  output: null,
                  reasoning: null,
                  cacheRead: null,
                  cacheWrite: null,
                },
              finishReason: completedResult?.finishReason ?? null,
              providerRequestId: completedResult?.responseId || null,
              resultKind: null,
              semanticOutcome: "rejected",
              validationIssueCodes: [error instanceof Error ? error.name : "model_output_error"],
            };
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
              invocations: [invocation],
            };
            observe?.({
              event: "model.structured_output.rejected",
              level: "warn",
              correlation,
              measurements: {
                responseUtf8Bytes: invocation.responseUtf8Bytes,
                inputTokens: invocation.tokenUsage.input,
                outputTokens: invocation.tokenUsage.output,
                reasoningTokens: invocation.tokenUsage.reasoning,
                cacheReadTokens: invocation.tokenUsage.cacheRead,
                cacheWriteTokens: invocation.tokenUsage.cacheWrite,
              },
              hashes: {
                request: requestHash,
                ...(invocation.responseHash ? { response: invocation.responseHash } : {}),
              },
              payload: completedResult
                ? fullRuntimePayload(observer, completedResult.value)
                : undefined,
              error: serializeRuntimeError(error),
            });
            observe?.({
              event: "model.invocation.provider_completed",
              level: "warn",
              correlation,
              attributes: { result: "structured_output_rejected" },
              counts: { transportAttempts: transports.length },
              hashes: { request: requestHash },
            });
            observer.flush?.();
            throw new ModelOutputError(
              error instanceof Error ? error.message : String(error),
              audit,
              { cause: error },
            );
          }
          if (error instanceof ModelOverloadedError ||
            (error instanceof Error && error.name === "AbortError")) {
            observe?.({
              event: "model.invocation.failed",
              level: "error",
              correlation,
              attributes: { result: error instanceof ModelOverloadedError ? "overloaded" : "cancelled" },
              counts: { transportAttempts: transports.length },
              hashes: { request: requestHash },
              error: serializeRuntimeError(error),
            });
            observer.flush?.();
            throw error;
          }
          observe?.({
            event: "model.invocation.failed",
            level: "error",
            correlation,
            attributes: { result: "transport_failed" },
            counts: { transportAttempts: transports.length },
            hashes: { request: requestHash },
            error: serializeRuntimeError(error),
          });
          observer.flush?.();
          throw new ModelTransportError(
            error instanceof Error ? error.message : String(error),
            {
              cause: error,
              retriable: isRetryableTransportError(error, request.abortSignal),
              statusCode: statusCode(error) ?? null,
            },
          );
        }
        const serverDelay = retryAfterMs(error, this.now());
        const exponential = Math.min(10_000, 500 * 2 ** (transportAttempts - 1));
        const delayMs = serverDelay ?? Math.floor(this.random() * exponential);
        transportAudit.retryDelayMs = delayMs;
        observe?.({
          event: "model.transport.retry_wait",
          correlation: transportCorrelation,
          durationMs: delayMs,
          attributes: { source: serverDelay === undefined ? "backoff" : "retry-after" },
          measurements: { retryDelayMs: delayMs },
        });
        observer.flush?.();
        try {
          await this.sleep(delayMs, request.abortSignal);
        } catch (retryError) {
          const cancelled = retryError instanceof Error && retryError.name === "AbortError";
          observe?.({
            event: "model.transport.retry_wait.failed",
            level: "error",
            correlation: transportCorrelation,
            attributes: { result: cancelled ? "cancelled" : "failed" },
            error: serializeRuntimeError(retryError),
          });
          observe?.({
            event: "model.invocation.failed",
            level: "error",
            correlation,
            attributes: { result: cancelled ? "cancelled" : "retry_wait_failed" },
            counts: { transportAttempts: transports.length },
            hashes: { request: requestHash },
            error: serializeRuntimeError(retryError),
          });
          observer.flush?.();
          if (cancelled) throw retryError;
          throw new ModelTransportError(
            retryError instanceof Error ? retryError.message : String(retryError),
            { cause: retryError, retriable: false, statusCode: statusCode(retryError) ?? null },
          );
        }
      }
    }
    throw new Error("model transport attempts exhausted");
  }
}

export function createModelGateway(
  catalog: ModelCatalog,
  env: Readonly<Record<string, string | undefined>> = process.env,
  options: ModelGatewayOptions = {},
): ModelGateway {
  return new ModelGateway(catalog, env, options);
}
