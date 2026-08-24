import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { WorldHost, WorldHostError } from "../../server/world-host";
import { WorldImportError } from "../../server/world-import";
import { contentHash } from "../../engine/model-audit";
import {
  fullRuntimePayload,
  runtimeEventEmitter,
  serializeRuntimeError,
  type RuntimeCorrelation,
  type RuntimeObserver,
  type RuntimeEventEmitter,
} from "../../engine/observability";

export function json(data: unknown, status = 200): NextResponse {
  return NextResponse.json(data, { status });
}

export function errorResponse(error: unknown): NextResponse {
  if (error instanceof WorldHostError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  if (error instanceof WorldImportError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  return NextResponse.json({ error: "服务器无法完成请求。" }, { status: 500 });
}

export async function readJson<T>(request: Request): Promise<T | undefined> {
  try {
    return await request.json() as T;
  } catch {
    return undefined;
  }
}

export interface HttpObservationScope {
  observer: RuntimeObserver;
  correlation: RuntimeCorrelation;
  startedAt: number;
  method: string;
  path: string;
  observe: RuntimeEventEmitter | undefined;
}

export function beginHttpRequest(request: Request): HttpObservationScope {
  const observer = WorldHost.observer();
  const observe = runtimeEventEmitter(observer);
  if (!observe) {
    return {
      observer,
      correlation: {},
      startedAt: 0,
      method: request.method,
      path: "",
      observe,
    };
  }
  const correlation = { requestId: randomUUID() };
  const url = new URL(request.url);
  const scope: HttpObservationScope = {
    observer,
    correlation,
    startedAt: Date.now(),
    method: request.method,
    path: url.pathname,
    observe,
  };
  scope.observe?.({
    event: "http.request.started",
    correlation,
    attributes: {
      method: request.method,
      path: url.pathname,
      contentType: request.headers.get("content-type"),
    },
    measurements: {
      declaredContentBytes: Number(request.headers.get("content-length")) || null,
    },
  });
  return scope;
}

export function observeHttpJsonBody(scope: HttpObservationScope, body: unknown): void {
  if (!scope.observe) return;
  const loggedBody = body ?? null;
  const serialized = JSON.stringify(loggedBody);
  scope.observe({
    event: "http.request.body",
    correlation: scope.correlation,
    attributes: { bodyKind: "json" },
    measurements: { bodyUtf8Bytes: Buffer.byteLength(serialized, "utf8") },
    hashes: { body: contentHash(loggedBody) },
    payload: fullRuntimePayload(scope.observer, loggedBody),
  });
}

export function observeHttpArchiveBody(
  scope: HttpObservationScope,
  input: { filename: string; size: number; hash: string; replace: boolean; expectedWorldId?: string },
): void {
  scope.observe?.({
    event: "http.request.body",
    correlation: scope.correlation,
    attributes: {
      bodyKind: "world_zip",
      filename: input.filename,
      replace: input.replace,
    },
    measurements: { bodyUtf8Bytes: input.size },
    hashes: { body: input.hash },
    payload: fullRuntimePayload(scope.observer, input),
  });
}

export async function completeHttpRequest(
  scope: HttpObservationScope,
  response: Response,
  measureBody = true,
): Promise<void> {
  if (!scope.observe) return;
  let responseBytes: number | null = null;
  if (measureBody) {
    try {
      responseBytes = (await response.clone().arrayBuffer()).byteLength;
    } catch {
      responseBytes = null;
    }
  }
  scope.observe({
    event: "http.request.completed",
    level: response.status >= 500 ? "error" : response.status >= 400 ? "warn" : "info",
    correlation: scope.correlation,
    durationMs: Math.max(0, Date.now() - scope.startedAt),
    attributes: {
      method: scope.method,
      path: scope.path,
      result: response.status >= 500 ? "server_error" : response.status >= 400 ? "client_error" : "success",
      status: response.status,
    },
    measurements: { responseUtf8Bytes: responseBytes },
  });
}

export function failHttpRequest(scope: HttpObservationScope, error: unknown): void {
  scope.observe?.({
    event: "http.request.failed",
    level: "error",
    correlation: scope.correlation,
    durationMs: Math.max(0, Date.now() - scope.startedAt),
    attributes: { method: scope.method, path: scope.path },
    error: serializeRuntimeError(error),
  });
}

export async function observedRoute(
  request: Request,
  handler: (scope: HttpObservationScope) => Response | Promise<Response>,
): Promise<Response> {
  const scope = beginHttpRequest(request);
  try {
    const response = await handler(scope);
    await completeHttpRequest(scope, response);
    return response;
  } catch (error) {
    failHttpRequest(scope, error);
    const response = errorResponse(error);
    await completeHttpRequest(scope, response);
    return response;
  }
}
