import { performance } from "node:perf_hooks";
import { CanonicalCommitter } from "./canonical-committer";
import type { ExecutionContext, ExecutionTraceWriter, WorldExecutionAlgorithm } from "./execution";
import { createHistoryReplayBase } from "./history-replay";
import type { CommittedStep, SimulationState } from "./model";
import type { ModelExecutionAudit } from "./model";
import { contentHash } from "./model-audit";
import type { ModelExecutionScope } from "./model-provider";
import {
  NOOP_RUNTIME_OBSERVER,
  serializeRuntimeError,
  type RuntimeEvent,
  type RuntimeEventInput,
  type RuntimeObserver,
} from "./observability";
import { validateModelAudit, validateSimulationState } from "./transaction";
import type { WorldDefinition } from "./world-definition";
import { validateWorldDefinition } from "./world-definition";

export interface WorldStepResult {
  committed: CommittedStep;
  modelAudits: ModelExecutionAudit[];
  state: SimulationState;
  requiresPlayerDecision: boolean;
}

export interface WorldRunResult {
  status: "completed" | "failed" | "awaiting_player" | "step_limit";
  steps: CommittedStep[];
  state: SimulationState;
}

const validatedSnapshotHashes = new WeakMap<SimulationState, string>();

function consumeValidatedSnapshot(state: SimulationState): boolean {
  const expectedHash = validatedSnapshotHashes.get(state);
  validatedSnapshotHashes.delete(state);
  return expectedHash !== undefined && expectedHash === contentHash(state);
}

class ScopedTraceWriter implements ExecutionTraceWriter {
  readonly critical?: boolean;
  readonly degraded: boolean;
  readonly mode: RuntimeObserver["mode"];
  readonly traceId: string;

  constructor(
    readonly executionId: string,
    private readonly observer: RuntimeObserver,
    private readonly correlation: ModelExecutionScope["correlation"],
  ) {
    this.mode = observer.mode;
    this.degraded = observer.degraded;
    this.critical = observer.critical;
    this.traceId = "traceId" in observer && typeof observer.traceId === "string"
      ? observer.traceId
      : contentHash({ executionId }).slice("sha256:".length);
  }

  emit(input: RuntimeEventInput): RuntimeEvent | undefined {
    return this.observer.emit({
      ...input,
      traceId: input.traceId ?? this.traceId,
      correlation: { ...this.correlation, ...input.correlation, executionId: this.executionId },
    });
  }

  flush(): void {
    this.observer.flush?.();
  }

  artifact(kind: string, value: unknown): string {
    if ("artifact" in this.observer && typeof this.observer.artifact === "function") {
      return (this.observer as ExecutionTraceWriter).artifact(kind, value);
    }
    return contentHash(value);
  }

  subscribe(listener: (event: RuntimeEvent) => void): () => void {
    return this.observer.subscribe?.(listener) ?? (() => undefined);
  }

  snapshot(): RuntimeEvent[] {
    return this.observer.snapshot?.() ?? [];
  }
}

function createExecutionContext(scope: ModelExecutionScope, source: SimulationState): ExecutionContext {
  const executionId = scope.correlation?.executionId ?? `${scope.batchId}:${source.revision}:${source.step}`;
  const observer = scope.observer ?? NOOP_RUNTIME_OBSERVER;
  const trace = new ScopedTraceWriter(executionId, observer, scope.correlation);
  const modelScope: ModelExecutionScope = {
    ...scope,
    correlation: { ...scope.correlation, executionId },
    observer: trace,
    runtimeIdentity: { worldHash: source.worldHash, revision: source.revision },
  };
  let randomState = Number.parseInt(contentHash({
    worldHash: source.worldHash,
    revision: source.revision,
    step: source.step,
    rng: source.truth.rng,
  }).slice(0, 8), 16) >>> 0;
  const random = (): number => {
    randomState = (randomState + 0x6d2b79f5) >>> 0;
    let value = randomState;
    value ^= value >>> 16;
    value = Math.imul(value, 0x7feb352d);
    value ^= value >>> 15;
    value = Math.imul(value, 0x846ca68b);
    value ^= value >>> 16;
    return (value >>> 0) / 0x1_0000_0000;
  };
  return {
    executionId,
    abortSignal: scope.abortSignal,
    modelScope,
    random,
    trace,
  };
}

