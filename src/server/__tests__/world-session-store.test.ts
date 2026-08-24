import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { AgentMind } from "../../engine/agent-mind";
import { contentHash } from "../../engine/model-audit";
import { RecordingRuntimeObserver } from "../../engine/observability";
import { DeterministicModelProvider } from "../../engine/testing/model-provider";
import { SimulationEngine } from "../../engine/simulation";
import { TruthEngine } from "../../engine/truth-engine";
import { toWorldRuntimeContract } from "../../engine/world-definition";
import { loadWorldScript } from "../../script/world-loader";
import { LocalDatabase, LocalDatabaseInUseError } from "../local-database";
import { publicCommittedStepEvents, type WorldSessionDocument } from "../world-run-types";
import {
  MemoryWorldSessionStore,
  WorldSessionConflictError,
  WorldSessionNotFoundError,
} from "../world-session-store";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function temporaryDatabase(): string {
  const root = mkdtempSync(path.join(tmpdir(), "livingworld-session-store-"));
  roots.push(root);
  return path.join(root, "livingworld.sqlite");
}

async function sessionDocument(id = "session-1", committed = false): Promise<WorldSessionDocument> {
  const provider = new DeterministicModelProvider();
  const definition = loadWorldScript(path.resolve("test/fixtures/open-world-script"), {
    seed: 17,
    modelCatalog: provider.catalog,
  });
  const engine = new SimulationEngine(definition, new TruthEngine(provider), new AgentMind(provider));
  await engine.bootstrapAgents();
  if (committed) {
    engine.beginPlayerIntent("推进一个可审计步骤");
    await engine.step();
  }
  const state = engine.snapshot;
  const intent = state.player.intent;
  const runId = "run-1";
  const publicStepEvents = state.history[0]
    ? publicCommittedStepEvents(state.history[0], state.truth.elapsedSeconds)
    : [];
  return {
    schemaVersion: 9,
    id,
    world: toWorldRuntimeContract(definition),
    title: definition.name,
    createdAt: "2026-08-23T00:00:00.000Z",
    updatedAt: committed ? "2026-08-23T00:00:01.000Z" : "2026-08-23T00:00:00.000Z",
    state,
    runs: committed && intent ? {
      [runId]: {
        id: runId,
        sessionId: id,
        intentId: intent.id,
        status: "completed",
        createdAt: "2026-08-23T00:00:00.000Z",
        updatedAt: "2026-08-23T00:00:01.000Z",
        cancelRequested: false,
        events: [
          {
            sequence: 1,
            type: "player.input",
            at: "2026-08-23T00:00:00.000Z",
            payload: { id: intent.latestInput.id, kind: "goal", text: intent.goal },
          },
          {
            sequence: 2,
            type: "run.execution_started",
            at: "2026-08-23T00:00:00.000Z",
            payload: { runId, inputId: intent.latestInput.id, reason: "initial" },
          },
          ...publicStepEvents.map((event, index) => ({
            ...event,
            sequence: 3 + index,
            at: "2026-08-23T00:00:01.000Z",
          })),
          {
            sequence: 3 + publicStepEvents.length,
            type: "run.completed",
            at: "2026-08-23T00:00:01.000Z",
            payload: { runId, revision: state.revision, step: state.step },
          },
        ],
      },
    } : {},
  };
}

