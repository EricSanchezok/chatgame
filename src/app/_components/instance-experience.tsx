"use client";

import Link from "next/link";
import Image from "next/image";
import { ArrowLeft, Eye, FastForward, LogIn, Network, Pause, Play, Radio, Send, UserRound, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type {
  ArrivalView,
  PublicInstanceDetail,
  PublicWorldEvent,
} from "../../shared/world-api";
import { worldApi } from "../lib/world-api-client";
import WorldInspectorDialog from "./world-inspector-dialog";

function ArrivalDialog({
  arrival,
  onClose,
  onSuggestion,
}: {
  arrival: ArrivalView;
  onClose: () => void;
  onSuggestion: (value: string) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    ref.current?.showModal();
  }, []);

  return (
    <dialog className="cg-arrival" onCancel={onClose} ref={ref}>
      <button
        aria-label="关闭入场场景"
        className="cg-icon-button cg-arrival__close"
        onClick={onClose}
        type="button"
      >
        <X aria-hidden="true" />
      </button>
      <p className="cg-eyebrow">第一眼</p>
      <h2>{arrival.title}</h2>
      <p>{arrival.scene}</p>
      <div className="cg-arrival__suggestions" aria-label="行动建议">
        {arrival.suggestions.map((suggestion) => (
          <button
            key={suggestion}
            onClick={() => {
              onSuggestion(suggestion);
              onClose();
            }}
            type="button"
          >
            {suggestion}
          </button>
        ))}
      </div>
      {!arrival.generated ? <small>入场模型暂不可用，当前显示剧本回退文本。</small> : null}
    </dialog>
  );
}

function PublicEventFeed({ events }: { events: readonly PublicWorldEvent[] }) {
  if (events.length === 0) {
    return (
      <div className="cg-empty-feed">
        <Eye aria-hidden="true" />
        <h2>世界尚未留下公共事件</h2>
        <p>你可以旁观推进；只有所有主体都观察到的事件才会出现在公共视图。</p>
      </div>
    );
  }

  return events.slice().reverse().map((event) => (
    <article key={event.id}>
      <span>Step {event.step}</span>
      <p>{event.description}</p>
    </article>
  ));
}

