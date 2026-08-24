import { z } from "zod";
import type { PlayerIntent } from "../engine/model";
import { contentHash } from "../engine/model-audit";
import { createHistoryReplayBase } from "../engine/history-replay";
import {
  NOOP_RUNTIME_OBSERVER,
  runtimeEventEmitter,
  serializeRuntimeError,
  type RuntimeCorrelation,
  type RuntimeEventInput,
  type RuntimeObserver,
} from "../engine/observability";
import { validateDiscreteRandomDefinitions } from "../engine/random";
import { validateSimulationState } from "../engine/transaction";
import { discreteRandomDefinitionSchema, semanticIdSchema } from "../engine/state-schemas";
import {
  isWorldRunActiveIntentOwner,
  isWorldRunExecuting,
  isWorldRunStreamBoundary,
} from "../shared/world-api";
import {
  publicCommittedStepEvents,
  type WorldRunEvent,
  type WorldRunEventInput,
  type WorldSessionDocument,
} from "./world-run-types";

const runStatusSchema = z.enum([
  "queued", "running", "awaiting_player", "completed", "goal_failed", "step_limit", "cancelled", "failed",
]);

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
const preservedNonBlankStringSchema = z.string().refine((value) => value.trim().length > 0, {
  message: "string must contain non-whitespace text",
});
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
      summary: preservedNonBlankStringSchema,
    }),
  }),
  z.strictObject({
    ...eventBase,
    type: z.literal("player.observation"),
    payload: z.strictObject({
      id: z.string().min(1),
      observerId: z.literal("player"),
      step: z.number().int().nonnegative(),
      summary: preservedNonBlankStringSchema,
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
      message: preservedNonBlankStringSchema,
      retriable: z.boolean(),
    }),
  }),
]) as z.ZodType<WorldRunEvent>;

const persistedRandomDefinitionSchema = discreteRandomDefinitionSchema.superRefine((definition, context) => {
  const ids: Array<{ value: string; path: Array<string | number> }> = [
    { value: definition.id, path: ["id"] },
    ...definition.steps.flatMap((step, index) => [
      { value: step.id, path: ["steps", index, "id"] },
      ...(step.when ? [{ value: step.when.stepId, path: ["steps", index, "when", "stepId"] }] : []),
    ]),
  ];
  for (const { value, path } of ids) {
    const parsed = semanticIdSchema.safeParse(value);
    if (!parsed.success) {
      context.addIssue({ code: "custom", message: parsed.error.issues[0].message, path });
    }
  }
});

const worldContractSchema = z.strictObject({
  id: semanticIdSchema,
  name: z.string().min(1),
  manifestVersion: z.string().min(1),
  description: z.string(),
  contentHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  modelProfiles: z.strictObject({
    perception: semanticIdSchema,
    reactionRouting: semanticIdSchema,
    resolution: semanticIdSchema,
    transition: semanticIdSchema,
    causalVerifier: semanticIdSchema,
  }),
  laws: z.array(z.strictObject({
    id: semanticIdSchema,
    text: z.string().min(1),
    severity: z.enum(["hard", "soft"]),
  })).min(1),
  disclosure: z.strictObject({ defaultCheckVisibility: z.enum(["full", "result_only", "hidden"]) }),
  rulePackages: z.array(z.strictObject({
    id: semanticIdSchema,
    version: z.string().min(1),
    config: z.unknown(),
    adjudication: z.string().min(1),
    rules: z.array(z.strictObject({ id: semanticIdSchema, description: z.string().min(1) })),
  })).min(1),
  randomDistributions: z.array(persistedRandomDefinitionSchema),
  historyBaseHash: z.string().regex(/^[a-f0-9]{64}$/),
});

