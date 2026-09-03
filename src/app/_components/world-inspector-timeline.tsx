"use client";

import {
  Play,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type {
  WorldInspectorAttemptSummary,
  WorldInspectorStepSummary,
  WorldInspectorWindow,
} from "../../shared/world-inspector-api";
import { formatInspectorFailureSummary } from "../_lib/world-inspector-copy";

const attemptStatusLabel = {
  active: "进行中",
  cancelled: "已取消",
  committed: "已完成",
  failed: "失败",
  rolled_back: "已回滚",
} as const;

type TimelineEntry =
  | { kind: "attempt"; value: WorldInspectorAttemptSummary }
  | { kind: "step"; value: WorldInspectorStepSummary };

type TimelineRow =
  | { kind: "boundary"; key: string; boundary: number | undefined; count: number }
  | { kind: "entry"; key: string; entry: TimelineEntry };

type InspectorRun = WorldInspectorWindow["instance"]["run"];

function formatDuration(durationMs: number | undefined): string | undefined {
  if (durationMs === undefined) return undefined;
  if (durationMs < 1_000) return `${durationMs} 毫秒`;
  if (durationMs < 60_000) return `${(durationMs / 1_000).toFixed(durationMs < 10_000 ? 1 : 0)} 秒`;
  return `${Math.floor(durationMs / 60_000)} 分 ${Math.round(durationMs % 60_000 / 1_000)} 秒`;
}

function shortId(value: string): string {
  return value.length > 14 ? `${value.slice(0, 8)}…${value.slice(-4)}` : value;
}

function formatTimestamp(value: string | undefined): string {
  if (!value) return "—";
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(timestamp);
}

function eventPurpose(attempt: WorldInspectorAttemptSummary): string {
  if (attempt.status !== "committed" && attempt.failureStageLabel) return attempt.failureStageLabel;
  if (attempt.latestEvent === "arrival.generated") return "入场事件生成";
  if (attempt.latestEvent === "stage.paused") return "阶段暂停";
  if (attempt.latestEvent === "persistence.atomic_commit") return "原子提交";
  if (attempt.latestEvent === "step.committed") return "世界边界提交";
  if (attempt.latestEvent.includes("action")) return "行动编译";
  if (attempt.latestEvent.includes("ground")) return "可行性检查";
  if (attempt.latestEvent.includes("reaction") || attempt.latestEvent.includes("perception")) return "反应与感知";
  if (attempt.latestEvent.includes("truth") || attempt.latestEvent.includes("resolution")) return "结果裁决";
  return "世界推演";
}

function boundaryOf(entry: TimelineEntry): number | undefined {
  return entry.value.step;
}

function boundaryLabel(boundary: number | undefined): string {
  return boundary === undefined ? "未标记世界边界" : `世界边界 ${boundary + 1} · Step ${boundary}`;
}

function timelineRowEstimate(row: TimelineRow): number {
  return row.kind === "boundary" ? 54 : row.entry.kind === "attempt" ? 178 : 132;
}

function attemptOutcome(attempt: WorldInspectorAttemptSummary): { label: string; detail: string; status: "success" | "warning" | "error" | "active" } {
  if (attempt.status === "active") {
    return { label: "当前运行", detail: "", status: "active" };
  }
  if (attempt.status === "committed") {
    if (attempt.rejectionCount > 0) {
      return {
        label: `Revision ${attempt.revision ?? "—"}`,
        detail: `${attempt.rejectionCount} 次拒绝 · ${attempt.retryCount} 次重试`,
        status: "warning",
      };
    }
    return { label: `Revision ${attempt.revision ?? "—"}`, detail: "", status: "success" };
  }
  const stage = attempt.failureStageLabel ? `失败 · ${attempt.failureStageLabel}` : "失败";
  return { label: stage, detail: formatInspectorFailureSummary(attempt.errorMessage), status: "error" };
}

function TimelineEntryCard({
  entry,
  onReplay,
  onSelectAttempt,
  onSelectStep,
  selectedId,
}: {
  entry: TimelineEntry;
  onReplay: (attempt: WorldInspectorAttemptSummary) => void;
  onSelectAttempt: (attempt: WorldInspectorAttemptSummary) => void;
  onSelectStep: (step: WorldInspectorStepSummary) => void;
  selectedId?: string;
}) {
  if (entry.kind === "step") {
    const step = entry.value;
    return (
      <article className="cg-inspector-log cg-inspector-log--step">
        <div className="cg-inspector-log__surface">
          <button
            aria-pressed={selectedId === `commit:${step.revision}`}
            className="cg-inspector-log__select"
            onClick={() => onSelectStep(step)}
            type="button"
          >
            <span className="cg-inspector-log__heading">
              <strong>Revision {step.revision}</strong>
              <span data-status="committed">已完成</span>
            </span>
            <span className="cg-inspector-log__copy">{step.primaryAction}</span>
            <span className="cg-inspector-log__meta">
              <span>世界边界 {step.step + 1}</span>
              <span>{step.actorIds.join(" + ") || "整个世界"}</span>
              <span>{step.counts.actions} 个行动</span>
              <span>{step.counts.operations} 项状态变更</span>
              <span>+{step.elapsedSeconds} 秒</span>
              <span>{step.tokenUsage.unknown ? "部分 token 未记录" : `${step.tokenUsage.total} tokens`}</span>
            </span>
          </button>
        </div>
      </article>
    );
  }

  const attempt = entry.value;
  const outcome = attemptOutcome(attempt);
  return (
    <article className="cg-inspector-log cg-inspector-log--attempt" data-status={outcome.status}>
      <div className="cg-inspector-log__surface">
        <div className="cg-inspector-log__header">
          <button
            aria-pressed={selectedId === `attempt:${attempt.id}`}
            className="cg-inspector-log__select"
            onClick={() => onSelectAttempt(attempt)}
            type="button"
          >
            <span className="cg-inspector-log__heading">
              <strong>{outcome.label}</strong>
              <span data-status={attempt.status}>{attemptStatusLabel[attempt.status]}</span>
            </span>
            {outcome.detail && <span className="cg-inspector-log__copy">{outcome.detail}</span>}
          </button>
          <button
            aria-label={`回放${boundaryLabel(attempt.step)}`}
            className="cg-inspector-log__replay"
            onClick={() => onReplay(attempt)}
            type="button"
          >
            <Play aria-hidden="true" /> 回放
          </button>
        </div>
        <div className="cg-inspector-log__context">
          <span className="cg-inspector-log__purpose">{eventPurpose(attempt)}</span>
          <span>{boundaryLabel(attempt.step)}</span>
          <span>第 {attempt.advanceAttempt ?? 1} 次推进</span>
          <time dateTime={attempt.startedAt}>{formatTimestamp(attempt.startedAt ?? attempt.updatedAt)}</time>
          {formatDuration(attempt.durationMs) && <span>耗时 {formatDuration(attempt.durationMs)}</span>}
        </div>
        <dl className="cg-inspector-log__metrics" aria-label="运行指标">
          <div><dt>事件</dt><dd>{attempt.eventCount}<small>条</small></dd></div>
          <div><dt>逻辑调用</dt><dd>{attempt.modelInvocationCount}<small>次</small></dd></div>
          <div><dt>重试</dt><dd>{attempt.retryCount}<small>次</small></dd></div>
        </dl>
      </div>
    </article>
  );
}

function CurrentRunStatus({ run }: { run: InspectorRun }) {
  if (!run) return null;
  const paused = run.status === "debug-paused";
  const awaitingDecision = run.status === "awaiting-decision";
  const awaitingReaction = run.status === "awaiting-reaction";
  const failed = run.status === "failed" || run.status === "preparation-invalidated";
  const status = paused ? "paused" : failed ? "error" : run.status === "completed" ? "success" : "active";
  const stageNumber = Math.min(run.stageIndex + 1, run.stageCount);
  const stageLabel = run.stageLabel ?? run.stageKey ?? "准备阶段";
  return (
    <section className="cg-inspector-flow-status" data-status={status} aria-label="当前推演状态">
      <div className="cg-inspector-flow-status__body">
        <span className="cg-inspector-flow-status__eyebrow">世界边界 {run.boundaryIndex + 1} · Run {shortId(run.id)}</span>
        <h3>{paused ? "已暂停" : awaitingDecision ? "等待行动输入" : awaitingReaction ? "等待反应输入" : failed ? "推演未完成" : run.status === "completed" ? "推演已完成" : "推演进行中"}</h3>
        <p><strong>阶段 {stageNumber} / {run.stageCount}</strong><span>{stageLabel}</span></p>
      </div>
      <dl className="cg-inspector-flow-status__facts">
        <div><dt>状态</dt><dd>{paused && run.canAdvance ? "可执行" : awaitingDecision || awaitingReaction ? "等待输入" : status === "error" ? "失败" : "—"}</dd></div>
        <div><dt>Checkpoint</dt><dd title={run.checkpointId ?? undefined}>{run.checkpointId ? shortId(run.checkpointId) : "—"}</dd></div>
      </dl>
    </section>
  );
}

function TimelineRowView({ row, ...props }: {
  row: TimelineRow;
  onReplay: (attempt: WorldInspectorAttemptSummary) => void;
  onSelectAttempt: (attempt: WorldInspectorAttemptSummary) => void;
  onSelectStep: (step: WorldInspectorStepSummary) => void;
  selectedId?: string;
}) {
  if (row.kind === "boundary") {
    return (
      <section className="cg-inspector-boundary" aria-label={boundaryLabel(row.boundary)}>
        <header className="cg-inspector-boundary__header">
          <span><strong>{row.boundary === undefined ? "未标记世界边界" : `世界边界 ${row.boundary + 1}`}</strong><small>{row.boundary === undefined ? "" : `Step ${row.boundary}`}</small></span>
          <b>{row.count} 条记录</b>
        </header>
      </section>
    );
  }
  return <TimelineEntryCard entry={row.entry} {...props} />;
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
  run,
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
  run?: InspectorRun;
  selectedActorId: string;
  selectedId?: string;
  steps: WorldInspectorStepSummary[];
}) {
  const normalized = query.trim().toLocaleLowerCase();
  const visibleEntries = useMemo(() => [
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
        const queryMatch = !normalized || `${attempt.id} ${attempt.latestEvent} ${attempt.errorMessage ?? ""} ${eventPurpose(attempt)}`
          .toLocaleLowerCase().includes(normalized);
        return actorMatch && queryMatch;
      })
      .map((attempt): TimelineEntry => ({ kind: "attempt", value: attempt })),
  ].sort((left, right) => {
    const boundaryDelta = (boundaryOf(right) ?? -1) - (boundaryOf(left) ?? -1);
    if (boundaryDelta !== 0) return boundaryDelta;
    const updatedAt = (entry: TimelineEntry) => entry.kind === "attempt" ? Date.parse(entry.value.updatedAt) : Number.NaN;
    const leftTime = updatedAt(left);
    const rightTime = updatedAt(right);
    if (Number.isFinite(leftTime) && Number.isFinite(rightTime) && leftTime !== rightTime) return rightTime - leftTime;
    if (left.kind !== right.kind) return left.kind === "attempt" ? -1 : 1;
    if (left.kind === "attempt" && right.kind === "attempt") {
      return Date.parse(right.value.startedAt) - Date.parse(left.value.startedAt) || right.value.id.localeCompare(left.value.id);
    }
    if (left.kind === "step" && right.kind === "step") return right.value.revision - left.value.revision;
    return 0;
  }), [attempts, normalized, selectedActorId, steps]);
  const rows = useMemo<TimelineRow[]>(() => {
    const next: TimelineRow[] = [];
    let index = 0;
    while (index < visibleEntries.length) {
      const boundary = boundaryOf(visibleEntries[index]!);
      let end = index + 1;
      while (end < visibleEntries.length && boundaryOf(visibleEntries[end]!) === boundary) end += 1;
      next.push({ kind: "boundary", key: `boundary:${boundary ?? "unknown"}:${index}`, boundary, count: end - index });
      for (let entryIndex = index; entryIndex < end; entryIndex += 1) {
        const entry = visibleEntries[entryIndex]!;
        next.push({
          kind: "entry",
          key: entry.kind === "attempt" ? `attempt:${entry.value.id}` : `step:${entry.value.revision}`,
          entry,
        });
      }
      index = end;
    }
    return next;
  }, [visibleEntries]);
  const viewportRef = useRef<HTMLDivElement>(null);
  const [rowHeights, setRowHeights] = useState<Record<string, number>>({});
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(640);
  const offsets = useMemo(() => {
    const values: number[] = [];
    let total = 0;
    for (const row of rows) {
      values.push(total);
      total += rowHeights[row.key] ?? timelineRowEstimate(row);
    }
    return { total, values };
  }, [rowHeights, rows]);
  const findRowAt = (offset: number): number => {
    let low = 0;
    let high = offsets.values.length;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if ((offsets.values[middle] ?? 0) < offset) low = middle + 1;
      else high = middle;
    }
    return Math.max(0, Math.min(rows.length, low));
  };
  const overscan = 6;
  const firstRow = Math.max(0, findRowAt(scrollTop) - overscan);
  const lastRow = Math.min(rows.length, findRowAt(scrollTop + viewportHeight) + overscan + 1);
  const windowedRows = rows.slice(firstRow, lastRow);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const update = () => setViewportHeight(viewport.clientHeight || 640);
    update();
    const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(update);
    observer?.observe(viewport);
    window.addEventListener("resize", update);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", update);
    };
  }, []);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport || windowedRows.length === 0) return;
    const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver((entries) => {
      for (const entry of entries) {
        const key = (entry.target as HTMLElement).dataset.rowKey;
        if (!key) continue;
        const height = Math.ceil(entry.borderBoxSize?.[0]?.blockSize ?? entry.contentRect.height);
        if (height > 0) {
          setRowHeights((current) => {
            if (current[key] === height) return current;
            return { ...current, [key]: height };
          });
        }
      }
    });
    if (observer) viewport.querySelectorAll<HTMLElement>("[data-row-key]").forEach((row) => observer.observe(row));
    return () => observer?.disconnect();
  }, [firstRow, lastRow, windowedRows]);

  return (
    <div className="cg-inspector-timeline" role="feed" aria-label="世界演化流程">
      <CurrentRunStatus run={run} />
      <div
        className="cg-inspector-timeline__viewport"
        onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
        ref={viewportRef}
      >
        {visibleEntries.length === 0 ? (
          <div className="cg-inspector-empty">
            <strong>{steps.length === 0 && attempts.length > 0 && !normalized ? "暂无 Revision" : "没有匹配记录"}</strong>
            <span>{steps.length === 0 && attempts.length > 0 && !normalized ? "查看执行尝试" : "清除搜索或切换主体"}</span>
          </div>
        ) : (
          <div className="cg-inspector-timeline__spacer" style={{ height: `${offsets.total}px` }}>
            <div className="cg-inspector-timeline__window" style={{ transform: `translateY(${offsets.values[firstRow] ?? 0}px)` }}>
              {windowedRows.map((row) => (
                <div className="cg-inspector-timeline__row" data-row-key={row.key} key={row.key}>
                  <TimelineRowView row={row} onReplay={onReplay} onSelectAttempt={onSelectAttempt} onSelectStep={onSelectStep} selectedId={selectedId} />
                </div>
              ))}
            </div>
          </div>
        )}
        {hasOlder && (
          <button className="cg-inspector-load-older" disabled={loadingOlder} onClick={onLoadOlder} type="button">
            {loadingOlder ? "正在读取更早记录…" : "加载更早记录"}
          </button>
        )}
      </div>
    </div>
  );
}