export function InstanceExperience({ instanceId }: { instanceId: string }) {
  const [detail, setDetail] = useState<PublicInstanceDetail>();
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [joining, setJoining] = useState(false);
  const [selected, setSelected] = useState<{ kind: "origin" | "claim"; id: string }>();
  const [displayName, setDisplayName] = useState("");
  const [appearance, setAppearance] = useState("");
  const [motivation, setMotivation] = useState("");
  const [action, setAction] = useState("");
  const [arrival, setArrival] = useState<ArrivalView>();
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);
  const inspectorTriggerRef = useRef<HTMLButtonElement>(null);

  const refresh = useCallback(async () => {
    try {
      setDetail(await worldApi.instance(instanceId));
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }, [instanceId]);

  useEffect(() => {
    let active = true;
    void worldApi.instance(instanceId).then((value) => {
      if (!active) return;
      setDetail(value);
      setError("");
    }).catch((reason) => {
      if (active) setError(reason instanceof Error ? reason.message : String(reason));
    });
    return () => {
      active = false;
    };
  }, [instanceId]);
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduceMotion(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    if (detail?.summary.schedulerMode !== "realtime" && detail?.summary.advanceStatus !== "running") return;
    const timer = window.setInterval(() => {
      void refresh();
    }, 2_000);
    return () => window.clearInterval(timer);
  }, [detail?.summary.advanceStatus, detail?.summary.schedulerMode, refresh]);

  async function perform(key: string, operation: () => Promise<PublicInstanceDetail>): Promise<boolean> {
    setBusy(key);
    setError("");
    try {
      setDetail(await operation());
      return true;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      return false;
    } finally {
      setBusy("");
    }
  }

  if (!detail) {
    return (
      <main className="cg-instance-loading" aria-busy="true">
        <p>{error || "正在打开世界实例…"}</p>
      </main>
    );
  }

  const participant = detail.controlledView
    ? detail.participants.find((entry) => entry.agentId === detail.controlledView!.agentId)
    : undefined;
  const canJoin = !detail.controlledView && (detail.origins.length > 0 || detail.claimableAgents.some((agent) => agent.claimable));

  return (
    <main className="cg-instance-shell">
      <header className="cg-instance-header">
        <Link className="cg-back-link" href={`/worlds/${encodeURIComponent(detail.world.id)}`}>
          <ArrowLeft aria-hidden="true" />
          {detail.world.name}
        </Link>
        <div>
          <strong>{detail.summary.title}</strong>
          <span>Revision {detail.summary.revision} · Step {detail.summary.step}</span>
        </div>
        <span className="cg-live-state">
          <i aria-hidden="true" />
          {detail.summary.schedulerMode === "realtime" ? "实时演化" : "已暂停"}
        </span>
      </header>
      {error ? <p className="cg-alert cg-instance-alert" role="alert">{error}</p> : null}
      <div className="cg-instance-layout">
        <section className="cg-world-stage" aria-labelledby="world-now-title">
          <div className="cg-world-stage__heading">
            <div>
              <p className="cg-eyebrow">World now</p>
              <h1 id="world-now-title">世界正在发生什么</h1>
            </div>
            <div className="cg-world-controls" aria-label="世界演化控制">
              <button
                disabled={Boolean(busy)}
                onClick={() => void perform("step", () => worldApi.advance(instanceId, {
                  expectedRevision: detail.summary.revision,
                  trigger: "manual",
                }))}
                type="button"
              >
                <Play aria-hidden="true" />
                单步
              </button>
              <button
                disabled={Boolean(busy) || Boolean(detail.controlledView)}
                onClick={() => void perform("batch", () => worldApi.advance(instanceId, {
                  expectedRevision: detail.summary.revision,
                  trigger: "batch",
                  steps: 10,
                }))}
                title={detail.controlledView ? "有真人参与时批量推进会停在行动窗口" : undefined}
                type="button"
              >
                <FastForward aria-hidden="true" />
                十步
              </button>
              <button
                disabled={Boolean(busy)}
                onClick={() => void perform(
                  "realtime",
                  () => worldApi.realtime(instanceId, detail.summary.schedulerMode !== "realtime"),
                )}
                type="button"
              >
                {detail.summary.schedulerMode === "realtime"
                  ? <Pause aria-hidden="true" />
                  : <Radio aria-hidden="true" />}
                {detail.summary.schedulerMode === "realtime" ? "暂停" : "实时"}
              </button>
              <button onClick={() => setInspectorOpen(true)} ref={inspectorTriggerRef} type="button">
                <Network aria-hidden="true" />
                运行记录
              </button>
            </div>
          </div>
          <div className="cg-public-feed" aria-live="polite">
            <PublicEventFeed events={detail.publicEvents} />
          </div>
        </section>
        <aside className="cg-participant-panel" aria-labelledby="participant-panel-title">
          {detail.controlledView && participant ? <>
            <div className="cg-role-heading">
              <UserRound aria-hidden="true" />
              <div>
                <p className="cg-eyebrow">你正在控制</p>
                <h2 id="participant-panel-title">{detail.controlledView.entity.name}</h2>
                <span>{detail.controlledView.entity.location ?? "位置未知"}</span>
              </div>
            </div>
            <p className="cg-role-description">{detail.controlledView.entity.description}</p>
            {detail.actionWindow?.requiredAgentIds.includes(detail.controlledView.agentId) ? (
              <form className="cg-action-composer" onSubmit={(event) => {
                event.preventDefault();
                if (!action.trim()) return;
                void perform("action", () => worldApi.submitAction(instanceId, participant.id, {
                  submissionId: crypto.randomUUID(), expectedRevision: detail.summary.revision, text: action,
                })).then((succeeded) => { if (succeeded) setAction(""); });
              }}>
                <label htmlFor="world-action">你要做什么？</label>
                <textarea
                  autoFocus
                  id="world-action"
                  maxLength={4000}
                  onChange={(event) => setAction(event.target.value)}
                  placeholder="描述意图，不必使用固定指令…"
                  rows={5}
                  value={action}
                />
                <button disabled={busy === "action" || !action.trim()} type="submit">
                  <Send aria-hidden="true" />
                  提交行动
                </button>
                {detail.actionWindow.deadlineAt ? (
                  <small>
                    行动窗口将在 {new Date(detail.actionWindow.deadlineAt).toLocaleTimeString()} 关闭。
                  </small>
                ) : null}
              </form>
            ) : (
              <div className="cg-waiting-role">
                <p>世界当前没有等待你的行动。</p>
                <button
                  disabled={Boolean(busy)}
                  onClick={() => void perform("open-window", () => worldApi.advance(instanceId, {
                    expectedRevision: detail.summary.revision,
                    trigger: "manual",
                  }))}
                  type="button"
                >
                  准备下一步
                </button>
              </div>
            )}
            <section aria-labelledby="role-observations-title" className="cg-role-observations">
              <h3 id="role-observations-title">角色所见</h3>
              {detail.controlledView.observations.length === 0
                ? <p>这个角色还没有留下观察。</p>
                : detail.controlledView.observations.slice(-6).reverse().map((observation, index) => (
                  <article key={`${observation.step}-${index}`}><span>Step {observation.step}</span><p>{observation.summary}</p></article>
                ))}
            </section>
            <details className="cg-private-state">
              <summary>角色记忆与内在状态</summary>
              <pre>{JSON.stringify({
                character: detail.controlledView.character,
                belief: detail.controlledView.belief,
              }, null, 2)}</pre>
            </details>
            <div className="cg-release-actions" aria-label="离开角色">
              <button
                className="cg-leave-role"
                disabled={Boolean(busy)}
                onClick={() => void perform("release-model", () => worldApi.releaseParticipant(
                  instanceId,
                  participant.id,
                  { expectedRevision: detail.summary.revision, disposition: "model" },
                ))}
                type="button"
              >
                离开并交给 AgentMind
              </button>
              <button
                className="cg-leave-role cg-leave-role--quiet"
                disabled={Boolean(busy)}
                onClick={() => void perform("release-idle", () => worldApi.releaseParticipant(
                  instanceId,
                  participant.id,
                  { expectedRevision: detail.summary.revision, disposition: "idle" },
                ))}
                type="button"
              >
                离开并让角色等待
              </button>
            </div>
          </> : <>
            <div className="cg-role-heading">
              <Eye aria-hidden="true" />
              <div>
                <p className="cg-eyebrow">旁观者</p>
                <h2 id="participant-panel-title">你还没有进入世界</h2>
              </div>
            </div>
            <p className="cg-role-description">
              世界不需要玩家才能继续。进入后，你只是接管其中一个 Agent 的策略，不会获得全知视角。
            </p>
            {canJoin ? (
              <button
                className="cg-enter-world"
                onClick={() => setJoining((value) => !value)}
                type="button"
              >
                <LogIn aria-hidden="true" />
                {joining ? "收起选择" : "进入世界"}
              </button>
            ) : <p className="cg-muted">这个剧本只支持无人演化。</p>}
            {joining ? <form className="cg-join-form" onSubmit={(event) => {
              event.preventDefault();
              if (!selected) return;
              setBusy("join");
              setError("");
              void worldApi.createParticipant(instanceId, {
                expectedRevision: detail.summary.revision, displayName, appearance, motivation,
                ...(selected.kind === "origin" ? { originId: selected.id } : { claimAgentId: selected.id }),
              }).then((result) => {
                setDetail(result.instance);
                setArrival(result.arrival);
                setJoining(false);
              })
                .catch((reason) => setError(reason instanceof Error ? reason.message : String(reason)))
                .finally(() => setBusy(""));
            }}>
              <fieldset>
                <legend>选择进入方式</legend>
                <div className="cg-entry-grid">
                  {detail.claimableAgents.filter((agent) => agent.claimable).map((agent) => (
                    <label key={agent.id}>
                      <input
                        checked={selected?.kind === "claim" && selected.id === agent.id}
                        name="entry"
                        onChange={() => {
                          setSelected({ kind: "claim", id: agent.id });
                          setDisplayName(agent.name);
                        }}
                        type="radio"
                      />
                      <span>
                        <strong>{agent.name}</strong>
                        <small>{agent.location ?? "位置未知"}</small>
                        <p>{agent.description}</p>
                      </span>
                    </label>
                  ))}
                  {detail.origins.map((origin) => (
                    <label key={origin.id}>
                      <input
                        checked={selected?.kind === "origin" && selected.id === origin.id}
                        name="entry"
                        onChange={() => setSelected({ kind: "origin", id: origin.id })}
                        type="radio"
                      />
                      <span>
                        {origin.image ? (
                          <Image
                            alt={origin.image.alt}
                            height={360}
                            src={`/api/worlds/${encodeURIComponent(detail.world.id)}/assets/${encodeURIComponent(origin.image.hash)}`}
                            unoptimized
                            width={640}
                          />
                        ) : null}
                        <strong>{origin.title}</strong>
                        <small>{origin.location}</small>
                        <p>{origin.fantasy}</p>
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>
              <label>
                显示名称
                <input
                  maxLength={80}
                  onChange={(event) => setDisplayName(event.target.value)}
                  required
                  value={displayName}
                />
              </label>
              <label>
                外观描述
                <textarea
                  maxLength={500}
                  onChange={(event) => setAppearance(event.target.value)}
                  rows={3}
                  value={appearance}
                />
              </label>
              <label>
                一个自由动机
                <textarea
                  maxLength={500}
                  onChange={(event) => setMotivation(event.target.value)}
                  rows={3}
                  value={motivation}
                />
              </label>
              <button
                disabled={!selected || !displayName.trim() || busy === "join"}
                type="submit"
              >
                {busy === "join" ? "正在进入…" : "确认角色"}
              </button>
            </form> : null}
          </>}
        </aside>
      </div>
      {arrival ? <ArrivalDialog arrival={arrival} onClose={() => setArrival(undefined)} onSuggestion={setAction} /> : null}
      <WorldInspectorDialog
        onOpenChange={(open) => {
          setInspectorOpen(open);
          if (!open) window.requestAnimationFrame(() => inspectorTriggerRef.current?.focus());
        }}
        open={inspectorOpen}
        reduceMotion={reduceMotion}
        instanceId={instanceId}
      />
    </main>
  );
}
