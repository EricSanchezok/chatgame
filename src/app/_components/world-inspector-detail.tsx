"use client";

import {
  Activity,
  BadgeCheck,
  Bot,
  Braces,
  BrainCircuit,
  Check,
  Clock3,
  Dices,
  Eye,
  GitCompareArrows,
  Link2,
  LoaderCircle,
  ScanSearch,
  Sparkles,
  Waypoints,
  Wrench,
} from "lucide-react";
import { useState, type KeyboardEvent, type ReactNode } from "react";
import type {
  WorldInspectorAttemptDetail,
  WorldInspectorAttemptStatus,
  WorldInspectorStepDetail,
} from "../../shared/world-inspector-api";

type Detail =
  | { kind: "step"; value: WorldInspectorStepDetail }
  | { kind: "attempt"; value: WorldInspectorAttemptDetail };

type DetailTab = "overview" | "changes" | "causality" | "model" | "raw";
type StepAction = WorldInspectorStepDetail["committed"]["actions"][number];
type StepOutcome = WorldInspectorStepDetail["committed"]["outcomes"][number];

const tabs: Array<{ id: DetailTab; label: string; icon: typeof ScanSearch }> = [
  { id: "overview", label: "概要", icon: ScanSearch },
  { id: "changes", label: "变更", icon: GitCompareArrows },
  { id: "causality", label: "因果", icon: Link2 },
  { id: "model", label: "模型", icon: BrainCircuit },
  { id: "raw", label: "原始", icon: Braces },
];

const attemptStatusLabel: Record<WorldInspectorAttemptStatus, string> = {
  active: "推演中",
  committed: "已提交",
  rolled_back: "已回滚",
  failed: "失败",
  cancelled: "已取消",
};

const outcomeStatusLabel: Record<StepOutcome["status"], string> = {
  succeeded: "成功",
  partial: "部分完成",
  failed: "失败",
  blocked: "受阻",
  continuing: "进行中",
};

const operationLabel: Record<string, string> = {
  create_entity: "创建实体",
  retire_entity: "退场实体",
  place_entity: "移动实体",
  set_fact: "写入事实",
  remove_fact: "移除事实",
  set_meter: "设置数值",
  adjust_meter: "调整数值",
  transfer_quantity: "转移资源",
  produce_quantity: "产生资源",
  consume_quantity: "消耗资源",
  set_rating: "设置评级",
  advance_time: "推进世界时间",
  create_agent: "创建 Agent",
  remove_agent: "移除 Agent",
};

function JsonBlock({ label, value }: { label: string; value: unknown }) {
  return (
    <details className="cg-inspector-json">
      <summary>{label}</summary>
      <pre>{JSON.stringify(value, null, 2)}</pre>
    </details>
  );
}

function DetailSection({
  children,
  count,
  description,
  icon: Icon,
  title,
}: {
  children?: ReactNode;
  count?: string;
  description?: string;
  icon: typeof Activity;
  title: string;
}) {
  return (
    <section className="cg-inspector-section">
      <header className="cg-inspector-section__header">
        <span className="cg-inspector-section__icon"><Icon aria-hidden="true" /></span>
        <span>
          <strong>{title}</strong>
          {description && <small>{description}</small>}
        </span>
        {count && <b>{count}</b>}
      </header>
      {children}
    </section>
  );
}

function CommitHeading({ detail }: { detail: WorldInspectorStepDetail }) {
  return (
    <header className="cg-inspector-detail-heading">
      <span className="cg-inspector-detail__status" data-status="committed"><Check aria-hidden="true" /> 已提交</span>
      <h3>Revision {detail.summary.revision}</h3>
      <p><strong>玩家意图</strong><span>{detail.summary.playerGoal}</span></p>
      <small>
        Step {detail.summary.step} · 世界推进 {detail.summary.elapsedSeconds} 秒 · {detail.summary.tokenUsage.unknown
          ? "部分 token 未记录"
          : `${detail.summary.tokenUsage.total} tokens`}
      </small>
    </header>
  );
}

