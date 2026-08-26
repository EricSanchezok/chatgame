import { randomUUID } from "node:crypto";
import path from "node:path";
import { AgentMind } from "../engine/agent-mind";
import { loadModelCatalog } from "../engine/model-catalog";
import { createModelGateway } from "../engine/model-gateway";
import { canonicalize, contentHash } from "../engine/model-audit";
import type { StructuredModelProvider } from "../engine/model-provider";
import { SimulationEngine } from "../engine/simulation";
import { TruthEngine } from "../engine/truth-engine";
import {
  validateWorldDefinition,
  validateWorldModelProfiles,
  toWorldRuntimeContract,
  worldModelProfileIds,
  type WorldDefinition,
} from "../engine/world-definition";
import type { WorldRepository } from "../script/world-repository";
import {
  NOOP_RUNTIME_OBSERVER,
  runtimeEventEmitter,
  serializeRuntimeError,
  type RuntimeCorrelation,
  type RuntimeEvent,
  type RuntimeObserver,
} from "../engine/observability";
import {
  isWorldRunActiveIntentOwner,
  isWorldRunExecuting,
  isWorldRunRetriable,
  isWorldRunStreamBoundary,
  type ContinueWorldRunInput,
  type StartWorldRunResponse,
  type WorldRunSnapshot,
} from "../shared/world-api";
import type {
  WorldInspectorAttemptDetail,
  WorldInspectorRuntimeEventDetail,
  WorldInspectorRuntimeEventSummary,
  WorldInspectorStepDetail,
  WorldInspectorWindow,
} from "../shared/world-inspector-api";
import { LocalDatabase } from "./local-database";
import type { WorldImportResult } from "./world-import";
import { getRuntimeObserver, readRuntimeObservabilityConfig } from "./runtime-observer";
import { RuntimeTraceIndex } from "./runtime-trace-index";
import {
  buildWorldInspectorAttemptDetail,
  buildWorldInspectorCommittedProjection,
  buildWorldInspectorCommittedStepDetail,
  buildWorldInspectorRuntimeEventDetail,
  buildWorldInspectorStepDetail,
  buildWorldInspectorWindow,
  summarizeRuntimeEvent,
  type WorldInspectorCommittedProjection,
  type WorldInspectorCommittedStepDetail,
} from "./world-inspector";
import { classifyRunFailure, type RunFailureClassification } from "./run-failure";
import {
  WorldSessionConflictError,
  WorldSessionNotFoundError,
  type StoredWorldSession,
  type WorldSessionStore,
} from "./world-session-store";
import {
  publicSessionDetail,
  publicCommittedStepEvents,
  publicSessionSummary,
  publicWorldRunSnapshot,
  type PublicSessionDetail,
  type PublicSessionSummary,
  type WorldRunEvent,
  type WorldRunEventInput,
  type WorldRunRecord,
  type WorldRunStatus,
  type WorldSessionDocument,
} from "./world-run-types";

interface HostedSession extends StoredWorldSession {
  definition: WorldDefinition;
  engine: SimulationEngine;
}

interface HostedExecution {
  promise: Promise<void>;
  controller: AbortController;
}

interface PendingRunFailure {
  classification: RunFailureClassification;
  internalError: string;
}

interface WorldCatalogManager {
  importWorld(
    buffer: Buffer,
    modelCatalog: StructuredModelProvider["catalog"],
    replace?: boolean,
    expectedWorldId?: string,
  ): WorldImportResult;
  deleteWorld(worldId: string): void;
}

type ExecutionReason = "initial" | "player_input" | "retry";

const inputIdPattern = /^[a-zA-Z0-9][a-zA-Z0-9:_-]{0,127}$/;
const PINNED_WORLD_CONTRACT_CACHE_LIMIT = 8;
const streamBoundaryEventTypes = new Set<WorldRunEvent["type"]>([
  "run.awaiting_player",
  "run.completed",
  "run.goal_failed",
  "run.step_limit",
  "run.cancelled",
  "run.failed",
]);

class RunChannel {
  private readonly waiters = new Set<() => void>();
  private version = 0;

  get currentVersion(): number {
    return this.version;
  }

  notify(): void {
    this.version += 1;
    for (const waiter of this.waiters) waiter();
    this.waiters.clear();
  }

  async wait(afterVersion: number, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted || this.version !== afterVersion) return;
    await new Promise<void>((resolve) => {
      const done = () => {
        signal?.removeEventListener("abort", done);
        this.waiters.delete(done);
        resolve();
      };
      this.waiters.add(done);
      signal?.addEventListener("abort", done, { once: true });
    });
  }
}

export interface WorldHostOptions {
  repository: WorldRepository;
  store: WorldSessionStore;
  provider: StructuredModelProvider;
  catalogManager?: WorldCatalogManager;
  now?: () => Date;
  idFactory?: () => string;
  maxStepsPerRun?: number;
  observer?: RuntimeObserver;
  traceIndex?: RuntimeTraceIndex;
}

export class WorldHostError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "WorldHostError";
  }
}

export class WorldHost {
  private static singleton: WorldHost | undefined;
  private readonly executions = new Map<string, HostedExecution>();
  private readonly pendingRunFailures = new Map<string, PendingRunFailure>();
  private readonly pendingRunCancellations = new Set<string>();
  private readonly channels = new Map<string, RunChannel>();
  private readonly inspectorChannel = new RunChannel();
  private readonly liveRuntimeEvents: RuntimeEvent[] = [];
  private readonly inspectorProjectionCache = new Map<string, WorldInspectorCommittedProjection>();
  private readonly inspectorStepCache = new Map<string, WorldInspectorCommittedStepDetail>();
  private readonly inspectorEpoch = randomUUID();
  private readonly pinnedWorldContracts = new Map<string, ReturnType<typeof toWorldRuntimeContract>>();
  private readonly now: () => Date;
  private readonly idFactory: () => string;
  private readonly maxStepsPerRun: number;
  readonly runtimeObserver: RuntimeObserver;
  private readonly observe: ReturnType<typeof runtimeEventEmitter>;