function resourceBaseline() {
  return { cpu: process.cpuUsage(), elu: performance.eventLoopUtilization() };
}

function resourceMeasurements(baseline: ReturnType<typeof resourceBaseline>): Record<string, number> {
  const cpu = process.cpuUsage(baseline.cpu);
  const elu = performance.eventLoopUtilization(baseline.elu);
  const memory = process.memoryUsage();
  return {
    cpuUserMs: cpu.user / 1_000,
    cpuSystemMs: cpu.system / 1_000,
    rssBytes: memory.rss,
    heapUsedBytes: memory.heapUsed,
    heapTotalBytes: memory.heapTotal,
    externalBytes: memory.external,
    eventLoopUtilization: elu.utilization,
    eventLoopActiveMs: elu.active,
    eventLoopIdleMs: elu.idle,
  };
}

function validateCandidateModelAudits(
  audits: readonly ModelExecutionAudit[],
  source: Readonly<SimulationState>,
): void {
  const seenInvocationIds = new Set<string>();
  for (const [index, audit] of audits.entries()) {
    validateModelAudit(audit, `execution candidate model audit ${index + 1}`, source.worldHash, source.revision, seenInvocationIds);
  }
}

/** All candidate generation and commits share one algorithm/committer path. */
export class SimulationEngine {
  readonly definition: WorldDefinition;
  private state: SimulationState;
  private readonly algorithm: WorldExecutionAlgorithm;
  private readonly committer = new CanonicalCommitter();
  private bootstrapAudits: ModelExecutionAudit[] = [];

  constructor(
    definition: WorldDefinition,
    algorithm: WorldExecutionAlgorithm,
    initialState: SimulationState = definition.initialState,
  ) {
    this.definition = definition;
    validateWorldDefinition(definition);
    this.algorithm = algorithm;
    this.state = structuredClone(initialState);
    if (this.state.worldId !== definition.id) throw new Error("simulation state belongs to another world");
    if (!consumeValidatedSnapshot(this.state)) validateSimulationState(this.state, false, true);
    this.state.historyBase ??= createHistoryReplayBase(definition.initialState);
  }

  get snapshot(): SimulationState {
    const snapshot = structuredClone(this.state);
    validatedSnapshotHashes.set(snapshot, contentHash(snapshot));
    return snapshot;
  }

  get bootstrapModelAudits(): ModelExecutionAudit[] {
    return structuredClone(this.bootstrapAudits);
  }

  async bootstrapAgents(scope?: ModelExecutionScope): Promise<SimulationState> {
    const source = structuredClone(this.state);
    const executionScope = scope ?? {
      workloadId: `simulation:${source.worldId}`,
      batchId: `bootstrap:${source.revision}`,
    };
    const context = createExecutionContext(executionScope, source);
    const resources = resourceBaseline();
    const startedAt = Date.now();
    context.trace.emit({
      event: "execution.world_definition.persisted",
      hashes: { worldDefinition: contentHash(this.definition) },
      payload: this.definition,
    });
    context.trace.emit({
      event: "session.bootstrap.started",
      counts: { persistentAgents: Object.keys(source.agents).length },
      hashes: { state: contentHash(source), algorithmManifest: this.algorithm.manifest.hash },
      payload: { state: source },
    });
    try {
      const candidate = await this.algorithm.bootstrap({
        definition: structuredClone(this.definition),
        state: structuredClone(source),
      }, context);
      validateCandidateModelAudits(candidate.modelAudits, source);
      context.trace.emit({
        event: "execution.resources.sampled",
        attributes: { phase: "bootstrap" },
        measurements: resourceMeasurements(resources),
      });
      context.trace.emit({
        event: "execution.candidate.persisted",
        attributes: { phase: "bootstrap" },
        hashes: { candidate: contentHash(candidate) },
        payload: candidate,
      });
      context.trace.flush();
      const validationStartedAt = performance.now();
      context.trace.emit({ event: "canonical.validation.started", attributes: { phase: "bootstrap" } });
      const committed = this.committer.bootstrap(source, candidate);
      context.trace.emit({
        event: "canonical.validation.completed",
        attributes: {
          phase: "bootstrap",
          status: "accepted",
          cognitionIsolation: "accepted",
          canonicalInvariants: "accepted",
        },
        durationMs: Math.max(0, performance.now() - validationStartedAt),
        hashes: { state: contentHash(committed) },
      });
      this.bootstrapAudits = candidate.modelAudits.map((audit) => structuredClone(audit));
      this.state = committed;
      context.trace.emit({
        event: "session.bootstrap.committed",
        durationMs: Math.max(0, Date.now() - startedAt),
        counts: { activatedAgents: candidate.agentCommits.length, updatedAgents: candidate.agentCommits.length },
        hashes: { state: contentHash(committed) },
      });
      context.trace.flush();
      return this.snapshot;
    } catch (error) {
      context.trace.emit({
        event: "session.bootstrap.rolled_back",
        level: "error",
        durationMs: Math.max(0, Date.now() - startedAt),
        counts: { rollbacks: 1 },
        attributes: { rollbackStateMatches: true },
        hashes: { state: contentHash(source) },
        error: serializeRuntimeError(error),
      });
      context.trace.flush();
      throw error;
    }
  }

