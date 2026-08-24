"use client";

import {
  AssistantRuntimeProvider,
  useExternalStoreRuntime,
  type AppendMessage,
} from "@assistant-ui/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import {
  isWorldRunActiveIntentOwner,
  isWorldRunExecuting,
  isWorldRunRetriable,
  isWorldRunStreamBoundary,
  type PublicSessionDetail,
  type WorldRunEvent,
  type WorldRunRecordView,
  type WorldRunSnapshot,
} from "../../shared/world-api";
import { runsToMessages } from "../_lib/run-messages";
import { WorldApiError, worldApi } from "../lib/world-api-client";
import { ControlOrb } from "./control-orb";
import { GameThread } from "./game-thread";

const runEventTypes: WorldRunEvent["type"][] = [
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

function isAwaitingPlayer(run: WorldRunRecordView | undefined): boolean {
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

function executingRun(runs: WorldRunRecordView[]): WorldRunRecordView | undefined {
  return latestRun(runs, (run) => isWorldRunExecuting(run.status));
}

function intentOwnerRun(runs: WorldRunRecordView[]): WorldRunRecordView | undefined {
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

function isTerminalEvent(event: WorldRunEvent): boolean {
  return event.type === "run.awaiting_player" || event.type === "run.completed" ||
    event.type === "run.goal_failed" || event.type === "run.step_limit" ||
    event.type === "run.cancelled" || event.type === "run.failed";
}

type SessionAction =
  | { type: "load"; detail: PublicSessionDetail }
  | { type: "snapshot"; snapshot: WorldRunSnapshot }
  | { type: "event"; runId: string; event: WorldRunEvent };

interface PendingStartMatcher {
  attemptId: string;
  existingRunIds: string[];
  goal: string;
  originalError: unknown;
  confirmAfter: number;
  absenceCount: number;
}

type ClientOperationKind = "start" | "continue" | "cancel" | "retry" | "abandon";

interface ClientOperation {
  token: number;
  kind: ClientOperationKind;
  runId?: string;
}

type ClientOperationRequest = Omit<ClientOperation, "token">;

const pendingStartConfirmationDelayMs = 1_000;
const definitiveStartFailureStatuses = new Set([400, 401, 403, 404, 422]);

function matchesPendingStart(run: WorldRunRecordView, pending: PendingStartMatcher): boolean {
  return !pending.existingRunIds.includes(run.id) &&
    run.inputs.some((input) => input.kind === "goal" && input.text === pending.goal);
}

function isUncertainStartError(error: unknown): boolean {
  if (!(error instanceof WorldApiError)) return true;
  return !definitiveStartFailureStatuses.has(error.status);
}

function upsertRun(runs: WorldRunRecordView[], run: WorldRunRecordView): WorldRunRecordView[] {
  const index = runs.findIndex((candidate) => candidate.id === run.id);
  if (index < 0) return [...runs, run];
  return runs.map((candidate) => candidate.id === run.id ? run : candidate);
}

function runTailSequence(run: WorldRunRecordView): number {
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

function sessionReducer(state: PublicSessionDetail | undefined, action: SessionAction): PublicSessionDetail | undefined {
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

export function GameSession({ sessionId }: { sessionId: string }) {
  const router = useRouter();
  const [detail, dispatch] = useReducer(sessionReducer, undefined);
  const [loading, setLoading] = useState(true);
  const [actionError, setActionError] = useState("");
  const [streamWarning, setStreamWarning] = useState("");
  const [pendingAction, setPendingAction] = useState<ClientOperation>();
  const [pendingObservationRunId, setPendingObservationRunId] = useState<string>();
  const [pendingStartAttemptId, setPendingStartAttemptId] = useState<string>();
  const mountedRef = useRef(false);
  const detailRef = useRef<PublicSessionDetail | undefined>(undefined);
  const pendingActionRef = useRef<ClientOperation | undefined>(undefined);
  const operationSequenceRef = useRef(0);
  const actionErrorOwnerRef = useRef<ClientOperation | undefined>(undefined);
  const pendingObservationRunIdRef = useRef<string | undefined>(undefined);
  const pendingStartRef = useRef<PendingStartMatcher | undefined>(undefined);
  const clarificationRef = useRef<{ runId: string; id: string; text: string } | undefined>(undefined);
  const sourceEpochRef = useRef(0);
  const sourceRef = useRef<{ epoch: number; runId: string; source: EventSource } | undefined>(undefined);
  const reconcileSequenceRef = useRef(0);
  const reconcileRef = useRef<(snapshot?: WorldRunSnapshot) => Promise<PublicSessionDetail | undefined>>(
    async () => undefined,
  );

  const applySessionAction = useCallback((action: SessionAction): PublicSessionDetail | undefined => {
    const next = sessionReducer(detailRef.current, action);
    detailRef.current = next;
    dispatch(action);
    return next;
  }, []);

  const rememberPendingObservation = useCallback((runId: string) => {
    pendingObservationRunIdRef.current = runId;
    if (mountedRef.current) setPendingObservationRunId(runId);
  }, []);

  const clearObservedIdentity = useCallback((current: PublicSessionDetail | undefined) => {
    const runId = pendingObservationRunIdRef.current;
    if (!runId || !current?.runs.some((run) => run.id === runId)) return;
    pendingObservationRunIdRef.current = undefined;
    if (mountedRef.current) setPendingObservationRunId(undefined);
  }, []);

  const rememberPendingStart = useCallback((pending: PendingStartMatcher) => {
    pendingStartRef.current = pending;
    if (mountedRef.current) setPendingStartAttemptId(pending.attemptId);
  }, []);

  const clearActionError = useCallback(() => {
    actionErrorOwnerRef.current = undefined;
    if (mountedRef.current) setActionError("");
  }, []);

  const reportActionError = useCallback((reason: unknown, operation?: ClientOperation) => {
    actionErrorOwnerRef.current = operation;
    if (mountedRef.current) {
      setActionError(reason instanceof Error ? reason.message : String(reason));
    }
  }, []);

  const clearConfirmedOperationError = useCallback((current: PublicSessionDetail | undefined) => {
    const operation = actionErrorOwnerRef.current;
    if (!operation?.runId || (operation.kind !== "cancel" && operation.kind !== "abandon")) return;
    const run = current?.runs.find((candidate) => candidate.id === operation.runId);
    if (!run || (isWorldRunActiveIntentOwner(run.status) && !run.cancelRequested)) return;
    clearActionError();
  }, [clearActionError]);

  const reconcilePendingStart = useCallback((current: PublicSessionDetail | undefined) => {
    const pending = pendingStartRef.current;
    if (!pending || !current) return;
    if (current.runs.some((run) => matchesPendingStart(run, pending))) {
      pendingStartRef.current = undefined;
      if (mountedRef.current) {
        setPendingStartAttemptId(undefined);
      }
      return;
    }
    pending.absenceCount += 1;
    if (pending.absenceCount < 2 || Date.now() < pending.confirmAfter) return;
    pendingStartRef.current = undefined;
    if (mountedRef.current) {
      setPendingStartAttemptId(undefined);
      reportActionError(pending.originalError);
    }
  }, [reportActionError]);

  const invalidateSource = useCallback(() => {
    sourceEpochRef.current += 1;
    sourceRef.current?.source.close();
    sourceRef.current = undefined;
  }, []);

  const beginAction = useCallback((request: ClientOperationRequest): ClientOperation | undefined => {
    if (pendingActionRef.current) return undefined;
    const operation = { ...request, token: operationSequenceRef.current + 1 };
    operationSequenceRef.current = operation.token;
    pendingActionRef.current = operation;
    if (mountedRef.current) setPendingAction(operation);
    return operation;
  }, []);

  const finishAction = useCallback((action: ClientOperation) => {
    if (pendingActionRef.current !== action) return;
    pendingActionRef.current = undefined;
    if (mountedRef.current) setPendingAction(undefined);
  }, []);

  const alignEventSource = useCallback((run: WorldRunRecordView | undefined) => {
    const current = sourceRef.current;
    if (!mountedRef.current || !run || !isWorldRunExecuting(run.status)) {
      if (current) invalidateSource();
      return;
    }
    if (current?.runId === run.id && current.source.readyState !== EventSource.CLOSED) return;
    invalidateSource();
    if (!mountedRef.current) return;
    const epoch = sourceEpochRef.current;
    const runId = run.id;
    const afterSequence = run.events.at(-1)?.sequence ?? 0;
    const source = new EventSource(worldApi.runEventsUrl(sessionId, runId, afterSequence));
    sourceRef.current = { epoch, runId, source };
    const isCurrent = () => mountedRef.current && sourceEpochRef.current === epoch &&
      sourceRef.current?.source === source && sourceRef.current.runId === runId;
    source.onopen = () => {
      if (isCurrent()) {
        setStreamWarning((warning) => warning === "进度连接暂时中断，正在自动重连。" ? "" : warning);
      }
    };
    for (const type of runEventTypes) {
      source.addEventListener(type, (message) => {
        if (!isCurrent()) return;
        let event: WorldRunEvent;
        try {
          event = JSON.parse((message as MessageEvent<string>).data) as WorldRunEvent;
        } catch {
          setStreamWarning("收到的进度无法识别，正在重新同步存档。");
          void reconcileRef.current().catch(() => undefined);
          return;
        }
        setStreamWarning((warning) => warning === "进度连接暂时中断，正在自动重连。" ? "" : warning);
        const effective = applySessionAction({ type: "event", runId, event });
        clearConfirmedOperationError(effective);
        if (isTerminalEvent(event)) {
          source.close();
          sourceRef.current = undefined;
          void reconcileRef.current().catch(() => undefined);
        }
      });
    }
    source.onerror = () => {
      if (!isCurrent()) return;
      if (source.readyState === EventSource.CLOSED) {
        sourceRef.current = undefined;
        void reconcileRef.current().catch(() => undefined);
      } else {
        setStreamWarning("进度连接暂时中断，正在自动重连。");
      }
    };
  }, [applySessionAction, clearConfirmedOperationError, invalidateSource, sessionId]);

  const reconcileAndObserve = useCallback(async (
    snapshot?: WorldRunSnapshot,
  ): Promise<PublicSessionDetail | undefined> => {
    const sequence = reconcileSequenceRef.current + 1;
    reconcileSequenceRef.current = sequence;
    let effective = detailRef.current;
    if (snapshot && mountedRef.current) {
      effective = applySessionAction({ type: "snapshot", snapshot });
      clearObservedIdentity(effective);
      clearConfirmedOperationError(effective);
    }
    let result: PublicSessionDetail;
    try {
      result = await worldApi.session(sessionId);
    } catch (error) {
      if (!mountedRef.current || reconcileSequenceRef.current !== sequence) return detailRef.current;
      alignEventSource(effective ? executingRun(effective.runs) : undefined);
      setStreamWarning(pendingObservationRunIdRef.current || pendingStartRef.current
        ? "行动已经提交，正在重新确认世界进度。"
        : "最新存档状态暂时无法同步。请刷新页面后重试。");
      throw error;
    }
    if (!mountedRef.current || reconcileSequenceRef.current !== sequence) return detailRef.current;
    effective = applySessionAction({ type: "load", detail: result });
    clearObservedIdentity(effective);
    reconcilePendingStart(effective);
    clearConfirmedOperationError(effective);
    alignEventSource(effective ? executingRun(effective.runs) : undefined);
    setStreamWarning(pendingObservationRunIdRef.current || pendingStartRef.current
      ? "行动已经提交，正在重新确认世界进度。"
      : "");
    return effective;
  }, [
    alignEventSource,
    applySessionAction,
    clearConfirmedOperationError,
    clearObservedIdentity,
    reconcilePendingStart,
    sessionId,
  ]);

  useEffect(() => {
    reconcileRef.current = reconcileAndObserve;
  }, [reconcileAndObserve]);

  useEffect(() => {
    mountedRef.current = true;
    let active = true;
    const refresh = () => {
      void reconcileAndObserve().catch(() => undefined);
    };
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    const initialLoad = window.setTimeout(() => {
      void reconcileAndObserve()
        .catch((reason: unknown) => {
          if (active) reportActionError(reason);
        })
        .finally(() => { if (active) setLoading(false); });
    }, 0);
    return () => {
      active = false;
      mountedRef.current = false;
      reconcileSequenceRef.current += 1;
      window.clearTimeout(initialLoad);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
      invalidateSource();
    };
  }, [invalidateSource, reconcileAndObserve, reportActionError, sessionId]);

  useEffect(() => {
    if (!pendingObservationRunId) return;
    let stopped = false;
    let timer: number | undefined;
    const recover = async () => {
      let snapshot: WorldRunSnapshot | undefined;
      try {
        snapshot = await worldApi.run(sessionId, pendingObservationRunId);
      } catch {
        // Session reconciliation below can recover even when the run read is interrupted.
      }
      if (stopped) return;
      await reconcileAndObserve(snapshot).catch(() => undefined);
      if (!stopped && pendingObservationRunIdRef.current === pendingObservationRunId) {
        timer = window.setTimeout(() => { void recover(); }, 1_000);
      }
    };
    timer = window.setTimeout(() => { void recover(); }, 1_000);
    return () => {
      stopped = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [pendingObservationRunId, reconcileAndObserve, sessionId]);

  useEffect(() => {
    if (!pendingStartAttemptId) return;
    let stopped = false;
    let timer: number | undefined;
    const recover = async () => {
      await reconcileAndObserve().catch(() => undefined);
      if (!stopped && pendingStartRef.current?.attemptId === pendingStartAttemptId) {
        timer = window.setTimeout(() => { void recover(); }, 1_000);
      }
    };
    timer = window.setTimeout(() => { void recover(); }, 1_000);
    return () => {
      stopped = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [pendingStartAttemptId, reconcileAndObserve]);

  const activeRun = detail ? executingRun(detail.runs) : undefined;
  const ownerRun = detail ? intentOwnerRun(detail.runs) : undefined;
  const awaitingRun = isAwaitingPlayer(ownerRun) ? ownerRun : undefined;
  const hasPendingObservation = Boolean(pendingObservationRunId || pendingStartAttemptId);
  const messages = useMemo(() => runsToMessages(detail?.runs ?? []), [detail?.runs]);

  const settleAction = useCallback(async (input: {
    requestFailed: boolean;
    requestError: unknown;
    snapshot?: WorldRunSnapshot;
    confirmed: (current: PublicSessionDetail) => boolean;
  }): Promise<PublicSessionDetail | undefined> => {
    let current: PublicSessionDetail | undefined;
    try {
      current = await reconcileAndObserve(input.snapshot);
    } catch (reconciliationError) {
      const effective = detailRef.current;
      if (input.requestFailed && effective && input.confirmed(effective)) return effective;
      if (input.requestFailed) throw input.requestError;
      void reconciliationError;
      return undefined;
    }
    if (input.requestFailed && (!current || !input.confirmed(current))) throw input.requestError;
    return current;
  }, [reconcileAndObserve]);

  const submit = useCallback(async (message: AppendMessage) => {
    const text = message.content
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .join("\n")
      .trim();
    if (!text || pendingObservationRunIdRef.current || pendingStartRef.current) return;
    const operation = beginAction({ kind: awaitingRun ? "continue" : "start", runId: awaitingRun?.id });
    if (!operation) return;
    clearActionError();
    try {
      if (awaitingRun) {
        const pendingInput = clarificationRef.current?.runId === awaitingRun.id &&
          clarificationRef.current.text === text
          ? clarificationRef.current
          : { runId: awaitingRun.id, id: crypto.randomUUID(), text };
        clarificationRef.current = pendingInput;
        let snapshot: WorldRunSnapshot | undefined;
        let requestError: unknown;
        let requestFailed = false;
        try {
          snapshot = await worldApi.continueRun(
            sessionId,
            awaitingRun.id,
            pendingInput.id,
            text,
          );
        } catch (error) {
          requestFailed = true;
          requestError = error;
        }
        if (!mountedRef.current) return;
        const current = await settleAction({
          requestFailed,
          requestError,
          snapshot,
          confirmed: (session) => session.runs.some((run) =>
            run.id === awaitingRun.id && run.inputs.some((input) => input.id === pendingInput.id)),
        });
        const persisted = snapshot?.run.inputs.some((input) => input.id === pendingInput.id) ||
          current?.runs.some((run) => run.id === awaitingRun.id &&
            run.inputs.some((input) => input.id === pendingInput.id));
        if (persisted) {
          clarificationRef.current = undefined;
        }
        return;
      }
      const existingRunIds = new Set(detail?.runs.map((run) => run.id) ?? []);
      const startAttemptId = crypto.randomUUID();
      let started: { runId: string } | undefined;
      let snapshot: WorldRunSnapshot | undefined;
      let requestError: unknown;
      let requestFailed = false;
      let responseUncertain = false;
      try {
        started = await worldApi.startRun(sessionId, text);
      } catch (error) {
        requestFailed = true;
        requestError = error;
        if (isUncertainStartError(error) && mountedRef.current) {
          responseUncertain = true;
          rememberPendingStart({
            attemptId: startAttemptId,
            existingRunIds: [...existingRunIds],
            goal: text,
            originalError: error,
            confirmAfter: Date.now() + pendingStartConfirmationDelayMs,
            absenceCount: 0,
          });
        }
      }
      if (!mountedRef.current) return;
      if (started) {
        rememberPendingObservation(started.runId);
        try {
          snapshot = await worldApi.run(sessionId, started.runId);
        } catch {
          // The session reconciliation below is authoritative when this read is interrupted.
        }
      }
      if (!mountedRef.current) return;
      await settleAction({
        requestFailed: requestFailed && !responseUncertain,
        requestError,
        snapshot,
        confirmed: (session) => session.runs.some((run) =>
          (started ? run.id === started.runId : !existingRunIds.has(run.id)) &&
          run.inputs.some((input) => input.kind === "goal" && input.text === text)),
      });
    } catch (reason) {
      reportActionError(reason, operation);
      throw reason;
    } finally {
      finishAction(operation);
    }
  }, [
    awaitingRun,
    beginAction,
    clearActionError,
    detail?.runs,
    finishAction,
    rememberPendingObservation,
    rememberPendingStart,
    reportActionError,
    sessionId,
    settleAction,
  ]);

  const cancel = useCallback(async () => {
    if (!activeRun) return;
    const operation = beginAction({ kind: "cancel", runId: activeRun.id });
    if (!operation) return;
    clearActionError();
    try {
      let snapshot: WorldRunSnapshot | undefined;
      let requestError: unknown;
      let requestFailed = false;
      try {
        snapshot = await worldApi.cancelRun(sessionId, activeRun.id);
      } catch (error) {
        requestFailed = true;
        requestError = error;
      }
      if (!mountedRef.current) return;
      await settleAction({
        requestFailed,
        requestError,
        snapshot,
        confirmed: (session) => session.runs.some((run) => run.id === activeRun.id &&
          (run.cancelRequested || !isWorldRunActiveIntentOwner(run.status))),
      });
    } catch (reason) {
      reportActionError(reason, operation);
      throw reason;
    } finally {
      finishAction(operation);
    }
  }, [activeRun, beginAction, clearActionError, finishAction, reportActionError, sessionId, settleAction]);

  const retry = useCallback(async (runId: string) => {
    const operation = beginAction({ kind: "retry", runId });
    if (!operation) return;
    clearActionError();
    try {
      const before = detail?.runs.find((run) => run.id === runId);
      const beforeSequence = before ? runTailSequence(before) : -1;
      const beforeStatus = before?.status;
      let snapshot: WorldRunSnapshot | undefined;
      let requestError: unknown;
      let requestFailed = false;
      try {
        snapshot = await worldApi.retryRun(sessionId, runId);
      } catch (error) {
        requestFailed = true;
        requestError = error;
      }
      if (!mountedRef.current) return;
      await settleAction({
        requestFailed,
        requestError,
        snapshot,
        confirmed: (session) => session.runs.some((run) => run.id === runId &&
          (runTailSequence(run) > beforeSequence || run.status !== beforeStatus)),
      });
    } catch (reason) {
      reportActionError(reason, operation);
    } finally {
      finishAction(operation);
    }
  }, [beginAction, clearActionError, detail?.runs, finishAction, reportActionError, sessionId, settleAction]);

  const abandon = useCallback(async (runId: string) => {
    const operation = beginAction({ kind: "abandon", runId });
    if (!operation) return;
    clearActionError();
    try {
      let snapshot: WorldRunSnapshot | undefined;
      let requestError: unknown;
      let requestFailed = false;
      try {
        snapshot = await worldApi.cancelRun(sessionId, runId);
      } catch (error) {
        requestFailed = true;
        requestError = error;
      }
      if (!mountedRef.current) return;
      const current = await settleAction({
        requestFailed,
        requestError,
        snapshot,
        confirmed: (session) => session.runs.some((run) => run.id === runId &&
          (run.cancelRequested || !isWorldRunActiveIntentOwner(run.status))),
      });
      const resolved = snapshot?.run.id === runId &&
          (snapshot.run.cancelRequested || !isWorldRunActiveIntentOwner(snapshot.run.status)) ||
        current?.runs.some((run) => run.id === runId &&
          (run.cancelRequested || !isWorldRunActiveIntentOwner(run.status)));
      if (resolved) clarificationRef.current = undefined;
    } catch (reason) {
      reportActionError(reason, operation);
    } finally {
      finishAction(operation);
    }
  }, [beginAction, clearActionError, finishAction, reportActionError, sessionId, settleAction]);

  const runtime = useExternalStoreRuntime({
    messages,
    convertMessage: (message) => message,
    isRunning: Boolean(activeRun),
    isSendDisabled: loading || Boolean(pendingAction) || Boolean(activeRun) ||
      hasPendingObservation ||
      (Boolean(ownerRun) && !awaitingRun) || !detail,
    onNew: submit,
    onCancel: cancel,
  });

  async function navigate(href: string): Promise<void> {
    try {
      if (activeRun) {
        const approved = window.confirm("世界仍在推演。离开前要安全取消当前行动吗？");
        if (!approved) return;
        await cancel();
      }
      router.push(href);
    } catch (reason) {
      if (!actionErrorOwnerRef.current) reportActionError(reason);
    }
  }

  if (loading) return <main className="cg-game-loading" aria-live="polite">正在唤醒世界…</main>;
  if (!detail) {
    return (
      <main className="cg-game-loading">
        <h1>无法进入这个世界</h1>
        <p className="cg-alert" role="alert">{actionError || "存档不存在或已经损坏。"}</p>
        <Link className="cg-text-link" href="/worlds">返回世界包</Link>
      </main>
    );
  }

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <main className="cg-game">
        <h1 className="cg-sr-only">{detail.summary.title}</h1>
        <GameThread
          actionError={actionError}
          awaitingPlayer={Boolean(awaitingRun)}
          cancelPending={Boolean(activeRun?.cancelRequested || pendingAction?.kind === "cancel")}
          confirmationPending={hasPendingObservation}
          runActions={{
            retry,
            abandon,
            actionableInputId: ownerRun?.inputs.at(-1)?.id,
            actionableRunId: ownerRun?.id,
            pendingRunId: pendingAction?.runId,
          }}
          streamWarning={streamWarning}
        />
        <ControlOrb
          composerDocked={messages.length > 0}
          onNavigate={navigate}
          status={{
            elapsedSeconds: detail.summary.elapsedSeconds,
            phase: activeRun ? "running" : hasPendingObservation ? "confirming" : "saved",
            sessionTitle: detail.summary.title,
            step: detail.summary.step,
            worldName: detail.summary.world.name,
          }}
        />
      </main>
    </AssistantRuntimeProvider>
  );
}
