import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AgentMind } from "../../engine/agent-mind";
import { contentHash } from "../../engine/model-audit";
import { DeterministicModelProvider } from "../../engine/model-provider";
import { SimulationEngine } from "../../engine/simulation";
import { TruthEngine } from "../../engine/truth-engine";
import { loadWorldScript } from "../../script/world-loader";
import type { WorldSessionDocument } from "../world-run-types";
import { FileWorldSessionStore, WorldSessionNotFoundError } from "../world-session-store";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function temporaryRoot(): string {
  const root = mkdtempSync(path.join(tmpdir(), "chatgame-session-store-"));
  roots.push(root);
  return root;
}

async function sessionDocument(id = "session-1"): Promise<WorldSessionDocument> {
  const definition = loadWorldScript(path.resolve("test/fixtures/open-world-script"), 17);
  const provider = new DeterministicModelProvider();
  const engine = new SimulationEngine(
    definition,
    new TruthEngine(provider),
    new AgentMind(provider),
  );
  await engine.bootstrapAgents();
  return {
    schemaVersion: 2,
    id,
    scriptId: definition.id,
    createdAt: "2026-08-23T00:00:00.000Z",
    updatedAt: "2026-08-23T00:00:00.000Z",
    state: engine.snapshot,
    runs: {},
  };
}

async function committedSessionDocument(id = "session-committed"): Promise<WorldSessionDocument> {
  const definition = loadWorldScript(path.resolve("test/fixtures/open-world-script"), 17);
  const provider = new DeterministicModelProvider();
  const engine = new SimulationEngine(definition, new TruthEngine(provider), new AgentMind(provider));
  await engine.bootstrapAgents();
  engine.beginPlayerIntent("推进一个可审计步骤");
  await engine.step();
  return {
    schemaVersion: 2,
    id,
    scriptId: definition.id,
    createdAt: "2026-08-23T00:00:00.000Z",
    updatedAt: "2026-08-23T00:00:01.000Z",
    state: engine.snapshot,
    runs: {},
  };
}

function fileFor(root: string, sessionId: string): string {
  return path.join(root, "sessions", `${sessionId}.json`);
}

function resign(envelope: { checksum: string; document: unknown }): string {
  const documentJson = JSON.stringify(envelope.document);
  envelope.checksum = createHash("sha256").update(documentJson).digest("hex");
  return JSON.stringify(envelope);
}

describe("FileWorldSessionStore", () => {
  it("rejects v1 session documents without a compatibility path", async () => {
    const root = temporaryRoot();
    const store = new FileWorldSessionStore(root);
    const document = await sessionDocument();
    store.write(document);
    const file = fileFor(root, document.id);
    const envelope = JSON.parse(readFileSync(file, "utf8")) as {
      checksum: string;
      document: { schemaVersion: number };
    };
    envelope.document.schemaVersion = 1;
    writeFileSync(file, resign(envelope), "utf8");

    expect(() => store.read(document.id)).toThrow();
  });

  it("rejects resigned corruption in CharacterPatch audit history", async () => {
    const root = temporaryRoot();
    const store = new FileWorldSessionStore(root);
    const document = await committedSessionDocument();
    store.write(document);
    const file = fileFor(root, document.id);
    const envelope = JSON.parse(readFileSync(file, "utf8")) as {
      checksum: string;
      document: WorldSessionDocument;
    };
    const step = envelope.document.state.history[0];
    step.characterPatches[0].baseRevision = 99;
    const payload = Object.fromEntries(
      Object.entries(step).filter(([key]) => key !== "contentHash"),
    );
    step.contentHash = contentHash(payload);
    writeFileSync(file, resign(envelope), "utf8");

    expect(() => store.read(document.id)).toThrow("invalid AgentMind audit coverage");
  });

  it("detects checksum corruption and distinguishes a missing session", async () => {
    const root = temporaryRoot();
    const store = new FileWorldSessionStore(root);
    const document = await sessionDocument();
    store.write(document);
    const file = fileFor(root, document.id);
    const serialized = readFileSync(file, "utf8");
    writeFileSync(file, serialized.replace("open-world-fixture", "tampered-world"), "utf8");

    expect(() => store.read(document.id)).toThrow("checksum mismatch");
    expect(() => store.read("missing")).toThrow(WorldSessionNotFoundError);
  });

  it("rejects malformed run-event payloads even when an attacker recomputes the checksum", async () => {
    const root = temporaryRoot();
    const store = new FileWorldSessionStore(root);
    const document = await sessionDocument();
    document.runs.run = {
      id: "run",
      sessionId: document.id,
      intentId: "intent:run",
      text: "测试运行",
      status: "completed",
      createdAt: document.createdAt,
      updatedAt: document.updatedAt,
      cancelRequested: false,
      events: [],
    };
    store.write(document);
    const file = fileFor(root, document.id);
    const envelope = JSON.parse(readFileSync(file, "utf8")) as {
      checksum: string;
      document: { runs: Record<string, { events: unknown[] }> };
    };
    envelope.document.runs.run.events.push({
      sequence: 1,
      type: "player.observation",
      at: document.updatedAt,
      payload: { observerId: "player", summary: "缺少其余字段" },
    });
    writeFileSync(file, resign(envelope), "utf8");

    expect(() => store.read(document.id)).toThrow("invalid player.observation");
  });

  it("rejects extra canonical identity fields in an otherwise valid public event", async () => {
    const root = temporaryRoot();
    const store = new FileWorldSessionStore(root);
    const document = await sessionDocument();
    document.runs.run = {
      id: "run",
      sessionId: document.id,
      intentId: "intent:run",
      text: "测试运行",
      status: "completed",
      createdAt: document.createdAt,
      updatedAt: document.updatedAt,
      cancelRequested: false,
      events: [],
    };
    store.write(document);
    const file = fileFor(root, document.id);
    const envelope = JSON.parse(readFileSync(file, "utf8")) as {
      checksum: string;
      document: { runs: Record<string, { events: unknown[] }> };
    };
    envelope.document.runs.run.events.push({
      sequence: 1,
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
    });
    writeFileSync(file, resign(envelope), "utf8");

    expect(() => store.read(document.id)).toThrow("invalid player.observation");
  });

  it("atomically replaces the session file without leaving temporary siblings", async () => {
    const root = temporaryRoot();
    const store = new FileWorldSessionStore(root);
    const document = await sessionDocument();
    store.write(document);
    document.updatedAt = "2026-08-23T00:01:00.000Z";
    store.write(document);

    expect(store.read(document.id).updatedAt).toBe(document.updatedAt);
    expect(readdirSync(path.join(root, "sessions"))).toEqual([`${document.id}.json`]);
  });

  it("rejects traversal-like session identifiers before touching the filesystem", () => {
    const store = new FileWorldSessionStore(temporaryRoot());
    expect(() => store.read("../outside")).toThrow("invalid session id");
  });
});