function addFailedRun(document: WorldSessionDocument, retriable: boolean): void {
  document.state.player.intent = {
    id: "intent:failed",
    goal: "测试失败边界",
    inputs: [{
      id: "input:failed:1",
      text: "测试失败边界",
      kind: "goal",
      submittedAtStep: document.state.step,
    }],
    latestInput: {
      id: "input:failed:1",
      text: "测试失败边界",
      kind: "goal",
      submittedAtStep: document.state.step,
    },
    status: "active",
    startedAtStep: document.state.step,
  };
  document.runs.failed = {
    id: "failed",
    sessionId: document.id,
    intentId: "intent:failed",
    status: "failed",
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
    cancelRequested: false,
    error: "这一步没有提交。",
    internalError: "test failure",
    events: [
      {
        sequence: 1,
        type: "player.input",
        at: document.updatedAt,
        payload: { id: "input:failed:1", kind: "goal", text: "测试失败边界" },
      },
      {
        sequence: 2,
        type: "run.execution_started",
        at: document.updatedAt,
        payload: { runId: "failed", inputId: "input:failed:1", reason: "initial" },
      },
      {
        sequence: 3,
        type: "run.failed",
        at: document.updatedAt,
        payload: { runId: "failed", message: "这一步没有提交。", retriable },
      },
    ],
  };
}

