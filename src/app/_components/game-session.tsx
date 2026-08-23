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
import type {
  PublicSessionDetail,
  WorldRunEvent,
  WorldRunRecordView,
  WorldRunSnapshot,
} from "../../shared/world-api";
import { CURRENT_SESSION_KEY } from "../_lib/browser-state";
import { runsToMessages } from "../_lib/run-messages";
import { worldApi } from "../lib/world-api-client";
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

function isActive(run: WorldRunRecordView | undefined): boolean {
  return run?.status === "queued" || run?.status === "running";
}

function isAwaitingPlayer(run: WorldRunRecordView | undefined): boolean {
  return run?.status === "awaiting_player";
}

function isRetriable(run: WorldRunRecordView | undefined): boolean {
  return run?.status === "failed" || run?.status === "step_limit";
}

function activeRunSummary(run: WorldRunRecordView): PublicSessionDetail["summary"]["activeRun"] {
  if (run.status !== "queued" && run.status !== "running") return undefined;
  return { id: run.id, status: run.status };
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

function upsertRun(runs: WorldRunRecordView[], run: WorldRunRecordView): WorldRunRecordView[] {
  const index = runs.findIndex((candidate) => candidate.id === run.id);
  if (index < 0) return [...runs, run];
  return runs.map((candidate) => candidate.id === run.id ? run : candidate);
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
  if (action.type === "load") return action.detail;
  if (!state) return state;
  if (action.type === "snapshot") {
    return {
      ...state,
      state: action.snapshot.state,
      summary: {
        ...state.summary,
        revision: action.snapshot.state.revision,
        step: action.snapshot.state.step,
        elapsedSeconds: action.snapshot.state.elapsedSeconds,
        activeRun: activeRunSummary(action.snapshot.run),
      },
      runs: upsertRun(state.runs, action.snapshot.run),
    };
  }
  const current = state.runs.find((run) => run.id === action.runId);
  if (!current || current.events.some((event) => event.sequence === action.event.sequence)) return state;
  const events = [...current.events, action.event].sort((left, right) => left.sequence - right.sequence);
  const status = statusAfterEvent(current.status, action.event);
  const playerInput = action.event.type === "player.input" ? action.event : undefined;
  const inputs = playerInput && !current.inputs.some((input) => input.id === playerInput.payload.id)
    ? [...current.inputs, { ...playerInput.payload, at: playerInput.at }]
    : current.inputs;
  const run = { ...current, inputs, events, status, updatedAt: action.event.at };
  const committed = action.event.type === "step.committed" ? action.event.payload : undefined;
  return {
    ...state,
    state: committed ? { ...state.state, ...committed } : state.state,
    summary: {
      ...state.summary,
      ...(committed ?? {}),
      updatedAt: action.event.at,
      activeRun: activeRunSummary(run),
    },
    runs: upsertRun(state.runs, run),
  };
}

interface RunActions {
  retry: (runId: string) => Promise<void>;
}

const RunActionsContext = createContext<RunActions | null>(null);

const statusText: Record<WorldRunRecordView["status"], string> = {
  queued: "行动已进入世界",
  running: "世界正在推演",
  awaiting_player: "等待你的决定",
  completed: "目标已经完成",
  goal_failed: "目标未能完成",
  step_limit: "已到达本次推演上限",
  cancelled: "行动已安全取消",
  failed: "推演暂时中断",
};

const WorldRunPart: DataMessagePartComponent = ({ data }) => {
  const actions = useContext(RunActionsContext);
  const run = data as WorldRunRecordView;
  const observations = run.events.filter((event) => event.type === "player.observation");
  const outcomes = run.events.filter((event) => event.type === "player.outcome");
  const checks = run.events.filter((event) => event.type === "check.resolved");
  const retriable = run.status === "failed" || run.status === "step_limit";

  return (
    <div className="cg-world-reply" data-status={run.status}>
      {observations.length > 0 ? observations.map((event) => (
        <p className="cg-narrative" key={event.sequence}>{event.payload.summary}</p>
      )) : outcomes.length > 0 ? outcomes.map((event) => (
        <p className="cg-narrative" key={event.sequence}>{event.payload.summary}</p>
      )) : <p className="cg-narrative cg-narrative--thinking">世界正在推演…</p>}
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
        {run.error ? <span className="cg-run-status__error">{run.error}</span> : null}
        {retriable && actions ? (
          <button className="cg-button--quiet" onClick={() => void actions.retry(run.id)} type="button">
            <RotateCcw aria-hidden="true" /> {run.status === "step_limit" ? "继续运行" : "重试这一步"}
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
  const [error, setError] = useState("");
  const sourceRef = useRef<EventSource | undefined>(undefined);

  const observeRun = useCallback((runId: string, afterSequence = 0) => {
    sourceRef.current?.close();
    const source = new EventSource(worldApi.runEventsUrl(sessionId, runId, afterSequence));
    sourceRef.current = source;
    for (const type of runEventTypes) {
      source.addEventListener(type, (message) => {
        setError("");
        const event = JSON.parse((message as MessageEvent<string>).data) as WorldRunEvent;
        dispatch({ type: "event", runId, event });
        if (isTerminalEvent(event)) {
          source.close();
          void worldApi.session(sessionId)
            .then((result) => dispatch({ type: "load", detail: result }))
            .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason)));
        }
      });
    }
    source.onerror = () => {
      if (source.readyState !== EventSource.CLOSED) setError("与世界的进度连接暂时中断，正在自动重连。");
    };
  }, [sessionId]);

  useEffect(() => {
    let active = true;
    void worldApi.session(sessionId)
      .then((result) => {
        if (!active) return;
        dispatch({ type: "load", detail: result });
        localStorage.setItem(CURRENT_SESSION_KEY, sessionId);
        const activeRun = result.runs.find(isActive);
        if (activeRun) observeRun(activeRun.id, activeRun.events.at(-1)?.sequence ?? 0);
      })
      .catch((reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : String(reason)); })
      .finally(() => { if (active) setLoading(false); });
    return () => {
      active = false;
      sourceRef.current?.close();
    };
  }, [observeRun, sessionId]);

  const activeRun = detail?.runs.find(isActive);
  const awaitingRun = detail?.runs.find(isAwaitingPlayer);
  const retriableRun = detail?.runs.find(isRetriable);
  const messages = useMemo(() => runsToMessages(detail?.runs ?? []), [detail?.runs]);

  const submit = useCallback(async (message: AppendMessage) => {
    const text = message.content
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .join("\n")
      .trim();
    if (!text) return;
    setError("");
    try {
      if (awaitingRun) {
        const snapshot = await worldApi.continueRun(
          sessionId,
          awaitingRun.id,
          crypto.randomUUID(),
          text,
        );
        dispatch({ type: "snapshot", snapshot });
        observeRun(awaitingRun.id, snapshot.run.events.at(-1)?.sequence ?? 0);
        return;
      }
      const started = await worldApi.startRun(sessionId, text);
      const snapshot = await worldApi.run(sessionId, started.runId);
      dispatch({ type: "snapshot", snapshot });
      observeRun(started.runId, snapshot.run.events.at(-1)?.sequence ?? 0);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      throw reason;
    }
  }, [awaitingRun, observeRun, sessionId]);

  const cancel = useCallback(async () => {
    if (!activeRun) return;
    const snapshot = await worldApi.cancelRun(sessionId, activeRun.id);
    dispatch({ type: "snapshot", snapshot });
  }, [activeRun, sessionId]);

  const retry = useCallback(async (runId: string) => {
    setError("");
    try {
      const snapshot = await worldApi.retryRun(sessionId, runId);
      dispatch({ type: "snapshot", snapshot });
      observeRun(runId, snapshot.run.events.at(-1)?.sequence ?? 0);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }, [observeRun, sessionId]);

  const runtime = useExternalStoreRuntime({
    messages,
    convertMessage: (message) => message,
    isRunning: Boolean(activeRun),
    isSendDisabled: loading || Boolean(activeRun) || Boolean(retriableRun) || !detail,
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
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }

  if (loading) return <main className="cg-game-loading" aria-live="polite">正在唤醒世界…</main>;
  if (!detail) {
    return (
      <main className="cg-game-loading">
        <h1>无法进入这个世界</h1>
        <p className="cg-alert" role="alert">{error || "存档不存在或已经损坏。"}</p>
        <Link className="cg-text-link" href="/saves">返回存档</Link>
      </main>
    );
  }

  return (
    <RunActionsContext.Provider value={{ retry }}>
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
              <div><dt>存档</dt><dd>{activeRun ? "推演中" : "已保存"}</dd></div>
            </dl>
          </header>
          {error ? <p className="cg-game__alert" role="alert">{error}</p> : null}
          <GameThread awaitingPlayer={Boolean(awaitingRun)}>
            {activeRun ? (
              <ComposerPrimitive.Cancel className="cg-send-button" aria-label="停止推演">
                <Square aria-hidden="true" />
              </ComposerPrimitive.Cancel>
            ) : (
              <ComposerPrimitive.Send className="cg-send-button" aria-label="发送行动">
                <CornerDownLeft aria-hidden="true" />
              </ComposerPrimitive.Send>
            )}
          </GameThread>
          <ControlOrb status={activeRun ? "running" : "saved"} onNavigate={navigate} />
        </main>
      </AssistantRuntimeProvider>
    </RunActionsContext.Provider>
  );
}
