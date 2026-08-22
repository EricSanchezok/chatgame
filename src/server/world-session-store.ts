import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { validateSimulationState } from "../engine/transaction";
import type { WorldSessionDocument } from "./world-run-types";

const identifierPattern = /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/;

function assertIdentifier(value: string, label: string): void {
  if (!identifierPattern.test(value)) throw new Error(`invalid ${label}: ${value}`);
}

const envelopeSchema = z.object({
  checksum: z.string().regex(/^[a-f0-9]{64}$/),
  document: z.object({
    schemaVersion: z.literal(1),
    id: z.string().min(1),
    scriptId: z.string().min(1),
    createdAt: z.string().min(1),
    updatedAt: z.string().min(1),
    state: z.unknown(),
    runs: z.record(z.string(), z.unknown()),
  }).strict(),
}).strict();

function checksum(json: string): string {
  return createHash("sha256").update(json).digest("hex");
}

const runStatuses = new Set([
  "queued",
  "running",
  "awaiting_player",
  "completed",
  "goal_failed",
  "step_limit",
  "cancelled",
  "failed",
]);
const runEventTypes = new Set([
  "run.started",
  "check.resolved",
  "player.observation",
  "step.committed",
  "run.awaiting_player",
  "run.completed",
  "run.goal_failed",
  "run.step_limit",
  "run.cancelled",
  "run.failed",
]);

function validateDocument(document: WorldSessionDocument, expectedSessionId?: string): void {
  if (expectedSessionId && document.id !== expectedSessionId) throw new Error("session document id mismatch");
  if (document.state.worldId !== document.scriptId) throw new Error("session world id mismatch");
  validateSimulationState(document.state, true, true);
  for (const [runId, run] of Object.entries(document.runs)) {
    if (!run || typeof run !== "object" || run.id !== runId || run.sessionId !== document.id ||
      !run.text.trim() || !runStatuses.has(run.status) || typeof run.cancelRequested !== "boolean" ||
      !Array.isArray(run.events)) {
      throw new Error(`invalid run ${runId}`);
    }
    for (let index = 0; index < run.events.length; index += 1) {
      const event = run.events[index];
      if (event.sequence !== index + 1 || !event.at || !runEventTypes.has(event.type)) {
        throw new Error(`invalid event sequence in run ${runId}`);
      }
    }
  }
}

function serialize(document: WorldSessionDocument): string {
  validateDocument(document);
  const documentJson = JSON.stringify(document);
  return JSON.stringify({ checksum: checksum(documentJson), document });
}

function parse(serialized: string, expectedSessionId: string): WorldSessionDocument {
  const envelope = envelopeSchema.parse(JSON.parse(serialized));
  const documentJson = JSON.stringify(envelope.document);
  if (checksum(documentJson) !== envelope.checksum) throw new Error("world session checksum mismatch");
  const document = envelope.document as WorldSessionDocument;
  try {
    validateDocument(document, expectedSessionId);
  } catch (error) {
    throw new Error(`invalid world session: ${error instanceof Error ? error.message : String(error)}`);
  }
  return document;
}

export interface WorldSessionStore {
  write(document: WorldSessionDocument): void;
  read(sessionId: string): WorldSessionDocument;
  list(): string[];
}

export class WorldSessionNotFoundError extends Error {
  constructor(readonly sessionId: string) {
    super(`world session not found: ${sessionId}`);
    this.name = "WorldSessionNotFoundError";
  }
}

export class MemoryWorldSessionStore implements WorldSessionStore {
  private readonly values = new Map<string, string>();
  writeCount = 0;

  write(document: WorldSessionDocument): void {
    this.writeCount += 1;
    this.values.set(document.id, serialize(document));
  }

  read(sessionId: string): WorldSessionDocument {
    const serialized = this.values.get(sessionId);
    if (!serialized) throw new WorldSessionNotFoundError(sessionId);
    return parse(serialized, sessionId);
  }

  list(): string[] {
    return [...this.values.keys()].sort();
  }
}

export class FileWorldSessionStore implements WorldSessionStore {
  constructor(readonly root: string) {}

  private file(sessionId: string): string {
    assertIdentifier(sessionId, "session id");
    return path.join(this.root, "sessions", `${sessionId}.json`);
  }

  write(document: WorldSessionDocument): void {
    const file = this.file(document.id);
    mkdirSync(path.dirname(file), { recursive: true });
    const temporary = `${file}.tmp-${process.pid}-${randomUUID()}`;
    try {
      writeFileSync(temporary, serialize(document), "utf8");
      renameSync(temporary, file);
    } finally {
      rmSync(temporary, { force: true });
    }
  }

  read(sessionId: string): WorldSessionDocument {
    const file = this.file(sessionId);
    if (!existsSync(file)) throw new WorldSessionNotFoundError(sessionId);
    return parse(readFileSync(file, "utf8"), sessionId);
  }

  list(): string[] {
    const directory = path.join(this.root, "sessions");
    if (!existsSync(directory)) return [];
    return readdirSync(directory)
      .filter((name) => name.endsWith(".json"))
      .map((name) => name.slice(0, -5))
      .sort();
  }
}