  beginPlayerIntent(text: string, inputId?: string): SimulationState {
    const normalized = text.trim();
    if (!normalized) throw new Error("player intent cannot be empty");
    if (this.state.player.intent?.status === "active") throw new Error("a player intent is already active");
    const next = structuredClone(this.state);
    const intentId = inputId ? `intent:${inputId}` : `intent:${next.revision}:${next.step}`;
    const input = {
      id: inputId ?? `input:${intentId}:1`,
      text: normalized,
      kind: "goal" as const,
      submittedAtStep: next.step,
    };
    next.player.intent = {
      id: intentId,
      goal: normalized,
      inputs: [input],
      latestInput: input,
      status: "active",
      startedAtStep: next.step,
    };
    this.state = next;
    return this.snapshot;
  }

  continuePlayerIntent(text: string, inputId: string): SimulationState {
    const normalized = text.trim();
    if (!normalized) throw new Error("player intent input cannot be empty");
    const intent = this.state.player.intent;
    if (!intent || intent.status !== "active") throw new Error("no active player intent");
    const next = structuredClone(this.state);
    const clarification = {
      id: inputId,
      text: normalized,
      kind: "clarification" as const,
      submittedAtStep: next.step,
    };
    if (next.player.intent!.inputs.some((input) => input.id === inputId)) {
      throw new Error(`player intent input id was already used: ${inputId}`);
    }
    next.player.intent!.inputs.push(clarification);
    next.player.intent!.latestInput = clarification;
    this.state = next;
    return this.snapshot;
  }

  cancelPlayerIntent(): SimulationState {
    if (!this.state.player.intent || this.state.player.intent.status !== "active") return this.snapshot;
    const next = structuredClone(this.state);
    next.player.intent!.status = "cancelled";
    this.state = next;
    return this.snapshot;
  }

