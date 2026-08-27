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
  query: string;
  selectedActorId: string;
  selectedId?: string;
  steps: WorldInspectorStepSummary[];
}) {
  const normalized = query.trim().toLocaleLowerCase();
  const visibleSteps = [...steps].reverse().filter((step) => {
    const actorMatch = selectedActorId === "world" || step.actorIds.includes(selectedActorId);
    const queryMatch = !normalized || `${step.revision} ${step.primaryAction} ${step.contentHash}`
      .toLocaleLowerCase().includes(normalized);
    return actorMatch && queryMatch;
  });
  const visibleAttempts = [...attempts].reverse().filter((attempt) => {
    const actorMatch = selectedActorId === "world" || attempt.actorIds.includes(selectedActorId);
    const queryMatch = !normalized || `${attempt.id} ${attempt.latestEvent} ${attempt.errorMessage ?? ""}`
      .toLocaleLowerCase().includes(normalized);
    return actorMatch && queryMatch;
  });

  return (
    <div className="cg-inspector-timeline" role="feed" aria-label="世界提交时间线">
      {visibleAttempts.map((attempt) => {
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
                <span>{attempt.modelInvocationCount} 次模型调用</span>
                {attempt.rejectionCount > 0 && <span>{attempt.rejectionCount} 次输出拒绝</span>}
              </span>
            </button>
          </article>
        );
      })}
      {visibleSteps.map((step) => (
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
      ))}
      {visibleSteps.length === 0 && visibleAttempts.length === 0 && (
        <div className="cg-inspector-empty">
          <strong>没有匹配的推演记录</strong>
          <span>清除搜索或切换到“整个世界”。</span>
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
