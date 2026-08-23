import { randomUUID } from "node:crypto";
import path from "node:path";
import { AgentMind } from "../engine/agent-mind";
import { loadModelCatalog } from "../engine/model-catalog";
import { createModelGateway } from "../engine/model-gateway";
import { canonicalize } from "../engine/model-audit";
import type { StructuredModelProvider } from "../engine/model-provider";
import { createCoreRulePackageRegistry } from "../engine/rule-package";
import { SimulationEngine } from "../engine/simulation";
import { TruthEngine } from "../engine/truth-engine";
import {
  validateWorldDefinition,
  validateWorldModelProfiles,
  toWorldRuntimeContract,
  type WorldDefinition,
} from "../engine/world-definition";
import type { WorldRepository } from "../script/world-repository";
import type { ContinueWorldRunInput, StartWorldRunResponse, WorldRunSnapshot } from "../shared/world-api";
import { LocalDatabase } from "./local-database";
import type { WorldImportResult } from "./world-import";
import {
  WorldSessionConflictError,
  WorldSessionNotFoundError,
  type StoredWorldSession,
  type WorldSessionStore,
} from "./world-session-store";
import {
  publicSessionSnapshot,
  publicWorldRunSnapshot,
  type PublicObservationPacket,
  type PublicSessionSnapshot,
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

interface WorldImporter {
  importWorld(buffer: Buffer, modelCatalog: StructuredModelProvider["catalog"], replace?: boolean): WorldImportResult;
}

type ExecutionReason = "initial" | "player_input" | "retry";

const streamClosingStatuses = new Set<WorldRunStatus>([
  "awaiting_player", "completed", "goal_failed", "step_limit", "cancelled", "failed",
]);
const finalStatuses = new Set<WorldRunStatus>(["completed", "goal_failed", "cancelled"]);
const inputIdPattern = /^[a-zA-Z0-9][a-zA-Z0-9:_-]{0,127}$/;

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
  importer?: WorldImporter;
  now?: () => Date;
  idFactory?: () => string;
  maxStepsPerRun?: number;
}

export class WorldHostError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "WorldHostError";
  }
}

function sanitizePlayerObservation(
  packet: import("../engine/model").ObservationPacket,
  packetIndex: number,
): PublicObservationPacket {
  return {
    id: `observation:${packet.step}:${packetIndex + 1}`,
    observerId: "player",
    step: packet.step,
    summary: packet.summary,
    introductions: packet.introductions.map((introduction) => ({
      localEntity: structuredClone(introduction.localEntity),
    })),
    apparentClaims: packet.apparentClaims.map((claim, claimIndex) => ({
      ...structuredClone(claim),
      id: `claim:${packet.step}:${packetIndex + 1}:${claimIndex + 1}`,
    })),
    sourceEventIds: packet.sourceEventIds.map((_eventId, eventIndex) =>
      `event:${packet.step}:${packetIndex + 1}:${eventIndex + 1}`),
  };
}

export class WorldHost {
  private static singleton: WorldHost | undefined;
  private readonly executions = new Map<string, HostedExecution>();
  private readonly channels = new Map<string, RunChannel>();
  private readonly now: () => Date;
  private readonly idFactory: () => string;
  private readonly maxStepsPerRun: number;

  constructor(private readonly options: WorldHostOptions) {
    this.now = options.now ?? (() => new Date());
    this.idFactory = options.idFactory ?? randomUUID;
    this.maxStepsPerRun = options.maxStepsPerRun ?? 100;
  }

  static get(): WorldHost {
    if (!this.singleton) {
      const catalog = loadModelCatalog(path.resolve(
        /* turbopackIgnore: true */ process.env.LIVINGWORLD_MODEL_CATALOG_PATH ?? "config/models.yaml",
      ));
      const dataRoot = path.resolve(
        path.resolve(/* turbopackIgnore: true */ process.env.LIVINGWORLD_DATA_ROOT ?? ".livingworld"),
      );
      const database = new LocalDatabase(path.join(dataRoot, "livingworld.sqlite"));
      this.singleton = new WorldHost({
        repository: database,
        store: database,
        importer: database,
        provider: createModelGateway(catalog),
      });
    }
    return this.singleton;
  }

