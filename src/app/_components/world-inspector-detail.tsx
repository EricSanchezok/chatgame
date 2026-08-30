"use client";

import {
  Activity,
  AlertTriangle,
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
  RotateCcw,
  Sparkles,
  Users,
  Waypoints,
  Wrench,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import type {
  WorldInspectorAttemptDetail,
  WorldInspectorAttemptStatus,
  WorldInspectorModelInvocationDetail,
  WorldInspectorModelInvocationSummary,
  WorldInspectorNodeSummary,
  WorldInspectorRuntimeEventSummary,
  WorldInspectorStepDetail,
} from "../../shared/world-inspector-api";
import { JsonInspector, RuntimeEventPayload } from "./world-inspector-json";

type Detail =
  | { kind: "step"; value: WorldInspectorStepDetail }
  | { kind: "attempt"; value: WorldInspectorAttemptDetail };

export type WorldInspectorSelection =
  | { kind: "invocation"; id: string; executionId: string }
  | { kind: "attempt"; id: string }
  | { kind: "step"; revision: number }
  | { kind: "node"; id: string }
  | null;
type StepAction = WorldInspectorStepDetail["committed"]["actions"][number];
type StepOutcome = WorldInspectorStepDetail["committed"]["outcomes"][number];

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
  return <JsonInspector label={label} value={value} />;
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
      <p><strong>联合行动</strong><span>{detail.summary.primaryAction}</span></p>
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

function ActionCard({ action, attempted = false, label, outcome, planned = false }: {
  action: StepAction;
  attempted?: boolean;
  label: string;
  outcome?: StepOutcome;
  planned?: boolean;
}) {
  return (
    <section className="cg-inspector-action-card" data-planned={planned || undefined}>
      <header>
        <span><Activity aria-hidden="true" /></span>
        <small>{label}</small>
        <b data-status={attempted ? "failed" : outcome?.status}>
          {attempted ? "未提交" : planned ? "尚未执行" : outcome ? outcomeStatusLabel[outcome.status] : "已提交"}
        </b>
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
      <DetailSection
        count={`${beliefChanges + characterChanges} 项`}
        description="自主策略会通过 AgentMind 写入信念与角色状态；外部策略主体保持不变"
        icon={BrainCircuit}
        title="个体演化"
      >
        <p className="cg-inspector-section__summary">
          {beliefChanges + characterChanges > 0
            ? `${beliefChanges} 项信念变化 · ${characterChanges} 项角色变化`
            : "本轮认知与角色状态没有变化。"}
        </p>
      </DetailSection>
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

const temporalReasonLabel = {
  activity_checkpoint: "活动检查点",
  activity_completion: "活动完成",
  timer: "定时器到期",
  condition_expiry: "条件检查",
  activity_assertion: "活动前提检查",
  safety_horizon: "无人干预推进上限",
} as const;

function formatWorldTime(seconds: number): string {
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor(seconds % 86_400 / 3_600);
  const minutes = Math.floor(seconds % 3_600 / 60);
  const remainder = seconds % 60;
  const clock = [hours, minutes, remainder].map((value) => String(value).padStart(2, "0")).join(":");
  return days > 0 ? `第 ${days} 天 ${clock}` : clock;
}

function TemporalAudit({ actorId, detail }: { actorId: string; detail: WorldInspectorStepDetail }) {
  const { temporalBoundary: boundary } = detail.committed;
  const relevant = (agentId: string) => actorId === "world" || agentId === actorId;
  const plans = detail.committed.temporalPlans.filter((plan) => relevant(plan.actorId));
  const transitions = detail.committed.activityTransitions.filter((transition) => relevant(transition.actorId));
  const decisions = detail.committed.decisionPoints.filter((point) => relevant(point.agentId));
  const dispositions = detail.committed.activityDispositions.filter((entry) => relevant(entry.actorId));
  const resourceAdmissions = detail.committed.sharedResourceAdmissions.filter((admission) => {
    const activity = detail.committed.temporalState.activities[admission.activityId] ??
      detail.before.truth.activities[admission.activityId];
    return activity ? relevant(activity.actorId) : actorId === "world";
  });
  const resourceActivities = Object.values(detail.committed.temporalState.activities)
    .filter((activity) => activity.sharedResourceClaims.length > 0 && relevant(activity.actorId));
  const activitySnapshots = (activities: typeof detail.committed.temporalState.activities) => Object.fromEntries(
    Object.entries(activities).filter(([, activity]) => relevant(activity.actorId)),
  );
  const timerSnapshots = Object.fromEntries(Object.entries(detail.committed.temporalState.timers).filter(([, timer]) =>
    actorId === "world" || timer.wakeAgentIds.includes(actorId)));
  return (
    <div className="cg-inspector-detail-stack">
      <section className="cg-inspector-assurance" data-status="accepted">
        <span><Clock3 aria-hidden="true" /></span>
        <div>
          <strong>动态时间边界 · Δt {boundary.deltaSeconds} 秒</strong>
          <small>{formatWorldTime(boundary.fromElapsedSeconds)} → {formatWorldTime(boundary.toElapsedSeconds)}</small>
        </div>
        <b>引擎提交</b>
      </section>
      <DetailSection
        count={`${boundary.reasons.length} 个`}
        description="引擎选择全部候选中最早的绝对时间；同刻到期项联合裁决"
        icon={Waypoints}
        title="边界来源"
      >
        <ul className="cg-inspector-observation-list">
          {boundary.reasons.map((reason, index) => {
            const subject = reason.kind === "activity_checkpoint" || reason.kind === "activity_completion"
              ? reason.activityId
              : reason.kind === "timer" ? reason.timerId
                : reason.kind === "condition_expiry" ? reason.conditionId : null;
            return <li key={`${reason.kind}:${subject ?? index}`}><Clock3 aria-hidden="true" /><span><strong>{temporalReasonLabel[reason.kind]}</strong><small>{subject ?? "没有更早的活动、定时器或语义事件"}</small></span></li>;
          })}
        </ul>
        <JsonBlock
          label="查看边界与同刻到期集合"
          value={{
            boundary,
            due: {
              activities: boundary.dueActivityIds,
              timers: boundary.dueTimerIds,
              conditions: boundary.dueConditionIds,
            },
          }}
        />
      </DetailSection>
      <DetailSection
        count={`${resourceAdmissions.length} 项`}
        description="内核按剧本策略分配实体资源池，并在提交前重新核对容量与 FIFO 顺序"
        icon={Waypoints}
        title="共享资源分配"
      >
        {resourceAdmissions.length > 0 || resourceActivities.length > 0
          ? <JsonBlock label="查看容量、claims、队列与裁决证据" value={{
              admissions: resourceAdmissions,
              pools: actorId === "world" ? detail.after.truth.sharedActivityResourcePools : undefined,
              activities: resourceActivities,
            }} />
          : <p className="cg-inspector-inline-empty">本次提交没有共享资源竞争。</p>}
      </DetailSection>
      <DetailSection
        count={`${plans.length} 个`}
        description="时间计划在活动开始前预承诺；模型只能选择剧本配置或引用受信任数量"
        icon={BadgeCheck}
        title="本次创建的 TemporalPlan"
      >
        {plans.length > 0
          ? <JsonBlock label="查看计划、依据与资源声明" value={plans} />
          : <p className="cg-inspector-inline-empty">本次提交沿用已有活动，没有创建新的时间计划。</p>}
      </DetailSection>
      <DetailSection
        count={`${transitions.length} 项`}
        description="只记录截至本边界已经真实发生的进度、阶段或终态变化"
        icon={Activity}
        title="活动转换"
      >
        {transitions.length > 0
          ? <JsonBlock label="查看活动转换" value={transitions} />
          : <p className="cg-inspector-inline-empty">当前视角没有活动转换。</p>}
      </DetailSection>
      <DetailSection
        count={`${dispositions.length} 项`}
        description="每个到期或受影响的持续 Activity 都必须得到明确结论"
        icon={Waypoints}
        title="ActivityDisposition"
      >
        {dispositions.length > 0
          ? <JsonBlock label="查看结论与断言证据" value={dispositions} />
          : <p className="cg-inspector-inline-empty">当前视角没有需要结算的持续 Activity。</p>}
      </DetailSection>
      <DetailSection
        count={`${detail.interaction.dependencies.length} 个节点`}
        description="Action、Activity、Timer 与 Condition 按读写和受众依赖组成冲突分量"
        icon={Waypoints}
        title="交互依赖图"
      >
        <JsonBlock label="查看依赖、分量与全局重裁决" value={detail.interaction} />
      </DetailSection>
      <DetailSection
        count={`${decisions.length} 个`}
        description="只有这些主体在该边界重新获得行动或 AgentMind 资格"
        icon={BrainCircuit}
        title="新决策点"
      >
        {decisions.length > 0
          ? <JsonBlock label="查看决策资格" value={decisions} />
          : <p className="cg-inspector-inline-empty">本边界没有为当前视角打开新的决策窗口。</p>}
      </DetailSection>
      <JsonBlock
        label="核对活动、定时器的提交前后快照"
        value={{
          before: {
            activities: activitySnapshots(detail.before.truth.activities),
            timers: Object.fromEntries(Object.entries(detail.before.truth.timers).filter(([, timer]) =>
              actorId === "world" || timer.wakeAgentIds.includes(actorId))),
          },
          committed: {
            activities: activitySnapshots(detail.committed.temporalState.activities),
            timers: timerSnapshots,
          },
          after: {
            activities: activitySnapshots(detail.after.truth.activities),
            timers: Object.fromEntries(Object.entries(detail.after.truth.timers).filter(([, timer]) =>
              actorId === "world" || timer.wakeAgentIds.includes(actorId))),
          },
        }}
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
      title: "裁决计划与收据",
      description: "随机前固定的语义依据与确定性数值结算",
      icon: Braces,
      count: detail.committed.resolutionPlans.length + detail.committed.resolutionReceipts.length,
      value: {
        plans: detail.committed.resolutionPlans,
        receipts: detail.committed.resolutionReceipts,
      },
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

function formatDuration(durationMs: number | undefined): string {
  if (durationMs === undefined) return "未记录";
  if (durationMs < 1_000) return `${durationMs} ms`;
  if (durationMs < 60_000) return `${(durationMs / 1_000).toFixed(durationMs < 10_000 ? 1 : 0)} 秒`;
  return `${Math.floor(durationMs / 60_000)} 分 ${Math.round(durationMs % 60_000 / 1_000)} 秒`;
}

function formatNumber(value: number | null | undefined): string {
  return value === null || value === undefined ? "—" : value.toLocaleString();
}

function statusLabel(status: WorldInspectorModelInvocationDetail["status"]): string {
  return status === "accepted" ? "语义接受" : status === "rejected" ? "输出拒绝" : status === "failed" ? "调用失败" : "进行中";
}

function RuntimeEventRows({ events, instanceId }: {
  events: WorldInspectorRuntimeEventSummary[];
  instanceId: string;
}) {
  return (
    <div className="cg-runtime-events">
      {events.map((event) => (
        <details className="cg-runtime-event" key={event.id}>
          <summary>
            <span data-level={event.level}>{event.level}</span>
            <strong>{event.event}</strong>
            <small>{new Date(event.timestamp).toLocaleTimeString()}</small>
          </summary>
          <div className="cg-runtime-event__body">
            <JsonInspector label="事件信封" value={event} />
            <RuntimeEventPayload event={event} instanceId={instanceId} />
          </div>
        </details>
      ))}
    </div>
  );
}

function RuntimeEventList({ events, label, instanceId }: {
  events: WorldInspectorRuntimeEventSummary[];
  label: string;
  instanceId: string;
}) {
  const [filter, setFilter] = useState<"all" | "errors" | "model">("all");
  const filtered = events.filter((event) => filter === "all" || (filter === "errors"
    ? event.level === "error" || event.level === "warn"
    : event.event.startsWith("model.")));
  return (
    <section className="cg-runtime-event-list" aria-label={label}>
      <header>
        <strong>{label}</strong>
        <span>{filtered.length} / {events.length}</span>
      </header>
      <div className="cg-runtime-event-filters" aria-label="运行事件筛选">
        <button aria-pressed={filter === "all"} onClick={() => setFilter("all")} type="button">全部</button>
        <button aria-pressed={filter === "errors"} onClick={() => setFilter("errors")} type="button">警告与错误</button>
        <button aria-pressed={filter === "model"} onClick={() => setFilter("model")} type="button">模型</button>
      </div>
      {filtered.length > 0
        ? <RuntimeEventRows events={filtered} instanceId={instanceId} />
        : <p className="cg-inspector-inline-empty">当前筛选下没有运行事件。</p>}
    </section>
  );
}

function DetailGroup({
  children,
  description,
  icon: Icon,
  open = true,
  title,
}: {
  children: ReactNode;
  description: string;
  icon: typeof Activity;
  open?: boolean;
  title: string;
}) {
  return (
    <details className="cg-inspector-detail-group" open={open}>
      <summary>
        <span className="cg-inspector-detail-group__icon"><Icon aria-hidden="true" /></span>
        <span><strong>{title}</strong><small>{description}</small></span>
      </summary>
      <div className="cg-inspector-detail-group__body">{children}</div>
    </details>
  );
}

function RelatedInvocationList({
  invocations,
  onSelectInvocation,
}: {
  invocations: readonly WorldInspectorModelInvocationSummary[];
  onSelectInvocation?: (invocation: WorldInspectorModelInvocationSummary) => void;
}) {
  if (invocations.length === 0) {
    return <p className="cg-inspector-inline-empty">当前记录没有可跳转的模型调用。</p>;
  }
  return (
    <div className="cg-inspector-related-invocations">
      {invocations.map((invocation) => (
        <button
          className="cg-inspector-related-invocation"
          disabled={!onSelectInvocation}
          key={invocation.id}
          onClick={() => onSelectInvocation?.(invocation)}
          type="button"
        >
          <span><strong>Invocation {invocation.ordinal || "?"}</strong><small>{invocation.role ?? "模型调用"}</small></span>
          <span><small>{invocation.providerId ?? "未知 provider"} / {invocation.modelId ?? "未知 model"}</small><b data-status={invocation.status}>{statusLabel(invocation.status)}</b></span>
          <span aria-hidden="true">{onSelectInvocation ? "在调用视图打开 →" : ""}</span>
        </button>
      ))}
    </div>
  );
}

function GraphRelationList({ items, label }: { items: readonly WorldInspectorNodeSummary[]; label: string }) {
  return items.length > 0
    ? <ul className="cg-inspector-observation-list" aria-label={label}>{items.map((item) => (
        <li key={item.id}><strong>{item.label}</strong><small>{item.description} · {item.kind}</small></li>
      ))}</ul>
    : <p className="cg-inspector-inline-empty">没有记录。</p>;
}

function GraphNodeDetail({
  downstream,
  node,
  onSelectInvocation,
  relatedInvocation,
  upstream,
}: {
  downstream: readonly WorldInspectorNodeSummary[];
  node: WorldInspectorNodeSummary;
  onSelectInvocation?: (invocation: WorldInspectorModelInvocationSummary) => void;
  relatedInvocation?: WorldInspectorModelInvocationSummary;
  upstream: readonly WorldInspectorNodeSummary[];
}) {
  return (
    <div className="cg-inspector-detail-stack">
      <header className="cg-inspector-detail-heading">
        {node.status && <span className="cg-inspector-detail__status" data-status={node.status}>{node.status}</span>}
        <h3>{node.label}</h3>
        <p><strong>{node.kind}</strong><span>{node.description}</span></p>
        <small title={node.id}>{node.id} · Revision {node.revision}</small>
      </header>
      <dl className="cg-inspector-invocation-detail__facts">
        <div><dt>归属 lane</dt><dd>{node.laneId}</dd></div>
        <div><dt>关联 Agent</dt><dd>{node.relatedActorIds?.join("、") || "—"}</dd></div>
        <div><dt>上游节点</dt><dd>{upstream.length}</dd></div>
        <div><dt>下游节点</dt><dd>{downstream.length}</dd></div>
      </dl>
      <DetailSection count={`${upstream.length} 个`} description="形成当前节点的前置证据" icon={Link2} title="上游关系">
        <GraphRelationList items={upstream} label="上游节点" />
      </DetailSection>
      <DetailSection count={`${downstream.length} 个`} description="由当前节点继续产生的证据" icon={Waypoints} title="下游关系">
        <GraphRelationList items={downstream} label="下游节点" />
      </DetailSection>
      {relatedInvocation && (
        <DetailSection count="1 次" description="该节点关联的完整模型调用" icon={BrainCircuit} title="关联模型调用">
          <RelatedInvocationList invocations={[relatedInvocation]} onSelectInvocation={onSelectInvocation} />
        </DetailSection>
      )}
      <JsonBlock label="查看节点原始 JSON" value={node} />
    </div>
  );
}

function AttemptOverview({ actorId, actorName, detail }: {
  actorId: string;
  actorName: string;
  detail: WorldInspectorAttemptDetail;
}) {
  const action = detail.attemptedActions.find((candidate) => candidate.actorId === actorId);
  const directlyRelated = detail.summary.relatedActorIds.includes(actorId);
  return (
    <div className="cg-inspector-detail-stack">
      <header className="cg-inspector-detail-heading">
        <span className="cg-inspector-detail__status" data-status={detail.summary.status}>
          {attemptStatusLabel[detail.summary.status]}
        </span>
        <h3>{detail.summary.failureStageLabel ? `${detail.summary.failureStageLabel}未通过` : "推演尝试"}</h3>
        <p><strong>失败原因</strong><span>{detail.summary.errorMessage ?? detail.summary.latestEvent}</span></p>
        <small>{detail.summary.id}</small>
      </header>
      <section className="cg-inspector-failure-card">
        <span><AlertTriangle aria-hidden="true" /></span>
        <div>
          <strong>世界状态没有提交</strong>
          <small>
            {detail.summary.rejectionCount > 0
              ? `${detail.summary.rejectionCount} 次输出均未通过语义校验，包含 ${detail.summary.repairCount} 次修复。`
              : "尝试在原子提交前终止。"}
          </small>
        </div>
        <b>{detail.summary.rollbackVerified ? "回滚已验证" : "未产生 Revision"}</b>
      </section>
      <dl className="cg-inspector-signal-list">
        <div><dt><Sparkles aria-hidden="true" /><span><strong>运行事件</strong><small>这一尝试保留的阶段记录</small></span></dt><dd>{detail.summary.eventCount} 条</dd></div>
        <div><dt><Bot aria-hidden="true" /><span><strong>模型调用</strong><small>尝试期间发起的模型请求</small></span></dt><dd>{detail.summary.modelInvocationCount} 次</dd></div>
        <div><dt><Clock3 aria-hidden="true" /><span><strong>尝试耗时</strong><small>从 step 开始到真实终止边界</small></span></dt><dd>{formatDuration(detail.summary.durationMs)}</dd></div>
      </dl>
      {actorId !== "world" && (
        <DetailSection
          description={directlyRelated
            ? "失败链中的结构化模型输出直接引用了该主体"
            : "该主体参与了联合尝试，但不是当前失败的直接关联主体"}
          icon={Activity}
          title={`${actorName}的尝试视角`}
        >
          {action
            ? <ActionCard action={action} attempted label="拟议行动" />
            : <p className="cg-inspector-inline-empty">这次尝试没有保留该主体的拟议行动。</p>}
        </DetailSection>
      )}
    </div>
  );
}

function AttemptChanges({ detail }: { detail: WorldInspectorAttemptDetail }) {
  const revision = detail.summary.revision ?? 0;
  return (
    <div className="cg-inspector-detail-stack">
      <section className="cg-inspector-assurance" data-status="accepted">
        <span><RotateCcw aria-hidden="true" /></span>
        <div>
          <strong>零项状态写入</strong>
          <small>失败尝试没有进入 canonical history，也没有生成新的 Revision。</small>
        </div>
        <b>R{revision} → R{revision}</b>
      </section>
      <dl className="cg-inspector-change-summary">
        <div><dt>Canonical 操作</dt><dd>0</dd></div>
        <div><dt>世界事件</dt><dd>0</dd></div>
        <div><dt>认知写入</dt><dd>0</dd></div>
      </dl>
      <DetailSection
        count={detail.summary.rollbackVerified ? "已验证" : "未记录"}
        description="对比尝试开始与回滚终点记录的状态 hash"
        icon={BadgeCheck}
        title="回滚完整性"
      >
        <p className="cg-inspector-section__summary">
          {detail.summary.rollbackVerified
            ? "开始与终止状态 hash 一致，事务回滚保持了原世界状态。"
            : "当前 trace 没有同时保留可比较的起止状态 hash；Revision 仍未递增。"}
        </p>
      </DetailSection>
    </div>
  );
}

function AttemptCausality({ detail }: { detail: WorldInspectorAttemptDetail }) {
  return (
    <div className="cg-inspector-detail-stack">
      <header className="cg-inspector-model-summary">
        <span><Link2 aria-hidden="true" /></span>
        <div>
          <strong>推演停在{detail.summary.failureStageLabel ?? "提交前阶段"}</strong>
          <small>下列阶段来自同一 attempt 的结构化运行事件。</small>
        </div>
      </header>
      <ol className="cg-attempt-stages" aria-label="推演阶段">
        {detail.stages.map((stage, index) => (
          <li data-status={stage.status} key={stage.id}>
            <span>{stage.status === "failed" ? <AlertTriangle aria-hidden="true" /> : <Check aria-hidden="true" />}</span>
            <div>
              <small>阶段 {index + 1}</small>
              <strong>{stage.label}</strong>
              <p>{stage.errorMessage ?? (stage.status === "failed"
                ? "阶段未通过"
                : stage.status === "active" ? "阶段仍在运行" : "阶段完成")}</p>
            </div>
            <b>{stage.rejectionCount > 0 ? `${stage.rejectionCount} 次拒绝` : `${stage.eventCount} 条事件`}</b>
          </li>
        ))}
      </ol>
    </div>
  );
}

function ModelInvocationDetailPanel({
  instanceId,
  invocation,
}: {
  instanceId: string;
  invocation: WorldInspectorModelInvocationDetail;
}) {
  const eventById = new Map(invocation.eventSummaries.map((event) => [event.id, event]));
  const payloadEvent = (id: string | undefined) => id ? eventById.get(id) : undefined;
  const contextEvent = payloadEvent(invocation.payloadEventIds.context);
  const requestEvent = payloadEvent(invocation.payloadEventIds.request);
  const responseEvent = payloadEvent(invocation.payloadEventIds.response);
  const outputEvent = payloadEvent(invocation.payloadEventIds.output);
  return (
    <section className="cg-inspector-invocation-detail" aria-label="选中模型调用详情">
      <header className="cg-inspector-detail-heading">
        <span className="cg-inspector-detail__status" data-status={invocation.status}>{statusLabel(invocation.status)}</span>
        <h3>Invocation {invocation.ordinal || "?"}</h3>
        <p><strong>{invocation.role ?? "模型调用"}</strong><span>{invocation.providerId ?? "未知 provider"} / {invocation.modelId ?? "未知 model"}</span></p>
        <small title={invocation.id}>public id · {invocation.id}</small>
      </header>
      <dl className="cg-inspector-invocation-detail__facts">
        <div><dt>Agent / slot</dt><dd>{invocation.slotRefs.length} 个</dd></div>
        <div><dt>输入 token</dt><dd>{formatNumber(invocation.tokenUsage.input)}</dd></div>
        <div><dt>输出 token</dt><dd>{formatNumber(invocation.tokenUsage.output)}</dd></div>
        <div><dt>reasoning token</dt><dd>{formatNumber(invocation.tokenUsage.reasoning)}</dd></div>
        <div><dt>cache token</dt><dd>{formatNumber(invocation.tokenUsage.cacheRead)} / {formatNumber(invocation.tokenUsage.cacheWrite)}</dd></div>
        <div><dt>请求 / 上下文 / 响应</dt><dd>{formatNumber(invocation.requestUtf8Bytes)} / {formatNumber(invocation.contextUtf8Bytes)} / {formatNumber(invocation.responseUtf8Bytes)} B</dd></div>
        <div><dt>调用 / queue / transport</dt><dd>{formatDuration(invocation.timings.invocationMs)} / {formatDuration(invocation.timings.queueWaitMs)} / {formatDuration(invocation.timings.transportMs)}</dd></div>
        <div><dt>parse / retry wait</dt><dd>{formatDuration(invocation.timings.parseMs)} / {formatDuration(invocation.timings.retryDelayMs)}</dd></div>
        <div><dt>profile / prompt</dt><dd>{invocation.profileId ?? "—"} / {invocation.promptVersion ?? "—"}</dd></div>
        <div><dt>schema</dt><dd>{invocation.schemaName ?? "—"}</dd></div>
      </dl>
      <DetailSection count={`${invocation.transportAttempts.length} 次`} description="同一逻辑调用的物理请求与重试" icon={RotateCcw} title="Transport attempts">
        <div className="cg-inspector-record-list">
          {invocation.transportAttempts.map((transport) => (
            <div className="cg-inspector-transport-detail" key={`${invocation.id}:${transport.attempt}`}>
              <strong>Transport {transport.attempt} · {transport.status}</strong>
              <span>queue {formatDuration(transport.queueWaitMs)} · execution {formatDuration(transport.executionMs)} · retry wait {formatDuration(transport.retryDelayMs)}</span>
              {transport.errorName && <small>{transport.errorName}</small>}
            </div>
          ))}
        </div>
      </DetailSection>
      <DetailSection count={`${invocation.slotRefs.length} 个`} description="每个 slot 的 Agent、action 和原始标签" icon={Users} title="Agent / slot 映射">
        {invocation.slotRefs.length > 0
          ? <div className="cg-inspector-slot-table-wrap"><table className="cg-inspector-slot-table"><thead><tr><th scope="col">slot</th><th scope="col">Agent</th><th scope="col">actionId</th><th scope="col">label</th></tr></thead><tbody>{invocation.slotRefs.map((slot) => (
            <tr key={`${slot.slot}:${slot.agentId ?? "unresolved"}`}><td>{slot.slot}</td><td><code>{slot.agentId ?? "未解析"}</code></td><td><code>{slot.actionId ?? "—"}</code></td><td>{slot.label ?? slot.unresolvedReason ?? "—"}</td></tr>
          ))}</tbody></table></div>
          : <p className="cg-inspector-inline-empty">没有可解析的 slot 映射。</p>}
      </DetailSection>
      <DetailSection count={`${invocation.contextSections.length} 段`} description="每段来自实际发送的单次上下文" icon={Braces} title="上下文分段">
        {invocation.contextSections.length > 0
          ? <div className="cg-inspector-record-list">{invocation.contextSections.map((section) => (
              <div className="cg-inspector-context-section" key={section.key}>
                <strong>{section.key}</strong><span>{formatNumber(section.utf8Bytes)} B · {section.itemCount ?? "—"} 项</span><code>{section.hash ?? "无 hash"}</code>
              </div>
            ))}</div>
          : <p className="cg-inspector-inline-empty">没有可解析的上下文分段。</p>}
        <JsonBlock label="查看 slot 映射原始 JSON" value={invocation.slotRefs} />
      </DetailSection>
      {invocation.validationIssueCodes.length > 0 && <DetailSection count={`${invocation.validationIssueCodes.length} 项`} description="引擎实际记录的校验问题" icon={AlertTriangle} title="校验结果">
        <ul className="cg-inspector-observation-list">{invocation.validationIssueCodes.map((code) => <li key={code}>{code}</li>)}</ul>
        {invocation.errorMessage && <p className="cg-model-invocation__error">{invocation.errorMessage}</p>}
      </DetailSection>}
      <div className="cg-inspector-invocation-payloads">
        {contextEvent && <section><strong>上下文原文</strong><RuntimeEventPayload event={contextEvent} instanceId={instanceId} /></section>}
        {requestEvent && <section><strong>原始请求</strong><RuntimeEventPayload event={requestEvent} instanceId={instanceId} /></section>}
        {responseEvent && <section><strong>原始响应</strong><RuntimeEventPayload event={responseEvent} instanceId={instanceId} /></section>}
        {outputEvent && <section><strong>结构化输出</strong><RuntimeEventPayload event={outputEvent} instanceId={instanceId} /></section>}
      </div>
      <RuntimeEventList events={invocation.eventSummaries} label="调用关联事件" instanceId={instanceId} />
    </section>
  );
}

function DetailBody({ actorId, actorName, detail, instanceId, onSelectInvocation }: {
  actorId: string;
  actorName: string;
  detail: Detail;
  instanceId: string;
  onSelectInvocation?: (invocation: WorldInspectorModelInvocationSummary) => void;
}) {
  if (detail.kind === "attempt") {
    return (
      <div className="cg-inspector-detail-stack">
        <AttemptOverview actorId={actorId} actorName={actorName} detail={detail.value} />
        <DetailGroup description="失败尝试没有推进世界时间，以下是时间边界证据" icon={Clock3} title="时间证据" open={false}>
          <section className="cg-inspector-assurance" data-status="accepted">
            <span><Clock3 aria-hidden="true" /></span>
            <div><strong>世界时间没有推进</strong><small>attempt 未形成原子提交，canonical clock 与活动进度保持最近成功 Revision。</small></div>
            <b>Δt 0</b>
          </section>
          <RuntimeEventList events={detail.value.events} label="未提交尝试的时间证据" instanceId={instanceId} />
        </DetailGroup>
        <DetailGroup description="失败尝试没有写入 canonical truth" icon={GitCompareArrows} title="状态变更" open={false}>
          <AttemptChanges detail={detail.value} />
        </DetailGroup>
        <DetailGroup description="阶段、拒绝和修复构成的失败链" icon={Link2} title="因果证据">
          <AttemptCausality detail={detail.value} />
        </DetailGroup>
        <DetailGroup description="本次尝试涉及的模型调用，可切换到调用视图查看详情" icon={BrainCircuit} title="相关模型调用">
          <RelatedInvocationList invocations={detail.value.modelInvocations} onSelectInvocation={onSelectInvocation} />
        </DetailGroup>
        <DetailGroup description="仅在需要核对原始事件时展开" icon={Braces} title="原始运行事件" open={false}>
          <RuntimeEventList events={detail.value.events} label="完整尝试轨迹" instanceId={instanceId} />
        </DetailGroup>
      </div>
    );
  }

  const step = detail.value;
  return (
    <div className="cg-inspector-detail-stack">
      {actorId === "world"
        ? <WorldOverview detail={step} />
        : <ActorOverview actorId={actorId} actorName={actorName} detail={step} />}
      <DetailGroup description="引擎选择的下一个世界时间边界与同刻活动" icon={Clock3} title="世界时间" open={false}>
        <TemporalAudit actorId={actorId} detail={step} />
      </DetailGroup>
      <DetailGroup description="这次提交写入 canonical truth 的状态操作" icon={GitCompareArrows} title="状态变更">
        <StepChanges actorId={actorId} detail={step} />
      </DetailGroup>
      <DetailGroup description="反应、检定、随机和机制如何共同形成结果" icon={Link2} title="因果证据">
        <Causality detail={step} />
      </DetailGroup>
      <DetailGroup description="本次提交涉及的模型调用，可切换到调用视图查看详情" icon={BrainCircuit} title="相关模型调用">
        <RelatedInvocationList invocations={step.modelInvocations} onSelectInvocation={onSelectInvocation} />
      </DetailGroup>
      <DetailGroup description="仅在需要核对字段和运行事件时展开" icon={Braces} title="原始提交记录" open={false}>
        <p className="cg-inspector-technical-note">以下是未经归纳的完整技术记录，用于精确核对字段与运行事件。</p>
        <JsonBlock label="完整提交对象（CommittedStep）" value={step.committed} />
        <RuntimeEventList events={step.runtimeEvents} label="完整运行事件" instanceId={instanceId} />
      </DetailGroup>
    </div>
  );
}

export function WorldInspectorDetail({
  actorId,
  actorName,
  detail,
  error,
  invocation,
  node,
  nodeRelations,
  loading,
  onSelectInvocation,
  instanceId,
  selection,
}: {
  actorId: string;
  actorName: string;
  detail?: Detail;
  error?: string;
  invocation?: WorldInspectorModelInvocationDetail;
  node?: WorldInspectorNodeSummary;
  nodeRelations?: { upstream: readonly WorldInspectorNodeSummary[]; downstream: readonly WorldInspectorNodeSummary[] };
  loading: boolean;
  onSelectInvocation?: (invocation: WorldInspectorModelInvocationSummary) => void;
  instanceId: string;
  selection: WorldInspectorSelection;
}) {
  return (
    <aside className="cg-inspector-detail" aria-label="推演详情">
      <div className="cg-inspector-detail__body" id="world-inspector-detail-panel" tabIndex={0}>
        {loading && <p className="cg-inspector-detail__loading"><LoaderCircle aria-hidden="true" /> 正在读取审计记录…</p>}
        {!loading && error && <p className="cg-inspector-detail__error" role="alert">{error} 请重新选择记录或刷新调试器。</p>}
        {!loading && !error && selection?.kind === "invocation" && invocation && <ModelInvocationDetailPanel instanceId={instanceId} invocation={invocation} />}
        {!loading && !error && selection?.kind === "node" && node && (
          <GraphNodeDetail
            downstream={nodeRelations?.downstream ?? []}
            node={node}
            onSelectInvocation={onSelectInvocation}
            relatedInvocation={(detail?.kind === "attempt" || detail?.kind === "step")
              ? detail.value.modelInvocations.find((candidate) => candidate.id === node.relatedInvocationId)
              : undefined}
            upstream={nodeRelations?.upstream ?? []}
          />
        )}
        {!loading && !error && selection?.kind === "node" && !node && (
          <div className="cg-inspector-empty"><strong>节点已从当前窗口移出</strong><span>请重新选择图谱节点或回到最新记录。</span></div>
        )}
        {!loading && !error && selection?.kind !== "invocation" && selection?.kind !== "node" && detail && (
          <DetailBody actorId={actorId} actorName={actorName} detail={detail} instanceId={instanceId} onSelectInvocation={onSelectInvocation} />
        )}
        {!loading && !error && !selection && (
          <div className="cg-inspector-empty">
            <strong>选择一条推演记录</strong>
            <span>这里会显示状态差异、因果审计和模型记录。</span>
          </div>
        )}
      </div>
    </aside>
  );
}
