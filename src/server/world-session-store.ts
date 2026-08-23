import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { validateSimulationState } from "../engine/transaction";
import {
  NOOP_RUNTIME_OBSERVER,
  runtimeEventEmitter,
  serializeRuntimeError,
  type RuntimeCorrelation,
  type RuntimeObserver,
} from "../engine/observability";
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

function serialize(
  document: WorldSessionDocument,
  observer: RuntimeObserver,
  correlation?: RuntimeCorrelation,
): string {
  const observe = runtimeEventEmitter(observer);
  const validationStartedAt = Date.now();
  try {
    validateDocument(document);
    observe?.({
      event: "persistence.history_validation.completed",
      correlation,
      durationMs: Math.max(0, Date.now() - validationStartedAt),
      counts: { history: document.state.history.length, runs: Object.keys(document.runs).length },
      hashes: { state: checksum(JSON.stringify(document.state)) },
    });
  } catch (error) {
    observe?.({
      event: "persistence.history_validation.failed",
      level: "error",
      correlation,
      durationMs: Math.max(0, Date.now() - validationStartedAt),
      error: serializeRuntimeError(error),
    });
    throw error;
  }
  const serializationStartedAt = Date.now();
  try {
    const documentJson = JSON.stringify(document);
    const documentChecksum = checksum(documentJson);
    const serialized = JSON.stringify({ checksum: documentChecksum, document });
    observe?.({
      event: "persistence.document.serialized",
      correlation,
      durationMs: Math.max(0, Date.now() - serializationStartedAt),
      measurements: {
        documentUtf8Bytes: Buffer.byteLength(documentJson, "utf8"),
        envelopeUtf8Bytes: Buffer.byteLength(serialized, "utf8"),
      },
      hashes: { checksum: documentChecksum },
    });
    return serialized;
  } catch (error) {
    observe?.({
      event: "persistence.document.serialization_failed",
      level: "error",
      correlation,
      durationMs: Math.max(0, Date.now() - serializationStartedAt),
      error: serializeRuntimeError(error),
    });
    throw error;
  }
}