function WorldOverview({ detail }: { detail: WorldInspectorStepDetail }) {
  const counts = detail.summary.counts;
  const adjudication = [
    ["反应", counts.reactions],
    ["检定", counts.checks],
    ["随机", counts.random],
    ["机制", counts.mechanics],
  ] as const;
  const activeAdjudication = adjudication.filter(([, count]) => count > 0);
  return (
    <div className="cg-inspector-detail-stack">
      <CommitHeading detail={detail} />
      <ol aria-label="本轮世界演化结果" className="cg-inspector-result-chain">
        <li><Activity aria-hidden="true" /><strong>{counts.actions}</strong><span>个联合行动</span></li>
        <li><Waypoints aria-hidden="true" /><strong>{counts.operations}</strong><span>项状态变更</span></li>
        <li><Sparkles aria-hidden="true" /><strong>{counts.events}</strong><span>个世界事件</span></li>
      </ol>
      <dl className="cg-inspector-signal-list">
        <div>
          <dt><Eye aria-hidden="true" /><span><strong>认知传播</strong><small>角色在这一轮实际接收到的信息</small></span></dt>
          <dd>{counts.observations} 份观察 · {counts.mindUpdates} 个心智更新</dd>
        </div>
        <div>
          <dt><BadgeCheck aria-hidden="true" /><span><strong>裁决过程</strong><small>反应、检定、随机与规则机制</small></span></dt>
          <dd>{activeAdjudication.length > 0
            ? activeAdjudication.map(([label, count]) => `${label} ${count}`).join(" · ")
            : "本轮未触发额外裁决"}</dd>
        </div>
        <div>
          <dt><Bot aria-hidden="true" /><span><strong>模型开销</strong><small>完成这一轮推演调用的模型次数</small></span></dt>
          <dd>{counts.modelInvocations} 次调用</dd>
        </div>
      </dl>
    </div>
  );
}

function ActionCard({ action, label, outcome, planned = false }: {
  action: StepAction;
  label: string;
  outcome?: StepOutcome;
  planned?: boolean;
}) {
  return (
    <section className="cg-inspector-action-card" data-planned={planned || undefined}>
      <header>
        <span><Activity aria-hidden="true" /></span>
        <small>{label}</small>
        <b data-status={outcome?.status}>{planned ? "尚未执行" : outcome ? outcomeStatusLabel[outcome.status] : "已提交"}</b>
      </header>
      <p>{action.rawText}</p>
      <dl>
        <div><dt>目标</dt><dd>{action.goal}</dd></div>
        {action.means && <div><dt>方式</dt><dd>{action.means}</dd></div>}
        {outcome && <div><dt>结果</dt><dd>{outcome.summary}</dd></div>}
      </dl>
      <JsonBlock label="查看结构化行动记录" value={action} />
    </section>
  );
}

function ActorOverview({ actorId, actorName, detail }: {
  actorId: string;
  actorName: string;
  detail: WorldInspectorStepDetail;
}) {
  const action = detail.committed.actions.find((candidate) => candidate.actorId === actorId);
  const nextAction = detail.committed.nextActions.find((candidate) => candidate.actorId === actorId);
  const outcome = action
    ? detail.committed.outcomes.find((candidate) => candidate.proposalId === action.id)
    : undefined;
  const observations = detail.committed.observations.filter((observation) => observation.observerId === actorId);
  const beliefChanges = detail.committed.beliefPatches.find((patch) => patch.agentId === actorId)?.operations.length ?? 0;
  const characterChanges = detail.committed.characterPatches.find((patch) => patch.agentId === actorId)?.operations.length ?? 0;
  return (
    <div className="cg-inspector-detail-stack">
      <CommitHeading detail={detail} />
      {action
        ? <ActionCard action={action} label={`${actorName}本轮实际行动`} outcome={outcome} />
        : <p className="cg-inspector-inline-empty">{actorName}在这一轮没有提交行动。</p>}
      <DetailSection
        count={`${observations.length} 份`}
        description="仅包含该主体在当时能够感知的信息"
        icon={Eye}
        title="本轮获得的信息"
      >
        {observations.length > 0
          ? <ul className="cg-inspector-observation-list">{observations.map((observation) => (
              <li key={observation.id}>{observation.summary}</li>
            ))}</ul>
          : <p className="cg-inspector-inline-empty">没有新增观察。</p>}
      </DetailSection>
      {actorId !== "player" && (
        <DetailSection
          count={`${beliefChanges + characterChanges} 项`}
          description="观察经过 AgentMind 后写入的信念与角色状态"
          icon={BrainCircuit}
          title="个体演化"
        >
          <p className="cg-inspector-section__summary">
            {beliefChanges + characterChanges > 0
              ? `${beliefChanges} 项信念变化 · ${characterChanges} 项角色变化`
              : "本轮认知与角色状态没有变化。"}
          </p>
        </DetailSection>
      )}
      {nextAction && <ActionCard action={nextAction} label="下一轮计划" planned />}
    </div>
  );
}