  constructor(private readonly options: WorldHostOptions) {
    this.now = options.now ?? (() => new Date());
    this.idFactory = options.idFactory ?? randomUUID;
    this.maxStepsPerRun = options.maxStepsPerRun ?? 100;
    this.runtimeObserver = options.observer ?? NOOP_RUNTIME_OBSERVER;
    this.observe = runtimeEventEmitter(this.runtimeObserver);
    this.runtimeObserver.subscribe?.((event) => {
      this.liveRuntimeEvents.push(structuredClone(event));
      if (this.liveRuntimeEvents.length > 10_000) this.liveRuntimeEvents.splice(0, this.liveRuntimeEvents.length - 10_000);
      this.inspectorChannel.notify();
    });
  }

  static get(): WorldHost {
    if (!this.singleton) {
      const observer = getRuntimeObserver();
      const observability = readRuntimeObservabilityConfig();
      const catalog = loadModelCatalog(path.resolve(
        /* turbopackIgnore: true */ process.env.LIVINGWORLD_MODEL_CATALOG_PATH ?? "config/models.yaml",
      ));
      const provider = createModelGateway(catalog, process.env, { observer });
      const dataRoot = path.resolve(
        /* turbopackIgnore: true */ process.env.LIVINGWORLD_DATA_ROOT ?? ".livingworld",
      );
      const database = new LocalDatabase(path.join(dataRoot, "livingworld.sqlite"), { observer });
      this.singleton = new WorldHost({
        repository: database,
        store: database,
        catalogManager: database,
        provider,
        observer,
        traceIndex: new RuntimeTraceIndex(observability.directory),
      });
    }
    return this.singleton;
  }

  static observer(): RuntimeObserver {
    return this.singleton?.runtimeObserver ?? getRuntimeObserver();
  }

  static setForTests(host: WorldHost | undefined): void {
    this.singleton = host;
  }

  private executionKey(sessionId: string, runId: string): string {
    return `${sessionId}:${runId}`;
  }

  private inspectorCacheValue<T>(cache: Map<string, T>, key: string, create: () => T): T {
    const existing = cache.get(key);
    if (existing !== undefined) {
      cache.delete(key);
      cache.set(key, existing);
      return existing;
    }
    const value = create();
    cache.set(key, value);
    if (cache.size > 64) {
      const oldest = cache.keys().next().value as string | undefined;
      if (oldest !== undefined) cache.delete(oldest);
    }
    return value;
  }

  private inspectorCachePrefix(document: WorldSessionDocument): string {
    return `${document.id}:${document.world.contentHash}:${document.state.revision}`;
  }

  private channel(sessionId: string, runId: string): RunChannel {
    const key = this.executionKey(sessionId, runId);
    const channel = this.channels.get(key) ?? new RunChannel();
    this.channels.set(key, channel);
    return channel;
  }

  private notifyRun(sessionId: string, runId: string, close = false): void {
    const key = this.executionKey(sessionId, runId);
    this.channels.get(key)?.notify();
    if (close) this.channels.delete(key);
  }

  listWorlds() {
    return this.options.repository.list().map((summary) => ({
      id: summary.id,
      name: summary.name,
      version: summary.version,
      contentHash: summary.contentHash,
      description: summary.description,
    }));
  }

  importWorld(buffer: Buffer, replace = false, expectedWorldId?: string): WorldImportResult {
    if (!this.options.catalogManager) throw new WorldHostError("world import is unavailable", 501);
    return this.options.catalogManager.importWorld(buffer, this.options.provider.catalog, replace, expectedWorldId);
  }

  deleteWorld(worldId: string): void {
    if (!this.options.catalogManager) throw new WorldHostError("world management is unavailable", 501);
    this.options.catalogManager.deleteWorld(worldId);
  }

  private pinnedWorldContractIdentity(document: WorldSessionDocument): { key: string; seed: number } {
    const seed = document.state.historyBase?.truth.rng.seed;
    if (seed === undefined) throw new Error("session state has no pinned pre-bootstrap world seed");
    return { key: `${document.world.id}\u0000${document.world.contentHash}\u0000${seed}`, seed };
  }

  private verifyPinnedWorld(document: WorldSessionDocument): ReturnType<typeof toWorldRuntimeContract> {
    const { key, seed } = this.pinnedWorldContractIdentity(document);
    let trusted = this.pinnedWorldContracts.get(key);
    if (trusted) {
      this.pinnedWorldContracts.delete(key);
      this.pinnedWorldContracts.set(key, trusted);
    } else {
      const definition = this.options.repository.loadVersion(
        document.world.id,
        document.world.contentHash,
        seed,
        this.options.provider.catalog,
      );
      trusted = toWorldRuntimeContract(definition);
      this.pinnedWorldContracts.set(key, trusted);
      while (this.pinnedWorldContracts.size > PINNED_WORLD_CONTRACT_CACHE_LIMIT) {
        const oldestKey = this.pinnedWorldContracts.keys().next().value;
        if (oldestKey === undefined) break;
        this.pinnedWorldContracts.delete(oldestKey);
      }
    }
    if (JSON.stringify(canonicalize(document.world)) !== JSON.stringify(canonicalize(trusted))) {
      throw new Error(`session world contract does not match pinned version ${document.world.contentHash}`);
    }
    return structuredClone(trusted);
  }

