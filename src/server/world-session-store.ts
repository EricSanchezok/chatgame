import { z } from "zod";
import { contentHash } from "../engine/model-audit";
import {
  NOOP_RUNTIME_OBSERVER,
  runtimeEventEmitter,
  serializeRuntimeError,
  type RuntimeCorrelation,
  type RuntimeObserver,
} from "../engine/observability";
import { validateSimulationState } from "../engine/transaction";
import type { WorldRunEvent, WorldSessionDocument } from "./world-run-types";

const runStatusSchema = z.enum([
  "queued", "running", "awaiting_player", "completed", "goal_failed", "step_limit", "cancelled", "failed",
]);
const activeRunStatuses = new Set(["queued", "running", "awaiting_player", "step_limit", "failed"]);

const beliefValueViewSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("text"), value: z.string() }),
  z.strictObject({ kind: z.literal("number"), value: z.number().finite() }),
  z.strictObject({ kind: z.literal("boolean"), value: z.boolean() }),
  z.strictObject({ kind: z.literal("local_entity"), localEntityId: z.string().min(1) }),
  z.strictObject({ kind: z.literal("none") }),
]);

const localEntityViewSchema = z.strictObject({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string(),
  status: z.enum(["observed", "reported", "hypothesized"]),
});

const eventBase = { sequence: z.number().int().positive(), at: z.string().datetime() };
const checkPayloadSchema = z.discriminatedUnion("visibility", [
  z.strictObject({
    requestId: z.string().min(1),
    visibility: z.literal("full"),
    dice: z.array(z.number().int().min(1).max(20)).min(1).max(2),
    kept: z.number().int().min(1).max(20),
    modifier: z.number().int(),
    total: z.number().int(),
    dc: z.number().int().min(0).max(100),
    succeeded: z.boolean(),
    margin: z.number().int(),
  }),
  z.strictObject({
    requestId: z.string().min(1),
    visibility: z.literal("result_only"),
    succeeded: z.boolean(),
  }),
]);

const runEventSchema = z.union([
  z.strictObject({
    ...eventBase,
    type: z.literal("player.input"),
    payload: z.strictObject({
      id: z.string().min(1),
      kind: z.enum(["goal", "clarification"]),
      text: z.string().min(1).max(4_000),
    }),
  }),
  z.strictObject({
    ...eventBase,
    type: z.literal("run.execution_started"),
    payload: z.strictObject({
      runId: z.string().min(1),
      inputId: z.string().min(1),
      reason: z.enum(["initial", "player_input", "retry"]),
    }),
  }),
  z.strictObject({ ...eventBase, type: z.literal("check.resolved"), payload: checkPayloadSchema }),
  z.strictObject({
    ...eventBase,
    type: z.literal("player.outcome"),
    payload: z.strictObject({
      status: z.enum(["succeeded", "partial", "failed", "blocked", "continuing"]),
      summary: z.string(),
      knownAlternatives: z.array(z.string()),
    }),
  }),
  z.strictObject({
    ...eventBase,
    type: z.literal("player.observation"),
    payload: z.strictObject({
      id: z.string().min(1),
      observerId: z.literal("player"),
      step: z.number().int().nonnegative(),
      summary: z.string(),
      introductions: z.array(z.strictObject({ localEntity: localEntityViewSchema })),
      apparentClaims: z.array(z.strictObject({
        id: z.string().min(1),
        subjectId: z.string().min(1),
        predicate: z.string().min(1),
        value: beliefValueViewSchema,
        description: z.string(),
      })),
      sourceEventIds: z.array(z.string().min(1)),
    }),
  }),
  z.strictObject({
    ...eventBase,
    type: z.literal("step.committed"),
    payload: z.strictObject({
      revision: z.number().int().nonnegative(),
      step: z.number().int().nonnegative(),
      elapsedSeconds: z.number().int().nonnegative(),
    }),
  }),
  z.strictObject({
    ...eventBase,
    type: z.enum([
      "run.awaiting_player", "run.completed", "run.goal_failed", "run.step_limit", "run.cancelled",
    ]),
    payload: z.strictObject({
      runId: z.string().min(1),
      revision: z.number().int().nonnegative(),
      step: z.number().int().nonnegative(),
    }),
  }),
  z.strictObject({
    ...eventBase,
    type: z.literal("run.failed"),
    payload: z.strictObject({
      runId: z.string().min(1),
      message: z.string(),
      retriable: z.literal(true),
    }),
  }),
]) as z.ZodType<WorldRunEvent>;

