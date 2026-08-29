"use client";

import { ArrowDown, ArrowUp } from "lucide-react";
import { useEffect, useState, type CSSProperties } from "react";
import type { PublicInstanceDetail, PublicWorldRun } from "../../shared/world-api";
import type { WorldObserverDetail } from "../../shared/world-observer-api";

export type TimelineEntry = {
  id: string;
  targetId: string;
  step: number;
  revision: number;
  worldTimeSeconds?: number;
  title: string;
  excerpt: string;
  activity?: NonNullable<PublicWorldRun["activity"]>;
};

export function participantTimeline(detail: PublicInstanceDetail): TimelineEntry[] {
  return (detail.conversation?.turns ?? []).flatMap((turn) => {
    const responses = turn.responses?.length ? turn.responses : turn.response ? [turn.response] : [];
    return responses.map((response, index) => ({
      id: `timeline:${turn.id}:${response.revision}:${index}`,
      targetId: `${turn.id}:world:${response.revision}:${index}`,
      step: response.step,
      revision: response.revision,
      ...(response.worldTimeSeconds === undefined ? {} : { worldTimeSeconds: response.worldTimeSeconds }),
      title: response.title ?? "世界",
      excerpt: response.text,
      ...(response.activity ? { activity: response.activity } : {}),
    }));
  });
}

export function observerTimeline(observer?: WorldObserverDetail): TimelineEntry[] {
  const perspective = observer?.selected?.perspective;
  if (!perspective) return [];
  return perspective.history.flatMap((turn) => {
    const excerpt = turn.observations.map((observation) => observation.summary).filter(Boolean).join("\n\n");
    if (!excerpt) return [];
    return [{
      id: `timeline:perspective:${perspective.agentId}:${turn.revision}`,
      targetId: `perspective:${perspective.agentId}:${turn.revision}:observation`,
      step: turn.step,
      revision: turn.revision,
      title: "世界",
      excerpt,
    }];
  });
}

export function timelineExcerpt(text: string, maxLength = 76): string {
  const compact = text.replace(/\s+/g, " ").trim();
  if (compact.length <= maxLength) return compact;
  return `${compact.slice(0, Math.max(1, maxLength - 1)).trimEnd()}…`;
}

