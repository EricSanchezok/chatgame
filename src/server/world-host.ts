import { randomUUID } from "node:crypto";
import path from "node:path";
import { AgentMind } from "../engine/agent-mind";
import { createStructuredModelProvider, type StructuredModelProvider } from "../engine/model-provider";
import { SimulationEngine } from "../engine/simulation";
import { TruthEngine } from "../engine/truth-engine";
import type { WorldDefinition } from "../engine/world-definition";
import { FileWorldRepository, type WorldRepository } from "../script/world-repository";
import {
  FileWorldSessionStore,
  WorldSessionNotFoundError,
  type WorldSessionStore,
} from "./world-session-store";
import {
  publicSessionSnapshot,
  type PublicObservationPacket,
  type PublicSessionSnapshot,
  type WorldRunEvent,
  type WorldRunEventInput,
  type WorldRunRecord,
  type WorldRunStatus,
  type WorldSessionDocument,
} from "./world-run-types";

interface HostedSession {
  definition: WorldDefinition;
  engine: SimulationEngine;
  document: WorldSessionDocument;
  channels: Map<string, RunChannel>;
}

const terminalStatuses = new Set<WorldRunStatus>([
  "awaiting_player",
  "completed",
  "goal_failed",
  "step_limit",
  "cancelled",
  "failed",
]);

class RunChannel {
  private readonly waiters = new Set<() => void>();

  notify(): void {
    for (const waiter of this.waiters) waiter();
    this.waiters.clear();
  }

  async wait(signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) return;
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
): PublicObservationPacket {
  return {
    ...structuredClone(packet),
    observerId: "player",
    introductions: packet.introductions.map((introduction) => ({
      localEntity: structuredClone(introduction.localEntity),
    })),
  };
}