function StepChanges({ actorId, detail }: { actorId: string; detail: WorldInspectorStepDetail }) {
  if (actorId === "world") {
    return (
      <div className="cg-inspector-detail-stack">
        <DetailSection
          count={`${detail.committed.operations.length} 项`}
          description="这些操作在同一事务中原子提交"
          icon={GitCompareArrows}
          title="Canonical truth 变更"
        >
          {detail.committed.operations.length > 0
            ? <div className="cg-inspector-record-list">{detail.committed.operations.map((operation, index) => (
                <JsonBlock
                  key={`${operation.kind}:${index}`}
                  label={`${index + 1}. ${operationLabel[operation.kind] ?? operation.kind}`}
                  value={operation}
                />
              ))}</div>
            : <p className="cg-inspector-inline-empty">本轮没有改变世界状态。</p>}
        </DetailSection>
        <JsonBlock label="对比提交前后的完整世界快照" value={{ before: detail.before.truth, after: detail.after.truth }} />
      </div>
    );
  }
  if (actorId === "player") {
    return (
      <div className="cg-inspector-detail-stack">
        <DetailSection
          description="玩家知识与客观世界保持隔离"
          icon={Eye}
          title="玩家认知变化"
        >
          <JsonBlock label="对比提交前后的玩家认知" value={{ before: detail.before.player, after: detail.after.player }} />
        </DetailSection>
      </div>
    );
  }
  const beliefPatch = detail.committed.beliefPatches.find((patch) => patch.agentId === actorId);
  const characterPatch = detail.committed.characterPatches.find((patch) => patch.agentId === actorId);
  const observations = detail.committed.observations.filter((observation) => observation.observerId === actorId);
  const beliefOperations = beliefPatch?.operations ?? [];
  const characterOperations = characterPatch?.operations ?? [];
  return (
    <div className="cg-inspector-detail-stack">
      <dl className="cg-inspector-change-summary">
        <div><dt>收到观察</dt><dd>{observations.length}</dd></div>
        <div><dt>信念变化</dt><dd>{beliefOperations.length}</dd></div>
        <div><dt>角色变化</dt><dd>{characterOperations.length}</dd></div>
      </dl>
      {observations.length > 0 && <JsonBlock label="查看本轮观察" value={observations} />}
      {beliefOperations.length > 0 && <JsonBlock label="查看信念变化" value={beliefPatch} />}
      {characterOperations.length > 0 && <JsonBlock label="查看角色变化" value={characterPatch} />}
      <JsonBlock
        label="对比提交前后的完整 Agent 状态"
        value={{ before: detail.before.agents[actorId] ?? null, after: detail.after.agents[actorId] ?? null }}
      />
    </div>
  );
}

