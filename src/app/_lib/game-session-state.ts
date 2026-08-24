import {
  isWorldRunActiveIntentOwner,
  isWorldRunExecuting,
  isWorldRunRetriable,
  isWorldRunStreamBoundary,
  type PublicSessionDetail,
  type PublicSessionSummary,
  type WorldRunEvent,
  type WorldRunRecordView,
  type WorldRunSnapshot,
} from "../../shared/world-api";
import { WorldApiError } from "../lib/world-api-client";

export const runEventTypes: WorldRunEvent["type"][] = [
  "player.input",
  "run.execution_started",
  "check.resolved",
  "player.outcome",
  "player.observation",
  "step.committed",
  "run.awaiting_player",
  "run.completed",
  "run.goal_failed",
  "run.step_limit",
  "run.cancelled",
  "run.failed",
];

export type SessionAction =
  | { type: "load"; detail: PublicSessionDetail }
  | { type: "summary"; summary: PublicSessionSummary }
  | { type: "snapshot"; snapshot: WorldRunSnapshot }
  | { type: "event"; runId: string; event: WorldRunEvent };

export interface PendingStartMatcher {
  attemptId: string;
  existingRunIds: string[];
  goal: string;
  originalError: unknown;
  confirmAfter: number;
  absenceCount: number;
}

export type ClientOperationKind = "start" | "continue" | "cancel" | "retry" | "abandon";

export interface ClientOperation {
  token: number;
  kind: ClientOperationKind;
  runId?: string;
}

export type ClientOperationRequest = Omit<ClientOperation, "token">;

export const pendingStartConfirmationDelayMs = 1_000;
const definitiveStartFailureStatuses = new Set([400, 401, 403, 404, 422]);

export function isAwaitingPlayer(run: WorldRunRecordView | undefined): boolean {
  return run?.status === "awaiting_player";
}

function activeRunSummary(run: WorldRunRecordView | undefined): PublicSessionDetail["summary"]["activeRun"] {
  if (!run || !isWorldRunExecuting(run.status)) return undefined;
  return { id: run.id, status: run.status };
}

function latestRun(
  runs: WorldRunRecordView[],
  predicate: (run: WorldRunRecordView) => boolean,
): WorldRunRecordView | undefined {
  return [...runs].reverse().find(predicate);
}

export function executingRun(runs: WorldRunRecordView[]): WorldRunRecordView | undefined {
  return latestRun(runs, (run) => isWorldRunExecuting(run.status));
}

export function intentOwnerRun(runs: WorldRunRecordView[]): WorldRunRecordView | undefined {
  return latestRun(runs, (run) => isWorldRunActiveIntentOwner(run.status));
}

function withDerivedActiveRun(detail: PublicSessionDetail): PublicSessionDetail {
  return {
    ...detail,
    summary: {
      ...detail.summary,
      activeRun: activeRunSummary(executingRun(detail.runs)),
    },
  };
}

export function isTerminalEvent(event: WorldRunEvent): boolean {
  return event.type === "run.awaiting_player" || event.type === "run.completed" ||
    event.type === "run.goal_failed" || event.type === "run.step_limit" ||
    event.type === "run.cancelled" || event.type === "run.failed";
}

export function matchesPendingStart(run: WorldRunRecordView, pending: PendingStartMatcher): boolean {
  return !pending.existingRunIds.includes(run.id) &&
    run.inputs.some((input) => input.kind === "goal" && input.text === pending.goal);
}

export function isUncertainStartError(error: unknown): boolean {
  if (!(error instanceof WorldApiError)) return true;
  return !definitiveStartFailureStatuses.has(error.status);
}

function upsertRun(runs: WorldRunRecordView[], run: WorldRunRecordView): WorldRunRecordView[] {
  const index = runs.findIndex((candidate) => candidate.id === run.id);
  if (index < 0) return [...runs, run];
  return runs.map((candidate) => candidate.id === run.id ? run : candidate);
}

export function runTailSequence(run: WorldRunRecordView): number {
  return run.events.at(-1)?.sequence ?? 0;
}

