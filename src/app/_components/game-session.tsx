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
  type ReactNode,
} from "react";
import {
  isWorldRunActiveIntentOwner,
  isWorldRunExecuting,
  type PublicSessionDetail,
  type PublicSessionSummary,
  type WorldRunEvent,
  type WorldRunRecordView,
  type WorldRunSnapshot,
} from "../../shared/world-api";
import {
  executingRun,
  intentOwnerRun,
  isAwaitingPlayer,
  isTerminalEvent,
  isUncertainStartError,
  matchesPendingStart,
  pendingStartConfirmationDelayMs,
  runEventTypes,
  runTailSequence,
  sessionReducer,
  type ClientOperation,
  type ClientOperationRequest,
  type PendingStartMatcher,
  type SessionAction,
} from "../_lib/game-session-state";
import { runsToMessages } from "../_lib/run-messages";
import { worldApi } from "../lib/world-api-client";
import { GameSessionSurface } from "./game-session-surface";

export function GameSession({ children, sessionId }: { children?: ReactNode; sessionId: string }) {
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

  const updateSession = useCallback((summary: PublicSessionSummary) => {
    applySessionAction({ type: "summary", summary });
  }, [applySessionAction]);

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

  function navigate(href: string): void {
    router.push(href);
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
      <GameSessionSurface
        actionError={actionError}
        awaitingPlayer={Boolean(awaitingRun)}
        cancelPending={Boolean(activeRun?.cancelRequested || pendingAction?.kind === "cancel")}
        composerDocked={messages.length > 0}
        confirmationPending={hasPendingObservation}
        interactionPending={Boolean(activeRun) || hasPendingObservation}
        onNavigate={navigate}
        orbPhase={activeRun ? "running" : hasPendingObservation ? "confirming" : "saved"}
        runActions={{
          retry,
          abandon,
          actionableInputId: ownerRun?.inputs.at(-1)?.id,
          actionableRunId: ownerRun?.id,
          pendingRunId: pendingAction?.runId,
        }}
        session={detail.summary}
        sessionId={sessionId}
        streamWarning={streamWarning}
        updateSession={updateSession}
      >
        {children}
      </GameSessionSurface>
    </AssistantRuntimeProvider>
  );
}