const worldContractSchema = z.strictObject({
  id: z.string().min(1),
  name: z.string().min(1),
  manifestVersion: z.string().min(1),
  description: z.string(),
  contentHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  modelProfiles: z.strictObject({
    perception: z.string().min(1),
    reactionRouting: z.string().min(1),
    resolution: z.string().min(1),
    transition: z.string().min(1),
    causalVerifier: z.string().min(1),
  }),
  laws: z.array(z.strictObject({
    id: z.string().min(1),
    text: z.string().min(1),
    severity: z.enum(["hard", "soft"]),
  })).min(1),
  disclosure: z.strictObject({ defaultCheckVisibility: z.enum(["full", "result_only", "hidden"]) }),
  rulePackages: z.array(z.strictObject({
    id: z.string().min(1),
    version: z.string().min(1),
    config: z.unknown(),
    adjudication: z.string().min(1),
    rules: z.array(z.strictObject({ id: z.string().min(1), description: z.string().min(1) })),
  })).min(1),
});

const documentEnvelopeSchema = z.strictObject({
  schemaVersion: z.literal(7),
  id: z.string().min(1),
  world: worldContractSchema,
  title: z.string().trim().min(1).max(80),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  state: z.unknown(),
  runs: z.record(z.string(), z.unknown()),
});

const runRecordSchema = z.strictObject({
  id: z.string().min(1),
  sessionId: z.string().min(1),
  intentId: z.string().min(1),
  status: runStatusSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  cancelRequested: z.boolean(),
  error: z.string().optional(),
  internalError: z.string().optional(),
  events: z.array(z.unknown()).min(1),
});

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

function validateWorldSessionDocument(document: WorldSessionDocument, expectedSessionId?: string): void {
  documentEnvelopeSchema.parse(document);
  if (expectedSessionId && document.id !== expectedSessionId) throw new Error("session document id mismatch");
  if (Date.parse(document.updatedAt) < Date.parse(document.createdAt)) {
    throw new Error("session timestamps move backwards");
  }
  if (document.state.worldId !== document.world.id || document.state.worldHash !== document.world.contentHash) {
    throw new Error("session world contract mismatch");
  }
  const lawIds = new Set(document.world.laws.map((law) => law.id));
  if (lawIds.size !== document.world.laws.length || document.state.lawIds.length !== lawIds.size ||
    document.state.lawIds.some((id) => !lawIds.has(id))) {
    throw new Error("session world laws mismatch");
  }
  validateSimulationState(document.state, true, true);

  const currentIntentRuns: string[] = [];
  const intentIds = new Set<string>();
  for (const [runId, candidate] of Object.entries(document.runs)) {
    const parsedRun = runRecordSchema.safeParse(candidate);
    if (!parsedRun.success) throw new Error(`invalid run ${runId}`);
    const run = parsedRun.data;
    if (run.id !== runId || run.sessionId !== document.id || intentIds.has(run.intentId)) {
      throw new Error(`invalid run identity ${runId}`);
    }
    intentIds.add(run.intentId);
    const events = run.events.map((event) => validateRunEvent(event, runId));
    if (Date.parse(run.createdAt) < Date.parse(document.createdAt) ||
      Date.parse(run.updatedAt) < Date.parse(run.createdAt) || run.updatedAt !== events.at(-1)!.at) {
      throw new Error(`invalid run timestamps ${runId}`);
    }
    const inputIds = new Set<string>();
    let latestInputId: string | undefined;
    for (let index = 0; index < events.length; index += 1) {
      const event = events[index];
      if (event.sequence !== index + 1) throw new Error(`invalid event sequence in run ${runId}`);
      if (index > 0 && Date.parse(event.at) < Date.parse(events[index - 1].at)) {
        throw new Error(`event timestamps move backwards in run ${runId}`);
      }
      if (event.type === "player.input") {
        if (inputIds.has(event.payload.id)) throw new Error(`duplicate player input ${event.payload.id}`);
        if (inputIds.size === 0 && event.payload.kind !== "goal") throw new Error(`run ${runId} has no goal input`);
        if (inputIds.size > 0 && event.payload.kind !== "clarification") {
          throw new Error(`run ${runId} repeats its goal input`);
        }
        inputIds.add(event.payload.id);
        latestInputId = event.payload.id;
      }
      if (event.type === "run.execution_started") {
        const previous = events[index - 1];
        if (event.payload.inputId !== latestInputId) {
          throw new Error(`run ${runId} starts from a stale or unknown input ${event.payload.inputId}`);
        }
        if (event.payload.reason === "initial" &&
          (index !== 1 || inputIds.size !== 1 || previous?.type !== "player.input")) {
          throw new Error(`run ${runId} has an invalid initial execution`);
        }
        if (event.payload.reason === "player_input" &&
          (inputIds.size < 2 || previous?.type !== "player.input" || previous.payload.kind !== "clarification")) {
          throw new Error(`run ${runId} continues without clarification`);
        }
        if (event.payload.reason === "retry" && previous?.type !== "run.failed" &&
          previous?.type !== "run.step_limit") {
          throw new Error(`run ${runId} retries without a retriable boundary`);
        }
      }
    }
    if (inputIds.size === 0) throw new Error(`run ${runId} has no player input`);
    const lastEvent = events.at(-1)!;
    if (!activeRunStatuses.has(run.status) && lastEvent.type !== `run.${run.status}`) {
      throw new Error(`run ${runId} terminal status has no matching event`);
    }
    if (run.cancelRequested && run.status !== "queued" && run.status !== "running") {
      throw new Error(`run ${runId} has a stale cancellation request`);
    }
    if (run.status === "failed" ? !run.error || !run.internalError : run.error || run.internalError) {
      throw new Error(`run ${runId} has inconsistent failure details`);
    }
    if (document.state.player.intent && run.intentId === document.state.player.intent.id) {
      currentIntentRuns.push(runId);
      const latestInput = [...events].reverse().find((event) => event.type === "player.input");
      if (!latestInput || latestInput.type !== "player.input" ||
        latestInput.payload.id !== document.state.player.intent.latestInput.id ||
        latestInput.payload.text !== document.state.player.intent.latestInput.text ||
        latestInput.payload.kind !== document.state.player.intent.latestInput.kind) {
        throw new Error(`run ${runId} input does not match current intent`);
      }
      if (document.state.player.intent.status === "active") {
        if (!activeRunStatuses.has(run.status)) throw new Error(`active intent belongs to terminal run ${runId}`);
      } else {
        const expectedStatus = {
          completed: "completed",
          failed: "goal_failed",
          cancelled: "cancelled",
        }[document.state.player.intent.status];
        if (run.status !== expectedStatus) throw new Error(`terminal intent does not match run ${runId}`);
      }
    } else if (activeRunStatuses.has(run.status)) {
      throw new Error(`run ${runId} has no matching active intent`);
    }
  }
  if (document.state.player.intent && currentIntentRuns.length !== 1) {
    throw new Error("current player intent must belong to exactly one run");
  }
  if (!document.state.player.intent && Object.keys(document.runs).length > 0) {
    throw new Error("session runs require a current player intent");
  }
}

