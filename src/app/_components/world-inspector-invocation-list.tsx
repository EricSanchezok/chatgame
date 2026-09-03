"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { WorldInspectorModelInvocationSummary } from "../../shared/world-inspector-api";
import { WorldInspectorSelect } from "./world-inspector-select";

export type WorldInspectorInvocationListItem = WorldInspectorModelInvocationSummary & {
  /** Query results carry this routing hint; step/attempt projections may omit it because their execution is implicit. */
  boundaryIndex?: number;
  executionId?: string;
  ledgerSequence?: number;
};

function formatNumber(value: number | null | undefined): string {
  return value === null || value === undefined ? "—" : value.toLocaleString();
}

function formatDuration(value: number | undefined): string {
  if (value === undefined) return "—";
  if (value < 1_000) return `${Math.round(value)} ms`;
  return `${(value / 1_000).toFixed(value < 10_000 ? 1 : 0)} 秒`;
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

function statusLabel(status: WorldInspectorModelInvocationSummary["status"]): string {
  return status === "accepted" ? "语义接受" : status === "rejected" ? "输出拒绝" : status === "failed" ? "调用失败" : "进行中";
}

function stageIndex(invocation: WorldInspectorInvocationListItem): number {
  const value = invocation.logicalStageIndex;
  return value !== undefined && value < Number.MAX_SAFE_INTEGER ? value : -1;
}

export function WorldInspectorInvocationList({
  invocations,
  onLoadMore,
  onSelect,
  query,
  selectedId,
  scopeLabel,
  hasMore,
  loadingMore,
}: {
  invocations: WorldInspectorInvocationListItem[];
  onLoadMore?: () => void;
  onSelect: (invocation: WorldInspectorInvocationListItem) => void;
  query: string;
  selectedId?: string;
  scopeLabel?: string;
  hasMore?: boolean;
  loadingMore?: boolean;
}) {
  const [sort, setSort] = useState<"stage" | "timestamp" | "duration" | "inputTokens" | "outputTokens" | "retries">("stage");
  const [minInputTokens, setMinInputTokens] = useState("");
  const [minRetries, setMinRetries] = useState("");
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportSize, setViewportSize] = useState({ width: 1024, height: 640 });
  const listRef = useRef<HTMLElement>(null);
  const itemsRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = listRef.current;
    if (!element) return;
    const updateSize = () => {
      const styles = window.getComputedStyle(element);
      const horizontalPadding = (Number.parseFloat(styles.paddingLeft) || 0) + (Number.parseFloat(styles.paddingRight) || 0);
      setViewportSize({
        // Container queries measure the content box, while clientWidth also
        // includes this list's horizontal padding. Keep virtualization's
        // responsive row heights on the same width as the CSS layout.
        width: Math.max(0, (element.clientWidth || 1024) - horizontalPadding),
        height: element.clientHeight || 640,
      });
    };
    updateSize();
    const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(updateSize);
    observer?.observe(element);
    window.addEventListener("resize", updateSize);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", updateSize);
    };
  }, []);
  const normalized = query.trim().toLocaleLowerCase();
  const visible = useMemo(() => invocations.filter((invocation) => {
    const inputThreshold = minInputTokens === "" ? undefined : Number(minInputTokens);
    const retryThreshold = minRetries === "" ? undefined : Number(minRetries);
    if (inputThreshold !== undefined && (invocation.tokenUsage.input ?? -1) < inputThreshold) return false;
    if (retryThreshold !== undefined && invocation.retryCount < retryThreshold) return false;
    if (!normalized) return true;
    const slots = invocation.slotRefs.flatMap((slot) => [slot.agentId, slot.actionId, slot.label]).filter(Boolean).join(" ");
    return [invocation.id, invocation.role, invocation.subjectId, invocation.providerId, invocation.modelId,
      invocation.profileId, invocation.errorMessage, ...invocation.issues.map((issue) => issue.code), ...invocation.eventIds,
      ...Object.values(invocation.artifactHashes), slots]
      .filter(Boolean).join(" ").toLocaleLowerCase().includes(normalized);
  }).sort((left, right) => {
    const value = (invocation: WorldInspectorInvocationListItem): number => sort === "stage"
      ? (invocation.boundaryIndex ?? -1) * 1_000_000_000_000 + (stageIndex(invocation) + 1) * 1_000_000 +
        (invocation.logicalInvocationOrdinal ?? invocation.ordinal) * 1_000 + (invocation.ledgerSequence ?? invocation.ordinal)
      : sort === "duration"
      ? invocation.timings.invocationMs ?? -1
      : sort === "inputTokens" ? invocation.tokenUsage.input ?? -1
      : sort === "outputTokens" ? invocation.tokenUsage.output ?? -1
      : sort === "retries" ? invocation.retryCount
      : invocation.startedAt ? Date.parse(invocation.startedAt) : invocation.ordinal;
    return value(right) - value(left) || (right.ledgerSequence ?? right.ordinal) - (left.ledgerSequence ?? left.ordinal) ||
      right.ordinal - left.ordinal;
  }), [invocations, minInputTokens, minRetries, normalized, sort]);
  const rowHeight = viewportSize.width <= 384 ? 132 : viewportSize.width <= 576 ? 116 : 92;
  const viewportHeight = viewportSize.height;
  const overscan = 8;
  const effectiveScrollTop = Math.min(scrollTop, Math.max(0, visible.length * rowHeight - viewportHeight));
  const windowStart = Math.max(0, Math.floor(effectiveScrollTop / rowHeight) - overscan);
  const windowEnd = Math.min(visible.length, Math.ceil((effectiveScrollTop + viewportHeight) / rowHeight) + overscan);
  const windowed = visible.slice(windowStart, windowEnd);
  const input = visible.reduce((sum, invocation) => sum + (invocation.tokenUsage.input ?? 0), 0);
  const output = visible.reduce((sum, invocation) => sum + (invocation.tokenUsage.output ?? 0), 0);
  const retries = visible.reduce((sum, invocation) => sum + invocation.retryCount, 0);
  return (
    <section
      className="cg-inspector-invocation-list"
      aria-label="模型调用清单"
      ref={listRef}
      onScroll={(event) => {
        const itemOffset = itemsRef.current?.offsetTop ?? 0;
        setScrollTop(Math.max(0, event.currentTarget.scrollTop - itemOffset));
      }}
    >
      <header className="cg-inspector-invocation-list__header">
        <div>
          <strong>模型调用{scopeLabel ? ` · ${scopeLabel}` : ""}</strong>
        </div>
        <dl>
          <div><dt>调用</dt><dd>{visible.length}</dd></div>
          <div><dt>输入</dt><dd>{formatNumber(input)}</dd></div>
          <div><dt>输出</dt><dd>{formatNumber(output)}</dd></div>
          <div><dt>retry</dt><dd>{retries}</dd></div>
        </dl>
      </header>
      <div className="cg-inspector-invocation-list__controls" aria-label="调用排序与筛选">
        <label>排序
          <WorldInspectorSelect
            ariaLabel="排序"
            onChange={(value) => setSort(value as typeof sort)}
            options={[
              { value: "stage", label: "引擎顺序" },
              { value: "timestamp", label: "时间" },
              { value: "duration", label: "耗时" },
              { value: "inputTokens", label: "输入 token" },
              { value: "outputTokens", label: "输出 token" },
              { value: "retries", label: "retry" },
            ]}
            value={sort}
          />
        </label>
        <details className="cg-inspector-invocation-filters">
          <summary>筛选</summary>
          <div>
            <label>最少输入 token
              <input min="0" onChange={(event) => setMinInputTokens(event.target.value)} placeholder="不限" type="number" value={minInputTokens} />
            </label>
            <label>最少 retry
              <input min="0" onChange={(event) => setMinRetries(event.target.value)} placeholder="不限" type="number" value={minRetries} />
            </label>
          </div>
        </details>
      </div>
      {visible.length === 0 && (
        <p className="cg-inspector-inline-empty">
          {normalized ? `没有匹配“${query}”的模型调用。` : "这次记录没有模型调用。"}
        </p>
      )}
      <div
        className="cg-inspector-invocation-list__items"
        ref={itemsRef}
      >
        <div className="cg-inspector-invocation-list__spacer" style={{ height: `${visible.length * rowHeight}px` }}>
          <div className="cg-inspector-invocation-list__window" style={{ transform: `translateY(${windowStart * rowHeight}px)` }}>
        {windowed.map((invocation) => {
          return (
            <article
              className="cg-inspector-invocation"
              data-selected={selectedId === invocation.id || undefined}
              data-status={invocation.status}
              key={invocation.id}
              style={{ height: `${rowHeight}px` }}
              >
              <button
                aria-pressed={selectedId === invocation.id}
                className="cg-inspector-invocation__button"
                data-selected={selectedId === invocation.id || undefined}
                onClick={() => onSelect(invocation)}
                type="button"
              >
                <span className="cg-inspector-invocation__identity">
                  <strong>Invocation {invocation.ordinal || "?"} · {invocation.role ?? "模型调用"}</strong>
                  <small title={invocation.executionId}>{invocation.providerId ?? "未知 provider"} / {invocation.modelId ?? "未知 model"}</small>
                </span>
                <span className="cg-inspector-invocation__status" data-status={invocation.status}>{statusLabel(invocation.status)}</span>
                <time className="cg-inspector-invocation__time" dateTime={invocation.startedAt ?? invocation.updatedAt}>{formatTimestamp(invocation.startedAt ?? invocation.updatedAt)}</time>
                <span className="cg-inspector-invocation__slots">{invocation.slotRefs.length} slots</span>
                <span className="cg-inspector-invocation__metrics" role="list">
                  <span role="listitem"><span>in</span><strong>{formatNumber(invocation.tokenUsage.input)}</strong></span>
                  <span role="listitem"><span>out</span><strong>{formatNumber(invocation.tokenUsage.output)}</strong></span>
                  <span role="listitem"><span>耗时</span><strong>{formatDuration(invocation.timings.invocationMs)}</strong></span>
                  {invocation.retryCount > 0 && <span role="listitem"><span>retry</span><strong>{invocation.retryCount}</strong></span>}
                </span>
              </button>
            </article>
          );
        })}
          </div>
        </div>
      </div>
      {hasMore && onLoadMore && (
        <button className="cg-inspector-invocation-list__load-more" disabled={loadingMore} onClick={onLoadMore} type="button">
          {loadingMore ? "正在读取更多调用…" : "加载更多调用"}
        </button>
      )}
    </section>
  );
}