export class WorldHost {
  private static singleton: WorldHost | undefined;
  private readonly sessions = new Map<string, HostedSession>();
  private readonly executions = new Map<string, Promise<void>>();
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
      const repository = new FileWorldRepository(
        path.resolve(/* turbopackIgnore: true */ process.env.CHATGAME_SCRIPTS_ROOT ?? "scripts"),
      );
      const store = new FileWorldSessionStore(
        path.resolve(/* turbopackIgnore: true */ process.env.CHATGAME_DATA_ROOT ?? ".chatgame"),
      );
      this.singleton = new WorldHost({
        repository,
        store,
        provider: createStructuredModelProvider(),
      });
    }
    return this.singleton;
  }

  static setForTests(host: WorldHost | undefined): void {
    this.singleton = host;
  }

  listWorlds() {
    return this.options.repository.list().map((summary) => ({
      id: summary.id,
      name: summary.name,
      version: summary.version,
      description: summary.description,
    }));
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
  ): void {
    document.state = engine.snapshot;
    document.updatedAt = this.now().toISOString();
    this.options.store.write(document);
    session.engine = engine;
    session.document = document;
  }

  private recoverInterruptedRuns(session: HostedSession): void {
    const document = structuredClone(session.document);
    let changed = false;
    for (const run of Object.values(document.runs)) {
      if (run.status !== "queued" && run.status !== "running") continue;
      run.status = "failed";
      run.error = "运行进程在世界步骤边界外中断，可安全重试。";
      this.appendEvent(run, {
        type: "run.failed",
        payload: { runId: run.id, message: run.error, retriable: true },
      });
      changed = true;
    }
    if (changed) this.commitCandidate(session, session.engine, document);
  }

  private requireSession(sessionId: string): HostedSession {
    const current = this.sessions.get(sessionId);
    if (current) return current;
    let document: WorldSessionDocument;
    try {
      document = this.options.store.read(sessionId);
    } catch (error) {
      if (!(error instanceof WorldSessionNotFoundError)) throw error;
      throw new WorldHostError(`world session not found: ${sessionId}`, 404);
    }
    const definition = this.options.repository.load(document.scriptId, document.state.rng.seed);
    const session: HostedSession = {
      definition,
      engine: this.buildEngine(definition, document.state),
      document,
      channels: new Map(),
    };
    for (const runId of Object.keys(document.runs)) session.channels.set(runId, new RunChannel());
    this.recoverInterruptedRuns(session);
    this.sessions.set(sessionId, session);
    return session;
  }

  async createSession(input: { scriptId: string; seed?: number }): Promise<PublicSessionSnapshot> {
    const definition = this.options.repository.load(input.scriptId, input.seed ?? 1);
    const engine = this.buildEngine(definition);
    await engine.bootstrapAgents();
    const id = this.idFactory();
    const now = this.now().toISOString();
    const document: WorldSessionDocument = {
      schemaVersion: 1,
      id,
      scriptId: definition.id,
      createdAt: now,
      updatedAt: now,
      state: engine.snapshot,
      runs: {},
    };
    this.options.store.write(document);
    const session: HostedSession = { definition, engine, document, channels: new Map() };
    this.sessions.set(id, session);
    return publicSessionSnapshot(document);
  }

  session(sessionId: string): PublicSessionSnapshot {
    return publicSessionSnapshot(this.requireSession(sessionId).document);
  }

  listSessions(): PublicSessionSnapshot[] {
    return this.options.store.list().map((sessionId) => this.session(sessionId));
  }

  startRun(sessionId: string, text: string): WorldRunRecord {
    const normalized = text.trim();
    if (!normalized) throw new WorldHostError("run input cannot be empty", 400);
    const session = this.requireSession(sessionId);
    const active = Object.values(session.document.runs).find(
      (run) => run.status === "queued" || run.status === "running",
    );
    if (active) throw new WorldHostError(`session already has active run ${active.id}`, 409);

    const engine = this.buildEngine(session.definition, session.engine.snapshot);
    if (engine.snapshot.player.intent?.status === "active") {
      engine.cancelPlayerIntent();
    }
    engine.beginPlayerIntent(normalized);
    const id = this.idFactory();
    const now = this.now().toISOString();
    const run: WorldRunRecord = {
      id,
      sessionId,
      text: normalized,
      status: "queued",
      createdAt: now,
      updatedAt: now,
      cancelRequested: false,
      events: [],
    };
    const document = structuredClone(session.document);
    document.runs[id] = run;
    this.commitCandidate(session, engine, document);
    session.channels.set(id, new RunChannel());
    const response = structuredClone(session.document.runs[id]);
    this.scheduleExecution(session, id);
    return response;
  }

  retryRun(sessionId: string, runId: string): WorldRunRecord {
    const session = this.requireSession(sessionId);
    const current = this.requireRun(session, runId);
    if (current.status !== "failed" && current.status !== "step_limit") {
      throw new WorldHostError(`run ${runId} is not retriable`, 409);
    }
    if (session.engine.snapshot.player.intent?.status !== "active") {
      throw new WorldHostError(`run ${runId} has no active player intent`, 409);
    }
    const document = structuredClone(session.document);
    const run = document.runs[runId];
    run.status = "queued";
    run.error = undefined;
    run.cancelRequested = false;
    this.commitCandidate(session, session.engine, document);
    const response = structuredClone(session.document.runs[runId]);
    this.scheduleExecution(session, runId);
    return response;
  }

  private scheduleExecution(session: HostedSession, runId: string): void {
    const key = `${session.document.id}:${runId}`;
    const execution = this.executeRun(session, runId).finally(() => this.executions.delete(key));
    this.executions.set(key, execution);
  }

  private finishRun(
    session: HostedSession,
    runId: string,
    status: Extract<WorldRunStatus, "awaiting_player" | "completed" | "goal_failed" | "step_limit" | "cancelled">,
    engine = session.engine,
  ): void {
    const document = structuredClone(session.document);
    const run = document.runs[runId];
    run.status = status;
    this.appendEvent(run, {
      type: `run.${status}` as Exclude<WorldRunEvent["type"], "run.started" | "check.resolved" | "player.observation" | "step.committed" | "run.failed">,
      payload: {
        runId: run.id,
        revision: engine.snapshot.revision,
        step: engine.snapshot.step,
      },
    } as WorldRunEventInput);
    this.commitCandidate(session, engine, document);
    session.channels.get(run.id)?.notify();
  }

  private async executeRun(session: HostedSession, runId: string): Promise<void> {
    try {
      let document = structuredClone(session.document);
      let run = document.runs[runId];
      run.status = "running";
      this.appendEvent(run, { type: "run.started", payload: { runId: run.id, text: run.text } });
      this.commitCandidate(session, session.engine, document);
      session.channels.get(run.id)?.notify();

      for (let index = 0; index < this.maxStepsPerRun; index += 1) {
        if (this.requireRun(session, runId).cancelRequested) {
          const engine = this.buildEngine(session.definition, session.engine.snapshot);
          engine.cancelPlayerIntent();
          this.finishRun(session, runId, "cancelled", engine);
          return;
        }
        const engine = this.buildEngine(session.definition, session.engine.snapshot);
        const result = await engine.step();
        document = structuredClone(session.document);
        run = document.runs[runId];
        for (const check of result.committed.checks) {
          if (check.visibility === "hidden") continue;
          this.appendEvent(run, {
            type: "check.resolved",
            payload: check.visibility === "full"
              ? {
                  requestId: check.requestId,
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
                  requestId: check.requestId,
                  visibility: "result_only",
                  succeeded: check.succeeded,
                },
          });
        }
        for (const packet of result.committed.observations) {
          if (packet.observerId !== "player") continue;
          this.appendEvent(run, { type: "player.observation", payload: sanitizePlayerObservation(packet) });
        }
        this.appendEvent(run, {
          type: "step.committed",
          payload: {
            revision: result.state.revision,
            step: result.state.step,
            elapsedSeconds: result.state.truth.elapsedSeconds,
          },
        });
        this.commitCandidate(session, engine, document);
        session.channels.get(run.id)?.notify();

        if (this.requireRun(session, runId).cancelRequested) {
          const cancelledEngine = this.buildEngine(session.definition, session.engine.snapshot);
          cancelledEngine.cancelPlayerIntent();
          this.finishRun(session, runId, "cancelled", cancelledEngine);
          return;
        }
        if (result.requiresPlayerDecision) {
          this.finishRun(session, runId, "awaiting_player");
          return;
        }
        const intentStatus = result.state.player.intent?.status;
        if (intentStatus === "completed") {
          this.finishRun(session, runId, "completed");
          return;
        }
        if (intentStatus === "failed") {
          this.finishRun(session, runId, "goal_failed");
          return;
        }
      }
      this.finishRun(session, runId, "step_limit");
    } catch (error) {
      const document = structuredClone(session.document);
      const run = document.runs[runId];
      run.status = "failed";
      run.error = error instanceof Error ? error.message : String(error);
      this.appendEvent(run, {
        type: "run.failed",
        payload: { runId: run.id, message: run.error, retriable: true },
      });
      try {
        this.commitCandidate(session, session.engine, document);
      } catch (persistenceError) {
        run.error = `${run.error}; failed to persist run failure: ${persistenceError instanceof Error ? persistenceError.message : String(persistenceError)}`;
        document.state = session.engine.snapshot;
        session.document = document;
      }
      session.channels.get(run.id)?.notify();
    }
  }

  private requireRun(session: HostedSession, runId: string): WorldRunRecord {
    const run = session.document.runs[runId];
    if (!run) throw new WorldHostError(`world run not found: ${runId}`, 404);
    return run;
  }

  run(sessionId: string, runId: string): WorldRunRecord {
    return structuredClone(this.requireRun(this.requireSession(sessionId), runId));
  }

  cancelRun(sessionId: string, runId: string): WorldRunRecord {
    const session = this.requireSession(sessionId);
    const current = this.requireRun(session, runId);
    if (terminalStatuses.has(current.status)) return structuredClone(current);
    const document = structuredClone(session.document);
    const run = document.runs[runId];
    run.cancelRequested = true;
    this.commitCandidate(session, session.engine, document);
    session.channels.get(run.id)?.notify();
    return structuredClone(run);
  }

  async *subscribeRunEvents(
    sessionId: string,
    runId: string,
    afterSequence = 0,
    signal?: AbortSignal,
  ): AsyncGenerator<WorldRunEvent> {
    const session = this.requireSession(sessionId);
    this.requireRun(session, runId);
    const channel = session.channels.get(runId) ?? new RunChannel();
    session.channels.set(runId, channel);
    let cursor = afterSequence;
    while (!signal?.aborted) {
      const run = this.requireRun(session, runId);
      const available = run.events.filter((event) => event.sequence > cursor);
      for (const event of available) {
        cursor = event.sequence;
        yield structuredClone(event);
      }
      if (terminalStatuses.has(run.status) && cursor >= (run.events.at(-1)?.sequence ?? 0)) return;
      await channel.wait(signal);
    }
  }

  async waitForRun(sessionId: string, runId: string): Promise<WorldRunRecord> {
    for await (const event of this.subscribeRunEvents(sessionId, runId)) {
      // Drain until the terminal event closes the iterator.
      void event;
    }
    return this.run(sessionId, runId);
  }
}
