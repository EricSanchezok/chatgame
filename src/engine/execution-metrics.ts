import type { RuntimeAttribute, RuntimeEvent } from "./observability";

export type MetricAggregation = "sum" | "max" | "last" | "count";

export interface MetricDefinition {
  name: string;
  unit: "1" | "By" | "ms" | "s" | "token";
  aggregation: MetricAggregation;
  source: {
    field: "counts" | "measurements";
    key: string;
    eventNames?: readonly string[];
  } | { field: "event"; name: string };
  allowedDimensions: readonly string[];
}

export interface MetricPoint {
  name: string;
  value: number;
  unit: MetricDefinition["unit"];
  dimensions: Readonly<Record<string, RuntimeAttribute>>;
}

export interface ExecutionWorkSummary {
  spanCount: number;
  maxSpanDepth: number;
  criticalPathMs: number;
  totalSpanWorkMs: number;
  modelSpanCount: number;
  modelExecutionMs: number;
  modelQueueMs: number;
  modelRetryDelayMs: number;
  rollbackCount: number;
}

export function deriveExecutionWork(events: readonly RuntimeEvent[]): ExecutionWorkSummary {
  const spans = new Map<string, { parent?: string; durationMs: number; model: boolean }>();
  for (const event of events) {
    if (!event.spanId) continue;
    const current = spans.get(event.spanId) ?? {
      parent: event.parentSpanId,
      durationMs: 0,
      model: false,
    };
    current.parent ??= event.parentSpanId;
    current.durationMs = Math.max(current.durationMs, event.durationMs ?? 0);
    current.model ||= event.correlation?.modelInvocationId !== undefined;
    spans.set(event.spanId, current);
  }
  const depthMemo = new Map<string, number>();
  const pathMemo = new Map<string, number>();
  const visiting = new Set<string>();
  const depth = (spanId: string): number => {
    const cached = depthMemo.get(spanId);
    if (cached !== undefined) return cached;
    if (visiting.has(spanId)) return 1;
    visiting.add(spanId);
    const span = spans.get(spanId)!;
    const value = span.parent && spans.has(span.parent) ? depth(span.parent) + 1 : 1;
    visiting.delete(spanId);
    depthMemo.set(spanId, value);
    return value;
  };
  const pathWork = (spanId: string): number => {
    const cached = pathMemo.get(spanId);
    if (cached !== undefined) return cached;
    const span = spans.get(spanId)!;
    const value = span.durationMs + (span.parent && spans.has(span.parent) ? pathWork(span.parent) : 0);
    pathMemo.set(spanId, value);
    return value;
  };
  const values = [...spans.entries()];
  const measurementSum = (key: string, eventNames: readonly string[]): number => events.reduce((sum, event) =>
    sum + (eventNames.includes(event.event) ? event.measurements?.[key] ?? 0 : 0), 0);
  return {
    spanCount: spans.size,
    maxSpanDepth: values.length > 0 ? Math.max(...values.map(([id]) => depth(id))) : 0,
    criticalPathMs: values.length > 0 ? Math.max(...values.map(([id]) => pathWork(id))) : 0,
    totalSpanWorkMs: values.reduce((sum, [, span]) => sum + span.durationMs, 0),
    modelSpanCount: values.filter(([, span]) => span.model).length,
    modelExecutionMs: measurementSum("executionMs", ["model.transport.completed", "model.transport.failed"]),
    modelQueueMs: measurementSum("queueWaitMs", ["model.queue.completed", "model.queue.failed"]),
    modelRetryDelayMs: measurementSum("retryDelayMs", ["model.transport.retry_wait"]),
    rollbackCount: events.filter((event) => event.event.endsWith(".rolled_back")).length,
  };
}

const forbiddenDimensionPattern = /(agent|session|run|event|component|invocation).*id$/i;

export class MetricDefinitionRegistry {
  private readonly definitions = new Map<string, MetricDefinition>();

  register(definition: MetricDefinition): void {
    if (this.definitions.has(definition.name)) throw new Error(`metric is already registered: ${definition.name}`);
    for (const dimension of definition.allowedDimensions) {
      if (forbiddenDimensionPattern.test(dimension)) {
        throw new Error(`high-cardinality metric dimension is forbidden: ${dimension}`);
      }
    }
    this.definitions.set(definition.name, definition);
  }

  definition(name: string): MetricDefinition {
    const definition = this.definitions.get(name);
    if (!definition) throw new Error(`metric is not registered: ${name}`);
    return definition;
  }