  private definitionFrom(document: WorldSessionDocument): WorldDefinition {
    const trusted = this.verifyPinnedWorld(document);
    const definition: WorldDefinition = {
      ...trusted,
      initialState: structuredClone(document.state),
    };
    validateWorldDefinition(definition);
    validateWorldModelProfiles(definition, this.options.provider.catalog);
    this.options.provider.assertProfilesAvailable(worldModelProfileIds(definition));
    return definition;
  }

  private buildEngine(definition: WorldDefinition, state = definition.initialState): SimulationEngine {
    return new SimulationEngine(
      definition,
      new TruthEngine(this.options.provider, { rulePackages: this.options.repository.rulePackages }),
      new AgentMind(this.options.provider),
      state,
    );
  }

  private appendEvent(
    run: WorldRunRecord,
    input: WorldRunEventInput,
    correlation?: RuntimeCorrelation,
  ): WorldRunEvent {
    const event = {
      ...input,
      sequence: (run.events.at(-1)?.sequence ?? 0) + 1,
      at: this.now().toISOString(),
    } as WorldRunEvent;
    run.events.push(event);
    run.updatedAt = event.at;
    this.observe?.({
      event: "run.public_event.appended",
      correlation: { ...correlation, sessionId: run.sessionId, runId: run.id },
      attributes: { publicEventType: event.type },
      measurements: { eventUtf8Bytes: Buffer.byteLength(JSON.stringify(event), "utf8") },
      hashes: { publicEvent: contentHash(event) },
    });
    return event;
  }

  private commitCandidate(
    session: HostedSession,
    engine: SimulationEngine,
    document: WorldSessionDocument,
    correlation?: RuntimeCorrelation,
  ): HostedSession {
    document.state = engine.snapshot;
    document.updatedAt = this.now().toISOString();
    const stored = this.options.store.compareAndSwap(
      session.document.id,
      session.generation,
      document,
      correlation,
    );
    return { ...stored, definition: session.definition, engine };
  }

  private commitRequest(
    session: HostedSession,
    engine: SimulationEngine,
    document: WorldSessionDocument,
    correlation?: RuntimeCorrelation,
  ): HostedSession {
    try {
      return this.commitCandidate(session, engine, document, correlation);
    } catch (error) {
      if (error instanceof WorldSessionConflictError) {
        throw new WorldHostError("world session changed concurrently; retry the request", 409);
      }
      throw error;
    }
  }

  private readStoredSession(
    sessionId: string,
    correlation?: RuntimeCorrelation,
  ): StoredWorldSession {
    try {
      const stored = this.options.store.read(sessionId, { ...correlation, sessionId });
      this.verifyPinnedWorld(stored.document);
      return stored;
    } catch (error) {
      if (!(error instanceof WorldSessionNotFoundError)) throw error;
      throw new WorldHostError(`world session not found: ${sessionId}`, 404);
    }
  }

  private loadSession(
    sessionId: string,
    recover = true,
    correlation?: RuntimeCorrelation,
  ): HostedSession {
    const stored = this.readStoredSession(sessionId, correlation);
    const definition = this.definitionFrom(stored.document);
    let session: HostedSession = {
      ...stored,
      definition,
      engine: this.buildEngine(definition, stored.document.state),
    };
    if (!recover) return session;

    const document = structuredClone(session.document);
    let recoveredEngine = session.engine;
    let changed = false;
    const recoveredRunIds: string[] = [];
    for (const run of Object.values(document.runs)) {
      const executionKey = this.executionKey(sessionId, run.id);
      const pendingCancellation = this.pendingRunCancellations.has(executionKey) &&
        isWorldRunActiveIntentOwner(run.status);
      if (!isWorldRunExecuting(run.status) && !pendingCancellation) {
        this.pendingRunFailures.delete(executionKey);
        this.pendingRunCancellations.delete(executionKey);
        continue;
      }
      if (isWorldRunExecuting(run.status) && this.executions.has(executionKey)) continue;
      if (run.cancelRequested || pendingCancellation) {
        recoveredEngine = this.buildEngine(session.definition, document.state);
        recoveredEngine.cancelPlayerIntent();
        document.state = recoveredEngine.snapshot;
        run.status = "cancelled";
        run.cancelRequested = false;
        run.error = undefined;
        run.internalError = undefined;
        this.appendEvent(run, {
          type: "run.cancelled",
          payload: { runId: run.id, revision: document.state.revision, step: document.state.step },
        }, { ...correlation, sessionId, runId: run.id });
      } else {
        const pendingFailure = this.pendingRunFailures.get(executionKey);
        run.status = "failed";
        run.error = pendingFailure?.classification.publicMessage ??
          "运行进程在世界步骤边界外中断，可安全重试。";
        run.internalError = pendingFailure?.internalError ??
          "process interrupted while run was queued or running";
        this.appendEvent(run, {
          type: "run.failed",
          payload: {
            runId: run.id,
            message: run.error,
            retriable: pendingFailure?.classification.retriable ?? true,
          },
        }, { ...correlation, sessionId, runId: run.id });
      }
      changed = true;
      recoveredRunIds.push(run.id);
    }
    if (changed) {
      try {
        session = this.commitCandidate(session, recoveredEngine, document, correlation);
      } catch (error) {
        if (!(error instanceof WorldSessionConflictError)) throw error;
        session = this.loadSession(sessionId, false, correlation);
      }
      for (const runId of recoveredRunIds) {
        if (!isWorldRunExecuting(this.requireRun(session, runId).status)) {
          this.pendingRunFailures.delete(this.executionKey(sessionId, runId));
          this.pendingRunCancellations.delete(this.executionKey(sessionId, runId));
        }
        this.notifyRun(sessionId, runId, isWorldRunStreamBoundary(this.requireRun(session, runId).status));
      }
    }
    return session;
  }

