"use client";

import {
  AssistantRuntimeProvider,
  ComposerPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  useExternalStoreRuntime,
  type AppendMessage,
  type DataMessagePartComponent,
  type TextMessagePartComponent,
} from "@assistant-ui/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { ArrowDown, CornerDownLeft, RotateCcw, Square } from "lucide-react";
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
import { CURRENT_SESSION_KEY } from "../_lib/browser-state";
import { runsToMessages } from "../_lib/run-messages";
import { WorldApiError, worldApi } from "../lib/world-api-client";
import { ControlOrb } from "./control-orb";

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

function isPaused(run: WorldRunRecordView | undefined): boolean {
  return run?.status === "awaiting_player" || run?.status === "step_limit" || run?.status === "failed";
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

interface RunActions {
  retry: (runId: string) => Promise<void>;
  abandon: (runId: string) => Promise<void>;
  actionableInputId?: string;
  actionableRunId?: string;
  pendingRunId?: string;
}

const RunActionsContext = createContext<RunActions | null>(null);

const statusText: Record<WorldRunRecordView["status"], string> = {
  queued: "行动已进入世界",
  running: "世界正在推演",
  awaiting_player: "等待你的决定",
  completed: "目标已经完成",
  goal_failed: "目标未能完成",
  step_limit: "已到达本次推演上限",
  cancelled: "目标已经结束",
  failed: "这一步未能完成",
};

const emptyNarrativeText: Record<WorldRunRecordView["status"], string> = {
  queued: "世界正在推演…",
  running: "世界正在推演…",
  awaiting_player: "世界在等待你的决定。",
  completed: "目标已经完成。",
  goal_failed: "目标未能完成。",
  step_limit: "本次推演已到上限。你可以放弃当前目标。",
  cancelled: "行动已取消，未提交的变化没有写入世界。",
  failed: "这一步没有提交，世界仍停留在上一个已保存状态。",
};

const WorldRunPart: DataMessagePartComponent = ({ data }) => {
  const actions = useContext(RunActionsContext);
  const run = data as WorldRunRecordView;
  const observations = run.events.filter((event) => event.type === "player.observation");
  const outcomes = run.events.filter((event) => event.type === "player.outcome");
  const checks = run.events.filter((event) => event.type === "check.resolved");
  const actionable = actions?.actionableRunId === run.id &&
    actions.actionableInputId === run.inputs.at(-1)?.id;
  const retriable = actionable && isWorldRunRetriable(run);
  const paused = actionable && isPaused(run);
  const actionPending = actions?.pendingRunId === run.id;

  return (
    <div className="cg-world-reply" data-status={run.status}>
      {observations.length > 0 ? observations.map((event) => (
        <p className="cg-narrative" key={event.sequence}>{event.payload.summary}</p>
      )) : outcomes.length > 0 ? outcomes.map((event) => (
        <p className="cg-narrative" key={event.sequence}>{event.payload.summary}</p>
      )) : (
        <p className={`cg-narrative${isWorldRunExecuting(run.status) ? " cg-narrative--thinking" : ""}`}>
          {emptyNarrativeText[run.status]}
        </p>
      )}
      {checks.length > 0 ? (
        <details className="cg-checks">
          <summary>{checks.length} 次可见检定</summary>
          <ul>
            {checks.map((event) => (
              <li key={event.sequence}>
                {event.payload.visibility === "full"
                  ? `${event.payload.total} / DC ${event.payload.dc}`
                  : "结果已揭示"}
                <strong>{event.payload.succeeded ? "成功" : "失败"}</strong>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      <footer className="cg-run-status">
        <span>{statusText[run.status]}</span>
        {run.error ? <span className="cg-run-status__error" role="alert">{run.error}</span> : null}
        {retriable && actions ? (
          <button
            className="cg-button--quiet"
            disabled={actionPending}
            onClick={() => void actions.retry(run.id)}
            type="button"
          >
            <RotateCcw aria-hidden="true" /> {run.status === "step_limit" ? "继续推演" : "重试这一步"}
          </button>
        ) : null}
        {paused && actions ? (
          <button
            className="cg-button--quiet"
            disabled={actionPending}
            onClick={() => void actions.abandon(run.id)}
            type="button"
          >
            放弃目标
          </button>
        ) : null}
      </footer>
    </div>
  );
};

const UserText: TextMessagePartComponent = ({ text }) => <p className="cg-user-text">{text}</p>;

function UserMessage() {
  return (
    <MessagePrimitive.Root className="cg-message cg-message--user">
      <span className="cg-message__role">你</span>
      <MessagePrimitive.Parts components={{ Text: UserText }} />
    </MessagePrimitive.Root>
  );
}

function AssistantMessage() {
  return (
    <MessagePrimitive.Root className="cg-message">
      <span className="cg-message__role">世界</span>
      <MessagePrimitive.Parts components={{ data: { by_name: { "world-run": WorldRunPart } } }} />
    </MessagePrimitive.Root>
  );
}

function GameThread({ children, awaitingPlayer }: { children: ReactNode; awaitingPlayer: boolean }) {
  return (
    <ThreadPrimitive.Root className="cg-thread">
      <ThreadPrimitive.Viewport className="cg-thread__viewport" autoScroll turnAnchor="top">
        <ThreadPrimitive.Empty>
          <section className="cg-thread-empty">
            <p className="cg-eyebrow">THE WORLD IS LISTENING</p>
            <h2>你想做什么？</h2>
            <p>描述一个行动、目标，或一句想说的话。世界会根据当前事实与所有角色的认知继续向前。</p>
          </section>
        </ThreadPrimitive.Empty>
        <ThreadPrimitive.Messages components={{ UserMessage, AssistantMessage }} />
        <ThreadPrimitive.ScrollToBottom className="cg-scroll-button" aria-label="滚动到最新消息">
          <ArrowDown aria-hidden="true" />
        </ThreadPrimitive.ScrollToBottom>
        <div className="cg-composer-dock">
          <ComposerPrimitive.Root className="cg-chat-composer">
            <ComposerPrimitive.Input
              aria-label={awaitingPlayer ? "补充信息" : "你的行动"}
              maxLength={4000}
              placeholder={awaitingPlayer ? "补充你的选择、方法或缺失信息…" : "说出你的行动…"}
              submitMode="enter"
              unstable_insertNewlineOnTouchEnter
              rows={1}
            />
            {children}
          </ComposerPrimitive.Root>
          <p className="cg-composer-hint">Enter 发送 · Shift + Enter 换行 · 自动保存</p>
        </div>
      </ThreadPrimitive.Viewport>
    </ThreadPrimitive.Root>
  );
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
        .then((result) => {
          if (!active || !result) return;
          localStorage.setItem(CURRENT_SESSION_KEY, sessionId);
        })
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
    isRunning: Boolean(activeRun || hasPendingObservation),
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
        <Link className="cg-text-link" href="/saves">返回存档</Link>
      </main>
    );
  }

  return (
    <RunActionsContext.Provider value={{
      retry,
      abandon,
      actionableInputId: ownerRun?.inputs.at(-1)?.id,
      actionableRunId: ownerRun?.id,
      pendingRunId: pendingAction?.runId,
    }}>
      <AssistantRuntimeProvider runtime={runtime}>
        <main className="cg-game">
          <header className="cg-game__header">
            <div>
              <p className="cg-eyebrow">{detail.summary.world.name}</p>
              <h1>{detail.summary.title}</h1>
            </div>
            <dl className="cg-revision-rail" aria-label="当前世界状态">
              <div><dt>步</dt><dd>{detail.summary.step}</dd></div>
              <div><dt>时间</dt><dd>{detail.summary.elapsedSeconds}s</dd></div>
              <div><dt>存档</dt><dd>{activeRun ? "推演中" : hasPendingObservation ? "确认中" : "已保存"}</dd></div>
            </dl>
          </header>
          {actionError ? <p className="cg-game__alert" role="alert">{actionError}</p> : null}
          <p className="cg-game__stream-status" role="status">{streamWarning}</p>
          <GameThread awaitingPlayer={Boolean(awaitingRun)}>
            {activeRun ? (
              <ComposerPrimitive.Cancel
                className="cg-send-button"
                aria-label={activeRun.cancelRequested ? "正在停止推演" : "停止推演"}
                disabled={activeRun.cancelRequested || pendingAction?.kind === "cancel"}
              >
                <Square aria-hidden="true" />
              </ComposerPrimitive.Cancel>
            ) : (
              <ComposerPrimitive.Send
                className="cg-send-button"
                aria-label={hasPendingObservation ? "正在确认行动" : "发送行动"}
                disabled={hasPendingObservation}
              >
                <CornerDownLeft aria-hidden="true" />
              </ComposerPrimitive.Send>
            )}
          </GameThread>
          <ControlOrb status={activeRun || hasPendingObservation ? "running" : "saved"} onNavigate={navigate} />
        </main>
      </AssistantRuntimeProvider>
    </RunActionsContext.Provider>
  );
}
