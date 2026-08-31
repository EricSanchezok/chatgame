"use client";

import { AlertTriangle, Bot, Check, Clock3, LoaderCircle, RotateCcw } from "lucide-react";
import { useState } from "react";
import type { WorldInspectorModelInvocationSummary } from "../../shared/world-inspector-api";
import { worldInspectorInvocationExecutionHint } from "../_lib/world-inspector-invocation";
import { WorldInspectorSlotSummary } from "./world-inspector-slot-summary";

export type WorldInspectorInvocationListItem = WorldInspectorModelInvocationSummary & {
  /** Query results carry this routing hint; step/attempt projections may omit it because their execution is implicit. */
  executionId?: string;
};

function formatNumber(value: number | null | undefined): string {
  return value === null || value === undefined ? "—" : value.toLocaleString();
}

function formatDuration(value: number | undefined): string {
  if (value === undefined) return "未记录";
  if (value < 1_000) return `${Math.round(value)} ms`;
  return `${(value / 1_000).toFixed(value < 10_000 ? 1 : 0)} 秒`;
}

function statusLabel(status: WorldInspectorModelInvocationSummary["status"]): string {
  return status === "accepted" ? "语义接受" : status === "rejected" ? "输出拒绝" : status === "failed" ? "调用失败" : "进行中";
}

function statusIcon(status: WorldInspectorModelInvocationSummary["status"]) {
  return status === "accepted" ? Check : status === "active" ? LoaderCircle : AlertTriangle;
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
  const [sort, setSort] = useState<"timestamp" | "duration" | "inputTokens" | "outputTokens" | "retries">("timestamp");
  const [minInputTokens, setMinInputTokens] = useState("");
  const [minRetries, setMinRetries] = useState("");
  const normalized = query.trim().toLocaleLowerCase();
  const visible = invocations.filter((invocation) => {
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
    const value = (invocation: WorldInspectorModelInvocationSummary): number => sort === "duration"
      ? invocation.timings.invocationMs ?? -1
      : sort === "inputTokens" ? invocation.tokenUsage.input ?? -1
      : sort === "outputTokens" ? invocation.tokenUsage.output ?? -1
      : sort === "retries" ? invocation.retryCount
      : invocation.startedAt ? Date.parse(invocation.startedAt) : invocation.ordinal;
    return value(right) - value(left) || right.ordinal - left.ordinal;
  });
  const input = visible.reduce((sum, invocation) => sum + (invocation.tokenUsage.input ?? 0), 0);
  const output = visible.reduce((sum, invocation) => sum + (invocation.tokenUsage.output ?? 0), 0);
  const retries = visible.reduce((sum, invocation) => sum + invocation.retryCount, 0);
  return (
    <section className="cg-inspector-invocation-list" aria-label="模型调用清单">
      <header className="cg-inspector-invocation-list__header">
        <div>
          <strong>模型调用清单</strong>
          <small>{scopeLabel ? `${scopeLabel} · ` : ""}逻辑调用与物理传输尝试分开记录</small>
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
          <select onChange={(event) => setSort(event.target.value as typeof sort)} value={sort}>
            <option value="timestamp">时间</option>
            <option value="duration">调用耗时</option>
            <option value="inputTokens">输入 token</option>
            <option value="outputTokens">输出 token</option>
            <option value="retries">retry 次数</option>
          </select>
        </label>
        <label>最少输入 token
          <input min="0" onChange={(event) => setMinInputTokens(event.target.value)} placeholder="不限" type="number" value={minInputTokens} />
        </label>
        <label>最少 retry
          <input min="0" onChange={(event) => setMinRetries(event.target.value)} placeholder="不限" type="number" value={minRetries} />
        </label>
      </div>
      {visible.length === 0 && (
        <p className="cg-inspector-inline-empty">
          {normalized ? `没有匹配“${query}”的模型调用。` : "这次记录没有模型调用。"}
        </p>
      )}
      <div className="cg-inspector-invocation-list__items">
        {visible.map((invocation) => {
          const Icon = statusIcon(invocation.status);
          const executionHint = worldInspectorInvocationExecutionHint(invocation);
          return (
            <article
              className="cg-inspector-invocation"
              data-selected={selectedId === invocation.id || undefined}
              data-status={invocation.status}
              key={invocation.id}
            >
              <button
                aria-pressed={selectedId === invocation.id}
                className="cg-inspector-invocation__button"
                data-selected={selectedId === invocation.id || undefined}
                onClick={() => onSelect(invocation)}
                type="button"
              >
                <span className="cg-inspector-invocation__icon"><Bot aria-hidden="true" /></span>
                <span className="cg-inspector-invocation__identity">
                  <strong>Invocation {invocation.ordinal || "?"} · {invocation.role ?? "模型调用"}</strong>
                  <small title={invocation.executionId}>{invocation.providerId ?? "未知 provider"} / {invocation.modelId ?? "未知 model"}{executionHint ? ` · 执行 ${executionHint}` : ""}</small>
                </span>
                <span className="cg-inspector-invocation__status"><Icon aria-hidden="true" />{statusLabel(invocation.status)}</span>
                <span className="cg-inspector-invocation__slot-line">
                  <span>Agent / slot：</span><WorldInspectorSlotSummary slotRefs={invocation.slotRefs} />
                </span>
                <span className="cg-inspector-invocation__metrics" role="list">
                  <span role="listitem"><span>单次输入 token</span><strong>{formatNumber(invocation.tokenUsage.input)}</strong></span>
                  <span role="listitem"><span>单次输出 token</span><strong>{formatNumber(invocation.tokenUsage.output)}</strong></span>
                  <span role="listitem"><span>调用耗时</span><strong>{formatDuration(invocation.timings.invocationMs)}</strong></span>
                  <span role="listitem"><span>上下文</span><strong>{formatNumber(invocation.contextUtf8Bytes)} B</strong></span>
                </span>
                {invocation.retryCount > 0 && (
                  <span className="cg-inspector-invocation__retry-summary">
                    <RotateCcw aria-hidden="true" />
                    <span className="cg-inspector-invocation__retry-copy">{invocation.retryCount} 次 retry · {invocation.transportAttempts.length} 次物理尝试</span>
                  </span>
                )}
                <span className="cg-inspector-invocation__transports" aria-label="物理传输尝试">
                {invocation.transportAttempts.map((transport) => (
                  <span
                    className="cg-inspector-transport-row"
                    key={`${invocation.id}:${transport.attempt}`}
                  >
                    <span>Transport {transport.attempt}</span>
                    <span>{transport.status}</span>
                    <span>{formatDuration(transport.executionMs)}</span>
                    {transport.retryDelayMs > 0 && <span>等待 {formatDuration(transport.retryDelayMs)}</span>}
                    <Clock3 aria-hidden="true" />
                  </span>
                ))}
                </span>
              </button>
            </article>
          );
        })}
      </div>
      {hasMore && onLoadMore && (
        <button className="cg-inspector-invocation-list__load-more" disabled={loadingMore} onClick={onLoadMore} type="button">
          {loadingMore ? "正在读取更多调用…" : "加载更多调用"}
        </button>
      )}
    </section>
  );
}
