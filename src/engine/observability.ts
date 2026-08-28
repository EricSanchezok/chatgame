export const RUNTIME_EVENT_SCHEMA_VERSION = 2 as const;

export type RuntimeObservabilityMode = "off" | "metrics" | "full";
export type RuntimeEventLevel = "debug" | "info" | "warn" | "error";

export interface RuntimeCorrelation {
  executionId?: string;
  requestId?: string;
  instanceId?: string;
  advanceId?: string;
  advanceAttempt?: number;
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
  errors?: RuntimeError[];
}

export type RuntimeAttribute = string | number | boolean | null;

export interface RuntimeEventInput {
  event: string;
  traceId?: string;
  spanId?: string;
  parentSpanId?: string;
  links?: readonly { traceId: string; spanId: string }[];
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

export type AlgorithmTelemetryEventName =
  | "algorithm.agent_mind.repair_fallback"
  | "algorithm.grounding.global_fallback"
  | "algorithm.observation.references_normalized"
  | "algorithm.observation.batch_split"
  | "algorithm.observation.repair_fallback"
  | "algorithm.observation.global_projection_completed"
  | "algorithm.outcome.alternative_evidence_normalized";

export interface AlgorithmTelemetryEventInput extends Omit<
  RuntimeEventInput,
  "event" | "payload" | "measurements" | "hashes"
> {
  event: AlgorithmTelemetryEventName;
  payload?: never;
  measurements?: never;
  hashes?: never;
}

export interface AlgorithmInstrumentation {
  emit(input: AlgorithmTelemetryEventInput): RuntimeEvent | undefined;
}

export type EngineStableRuntimeEventInput = Omit<
  RuntimeEventInput,
  "event" | "payload" | "measurements" | "hashes" | "attributes" | "counts"
> & ({
  event: "algorithm.activation.completed";
  attributes: Readonly<{ phase: "bootstrap" | "step"; policy: string }>;
  counts: Readonly<{
    persistentAgents: number;
    eligibleAgents: number;
    activatedAgents: number;
    skippedAgents: number;
    reusedAgents: number;
    noopAgents: number;
    externalAgents: number;
  }>;
} | {
  event: "algorithm.candidate.completed";
  attributes: Readonly<{
    phase: "step";
    dependencyAnalysis: string;
    trigger: "manual" | "batch" | "realtime" | "participant_action";
  }>;
  counts: Readonly<{
    updatedAgents: number;
    observedAgents: number;
    actions: number;
    reactions: number;
    checks: number;
    randomResults: number;
    resolutionPlans: number;
    settledResolutionReceipts: number;
    deferredResolutionReceipts: number;
    mechanicInvocations: number;
    mechanicResults: number;
    outcomes: number;
    operations: number;
    events: number;
    observations: number;
    mindCommits: number;
    mindFallbacks: number;
    temporalPlans: number;
    activeActivities: number;
    activityTransitions: number;
    dueActivities: number;
    dueTimers: number;
    dueConditions: number;
    decisionPoints: number;
    temporalDeltaSeconds: number;
    dependencyNodes: number;
    dependencyEdges: number;
    dependencyComponents: number;
    maxDependencyComponent: number;
    globalDependencies: number;
    globalReadjudications: number;
    footprintCardinality: number;
    audienceCardinality: number;
  }>;
} | {
  event: "temporal.boundary.reason";
  attributes: Readonly<{ reasonKind: string }>;
  counts?: never;
} | {
  event: "temporal.activity.transition";
  attributes: Readonly<{ transitionKind: string }>;
  counts?: never;
} | {
  event: "resolution.outcome.recorded";
  attributes: Readonly<{ outcomeStatus: string }>;
  counts?: never;
} | {
  event: "resolution.operation.recorded";
  attributes: Readonly<{ operationKind: string }>;
  counts?: never;
});

const engineOwnedStableEvents: ReadonlySet<string> = new Set<EngineStableRuntimeEventInput["event"]>([
  "algorithm.activation.completed",
  "algorithm.candidate.completed",
  "temporal.boundary.reason",
  "temporal.activity.transition",
  "resolution.outcome.recorded",
  "resolution.operation.recorded",
]);

const engineStableTelemetryFields: Record<EngineStableRuntimeEventInput["event"], {
  attributes: readonly string[];
  counts: readonly string[];
}> = {
  "algorithm.activation.completed": {
    attributes: ["phase", "policy"],
    counts: [
      "persistentAgents",
      "eligibleAgents",
      "activatedAgents",
      "skippedAgents",
      "reusedAgents",
      "noopAgents",
      "externalAgents",
    ],
  },
  "algorithm.candidate.completed": {
    attributes: ["phase", "dependencyAnalysis", "trigger"],
    counts: [
      "updatedAgents",
      "observedAgents",
      "actions",
      "reactions",
      "checks",
      "randomResults",
      "resolutionPlans",
      "settledResolutionReceipts",
      "deferredResolutionReceipts",
      "mechanicInvocations",
      "mechanicResults",
      "outcomes",
      "operations",
      "events",
      "observations",
      "mindCommits",
      "mindFallbacks",
      "temporalPlans",
      "activeActivities",
      "activityTransitions",
      "dueActivities",
      "dueTimers",
      "dueConditions",
      "decisionPoints",
      "temporalDeltaSeconds",
      "dependencyNodes",
      "dependencyEdges",
      "dependencyComponents",
      "maxDependencyComponent",
      "globalDependencies",
      "globalReadjudications",
      "footprintCardinality",
      "audienceCardinality",
    ],
  },
  "temporal.boundary.reason": { attributes: ["reasonKind"], counts: [] },
  "temporal.activity.transition": { attributes: ["transitionKind"], counts: [] },
  "resolution.outcome.recorded": { attributes: ["outcomeStatus"], counts: [] },
  "resolution.operation.recorded": { attributes: ["operationKind"], counts: [] },
};

const algorithmTelemetryFields: Record<AlgorithmTelemetryEventName, {
  attributes: readonly string[];
  counts: readonly string[];
}> = {
  "algorithm.agent_mind.repair_fallback": {
    attributes: ["phase", "policy"],
    counts: ["mindFallbacks"],
  },
  "algorithm.grounding.global_fallback": {
    attributes: ["phase", "reasons"],
    counts: ["normalizedGroundingFields", "globalFallbacks"],
  },
  "algorithm.observation.references_normalized": {
    attributes: ["phase", "batch"],
    counts: [
      "droppedObservationEventReferences",
      "droppedObservationClaims",
      "droppedObservationIntroductions",
      "clearedObservationCanonicalBindings",
    ],
  },
  "algorithm.observation.batch_split": {
    attributes: ["phase", "batch"],
    counts: ["observationBatchSplits", "splitObserverSlots"],
  },
  "algorithm.observation.repair_fallback": {
    attributes: ["phase", "batch", "policy"],
    counts: ["observationFallbacks"],
  },
  "algorithm.observation.global_projection_completed": {
    attributes: ["phase", "reason"],
    counts: ["observations", "observationBatches", "dependencyComponents"],
  },
  "algorithm.outcome.alternative_evidence_normalized": {
    attributes: ["phase"],
    counts: ["droppedOutcomeAlternativeEvidenceReferences", "droppedOutcomeAlternatives"],
  },
};

function validateExactFields(
  actual: Readonly<Record<string, unknown>> | undefined,
  expected: readonly string[],
  label: string,
): void {
  const keys = Object.keys(actual ?? {}).sort();
  const required = [...expected].sort();
  if (keys.length !== required.length || keys.some((key, index) => key !== required[index])) {
    throw new Error(`${label} fields must be exactly: ${required.join(", ")}`);
  }
}

export function validateAlgorithmTelemetryEvent(input: RuntimeEventInput): asserts input is AlgorithmTelemetryEventInput {
  if (engineOwnedStableEvents.has(input.event)) {
    throw new Error(`stable runtime event is engine-owned: ${input.event}`);
  }
  const definition = algorithmTelemetryFields[input.event as AlgorithmTelemetryEventName];
  if (!definition) throw new Error(`unknown algorithm telemetry event: ${input.event}`);
  if (input.payload !== undefined || input.measurements !== undefined || input.hashes !== undefined) {
    throw new Error(`algorithm telemetry contains unsupported data: ${input.event}`);
  }
  validateExactFields(input.attributes, definition.attributes, `${input.event} attributes`);
  validateExactFields(input.counts, definition.counts, `${input.event} counts`);
}

function validateStableRuntimeEvent(input: RuntimeEventInput): void {
  if ((input.event.startsWith("algorithm.") || input.event.startsWith("temporal.") ||
    input.event.startsWith("resolution.")) &&
    !engineOwnedStableEvents.has(input.event) &&
    !(input.event in algorithmTelemetryFields)) {
    throw new Error(`unknown stable runtime event: ${input.event}`);
  }
  const engineDefinition = engineStableTelemetryFields[input.event as EngineStableRuntimeEventInput["event"]];
  if (engineDefinition) {
    if (input.payload !== undefined || input.measurements !== undefined || input.hashes !== undefined) {
      throw new Error(`stable engine telemetry contains unsupported data: ${input.event}`);
    }
    validateExactFields(input.attributes, engineDefinition.attributes, `${input.event} attributes`);
    validateExactFields(input.counts, engineDefinition.counts, `${input.event} counts`);
  }
  if (input.durationMs !== undefined && (!Number.isFinite(input.durationMs) || input.durationMs < 0)) {
    throw new Error(`runtime event duration must be a non-negative finite number: ${input.event}`);
  }
  for (const [key, value] of Object.entries(input.counts ?? {})) {
    if (!Number.isSafeInteger(value) || value < 0) throw new Error(`runtime count ${key} must be a non-negative integer`);
  }
  for (const [key, value] of Object.entries(input.measurements ?? {})) {
    if (value !== null && !Number.isFinite(value)) throw new Error(`runtime measurement ${key} must be finite or null`);
  }
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
  readonly critical?: boolean;
  emit(input: RuntimeEventInput): RuntimeEvent | undefined;
  flush?(): void;
  subscribe?(listener: RuntimeEventListener): () => void;
  snapshot?(): RuntimeEvent[];
  close?(): void;
}

export type RuntimeEventListener = (event: RuntimeEvent) => void;

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
  if (error instanceof AggregateError && depth < 3) {
    serialized.errors = error.errors.slice(0, 32).map((member) => serializeRuntimeError(member, depth + 1));
  }
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
  private readonly listeners = new Set<RuntimeEventListener>();
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
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // Diagnostic consumers cannot change runtime semantics.
      }
    }
    return event;
  }

  subscribe(listener: RuntimeEventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  snapshot(): RuntimeEvent[] {
    return structuredClone(this.events);
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
  validateStableRuntimeEvent(input);
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
  } catch (error) {
    if (observer.critical) throw error;
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
