"use client";

import {
  Braces,
  BrainCircuit,
  GitCompareArrows,
  Link2,
  LoaderCircle,
  ScanSearch,
} from "lucide-react";
import { useState } from "react";
import type {
  WorldInspectorAttemptDetail,
  WorldInspectorStepDetail,
} from "../../shared/world-inspector-api";

type Detail =
  | { kind: "step"; value: WorldInspectorStepDetail }
  | { kind: "attempt"; value: WorldInspectorAttemptDetail };

type DetailTab = "overview" | "changes" | "causality" | "model" | "raw";

const tabs: Array<{ id: DetailTab; label: string; icon: typeof ScanSearch }> = [
  { id: "overview", label: "概要", icon: ScanSearch },
  { id: "changes", label: "变更", icon: GitCompareArrows },
  { id: "causality", label: "因果", icon: Link2 },
  { id: "model", label: "模型", icon: BrainCircuit },
  { id: "raw", label: "原始", icon: Braces },
];

function JsonBlock({ label, value }: { label: string; value: unknown }) {
  return (
    <details className="cg-inspector-json">
      <summary>{label}</summary>
      <pre>{JSON.stringify(value, null, 2)}</pre>
    </details>
  );
}

function CountGrid({ detail }: { detail: WorldInspectorStepDetail }) {
  return (
    <dl className="cg-inspector-counts">
      {Object.entries(detail.summary.counts).map(([key, value]) => (
        <div key={key}><dt>{key}</dt><dd>{value}</dd></div>
      ))}
    </dl>
  );
}

function StepChanges({ actorId, detail }: { actorId: string; detail: WorldInspectorStepDetail }) {
  if (actorId === "world") {
    return (
      <div className="cg-inspector-detail-stack">
        <p>{detail.committed.operations.length} 个 canonical operation 在同一事务内提交。</p>
        {detail.committed.operations.map((operation, index) => (
          <JsonBlock key={`${operation.kind}:${index}`} label={`${index + 1}. ${operation.kind}`} value={operation} />
        ))}
        <JsonBlock label="提交前 canonical truth" value={detail.before.truth} />
        <JsonBlock label="提交后 canonical truth" value={detail.after.truth} />
      </div>
    );
  }
  if (actorId === "player") {
    return (
      <div className="cg-inspector-detail-stack">
        <JsonBlock label="提交前玩家认知" value={detail.before.player} />
        <JsonBlock label="提交后玩家认知" value={detail.after.player} />
      </div>
    );
  }
  const beliefPatch = detail.committed.beliefPatches.find((patch) => patch.agentId === actorId);
  const characterPatch = detail.committed.characterPatches.find((patch) => patch.agentId === actorId);
  const observations = detail.committed.observations.filter((observation) => observation.observerId === actorId);
  return (
    <div className="cg-inspector-detail-stack">
      <JsonBlock label="本步观察" value={observations} />
      <JsonBlock label="信念变化" value={beliefPatch ?? { operations: [] }} />
      <JsonBlock label="角色变化" value={characterPatch ?? { operations: [] }} />
      <JsonBlock label="提交前 Agent 状态" value={detail.before.agents[actorId] ?? null} />
      <JsonBlock label="提交后 Agent 状态" value={detail.after.agents[actorId] ?? null} />
    </div>
  );
}

