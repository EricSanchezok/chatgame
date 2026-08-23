import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { validateSimulationState } from "../engine/transaction";
import type { WorldRunEvent, WorldSessionDocument } from "./world-run-types";

const identifierPattern = /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/;

function assertIdentifier(value: string, label: string): void {
  if (!identifierPattern.test(value)) throw new Error(`invalid ${label}: ${value}`);
}

const envelopeSchema = z.object({
  checksum: z.string().regex(/^[a-f0-9]{64}$/),
  document: z.object({
    schemaVersion: z.literal(4),
    id: z.string().min(1),
    scriptId: z.string().min(1),
    title: z.string().trim().min(1).max(80),
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
const beliefValueViewSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("text"), value: z.string() }).strict(),
  z.object({ kind: z.literal("number"), value: z.number().finite() }).strict(),
  z.object({ kind: z.literal("boolean"), value: z.boolean() }).strict(),
  z.object({ kind: z.literal("local_entity"), localEntityId: z.string().min(1) }).strict(),
  z.object({ kind: z.literal("none") }).strict(),
]);
const localEntityViewSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string(),
  status: z.enum(["observed", "reported", "hypothesized"]),
}).strict();
const eventBase = {
  sequence: z.number().int().positive(),
  at: z.string().min(1),
};
const checkPayloadSchema = z.discriminatedUnion("visibility", [
  z.object({
    requestId: z.string().min(1),
    visibility: z.literal("full"),
    dice: z.array(z.number().int().min(1).max(20)).min(1).max(2),
    kept: z.number().int().min(1).max(20),
    modifier: z.number().int(),
    total: z.number().int(),
    dc: z.number().int().min(0).max(100),
    succeeded: z.boolean(),
    margin: z.number().int(),
  }).strict(),
  z.object({
    requestId: z.string().min(1),
    visibility: z.literal("result_only"),
    succeeded: z.boolean(),
  }).strict(),
]);
const runEventSchema = z.union([
  z.object({
    ...eventBase,
    type: z.literal("run.started"),
    payload: z.object({ runId: z.string().min(1), text: z.string() }).strict(),
  }).strict(),
  z.object({
    ...eventBase,
    type: z.literal("check.resolved"),
    payload: checkPayloadSchema,
  }).strict(),
  z.object({
    ...eventBase,
    type: z.literal("player.outcome"),
    payload: z.object({
      status: z.enum(["succeeded", "partial", "failed", "blocked", "continuing"]),
      summary: z.string(),
      knownAlternatives: z.array(z.string()),
    }).strict(),
  }).strict(),
  z.object({
    ...eventBase,
    type: z.literal("player.observation"),
    payload: z.object({
      id: z.string().min(1),
      observerId: z.literal("player"),
      step: z.number().int().nonnegative(),
      summary: z.string(),
      introductions: z.array(z.object({ localEntity: localEntityViewSchema }).strict()),
      apparentClaims: z.array(z.object({
        id: z.string().min(1),
        subjectId: z.string().min(1),
        predicate: z.string().min(1),
        value: beliefValueViewSchema,
        description: z.string(),
      }).strict()),
      sourceEventIds: z.array(z.string().min(1)),
    }).strict(),
  }).strict(),
  z.object({
    ...eventBase,
    type: z.literal("step.committed"),
    payload: z.object({
      revision: z.number().int().nonnegative(),
      step: z.number().int().nonnegative(),
      elapsedSeconds: z.number().int().nonnegative(),
    }).strict(),
  }).strict(),
  z.object({
    ...eventBase,
    type: z.enum([
      "run.awaiting_player",
      "run.completed",
      "run.goal_failed",
      "run.step_limit",
      "run.cancelled",
    ]),
    payload: z.object({
      runId: z.string().min(1),
      revision: z.number().int().nonnegative(),
      step: z.number().int().nonnegative(),
    }).strict(),
  }).strict(),
  z.object({
    ...eventBase,
    type: z.literal("run.failed"),
    payload: z.object({
      runId: z.string().min(1),
      message: z.string(),
      retriable: z.literal(true),
    }).strict(),
  }).strict(),
]) as z.ZodType<WorldRunEvent>;

function validateRunEvent(event: unknown, runId: string): WorldRunEvent {
  const parsed = runEventSchema.safeParse(event);
  if (!parsed.success) {
    const type = event && typeof event === "object" && "type" in event ? String(event.type) : "event";
    throw new Error(`invalid ${type} in ${runId}`);
  }
  if ("runId" in parsed.data.payload && parsed.data.payload.runId !== runId) {
    throw new Error(`event run id mismatch in ${runId}`);
  }
  return parsed.data;
}

function validateDocument(document: WorldSessionDocument, expectedSessionId?: string): void {
  if (expectedSessionId && document.id !== expectedSessionId) throw new Error("session document id mismatch");
  if (document.state.worldId !== document.scriptId) throw new Error("session world id mismatch");
  if (document.title !== document.title.trim() || document.title.length < 1 || document.title.length > 80) {
    throw new Error("invalid session title");
  }
  validateSimulationState(document.state, true, true);
  for (const [runId, run] of Object.entries(document.runs)) {
    if (!run || typeof run !== "object" || run.id !== runId || run.sessionId !== document.id ||
      !run.intentId?.trim() || !run.text.trim() || !runStatuses.has(run.status) || typeof run.cancelRequested !== "boolean" ||
      (run.error !== undefined && typeof run.error !== "string") ||
      (run.internalError !== undefined && typeof run.internalError !== "string") ||
      !Array.isArray(run.events)) {
      throw new Error(`invalid run ${runId}`);
    }
    for (let index = 0; index < run.events.length; index += 1) {
      const event = validateRunEvent(run.events[index], runId);
      if (event.sequence !== index + 1) {
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
  delete(sessionId: string): void;
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

  delete(sessionId: string): void {
    if (!this.values.delete(sessionId)) throw new WorldSessionNotFoundError(sessionId);
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

  delete(sessionId: string): void {
    const file = this.file(sessionId);
    if (!existsSync(file)) throw new WorldSessionNotFoundError(sessionId);
    rmSync(file);
  }
}