const documentEnvelopeSchema = z.strictObject({
  schemaVersion: z.literal(9),
  id: z.string().min(1),
  world: worldContractSchema,
  title: preservedNonBlankStringSchema.max(80),
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
  error: preservedNonBlankStringSchema.optional(),
  internalError: preservedNonBlankStringSchema.optional(),
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

type RunEventPhase =
  | "start"
  | "queued_initial"
  | "queued_player_input"
  | "executing"
  | "awaiting_player"
  | "failed_retriable"
  | "failed_permanent"
  | "step_limit"
  | "completed"
  | "goal_failed"
  | "cancelled";

function advanceRunEventPhase(
  phase: RunEventPhase,
  event: WorldRunEvent,
  previous: WorldRunEvent | undefined,
  runId: string,
): RunEventPhase {
  if (phase === "start") {
    if (event.type === "player.input" && event.payload.kind === "goal") return "queued_initial";
  } else if (phase === "queued_initial" || phase === "queued_player_input") {
    if (event.type === "run.execution_started" &&
      event.payload.reason === (phase === "queued_initial" ? "initial" : "player_input")) {
      return "executing";
    }
    if (event.type === "run.failed") {
      return event.payload.retriable ? "failed_retriable" : "failed_permanent";
    }
    if (event.type === "run.cancelled") return "cancelled";
  } else if (phase === "executing") {
    if (event.type === "check.resolved" || event.type === "player.outcome" ||
      event.type === "player.observation" || event.type === "step.committed") {
      return "executing";
    }
    if (event.type === "run.failed") {
      return event.payload.retriable ? "failed_retriable" : "failed_permanent";
    }
    if (event.type === "run.cancelled") return "cancelled";
    if (previous?.type === "step.committed") {
      if (event.type === "run.awaiting_player") return "awaiting_player";
      if (event.type === "run.completed") return "completed";
      if (event.type === "run.goal_failed") return "goal_failed";
      if (event.type === "run.step_limit") return "step_limit";
    }
  } else if (phase === "awaiting_player") {
    if (event.type === "player.input" && event.payload.kind === "clarification") {
      return "queued_player_input";
    }
    if (event.type === "run.cancelled") return "cancelled";
  } else if (phase === "failed_retriable") {
    if (event.type === "run.execution_started" && event.payload.reason === "retry") return "executing";
    if (event.type === "run.failed" && event.payload.retriable) return "failed_retriable";
    if (event.type === "run.cancelled") return "cancelled";
  } else if (phase === "step_limit") {
    if (event.type === "run.execution_started" && event.payload.reason === "retry") return "executing";
    if (event.type === "run.failed" && event.payload.retriable) return "failed_retriable";
    if (event.type === "run.cancelled") return "cancelled";
  } else if (phase === "failed_permanent") {
    if (event.type === "run.cancelled") return "cancelled";
  }
  throw new Error(`invalid event transition after ${phase} in run ${runId}: ${event.type}`);
}

function phaseMatchesRunStatus(phase: RunEventPhase, status: WorldSessionDocument["runs"][string]["status"]): boolean {
  if (status === "queued") {
    return phase === "queued_initial" || phase === "queued_player_input" ||
      phase === "failed_retriable" || phase === "step_limit";
  }
  if (status === "running") return phase === "executing";
  if (status === "failed") return phase === "failed_retriable" || phase === "failed_permanent";
  return phase === status;
}

interface PublicStepLedgerEntry {
  revision: number;
  step: number;
  elapsedSeconds: number;
  events: WorldRunEventInput[];
  playerIntent: PlayerIntent;
}

interface PublicStepPosition {
  revision: number;
  step: number;
}

function buildPublicStepLedger(document: WorldSessionDocument): Map<number, PublicStepLedgerEntry> {
  const ledger = new Map<number, PublicStepLedgerEntry>();
  let elapsedSeconds = createHistoryReplayBase(document.state).truth.elapsedSeconds;
  for (const committed of document.state.history) {
    const advances = committed.operations.filter((operation) => operation.kind === "advance_time");
    if (advances.length !== 1) {
      throw new Error(`history step ${committed.step} has no unique elapsed-time projection`);
    }
    elapsedSeconds += advances[0].seconds;
    ledger.set(committed.revision, {
      revision: committed.revision,
      step: committed.step,
      elapsedSeconds,
      events: publicCommittedStepEvents(committed, elapsedSeconds),
      playerIntent: committed.playerIntent,
    });
  }
  return ledger;
}

interface PublicPlayerInput {
  id: string;
  text: string;
  kind: "goal" | "clarification";
}

function validateRunIntentLedger(
  runId: string,
  runIntentId: string,
  publicInputs: readonly PublicPlayerInput[],
  canonicalIntent: PlayerIntent,
  canonicalSource: string,
): void {
  if (runIntentId !== canonicalIntent.id) {
    throw new Error(`run ${runId} intent id does not match ${canonicalSource}`);
  }
  if (publicInputs.length !== canonicalIntent.inputs.length || publicInputs.some((input, index) =>
    input.id !== canonicalIntent.inputs[index].id || input.text !== canonicalIntent.inputs[index].text ||
    input.kind !== canonicalIntent.inputs[index].kind)) {
    throw new Error(`run ${runId} input history does not match ${canonicalSource}`);
  }
}

function sameStepPosition(left: PublicStepPosition, right: PublicStepPosition): boolean {
  return left.revision === right.revision && left.step === right.step;
}

function validatePositionedBoundary(
  document: WorldSessionDocument,
  runId: string,
  position: PublicStepPosition,
  latestCommitted: PublicStepPosition | undefined,
): void {
  if (position.revision !== position.step || position.revision > document.state.revision) {
    throw new Error(`run ${runId} has an impossible stream boundary position`);
  }
  if (latestCommitted && !sameStepPosition(position, latestCommitted)) {
    throw new Error(`run ${runId} stream boundary does not match its latest committed step`);
  }
  const currentIntent = document.state.player.intent;
  if (!latestCommitted && currentIntent?.id === document.runs[runId].intentId &&
    position.revision !== currentIntent.startedAtStep) {
    throw new Error(`run ${runId} zero-step boundary does not match its intent start`);
  }
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
  validateDiscreteRandomDefinitions(document.world.randomDistributions);
  const lawIds = new Set(document.world.laws.map((law) => law.id));
  if (lawIds.size !== document.world.laws.length || document.state.lawIds.length !== lawIds.size ||
    document.state.lawIds.some((id) => !lawIds.has(id))) {
    throw new Error("session world laws mismatch");
  }
  validateSimulationState(document.state, true, true);
  if (contentHash(createHistoryReplayBase(document.state)) !== document.world.historyBaseHash) {
    throw new Error("session history replay base mismatch");
  }
  const publicStepLedger = buildPublicStepLedger(document);
  const publicCommittedRevisions = new Set<number>();
  const randomDistributions = new Map(document.world.randomDistributions.map((definition) => [
    definition.id,
    definition,
  ]));
  for (const step of document.state.history) {
    for (const request of step.randomRequests) {
      const pinned = randomDistributions.get(request.distributionId);
      if (!pinned || contentHash(pinned) !== contentHash(request.distribution)) {
        throw new Error(`session random distribution mismatch for ${request.id}`);
      }
    }
  }

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
      Date.parse(run.updatedAt) < Date.parse(run.createdAt) ||
      Date.parse(run.updatedAt) > Date.parse(document.updatedAt) || run.updatedAt !== events.at(-1)!.at) {
      throw new Error(`invalid run timestamps ${runId}`);
    }
    const inputIds = new Set<string>();
    const publicInputs: PublicPlayerInput[] = [];
    let latestInputId: string | undefined;
    let phase: RunEventPhase = "start";
    let latestCommitted: PublicStepPosition | undefined;
    let pendingStepEvents: WorldRunEventInput[] = [];
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
        publicInputs.push(event.payload);
        latestInputId = event.payload.id;
      }
      const isPublicStepEvent = event.type === "check.resolved" || event.type === "player.outcome" ||
        event.type === "player.observation" || event.type === "step.committed";
      if (isPublicStepEvent) {
        pendingStepEvents.push(structuredClone({ type: event.type, payload: event.payload }) as WorldRunEventInput);
      }
      if (event.type === "step.committed") {
        const expected = publicStepLedger.get(event.payload.revision);
        if (!expected || event.payload.step !== expected.step ||
          event.payload.elapsedSeconds !== expected.elapsedSeconds) {
          throw new Error(`run ${runId} committed step does not match canonical history`);
        }
        if (publicCommittedRevisions.has(event.payload.revision)) {
          throw new Error(`canonical history revision ${event.payload.revision} has multiple public commits`);
        }
        if (latestCommitted && event.payload.revision !== latestCommitted.revision + 1) {
          throw new Error(`run ${runId} public commits are not contiguous`);
        }
        if (contentHash(pendingStepEvents) !== contentHash(expected.events)) {
          throw new Error(`run ${runId} public step events do not match canonical history step ${expected.step}`);
        }
        validateRunIntentLedger(
          runId,
          run.intentId,
          publicInputs,
          expected.playerIntent,
          `canonical history revision ${expected.revision}`,
        );
        pendingStepEvents = [];
        latestCommitted = { revision: expected.revision, step: expected.step };
        publicCommittedRevisions.add(expected.revision);
      }
      const closesPendingStep = event.type === "player.input" || event.type === "run.execution_started" ||
        event.type === "run.failed" || event.type === "run.awaiting_player" ||
        event.type === "run.completed" || event.type === "run.goal_failed" ||
        event.type === "run.step_limit" || event.type === "run.cancelled";
      if (closesPendingStep && pendingStepEvents.length > 0) {
        throw new Error(`run ${runId} has public step events outside a committed step`);
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
        if (event.payload.reason === "retry" && previous?.type !== "run.step_limit" &&
          (previous?.type !== "run.failed" || !previous.payload.retriable)) {
          throw new Error(`run ${runId} retries a non-retriable failure`);
        }
      }
      if (event.type === "run.awaiting_player" || event.type === "run.completed" ||
        event.type === "run.goal_failed" || event.type === "run.step_limit" ||
        event.type === "run.cancelled") {
        validatePositionedBoundary(document, runId, event.payload, latestCommitted);
      }
      phase = advanceRunEventPhase(phase, event, events[index - 1], runId);
    }
    if (pendingStepEvents.length > 0) {
      throw new Error(`run ${runId} has public step events outside a committed step`);
    }
    if (inputIds.size === 0) throw new Error(`run ${runId} has no player input`);
    const lastEvent = events.at(-1)!;
    if (isWorldRunStreamBoundary(run.status) && lastEvent.type !== `run.${run.status}`) {
      throw new Error(`run ${runId} stream boundary has no matching final event`);
    }
    if (run.status === "running" && lastEvent.type !== "run.execution_started" &&
      lastEvent.type !== "step.committed") {
      throw new Error(`running run ${runId} has no matching final event`);
    }
    if (run.status === "queued" && lastEvent.type !== "player.input" &&
      lastEvent.type !== "run.step_limit" &&
      (lastEvent.type !== "run.failed" || !lastEvent.payload.retriable)) {
      throw new Error(`queued run ${runId} has no resumable final event`);
    }
    if (!phaseMatchesRunStatus(phase, run.status)) {
      throw new Error(`run ${runId} status ${run.status} does not match event phase ${phase}`);
    }
    if (run.cancelRequested && !isWorldRunExecuting(run.status)) {
      throw new Error(`run ${runId} has a stale cancellation request`);
    }
    if (run.status === "failed" ? !run.error || !run.internalError : run.error || run.internalError) {
      throw new Error(`run ${runId} has inconsistent failure details`);
    }
    if (run.status === "failed" &&
      (lastEvent.type !== "run.failed" || lastEvent.payload.message !== run.error)) {
      throw new Error(`run ${runId} failure details do not match its final event`);
    }
    if (document.state.player.intent?.id === run.intentId &&
      (lastEvent.type === "run.awaiting_player" || lastEvent.type === "run.completed" ||
        lastEvent.type === "run.goal_failed" || lastEvent.type === "run.step_limit" ||
        lastEvent.type === "run.cancelled") &&
      !sameStepPosition(lastEvent.payload, document.state)) {
      throw new Error(`current run ${runId} boundary does not match the canonical state`);
    }
    if (document.state.player.intent && run.intentId === document.state.player.intent.id) {
      currentIntentRuns.push(runId);
      validateRunIntentLedger(runId, run.intentId, publicInputs, document.state.player.intent, "current intent");
      if (document.state.player.intent.status === "active") {
        if (!isWorldRunActiveIntentOwner(run.status)) {
          throw new Error(`active intent belongs to closed run ${runId}`);
        }
      } else {
        const expectedStatus = {
          completed: "completed",
          failed: "goal_failed",
          cancelled: "cancelled",
        }[document.state.player.intent.status];
        if (run.status !== expectedStatus) throw new Error(`terminal intent does not match run ${runId}`);
      }
    } else if (isWorldRunActiveIntentOwner(run.status)) {
      throw new Error(`run ${runId} has no matching active intent`);
    }
  }
  if (publicCommittedRevisions.size !== publicStepLedger.size ||
    [...publicStepLedger.keys()].some((revision) => !publicCommittedRevisions.has(revision))) {
    throw new Error("public step ledger does not cover canonical history");
  }
  if (document.state.player.intent && currentIntentRuns.length !== 1) {
    throw new Error("current player intent must belong to exactly one run");
  }
  if (!document.state.player.intent && Object.keys(document.runs).length > 0) {
    throw new Error("session runs require a current player intent");
  }
}