function DetailBody({ actorId, detail, tab }: { actorId: string; detail: Detail; tab: DetailTab }) {
  if (detail.kind === "attempt") {
    if (tab === "overview") {
      return (
        <div className="cg-inspector-detail-stack">
          <span className="cg-inspector-detail__status" data-status={detail.value.summary.status}>
            {detail.value.summary.status}
          </span>
          <h3>{detail.value.summary.id}</h3>
          <p>{detail.value.summary.errorMessage ?? detail.value.summary.latestEvent}</p>
          <dl className="cg-inspector-counts">
            <div><dt>events</dt><dd>{detail.value.summary.eventCount}</dd></div>
            <div><dt>models</dt><dd>{detail.value.summary.modelInvocationCount}</dd></div>
            <div><dt>trace</dt><dd>{detail.value.trace.mode}</dd></div>
          </dl>
        </div>
      );
    }
    if (tab === "model") {
      return (
        <div className="cg-inspector-detail-stack">
          {detail.value.events.filter((event) => event.event.startsWith("model.")).map((event) => (
            <JsonBlock key={`${event.timestamp}:${event.sequence}`} label={event.event} value={event} />
          ))}
          {!detail.value.events.some((event) => event.event.startsWith("model.")) && <p>这次尝试没有保留模型事件。</p>}
        </div>
      );
    }
    return <JsonBlock label="完整 attempt trace" value={detail.value.events} />;
  }

  const step = detail.value;
  if (tab === "overview") {
    const action = step.committed.actions.find((candidate) => candidate.actorId === actorId);
    const nextAction = step.committed.nextActions.find((candidate) => candidate.actorId === actorId);
    return (
      <div className="cg-inspector-detail-stack">
        <span className="cg-inspector-detail__status" data-status="committed">committed</span>
        <h3>Revision {step.summary.revision}</h3>
        <p>{step.summary.playerGoal}</p>
        <CountGrid detail={step} />
        {actorId !== "world" && <JsonBlock label="本步最终行动" value={action ?? null} />}
        {actorId !== "world" && actorId !== "player" && <JsonBlock label="下一行动" value={nextAction ?? null} />}
      </div>
    );
  }
  if (tab === "changes") return <StepChanges actorId={actorId} detail={step} />;
  if (tab === "causality") {
    return (
      <div className="cg-inspector-detail-stack">
        <JsonBlock label="反应请求与决定" value={{ requests: step.committed.reactionRequests, decisions: step.committed.reactionDecisions }} />
        <JsonBlock label="检定" value={{ requests: step.committed.checkRequests, results: step.committed.checks }} />
        <JsonBlock label="随机承诺" value={{ rounds: step.committed.commitmentRounds, requests: step.committed.randomRequests, results: step.committed.randomResults }} />
        <JsonBlock label="机制" value={{ invocations: step.committed.mechanicInvocations, results: step.committed.mechanicResults }} />
        <JsonBlock label="因果复核" value={{ assertions: step.committed.causalAssertionResults, verification: step.committed.causalVerification }} />
      </div>
    );
  }
  if (tab === "model") {
    const events = step.runtimeEvents.filter((event) => event.event.startsWith("model."));
    return (
      <div className="cg-inspector-detail-stack">
        <p>{step.trace.mode === "full" ? "完整日志模式：可查看已记录的上下文和结构化输出。" : "当前日志模式不保存完整模型 payload。"}</p>
        {step.committed.modelAudits.map((audit) => (
          <JsonBlock key={`${audit.role}:${audit.subjectId}`} label={`${audit.role} · ${audit.subjectId}`} value={audit} />
        ))}
        {events.map((event) => <JsonBlock key={`${event.timestamp}:${event.sequence}`} label={event.event} value={event} />)}
      </div>
    );
  }
  return (
    <div className="cg-inspector-detail-stack">
      <JsonBlock label="CommittedStep" value={step.committed} />
      <JsonBlock label="Runtime events" value={step.runtimeEvents} />
    </div>
  );
}

export function WorldInspectorDetail({
  actorId,
  detail,
  error,
  loading,
}: {
  actorId: string;
  detail?: Detail;
  error?: string;
  loading: boolean;
}) {
  const [tab, setTab] = useState<DetailTab>("overview");

  return (
    <aside className="cg-inspector-detail" aria-label="推演详情">
      <div className="cg-inspector-detail__tabs" aria-label="详情视图">
        {tabs.map((item) => {
          const Icon = item.icon;
          return (
            <button aria-pressed={tab === item.id} key={item.id} onClick={() => setTab(item.id)} type="button">
              <Icon aria-hidden="true" />
              <span>{item.label}</span>
            </button>
          );
        })}
      </div>
      <div className="cg-inspector-detail__body">
        {loading && <p className="cg-inspector-detail__loading"><LoaderCircle aria-hidden="true" /> 正在读取审计记录…</p>}
        {!loading && error && <p className="cg-inspector-detail__error" role="alert">{error} 请重新选择记录或刷新调试器。</p>}
        {!loading && !error && detail && <DetailBody actorId={actorId} detail={detail} tab={tab} />}
        {!loading && !error && !detail && (
          <div className="cg-inspector-empty">
            <strong>选择一条推演记录</strong>
            <span>这里会显示状态差异、因果审计和模型记录。</span>
          </div>
        )}
      </div>
    </aside>
  );
}