export function serializeWorldSessionDocument(
  document: WorldSessionDocument,
  observer: RuntimeObserver = NOOP_RUNTIME_OBSERVER,
  correlation?: RuntimeCorrelation,
): string {
  const observe = runtimeEventEmitter(observer);
  const validationStartedAt = Date.now();
  try {
    validateWorldSessionDocument(document);
    observe?.({
      event: "persistence.history_validation.completed",
      correlation,
      durationMs: Math.max(0, Date.now() - validationStartedAt),
      counts: { history: document.state.history.length, runs: Object.keys(document.runs).length },
      hashes: { state: contentHash(document.state) },
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
  const startedAt = Date.now();
  try {
    const serialized = JSON.stringify(document);
    observe?.({
      event: "persistence.document.serialized",
      correlation,
      durationMs: Math.max(0, Date.now() - startedAt),
      measurements: { documentUtf8Bytes: Buffer.byteLength(serialized, "utf8") },
      hashes: { document: contentHash(document) },
    });
    return serialized;
  } catch (error) {
    observe?.({
      event: "persistence.document.serialization_failed",
      level: "error",
      correlation,
      durationMs: Math.max(0, Date.now() - startedAt),
      error: serializeRuntimeError(error),
    });
    throw error;
  }
}

export function parseWorldSessionDocument(
  serialized: string,
  expectedSessionId?: string,
  observer: RuntimeObserver = NOOP_RUNTIME_OBSERVER,
  correlation?: RuntimeCorrelation,
): WorldSessionDocument {
  const observe = runtimeEventEmitter(observer);
  const startedAt = Date.now();
  try {
    const document = documentEnvelopeSchema.parse(JSON.parse(serialized)) as WorldSessionDocument;
    validateWorldSessionDocument(document, expectedSessionId);
    observe?.({
      event: "persistence.read.completed",
      correlation: { ...correlation, sessionId: expectedSessionId ?? document.id },
      durationMs: Math.max(0, Date.now() - startedAt),
      measurements: { documentUtf8Bytes: Buffer.byteLength(serialized, "utf8") },
      counts: { history: document.state.history.length, runs: Object.keys(document.runs).length },
      hashes: { document: contentHash(document) },
    });
    return document;
  } catch (error) {
    observe?.({
      event: "persistence.read.failed",
      level: "error",
      correlation: { ...correlation, sessionId: expectedSessionId },
      durationMs: Math.max(0, Date.now() - startedAt),
      measurements: { documentUtf8Bytes: Buffer.byteLength(serialized, "utf8") },
      error: serializeRuntimeError(error),
    });
    throw error;
  }
}

export interface StoredWorldSession {
  generation: number;
  document: WorldSessionDocument;
}

export interface WorldSessionStore {
  create(document: WorldSessionDocument, correlation?: RuntimeCorrelation): StoredWorldSession;
  read(sessionId: string, correlation?: RuntimeCorrelation): StoredWorldSession;
  compareAndSwap(
    sessionId: string,
    expectedGeneration: number,
    document: WorldSessionDocument,
    correlation?: RuntimeCorrelation,
  ): StoredWorldSession;
  listSessions(correlation?: RuntimeCorrelation): StoredWorldSession[];
  delete(sessionId: string, expectedGeneration: number, correlation?: RuntimeCorrelation): void;
}

export class WorldSessionNotFoundError extends Error {
  constructor(readonly sessionId: string) {
    super(`world session not found: ${sessionId}`);
    this.name = "WorldSessionNotFoundError";
  }
}

export class WorldSessionConflictError extends Error {
  constructor(readonly sessionId: string) {
    super(`world session changed concurrently: ${sessionId}`);
    this.name = "WorldSessionConflictError";
  }
}

export class MemoryWorldSessionStore implements WorldSessionStore {
  private readonly values = new Map<string, { generation: number; serialized: string }>();
  private readonly observe: ReturnType<typeof runtimeEventEmitter>;
  writeCount = 0;

  constructor(private readonly observer: RuntimeObserver = NOOP_RUNTIME_OBSERVER) {
    this.observe = runtimeEventEmitter(observer);
  }

  create(document: WorldSessionDocument, correlation?: RuntimeCorrelation): StoredWorldSession {
    if (this.values.has(document.id)) throw new WorldSessionConflictError(document.id);
    this.writeCount += 1;
    this.values.set(document.id, {
      generation: 1,
      serialized: serializeWorldSessionDocument(document, this.observer, correlation),
    });
    this.observe?.({
      event: "persistence.write.completed",
      correlation: { ...correlation, sessionId: document.id },
      attributes: { sink: "memory", operation: "create" },
    });
    return this.read(document.id, correlation);
  }

  read(sessionId: string, correlation?: RuntimeCorrelation): StoredWorldSession {
    const stored = this.values.get(sessionId);
    if (!stored) throw new WorldSessionNotFoundError(sessionId);
    return {
      generation: stored.generation,
      document: parseWorldSessionDocument(stored.serialized, sessionId, this.observer, correlation),
    };
  }

  compareAndSwap(
    sessionId: string,
    expectedGeneration: number,
    document: WorldSessionDocument,
    correlation?: RuntimeCorrelation,
  ): StoredWorldSession {
    const stored = this.values.get(sessionId);
    if (!stored) throw new WorldSessionNotFoundError(sessionId);
    if (stored.generation !== expectedGeneration) throw new WorldSessionConflictError(sessionId);
    if (document.id !== sessionId) throw new Error("session document id mismatch");
    this.writeCount += 1;
    this.values.set(sessionId, {
      generation: expectedGeneration + 1,
      serialized: serializeWorldSessionDocument(document, this.observer, correlation),
    });
    this.observe?.({
      event: "persistence.write.completed",
      correlation: { ...correlation, sessionId },
      attributes: { sink: "memory", operation: "compare_and_swap" },
    });
    return this.read(sessionId, correlation);
  }

  listSessions(correlation?: RuntimeCorrelation): StoredWorldSession[] {
    return [...this.values.keys()].sort().map((id) => this.read(id, correlation));
  }

  delete(sessionId: string, expectedGeneration: number, correlation?: RuntimeCorrelation): void {
    const stored = this.values.get(sessionId);
    if (!stored) throw new WorldSessionNotFoundError(sessionId);
    if (stored.generation !== expectedGeneration) throw new WorldSessionConflictError(sessionId);
    this.values.delete(sessionId);
    this.observe?.({
      event: "persistence.delete.completed",
      correlation: { ...correlation, sessionId },
      attributes: { sink: "memory" },
    });
  }
}
