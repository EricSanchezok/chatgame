"use client";

import {
  ArrowDownToLine,
  Binoculars,
  Bot,
  ChevronLeft,
  ChevronRight,
  CircleDot,
  Focus,
  GitBranch,
  ListTree,
  LocateFixed,
  Network,
  Pause,
  Play,
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
  WorldInspectorEdgeSummary,
  WorldInspectorNodeSummary,
  WorldInspectorStepDetail,
  WorldInspectorStepSummary,
  WorldInspectorStreamEvent,
  WorldInspectorReplay,
  WorldInspectorWindow,
} from "../../shared/world-inspector-api";
import { mergeWorldInspectorWindows } from "../_lib/world-inspector-window";
import { worldInspectorInvocationExecutionId } from "../_lib/world-inspector-invocation";
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
import { WorldInspectorDetail, type WorldInspectorSelection } from "./world-inspector-detail";
import { WorldInspectorGraph } from "./world-inspector-graph";
import { WorldInspectorInvocationList, type WorldInspectorInvocationListItem } from "./world-inspector-invocation-list";
import { WorldInspectorSelect } from "./world-inspector-select";
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

function InspectorCollectionHeader({
  actorName,
  data,
  view,
}: {
  actorName: string;
  data: WorldInspectorWindow;
  view: Exclude<CenterView, "calls">;
}) {
  const config = view === "timeline"
    ? { title: "世界演化流程", description: "按 Run → Boundary → Stage 展开，最新更新置顶", firstLabel: "尝试", first: `${data.attempts.length}`, secondLabel: "提交", second: `${data.steps.length}` }
    : { title: "世界演化图谱", description: "先看可解释的语义主链，再按需展开底层证据", firstLabel: "语义节点", first: `${data.semanticNodes?.length ?? 0}`, secondLabel: "关系", second: `${data.semanticEdges?.length ?? 0}` };
  return (
    <header className="cg-inspector-collection-header">
      <div>
        <span>当前范围 · {actorName}</span>
        <h2>{config.title}</h2>
        <p>{config.description}</p>
      </div>
      <dl>
        <div><dt>{config.firstLabel}</dt><dd>{config.first}</dd></div>
        <div><dt>{config.secondLabel}</dt><dd>{config.second}</dd></div>
      </dl>
    </header>
  );
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
  const selectionRef = useRef<WorldInspectorSelection>(null);
  const detailRef = useRef<InspectorDetail | undefined>(undefined);
  const activeViewRef = useRef<CenterView>("calls");
  const invocationRequestRef = useRef(0);
  const invocationDetailRequestRef = useRef(0);
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
  const [selection, setSelection] = useState<WorldInspectorSelection>(null);
  const [view, setView] = useState<CenterView>("calls");
  const [graphMode, setGraphMode] = useState<"semantic" | "technical">("semantic");
  const [technicalNodeLimit, setTechnicalNodeLimit] = useState<100 | 200 | 500 | 1000>(200);
  const [replay, setReplay] = useState<WorldInspectorReplay>();
  const [replayFrameIndex, setReplayFrameIndex] = useState(0);
  const [replayPlaying, setReplayPlaying] = useState(false);
  const [replayRate, setReplayRate] = useState<1 | 4 | 16>(1);
  const [actorWidth, setActorWidth] = useState(WORLD_INSPECTOR_ACTOR_DEFAULT);
  const [detailWidth, setDetailWidth] = useState(WORLD_INSPECTOR_DETAIL_DEFAULT);
  const activeView: CenterView = view;
  const replayFrame = replay?.frames[replayFrameIndex];
  const replaySemanticNodes = useMemo<WorldInspectorNodeSummary[]>(() => replay?.frames.map((frame) => ({
    id: frame.nodeIds[0] ?? `semantic:stage:${replay.executionId}:${frame.stageIndex}`,
    revision: data?.instance.revision ?? 0,
    laneId: "world",
    kind: "stage",
    label: `${frame.stageIndex + 1}. ${frame.stageLabel}`,
    description: frame.derived
      ? `由已有 Ledger 证据推导 · ${frame.eventIds.length} 条事件`
      : `${frame.eventIds.length} 条事件 · ${frame.invocationIds.length} 次逻辑调用`,
    ...(frame.status === "pending" ? {} : { status: frame.status }),
    relatedAttemptId: replay.executionId,
  })) ?? [], [data?.instance, replay]);
  const replaySemanticEdges = useMemo<WorldInspectorEdgeSummary[]>(() => replaySemanticNodes.slice(1).map((node, index) => ({
    id: `semantic:replay:${replaySemanticNodes[index].id}:${node.id}`,
    source: replaySemanticNodes[index].id,
    target: node.id,
    kind: "causal",
    label: "推进",
  })), [replaySemanticNodes]);
  const semanticNodes = useMemo(
    () => replay ? replaySemanticNodes : data?.semanticNodes ?? [],
    [data?.semanticNodes, replay, replaySemanticNodes],
  );
  const semanticEdges = useMemo(
    () => replay ? replaySemanticEdges : data?.semanticEdges ?? [],
    [data?.semanticEdges, replay, replaySemanticEdges],
  );
  const technicalNodes = useMemo(() => {
    const nodes = data?.nodes ?? [];
    if (!replay || !replayFrame) return nodes;
    const invocationIds = new Set(replayFrame.invocationIds);
    const stageNodeId = `stage:${replay.executionId}:stage:${replayFrame.stageIndex}`;
    return nodes.filter((node) => node.id === `attempt:${replay.executionId}` ||
      node.id === stageNodeId || node.relatedInvocationId && invocationIds.has(node.relatedInvocationId));
  }, [data?.nodes, replay, replayFrame]);
  const selectedNodeId = replayFrame?.nodeIds[0] ?? (selection?.kind === "attempt"
    ? `attempt:${selection.id}`
    : selection?.kind === "step"
      ? `commit:${selection.revision}`
      : selection?.kind === "node" ? selection.id : undefined);
  const effectiveSelection: WorldInspectorSelection = selection?.kind === "invocation"
    ? selection
    : replayFrame && selectedNodeId ? { kind: "node", id: selectedNodeId } : selection;
  const selectedInvocationId = selection?.kind === "invocation" ? selection.id : undefined;
  const selectedGraphNode = effectiveSelection?.kind === "node"
    ? [...semanticNodes, ...technicalNodes].find((node) => node.id === effectiveSelection.id)
    : undefined;
  const graphNodeRelations = useMemo(() => {
    if (!selectedGraphNode || !data) return undefined;
    const graphNodes = graphMode === "semantic" ? semanticNodes : technicalNodes;
    const graphEdges = graphMode === "semantic" ? semanticEdges : data.edges;
    const byId = new Map(graphNodes.map((node) => [node.id, node]));
    return {
      upstream: graphEdges
        .filter((edge) => edge.target === selectedGraphNode.id)
        .map((edge) => byId.get(edge.source))
        .filter((node): node is WorldInspectorNodeSummary => node !== undefined),
      downstream: graphEdges
        .filter((edge) => edge.source === selectedGraphNode.id)
        .map((edge) => byId.get(edge.target))
        .filter((node): node is WorldInspectorNodeSummary => node !== undefined),
    };
  }, [data, graphMode, selectedGraphNode, semanticEdges, semanticNodes, technicalNodes]);
  const closeActorDrawer = useCallback(() => {
    setActorsOpen(false);
    if (narrow) requestAnimationFrame(() => actorToggleRef.current?.focus());
  }, [narrow]);

  useEffect(() => {
    selectionRef.current = selection;
  }, [selection]);

  useEffect(() => {
    detailRef.current = detail;
  }, [detail]);

  useEffect(() => {
    followLatestRef.current = followLatest;
  }, [followLatest]);

  useEffect(() => {
    activeViewRef.current = activeView;
  }, [activeView]);

  useEffect(() => {
    if (!open) return;
    const hydrateLayout = window.setTimeout(() => {
      const preferences = readWorldInspectorLayout();
      setView(preferences.view);
      setActorWidth(preferences.actorWidth);
      setDetailWidth(preferences.detailWidth);
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
    setView(next);
    persistLayout({ view: next });
    if (selection?.kind === "invocation") {
      setSelection(null);
      setInvocationDetail(undefined);
      setInvocationError("");
    }
  }, [persistLayout, selection]);

  const chooseCenterView = useCallback((next: CenterView) => {
    setView(next);
    if (next !== "calls") persistLayout({ view: next });
    if (next === "calls") {
      if (selection?.kind !== "invocation") {
        setSelection(null);
        setDetail(undefined);
        setDetailError("");
      }
    } else if (selection?.kind === "invocation") {
      setSelection(null);
      setInvocationDetail(undefined);
      setInvocationError("");
    }
  }, [persistLayout, selection]);

  const selectStep = useCallback(async (step: WorldInspectorStepSummary, nodeId = `commit:${step.revision}`) => {
    const request = ++detailRequestRef.current;
    invocationDetailRequestRef.current += 1;
    setSelection(nodeId === `commit:${step.revision}`
      ? { kind: "step", revision: step.revision }
      : { kind: "node", id: nodeId });
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

  const loadInvocation = useCallback(async (invocation: WorldInspectorModelInvocationSummary, executionId: string) => {
    const request = ++invocationDetailRequestRef.current;
    setSelection({ kind: "invocation", id: invocation.id, executionId });
    setInvocationError("");
    setLoadingInvocation(true);
    try {
      const value = await worldInspectorApi.modelInvocation(instanceId, executionId, invocation.id);
      if (request === invocationDetailRequestRef.current) setInvocationDetail(value);
    } catch (reason) {
      if (request === invocationDetailRequestRef.current) {
        setInvocationError(reason instanceof Error ? reason.message : "无法读取这次模型调用的完整记录。");
      }
    } finally {
      if (request === invocationDetailRequestRef.current) setLoadingInvocation(false);
    }
  }, [instanceId]);

  const selectAttempt = useCallback(async (attempt: WorldInspectorAttemptSummary, preserveInvocation = false) => {
    const request = ++detailRequestRef.current;
    const preservedInvocationId = preserveInvocation && selectionRef.current?.kind === "invocation"
      ? selectionRef.current.id : undefined;
    if (!preservedInvocationId) setSelection({ kind: "attempt", id: attempt.id });
    if (!preserveInvocation) {
      invocationDetailRequestRef.current += 1;
      setSelection({ kind: "attempt", id: attempt.id });
      setInvocationDetail(undefined);
      setInvocationError("");
    }
    setLoadingDetail(true);
    setDetailError("");
    try {
      const value = await worldInspectorApi.attempt(instanceId, attempt.id);
      if (request === detailRequestRef.current) {
        setDetail({ kind: "attempt", value });
        if (preservedInvocationId) {
          const refreshedInvocation = value.modelInvocations.find((invocation) => invocation.id === preservedInvocationId);
          if (refreshedInvocation) void loadInvocation(refreshedInvocation, attempt.id);
          else {
            setSelection({ kind: "attempt", id: attempt.id });
            setInvocationDetail(undefined);
          }
        }
      }
      return { kind: "attempt" as const, value };
    } catch (reason) {
      if (request === detailRequestRef.current) {
        setDetailError(reason instanceof Error ? reason.message : "这条运行记录已经过期。");
      }
      return undefined;
    } finally {
      if (request === detailRequestRef.current) setLoadingDetail(false);
    }
  }, [instanceId, loadInvocation]);

  const openReplay = useCallback(async (attempt: WorldInspectorAttemptSummary) => {
    setError("");
    try {
      const value = await worldInspectorApi.replay(instanceId, attempt.id);
      setReplay(value);
      setReplayFrameIndex(0);
      setReplayPlaying(false);
      setView("timeline");
      await selectAttempt(attempt);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "无法读取这次执行的回放。");
    }
  }, [instanceId, selectAttempt]);

  const selectInvocation = useCallback(async (invocation: WorldInspectorInvocationListItem) => {
    const executionId = worldInspectorInvocationExecutionId(invocation) ?? (detail?.kind === "attempt"
      ? detail.value.summary.id
      : detail?.kind === "step"
        ? detail.value.committed.executionRef?.executionId
        : undefined);
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
        if (activeViewRef.current === "calls") {
          setSelection(null);
          setDetail(undefined);
          setDetailError("");
          setInvocationDetail(undefined);
          setInvocationError("");
        } else if (nextAttempt) {
          void selectAttempt(nextAttempt);
        } else if (latestStep) {
          void selectStep(latestStep);
        }
      } else if (followLatestRef.current) {
        const currentSelection = selectionRef.current;
        if (currentSelection?.kind === "invocation") return;
        const nextId = nextAttempt ? `attempt:${nextAttempt.id}` : latestStep ? `commit:${latestStep.revision}` : undefined;
        const currentNodeId = currentSelection?.kind === "attempt"
          ? `attempt:${currentSelection.id}`
          : currentSelection?.kind === "step"
            ? `commit:${currentSelection.revision}`
            : currentSelection?.kind === "node" ? currentSelection.id : undefined;
        if (nextAttempt && nextId !== currentNodeId) void selectAttempt(nextAttempt);
        else if (nextAttempt && nextId === currentNodeId && detailRef.current?.kind === "attempt" &&
          detailRef.current.value.summary.id === nextAttempt.id) void selectAttempt(nextAttempt, true);
        else if (!nextAttempt && latestStep && nextId !== currentNodeId) void selectStep(latestStep);
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
      invocationRequestRef.current += 1;
      invocationDetailRequestRef.current += 1;
      if (refreshTimerRef.current !== undefined) window.clearTimeout(refreshTimerRef.current);
    };
  }, [loadWindow, open]);

  const loadInvocations = useCallback(async () => {
    const request = ++invocationRequestRef.current;
    try {
      const result = await worldInspectorApi.modelInvocations(instanceId, { limit: 100, sort: "stage" });
      if (request !== invocationRequestRef.current) return;
      setQueriedInvocations(result.items);
      setInvocationCursor(result.nextCursor);
    } catch {
      if (request !== invocationRequestRef.current) return;
      setQueriedInvocations([]);
      setInvocationCursor(undefined);
    }
  }, [instanceId]);

  useEffect(() => {
    if (!open) return;
    const source = new EventSource(worldInspectorApi.eventsUrl(instanceId));
    const scheduleRefresh = () => {
      if (refreshTimerRef.current !== undefined) window.clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = window.setTimeout(() => {
        refreshTimerRef.current = undefined;
        void loadWindow(true);
        void loadInvocations();
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
      if (type.startsWith("model.") || type.startsWith("step.") || type.startsWith("run.") ||
        type.startsWith("execution.") || type.startsWith("stage.") || type.startsWith("instance.bootstrap.") || type === "arrival.generated") scheduleRefresh();
    };
    const onResync = () => {
      void loadWindow(true);
      void loadInvocations();
    };
    source.addEventListener("runtime", onRuntime as EventListener);
    source.addEventListener("resync", onResync);
    source.onopen = () => setConnection("live");
    source.onerror = () => setConnection("offline");
    return () => {
      source.close();
      source.removeEventListener("runtime", onRuntime as EventListener);
      source.removeEventListener("resync", onResync);
    };
  }, [instanceId, loadInvocations, loadWindow, open]);

  useEffect(() => {
    if (!open || activeView !== "calls") return;
    const refresh = window.setTimeout(() => { void loadInvocations(); }, 0);
    return () => window.clearTimeout(refresh);
  }, [activeView, loadInvocations, open]);

  const loadMoreInvocations = useCallback(async () => {
    if (!invocationCursor || loadingMoreInvocations) return;
    setLoadingMoreInvocations(true);
    try {
      const result = await worldInspectorApi.modelInvocations(instanceId, {
        cursor: invocationCursor,
        limit: 100,
        sort: "stage",
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
        await selectAttempt(attempt);
        setSelection({ kind: "node", id: node.id });
      }
      return;
    }
    const step = data.steps.find((candidate) => candidate.revision === node.revision);
    if (step) void selectStep(step, node.id);
  }, [data, selectAttempt, selectStep]);

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
    const scoped = replayFrame
      ? invocations.filter((invocation) => replayFrame.invocationIds.includes(invocation.id) || invocation.logicalStageIndex === replayFrame.stageIndex)
      : invocations;
    if (selectedActorId === "world") return scoped;
    return scoped.filter((invocation) => invocation.subjectId === selectedActorId ||
      invocation.slotRefs.some((slot) => slot.agentId === selectedActorId));
  }, [detail, queriedInvocations, replayFrame, selectedActorId]);

  useEffect(() => {
    if (!replay || !open) return;
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        setReplayFrameIndex((index) => Math.max(0, index - 1));
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        setReplayFrameIndex((index) => Math.min(replay.frames.length - 1, index + 1));
      } else if (event.key === "Home") {
        event.preventDefault();
        setReplayFrameIndex(0);
      } else if (event.key === "End") {
        event.preventDefault();
        setReplayFrameIndex(replay.frames.length - 1);
      } else return;
      setFollowLatest(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, replay]);

  useEffect(() => {
    if (!replayPlaying || !replay) return;
    const timer = window.setInterval(() => {
      setReplayFrameIndex((index) => {
        if (index >= replay.frames.length - 1) {
          setReplayPlaying(false);
          return index;
        }
        return index + 1;
      });
    }, Math.max(60, 700 / replayRate));
    return () => window.clearInterval(timer);
  }, [replay, replayPlaying, replayRate]);

  const selectActor = useCallback((actorId: string) => {
    setSelectedActorId(actorId);
    invocationDetailRequestRef.current += 1;
    setSelection(null);
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
            <ListTree aria-hidden="true" /> 流程
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
            {replay && (
              <div className="cg-inspector-replay" aria-label="执行回放控制">
                <strong>回放 · {replayFrame ? `${replayFrame.stageIndex + 1} / ${replay.frames.length} · ${replayFrame.stageLabel}` : "准备中"}</strong>
                <button aria-label="上一阶段" disabled={replayFrameIndex <= 0} onClick={() => setReplayFrameIndex((index) => Math.max(0, index - 1))} type="button"><ChevronLeft aria-hidden="true" /></button>
                <button aria-label={replayPlaying ? "暂停回放" : "播放回放"} onClick={() => setReplayPlaying((value) => !value)} type="button">
                  {replayPlaying ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}
                </button>
                <button aria-label="下一阶段" disabled={replayFrameIndex >= replay.frames.length - 1} onClick={() => setReplayFrameIndex((index) => Math.min(replay.frames.length - 1, index + 1))} type="button"><ChevronRight aria-hidden="true" /></button>
                <input aria-label="回放阶段" max={Math.max(0, replay.frames.length - 1)} min={0} onChange={(event) => setReplayFrameIndex(Number(event.target.value))} type="range" value={replayFrameIndex} />
                <WorldInspectorSelect
                  ariaLabel="回放速度"
                  onChange={(value) => setReplayRate(value as 1 | 4 | 16)}
                  options={[{ value: 1, label: "1x" }, { value: 4, label: "4x" }, { value: 16, label: "16x" }]}
                  value={replayRate}
                />
                <button onClick={() => { setReplay(undefined); setReplayPlaying(false); returnToLatest(); }} type="button">退出回放</button>
              </div>
            )}
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
                  scopeLabel={selectedActor?.name ?? "整个世界"}
                />
              </>
            ) : activeView === "graph" ? (
              <>
                <InspectorCollectionHeader actorName={selectedActor?.name ?? "整个世界"} data={data} view="graph" />
                <div className="cg-inspector-graph-mode" aria-label="图谱层级">
                  <button aria-pressed={graphMode === "semantic"} onClick={() => setGraphMode("semantic")} type="button">语义主链</button>
                  <button aria-pressed={graphMode === "technical"} onClick={() => setGraphMode("technical")} type="button">技术证据图（{data.nodes.length} 节点）</button>
                  {graphMode === "technical" && (
                    <label>节点上限
                      <WorldInspectorSelect
                        ariaLabel="节点上限"
                        onChange={(value) => setTechnicalNodeLimit(value as typeof technicalNodeLimit)}
                        options={[{ value: 100, label: "100" }, { value: 200, label: "200" }, { value: 500, label: "500" }, { value: 1000, label: "1000" }]}
                        value={technicalNodeLimit}
                      />
                    </label>
                  )}
                  {replayFrame && <span>当前阶段 {replayFrame.stageIndex + 1} · {replayFrame.stageLabel}</span>}
                </div>
                <WorldInspectorGraph
                  actors={data.actors}
                  edges={data.edges}
                  mode={graphMode}
                  nodeLimit={technicalNodeLimit}
                  semanticEdges={semanticEdges}
                  semanticNodes={semanticNodes}
                  followLatest={followLatest}
                  isolateActor={isolateActor}
                  nodes={technicalNodes}
                  onInteract={() => setFollowLatest(false)}
                  onSelect={(node) => { setFollowLatest(false); selectNode(node); }}
                  query={query}
                  reduceMotion={reduceMotion}
                  selectedActorId={selectedActorId}
                  selectedNodeId={selectedNodeId}
                />
              </>
            ) : (
              <>
                <InspectorCollectionHeader actorName={selectedActor?.name ?? "整个世界"} data={data} view="timeline" />
                <WorldInspectorTimeline
                  attempts={data.attempts}
                  hasOlder={data.pagination.hasOlder}
                  loadingOlder={loadingOlder}
                  onLoadOlder={() => void loadOlder()}
                  onReplay={(attempt) => void openReplay(attempt)}
                  onSelectAttempt={(attempt) => { setFollowLatest(false); void selectAttempt(attempt); }}
                  onSelectStep={(step) => { setFollowLatest(false); void selectStep(step); }}
                  query={query}
                  selectedActorId={selectedActorId}
                  selectedId={selectedNodeId}
                  steps={data.steps}
                />
              </>
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
            error={effectiveSelection?.kind === "invocation" ? invocationError : detailError}
            invocation={invocationDetail}
            node={selectedGraphNode}
            nodeRelations={graphNodeRelations}
            key={effectiveSelection ? `${effectiveSelection.kind}:${"id" in effectiveSelection ? effectiveSelection.id : "revision" in effectiveSelection ? effectiveSelection.revision : "empty"}` : "empty"}
            loading={effectiveSelection?.kind === "invocation" ? loadingInvocation : loadingDetail}
            onSelectInvocation={(invocation) => { setView("calls"); void selectInvocation(invocation); }}
            instanceId={instanceId}
            selection={effectiveSelection}
          />
        </div>
      )}
    </WorkspaceDialog>
  );
}