  derive(events: readonly RuntimeEvent[]): MetricPoint[] {
    const points: MetricPoint[] = [];
    for (const definition of this.definitions.values()) {
      for (const event of events) {
        if (definition.source.field !== "event" && definition.source.eventNames &&
          !definition.source.eventNames.includes(event.event)) continue;
        const value = definition.source.field === "event"
          ? event.event === definition.source.name ? 1 : undefined
          : event[definition.source.field]?.[definition.source.key];
        if (value === undefined || value === null) continue;
        const dimensions = Object.fromEntries(definition.allowedDimensions.flatMap((dimension) => {
          const candidate = event.attributes?.[dimension];
          return candidate === undefined ? [] : [[dimension, candidate]];
        }));
        points.push({ name: definition.name, value, unit: definition.unit, dimensions });
      }
    }
    return points;
  }
}

const commonDimensions = ["phase", "policy", "providerId", "modelId", "status"] as const;

export const EXECUTION_METRICS = new MetricDefinitionRegistry();

function registerNumericFields(
  field: "counts" | "measurements",
  eventNames: readonly string[] | undefined,
  definitions: ReadonlyArray<readonly [string, string, MetricDefinition["unit"]]>,
): void {
  for (const [name, key, unit] of definitions) {
    EXECUTION_METRICS.register({
      name,
      unit,
      aggregation: "sum",
      source: { field, key, eventNames },
      allowedDimensions: commonDimensions,
    });
  }
}

registerNumericFields("counts", ["algorithm.activation.completed"], [
  ["lwe.agent.persistent", "persistentAgents", "1"],
  ["lwe.agent.eligible", "eligibleAgents", "1"],
  ["lwe.agent.activated", "activatedAgents", "1"],
  ["lwe.agent.skipped", "skippedAgents", "1"],
  ["lwe.agent.reused", "reusedAgents", "1"],
  ["lwe.agent.noop", "noopAgents", "1"],
  ["lwe.agent.external", "externalAgents", "1"],
]);

registerNumericFields("counts", ["algorithm.candidate.completed"], [
  ["lwe.agent.updated", "updatedAgents", "1"],
  ["lwe.agent.observed", "observedAgents", "1"],
  ["lwe.output.actions", "actions", "1"],
  ["lwe.output.reactions", "reactions", "1"],
  ["lwe.output.checks", "checks", "1"],
  ["lwe.output.random", "randomResults", "1"],
  ["lwe.output.resolution_plans", "resolutionPlans", "1"],
  ["lwe.output.resolution_receipts_settled", "settledResolutionReceipts", "1"],
  ["lwe.output.resolution_receipts_deferred", "deferredResolutionReceipts", "1"],
  ["lwe.output.mechanic_invocations", "mechanicInvocations", "1"],
  ["lwe.output.mechanic_results", "mechanicResults", "1"],
  ["lwe.output.outcomes", "outcomes", "1"],
  ["lwe.output.operations", "operations", "1"],
  ["lwe.output.events", "events", "1"],
  ["lwe.output.observations", "observations", "1"],
  ["lwe.output.mind_commits", "mindCommits", "1"],
  ["lwe.temporal.plans", "temporalPlans", "1"],
  ["lwe.temporal.active_activities", "activeActivities", "1"],
  ["lwe.temporal.activity_transitions", "activityTransitions", "1"],
  ["lwe.temporal.due_timers", "dueTimers", "1"],
  ["lwe.temporal.decision_points", "decisionPoints", "1"],
  ["lwe.temporal.delta", "temporalDeltaSeconds", "s"],
  ["lwe.agent.mind_fallbacks", "mindFallbacks", "1"],
  ["lwe.dependency.nodes", "dependencyNodes", "1"],
  ["lwe.dependency.edges", "dependencyEdges", "1"],
  ["lwe.dependency.components", "dependencyComponents", "1"],
  ["lwe.dependency.max_component", "maxDependencyComponent", "1"],
  ["lwe.dependency.fallbacks", "globalFallbacks", "1"],
  ["lwe.dependency.footprint_cardinality", "footprintCardinality", "1"],
  ["lwe.dependency.audience_cardinality", "audienceCardinality", "1"],
]);

registerNumericFields("counts", ["algorithm.grounding.global_fallback"], [
  ["lwe.normalization.grounding_fields", "normalizedGroundingFields", "1"],
]);

registerNumericFields("counts", ["algorithm.observation.references_normalized"], [
  ["lwe.normalization.observation_event_references", "droppedObservationEventReferences", "1"],
  ["lwe.normalization.observation_claims", "droppedObservationClaims", "1"],
  ["lwe.normalization.observation_introductions", "droppedObservationIntroductions", "1"],
  ["lwe.normalization.observation_bindings", "clearedObservationCanonicalBindings", "1"],
]);

registerNumericFields("counts", ["algorithm.observation.batch_split", "algorithm.observation.repair_fallback"], [
  ["lwe.observation.batch_splits", "observationBatchSplits", "1"],
  ["lwe.observation.fallbacks", "observationFallbacks", "1"],
]);