function compareRunFreshness(left: WorldRunRecordView, right: WorldRunRecordView): number {
  const sequenceDifference = runTailSequence(left) - runTailSequence(right);
  if (sequenceDifference !== 0) return sequenceDifference;
  const leftIsRetryBoundary = isWorldRunRetriable(left);
  const rightIsRetryBoundary = isWorldRunRetriable(right);
  if (left.status === "queued" && rightIsRetryBoundary) return 1;
  if (leftIsRetryBoundary && right.status === "queued") return -1;
  if (left.status === right.status && left.cancelRequested !== right.cancelRequested) {
    if (isWorldRunExecuting(left.status)) return left.cancelRequested ? 1 : -1;
    if (isWorldRunStreamBoundary(left.status)) return left.cancelRequested ? -1 : 1;
  }
  const updatedDifference = left.updatedAt.localeCompare(right.updatedAt);
  if (updatedDifference !== 0) return updatedDifference;
  return left.inputs.length - right.inputs.length;
}

function mergeRuns(
  current: WorldRunRecordView[],
  incoming: WorldRunRecordView[],
): WorldRunRecordView[] {
  const merged = new Map(current.map((run) => [run.id, run]));
  for (const run of incoming) {
    const existing = merged.get(run.id);
    if (!existing || compareRunFreshness(run, existing) >= 0) merged.set(run.id, run);
  }
  return [...merged.values()].sort((left, right) => left.createdAt.localeCompare(right.createdAt));
}

function compareSessionFreshness(left: PublicSessionDetail, right: PublicSessionDetail): number {
  const revisionDifference = left.state.revision - right.state.revision;
  if (revisionDifference !== 0) return revisionDifference;
  const eventDifference = left.runs.reduce((total, run) => total + runTailSequence(run), 0) -
    right.runs.reduce((total, run) => total + runTailSequence(run), 0);
  if (eventDifference !== 0) return eventDifference;
  return left.summary.updatedAt.localeCompare(right.summary.updatedAt);
}

function statusAfterEvent(
  current: WorldRunRecordView["status"],
  event: WorldRunEvent,
): WorldRunRecordView["status"] {
  switch (event.type) {
    case "run.execution_started": return "running";
    case "run.awaiting_player": return "awaiting_player";
    case "run.completed": return "completed";
    case "run.goal_failed": return "goal_failed";
    case "run.step_limit": return "step_limit";
    case "run.cancelled": return "cancelled";
    case "run.failed": return "failed";
    default: return current;
  }
}

export function sessionReducer(
  state: PublicSessionDetail | undefined,
  action: SessionAction,
): PublicSessionDetail | undefined {
  if (action.type === "summary") {
    return state ? { ...state, summary: action.summary } : state;
  }
  if (action.type === "load") {
    if (!state) return withDerivedActiveRun(action.detail);
    const runs = mergeRuns(state.runs, action.detail.runs);
    const freshest = compareSessionFreshness(action.detail, state) >= 0 ? action.detail : state;
    return withDerivedActiveRun({ ...freshest, runs });
  }
  if (!state) return state;
  if (action.type === "snapshot") {
    const current = state.runs.find((run) => run.id === action.snapshot.run.id);
    if (current && compareRunFreshness(action.snapshot.run, current) < 0) return state;
    const runs = upsertRun(state.runs, action.snapshot.run);
    const nextState = action.snapshot.state.revision >= state.state.revision
      ? action.snapshot.state
      : state.state;
    return {
      ...state,
      state: nextState,
      summary: {
        ...state.summary,
        revision: nextState.revision,
        step: nextState.step,
        elapsedSeconds: nextState.elapsedSeconds,
        updatedAt: state.summary.updatedAt.localeCompare(action.snapshot.run.updatedAt) >= 0
          ? state.summary.updatedAt
          : action.snapshot.run.updatedAt,
        activeRun: activeRunSummary(executingRun(runs)),
      },
      runs,
    };
  }
  const current = state.runs.find((run) => run.id === action.runId);
  if (!current || action.event.sequence <= runTailSequence(current)) return state;
  const events = [...current.events, action.event].sort((left, right) => left.sequence - right.sequence);
  const status = statusAfterEvent(current.status, action.event);
  const playerInput = action.event.type === "player.input" ? action.event : undefined;
  const inputs = playerInput && !current.inputs.some((input) => input.id === playerInput.payload.id)
    ? [...current.inputs, { ...playerInput.payload, at: playerInput.at }]
    : current.inputs;
  const run = { ...current, inputs, events, status, updatedAt: action.event.at };
  const runs = upsertRun(state.runs, run);
  const committed = action.event.type === "step.committed" ? action.event.payload : undefined;
  return {
    ...state,
    state: committed ? { ...state.state, ...committed } : state.state,
    summary: {
      ...state.summary,
      ...(committed ?? {}),
      updatedAt: action.event.at,
      activeRun: activeRunSummary(executingRun(runs)),
    },
    runs,
  };
}
