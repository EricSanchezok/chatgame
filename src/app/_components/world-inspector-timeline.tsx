"use client";

import {
  AlertTriangle,
  Check,
  CircleDotDashed,
  GitCommitHorizontal,
  LoaderCircle,
} from "lucide-react";
import type {
  WorldInspectorAttemptSummary,
  WorldInspectorStepSummary,
} from "../../shared/world-inspector-api";

const attemptStatusLabel = {
  active: "推演中",
  cancelled: "已取消",
  committed: "已提交",
  failed: "失败",
  rolled_back: "已回滚",
} as const;

type TimelineEntry =
  | { kind: "attempt"; value: WorldInspectorAttemptSummary }
  | { kind: "step"; value: WorldInspectorStepSummary };

function formatDuration(durationMs: number | undefined): string | undefined {
  if (durationMs === undefined) return undefined;
  if (durationMs < 1_000) return `${durationMs} ms`;
  if (durationMs < 60_000) return `${(durationMs / 1_000).toFixed(durationMs < 10_000 ? 1 : 0)} 秒`;
  return `${Math.floor(durationMs / 60_000)} 分 ${Math.round(durationMs % 60_000 / 1_000)} 秒`;
}

export function WorldInspectorTimeline({
  attempts,
  hasOlder,
  loadingOlder,
  onLoadOlder,
  onSelectAttempt,
  onSelectStep,
  onReplay,
  query,
  selectedActorId,
  selectedId,
  steps,
}: {
  attempts: WorldInspectorAttemptSummary[];
  hasOlder: boolean;
  loadingOlder: boolean;
  onLoadOlder: () => void;
  onSelectAttempt: (attempt: WorldInspectorAttemptSummary) => void;
  onSelectStep: (step: WorldInspectorStepSummary) => void;
  onReplay: (attempt: WorldInspectorAttemptSummary) => void;
  query: string;
  selectedActorId: string;
  selectedId?: string;
  steps: WorldInspectorStepSummary[];
}) {
  const normalized = query.trim().toLocaleLowerCase();
  const visibleEntries = [
    ...steps
      .filter((step) => {
        const actorMatch = selectedActorId === "world" || step.actorIds.includes(selectedActorId);
        const queryMatch = !normalized || `${step.revision} ${step.primaryAction} ${step.contentHash}`
          .toLocaleLowerCase().includes(normalized);
        return actorMatch && queryMatch;
      })
      .map((step): TimelineEntry => ({ kind: "step", value: step })),
    ...attempts
      .filter((attempt) => {
        const actorMatch = selectedActorId === "world" || attempt.actorIds.includes(selectedActorId);
        const queryMatch = !normalized || `${attempt.id} ${attempt.latestEvent} ${attempt.errorMessage ?? ""}`
          .toLocaleLowerCase().includes(normalized);
        return actorMatch && queryMatch;
      })
      .map((attempt): TimelineEntry => ({ kind: "attempt", value: attempt })),
  ].sort((left, right) => {
    const updatedAt = (entry: TimelineEntry) => Date.parse(entry.kind === "attempt"
      ? entry.value.updatedAt
      : "");
    const leftTime = updatedAt(left);
    const rightTime = updatedAt(right);
    if (Number.isFinite(leftTime) && Number.isFinite(rightTime) && leftTime !== rightTime) {
      return rightTime - leftTime;
    }
    const boundary = (entry: TimelineEntry) => entry.kind === "step"
      ? entry.value.revision
      : entry.value.revision ?? entry.value.step ?? -1;
    const boundaryDelta = boundary(right) - boundary(left);
    if (boundaryDelta !== 0) return boundaryDelta;
    if (left.kind !== right.kind) return left.kind === "attempt" ? -1 : 1;
    if (left.kind === "attempt" && right.kind === "attempt") {
      return Date.parse(right.value.startedAt) - Date.parse(left.value.startedAt) || right.value.id.localeCompare(left.value.id);
    }
    if (left.kind === "step" && right.kind === "step") return right.value.revision - left.value.revision;
    return 0;
  });

  return (
    <div className="cg-inspector-timeline" role="feed" aria-label="世界演化流程">
      {visibleEntries.map((entry) => {
        if (entry.kind === "attempt") {
          const attempt = entry.value;
          const active = attempt.status === "active";
          const Icon = active ? LoaderCircle : attempt.status === "committed" ? Check : AlertTriangle;
          return (
          <article className="cg-inspector-log cg-inspector-log--attempt" key={attempt.id}>
            <span className="cg-inspector-log__rail" aria-hidden="true"><CircleDotDashed /></span>
            <button
              aria-pressed={selectedId === `attempt:${attempt.id}`}
              onClick={() => onSelectAttempt(attempt)}
              type="button"
            >
              <span className="cg-inspector-log__heading">
                <strong>{active ? "正在推演" : attempt.status === "committed" ? "已提交的尝试" : "未提交的尝试"}</strong>
                <span data-status={attempt.status}><Icon aria-hidden="true" /> {attemptStatusLabel[attempt.status]}</span>
              </span>
              <span className="cg-inspector-log__copy">{attempt.errorMessage ?? attempt.latestEvent}</span>
              <span className="cg-inspector-log__meta">
                <span>Step {attempt.step ?? "?"} · 第 {attempt.advanceAttempt ?? 1} 次推进</span>
                {attempt.failureStageLabel && <span>{attempt.failureStageLabel}</span>}
                {formatDuration(attempt.durationMs) && <span>{formatDuration(attempt.durationMs)}</span>}
                <span>{attempt.eventCount} 条事件</span>
                <span>{attempt.modelInvocationCount} 次逻辑调用</span>
                <span>{attempt.transportAttemptCount} 次物理尝试</span>
                <span>{attempt.retryCount} 次 retry</span>
                {attempt.rejectionCount > 0 && <span>{attempt.rejectionCount} 次输出拒绝</span>}
                <span>{attempt.tokenUsage.unknown ? "部分 token 未知" : `输入 ${attempt.tokenUsage.input} · 输出 ${attempt.tokenUsage.output} tokens`}</span>
              </span>
            </button>
            <button className="cg-inspector-log__replay" onClick={(event) => { event.stopPropagation(); onReplay(attempt); }} type="button">回放</button>
            {attempt.stages.length > 0 && (
              <details className="cg-inspector-timeline__stages" onClick={(event) => event.stopPropagation()}>
                <summary>查看 {attempt.stages.length} 个阶段</summary>
                <ol>
                  {attempt.stages.map((stage) => (
                    <li data-status={stage.status} key={stage.id}>
                      <span>{stage.label}</span>
                      <small>{stage.modelInvocationCount} 次调用 · {stage.eventCount} 条事件{stage.rejectionCount > 0 ? ` · ${stage.rejectionCount} 次拒绝` : ""}</small>
                    </li>
                  ))}
                </ol>
              </details>
            )}
          </article>
          );
        }
        const step = entry.value;
        return (
          <article className="cg-inspector-log" key={step.revision}>
            <span className="cg-inspector-log__rail" aria-hidden="true"><GitCommitHorizontal /></span>
            <button
              aria-pressed={selectedId === `commit:${step.revision}`}
              onClick={() => onSelectStep(step)}
              type="button"
            >
              <span className="cg-inspector-log__heading">
                <strong>Revision {step.revision}</strong>
                <span data-status="committed"><Check aria-hidden="true" /> committed</span>
              </span>
              <span className="cg-inspector-log__copy">{step.primaryAction}</span>
              <span className="cg-inspector-log__meta">
                <span>{step.contentHash.slice(0, 15)}</span>
                <span>{step.actorIds.join(" + ") || "world"}</span>
                <span>{step.counts.actions} actions</span>
                <span>{step.counts.operations} changes</span>
                <span>world {step.elapsedSeconds}s</span>
                <span>{step.tokenUsage.unknown ? "部分 token 未知" : `${step.tokenUsage.total} tokens`}</span>
              </span>
            </button>
          </article>
        );
      })}
      {visibleEntries.length === 0 && (
        <div className="cg-inspector-empty">
          <strong>{steps.length === 0 && attempts.length > 0 && !normalized ? `暂无已提交 Revision；当前有 ${attempts.length} 次未提交尝试` : "没有匹配的推演记录"}</strong>
          <span>{steps.length === 0 && attempts.length > 0 && !normalized ? "失败尝试也会按阶段显示；打开调用清单查看物理证据。" : "清除搜索或切换到“整个世界”。"}</span>
        </div>
      )}
      {hasOlder && (
        <button className="cg-inspector-load-older" disabled={loadingOlder} onClick={onLoadOlder} type="button">
          {loadingOlder ? "正在读取更早记录…" : "加载更早记录"}
        </button>
      )}
    </div>
  );
}