registerNumericFields("counts", ["algorithm.outcome.alternative_evidence_normalized"], [
  ["lwe.normalization.outcome_alternative_evidence", "droppedOutcomeAlternativeEvidenceReferences", "1"],
  ["lwe.normalization.outcome_alternatives", "droppedOutcomeAlternatives", "1"],
]);

registerNumericFields("counts", ["model.invocation.provider_completed", "model.invocation.failed"], [
  ["lwe.model.transport_attempts", "transportAttempts", "1"],
]);

registerNumericFields("counts", ["step.rolled_back", "instance.bootstrap.rolled_back"], [
  ["lwe.waste.discarded_calls", "discardedModelCalls", "1"],
  ["lwe.waste.rollbacks", "rollbacks", "1"],
]);

registerNumericFields("measurements", ["model.structured_output.parsed", "model.structured_output.rejected"], [
  ["lwe.model.input_tokens", "inputTokens", "token"],
  ["lwe.model.output_tokens", "outputTokens", "token"],
  ["lwe.model.reasoning_tokens", "reasoningTokens", "token"],
  ["lwe.model.cache_read_tokens", "cacheReadTokens", "token"],
  ["lwe.model.cache_write_tokens", "cacheWriteTokens", "token"],
]);

registerNumericFields("measurements", ["execution.resources.sampled"], [
  ["lwe.system.cpu_user", "cpuUserMs", "ms"],
  ["lwe.system.cpu_system", "cpuSystemMs", "ms"],
  ["lwe.system.rss", "rssBytes", "By"],
  ["lwe.system.heap_used", "heapUsedBytes", "By"],
  ["lwe.system.heap_total", "heapTotalBytes", "By"],
  ["lwe.system.event_loop_active", "eventLoopActiveMs", "ms"],
  ["lwe.system.event_loop_idle", "eventLoopIdleMs", "ms"],
  ["lwe.system.event_loop_utilization", "eventLoopUtilization", "1"],
]);

registerNumericFields("measurements", ["persistence.atomic_commit"], [
  ["lwe.persistence.document_bytes", "documentUtf8Bytes", "By"],
  ["lwe.persistence.sqlite_write", "sqliteWriteMs", "ms"],
]);

registerNumericFields("measurements", undefined, [
  ["lwe.ledger.artifact_raw_bytes", "ledgerArtifactRawBytes", "By"],
  ["lwe.ledger.artifact_stored_bytes", "ledgerArtifactStoredBytes", "By"],
  ["lwe.ledger.sqlite_write", "ledgerSqliteWriteMs", "ms"],
]);

registerNumericFields("measurements", ["step.rolled_back", "instance.bootstrap.rolled_back"], [
  ["lwe.waste.discarded_input_tokens", "discardedInputTokens", "token"],
  ["lwe.waste.discarded_output_tokens", "discardedOutputTokens", "token"],
  ["lwe.waste.discarded_reasoning_tokens", "discardedReasoningTokens", "token"],
  ["lwe.waste.discarded_model_execution", "discardedModelExecutionMs", "ms"],
]);

for (const definition of [
  {
    name: "lwe.model.context_bytes",
    unit: "By" as const,
    key: "contextUtf8Bytes",
    eventNames: ["model.context.serialized"],
  },
  {
    name: "lwe.model.request_bytes",
    unit: "By" as const,
    key: "requestUtf8Bytes",
    eventNames: ["model.context.serialized"],
  },
  {
    name: "lwe.model.response_bytes",
    unit: "By" as const,
    key: "responseUtf8Bytes",
    eventNames: ["model.structured_output.parsed", "model.structured_output.rejected"],
  },
  {
    name: "lwe.model.queue_time",
    unit: "ms" as const,
    key: "queueWaitMs",
    eventNames: ["model.queue.completed", "model.queue.failed"],
  },
  {
    name: "lwe.model.execution_time",
    unit: "ms" as const,
    key: "executionMs",
    eventNames: ["model.transport.completed", "model.transport.failed"],
  },
  {
    name: "lwe.model.retry_delay",
    unit: "ms" as const,
    key: "retryDelayMs",
    eventNames: ["model.transport.retry_wait"],
  },
] as const) {
  EXECUTION_METRICS.register({
    name: definition.name,
    unit: definition.unit,
    aggregation: "sum",
    source: { field: "measurements", key: definition.key, eventNames: definition.eventNames },
    allowedDimensions: commonDimensions,
  });
}

EXECUTION_METRICS.register({
  name: "lwe.model.logical_calls",
  unit: "1",
  aggregation: "count",
  source: { field: "event", name: "model.invocation.started" },
  allowedDimensions: ["providerId", "modelId"],
});

EXECUTION_METRICS.register({
  name: "lwe.model.semantic_repairs",
  unit: "1",
  aggregation: "count",
  source: { field: "event", name: "model.semantic.rejected" },
  allowedDimensions: ["phase"],
});