  async step(scope?: ModelExecutionScope): Promise<WorldStepResult> {
    const source = structuredClone(this.state);
    const executionScope = scope ?? {
      workloadId: `simulation:${source.worldId}`,
      batchId: `step:${source.revision}:${source.step + 1}`,
    };
    const context = createExecutionContext(executionScope, source);
    const resources = resourceBaseline();
    const startedAt = Date.now();
    let generatedModelCalls = 0;
    let discardedInputTokens = 0;
    let discardedOutputTokens = 0;
    let discardedReasoningTokens = 0;
    let discardedModelExecutionMs = 0;
    context.trace.emit({
      event: "execution.world_definition.persisted",
      hashes: { worldDefinition: contentHash(this.definition) },
      payload: this.definition,
    });
    context.trace.emit({
      event: "step.started",
      hashes: { state: contentHash(source), algorithmManifest: this.algorithm.manifest.hash },
      counts: { persistentAgents: Object.keys(source.agents).length },
      payload: { state: source },
    });
    try {
      const candidate = await this.algorithm.step({
        definition: structuredClone(this.definition),
        state: structuredClone(source),
      }, context);
      validateCandidateModelAudits(candidate.modelAudits, source);
      generatedModelCalls = candidate.modelAudits.reduce((sum, audit) => sum + audit.invocations.length, 0);
      const generatedInvocations = candidate.modelAudits.flatMap((audit) => audit.invocations);
      discardedInputTokens = generatedInvocations.reduce((sum, invocation) => sum + (invocation.tokenUsage.input ?? 0), 0);
      discardedOutputTokens = generatedInvocations.reduce((sum, invocation) => sum + (invocation.tokenUsage.output ?? 0), 0);
      discardedReasoningTokens = generatedInvocations.reduce((sum, invocation) =>
        sum + (invocation.tokenUsage.reasoning ?? 0), 0);
      discardedModelExecutionMs = generatedInvocations.flatMap((invocation) => invocation.transports)
        .reduce((sum, transport) => sum + transport.executionMs, 0);
      context.trace.emit({
        event: "execution.candidate.persisted",
        attributes: { phase: "step" },
        hashes: { candidate: contentHash(candidate) },
        payload: candidate,
      });
      context.trace.flush();
      const validationStartedAt = performance.now();
      context.trace.emit({ event: "canonical.validation.started", attributes: { phase: "step" } });
      const result = this.committer.step(source, candidate);
      context.trace.emit({
        event: "canonical.validation.completed",
        attributes: {
          phase: "step",
          status: "accepted",
          cognitionIsolation: "accepted",
          canonicalInvariants: "accepted",
        },
        durationMs: Math.max(0, performance.now() - validationStartedAt),
        hashes: { semantic: result.committed.semanticHash, state: contentHash(result.state) },
      });
      this.state = result.state;
      context.trace.emit({
        event: "execution.resources.sampled",
        attributes: { phase: "step" },
        measurements: resourceMeasurements(resources),
      });
      context.trace.emit({
        event: "step.committed",
        durationMs: Math.max(0, Date.now() - startedAt),
        counts: { modelExecutions: candidate.modelAudits.length },
        hashes: { committedStep: result.committed.contentHash, state: contentHash(result.state) },
      });
      context.trace.flush();
      return {
        committed: result.committed,
        modelAudits: candidate.modelAudits.map((audit) => structuredClone(audit)),
        state: this.snapshot,
        requiresPlayerDecision: result.committed.requiresPlayerDecision,
      };
    } catch (error) {
      context.trace.emit({
        event: "step.rolled_back",
        level: "error",
        durationMs: Math.max(0, Date.now() - startedAt),
        counts: { rollbacks: 1, discardedModelCalls: generatedModelCalls },
        measurements: {
          discardedInputTokens,
          discardedOutputTokens,
          discardedReasoningTokens,
          discardedModelExecutionMs,
        },
        attributes: { result: "rolled_back", rollbackStateMatches: true },
        hashes: { state: contentHash(source) },
        error: serializeRuntimeError(error),
      });
      context.trace.flush();
      throw error;
    }
  }

  async runUntilBoundary(
    maxSteps = 100,
    onStep?: (result: WorldStepResult) => void | Promise<void>,
    scope?: ModelExecutionScope,
  ): Promise<WorldRunResult> {
    if (!Number.isSafeInteger(maxSteps) || maxSteps <= 0) throw new Error("maxSteps must be positive");
    const steps: CommittedStep[] = [];
    for (let index = 0; index < maxSteps; index += 1) {
      const result = await this.step(scope);
      steps.push(result.committed);
      await onStep?.(result);
      const status = this.state.player.intent?.status;
      if (result.requiresPlayerDecision) return { status: "awaiting_player", steps, state: this.snapshot };
      if (status === "completed") return { status: "completed", steps, state: this.snapshot };
      if (status === "failed" || status === "cancelled") return { status: "failed", steps, state: this.snapshot };
    }
    return { status: "step_limit", steps, state: this.snapshot };
  }
}