describe("WorldSessionStore", () => {
  it("persists a strict v9 document and rejects missing sessions", async () => {
    const store = new MemoryWorldSessionStore();
    const document = await sessionDocument();

    expect(store.create(document)).toMatchObject({ generation: 1, document: { id: document.id } });
    expect(store.read(document.id).document).toEqual(document);
    expect(() => store.read("missing")).toThrow(WorldSessionNotFoundError);
  });

  it("rejects stale generations instead of overwriting a newer session", async () => {
    const store = new MemoryWorldSessionStore();
    const document = await sessionDocument();
    const created = store.create(document);
    const first = structuredClone(created.document);
    first.updatedAt = "2026-08-23T00:00:01.000Z";
    store.compareAndSwap(document.id, created.generation, first);

    expect(() => store.compareAndSwap(document.id, created.generation, document))
      .toThrow(WorldSessionConflictError);
  });

  it("deletes only the addressed generation and rejects stale deletion", async () => {
    const store = new MemoryWorldSessionStore();
    const first = store.create(await sessionDocument("session-1"));
    const second = store.create(await sessionDocument("session-2"));
    const updated = structuredClone(first.document);
    updated.title = "重命名后的存档";
    const current = store.compareAndSwap(first.document.id, first.generation, updated);

    expect(() => store.delete(first.document.id, first.generation)).toThrow(WorldSessionConflictError);
    store.delete(first.document.id, current.generation);

    expect(() => store.read(first.document.id)).toThrow(WorldSessionNotFoundError);
    expect(store.read(second.document.id).document.id).toBe(second.document.id);
  });

  it("rejects v8 documents without a compatibility path", async () => {
    const store = new MemoryWorldSessionStore();
    const document = await sessionDocument();
    const legacy = { ...document, schemaVersion: 8 } as unknown as WorldSessionDocument;

    expect(() => store.create(legacy)).toThrow();
  });

  it("persists a non-retriable failed boundary as an authoritative boolean", async () => {
    const store = new MemoryWorldSessionStore();
    const document = await sessionDocument();
    addFailedRun(document, false);

    expect(store.create(document).document.runs.failed.events.at(-1)).toMatchObject({
      type: "run.failed",
      payload: { retriable: false },
    });
  });

  it("rejects retry execution after a non-retriable failure", async () => {
    const store = new MemoryWorldSessionStore();
    const document = await sessionDocument();
    addFailedRun(document, false);
    const run = document.runs.failed;
    run.status = "running";
    run.events.push({
      sequence: 4,
      type: "run.execution_started",
      at: document.updatedAt,
      payload: { runId: "failed", inputId: "input:failed:1", reason: "retry" },
    });

    expect(() => store.create(document)).toThrow("retries a non-retriable failure");
  });

  it("rejects a run status whose final event is a different stream boundary", async () => {
    const store = new MemoryWorldSessionStore();
    const document = await sessionDocument();
    addFailedRun(document, true);
    document.runs.failed.status = "awaiting_player";
    document.runs.failed.error = undefined;
    document.runs.failed.internalError = undefined;

    expect(() => store.create(document)).toThrow("stream boundary has no matching final event");
  });

  it("rejects tampered public commit metadata when the document is reserialized", async () => {
    const store = new MemoryWorldSessionStore();
    const created = store.create(await sessionDocument("public-step-tamper", true));
    const document = created.document;
    const event = document.runs["run-1"].events.find((candidate) => candidate.type === "step.committed");
    if (!event || event.type !== "step.committed") throw new Error("fixture has no public commit");
    event.payload.elapsedSeconds += 1;

    expect(() => store.compareAndSwap(document.id, created.generation, document))
      .toThrow("committed step does not match canonical history");
  });

  it("rejects a tampered public observation when the document is reserialized", async () => {
    const store = new MemoryWorldSessionStore();
    const created = store.create(await sessionDocument("public-observation-tamper", true));
    const document = created.document;
    const event = document.runs["run-1"].events.find((candidate) => candidate.type === "player.observation");
    if (!event || event.type !== "player.observation") throw new Error("fixture has no public observation");
    event.payload.summary = "被篡改的公开观察。";

    expect(() => store.compareAndSwap(document.id, created.generation, document))
      .toThrow("public step events do not match canonical history step");
  });

  it("rejects a whitespace-only public observation without normalizing persisted text", async () => {
    const store = new MemoryWorldSessionStore();
    const created = store.create(await sessionDocument("public-observation-blank", true));
    const document = created.document;
    const event = document.runs["run-1"].events.find((candidate) => candidate.type === "player.observation");
    if (!event || event.type !== "player.observation") throw new Error("fixture has no public observation");
    event.payload.summary = " \n\t ";

    expect(() => store.compareAndSwap(document.id, created.generation, document))
      .toThrow("invalid player.observation");
  });

  it("rejects tampered, missing, duplicated, or reordered player outcomes", async () => {
    const store = new MemoryWorldSessionStore();
    const created = store.create(await sessionDocument("public-outcome-ledger", true));
    const mutations: Array<(events: WorldSessionDocument["runs"][string]["events"]) => void> = [
      (events) => {
        const outcome = events.find((event) => event.type === "player.outcome");
        if (!outcome || outcome.type !== "player.outcome") throw new Error("fixture has no public outcome");
        outcome.payload.summary = "被篡改的公开结果。";
      },
      (events) => {
        const outcome = events.find((event) => event.type === "player.outcome");
        if (!outcome || outcome.type !== "player.outcome") throw new Error("fixture has no public outcome");
        outcome.payload.summary = ` ${outcome.payload.summary} `;
      },
      (events) => {
        const index = events.findIndex((event) => event.type === "player.outcome");
        if (index < 0) throw new Error("fixture has no public outcome");
        events.splice(index, 1);
        events.forEach((event, eventIndex) => { event.sequence = eventIndex + 1; });
      },
      (events) => {
        const index = events.findIndex((event) => event.type === "player.outcome");
        if (index < 0) throw new Error("fixture has no public outcome");
        events.splice(index, 0, structuredClone(events[index]));
        events.forEach((event, eventIndex) => { event.sequence = eventIndex + 1; });
      },
      (events) => {
        const outcomeIndex = events.findIndex((event) => event.type === "player.outcome");
        const observationIndex = events.findIndex((event) => event.type === "player.observation");
        if (outcomeIndex < 0 || observationIndex < 0) throw new Error("fixture has no public outcome sequence");
        [events[outcomeIndex], events[observationIndex]] = [events[observationIndex], events[outcomeIndex]];
        events.forEach((event, eventIndex) => { event.sequence = eventIndex + 1; });
      },
    ];

    for (const mutate of mutations) {
      const document = structuredClone(created.document);
      mutate(document.runs["run-1"].events);
      expect(() => store.compareAndSwap(document.id, created.generation, document))
        .toThrow("public step events do not match canonical history step");
    }
  });

  it("rejects a tampered terminal position when the document is reserialized", async () => {
    const store = new MemoryWorldSessionStore();
    const created = store.create(await sessionDocument("public-boundary-tamper", true));
    const document = created.document;
    const event = document.runs["run-1"].events.find((candidate) => candidate.type === "run.completed");
    if (!event || event.type !== "run.completed") throw new Error("fixture has no completed boundary");
    event.payload.revision = 0;
    event.payload.step = 0;

    expect(() => store.compareAndSwap(document.id, created.generation, document))
      .toThrow("stream boundary does not match its latest committed step");
  });

  it("rejects invalid titles as part of the persisted session contract", async () => {
    const store = new MemoryWorldSessionStore();
    const document = await sessionDocument();
    document.title = "   ";

    expect(() => store.create(document)).toThrow();
  });

  it("rejects run events timestamped after their containing document", async () => {
    const store = new MemoryWorldSessionStore();
    const document = await sessionDocument("future-run-timestamp", true);
    const run = document.runs["run-1"];
    run.updatedAt = "2026-08-23T00:00:02.000Z";
    run.events.at(-1)!.at = run.updatedAt;

    expect(() => store.create(document)).toThrow("invalid run timestamps");
  });

  it("enforces semantic IDs throughout the persisted world contract", async () => {
    const mutations: Array<(document: WorldSessionDocument) => void> = [
      (document) => { document.world.id = "rt:reserved-world"; },
      (document) => { document.world.laws[0].id = " law-with-whitespace "; },
      (document) => { document.world.rulePackages[0].rules[0].id = "rule\u0000control"; },
      (document) => {
        document.world.randomDistributions = [{
          id: "rt:reserved-random",
          description: "invalid semantic random id",
          steps: [{
            id: "roll",
            count: 1,
            outcomes: [0, 1],
            aggregate: "first",
            when: null,
          }],
        }];
      },
    ];
    for (const [index, mutate] of mutations.entries()) {
      const store = new MemoryWorldSessionStore();
      const document = await sessionDocument(`semantic-world-${index}`);
      mutate(document);
      expect(() => store.create(document)).toThrow("semantic ids");
    }
  });

  it("rejects a Fact that claims provenance from another world seed", async () => {
    const store = new MemoryWorldSessionStore();
    const document = await sessionDocument();
    document.state.truth.facts["key-authenticity"].provenance = [{
      kind: "world_seed",
      id: `sha256:${"0".repeat(64)}`,
    }];

    expect(() => store.create(document)).toThrow("does not match replayed committed history");
  });

  it("rejects mutation of verifiable history even when its content hash is recomputed", async () => {
    const store = new MemoryWorldSessionStore();
    const created = store.create(await sessionDocument("committed", true));
    const document = created.document;
    const step = document.state.history[0];
    step.characterPatches[0].baseRevision = 99;
    const payload = Object.fromEntries(Object.entries(step).filter(([key]) => key !== "contentHash"));
    step.contentHash = contentHash(payload);

    expect(() => store.compareAndSwap(document.id, created.generation, document))
      .toThrow("invalid AgentMind audit coverage");
  });

  it("rejects mutation of invocation audit hashes even when the step hash is recomputed", async () => {
    const store = new MemoryWorldSessionStore();
    const created = store.create(await sessionDocument("invocation-hash", true));
    const document = created.document;
    const step = document.state.history[0];
    step.modelAudits[0].invocations[0].requestHash = "tampered";
    const payload = Object.fromEntries(Object.entries(step).filter(([key]) => key !== "contentHash"));
    step.contentHash = contentHash(payload);

    expect(() => store.compareAndSwap(document.id, created.generation, document))
      .toThrow("model invocation identity");
  });

  it("rejects raw payload fields injected into an invocation audit", async () => {
    const store = new MemoryWorldSessionStore();
    const created = store.create(await sessionDocument("invocation-payload", true));
    const document = created.document;
    const step = document.state.history[0];
    const invocation = step.modelAudits[0].invocations[0] as typeof step.modelAudits[0]["invocations"][0] & {
      payload?: unknown;
    };
    invocation.payload = { prompt: "must not persist" };
    const payload = Object.fromEntries(Object.entries(step).filter(([key]) => key !== "contentHash"));
    step.contentHash = contentHash(payload);

    expect(() => store.compareAndSwap(document.id, created.generation, document))
      .toThrow("model invocation identity");
  });

  it("rejects canonical identity fields in public run events", async () => {
    const store = new MemoryWorldSessionStore();
    const document = await sessionDocument();
    document.runs.run = {
      id: "run",
      sessionId: document.id,
      intentId: "intent:run",
      status: "completed",
      createdAt: document.createdAt,
      updatedAt: document.updatedAt,
      cancelRequested: false,
      events: [
        {
          sequence: 1,
          type: "player.input",
          at: document.updatedAt,
          payload: { id: "input:run:1", kind: "goal", text: "测试运行" },
        },
        {
          sequence: 2,
          type: "player.observation",
          at: document.updatedAt,
          payload: {
            id: "observation:1:1",
            observerId: "player",
            step: 1,
            summary: "你看见一个陌生人。",
            introductions: [{
              localEntity: {
                id: "observed-stranger",
                name: "陌生人",
                description: "身份未知。",
                status: "observed",
              },
              canonicalEntityId: "canonical-secret-id",
            }],
            apparentClaims: [],
            sourceEventIds: ["event:1:1"],
          },
        } as never,
      ],
    };

    expect(() => store.create(document)).toThrow("invalid player.observation");
  });

  it("persists sessions in SQLite and validates rows again after restart", async () => {
    const file = temporaryDatabase();
    const first = new LocalDatabase(file, { ownerId: "owner-1", heartbeat: false });
    const document = await sessionDocument();
    const created = first.create(document);
    const updated = structuredClone(created.document);
    updated.updatedAt = "2026-08-23T00:00:01.000Z";
    first.compareAndSwap(document.id, created.generation, updated);
    expect(() => first.compareAndSwap(document.id, created.generation, updated))
      .toThrow(WorldSessionConflictError);
    first.close();

    const second = new LocalDatabase(file, { ownerId: "owner-2", heartbeat: false });
    expect(second.read(document.id)).toMatchObject({ generation: 2, document: { id: document.id } });
    second.close();

    const tamper = new Database(file);
    tamper.prepare("UPDATE world_sessions SET document_json = ? WHERE id = ?")
      .run('{"schemaVersion":4}', document.id);
    tamper.close();

    const third = new LocalDatabase(file, { ownerId: "owner-3", heartbeat: false });
    expect(() => third.read(document.id)).toThrow();
    third.close();
  });

  it("invalidates a cached SQLite document when the persisted bytes change at the same generation", async () => {
    const file = temporaryDatabase();
    const database = new LocalDatabase(file, { ownerId: "owner-cache-tamper", heartbeat: false });
    const created = database.create(await sessionDocument("cached-row-tamper", true));
    expect(database.read(created.document.id).document.state.revision).toBe(1);

    const tamper = new Database(file);
    tamper.prepare("UPDATE world_sessions SET document_json = ? WHERE id = ?")
      .run('{"schemaVersion":4}', created.document.id);
    tamper.close();

    expect(() => database.read(created.document.id)).toThrow();
    database.close();
  });

  it("bounds the SQLite validation cache with LRU eviction and observes every cache outcome once", async () => {
    const observer = new RecordingRuntimeObserver({ mode: "full" });
    const database = new LocalDatabase(temporaryDatabase(), {
      ownerId: "owner-bounded-cache",
      heartbeat: false,
      observer,
    });
    const base = await sessionDocument("bounded-cache-0");
    const documentFor = (index: number) => {
      const document = structuredClone(base);
      document.id = `bounded-cache-${index}`;
      return document;
    };

    for (let index = 0; index < 8; index += 1) database.create(documentFor(index));
    observer.events.splice(0);
    database.read("bounded-cache-0", { requestId: "promote-cache-entry" });
    expect(observer.events.filter((event) => event.event === "persistence.read.completed"))
      .toEqual([expect.objectContaining({
        correlation: expect.objectContaining({ requestId: "promote-cache-entry" }),
        attributes: { sink: "sqlite", cacheHit: true },
      })]);

    database.create(documentFor(8));
    observer.events.splice(0);
    database.read("bounded-cache-0", { requestId: "retained-cache-entry" });
    database.read("bounded-cache-1", { requestId: "evicted-cache-entry" });

    const reads = observer.events.filter((event) => event.event === "persistence.read.completed");
    expect(reads).toHaveLength(2);
    expect(reads).toEqual([
      expect.objectContaining({
        correlation: expect.objectContaining({ requestId: "retained-cache-entry" }),
        attributes: { sink: "sqlite", cacheHit: true },
      }),
      expect.objectContaining({
        correlation: expect.objectContaining({ requestId: "evicted-cache-entry" }),
        attributes: { sink: "sqlite", cacheHit: false },
      }),
    ]);
    expect(reads.every((event) => !("payload" in event))).toBe(true);
    database.close();
  });

  it("keeps stable cache hits across repeated SQLite lists larger than the LRU", async () => {
    const observer = new RecordingRuntimeObserver({ mode: "full" });
    const database = new LocalDatabase(temporaryDatabase(), {
      ownerId: "owner-batched-list-cache",
      heartbeat: false,
      observer,
    });
    const base = await sessionDocument("batched-list-0");
    for (let index = 0; index < 9; index += 1) {
      const document = structuredClone(base);
      document.id = `batched-list-${index}`;
      database.create(document);
    }
    observer.events.splice(0);

    const first = database.listSessions({ requestId: "first-batched-list" });
    const second = database.listSessions({ requestId: "second-batched-list" });
    expect(first.map(({ document }) => document.id)).toEqual(second.map(({ document }) => document.id));

    for (const requestId of ["first-batched-list", "second-batched-list"]) {
      const reads = observer.events.filter((event) =>
        event.event === "persistence.read.completed" && event.correlation?.requestId === requestId);
      expect(reads).toHaveLength(9);
      expect(reads.filter((event) => event.attributes?.cacheHit === true)).toHaveLength(8);
      expect(reads.filter((event) => event.attributes?.cacheHit === false)).toHaveLength(1);
      expect(new Set(reads.map((event) => event.correlation?.sessionId)).size).toBe(9);
      expect(reads.every((event) => !("payload" in event))).toBe(true);
    }
    database.close();
  });

  it("deletes a SQLite session with generation fencing", async () => {
    const database = new LocalDatabase(temporaryDatabase(), { ownerId: "owner-delete", heartbeat: false });
    const first = database.create(await sessionDocument("sqlite-1"));
    database.create(await sessionDocument("sqlite-2"));

    expect(() => database.delete(first.document.id, first.generation + 1))
      .toThrow(WorldSessionConflictError);
    database.delete(first.document.id, first.generation);

    expect(() => database.read(first.document.id)).toThrow(WorldSessionNotFoundError);
    expect(database.listSessions().map(({ document }) => document.id)).toEqual(["sqlite-2"]);
    database.close();
  });

  it("fences the old host when a second instance takes over an expired lease", async () => {
    const file = temporaryDatabase();
    let now = 0;
    const clock = () => now;
    const first = new LocalDatabase(file, { ownerId: "owner-1", heartbeat: false, now: clock });

    expect(() => new LocalDatabase(file, { ownerId: "owner-2", heartbeat: false, now: clock }))
      .toThrow(LocalDatabaseInUseError);

    now = 15_001;
    const second = new LocalDatabase(file, { ownerId: "owner-2", heartbeat: false, now: clock });
    const document = await sessionDocument();
    expect(() => first.create(document)).toThrow(LocalDatabaseInUseError);
    second.close();
    first.close();
  });
});