  async createSession(
    input: { worldId: string; seed?: number },
    correlation?: RuntimeCorrelation,
  ): Promise<PublicSessionDetail> {
    const definition = this.options.repository.load(input.worldId, input.seed ?? 1, this.options.provider.catalog);
    this.options.provider.assertProfilesAvailable(worldModelProfileIds(definition));
    const engine = this.buildEngine(definition);
    const id = this.idFactory();
    const sessionCorrelation = { ...correlation, sessionId: id, revision: 0, step: 0 };
    await engine.bootstrapAgents({
      workloadId: id,
      batchId: `bootstrap:${id}`,
      correlation: sessionCorrelation,
      observer: this.runtimeObserver,
    });
    const now = this.now().toISOString();
    const document: WorldSessionDocument = {
      schemaVersion: 9,
      id,
      world: toWorldRuntimeContract(definition),
      title: definition.name,
      createdAt: now,
      updatedAt: now,
      state: engine.snapshot,
      runs: {},
    };
    try {
      this.options.store.create(document, sessionCorrelation);
    } catch (error) {
      this.observe?.({
        event: "session.bootstrap.persistence_rolled_back",
        level: "error",
        correlation: sessionCorrelation,
        attributes: { result: "rolled_back" },
        hashes: { state: contentHash(document.state) },
        error: serializeRuntimeError(error),
      });
      throw error;
    }
    this.observe?.({
      event: "session.bootstrap.finished",
      correlation: sessionCorrelation,
      counts: { agents: Object.keys(document.state.agents).length },
      hashes: { state: contentHash(document.state) },
    });
    return publicSessionDetail(document);
  }

  session(sessionId: string, correlation?: RuntimeCorrelation): PublicSessionDetail {
    return publicSessionDetail(this.loadSession(sessionId, true, correlation).document);
  }

  private inspectorRuntimeTrace(sessionId: string): { degraded: boolean; events: RuntimeEvent[] } {
    if (this.runtimeObserver.mode === "off") {
      return { degraded: this.runtimeObserver.degraded, events: [] };
    }
    let persisted: RuntimeEvent[] = [];
    let degraded = this.runtimeObserver.degraded;
    try {
      persisted = this.options.traceIndex?.events(sessionId) ?? [];
      degraded ||= this.options.traceIndex?.degraded ?? false;
    } catch {
      // Trace inspection is best-effort and cannot affect the world host.
      degraded = true;
    }
    const recorded = this.runtimeObserver.snapshot?.().filter((event) =>
      event.correlation?.sessionId === sessionId) ?? [];
    const live = this.liveRuntimeEvents.filter((event) => event.correlation?.sessionId === sessionId);
    const unique = new Map<string, RuntimeEvent>();
    for (const event of [...persisted, ...recorded, ...live]) {
      unique.set(`${event.timestamp}\u0000${event.sequence}\u0000${event.event}`, event);
    }
    return {
      degraded,
      events: [...unique.values()].sort((left, right) =>
        left.timestamp.localeCompare(right.timestamp) || left.sequence - right.sequence),
    };
  }

  inspectorWindow(
    sessionId: string,
    input: { beforeRevision?: number; limit: number },
    correlation?: RuntimeCorrelation,
  ): WorldInspectorWindow {
    const document = this.loadSession(sessionId, true, correlation).document;
    const projection = this.inspectorCacheValue(
      this.inspectorProjectionCache,
      `${this.inspectorCachePrefix(document)}:window:${input.beforeRevision ?? "latest"}:${input.limit}`,
      () => buildWorldInspectorCommittedProjection(document, input),
    );
    const trace = this.inspectorRuntimeTrace(sessionId);
    return buildWorldInspectorWindow(
      document,
      this.runtimeObserver,
      trace.events,
      input,
      projection,
      trace.degraded,
    );
  }

  inspectorStep(
    sessionId: string,
    revision: number,
    correlation?: RuntimeCorrelation,
  ): WorldInspectorStepDetail {
    const document = this.loadSession(sessionId, true, correlation).document;
    const cacheKey = `${this.inspectorCachePrefix(document)}:step:${revision}`;
    const committedDetail = this.inspectorCacheValue(this.inspectorStepCache, cacheKey, () => {
      const built = buildWorldInspectorCommittedStepDetail(document, revision);
      if (!built) throw new WorldHostError(`world revision not found: ${revision}`, 404);
      return built;
    });
    const trace = this.inspectorRuntimeTrace(sessionId);
    const detail = buildWorldInspectorStepDetail(
      document,
      revision,
      this.runtimeObserver,
      trace.events,
      committedDetail,
      trace.degraded,
    );
    if (!detail) throw new WorldHostError(`world revision not found: ${revision}`, 404);
    return detail;
  }

  inspectorAttempt(
    sessionId: string,
    attemptId: string,
    correlation?: RuntimeCorrelation,
  ): WorldInspectorAttemptDetail {
    this.loadSession(sessionId, true, correlation);
    const trace = this.inspectorRuntimeTrace(sessionId);
    const detail = buildWorldInspectorAttemptDetail(
      attemptId,
      this.runtimeObserver,
      trace.events,
      trace.degraded,
    );
    if (!detail) throw new WorldHostError(`runtime attempt not found or expired: ${attemptId}`, 404);
    return detail;
  }

  inspectorRuntimeEvent(
    sessionId: string,
    eventId: string,
    correlation?: RuntimeCorrelation,
  ): WorldInspectorRuntimeEventDetail {
    this.loadSession(sessionId, true, correlation);
    const trace = this.inspectorRuntimeTrace(sessionId);
    const detail = buildWorldInspectorRuntimeEventDetail(eventId, trace.events);
    if (!detail) throw new WorldHostError(`runtime event not found or expired: ${eventId}`, 404);
    return detail;
  }

