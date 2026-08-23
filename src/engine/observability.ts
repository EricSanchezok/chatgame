export const RUNTIME_EVENT_SCHEMA_VERSION = 1 as const;

export type RuntimeObservabilityMode = "off" | "metrics" | "full";
export type RuntimeEventLevel = "debug" | "info" | "warn" | "error";

export interface RuntimeCorrelation {
  requestId?: string;
  sessionId?: string;
  runId?: string;
  runAttempt?: number;
  stepAttemptId?: string;
  revision?: number;
  step?: number;
  modelInvocationId?: string;
  modelRole?: string;
  modelSubject?: string;
  modelInvocation?: number;
  transportAttempt?: number;
}

export interface RuntimeError {
  name: string;
  message: string;
  stack?: string;
  status?: number;
  cause?: RuntimeError;
}

export type RuntimeAttribute = string | number | boolean | null;

export interface RuntimeEventInput {
  event: string;
  level?: RuntimeEventLevel;
  correlation?: RuntimeCorrelation;
  durationMs?: number;
  attributes?: Readonly<Record<string, RuntimeAttribute>>;
  measurements?: Readonly<Record<string, number | null>>;
  counts?: Readonly<Record<string, number>>;
  hashes?: Readonly<Record<string, string>>;
  payload?: unknown;
  error?: RuntimeError;
}

export interface RuntimeEvent extends RuntimeEventInput {
  schemaVersion: typeof RUNTIME_EVENT_SCHEMA_VERSION;
  sequence: number;
  timestamp: string;
  level: RuntimeEventLevel;
}

export interface RuntimeObserver {
  readonly mode: RuntimeObservabilityMode;
  readonly degraded: boolean;
  emit(input: RuntimeEventInput): RuntimeEvent | undefined;
  close?(): void;
}

function numericStatus(value: unknown): number | undefined {
  if (!value || typeof value !== "object") return undefined;
  const candidate = value as { status?: unknown; statusCode?: unknown };
  if (typeof candidate.status === "number" && Number.isFinite(candidate.status)) {
    return candidate.status;
  }
  if (typeof candidate.statusCode === "number" && Number.isFinite(candidate.statusCode)) {
    return candidate.statusCode;
  }
  return undefined;
}

export function serializeRuntimeError(error: unknown, depth = 0): RuntimeError {
  if (!(error instanceof Error)) {
    return { name: "NonError", message: String(error) };
  }
  const serialized: RuntimeError = {
    name: error.name || "Error",
    message: error.message,
  };
  if (error.stack) serialized.stack = error.stack;
  const status = numericStatus(error);
  if (status !== undefined) serialized.status = status;
  const cause = (error as Error & { cause?: unknown }).cause;
  if (cause !== undefined && depth < 3) serialized.cause = serializeRuntimeError(cause, depth + 1);
  return serialized;
}

const sensitiveFieldNames = new Set([
  "accesstoken",
  "apikey",
  "auth",
  "authorization",
  "bearertoken",
  "clientsecret",
  "clienttoken",
  "cookie",
  "credential",
  "password",
  "privatekey",
  "proxyauthorization",
  "refreshtoken",
  "secret",
  "sessiontoken",
  "setcookie",
  "token",
  "xapikey",
]);

function redactRuntimeString(value: string): string {
  return value
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]")
    .replace(
      /\b(authorization|api[-_ ]?key|x[-_ ]?api[-_ ]?key|access[-_ ]?token|refresh[-_ ]?token|client[-_ ]?secret|password|cookie|set-cookie)\b(\s*[:=]\s*)([^\s,;]+)/gi,
      "$1$2[REDACTED]",
    );
}

export function redactRuntimePayload(value: unknown): unknown {
  if (typeof value === "string") return redactRuntimeString(value);
  if (Array.isArray(value)) return value.map(redactRuntimePayload);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, entry]) => {
    const normalized = key.toLowerCase().replace(/[^a-z]/g, "");
    return [key, sensitiveFieldNames.has(normalized) ? "[REDACTED]" : redactRuntimePayload(entry)];
  }));
}

export class NoopRuntimeObserver implements RuntimeObserver {
  readonly mode = "off" as const;
  readonly degraded = false;

  emit(): undefined {
    return undefined;
  }
}

export const NOOP_RUNTIME_OBSERVER: RuntimeObserver = new NoopRuntimeObserver();

export interface RecordingRuntimeObserverOptions {
  mode?: Exclude<RuntimeObservabilityMode, "off">;
  now?: () => Date;
}

export class RecordingRuntimeObserver implements RuntimeObserver {
  readonly mode: Exclude<RuntimeObservabilityMode, "off">;
  readonly degraded = false;
  readonly events: RuntimeEvent[] = [];
  serializedUtf8Bytes = 0;
  serializationMs = 0;
  private readonly now: () => Date;
  private sequence = 0;

  constructor(options: RecordingRuntimeObserverOptions = {}) {
    this.mode = options.mode ?? "metrics";
    this.now = options.now ?? (() => new Date());
  }

  emit(input: RuntimeEventInput): RuntimeEvent {
    const event = materializeRuntimeEvent(input, ++this.sequence, this.now(), this.mode);
    const startedAt = performance.now();
    try {
      this.serializedUtf8Bytes += Buffer.byteLength(JSON.stringify(event), "utf8") + 1;
    } finally {
      this.serializationMs += performance.now() - startedAt;
    }
    this.events.push(event);
    return event;
  }
}

export function fullRuntimePayload(observer: RuntimeObserver, payload: unknown): unknown {
  return observer.mode === "full" ? payload : undefined;
}

export function materializeRuntimeEvent(
  input: RuntimeEventInput,
  sequence: number,
  now: Date,
  mode: RuntimeObservabilityMode,
): RuntimeEvent {
  const event = redactRuntimePayload({
    ...input,
    schemaVersion: RUNTIME_EVENT_SCHEMA_VERSION,
    sequence,
    timestamp: now.toISOString(),
    level: input.level ?? "info",
  }) as RuntimeEvent;
  if (mode !== "full") delete event.payload;
  return event;
}

function emitRuntimeEvent(
  observer: RuntimeObserver | undefined,
  input: RuntimeEventInput,
): RuntimeEvent | undefined {
  if (!observer) return undefined;
  try {
    return observer.emit(input);
  } catch {
    return undefined;
  }
}

export type RuntimeEventEmitter = (input: RuntimeEventInput) => RuntimeEvent | undefined;

export function runtimeEventEmitter(
  observer: RuntimeObserver | undefined,
): RuntimeEventEmitter | undefined {
  if (!observer || observer.mode === "off") return undefined;
  return (input) => emitRuntimeEvent(observer, input);
}
