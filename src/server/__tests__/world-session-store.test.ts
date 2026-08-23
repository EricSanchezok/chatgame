import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { AgentMind } from "../../engine/agent-mind";
import { contentHash } from "../../engine/model-audit";
import { DeterministicModelProvider } from "../../engine/testing/model-provider";
import { SimulationEngine } from "../../engine/simulation";
import { TruthEngine } from "../../engine/truth-engine";
import { toWorldRuntimeContract } from "../../engine/world-definition";
import { loadWorldScript } from "../../script/world-loader";
import { LocalDatabase, LocalDatabaseInUseError } from "../local-database";
import type { WorldSessionDocument } from "../world-run-types";
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
  return {
    schemaVersion: 4,
    id,
    world: toWorldRuntimeContract(definition),
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
          {
            sequence: 3,
            type: "step.committed",
            at: "2026-08-23T00:00:01.000Z",
            payload: { revision: state.revision, step: state.step, elapsedSeconds: state.truth.elapsedSeconds },
          },
          {
            sequence: 4,
            type: "run.completed",
            at: "2026-08-23T00:00:01.000Z",
            payload: { runId, revision: state.revision, step: state.step },
          },
        ],
      },
    } : {},
  };
}

describe("WorldSessionStore", () => {
  it("persists a strict v4 document and rejects missing sessions", async () => {
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

  it("rejects v3 documents without a compatibility path", async () => {
    const store = new MemoryWorldSessionStore();
    const document = await sessionDocument();
    const legacy = { ...document, schemaVersion: 3 } as unknown as WorldSessionDocument;

    expect(() => store.create(legacy)).toThrow();
  });

  it("rejects a Fact that claims provenance from another world seed", async () => {
    const store = new MemoryWorldSessionStore();
    const document = await sessionDocument();
    document.state.truth.facts["key-authenticity"].provenance = [{
      kind: "world_seed",
      id: `sha256:${"0".repeat(64)}`,
    }];

    expect(() => store.create(document)).toThrow("references a different world seed");
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
      .run('{"schemaVersion":3}', document.id);
    tamper.close();

    const third = new LocalDatabase(file, { ownerId: "owner-3", heartbeat: false });
    expect(() => third.read(document.id)).toThrow();
    third.close();
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