function Causality({ detail }: { detail: WorldInspectorStepDetail }) {
  const stages = [
    {
      title: "Agent 反应",
      description: "主体是否因其他行动改变原计划",
      icon: Activity,
      count: detail.committed.reactionRequests.length + detail.committed.reactionDecisions.length,
      value: { requests: detail.committed.reactionRequests, decisions: detail.committed.reactionDecisions },
    },
    {
      title: "能力检定",
      description: "不确定行动的难度与结果",
      icon: BadgeCheck,
      count: detail.committed.checkRequests.length + detail.committed.checks.length,
      value: { requests: detail.committed.checkRequests, results: detail.committed.checks },
    },
    {
      title: "随机承诺",
      description: "先承诺、后揭示的随机结果",
      icon: Dices,
      count: detail.committed.randomRequests.length + detail.committed.randomResults.length,
      value: {
        rounds: detail.committed.commitmentRounds,
        requests: detail.committed.randomRequests,
        results: detail.committed.randomResults,
      },
    },
    {
      title: "规则机制",
      description: "剧本机制调用及其状态操作",
      icon: Wrench,
      count: detail.committed.mechanicInvocations.length + detail.committed.mechanicResults.length,
      value: { invocations: detail.committed.mechanicInvocations, results: detail.committed.mechanicResults },
    },
  ].filter((stage) => stage.count > 0);
  const accepted = detail.committed.causalVerification.verdict === "accept";
  return (
    <div className="cg-inspector-detail-stack">
      <section className="cg-inspector-assurance" data-status={accepted ? "accepted" : "rejected"}>
        <span><Link2 aria-hidden="true" /></span>
        <div><strong>{accepted ? "因果复核通过" : "因果复核拒绝"}</strong><small>{detail.committed.causalAssertionResults.length} 条因果断言已校验</small></div>
        <b>{accepted ? "可信提交" : "需要检查"}</b>
      </section>
      {stages.length > 0
        ? stages.map((stage) => (
            <DetailSection
              count={`${stage.count} 条`}
              description={stage.description}
              icon={stage.icon}
              key={stage.title}
              title={stage.title}
            >
              <JsonBlock label="查看结构化裁决记录" value={stage.value} />
            </DetailSection>
          ))
        : <p className="cg-inspector-inline-empty">本轮没有触发 Agent 反应、能力检定、随机承诺或规则机制。</p>}
      <JsonBlock
        label="查看因果断言与复核明细"
        value={{ assertions: detail.committed.causalAssertionResults, verification: detail.committed.causalVerification }}
      />
    </div>
  );
}

function ModelAudit({ detail }: { detail: WorldInspectorStepDetail }) {
  const events = detail.runtimeEvents.filter((event) => event.event.startsWith("model."));
  const invocationCount = detail.committed.modelAudits.reduce((total, audit) => total + audit.invocations.length, 0);
  return (
    <div className="cg-inspector-detail-stack">
      <header className="cg-inspector-model-summary">
        <span><Bot aria-hidden="true" /></span>
        <div><strong>{invocationCount} 次模型调用</strong><small>{detail.committed.modelAudits.length} 个执行角色 · {detail.trace.mode === "full" ? "保留完整 payload" : "仅保留指标"}</small></div>
      </header>
      {detail.committed.modelAudits.map((audit) => {
        const accepted = audit.invocations.filter((invocation) => invocation.semanticOutcome === "accepted").length;
        return (
          <DetailSection
            count={`${audit.invocations.length} 次`}
            description={`${audit.providerId} / ${audit.modelId} · ${accepted} 次语义接受`}
            icon={BrainCircuit}
            key={`${audit.role}:${audit.subjectId}`}
            title={`${audit.role} · ${audit.subjectId}`}
          >
            <JsonBlock label="查看调用审计" value={audit} />
          </DetailSection>
        );
      })}
      {detail.committed.modelAudits.length === 0 && <p className="cg-inspector-inline-empty">本轮没有保留模型调用审计。</p>}
      {events.length > 0 && <JsonBlock label={`查看 ${events.length} 条模型运行事件`} value={events} />}
    </div>
  );
}

function AttemptOverview({ detail }: { detail: WorldInspectorAttemptDetail }) {
  return (
    <div className="cg-inspector-detail-stack">
      <header className="cg-inspector-detail-heading">
        <span className="cg-inspector-detail__status" data-status={detail.summary.status}>
          {attemptStatusLabel[detail.summary.status]}
        </span>
        <h3>推演尝试</h3>
        <p><span>{detail.summary.errorMessage ?? detail.summary.latestEvent}</span></p>
        <small>{detail.summary.id}</small>
      </header>
      <dl className="cg-inspector-signal-list">
        <div><dt><Sparkles aria-hidden="true" /><span><strong>运行事件</strong><small>这一尝试保留的阶段记录</small></span></dt><dd>{detail.summary.eventCount} 条</dd></div>
        <div><dt><Bot aria-hidden="true" /><span><strong>模型调用</strong><small>尝试期间发起的模型请求</small></span></dt><dd>{detail.summary.modelInvocationCount} 次</dd></div>
        <div><dt><Clock3 aria-hidden="true" /><span><strong>日志模式</strong><small>决定可查看的 payload 深度</small></span></dt><dd>{detail.trace.mode}</dd></div>
      </dl>
    </div>
  );
}

