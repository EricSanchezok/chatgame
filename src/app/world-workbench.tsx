"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  PublicSessionSnapshot,
  WorldRunEvent,
  WorldRunRecordView,
  WorldSummary,
} from "../shared/world-api";
import { worldApi } from "./lib/world-api-client";

const eventTypes: WorldRunEvent["type"][] = [
  "run.started",
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

function eventText(event: WorldRunEvent): string {
  switch (event.type) {
    case "run.started":
      return `开始执行：${event.payload.text}`;
    case "check.resolved":
      return event.payload.visibility === "full"
        ? `检定 ${event.payload.total} 对 DC ${event.payload.dc}：${event.payload.succeeded ? "成功" : "失败"}`
        : `检定结果：${event.payload.succeeded ? "成功" : "失败"}`;
    case "player.outcome":
      return event.payload.knownAlternatives.length > 0
        ? `${event.payload.summary} 可尝试：${event.payload.knownAlternatives.join("；")}`
        : event.payload.summary;
    case "player.observation":
      return event.payload.summary;
    case "step.committed":
      return `世界步骤 ${event.payload.step} 已提交 · 时间 ${event.payload.elapsedSeconds}s`;
    case "run.awaiting_player":
      return "世界需要你的下一项决定。";
    case "run.completed":
      return "目标已经完成。";
    case "run.goal_failed":
      return "目标未能完成。";
    case "run.step_limit":
      return "本次连续运行达到安全步骤上限，可继续运行。";
    case "run.cancelled":
      return "运行已在安全世界步骤边界取消。";
    case "run.failed":
      return `运行暂停：${event.payload.message}`;
  }
}

function isTerminal(event: WorldRunEvent): boolean {
  return event.type.startsWith("run.") && event.type !== "run.started";
}

export function WorldWorkbench() {
  const [worlds, setWorlds] = useState<WorldSummary[]>([]);
  const [session, setSession] = useState<PublicSessionSnapshot>();
  const [run, setRun] = useState<WorldRunRecordView>();
  const [events, setEvents] = useState<WorldRunEvent[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [inputError, setInputError] = useState("");
  const sourceRef = useRef<EventSource | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  const observeRun = useCallback((sessionId: string, runId: string, afterSequence = 0) => {
    sourceRef.current?.close();
    const source = new EventSource(worldApi.runEventsUrl(sessionId, runId, afterSequence));
    sourceRef.current = source;
    for (const type of eventTypes) {
      source.addEventListener(type, (message) => {
        const event = JSON.parse((message as MessageEvent<string>).data) as WorldRunEvent;
        setEvents((current) => current.some((candidate) => candidate.sequence === event.sequence)
          ? current
          : [...current, event]);
        if (isTerminal(event)) {
          source.close();
          void worldApi.run(sessionId, runId)
            .then((snapshot) => {
              setRun(snapshot.run);
              setSession(snapshot.state);
            })
            .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason)));
        }
      });
    }
    source.onerror = () => {
      if (source.readyState === EventSource.CLOSED) return;
      setError("进度流连接中断，浏览器将自动重连。");
    };
  }, []);

  useEffect(() => {
    let active = true;
    void Promise.all([worldApi.worlds(), worldApi.sessions()])
      .then(([worldResult, sessionResult]) => {
        if (!active) return;
        setWorlds(worldResult.worlds);
        setSession(sessionResult.sessions[0]);
      })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : String(reason));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      sourceRef.current?.close();
    };
  }, []);

  async function createSession(world: WorldSummary): Promise<void> {
    setError("");
    setLoading(true);
    try {
      setSession(await worldApi.createSession(world.id));
      setRun(undefined);
      setEvents([]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setLoading(false);
    }
  }

  async function importWorld(file: File): Promise<void> {
    setError("");
    setLoading(true);
    try {
      await worldApi.importWorld(file);
      setWorlds((await worldApi.worlds()).worlds);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setLoading(false);
    }
  }

  async function submit(): Promise<void> {
    if (!session || run?.status === "queued" || run?.status === "running") return;
    if (!input.trim()) {
      setInputError("请先描述你想做的事情。");
      inputRef.current?.focus();
      return;
    }
    setError("");
    setInputError("");
    setEvents([]);
    try {
      const started = await worldApi.startRun(session.id, input);
      const snapshot = await worldApi.run(session.id, started.runId);
      setRun(snapshot.run);
      setSession(snapshot.state);
      setInput("");
      observeRun(session.id, started.runId);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }

  async function cancel(): Promise<void> {
    if (!session || !run) return;
    try {
      const snapshot = await worldApi.cancelRun(session.id, run.id);
      setRun(snapshot.run);
      setSession(snapshot.state);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }

  async function retry(): Promise<void> {
    if (!session || !run) return;
    setError("");
    try {
      const snapshot = await worldApi.retryRun(session.id, run.id);
      setRun(snapshot.run);
      setSession(snapshot.state);
      observeRun(session.id, snapshot.run.id, events.at(-1)?.sequence ?? 0);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }

  const running = run?.status === "queued" || run?.status === "running";
  return (
    <main className="cg-workbench">
      <header className="cg-workbench__header">
        <div>
          <p className="cg-eyebrow">TRUTH ENGINE WORKBENCH</p>
          <h1>开放世界引擎</h1>
          <p>任意自然语言行动、全体 Agent 联合推演、逐步骤原子持久化。</p>
        </div>
        {session ? (
          <dl className="cg-world-stats" aria-label="当前世界状态">
            <div><dt>Revision</dt><dd>{session.revision}</dd></div>
            <div><dt>Step</dt><dd>{session.step}</dd></div>
            <div><dt>World time</dt><dd>{session.elapsedSeconds}s</dd></div>
          </dl>
        ) : null}
      </header>

      {error ? <p className="cg-error" role="alert">{error}</p> : null}

      {loading ? <p className="cg-empty" aria-live="polite">正在读取世界状态……</p> : null}

      {!loading && worlds.length === 0 ? (
        <section className="cg-empty" aria-labelledby="empty-title">
          <p className="cg-eyebrow">NO WORLD INSTALLED</p>
          <h2 id="empty-title">暂无可玩世界</h2>
          <p>导入符合 schema v3 的世界 ZIP，开始一段游戏。</p>
          <label className="cg-import-button">
            导入世界 ZIP
            <input
              type="file"
              accept=".zip,application/zip"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void importWorld(file);
                event.target.value = "";
              }}
            />
          </label>
        </section>
      ) : null}

      {!loading && !session && worlds.length > 0 ? (
        <section className="cg-world-grid" aria-label="选择世界">
          {worlds.map((world) => (
            <article key={world.id} className="cg-world-card">
              <p className="cg-eyebrow">{world.version}</p>
              <h2>{world.name}</h2>
              <p>{world.description}</p>
              <button type="button" onClick={() => void createSession(world)}>启动世界</button>
            </article>
          ))}
        </section>
      ) : null}

      {session ? (
        <section className="cg-run-panel" aria-label="世界运行">
          <div className="cg-timeline" role="log" aria-live="polite" aria-relevant="additions text">
            {events.length === 0 ? (
              <p className="cg-timeline__placeholder">输入任何你真正想做的事情。系统不会把它压缩成固定动作。</p>
            ) : events.map((event) => (
              <article key={event.sequence} data-event={event.type}>
                <span>{event.sequence.toString().padStart(3, "0")}</span>
                <p>{eventText(event)}</p>
              </article>
            ))}
          </div>
          <div className="cg-composer">
            <label htmlFor="world-action">你的行动</label>
            <textarea
              ref={inputRef}
              id="world-action"
              value={input}
              onChange={(event) => {
                setInput(event.target.value);
                if (inputError) setInputError("");
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  void submit();
                }
              }}
              placeholder="例如：我试着直接获得一万灵石；如果做不到，观察周围有什么合理途径。"
              maxLength={4000}
              disabled={running}
              aria-invalid={inputError ? true : undefined}
              aria-describedby={inputError ? "world-action-error" : undefined}
            />
            <p id="world-action-error" className="cg-field-error">{inputError}</p>
            <div>
              {running ? (
                <button type="button" className="cg-button--secondary" onClick={() => void cancel()}>安全中断</button>
              ) : null}
              {run?.status === "failed" || run?.status === "step_limit" ? (
                <button type="button" className="cg-button--secondary" onClick={() => void retry()}>继续运行</button>
              ) : null}
              <button type="button" onClick={() => void submit()} disabled={running} aria-busy={running}>
                {running ? "提交自由行动 · 运行中" : "提交自由行动"}
              </button>
            </div>
          </div>
        </section>
      ) : null}
    </main>
  );
}
