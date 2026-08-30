"use client";

import {
  ArrowDownToLine,
  Binoculars,
  Bot,
  CircleDot,
  Focus,
  GitBranch,
  ListTree,
  LocateFixed,
  Network,
  RefreshCw,
  Search,
  Users,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import { WorkspaceDialog } from "@/components/ui/workspace-dialog";
import type {
  WorldInspectorAttemptDetail,
  WorldInspectorAttemptSummary,
  WorldInspectorModelInvocationDetail,
  WorldInspectorModelInvocationSummary,
  WorldInspectorActor,
  WorldInspectorNodeSummary,
  WorldInspectorStepDetail,
  WorldInspectorStepSummary,
  WorldInspectorStreamEvent,
  WorldInspectorWindow,
} from "../../shared/world-inspector-api";
import { mergeWorldInspectorWindows } from "../_lib/world-inspector-window";
import {
  WORLD_INSPECTOR_ACTOR_DEFAULT,
  WORLD_INSPECTOR_ACTOR_MAX,
  WORLD_INSPECTOR_ACTOR_MIN,
  WORLD_INSPECTOR_DETAIL_DEFAULT,
  WORLD_INSPECTOR_DETAIL_MAX,
  WORLD_INSPECTOR_DETAIL_MIN,
  clampWorldInspectorActorWidth,
  clampWorldInspectorDetailWidth,
  readWorldInspectorLayout,
  resizeWorldInspectorPanelWidth,
  writeWorldInspectorLayout,
  type WorldInspectorView,
} from "../_lib/world-inspector-preferences";
import { worldInspectorApi } from "../lib/world-inspector-api-client";
import { WorldInspectorDetail } from "./world-inspector-detail";
import { WorldInspectorGraph } from "./world-inspector-graph";
import { WorldInspectorInvocationList } from "./world-inspector-invocation-list";
import { WorldInspectorTimeline } from "./world-inspector-timeline";

type InspectorDetail =
  | { kind: "step"; value: WorldInspectorStepDetail }
  | { kind: "attempt"; value: WorldInspectorAttemptDetail };
type ResizablePanel = "actors" | "detail";
type CenterView = "calls" | WorldInspectorView;

const narrowQuery = "(max-width: 52rem)";

function useNarrowViewport(): boolean {
  return useSyncExternalStore(
    (notify) => {
      const query = window.matchMedia(narrowQuery);
      query.addEventListener("change", notify);
      return () => query.removeEventListener("change", notify);
    },
    () => window.matchMedia(narrowQuery).matches,
    () => false,
  );
}

function actorActivity(
  actorId: string,
  actor: WorldInspectorActor | undefined,
  steps: readonly WorldInspectorStepSummary[],
  attempts: readonly WorldInspectorAttemptSummary[],
): { attempts: number; steps: number; modelInvocations: number; transportAttempts: number; retries: number } {
  if (actor?.activity) return actor.activity;
  return {
    steps: steps.reduce((total, step) => total + (step.actorIds.includes(actorId) ? 1 : 0), 0),
    attempts: attempts.reduce((total, attempt) => total + (attempt.actorIds.includes(actorId) ? 1 : 0), 0),
    modelInvocations: 0,
    transportAttempts: 0,
    retries: 0,
  };
}

function InspectorResizer({
  label,
  maximum,
  minimum,
  onKeyDown,
  onPointerCancel,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  value,
}: {
  label: string;
  maximum: number;
  minimum: number;
  onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
  onPointerCancel: (event: PointerEvent<HTMLDivElement>) => void;
  onPointerDown: (event: PointerEvent<HTMLDivElement>) => void;
  onPointerMove: (event: PointerEvent<HTMLDivElement>) => void;
  onPointerUp: (event: PointerEvent<HTMLDivElement>) => void;
  value: number;
}) {
  return (
    <div
      aria-label={label}
      aria-orientation="vertical"
      aria-valuemax={maximum}
      aria-valuemin={minimum}
      aria-valuenow={value}
      className="cg-inspector-resizer"
      onKeyDown={onKeyDown}
      onPointerCancel={onPointerCancel}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      role="separator"
      tabIndex={0}
    />
  );
}

export default function WorldInspectorDialog({
  onOpenChange,
  open,
  reduceMotion,
  instanceId,
}: {
  onOpenChange: (open: boolean) => void;
  open: boolean;
  reduceMotion: boolean;
  instanceId: string;
}) {
  const narrow = useNarrowViewport();
  const actorToggleRef = useRef<HTMLButtonElement>(null);
  const refreshTimerRef = useRef<number | undefined>(undefined);
  const requestRef = useRef(0);
  const detailRequestRef = useRef(0);
  const selectedNodeRef = useRef<string | undefined>(undefined);
  const followLatestRef = useRef(true);
  const resizeRef = useRef<{
    currentWidth: number;
    panel: ResizablePanel;
    startX: number;
    startWidth: number;
  } | undefined>(undefined);
  const [data, setData] = useState<WorldInspectorWindow>();
  const [detail, setDetail] = useState<InspectorDetail>();
  const [detailError, setDetailError] = useState("");
  const [invocationDetail, setInvocationDetail] = useState<WorldInspectorModelInvocationDetail>();
  const [invocationError, setInvocationError] = useState("");
  const [loadingInvocation, setLoadingInvocation] = useState(false);
  const [queriedInvocations, setQueriedInvocations] = useState<WorldInspectorModelInvocationSummary[]>([]);
  const [invocationCursor, setInvocationCursor] = useState<string>();
  const [loadingMoreInvocations, setLoadingMoreInvocations] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [connection, setConnection] = useState<"connecting" | "live" | "offline">("connecting");
  const [followLatest, setFollowLatest] = useState(true);
  const [isolateActor, setIsolateActor] = useState(false);
  const [actorsOpen, setActorsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedActorId, setSelectedActorId] = useState("world");
  const [selectedNodeId, setSelectedNodeId] = useState<string>();
  const [selectedInvocationId, setSelectedInvocationId] = useState<string>();
  const [view, setView] = useState<CenterView>("calls");
  const [actorWidth, setActorWidth] = useState(WORLD_INSPECTOR_ACTOR_DEFAULT);
  const [detailWidth, setDetailWidth] = useState(WORLD_INSPECTOR_DETAIL_DEFAULT);
  const [failureViewOverride, setFailureViewOverride] = useState(false);
  const activeView: CenterView = narrow || failureViewOverride ? "calls" : view;
  const closeActorDrawer = useCallback(() => {
    setActorsOpen(false);
    if (narrow) requestAnimationFrame(() => actorToggleRef.current?.focus());
  }, [narrow]);

  useEffect(() => {
    selectedNodeRef.current = selectedNodeId;
  }, [selectedNodeId]);

  useEffect(() => {
    followLatestRef.current = followLatest;
  }, [followLatest]);

  useEffect(() => {
    if (!open) return;
    const hydrateLayout = window.setTimeout(() => {
      const preferences = readWorldInspectorLayout();
      setView(preferences.view);
      setActorWidth(preferences.actorWidth);
      setDetailWidth(preferences.detailWidth);
      setFailureViewOverride(false);
    }, 0);
    return () => window.clearTimeout(hydrateLayout);
  }, [open]);

  const persistLayout = useCallback((next: {
    actorWidth?: number;
    detailWidth?: number;
    view?: WorldInspectorView;
  }) => {
    writeWorldInspectorLayout({
      actorWidth: next.actorWidth ?? actorWidth,
      detailWidth: next.detailWidth ?? detailWidth,
      view: next.view ?? (view === "calls" ? "timeline" : view),
    });
  }, [actorWidth, detailWidth, view]);

  const chooseView = useCallback((next: WorldInspectorView) => {
    setFailureViewOverride(false);
    setView(next);
    persistLayout({ view: next });
  }, [persistLayout]);

  const chooseCenterView = useCallback((next: CenterView) => {
    setFailureViewOverride(false);
    setView(next);
    if (next !== "calls") persistLayout({ view: next });
  }, [persistLayout]);

  const selectStep = useCallback(async (step: WorldInspectorStepSummary, nodeId = `commit:${step.revision}`) => {
    const request = ++detailRequestRef.current;
    setSelectedNodeId(nodeId);
    setSelectedInvocationId(undefined);
    setInvocationDetail(undefined);
    setInvocationError("");
    setLoadingDetail(true);
    setDetailError("");
    try {
      const value = await worldInspectorApi.step(instanceId, step.revision);
      if (request === detailRequestRef.current) setDetail({ kind: "step", value });
    } catch (reason) {
      if (request === detailRequestRef.current) {
        setDetailError(reason instanceof Error ? reason.message : "无法读取这一步的审计记录。");
      }
    } finally {
      if (request === detailRequestRef.current) setLoadingDetail(false);
    }
  }, [instanceId]);

  const selectAttempt = useCallback(async (attempt: WorldInspectorAttemptSummary) => {
    const request = ++detailRequestRef.current;
    setSelectedNodeId(`attempt:${attempt.id}`);
    setSelectedInvocationId(undefined);
    setInvocationDetail(undefined);
    setInvocationError("");
    setLoadingDetail(true);
    setDetailError("");
    try {
      const value = await worldInspectorApi.attempt(instanceId, attempt.id);
      if (request === detailRequestRef.current) setDetail({ kind: "attempt", value });
      return { kind: "attempt" as const, value };
    } catch (reason) {
      if (request === detailRequestRef.current) {
        setDetailError(reason instanceof Error ? reason.message : "这条运行记录已经过期。");
      }
      return undefined;
    } finally {
      if (request === detailRequestRef.current) setLoadingDetail(false);
    }
  }, [instanceId]);

  const loadInvocation = useCallback(async (invocation: WorldInspectorModelInvocationSummary, executionId: string) => {
    setSelectedInvocationId(invocation.id);
    setInvocationError("");
    setLoadingInvocation(true);
    try {
      const value = await worldInspectorApi.modelInvocation(instanceId, executionId, invocation.id);
      setInvocationDetail(value);
    } catch (reason) {
      setInvocationError(reason instanceof Error ? reason.message : "无法读取这次模型调用的完整记录。");
    } finally {
      setLoadingInvocation(false);
    }
  }, [instanceId]);

  const selectInvocation = useCallback(async (invocation: WorldInspectorModelInvocationSummary) => {
    const executionId = detail?.kind === "attempt"
      ? detail.value.summary.id
      : detail?.kind === "step"
        ? detail.value.committed.executionRef?.executionId
        : (invocation as WorldInspectorModelInvocationSummary & { executionId?: string }).executionId;
    if (!executionId) {
      setInvocationDetail(undefined);
      return;
    }
    await loadInvocation(invocation, executionId);
  }, [detail, loadInvocation]);

  const loadWindow = useCallback(async (preserveHistory: boolean) => {
    const request = ++requestRef.current;
    try {
      const incoming = await worldInspectorApi.window(instanceId);
      if (request !== requestRef.current) return;
      setData((current) => preserveHistory ? mergeWorldInspectorWindows(current, incoming) : incoming);
      setError("");
      const activeAttempt = [...incoming.attempts].reverse().find((attempt) => attempt.status === "active");
      const latestFailure = [...incoming.attempts].reverse().find((attempt) =>
        attempt.status !== "active" && attempt.status !== "committed");
      const latestStep = incoming.steps.at(-1);
      const failureIsCurrent = latestFailure &&
        (latestFailure.revision ?? incoming.instance.revision) >= (latestStep?.revision ?? 0);
      const nextAttempt = activeAttempt ?? (failureIsCurrent ? latestFailure : undefined);
      if (!preserveHistory) {
        if (nextAttempt) {
          setFailureViewOverride(true);
          void selectAttempt(nextAttempt);
        } else if (latestStep) {
          void selectStep(latestStep);
        }
      } else if (followLatestRef.current) {
        const nextId = nextAttempt ? `attempt:${nextAttempt.id}` : latestStep ? `commit:${latestStep.revision}` : undefined;
        if (nextAttempt && nextId !== selectedNodeRef.current) void selectAttempt(nextAttempt);
        else if (!nextAttempt && latestStep && nextId !== selectedNodeRef.current) void selectStep(latestStep);
      }
    } catch (reason) {
      if (request === requestRef.current) {
        setError(reason instanceof Error ? reason.message : "无法读取世界演化记录。");
      }
    } finally {
      if (request === requestRef.current) setLoading(false);
    }
  }, [instanceId, selectAttempt, selectStep]);

  useEffect(() => {
    if (!open) return;
    const initialLoad = window.setTimeout(() => { void loadWindow(false); }, 0);
    return () => {
      window.clearTimeout(initialLoad);
      requestRef.current += 1;
      detailRequestRef.current += 1;
      if (refreshTimerRef.current !== undefined) window.clearTimeout(refreshTimerRef.current);
    };
  }, [loadWindow, open]);

  useEffect(() => {
    if (!open) return;
    const source = new EventSource(worldInspectorApi.eventsUrl(instanceId));
    const scheduleRefresh = () => {
      if (refreshTimerRef.current !== undefined) window.clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = window.setTimeout(() => {
        refreshTimerRef.current = undefined;
        void loadWindow(true);
      }, 280);
    };
    const onRuntime = (event: MessageEvent<string>) => {
      let payload: WorldInspectorStreamEvent;
      try {
        payload = JSON.parse(event.data) as WorldInspectorStreamEvent;
      } catch {
        return;
      }
      if (payload.type !== "runtime") return;
      const type = payload.event.event;
      if (type === "step.started" || type === "step.committed" || type === "step.rolled_back" ||
        type === "step.persistence_rolled_back" || type === "run.failed") scheduleRefresh();
    };
    const onResync = () => { void loadWindow(true); };
    source.addEventListener("runtime", onRuntime as EventListener);
    source.addEventListener("resync", onResync);
    source.onopen = () => setConnection("live");
    source.onerror = () => setConnection("offline");
    return () => {
      source.close();
      source.removeEventListener("runtime", onRuntime as EventListener);
      source.removeEventListener("resync", onResync);
    };
  }, [instanceId, loadWindow, open]);

  useEffect(() => {
    if (!open || activeView !== "calls") return;
    let cancelled = false;
    void worldInspectorApi.modelInvocations(instanceId, { limit: 100, sort: "timestamp" }).then((result) => {
      if (!cancelled) {
        setQueriedInvocations(result.items);
        setInvocationCursor(result.nextCursor);
      }
    }).catch(() => {
      if (!cancelled) {
        setQueriedInvocations([]);
        setInvocationCursor(undefined);
      }
    });
    return () => { cancelled = true; };
  }, [activeView, instanceId, open]);

  const loadMoreInvocations = useCallback(async () => {
    if (!invocationCursor || loadingMoreInvocations) return;
    setLoadingMoreInvocations(true);
    try {
      const result = await worldInspectorApi.modelInvocations(instanceId, {
        cursor: invocationCursor,
        limit: 100,
        sort: "timestamp",
      });
      setQueriedInvocations((current) => {
        const seen = new Set(current.map((invocation) => invocation.id));
        return [...current, ...result.items.filter((invocation) => !seen.has(invocation.id))];
      });
      setInvocationCursor(result.nextCursor);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "无法读取更多模型调用。");
    } finally {
      setLoadingMoreInvocations(false);
    }
  }, [instanceId, invocationCursor, loadingMoreInvocations]);

  const selectNode = useCallback(async (node: WorldInspectorNodeSummary) => {
    if (!data) return;
    const attemptId = node.kind === "attempt" ? node.id.slice("attempt:".length) : node.relatedAttemptId;
    if (attemptId) {
      const attempt = data.attempts.find((candidate) => candidate.id === attemptId);
      if (attempt) {
        const selected = await selectAttempt(attempt);
        const invocation = node.relatedInvocationId && selected?.value.modelInvocations.find((candidate) =>
          candidate.id === node.relatedInvocationId);
        if (invocation) await loadInvocation(invocation, attempt.id);
      }
      return;
    }
    const step = data.steps.find((candidate) => candidate.revision === node.revision);
    if (step) void selectStep(step, node.id);
  }, [data, loadInvocation, selectAttempt, selectStep]);

  const loadOlder = useCallback(async () => {
    const beforeRevision = data?.pagination.oldestRevision;
    if (!beforeRevision || loadingOlder) return;
    setLoadingOlder(true);
    try {
      const older = await worldInspectorApi.window(instanceId, { beforeRevision: beforeRevision + 1 });
      setData((current) => mergeWorldInspectorWindows(current, older));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "无法读取更早的推演记录。");
    } finally {
      setLoadingOlder(false);
    }
  }, [data?.pagination.oldestRevision, instanceId, loadingOlder]);

  const visibleActors = useMemo(() => {
    if (!data) return [];
    const normalized = query.trim().toLocaleLowerCase();
    return data.actors.filter((actor) => !normalized || `${actor.name} ${actor.id} ${actor.description}`
      .toLocaleLowerCase().includes(normalized));
  }, [data, query]);

  const selectedActor = data?.actors.find((actor) => actor.id === selectedActorId);
  const worldActivity = useMemo(() => {
    if (!data) return { steps: 0, attempts: 0, modelInvocations: 0, retries: 0 };
    return {
      steps: data.steps.length,
      attempts: data.attempts.length,
      modelInvocations: data.attempts.reduce((sum, attempt) => sum + attempt.modelInvocationCount, 0),
      retries: data.attempts.reduce((sum, attempt) => sum + attempt.retryCount, 0),
    };
  }, [data]);
  const selectedInvocations = useMemo(() => {
    const invocations = detail?.kind === "attempt" || detail?.kind === "step"
      ? detail.value.modelInvocations
      : queriedInvocations;
    if (selectedActorId === "world") return invocations;
    return invocations.filter((invocation) => invocation.subjectId === selectedActorId ||
      invocation.slotRefs.some((slot) => slot.agentId === selectedActorId));
  }, [detail, queriedInvocations, selectedActorId]);
  const selectActor = useCallback((actorId: string) => {
    setSelectedActorId(actorId);
    setSelectedInvocationId(undefined);
    setInvocationDetail(undefined);
    setInvocationError("");
    closeActorDrawer();
  }, [closeActorDrawer]);
  const statusDescription = data
    ? `${data.instance.worldName} · Revision ${data.instance.revision} · ${data.trace.mode} trace`
    : "读取世界提交历史、Agent 演化与运行审计。";

  const returnToLatest = () => {
    setFollowLatest(true);
    if (!data) return;
    const activeAttempt = [...data.attempts].reverse().find((attempt) => attempt.status === "active");
    const latestFailure = [...data.attempts].reverse().find((attempt) =>
      attempt.status !== "active" && attempt.status !== "committed");
    const latestStep = data.steps.at(-1);
    const failureIsCurrent = latestFailure &&
      (latestFailure.revision ?? data.instance.revision) >= (latestStep?.revision ?? 0);
    const attempt = activeAttempt ?? (failureIsCurrent ? latestFailure : undefined);
    if (attempt) {
      setFailureViewOverride(true);
      void selectAttempt(attempt);
    }
    else if (latestStep) void selectStep(latestStep);
  };

  const updatePanelWidth = (panel: ResizablePanel, width: number) => {
    if (panel === "actors") setActorWidth(width);
    else setDetailWidth(width);
  };

  const resizePanel = (event: PointerEvent<HTMLDivElement>) => {
    const resize = resizeRef.current;
    if (!resize || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
    const inlineDelta = (event.clientX - resize.startX) * (document.documentElement.dir === "rtl" ? -1 : 1);
    const next = resize.panel === "actors"
      ? clampWorldInspectorActorWidth(resize.startWidth + inlineDelta)
      : clampWorldInspectorDetailWidth(resize.startWidth - inlineDelta);
    resize.currentWidth = next;
    updatePanelWidth(resize.panel, next);
  };

  const finishResize = (event: PointerEvent<HTMLDivElement>) => {
    const resize = resizeRef.current;
    if (!resize) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    resizeRef.current = undefined;
    persistLayout(resize.panel === "actors"
      ? { actorWidth: resize.currentWidth }
      : { detailWidth: resize.currentWidth });
  };

  const resizePanelWithKeyboard = (
    panel: ResizablePanel,
    currentWidth: number,
    event: KeyboardEvent<HTMLDivElement>,
  ) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    const next = resizeWorldInspectorPanelWidth(
      currentWidth,
      event.key as "ArrowLeft" | "ArrowRight" | "End" | "Home",
      panel,
      { rtl: document.documentElement.dir === "rtl", shift: event.shiftKey },
    );
    event.preventDefault();
    updatePanelWidth(panel, next);
    persistLayout(panel === "actors" ? { actorWidth: next } : { detailWidth: next });
  };

  const beginPanelResize = (
    panel: ResizablePanel,
    currentWidth: number,
    event: PointerEvent<HTMLDivElement>,
  ) => {
    resizeRef.current = {
      currentWidth,
      panel,
      startWidth: currentWidth,
      startX: event.clientX,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  return (
    <WorkspaceDialog
      closeLabel="关闭世界演化调试器"
      description={statusDescription}
      eyebrow="WORLD EVOLUTION / READ ONLY"
      onEscapeKeyDown={(event) => {
        if (!actorsOpen) return;
        event.preventDefault();
        closeActorDrawer();
      }}
      onOpenChange={onOpenChange}
      open={open}
      title="世界演化"
    >
      <div className="cg-inspector-toolbar">
        <div className="cg-inspector-view-switch" aria-label="推演视图">
          <button aria-pressed={activeView === "calls"} onClick={() => chooseCenterView("calls")} type="button">
            <Bot aria-hidden="true" /> 调用
          </button>
          <button aria-pressed={activeView === "graph"} onClick={() => chooseView("graph")} type="button">
            <Network aria-hidden="true" /> 图谱
          </button>
          <button aria-pressed={activeView === "timeline"} onClick={() => chooseView("timeline")} type="button">
            <ListTree aria-hidden="true" /> 时间线
          </button>
        </div>
        <button
          aria-controls="world-inspector-actors"
          aria-expanded={actorsOpen}
          className="cg-inspector-toolbar__button cg-inspector-actor-toggle"
          onKeyDownCapture={(event) => {
            if (event.key !== "Escape" || !actorsOpen) return;
            event.preventDefault();
            event.stopPropagation();
            closeActorDrawer();
          }}
          onClick={() => setActorsOpen((value) => !value)}
          ref={actorToggleRef}
          type="button"
        >
          <Users aria-hidden="true" /> {selectedActor?.name ?? "主体"}
        </button>
        <label className="cg-inspector-search">
          <Search aria-hidden="true" />
          <span className="cg-sr-only">搜索 Agent、节点或提交</span>
          <input onChange={(event) => setQuery(event.target.value)} placeholder="搜索 Agent、节点或 revision" type="search" value={query} />
        </label>
        <button
          aria-pressed={isolateActor}
          className="cg-inspector-toolbar__button"
          disabled={selectedActorId === "world"}
          onClick={() => setIsolateActor((value) => !value)}
          type="button"
        >
          {isolateActor ? <Users aria-hidden="true" /> : <Focus aria-hidden="true" />}
          {isolateActor ? "显示全部主体" : "聚焦此 Agent"}
        </button>
        <button
          aria-pressed={followLatest}
          className="cg-inspector-toolbar__button"
          onClick={() => followLatest ? setFollowLatest(false) : returnToLatest()}
          type="button"
        >
          <LocateFixed aria-hidden="true" /> {followLatest ? "追随最新" : "回到最新"}
        </button>
        <span className="cg-inspector-live" data-status={connection} role="status">
          <CircleDot aria-hidden="true" />
          {{ connecting: "正在连接", live: "实时", offline: "正在重连" }[connection]}
        </span>
      </div>

      {loading && !data && (
        <div className="cg-inspector-loading" role="status">
          <RefreshCw aria-hidden="true" />
          <strong>正在重放世界历史</strong>
          <span>校验 canonical truth、Agent cognition 与提交链。</span>
        </div>
      )}
      {!loading && error && !data && (
        <div className="cg-inspector-loading" role="alert">
          <Binoculars aria-hidden="true" />
          <strong>无法打开世界调试器</strong>
          <span>{error}</span>
          <button onClick={() => { setLoading(true); setError(""); void loadWindow(false); }} type="button">重新读取</button>
        </div>
      )}
      {data && (
        <div
          className="cg-inspector-shell"
          onKeyDownCapture={(event) => {
            if (event.key !== "Escape" || !actorsOpen) return;
            event.stopPropagation();
            closeActorDrawer();
          }}
          style={{
            "--cg-inspector-actor-width": `${actorWidth}px`,
            "--cg-inspector-detail-width": `${detailWidth}px`,
          } as CSSProperties}
        >
          <button
            aria-label="关闭主体列表"
            className="cg-inspector-actor-scrim"
            data-open={actorsOpen || undefined}
            onClick={closeActorDrawer}
            tabIndex={actorsOpen ? 0 : -1}
            type="button"
          />
          <aside
            aria-hidden={narrow && !actorsOpen || undefined}
            aria-label="主体选择"
            className="cg-inspector-actors"
            data-open={actorsOpen || undefined}
            id="world-inspector-actors"
            inert={narrow && !actorsOpen || undefined}
          >
            <button
              aria-pressed={selectedActorId === "world"}
              className="cg-inspector-actor cg-inspector-actor--world"
              onClick={() => { selectActor("world"); setIsolateActor(false); }}
              type="button"
            >
              <span><GitBranch aria-hidden="true" /></span>
              <span><strong>整个世界</strong><small>{worldActivity.steps} 个提交 · {worldActivity.attempts} 次尝试 · {worldActivity.modelInvocations} 次调用 · {worldActivity.retries} 次 retry</small></span>
            </button>
            <div className="cg-inspector-actor-list">
              {visibleActors.map((actor) => {
                const activity = actorActivity(actor.id, actor, data.steps, data.attempts);
                return (
                  <button
                    aria-pressed={selectedActorId === actor.id}
                    className="cg-inspector-actor"
                    key={actor.id}
                    onClick={() => selectActor(actor.id)}
                    type="button"
                  >
                    <span className="cg-inspector-actor__sigil">{actor.name.slice(0, 1).toLocaleUpperCase()}</span>
                    <span>
                      <strong>{actor.name}</strong>
                      <small>{activity.steps} 个提交 · {activity.attempts} 次尝试 · {activity.modelInvocations} 次调用 · {activity.retries} 次 retry</small>
                    </span>
                    <i data-lifecycle={actor.lifecycle} title={actor.lifecycle} />
                  </button>
                );
              })}
            </div>
            <footer>
              <span><ArrowDownToLine aria-hidden="true" /> {data.trace.retainedEventCount} 条追踪事件</span>
              <span>{data.trace.mode} · {data.trace.degraded ? "降级" : "完整"}</span>
            </footer>
          </aside>

          <InspectorResizer
            label="调整主体列表宽度"
            maximum={WORLD_INSPECTOR_ACTOR_MAX}
            minimum={WORLD_INSPECTOR_ACTOR_MIN}
            onKeyDown={(event) => resizePanelWithKeyboard("actors", actorWidth, event)}
            onPointerCancel={finishResize}
            onPointerDown={(event) => beginPanelResize("actors", actorWidth, event)}
            onPointerMove={resizePanel}
            onPointerUp={finishResize}
            value={actorWidth}
          />

          <section className="cg-inspector-stage" aria-label={`${selectedActor?.name ?? "整个世界"}推演记录`}>
            {activeView === "calls" ? (
              <>
                {loadingInvocation && <p className="cg-inspector-stage__status" role="status">正在读取这次模型调用的完整记录…</p>}
                {invocationError && <p className="cg-inspector-stage__warning" role="alert">{invocationError}</p>}
                <WorldInspectorInvocationList
                  hasMore={!detail && invocationCursor !== undefined}
                  invocations={selectedInvocations}
                  loadingMore={loadingMoreInvocations}
                  onSelect={(invocation) => { setFollowLatest(false); void selectInvocation(invocation); }}
                  onLoadMore={() => void loadMoreInvocations()}
                  query={query}
                  selectedId={selectedInvocationId}
                />
              </>
            ) : activeView === "graph" ? (
              <WorldInspectorGraph
                actors={data.actors}
                edges={data.edges}
                followLatest={followLatest}
                isolateActor={isolateActor}
                nodes={data.nodes}
                onInteract={() => setFollowLatest(false)}
                onSelect={(node) => { setFollowLatest(false); selectNode(node); }}
                query={query}
                reduceMotion={reduceMotion}
                selectedActorId={selectedActorId}
                selectedNodeId={selectedNodeId}
              />
            ) : (
              <WorldInspectorTimeline
                attempts={data.attempts}
                hasOlder={data.pagination.hasOlder}
                loadingOlder={loadingOlder}
                onLoadOlder={() => void loadOlder()}
                onSelectAttempt={(attempt) => { setFollowLatest(false); void selectAttempt(attempt); }}
                onSelectStep={(step) => { setFollowLatest(false); void selectStep(step); }}
                query={query}
                selectedActorId={selectedActorId}
                selectedId={selectedNodeId}
                steps={data.steps}
              />
            )}
            {error && <p className="cg-inspector-stage__warning" role="alert">{error}</p>}
          </section>

          <InspectorResizer
            label="调整推演详情宽度"
            maximum={WORLD_INSPECTOR_DETAIL_MAX}
            minimum={WORLD_INSPECTOR_DETAIL_MIN}
            onKeyDown={(event) => resizePanelWithKeyboard("detail", detailWidth, event)}
            onPointerCancel={finishResize}
            onPointerDown={(event) => beginPanelResize("detail", detailWidth, event)}
            onPointerMove={resizePanel}
            onPointerUp={finishResize}
            value={detailWidth}
          />

          <WorldInspectorDetail
            actorId={selectedActorId}
            actorName={selectedActor?.name ?? (selectedActorId === "world" ? "整个世界" : selectedActorId)}
            detail={detail}
            error={detailError}
            invocation={invocationDetail}
            key={selectedNodeId ?? "empty"}
            loading={loadingDetail}
            onSelectInvocation={(invocation) => { setView("calls"); void selectInvocation(invocation); }}
            instanceId={instanceId}
          />
        </div>
      )}
    </WorkspaceDialog>
  );
}