function formatWorldTime(seconds?: number): string | undefined {
  if (seconds === undefined) return undefined;
  const safeSeconds = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(safeSeconds / 3_600);
  const minutes = Math.floor((safeSeconds % 3_600) / 60);
  const remainder = safeSeconds % 60;
  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, "0")}m`;
  return `${minutes}:${String(remainder).padStart(2, "0")}`;
}

function activitySummary(activity?: NonNullable<PublicWorldRun["activity"]>): string | undefined {
  if (!activity) return undefined;
  if (activity.progress) {
    return `${activity.progress.current.toFixed(2)} / ${activity.progress.target} ${activity.progress.unit}`;
  }
  if (activity.status === "queued") {
    return `等待${activity.resourceNames.join("、") || "共享资源"} · 队列第 ${activity.queuePosition ?? 1} 位`;
  }
  if (activity.status === "ready") return "资源已预留 · 下一次时间推进开始";
  return undefined;
}

function useTimelineActiveIndex(entries: readonly TimelineEntry[]): [number, (index: number) => void] {
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    if (entries.length === 0) return;
    const viewport = document.querySelector<HTMLElement>("[data-cg-thread-viewport]");
    if (!viewport || typeof IntersectionObserver === "undefined") return;

    const targets = entries
      .map((entry, index) => {
        const node = document.getElementById(entry.targetId);
        return node ? { index, node } : undefined;
      })
      .filter((target): target is { index: number; node: HTMLElement } => Boolean(target));
    if (targets.length === 0) return;

    const observer = new IntersectionObserver((observations) => {
      const visible = observations
        .filter((observation) => observation.isIntersecting)
        .sort((left, right) => right.intersectionRatio - left.intersectionRatio)[0];
      if (!visible) return;
      const match = targets.find((target) => target.node === visible.target);
      if (match) setActiveIndex(match.index);
    }, {
      root: viewport,
      rootMargin: "-18% 0px -62% 0px",
      threshold: [0.1, 0.45, 0.8],
    });
    targets.forEach(({ node }) => observer.observe(node));
    return () => observer.disconnect();
  }, [entries]);

  return [activeIndex, setActiveIndex];
}

export function WorldTimelineRail({
  entries,
  reducedMotion,
  step,
}: {
  entries: readonly TimelineEntry[];
  reducedMotion: boolean;
  step: number;
}) {
  const [activeIndex, setActiveIndex] = useTimelineActiveIndex(entries);
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const safeActiveIndex = Math.min(activeIndex, Math.max(0, entries.length - 1));
  const activeEntry = entries[safeActiveIndex];
  const previewEntry = previewIndex === null ? undefined : entries[previewIndex];
  const previewActivitySummary = previewEntry ? activitySummary(previewEntry.activity) : undefined;
  const trackStyle = {
    "--cg-timeline-count": String(Math.max(1, entries.length)),
  } as CSSProperties;

  function goTo(index: number): void {
    if (!entries[index]) return;
    setActiveIndex(index);
    setPreviewIndex(index);
    document.getElementById(entries[index].targetId)?.scrollIntoView({
      behavior: reducedMotion ? "auto" : "smooth",
      block: "start",
    });
  }

  return (
    <aside
      aria-label="世界消息时间线"
      className="cg-timeline-rail"
      data-empty={entries.length === 0 || undefined}
      data-preview-open={previewEntry ? "true" : undefined}
    >
      <button
        aria-label="上一条世界回复"
        className="cg-timeline-rail__arrow"
        disabled={safeActiveIndex <= 0 || entries.length === 0}
        onClick={() => goTo(safeActiveIndex - 1)}
        type="button"
      >
        <ArrowUp aria-hidden="true" />
      </button>
      <div className="cg-timeline-rail__track">
        <span aria-hidden="true" className="cg-timeline-rail__line" />
        {entries.length > 0 ? (
          <ol style={trackStyle}>
            {entries.map((entry, index) => (
              <li data-active={index === safeActiveIndex || undefined} key={entry.id}>
                <button
                  aria-current={index === safeActiveIndex ? "location" : undefined}
                  aria-label={`第 ${entry.step} 步，${entry.title}，${entry.excerpt}`}
                  className="cg-timeline-rail__tick"
                  onClick={() => goTo(index)}
                  onFocus={() => setPreviewIndex(index)}
                  onMouseEnter={() => setPreviewIndex(index)}
                  onMouseLeave={() => setPreviewIndex(null)}
                  onBlur={() => setPreviewIndex(null)}
                  type="button"
                >
                  <span aria-hidden="true" />
                </button>
              </li>
            ))}
          </ol>
        ) : (
          <span className="cg-timeline-rail__empty-mark" aria-hidden="true" />
        )}
      </div>
      <button
        aria-label="下一条世界回复"
        className="cg-timeline-rail__arrow"
        disabled={safeActiveIndex >= entries.length - 1 || entries.length === 0}
        onClick={() => goTo(safeActiveIndex + 1)}
        type="button"
      >
        <ArrowDown aria-hidden="true" />
      </button>
      {previewEntry ? (
        <div className="cg-timeline-rail__preview" aria-hidden="true">
          <span className="cg-timeline-rail__meta">
            第 {previewEntry.step} 步 · Revision {previewEntry.revision}
            {formatWorldTime(previewEntry.worldTimeSeconds) ? ` · ${formatWorldTime(previewEntry.worldTimeSeconds)}` : ""}
          </span>
          <strong>{previewEntry.title}</strong>
          <p>{timelineExcerpt(previewEntry.excerpt)}</p>
          {previewActivitySummary ? <small>{previewActivitySummary}</small> : null}
        </div>
      ) : (
        <p className="cg-timeline-rail__empty-copy">第 {step} 步</p>
      )}
      <p className="cg-sr-only" aria-live="polite">
        {activeEntry ? `正在查看第 ${activeEntry.step} 步：${activeEntry.title}` : `当前为第 ${step} 步`}
      </p>
    </aside>
  );
}
