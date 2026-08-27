"use client";

import {
  AssistantRuntimeProvider,
  useExternalStoreRuntime,
  type AppendMessage,
  type ThreadMessageLike,
} from "@assistant-ui/react";
import * as Dialog from "@radix-ui/react-dialog";
import {
  Eye,
  FastForward,
  Pause,
  Play,
  Radio,
  UserRound,
  X,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import type {
  ControlCandidate,
  PublicConversationTurn,
  PublicInstanceDetail,
  PublicInstanceSummary,
} from "../../shared/world-api";
import type { ObserverTurn, WorldObserverDetail } from "../../shared/world-observer-api";
import {
  parsePreferences,
  preferencesSnapshot,
  serverPreferencesSnapshot,
  subscribePreferences,
} from "../_lib/browser-state";
import { worldApi } from "../lib/world-api-client";
import { ControlOrb, type ControlOrbPhase } from "./control-orb";
import { GameThread } from "./game-thread";
import { SettingsPanel } from "./settings-panel";
import WorldInspectorDialog from "./world-inspector-dialog";

type Overlay = "saves" | "settings" | "character" | "control" | null;

function assistantStatus(status: PublicConversationTurn["status"]): ThreadMessageLike["status"] {
  if (status === "running" || status === "awaiting") return { type: "running" };
  if (status === "failed") return { type: "incomplete", reason: "error" };
  return { type: "complete", reason: "stop" };
}

function participantMessages(
  detail: PublicInstanceDetail,
  optimistic?: { id: string; text: string; at: string },
): ThreadMessageLike[] {
  const turns = detail.conversation?.turns ?? [];
  const messages = turns.flatMap((turn): ThreadMessageLike[] => {
    const responseText = turn.response?.text ??
      (turn.status === "failed" ? "这次行动没有改变世界。你可以调整说法后重试。" : "世界正在推演…");
    const assistant: ThreadMessageLike = {
      id: `${turn.id}:world`,
      role: "assistant",
      content: [{ type: "text", text: turn.response?.title
        ? `${turn.response.title}\n\n${responseText}`
        : responseText }],
      createdAt: new Date(turn.createdAt),
      status: assistantStatus(turn.status),
    };
    if (!turn.action) return [assistant];
    return [{
      id: `${turn.id}:action`,
      role: "user",
      content: [{ type: "text", text: turn.action.text }],
      createdAt: new Date(turn.createdAt),
    }, assistant];
  });
  if (optimistic && !turns.some((turn) => turn.action?.submissionId === optimistic.id)) {
    messages.push({
      id: `optimistic:${optimistic.id}:action`,
      role: "user",
      content: [{ type: "text", text: optimistic.text }],
      createdAt: new Date(optimistic.at),
    }, {
      id: `optimistic:${optimistic.id}:world`,
      role: "assistant",
      content: [{ type: "text", text: "世界正在推演…" }],
      createdAt: new Date(optimistic.at),
      status: { type: "running" },
    });
  }
  return messages;
}

function observerMessages(turns: readonly ObserverTurn[]): ThreadMessageLike[] {
  return turns.flatMap((turn): ThreadMessageLike[] => {
    const messages: ThreadMessageLike[] = [];
    if (turn.action) {
      messages.push({
        id: `${turn.id}:action`,
        role: "user",
        content: [{ type: "text", text: turn.action }],
      });
    }
    if (turn.observation) {
      messages.push({
        id: `${turn.id}:observation`,
        role: "assistant",
        content: [{ type: "text", text: turn.observation }],
        status: { type: "complete", reason: "stop" },
      });
    }
    return messages;
  });
}

function GameOverlay({
  children,
  description,
  onOpenChange,
  open,
  title,
}: {
  children: React.ReactNode;
  description: string;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  title: string;
}) {
  return (
    <Dialog.Root onOpenChange={onOpenChange} open={open}>
      <Dialog.Portal>
        <Dialog.Overlay className="cg-modal-overlay" />
        <Dialog.Content
          aria-describedby="cg-game-overlay-description"
          className="cg-game-overlay cg-modal-surface"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            window.setTimeout(() => {
              document.querySelector<HTMLButtonElement>("[data-cg-orb-trigger]")?.focus();
            }, 0);
          }}
        >
          <header className="cg-game-overlay__header">
            <Dialog.Title>{title}</Dialog.Title>
            <Dialog.Description id="cg-game-overlay-description">{description}</Dialog.Description>
          </header>
          <div className="cg-game-overlay__body cg-modal-scroll" tabIndex={0}>{children}</div>
          <Dialog.Close aria-label={`关闭${title}`} className="cg-modal-close">
            <X aria-hidden="true" />
          </Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function SaveManager({
  currentId,
  instances,
}: {
  currentId: string;
  instances: readonly PublicInstanceSummary[];
}) {
  return (
    <section className="cg-overlay-section">
      <p className="cg-eyebrow">当前世界</p>
      <h2>存档</h2>
      <p>每个世界实例都是自动保存的持续旅程。</p>
      <ul className="cg-overlay-list">
        {instances.map((instance) => (
          <li data-current={instance.id === currentId || undefined} key={instance.id}>
            <Link href={`/play/${encodeURIComponent(instance.id)}`}>
              <strong>{instance.title}</strong>
              <span>Revision {instance.revision} · Step {instance.step}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

function CharacterPanel({
  name,
  location,
  character,
  belief,
}: {
  name: string;
  location: string | null;
  character: unknown;
  belief: unknown;
}) {
  return (
    <section className="cg-overlay-section">
      <p className="cg-eyebrow">角色视角</p>
      <h2>{name}</h2>
      <p>{location ?? "位置未知"}</p>
      <div className="cg-character-grid">
        <section><h3>内在状态与目标</h3><pre aria-label="角色内在状态与目标" tabIndex={0}>{JSON.stringify(character, null, 2)}</pre></section>
        <section><h3>记忆与认知</h3><pre aria-label="角色记忆与认知" tabIndex={0}>{JSON.stringify(belief, null, 2)}</pre></section>
      </div>
    </section>
  );
}

function ObserverConsole({
  busy,
  detail,
  observer,
  onAdvance,
  onOpenCharacter,
  onSelectAgent,
  onTakeOver,
  onToggleRealtime,
}: {
  busy: boolean;
  detail: PublicInstanceDetail;
  observer?: WorldObserverDetail;
  onAdvance: (steps: number) => void;
  onOpenCharacter: () => void;
  onSelectAgent: (agentId: string) => void;
  onTakeOver: () => void;
  onToggleRealtime: () => void;
}) {
  const selected = observer?.selected?.agent.id ?? "";
  return (
    <div className="cg-observer-console" aria-label="无人演化控制台">
      <label>
        <span className="cg-sr-only">观察角色</span>
        <select disabled={busy || !observer} onChange={(event) => onSelectAgent(event.target.value)} value={selected}>
          {observer?.agents.map((agent) => (
            <option key={agent.id} value={agent.id}>{agent.name}{agent.location ? ` · ${agent.location}` : ""}</option>
          ))}
        </select>
      </label>
      <button disabled={busy} onClick={() => onAdvance(1)} type="button"><Play aria-hidden="true" />单步</button>
      <button disabled={busy} onClick={() => onAdvance(10)} type="button"><FastForward aria-hidden="true" />十步</button>
      <button disabled={busy} onClick={onToggleRealtime} type="button">
        {detail.summary.schedulerMode === "realtime" ? <Pause aria-hidden="true" /> : <Radio aria-hidden="true" />}
        {detail.summary.schedulerMode === "realtime" ? "暂停" : "实时"}
      </button>
      <button disabled={!observer?.selected} onClick={onOpenCharacter} type="button"><UserRound aria-hidden="true" />角色</button>
      <button className="cg-observer-console__primary" disabled={busy || !observer?.selected} onClick={onTakeOver} type="button">
        接管
      </button>
    </div>
  );
}

export function InstanceExperience({ instanceId }: { instanceId: string }) {
  const router = useRouter();
  const [detail, setDetail] = useState<PublicInstanceDetail>();
  const [observer, setObserver] = useState<WorldObserverDetail>();
  const [selectedAgentId, setSelectedAgentId] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [streamWarning, setStreamWarning] = useState("");
  const [optimistic, setOptimistic] = useState<{ id: string; text: string; at: string }>();
  const [overlay, setOverlay] = useState<Overlay>(null);
  const [instances, setInstances] = useState<PublicInstanceSummary[]>([]);
  const [controlCandidates, setControlCandidates] = useState<ControlCandidate[]>([]);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const serializedPreferences = useSyncExternalStore(
    subscribePreferences,
    preferencesSnapshot,
    serverPreferencesSnapshot,
  );
  const preferences = useMemo(() => parsePreferences(serializedPreferences), [serializedPreferences]);

  const loadObserver = useCallback(async (agentId?: string) => {
    const next = await worldApi.observer(instanceId, agentId);
    setObserver(next);
    setSelectedAgentId(next.selected?.agent.id ?? "");
    return next;
  }, [instanceId]);

  const refresh = useCallback(async () => {
    const next = await worldApi.instance(instanceId);
    setDetail(next);
    if (!next.controlledView) await loadObserver(selectedAgentId || undefined);
    else setObserver(undefined);
    return next;
  }, [instanceId, loadObserver, selectedAgentId]);

  useEffect(() => {
    let active = true;
    void worldApi.instance(instanceId).then(async (next) => {
      if (!active) return;
      setDetail(next);
      if (!next.controlledView) {
        const perspective = await worldApi.observer(instanceId);
        if (!active) return;
        setObserver(perspective);
        setSelectedAgentId(perspective.selected?.agent.id ?? "");
      }
    }).catch(() => {
      if (active) setError("这个世界暂时无法打开。");
    });
    return () => { active = false; };
  }, [instanceId]);

  useEffect(() => {
    if (!detail || detail.summary.schedulerMode !== "realtime" && detail.summary.advanceStatus !== "running") return;
    const timer = window.setInterval(() => {
      void refresh().catch(() => setStreamWarning("最新进度暂时无法同步，正在自动重试。"));
    }, 2_000);
    return () => window.clearInterval(timer);
  }, [detail, refresh]);

  useEffect(() => {
    const source = new EventSource(worldApi.instanceEventsUrl(instanceId));
    source.addEventListener("changed", () => {
      void refresh().then(() => setStreamWarning("")).catch(() => {
        setStreamWarning("最新进度暂时无法同步，正在自动重试。");
      });
    });
    source.onopen = () => setStreamWarning("");
    source.onerror = () => setStreamWarning("实时更新暂时中断，正在自动重连。");
    return () => source.close();
  }, [instanceId, refresh]);

  const messages = useMemo(
    () => detail?.controlledView
      ? participantMessages(detail, optimistic)
      : observerMessages(observer?.selected?.turns ?? []),
    [detail, observer, optimistic],
  );
  const participant = detail?.controlledView
    ? detail.participants.find((candidate) => candidate.agentId === detail.controlledView!.agentId)
    : undefined;
  const latestTurn = detail?.conversation?.turns.at(-1);
  const isRunning = Boolean(busy === "action" || latestTurn?.status === "running" || latestTurn?.status === "awaiting");

  const submit = useCallback(async (message: AppendMessage) => {
    const text = message.content
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .join("\n")
      .trim();
    if (!text || !detail || !participant || busy) return;
    const id = crypto.randomUUID();
    setOptimistic({ id, text, at: new Date().toISOString() });
    setBusy("action");
    setError("");
    try {
      const next = await worldApi.submitAction(instanceId, participant.id, {
        submissionId: id,
        expectedRevision: detail.summary.revision,
        text,
      });
      setDetail(next);
      setStreamWarning("");
    } catch {
      await refresh().catch(() => undefined);
      setError("行动暂时无法提交。请确认世界状态后重试。");
    } finally {
      setOptimistic(undefined);
      setBusy("");
    }
  }, [busy, detail, instanceId, participant, refresh]);

  const runtime = useExternalStoreRuntime({
    messages,
    convertMessage: (message) => message,
    isRunning,
    isSendDisabled: !detail?.controlledView || isRunning,
    onNew: submit,
  });

  async function perform(key: string, operation: () => Promise<PublicInstanceDetail>): Promise<void> {
    if (busy) return;
    setBusy(key);
    setError("");
    try {
      const next = await operation();
      setDetail(next);
      if (!next.controlledView) await loadObserver(selectedAgentId || undefined);
      else setObserver(undefined);
    } catch {
      setError("世界暂时无法完成这个操作，请稍后重试。");
    } finally {
      setBusy("");
    }
  }

  async function openOverlay(next: Exclude<Overlay, null>): Promise<void> {
    if (next === "saves") {
      const result = await worldApi.instances();
      setInstances(result.instances.filter((instance) => instance.worldId === detail?.world.id));
    }
    if (next === "control") {
      const result = await worldApi.controlOptions(instanceId);
      setControlCandidates(result.agents);
    }
    setOverlay(next);
  }

  if (!detail) {
    return <main className="cg-game-loading" aria-live="polite">{error || "正在唤醒世界…"}</main>;
  }

  const roleView = detail.controlledView
    ? {
        name: detail.controlledView.entity.name,
        location: detail.controlledView.entity.location,
        character: detail.controlledView.character,
        belief: detail.controlledView.belief,
      }
    : observer?.selected
      ? {
          name: observer.selected.agent.name,
          location: observer.selected.agent.location,
          character: observer.selected.character,
          belief: observer.selected.belief,
        }
      : undefined;
  const suggestions = detail.conversation?.turns.find((turn) => !turn.action)?.response?.suggestions ?? [];
  const orbPhase: ControlOrbPhase = isRunning ? "running" : busy ? "confirming" : "saved";

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <main className="cg-game">
        <h1 className="cg-sr-only">{detail.summary.title}</h1>
        <GameThread
          actionError={error}
          busy={isRunning}
          footer={!detail.controlledView ? (
            <ObserverConsole
              busy={Boolean(busy)}
              detail={detail}
              observer={observer}
              onAdvance={(steps) => void perform(steps === 1 ? "step" : "batch", () => worldApi.advance(instanceId, {
                expectedRevision: detail.summary.revision,
                trigger: steps === 1 ? "manual" : "batch",
                steps,
              }))}
              onOpenCharacter={() => setOverlay("character")}
              onSelectAgent={(agentId) => {
                setSelectedAgentId(agentId);
                void loadObserver(agentId).catch(() => setError("这个角色视角暂时无法读取。"));
              }}
              onTakeOver={() => {
                const agentId = observer?.selected?.agent.id;
                if (agentId) void perform("takeover", () => worldApi.transferControl(instanceId, {
                  expectedRevision: detail.summary.revision,
                  target: { kind: "agent", agentId },
                }));
              }}
              onToggleRealtime={() => void perform("realtime", () => worldApi.realtime(
                instanceId,
                detail.summary.schedulerMode !== "realtime",
              ))}
            />
          ) : preferences.advancedRoleControl ? (
            <button className="cg-detach-button" onClick={() => void openOverlay("control")} type="button">
              切换或离开角色
            </button>
          ) : undefined}
          readOnly={!detail.controlledView}
          streamWarning={streamWarning}
          suggestions={suggestions}
        />
        <ControlOrb
          composerDocked={messages.length > 0}
          inspectorEnabled={preferences.showWorldInspector}
          onAction={(kind) => {
            if (kind === "exit") router.push("/");
            else void openOverlay(kind);
          }}
          onOpenInspector={() => setInspectorOpen(true)}
          status={{
            elapsedSeconds: detail.summary.elapsedSeconds,
            phase: orbPhase,
            sessionTitle: detail.summary.title,
            step: detail.summary.step,
            worldName: detail.world.name,
          }}
        />

        <GameOverlay
          description="查看同一世界中的自动存档。"
          onOpenChange={(open) => { if (!open) setOverlay(null); }}
          open={overlay === "saves"}
          title="存档"
        >
          <SaveManager currentId={instanceId} instances={instances} />
        </GameOverlay>
        <GameOverlay
          description="调整外观、阅读体验和高级工具。"
          onOpenChange={(open) => { if (!open) setOverlay(null); }}
          open={overlay === "settings"}
          title="设置"
        >
          <SettingsPanel />
        </GameOverlay>
        <GameOverlay
          description="这里只显示当前角色被允许知道的内容。"
          onOpenChange={(open) => { if (!open) setOverlay(null); }}
          open={overlay === "character"}
          title="角色"
        >
          {roleView ? <CharacterPanel {...roleView} /> : <p className="cg-muted">请先选择一个 Agent 视角。</p>}
        </GameOverlay>
        <GameOverlay
          description="控制转移只会在当前 Revision 边界原子完成。"
          onOpenChange={(open) => { if (!open) setOverlay(null); }}
          open={overlay === "control"}
          title="切换或离开角色"
        >
          <section className="cg-overlay-section">
            <button
              className="cg-control-choice"
              disabled={Boolean(busy)}
              onClick={() => void perform("detach", () => worldApi.transferControl(instanceId, {
                expectedRevision: detail.summary.revision,
                target: { kind: "observer" },
              })).then(() => setOverlay(null))}
              type="button"
            >
              <Eye aria-hidden="true" /><span><strong>进入观察模式</strong><small>把当前角色交还 AgentMind</small></span>
            </button>
            <h3>直接切换角色</h3>
            <div className="cg-control-candidates">
              {controlCandidates.map((candidate) => (
                <button
                  disabled={Boolean(busy)}
                  key={candidate.id}
                  onClick={() => void perform("switch", () => worldApi.transferControl(instanceId, {
                    expectedRevision: detail.summary.revision,
                    target: { kind: "agent", agentId: candidate.id },
                  })).then(() => setOverlay(null))}
                  type="button"
                >
                  <strong>{candidate.name}</strong><small>{candidate.location ?? "位置未知"}</small>
                </button>
              ))}
            </div>
          </section>
        </GameOverlay>

        {preferences.showWorldInspector && inspectorOpen ? (
          <WorldInspectorDialog
            instanceId={instanceId}
            onOpenChange={setInspectorOpen}
            open={inspectorOpen}
            reduceMotion={preferences.reduceMotion}
          />
        ) : null}
      </main>
    </AssistantRuntimeProvider>
  );
}