function DetailBody({ actorId, actorName, detail, tab }: {
  actorId: string;
  actorName: string;
  detail: Detail;
  tab: DetailTab;
}) {
  if (detail.kind === "attempt") {
    if (tab === "overview") return <AttemptOverview detail={detail.value} />;
    if (tab === "changes") {
      return (
        <p className="cg-inspector-inline-empty">
          推演尝试不会单独写入世界状态；请选择对应的 Revision，查看原子提交前后的状态变化。
        </p>
      );
    }
    if (tab === "causality") {
      return (
        <p className="cg-inspector-inline-empty">
          因果复核属于提交后的 Revision；尝试阶段仅保留运行轨迹，不代表已经通过裁决。
        </p>
      );
    }
    if (tab === "model") {
      const events = detail.value.events.filter((event) => event.event.startsWith("model."));
      return events.length > 0
        ? <JsonBlock label={`查看 ${events.length} 条模型事件`} value={events} />
        : <p className="cg-inspector-inline-empty">这次尝试没有保留模型事件。</p>;
    }
    return <JsonBlock label="完整尝试轨迹（Attempt trace）" value={detail.value.events} />;
  }

  const step = detail.value;
  if (tab === "overview") {
    return actorId === "world"
      ? <WorldOverview detail={step} />
      : <ActorOverview actorId={actorId} actorName={actorName} detail={step} />;
  }
  if (tab === "changes") return <StepChanges actorId={actorId} detail={step} />;
  if (tab === "causality") return <Causality detail={step} />;
  if (tab === "model") return <ModelAudit detail={step} />;
  return (
    <div className="cg-inspector-detail-stack">
      <p className="cg-inspector-technical-note">以下是未经归纳的完整技术记录，用于精确核对字段与运行事件。</p>
      <JsonBlock label="完整提交对象（CommittedStep）" value={step.committed} />
      <JsonBlock label="完整运行事件（RuntimeEvent）" value={step.runtimeEvents} />
    </div>
  );
}

export function WorldInspectorDetail({
  actorId,
  actorName,
  detail,
  error,
  loading,
}: {
  actorId: string;
  actorName: string;
  detail?: Detail;
  error?: string;
  loading: boolean;
}) {
  const [tab, setTab] = useState<DetailTab>("overview");
  const moveTabFocus = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    const nextIndex = event.key === "Home"
      ? 0
      : event.key === "End"
        ? tabs.length - 1
        : (index + (event.key === "ArrowLeft" ? -1 : 1) + tabs.length) % tabs.length;
    const next = tabs[nextIndex];
    if (!next) return;
    event.preventDefault();
    setTab(next.id);
    requestAnimationFrame(() => document.getElementById(`world-inspector-tab-${next.id}`)?.focus());
  };

  return (
    <aside className="cg-inspector-detail" aria-label="推演详情">
      <div className="cg-inspector-detail__tabs" aria-label="详情视图" role="tablist">
        {tabs.map((item, index) => {
          const Icon = item.icon;
          return (
            <button
              aria-controls="world-inspector-detail-panel"
              aria-selected={tab === item.id}
              id={`world-inspector-tab-${item.id}`}
              key={item.id}
              onClick={() => setTab(item.id)}
              onKeyDown={(event) => moveTabFocus(event, index)}
              role="tab"
              tabIndex={tab === item.id ? 0 : -1}
              type="button"
            >
              <Icon aria-hidden="true" />
              <span>{item.label}</span>
            </button>
          );
        })}
      </div>
      <div
        aria-labelledby={`world-inspector-tab-${tab}`}
        className="cg-inspector-detail__body"
        id="world-inspector-detail-panel"
        role="tabpanel"
      >
        {loading && <p className="cg-inspector-detail__loading"><LoaderCircle aria-hidden="true" /> 正在读取审计记录…</p>}
        {!loading && error && <p className="cg-inspector-detail__error" role="alert">{error} 请重新选择记录或刷新调试器。</p>}
        {!loading && !error && detail && <DetailBody actorId={actorId} actorName={actorName} detail={detail} tab={tab} />}
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