  static setForTests(host: WorldHost | undefined): void {
    this.singleton = host;
  }

  private executionKey(sessionId: string, runId: string): string {
    return `${sessionId}:${runId}`;
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

  importWorld(buffer: Buffer, replace = false): WorldImportResult {
    if (!this.options.importer) throw new WorldHostError("world import is unavailable", 501);
    return this.options.importer.importWorld(buffer, this.options.provider.catalog, replace);
  }

  private definitionFrom(document: WorldSessionDocument): WorldDefinition {
    const rulePackages = createCoreRulePackageRegistry().validate(document.world.rulePackages.map((reference) => ({
      id: reference.id,
      version: reference.version,
      config: reference.config,
    })));
    if (JSON.stringify(canonicalize(rulePackages)) !== JSON.stringify(canonicalize(document.world.rulePackages))) {
      throw new Error("session rule package contract is incompatible with this runtime");
    }
    const definition: WorldDefinition = {
      ...structuredClone(document.world),
      rulePackages,
      initialState: structuredClone(document.state),
    };
    validateWorldDefinition(definition);
    validateWorldModelProfiles(definition, this.options.provider.catalog);
    return definition;
  }

  private buildEngine(definition: WorldDefinition, state = definition.initialState): SimulationEngine {
    return new SimulationEngine(
      definition,
      new TruthEngine(this.options.provider),
      new AgentMind(this.options.provider),
      state,
    );
  }

  private appendEvent(run: WorldRunRecord, input: WorldRunEventInput): WorldRunEvent {
    const event = {
      ...input,
      sequence: (run.events.at(-1)?.sequence ?? 0) + 1,
      at: this.now().toISOString(),
    } as WorldRunEvent;
    run.events.push(event);
    run.updatedAt = event.at;
    return event;
  }

  private commitCandidate(
    session: HostedSession,
    engine: SimulationEngine,
    document: WorldSessionDocument,
  ): HostedSession {
    document.state = engine.snapshot;
    document.updatedAt = this.now().toISOString();
    const stored = this.options.store.compareAndSwap(session.document.id, session.generation, document);
    return { ...stored, definition: session.definition, engine };
  }

  private commitRequest(
    session: HostedSession,
    engine: SimulationEngine,
    document: WorldSessionDocument,
  ): HostedSession {
    try {
      return this.commitCandidate(session, engine, document);
    } catch (error) {
      if (error instanceof WorldSessionConflictError) {
        throw new WorldHostError("world session changed concurrently; retry the request", 409);
      }
      throw error;
    }
  }

  private loadSession(sessionId: string, recover = true): HostedSession {
    let stored: StoredWorldSession;
    try {
      stored = this.options.store.read(sessionId);
    } catch (error) {
      if (!(error instanceof WorldSessionNotFoundError)) throw error;
      throw new WorldHostError(`world session not found: ${sessionId}`, 404);
    }
    const definition = this.definitionFrom(stored.document);
    let session: HostedSession = {
      ...stored,
      definition,
      engine: this.buildEngine(definition, stored.document.state),
    };
    if (!recover) return session;

    const document = structuredClone(session.document);
    let changed = false;
    const recoveredRunIds: string[] = [];
    for (const run of Object.values(document.runs)) {
      if (run.status !== "queued" && run.status !== "running") continue;
      if (this.executions.has(this.executionKey(sessionId, run.id))) continue;
      run.status = "failed";
      run.error = "运行进程在世界步骤边界外中断，可安全重试。";
      run.internalError = "process interrupted while run was queued or running";
      this.appendEvent(run, {
        type: "run.failed",
        payload: { runId: run.id, message: run.error, retriable: true },
      });
      changed = true;
      recoveredRunIds.push(run.id);
    }
    if (changed) {
      try {
        session = this.commitCandidate(session, session.engine, document);
      } catch (error) {
        if (!(error instanceof WorldSessionConflictError)) throw error;
        session = this.loadSession(sessionId, false);
      }
      for (const runId of recoveredRunIds) {
        this.notifyRun(sessionId, runId, streamClosingStatuses.has(this.requireRun(session, runId).status));
      }
    }
    return session;
  }

  async createSession(input: { worldId: string; seed?: number }): Promise<PublicSessionSnapshot> {
    const definition = this.options.repository.load(input.worldId, input.seed ?? 1, this.options.provider.catalog);
    const engine = this.buildEngine(definition);
    const id = this.idFactory();
    await engine.bootstrapAgents({ workloadId: id, batchId: `bootstrap:${id}` });
    const now = this.now().toISOString();
    const document: WorldSessionDocument = {
      schemaVersion: 4,
      id,
      world: toWorldRuntimeContract(definition),
      createdAt: now,
      updatedAt: now,
      state: engine.snapshot,
      runs: {},
    };
    this.options.store.create(document);
    return publicSessionSnapshot(document);
  }

  session(sessionId: string): PublicSessionSnapshot {
    return publicSessionSnapshot(this.loadSession(sessionId).document);
  }

  listSessions(): PublicSessionSnapshot[] {
    return this.options.store.listSessions().map(({ document }) => publicSessionSnapshot(document));
  }

  startRun(sessionId: string, text: string): StartWorldRunResponse {
    const normalized = text.trim();
    if (!normalized) throw new WorldHostError("run input cannot be empty", 400);
    if (text.length > 4_000) throw new WorldHostError("run input must be 4000 characters or fewer", 400);
    let session = this.loadSession(sessionId);
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
    this.appendEvent(run, { type: "player.input", payload: { id: inputId, kind: "goal", text: normalized } });
    const document = structuredClone(session.document);
    document.runs[id] = run;
    session = this.commitRequest(session, engine, document);
    this.scheduleExecution(sessionId, id, "initial");
    return { runId: id };
  }

  continueRun(sessionId: string, runId: string, input: ContinueWorldRunInput): WorldRunSnapshot {
    const normalized = input.text.trim();
    if (!inputIdPattern.test(input.id)) throw new WorldHostError("player input id is invalid", 400);
    if (!normalized) throw new WorldHostError("player input cannot be empty", 400);
    if (input.text.length > 4_000) throw new WorldHostError("player input must be 4000 characters or fewer", 400);
    let session = this.loadSession(sessionId);
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
    });
    try {
      session = this.commitCandidate(session, engine, document);
    } catch (error) {
      if (!(error instanceof WorldSessionConflictError)) throw error;
      const latest = this.loadSession(sessionId, false);
      const latestRun = this.requireRun(latest, runId);
      const persistedInput = latestRun.events.find((event) =>
        event.type === "player.input" && event.payload.id === input.id);
      if (persistedInput?.type === "player.input" && persistedInput.payload.text === normalized) {
        return publicWorldRunSnapshot(latest.document, latestRun);
      }
      throw new WorldHostError("world session changed concurrently; retry the request", 409);
    }
    this.scheduleExecution(sessionId, runId, "player_input");
    return publicWorldRunSnapshot(session.document, session.document.runs[runId]);
  }

  retryRun(sessionId: string, runId: string): WorldRunSnapshot {
    let session = this.loadSession(sessionId);
    const current = this.requireRun(session, runId);
    if (current.status !== "failed" && current.status !== "step_limit") {
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
    session = this.commitRequest(session, session.engine, document);
    this.scheduleExecution(sessionId, runId, "retry");
    return publicWorldRunSnapshot(session.document, session.document.runs[runId]);
  }

  private scheduleExecution(sessionId: string, runId: string, reason: ExecutionReason): void {
    const key = this.executionKey(sessionId, runId);
    const prior = this.executions.get(key)?.promise;
    const controller = new AbortController();
    const promise = (prior ?? Promise.resolve())
      .then(() => this.executeRun(sessionId, runId, reason, controller.signal))
      .finally(() => {
        if (this.executions.get(key)?.promise !== promise) return;
        this.executions.delete(key);
        try {
          this.loadSession(sessionId);
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
    });
    const committed = this.commitCandidate(session, engine, document);
    this.notifyRun(document.id, run.id, true);
    return committed;
  }

  private cancelExecution(session: HostedSession, runId: string): HostedSession {
    const engine = this.buildEngine(session.definition, session.engine.snapshot);
    engine.cancelPlayerIntent();
    return this.finishRun(session, runId, "cancelled", engine);
  }

  private async executeRun(
    sessionId: string,
    runId: string,
    reason: ExecutionReason,
    abortSignal: AbortSignal,
  ): Promise<void> {
    try {
      let session = this.loadSession(sessionId, false);
      let document = structuredClone(session.document);
      let run = document.runs[runId];
      if (!run || run.status !== "queued") return;
      run.status = "running";
      const input = [...run.events].reverse().find((event) => event.type === "player.input");
      if (!input || input.type !== "player.input") throw new Error(`run ${runId} has no player input`);
      this.appendEvent(run, {
        type: "run.execution_started",
        payload: { runId, inputId: input.payload.id, reason },
      });
      session = this.commitCandidate(session, session.engine, document);
      this.notifyRun(sessionId, runId);

      for (let index = 0; index < this.maxStepsPerRun; index += 1) {
        if (this.requireRun(session, runId).cancelRequested || abortSignal.aborted) {
          this.cancelExecution(session, runId);
          return;
        }
        const engine = this.buildEngine(session.definition, session.engine.snapshot);
        const result = await engine.step({ workloadId: sessionId, batchId: runId, abortSignal });
        const latest = this.loadSession(sessionId, false);
        if (latest.generation !== session.generation) {
          const latestRun = this.requireRun(latest, runId);
          if (latestRun.cancelRequested || abortSignal.aborted) this.cancelExecution(latest, runId);
          else throw new WorldSessionConflictError(sessionId);
          return;
        }

        document = structuredClone(session.document);
        run = document.runs[runId];
        for (const [checkIndex, check] of result.committed.checks.entries()) {
          if (check.visibility === "hidden") continue;
          this.appendEvent(run, {
            type: "check.resolved",
            payload: check.visibility === "full"
              ? {
                  requestId: `check:${result.state.step}:${checkIndex + 1}`,
                  visibility: "full",
                  dice: check.dice,
                  kept: check.kept,
                  modifier: check.modifier,
                  total: check.total,
                  dc: check.dc,
                  succeeded: check.succeeded,
                  margin: check.margin,
                }
              : {
                  requestId: `check:${result.state.step}:${checkIndex + 1}`,
                  visibility: "result_only",
                  succeeded: check.succeeded,
                },
          });
        }
        const playerAction = result.committed.actions.find((action) => action.actorId === "player")!;
        const playerOutcome = result.committed.outcomes.find((outcome) => outcome.proposalId === playerAction.id)!;
        this.appendEvent(run, {
          type: "player.outcome",
          payload: {
            status: playerOutcome.status,
            summary: playerOutcome.summary,
            knownAlternatives: playerOutcome.knownAlternatives.map((alternative) => alternative.description),
          },
        });
        const playerPackets = result.committed.observations.filter((packet) => packet.observerId === "player");
        for (const [packetIndex, packet] of playerPackets.entries()) {
          this.appendEvent(run, {
            type: "player.observation",
            payload: sanitizePlayerObservation(packet, packetIndex),
          });
        }
        this.appendEvent(run, {
          type: "step.committed",
          payload: {
            revision: result.state.revision,
            step: result.state.step,
            elapsedSeconds: result.state.truth.elapsedSeconds,
          },
        });
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
          });
        }
        session = this.commitCandidate(session, engine, document);
        this.notifyRun(sessionId, runId, Boolean(terminalStatus));

        if (terminalStatus) return;

        if (this.requireRun(session, runId).cancelRequested || abortSignal.aborted) {
          this.cancelExecution(session, runId);
          return;
        }
      }
      this.finishRun(session, runId, "step_limit");
    } catch (error) {
      let session: HostedSession;
      try {
        session = this.loadSession(sessionId, false);
      } catch {
        return;
      }
      const current = this.requireRun(session, runId);
      if (current.cancelRequested || abortSignal.aborted || (error instanceof Error && error.name === "AbortError")) {
        try {
          this.cancelExecution(session, runId);
        } catch {
          // A later request recovers the persisted queued/running run if storage is unavailable here.
        }
        return;
      }
      const document = structuredClone(session.document);
      const run = document.runs[runId];
      if (run.status !== "queued" && run.status !== "running") return;
      run.status = "failed";
      run.internalError = error instanceof Error ? error.message : String(error);
      run.error = "模型或世界验证失败；当前步骤未提交，可从同一世界状态重试。";
      this.appendEvent(run, {
        type: "run.failed",
        payload: { runId: run.id, message: run.error, retriable: true },
      });
      let persisted = false;
      try {
        this.commitCandidate(session, session.engine, document);
        persisted = true;
      } catch {
        // Recovery marks the still-running durable record as failed on the next request.
      }
      this.notifyRun(sessionId, runId, persisted);
    }
  }

  private requireRun(session: HostedSession, runId: string): WorldRunRecord {
    const run = session.document.runs[runId];
    if (!run) throw new WorldHostError(`world run not found: ${runId}`, 404);
    return run;
  }

  run(sessionId: string, runId: string): WorldRunSnapshot {
    const session = this.loadSession(sessionId);
    return publicWorldRunSnapshot(session.document, this.requireRun(session, runId));
  }

  cancelRun(sessionId: string, runId: string): WorldRunSnapshot {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      let session = this.loadSession(sessionId);
      const current = this.requireRun(session, runId);
      if (finalStatuses.has(current.status) || current.cancelRequested) {
        return publicWorldRunSnapshot(session.document, current);
      }
      try {
        if (current.status === "awaiting_player" || current.status === "failed" || current.status === "step_limit") {
          session = this.cancelExecution(session, runId);
          return publicWorldRunSnapshot(session.document, session.document.runs[runId]);
        } else {
          const document = structuredClone(session.document);
          document.runs[runId].cancelRequested = true;
          session = this.commitCandidate(session, session.engine, document);
          this.executions.get(this.executionKey(sessionId, runId))?.controller.abort();
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
    if (signal?.aborted) return;
    this.requireRun(this.loadSession(sessionId), runId);
    const channel = this.channel(sessionId, runId);
    let cursor = afterSequence;
    while (!signal?.aborted) {
      const channelVersion = channel.currentVersion;
      const session = this.loadSession(sessionId);
      const run = this.requireRun(session, runId);
      const available = run.events.filter((event) => event.sequence > cursor);
      for (const event of available) {
        cursor = event.sequence;
        yield structuredClone(event);
      }
      if (streamClosingStatuses.has(run.status) && cursor >= (run.events.at(-1)?.sequence ?? 0)) {
        const key = this.executionKey(sessionId, runId);
        if (this.channels.get(key) === channel) this.channels.delete(key);
        return;
      }
      await channel.wait(channelVersion, signal);
    }
  }

  async waitForRun(sessionId: string, runId: string): Promise<WorldRunSnapshot> {
    for await (const event of this.subscribeRunEvents(sessionId, runId)) void event;
    return this.run(sessionId, runId);
  }
}