  inspectorStreamState(): { epoch: string; earliest: number; latest: number } {
    return {
      epoch: this.inspectorEpoch,
      earliest: this.liveRuntimeEvents[0]?.sequence ?? 0,
      latest: this.liveRuntimeEvents.at(-1)?.sequence ?? 0,
    };
  }

  async *subscribeInspectorEvents(
    sessionId: string,
    afterSequence: number,
    signal?: AbortSignal,
  ): AsyncGenerator<WorldInspectorRuntimeEventSummary> {
    if (!Number.isSafeInteger(afterSequence) || afterSequence < 0) {
      throw new WorldHostError("inspector event cursor must be a non-negative safe integer", 400);
    }
    let cursor = afterSequence;
    while (!signal?.aborted) {
      const channelVersion = this.inspectorChannel.currentVersion;
      const available = this.liveRuntimeEvents.filter((event) =>
        event.sequence > cursor && event.correlation?.sessionId === sessionId);
      for (const event of available) {
        cursor = event.sequence;
        yield summarizeRuntimeEvent(event);
      }
      await this.inspectorChannel.wait(channelVersion, signal);
    }
  }

  listSessions(correlation?: RuntimeCorrelation): PublicSessionSummary[] {
    const stored = this.options.store.listSessions(correlation);
    const cached: StoredWorldSession[] = [];
    const cold: StoredWorldSession[] = [];
    for (const session of stored) {
      const destination = this.pinnedWorldContracts.has(this.pinnedWorldContractIdentity(session.document).key)
        ? cached
        : cold;
      destination.push(session);
    }
    for (const { document } of [...cached, ...cold]) this.verifyPinnedWorld(document);
    return stored
      .map(({ document }) => publicSessionSummary(document))
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id));
  }

  renameSession(
    sessionId: string,
    title: string,
    correlation?: RuntimeCorrelation,
  ): PublicSessionDetail {
    const normalized = title.trim();
    if (!normalized || normalized.length > 80) {
      throw new WorldHostError("session title must be between 1 and 80 characters", 400);
    }
    const session = this.loadSession(sessionId, true, correlation);
    const active = Object.values(session.document.runs).find((run) => isWorldRunExecuting(run.status));
    if (active) throw new WorldHostError(`session has active run ${active.id}`, 409);
    const document = structuredClone(session.document);
    document.title = normalized;
    const committed = this.commitRequest(session, session.engine, document, correlation);
    return publicSessionDetail(committed.document);
  }

  deleteSession(sessionId: string, correlation?: RuntimeCorrelation): void {
    const session = this.loadSession(sessionId, true, correlation);
    const active = Object.values(session.document.runs).find((run) => isWorldRunExecuting(run.status));
    if (active) throw new WorldHostError(`session has active run ${active.id}`, 409);
    try {
      this.options.store.delete(sessionId, session.generation, correlation);
    } catch (error) {
      if (error instanceof WorldSessionConflictError) {
        throw new WorldHostError("world session changed concurrently; retry the request", 409);
      }
      throw error;
    }
    const prefix = `${sessionId}:`;
    for (const key of this.channels.keys()) {
      if (key.startsWith(prefix)) this.channels.delete(key);
    }
    for (const key of this.pendingRunFailures.keys()) {
      if (key.startsWith(prefix)) this.pendingRunFailures.delete(key);
    }
    for (const key of this.pendingRunCancellations) {
      if (key.startsWith(prefix)) this.pendingRunCancellations.delete(key);
    }
  }

  startRun(sessionId: string, text: string, correlation?: RuntimeCorrelation): StartWorldRunResponse {
    const normalized = text.trim();
    if (!normalized) throw new WorldHostError("run input cannot be empty", 400);
    if (text.length > 4_000) throw new WorldHostError("run input must be 4000 characters or fewer", 400);
    let session = this.loadSession(sessionId, true, correlation);
    const activeIntent = session.engine.snapshot.player.intent;
    if (activeIntent?.status === "active") {
      const owner = Object.values(session.document.runs).find((run) => run.intentId === activeIntent.id);
      throw new WorldHostError(`session already has active run ${owner?.id ?? "unknown"}`, 409);
    }

    const id = this.idFactory();
    if (session.document.runs[id]) throw new Error(`world run id collision: ${id}`);
    const inputId = `input:${id}:1`;
    const engine = this.buildEngine(session.definition, session.engine.snapshot);
    engine.beginPlayerIntent(normalized, inputId);
    const now = this.now().toISOString();
    const run: WorldRunRecord = {
      id,
      sessionId,
      intentId: engine.snapshot.player.intent!.id,
      status: "queued",
      createdAt: now,
      updatedAt: now,
      cancelRequested: false,
      events: [],
    };
    const runCorrelation = { ...correlation, sessionId, runId: id, revision: engine.snapshot.revision };
    this.appendEvent(
      run,
      { type: "player.input", payload: { id: inputId, kind: "goal", text: normalized } },
      runCorrelation,
    );
    const document = structuredClone(session.document);
    document.runs[id] = run;
    session = this.commitRequest(session, engine, document, runCorrelation);
    this.scheduleExecution(sessionId, id, "initial", runCorrelation);
    return { runId: id };
  }

  continueRun(
    sessionId: string,
    runId: string,
    input: ContinueWorldRunInput,
    correlation?: RuntimeCorrelation,
  ): WorldRunSnapshot {
    const normalized = input.text.trim();
    if (!inputIdPattern.test(input.id)) throw new WorldHostError("player input id is invalid", 400);
    if (!normalized) throw new WorldHostError("player input cannot be empty", 400);
    if (input.text.length > 4_000) throw new WorldHostError("player input must be 4000 characters or fewer", 400);
    let session = this.loadSession(sessionId, true, correlation);
    const current = this.requireRun(session, runId);
    const priorInput = current.events.find((event) =>
      event.type === "player.input" && event.payload.id === input.id);
    if (priorInput?.type === "player.input") {
      if (priorInput.payload.text !== normalized) {
        throw new WorldHostError(`player input ${input.id} already exists with different text`, 409);
      }
      return publicWorldRunSnapshot(session.document, current);
    }
    if (current.status !== "awaiting_player") {
      throw new WorldHostError(`run ${runId} is not awaiting player input`, 409);
    }
    if (session.engine.snapshot.player.intent?.status !== "active" ||
      session.engine.snapshot.player.intent.id !== current.intentId) {
      throw new WorldHostError(`run ${runId} does not own the active player intent`, 409);
    }
    const engine = this.buildEngine(session.definition, session.engine.snapshot);
    engine.continuePlayerIntent(normalized, input.id);
    const document = structuredClone(session.document);
    const run = document.runs[runId];
    run.status = "queued";
    run.error = undefined;
    run.internalError = undefined;
    run.cancelRequested = false;
    this.appendEvent(run, {
      type: "player.input",
      payload: { id: input.id, kind: "clarification", text: normalized },
    }, { ...correlation, sessionId, runId, revision: engine.snapshot.revision });
    try {
      session = this.commitCandidate(session, engine, document, correlation);
    } catch (error) {
      if (!(error instanceof WorldSessionConflictError)) throw error;
      const latest = this.loadSession(sessionId, false, correlation);
      const latestRun = this.requireRun(latest, runId);
      const persistedInput = latestRun.events.find((event) =>
        event.type === "player.input" && event.payload.id === input.id);
      if (persistedInput?.type === "player.input" && persistedInput.payload.text === normalized) {
        return publicWorldRunSnapshot(latest.document, latestRun);
      }
      throw new WorldHostError("world session changed concurrently; retry the request", 409);
    }
    this.scheduleExecution(sessionId, runId, "player_input", correlation);
    return publicWorldRunSnapshot(session.document, session.document.runs[runId]);
  }

  retryRun(sessionId: string, runId: string, correlation?: RuntimeCorrelation): WorldRunSnapshot {
    let session = this.loadSession(sessionId, true, correlation);
    const current = this.requireRun(session, runId);
    if (!isWorldRunRetriable(current)) {
      throw new WorldHostError(`run ${runId} is not retriable`, 409);
    }
    if (session.engine.snapshot.player.intent?.status !== "active" ||
      session.engine.snapshot.player.intent.id !== current.intentId) {
      throw new WorldHostError(`run ${runId} does not own the active player intent`, 409);
    }
    const document = structuredClone(session.document);
    const run = document.runs[runId];
    run.status = "queued";
    run.error = undefined;
    run.internalError = undefined;
    run.cancelRequested = false;
    session = this.commitRequest(session, session.engine, document, correlation);
    this.scheduleExecution(sessionId, runId, "retry", correlation);
    return publicWorldRunSnapshot(session.document, session.document.runs[runId]);
  }

  private scheduleExecution(
    sessionId: string,
    runId: string,
    reason: ExecutionReason,
    correlation?: RuntimeCorrelation,
  ): void {
    const key = this.executionKey(sessionId, runId);
    const run = this.readStoredSession(sessionId, correlation).document.runs[runId];
    const runAttempt = run.events.filter((event) => event.type === "run.execution_started").length + 1;
    const executionCorrelation = { ...correlation, sessionId, runId, runAttempt };
    this.observe?.({
      event: "run.queued",
      correlation: executionCorrelation,
      attributes: { reason },
    });
    const prior = this.executions.get(key)?.promise;
    const controller = new AbortController();
    const promise = (prior ?? Promise.resolve())
      .then(() => this.executeRun(sessionId, runId, reason, controller.signal, executionCorrelation))
      .finally(() => {
        if (this.executions.get(key)?.promise !== promise) return;
        this.executions.delete(key);
        try {
          const stored = this.readStoredSession(sessionId, executionCorrelation);
          if (isWorldRunExecuting(this.requireRun(stored, runId).status)) {
            this.loadSession(sessionId, true, executionCorrelation);
          }
        } catch {
          // A later request retries durable recovery when storage becomes readable again.
        }
      });
    this.executions.set(key, { promise, controller });
    void promise.catch(() => undefined);
  }

  private finishRun(
    session: HostedSession,
    runId: string,
    status: Extract<WorldRunStatus, "awaiting_player" | "completed" | "goal_failed" | "step_limit" | "cancelled">,
    engine = session.engine,
    correlation?: RuntimeCorrelation,
    startedAt = Date.now(),
  ): HostedSession {
    const document = structuredClone(session.document);
    const run = document.runs[runId];
    run.status = status;
    run.cancelRequested = false;
    if (status === "cancelled") {
      run.error = undefined;
      run.internalError = undefined;
    }
    this.appendEvent(run, {
      type: `run.${status}` as "run.awaiting_player" | "run.completed" | "run.goal_failed" |
        "run.step_limit" | "run.cancelled",
      payload: { runId: run.id, revision: engine.snapshot.revision, step: engine.snapshot.step },
    }, correlation);
    const committed = this.commitCandidate(session, engine, document, correlation);
    this.observe?.({
      event: "run.finished",
      correlation,
      durationMs: Math.max(0, Date.now() - startedAt),
      attributes: { status },
      measurements: { revision: engine.snapshot.revision, step: engine.snapshot.step },
    });
    this.notifyRun(document.id, run.id, true);
    return committed;
  }

  private cancelExecution(
    session: HostedSession,
    runId: string,
    correlation?: RuntimeCorrelation,
    startedAt = Date.now(),
  ): HostedSession {
    const cancellationKey = this.executionKey(session.document.id, runId);
    this.pendingRunCancellations.add(cancellationKey);
    const engine = this.buildEngine(session.definition, session.engine.snapshot);
    engine.cancelPlayerIntent();
    const committed = this.finishRun(session, runId, "cancelled", engine, correlation, startedAt);
    this.pendingRunCancellations.delete(cancellationKey);
    return committed;
  }

  private async executeRun(
    sessionId: string,
    runId: string,
    reason: ExecutionReason,
    abortSignal: AbortSignal,
    correlation: RuntimeCorrelation,
  ): Promise<void> {
    const startedAt = Date.now();
    let pendingStepCorrelation: RuntimeCorrelation | undefined;
    let rollbackStateHash: string | undefined;
    try {
      let session = this.loadSession(sessionId, false, correlation);
      let document = structuredClone(session.document);
      let run = document.runs[runId];
      if (!run || run.status !== "queued") return;
      run.status = "running";
      const input = [...run.events].reverse().find((event) => event.type === "player.input");
      if (!input || input.type !== "player.input") throw new Error(`run ${runId} has no player input`);
      this.appendEvent(run, {
        type: "run.execution_started",
        payload: { runId, inputId: input.payload.id, reason },
      }, correlation);
      this.observe?.({ event: "run.started", correlation, attributes: { reason } });
      session = this.commitCandidate(session, session.engine, document, correlation);
      this.notifyRun(sessionId, runId);

      for (let index = 0; index < this.maxStepsPerRun; index += 1) {
        if (this.requireRun(session, runId).cancelRequested || abortSignal.aborted) {
          this.cancelExecution(session, runId, correlation, startedAt);
          return;
        }
        const engine = session.engine;
        const baseState = engine.snapshot;
        rollbackStateHash = contentHash(baseState);
        const stepCorrelation = {
          ...correlation,
          stepAttemptId: `${runId}:${correlation.runAttempt ?? 1}:${baseState.revision + 1}`,
          revision: baseState.revision,
          step: baseState.step + 1,
        };
        const result = await engine.step({
          workloadId: sessionId,
          batchId: runId,
          abortSignal,
          correlation: stepCorrelation,
          observer: this.runtimeObserver,
        });
        pendingStepCorrelation = stepCorrelation;
        const latest = this.readStoredSession(sessionId, stepCorrelation);
        if (latest.generation !== session.generation) {
          const latestRun = this.requireRun(latest, runId);
          if (latestRun.cancelRequested || abortSignal.aborted) {
            this.cancelExecution(
              this.loadSession(sessionId, false, correlation),
              runId,
              correlation,
              startedAt,
            );
          }
          else throw new WorldSessionConflictError(sessionId);
          return;
        }

        document = structuredClone(session.document);
        run = document.runs[runId];
        for (const event of publicCommittedStepEvents(result.committed, result.state.truth.elapsedSeconds)) {
          this.appendEvent(run, event, stepCorrelation);
        }
        let terminalStatus: Extract<
          WorldRunStatus,
          "awaiting_player" | "completed" | "goal_failed" | "step_limit"
        > | undefined;
        if (result.requiresPlayerDecision) terminalStatus = "awaiting_player";
        else if (result.state.player.intent?.status === "completed") terminalStatus = "completed";
        else if (result.state.player.intent?.status === "failed") terminalStatus = "goal_failed";
        else if (index === this.maxStepsPerRun - 1) terminalStatus = "step_limit";
        if (terminalStatus) {
          run.status = terminalStatus;
          run.cancelRequested = false;
          this.appendEvent(run, {
            type: `run.${terminalStatus}`,
            payload: { runId, revision: result.state.revision, step: result.state.step },
          }, stepCorrelation);
        }
        session = this.commitCandidate(session, engine, document, {
          ...stepCorrelation,
          revision: result.state.revision,
          step: result.state.step,
        });
        pendingStepCorrelation = undefined;
        rollbackStateHash = undefined;
        this.notifyRun(sessionId, runId, Boolean(terminalStatus));

        if (terminalStatus) {
          this.observe?.({
            event: "run.finished",
            correlation: { ...correlation, revision: result.state.revision, step: result.state.step },
            durationMs: Math.max(0, Date.now() - startedAt),
            attributes: { status: terminalStatus },
          });
          return;
        }

        if (this.requireRun(session, runId).cancelRequested || abortSignal.aborted) {
          this.cancelExecution(session, runId, correlation, startedAt);
          return;
        }
      }
      this.finishRun(session, runId, "step_limit", session.engine, correlation, startedAt);
    } catch (error) {
      const failure = classifyRunFailure(error);
      const failureKey = this.executionKey(sessionId, runId);
      if (failure.kind === "cancelled" || abortSignal.aborted) {
        this.pendingRunCancellations.add(failureKey);
        this.pendingRunFailures.delete(failureKey);
      } else {
        this.pendingRunFailures.set(failureKey, {
          classification: failure,
          internalError: error instanceof Error ? error.message : String(error),
        });
      }
      if (pendingStepCorrelation) {
        this.observe?.({
          event: "step.persistence_rolled_back",
          level: "error",
          correlation: pendingStepCorrelation,
          attributes: { result: "rolled_back", revisionUnchanged: true },
          hashes: rollbackStateHash ? { state: rollbackStateHash } : undefined,
          error: serializeRuntimeError(error),
        });
      }
      let session: HostedSession;
      try {
        session = this.loadSession(sessionId, false, correlation);
      } catch {
        return;
      }
      const current = this.requireRun(session, runId);
      if (current.cancelRequested || abortSignal.aborted || failure.kind === "cancelled") {
        this.pendingRunFailures.delete(failureKey);
        try {
          this.cancelExecution(session, runId, correlation, startedAt);
        } catch {
          // A later request recovers the persisted queued/running run if storage is unavailable here.
        }
        return;
      }
      const document = structuredClone(session.document);
      const run = document.runs[runId];
      if (run.status !== "queued" && run.status !== "running") {
        this.pendingRunFailures.delete(failureKey);
        return;
      }
      run.status = "failed";
      run.internalError = error instanceof Error ? error.message : String(error);
      run.error = failure.publicMessage;
      this.appendEvent(run, {
        type: "run.failed",
        payload: { runId: run.id, message: run.error, retriable: failure.retriable },
      }, correlation);
      this.observe?.({
        event: "run.failed",
        level: "error",
        correlation,
        durationMs: Math.max(0, Date.now() - startedAt),
        attributes: {
          status: "failed",
          revisionUnchanged: true,
          retriable: failure.retriable,
          failureKind: failure.kind,
        },
        error: serializeRuntimeError(error),
      });
      let persisted = false;
      try {
        this.commitCandidate(session, session.engine, document, correlation);
        persisted = true;
        this.pendingRunFailures.delete(failureKey);
      } catch {
        // Recovery marks the still-running durable record as failed on the next request.
      }
      this.notifyRun(sessionId, runId, persisted);
    }
  }

  private requireRun(session: Pick<StoredWorldSession, "document">, runId: string): WorldRunRecord {
    const run = session.document.runs[runId];
    if (!run) throw new WorldHostError(`world run not found: ${runId}`, 404);
    return run;
  }

  private readRunSession(
    sessionId: string,
    runId: string,
    correlation?: RuntimeCorrelation,
  ): StoredWorldSession {
    const stored = this.readStoredSession(sessionId, correlation);
    const run = this.requireRun(stored, runId);
    if (isWorldRunExecuting(run.status) && !this.executions.has(this.executionKey(sessionId, runId))) {
      return this.loadSession(sessionId, true, correlation);
    }
    return stored;
  }

  run(sessionId: string, runId: string, correlation?: RuntimeCorrelation): WorldRunSnapshot {
    const session = this.readRunSession(sessionId, runId, correlation);
    return publicWorldRunSnapshot(session.document, this.requireRun(session, runId));
  }

  cancelRun(sessionId: string, runId: string, correlation?: RuntimeCorrelation): WorldRunSnapshot {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      let session = this.loadSession(sessionId, true, correlation);
      const current = this.requireRun(session, runId);
      if (!isWorldRunActiveIntentOwner(current.status) || current.cancelRequested) {
        return publicWorldRunSnapshot(session.document, current);
      }
      try {
        if (current.status === "awaiting_player" || current.status === "failed" || current.status === "step_limit") {
          session = this.cancelExecution(session, runId, correlation);
          return publicWorldRunSnapshot(session.document, session.document.runs[runId]);
        } else {
          const document = structuredClone(session.document);
          document.runs[runId].cancelRequested = true;
          session = this.commitCandidate(session, session.engine, document, correlation);
          this.executions.get(this.executionKey(sessionId, runId))?.controller.abort();
          this.observe?.({
            event: "run.cancel_requested",
            correlation: { ...correlation, sessionId, runId, revision: session.engine.snapshot.revision },
            attributes: { status: current.status },
          });
        }
        this.notifyRun(sessionId, runId);
        return publicWorldRunSnapshot(session.document, session.document.runs[runId]);
      } catch (error) {
        if (!(error instanceof WorldSessionConflictError)) throw error;
      }
    }
    throw new WorldHostError("world session kept changing while cancellation was requested", 409);
  }

  async *subscribeRunEvents(
    sessionId: string,
    runId: string,
    afterSequence = 0,
    signal?: AbortSignal,
  ): AsyncGenerator<WorldRunEvent> {
    if (!Number.isSafeInteger(afterSequence) || afterSequence < 0) {
      throw new WorldHostError("event cursor must be a non-negative safe integer", 400);
    }
    if (signal?.aborted) return;
    const initialRun = this.requireRun(this.readRunSession(sessionId, runId), runId);
    const initialTail = initialRun.events.at(-1)?.sequence ?? 0;
    if (afterSequence > initialTail) {
      throw new WorldHostError(`event cursor ${afterSequence} is ahead of run ${runId}`, 409);
    }
    const channel = this.channel(sessionId, runId);
    let cursor = afterSequence;
    while (!signal?.aborted) {
      const channelVersion = channel.currentVersion;
      const session = this.readRunSession(sessionId, runId);
      const run = this.requireRun(session, runId);
      const available = run.events.filter((event) => event.sequence > cursor);
      for (const event of available) {
        cursor = event.sequence;
        yield structuredClone(event);
        if (streamBoundaryEventTypes.has(event.type)) {
          const key = this.executionKey(sessionId, runId);
          if (this.channels.get(key) === channel) this.channels.delete(key);
          return;
        }
      }
      if (isWorldRunStreamBoundary(run.status) && cursor >= (run.events.at(-1)?.sequence ?? 0)) {
        const key = this.executionKey(sessionId, runId);
        if (this.channels.get(key) === channel) this.channels.delete(key);
        return;
      }
      await channel.wait(channelVersion, signal);
    }
  }

  async waitForRun(sessionId: string, runId: string): Promise<WorldRunSnapshot> {
    const execution = this.executions.get(this.executionKey(sessionId, runId));
    if (execution) {
      await execution.promise.catch(() => undefined);
      return this.run(sessionId, runId);
    }
    for await (const event of this.subscribeRunEvents(sessionId, runId)) void event;
    return this.run(sessionId, runId);
  }
}
