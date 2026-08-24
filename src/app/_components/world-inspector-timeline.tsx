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
    const queryMatch = !normalized || `${step.revision} ${step.playerGoal} ${step.contentHash}`
      .toLocaleLowerCase().includes(normalized);
    return actorMatch && queryMatch;
  });
  const visibleAttempts = [...attempts].reverse().filter((attempt) => {
    const queryMatch = !normalized || `${attempt.id} ${attempt.latestEvent} ${attempt.errorMessage ?? ""}`
      .toLocaleLowerCase().includes(normalized);
    return queryMatch;
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
                <span data-status={attempt.status}><Icon aria-hidden="true" /> {attempt.status}</span>
              </span>
              <span className="cg-inspector-log__copy">{attempt.errorMessage ?? attempt.latestEvent}</span>
              <span className="cg-inspector-log__meta">
                <span>step {attempt.step ?? "?"} · run attempt {attempt.runAttempt ?? 1}</span>
                <span>{attempt.eventCount} events</span>
                <span>{attempt.modelInvocationCount} invocations</span>
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
            <span className="cg-inspector-log__copy">{step.playerGoal}</span>
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