function observeDocumentValidation(
  document: WorldSessionDocument,
  observer: RuntimeObserver,
  correlation: RuntimeCorrelation | undefined,
  startedAt: number,
): void {
  runtimeEventEmitter(observer)?.({
    event: "persistence.history_validation.completed",
    correlation,
    durationMs: Math.max(0, Date.now() - startedAt),
    counts: { history: document.state.history.length, runs: Object.keys(document.runs).length },
    hashes: { state: contentHash(document.state) },
  });
}

function serializeValidatedWorldSessionDocument(
  document: WorldSessionDocument,
  observer: RuntimeObserver,
  correlation?: RuntimeCorrelation,
): string {
  const observe = runtimeEventEmitter(observer);
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

export function serializeWorldSessionDocument(
  document: WorldSessionDocument,
  observer: RuntimeObserver = NOOP_RUNTIME_OBSERVER,
  correlation?: RuntimeCorrelation,
): string {
  const observe = runtimeEventEmitter(observer);
  const validationStartedAt = Date.now();
  try {
    validateWorldSessionDocument(document);
    observeDocumentValidation(document, observer, correlation, validationStartedAt);
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
  return serializeValidatedWorldSessionDocument(document, observer, correlation);
}

export function parseWorldSessionDocument(
  serialized: string,
  expectedSessionId?: string,
  observer: RuntimeObserver = NOOP_RUNTIME_OBSERVER,
  correlation?: RuntimeCorrelation,
  attributes?: RuntimeEventInput["attributes"],
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
      ...(attributes ? { attributes } : {}),
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
      ...(attributes ? { attributes } : {}),
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
  private readonly values = new Map<string, {
    generation: number;
    serialized: string;
    document: WorldSessionDocument;
  }>();
  private readonly observe: ReturnType<typeof runtimeEventEmitter>;
  writeCount = 0;

  constructor(private readonly observer: RuntimeObserver = NOOP_RUNTIME_OBSERVER) {
    this.observe = runtimeEventEmitter(observer);
  }

  create(document: WorldSessionDocument, correlation?: RuntimeCorrelation): StoredWorldSession {
    if (this.values.has(document.id)) throw new WorldSessionConflictError(document.id);
    this.writeCount += 1;
    const serialized = serializeWorldSessionDocument(document, this.observer, correlation);
    const validated = structuredClone(document);
    this.values.set(document.id, {
      generation: 1,
      serialized,
      document: validated,
    });
    this.observe?.({
      event: "persistence.write.completed",
      correlation: { ...correlation, sessionId: document.id },
      attributes: { sink: "memory", operation: "create" },
    });
    return { generation: 1, document: structuredClone(validated) };
  }

  read(sessionId: string, correlation?: RuntimeCorrelation): StoredWorldSession {
    const stored = this.values.get(sessionId);
    if (!stored) throw new WorldSessionNotFoundError(sessionId);
    this.observe?.({
      event: "persistence.read.completed",
      correlation: { ...correlation, sessionId },
      attributes: { sink: "memory", validation: "cached" },
    });
    return {
      generation: stored.generation,
      document: structuredClone(stored.document),
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
    const serialized = serializeWorldSessionDocument(document, this.observer, correlation);
    const validated = structuredClone(document);
    this.values.set(sessionId, {
      generation: expectedGeneration + 1,
      serialized,
      document: validated,
    });
    this.observe?.({
      event: "persistence.write.completed",
      correlation: { ...correlation, sessionId },
      attributes: { sink: "memory", operation: "compare_and_swap" },
    });
    return { generation: expectedGeneration + 1, document: structuredClone(validated) };
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