function parse(
  serialized: string,
  expectedSessionId: string,
  observer: RuntimeObserver,
  correlation?: RuntimeCorrelation,
): WorldSessionDocument {
  const observe = runtimeEventEmitter(observer);
  const startedAt = Date.now();
  try {
    const envelope = envelopeSchema.parse(JSON.parse(serialized));
    const documentJson = JSON.stringify(envelope.document);
    if (checksum(documentJson) !== envelope.checksum) throw new Error("world session checksum mismatch");
    const document = envelope.document as WorldSessionDocument;
    validateDocument(document, expectedSessionId);
    observe?.({
      event: "persistence.read.completed",
      correlation: { ...correlation, sessionId: expectedSessionId },
      durationMs: Math.max(0, Date.now() - startedAt),
      measurements: { envelopeUtf8Bytes: Buffer.byteLength(serialized, "utf8") },
      counts: { history: document.state.history.length, runs: Object.keys(document.runs).length },
      hashes: { checksum: envelope.checksum },
    });
    return document;
  } catch (error) {
    observe?.({
      event: "persistence.read.failed",
      level: "error",
      correlation: { ...correlation, sessionId: expectedSessionId },
      durationMs: Math.max(0, Date.now() - startedAt),
      measurements: { envelopeUtf8Bytes: Buffer.byteLength(serialized, "utf8") },
      error: serializeRuntimeError(error),
    });
    throw new Error(`invalid world session: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export interface WorldSessionStore {
  write(document: WorldSessionDocument, correlation?: RuntimeCorrelation): void;
  read(sessionId: string, correlation?: RuntimeCorrelation): WorldSessionDocument;
  list(correlation?: RuntimeCorrelation): string[];
}

export class WorldSessionNotFoundError extends Error {
  constructor(readonly sessionId: string) {
    super(`world session not found: ${sessionId}`);
    this.name = "WorldSessionNotFoundError";
  }
}

export class MemoryWorldSessionStore implements WorldSessionStore {
  private readonly values = new Map<string, string>();
  private readonly observe: ReturnType<typeof runtimeEventEmitter>;
  writeCount = 0;

  constructor(private readonly observer: RuntimeObserver = NOOP_RUNTIME_OBSERVER) {
    this.observe = runtimeEventEmitter(observer);
  }

  write(document: WorldSessionDocument, correlation?: RuntimeCorrelation): void {
    const startedAt = Date.now();
    this.writeCount += 1;
    let stage = "serialize";
    try {
      const serialized = serialize(document, this.observer, correlation);
      stage = "commit";
      this.values.set(document.id, serialized);
      this.observe?.({
        event: "persistence.write.completed",
        correlation: { ...correlation, sessionId: document.id },
        durationMs: Math.max(0, Date.now() - startedAt),
        measurements: { envelopeUtf8Bytes: Buffer.byteLength(serialized, "utf8") },
        attributes: { sink: "memory" },
      });
    } catch (error) {
      this.observe?.({
        event: "persistence.write.failed",
        level: "error",
        correlation: { ...correlation, sessionId: document.id },
        durationMs: Math.max(0, Date.now() - startedAt),
        attributes: { sink: "memory", stage },
        error: serializeRuntimeError(error),
      });
      throw error;
    }
  }

  read(sessionId: string, correlation?: RuntimeCorrelation): WorldSessionDocument {
    const serialized = this.values.get(sessionId);
    if (!serialized) {
      const error = new WorldSessionNotFoundError(sessionId);
      this.observe?.({
        event: "persistence.read.failed",
        level: "warn",
        correlation: { ...correlation, sessionId },
        error: serializeRuntimeError(error),
      });
      throw error;
    }
    return parse(serialized, sessionId, this.observer, correlation);
  }

  list(): string[] {
    return [...this.values.keys()].sort();
  }
}

export class FileWorldSessionStore implements WorldSessionStore {
  private readonly observe: ReturnType<typeof runtimeEventEmitter>;

  constructor(
    readonly root: string,
    private readonly observer: RuntimeObserver = NOOP_RUNTIME_OBSERVER,
  ) {
    this.observe = runtimeEventEmitter(observer);
  }

  private file(sessionId: string): string {
    assertIdentifier(sessionId, "session id");
    return path.join(this.root, "sessions", `${sessionId}.json`);
  }

  write(document: WorldSessionDocument, correlation?: RuntimeCorrelation): void {
    const startedAt = Date.now();
    const file = this.file(document.id);
    const temporary = `${file}.tmp-${process.pid}-${randomUUID()}`;
    let stage = "directory";
    try {
      mkdirSync(path.dirname(file), { recursive: true });
      stage = "serialize";
      const serialized = serialize(document, this.observer, correlation);
      const temporaryStartedAt = Date.now();
      stage = "temporary_write";
      writeFileSync(temporary, serialized, "utf8");
      this.observe?.({
        event: "persistence.temporary_file.written",
        correlation: { ...correlation, sessionId: document.id },
        durationMs: Math.max(0, Date.now() - temporaryStartedAt),
        measurements: { envelopeUtf8Bytes: Buffer.byteLength(serialized, "utf8") },
        hashes: { envelope: checksum(serialized) },
      });
      const renameStartedAt = Date.now();
      stage = "rename";
      renameSync(temporary, file);
      this.observe?.({
        event: "persistence.rename.completed",
        correlation: { ...correlation, sessionId: document.id },
        durationMs: Math.max(0, Date.now() - renameStartedAt),
      });
      this.observe?.({
        event: "persistence.write.completed",
        correlation: { ...correlation, sessionId: document.id },
        durationMs: Math.max(0, Date.now() - startedAt),
        measurements: { envelopeUtf8Bytes: Buffer.byteLength(serialized, "utf8") },
        attributes: { sink: "file" },
      });
    } catch (error) {
      this.observe?.({
        event: "persistence.write.failed",
        level: "error",
        correlation: { ...correlation, sessionId: document.id },
        durationMs: Math.max(0, Date.now() - startedAt),
        attributes: { sink: "file", stage },
        error: serializeRuntimeError(error),
      });
      throw error;
    } finally {
      try {
        rmSync(temporary, { force: true });
      } catch (error) {
        this.observe?.({
          event: "persistence.temporary_file.cleanup_failed",
          level: "warn",
          correlation: { ...correlation, sessionId: document.id },
          error: serializeRuntimeError(error),
        });
      }
    }
  }

  read(sessionId: string, correlation?: RuntimeCorrelation): WorldSessionDocument {
    const startedAt = Date.now();
    const file = this.file(sessionId);
    if (!existsSync(file)) {
      const error = new WorldSessionNotFoundError(sessionId);
      this.observe?.({
        event: "persistence.read.failed",
        level: "warn",
        correlation: { ...correlation, sessionId },
        durationMs: Math.max(0, Date.now() - startedAt),
        error: serializeRuntimeError(error),
      });
      throw error;
    }
    let serialized: string;
    try {
      serialized = readFileSync(file, "utf8");
    } catch (error) {
      this.observe?.({
        event: "persistence.read.failed",
        level: "error",
        correlation: { ...correlation, sessionId },
        durationMs: Math.max(0, Date.now() - startedAt),
        error: serializeRuntimeError(error),
      });
      throw error;
    }
    return parse(serialized, sessionId, this.observer, correlation);
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
