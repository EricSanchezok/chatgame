"use client";

import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Panel,
  Position,
  ReactFlow,
  getViewportForBounds,
  type Edge,
  type Node,
  type NodeProps,
  type ReactFlowInstance,
} from "@xyflow/react";
import ELK, { type ELK as ElkLayoutEngine } from "elkjs/lib/elk-api.js";
import {
  Activity,
  BadgeCheck,
  Braces,
  BrainCircuit,
  CircleDotDashed,
  Dices,
  Eye,
  GitCommitHorizontal,
  GitPullRequestArrow,
  Orbit,
  Sparkles,
  Waypoints,
  Wrench,
} from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import type {
  WorldInspectorActor,
  WorldInspectorEdgeSummary,
  WorldInspectorNodeKind,
  WorldInspectorNodeSummary,
} from "../../shared/world-inspector-api";
import { worldInspectorFallbackPositions } from "../_lib/world-inspector-layout";

interface InspectorNodeData extends Record<string, unknown> {
  actorName: string;
  dimmed: boolean;
  onSelect: (summary: WorldInspectorNodeSummary) => void;
  selected: boolean;
  summary: WorldInspectorNodeSummary;
}

type InspectorFlowNode = Node<InspectorNodeData, "inspector">;

const inspectorNodeWidth = 238;
const inspectorNodeHeight = 86;
const inspectorMinZoom = 0.01;
const inspectorHandleSize = 6;
const inspectorNodeHandles: NonNullable<InspectorFlowNode["handles"]> = [
  {
    type: "target",
    position: Position.Left,
    x: -inspectorHandleSize / 2,
    y: (inspectorNodeHeight - inspectorHandleSize) / 2,
    width: inspectorHandleSize,
    height: inspectorHandleSize,
  },
  {
    type: "source",
    position: Position.Right,
    x: inspectorNodeWidth - inspectorHandleSize / 2,
    y: (inspectorNodeHeight - inspectorHandleSize) / 2,
    width: inspectorHandleSize,
    height: inspectorHandleSize,
  },
];

const iconByKind: Record<WorldInspectorNodeKind, typeof Orbit> = {
  commit: GitCommitHorizontal,
  action: Activity,
  reaction: GitPullRequestArrow,
  check: BadgeCheck,
  random: Dices,
  mechanic: Wrench,
  operation: Waypoints,
  event: Sparkles,
  observation: Eye,
  mind: BrainCircuit,
  attempt: CircleDotDashed,
  stage: Waypoints,
  model_invocation: BrainCircuit,
  transport_attempt: Activity,
  validation: BadgeCheck,
  artifact: Braces,
};

function InspectorNode({ data }: NodeProps<InspectorFlowNode>) {
  const Icon = iconByKind[data.summary.kind];
  const moveFocus = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (!["ArrowLeft", "ArrowUp", "ArrowRight", "ArrowDown", "Home", "End"].includes(event.key)) return;
    const graph = event.currentTarget.closest(".cg-inspector-graph");
    const buttons = [...(graph?.querySelectorAll<HTMLButtonElement>(".cg-inspector-node__button") ?? [])];
    const current = buttons.indexOf(event.currentTarget);
    if (current < 0 || buttons.length === 0) return;
    const target = event.key === "Home"
      ? 0
      : event.key === "End"
        ? buttons.length - 1
        : (current + (event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 1) + buttons.length) % buttons.length;
    event.preventDefault();
    buttons[target]?.focus();
  };
  return (
    <>
      <Handle aria-hidden="true" className="cg-inspector-node__handle" position={Position.Left} type="target" />
      <button
        aria-label={`${data.actorName}，${data.summary.label}，${data.summary.description}`}
        aria-pressed={data.selected}
        className="cg-inspector-node__button nodrag"
        data-dimmed={data.dimmed || undefined}
        data-kind={data.summary.kind}
        data-selected={data.selected || undefined}
        data-status={data.summary.status}
        onClick={() => data.onSelect(data.summary)}
        onKeyDown={moveFocus}
        type="button"
      >
        <span className="cg-inspector-node__icon"><Icon aria-hidden="true" /></span>
        <span className="cg-inspector-node__copy">
          <span className="cg-inspector-node__meta">
            <span>{data.actorName}</span>
            <span>R{data.summary.revision}</span>
          </span>
          <strong>{data.summary.label}</strong>
          <span>{data.summary.description}</span>
        </span>
        {data.summary.count !== undefined && <span className="cg-inspector-node__count">{data.summary.count}</span>}
      </button>
      <Handle aria-hidden="true" className="cg-inspector-node__handle" position={Position.Right} type="source" />
    </>
  );
}

const nodeTypes = { inspector: InspectorNode };

const minimapColorByKind: Record<WorldInspectorNodeKind, string> = {
  commit: "var(--cg-inspector-world)",
  action: "var(--cg-inspector-action)",
  reaction: "var(--cg-inspector-action)",
  check: "var(--cg-inspector-check)",
  random: "var(--cg-inspector-check)",
  mechanic: "var(--cg-inspector-check)",
  operation: "var(--cg-inspector-world)",
  event: "var(--cg-inspector-world)",
  observation: "var(--cg-inspector-mind)",
  mind: "var(--cg-inspector-mind)",
  attempt: "var(--cg-inspector-attempt)",
  stage: "var(--cg-inspector-world)",
  model_invocation: "var(--cg-inspector-mind)",
  transport_attempt: "var(--cg-inspector-attempt)",
  validation: "var(--cg-inspector-check)",
  artifact: "var(--cg-inspector-world)",
};

type SemanticZoom = "far" | "mid" | "near";

function semanticZoomLevel(zoom: number): SemanticZoom {
  if (zoom < 0.42) return "far";
  if (zoom < 0.86) return "mid";
  return "near";
}

export function WorldInspectorGraph({
  actors,
  edges: sourceEdges,
  followLatest,
  isolateActor,
  nodes: sourceNodes,
  onInteract,
  onSelect,
  query,
  reduceMotion,
  selectedActorId,
  selectedNodeId,
}: {
  actors: WorldInspectorActor[];
  edges: WorldInspectorEdgeSummary[];
  followLatest: boolean;
  isolateActor: boolean;
  nodes: WorldInspectorNodeSummary[];
  onInteract: () => void;
  onSelect: (node: WorldInspectorNodeSummary) => void;
  query: string;
  reduceMotion: boolean;
  selectedActorId: string;
  selectedNodeId?: string;
}) {
  const { resolvedTheme } = useTheme();
  const elkRef = useRef<ElkLayoutEngine | null>(null);
  const graphRef = useRef<HTMLDivElement>(null);
  const hasFittedInitialLayoutRef = useRef(false);
  const requestIdRef = useRef(0);
  const instanceRef = useRef<ReactFlowInstance<InspectorFlowNode, Edge> | null>(null);
  const [flowReady, setFlowReady] = useState(false);
  const [positions, setPositions] = useState<Record<string, { x: number; y: number }>>({});
  const [settledLayoutSignature, setSettledLayoutSignature] = useState<string>();
  const [semanticZoom, setSemanticZoom] = useState<SemanticZoom>("mid");
  const actorNames = useMemo(() => new Map([
    ["world", "世界"],
    ...actors.map((actor) => [actor.id, actor.name] as const),
  ]), [actors]);
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const scopedSourceNodes = useMemo(() => {
    if (selectedNodeId?.startsWith("attempt:")) {
      const attemptId = selectedNodeId.slice("attempt:".length);
      return sourceNodes.filter((node) => node.id === selectedNodeId || node.relatedAttemptId === attemptId);
    }
    if (selectedNodeId?.startsWith("commit:")) {
      const revision = Number(selectedNodeId.slice("commit:".length));
      if (Number.isSafeInteger(revision)) return sourceNodes.filter((node) => node.revision === revision);
    }
    return sourceNodes;
  }, [selectedNodeId, sourceNodes]);
  const visibleSummaries = useMemo(() => scopedSourceNodes.filter((node) =>
    !isolateActor || selectedActorId === "world" || node.laneId === selectedActorId ||
    (node.laneId === "world" && node.kind !== "attempt") || node.relatedActorIds?.includes(selectedActorId)),
  [isolateActor, selectedActorId, scopedSourceNodes]);
  const visibleIds = useMemo(() => new Set(visibleSummaries.map((node) => node.id)), [visibleSummaries]);
  const visibleEdges = useMemo(() => sourceEdges.filter((edge) =>
    visibleIds.has(edge.source) && visibleIds.has(edge.target)), [sourceEdges, visibleIds]);
  const layoutSignature = useMemo(() => [
    visibleSummaries.map((node) => node.id).join("|"),
    visibleEdges.map((edge) => edge.id).join("|"),
  ].join("::"), [visibleEdges, visibleSummaries]);
  const provisionalPositions = useMemo(() => worldInspectorFallbackPositions(visibleSummaries, visibleEdges),
    [visibleEdges, visibleSummaries]);

  useEffect(() => {
    const worker = new Worker(new URL("../_workers/world-inspector-layout.worker.ts", import.meta.url), {
      type: "module",
    });
    const elk = new ELK({ algorithms: ["layered"], workerFactory: () => worker });
    elkRef.current = elk;
    return () => {
      elk.terminateWorker();
      elkRef.current = null;
    };
  }, []);

  useEffect(() => {
    const elk = elkRef.current;
    if (!elk || visibleSummaries.length === 0) {
      setPositions({});
      setSettledLayoutSignature(undefined);
      return;
    }
    const id = ++requestIdRef.current;
    let cancelled = false;
    void elk.layout({
      id: `world-inspector:${id}`,
      layoutOptions: {
        "elk.algorithm": "layered",
        "elk.direction": "RIGHT",
        "elk.edgeRouting": "SPLINES",
        "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
        "elk.layered.crossingMinimization.strategy": "LAYER_SWEEP",
        "elk.layered.nodePlacement.strategy": "NETWORK_SIMPLEX",
        "elk.spacing.nodeNode": "42",
        "elk.layered.spacing.nodeNodeBetweenLayers": "96",
        "elk.padding": "[top=48,left=48,bottom=48,right=48]",
      },
      children: visibleSummaries.map((node) => ({
        id: node.id,
        height: inspectorNodeHeight,
        width: inspectorNodeWidth,
      })),
      edges: visibleEdges.map((edge) => ({
        id: edge.id,
        sources: [edge.source],
        targets: [edge.target],
      })),
    }).then((graph) => {
      if (cancelled || id !== requestIdRef.current) return;
      setPositions(Object.fromEntries((graph.children ?? []).map((node) => [
        node.id,
        { x: node.x ?? 0, y: node.y ?? 0 },
      ])));
      setSettledLayoutSignature(layoutSignature);
    }).catch((error: unknown) => {
      if (cancelled || id !== requestIdRef.current) return;
      console.warn("World inspector ELK layout failed; using deterministic fallback.", error);
      setPositions(provisionalPositions);
      setSettledLayoutSignature(layoutSignature);
    });
    return () => { cancelled = true; };
  }, [layoutSignature, provisionalPositions, visibleEdges, visibleSummaries]);

  const nodes = useMemo<InspectorFlowNode[]>(() => visibleSummaries.map((summary) => {
    const matchesQuery = !normalizedQuery || `${summary.label} ${summary.description} ${actorNames.get(summary.laneId) ?? summary.laneId}`
      .toLocaleLowerCase().includes(normalizedQuery);
    const matchesActor = selectedActorId === "world" || summary.laneId === selectedActorId ||
      (summary.kind === "attempt"
        ? summary.relatedActorIds?.includes(selectedActorId)
        : summary.laneId === "world");
    return {
      id: summary.id,
      type: "inspector",
      position: positions[summary.id] ?? provisionalPositions[summary.id] ?? { x: 0, y: 0 },
      initialHeight: inspectorNodeHeight,
      initialWidth: inspectorNodeWidth,
      handles: inspectorNodeHandles,
      draggable: false,
      selectable: false,
      ariaLabel: `${summary.label}：${summary.description}`,
      data: {
        actorName: actorNames.get(summary.laneId) ?? summary.laneId,
        dimmed: !matchesQuery || !matchesActor,
        onSelect,
        selected: selectedNodeId === summary.id,
        summary,
      },
    };
  }), [actorNames, normalizedQuery, onSelect, positions, provisionalPositions, selectedActorId, selectedNodeId, visibleSummaries]);

  const edges = useMemo<Edge[]>(() => visibleEdges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    label: edge.label,
    className: `cg-inspector-edge cg-inspector-edge--${edge.kind}`,
    markerEnd: { type: MarkerType.ArrowClosed },
    style: { stroke: "var(--cg-inspector-edge)" },
    labelStyle: { fill: "var(--cg-muted-foreground)", fontSize: 10 },
    labelBgStyle: { fill: "var(--cg-card)", fillOpacity: 0.86 },
  })), [visibleEdges]);

  useEffect(() => {
    const graph = graphRef.current;
    const instance = instanceRef.current;
    if (!flowReady || !graph || !instance || nodes.length === 0) return;
    if (settledLayoutSignature !== layoutSignature) return;
    if (!followLatest && hasFittedInitialLayoutRef.current) return;
    const minX = Math.min(...nodes.map((node) => node.position.x));
    const minY = Math.min(...nodes.map((node) => node.position.y));
    const maxX = Math.max(...nodes.map((node) => node.position.x + inspectorNodeWidth));
    const maxY = Math.max(...nodes.map((node) => node.position.y + inspectorNodeHeight));
    const viewport = getViewportForBounds(
      { x: minX, y: minY, width: maxX - minX, height: maxY - minY },
      graph.clientWidth,
      graph.clientHeight,
      inspectorMinZoom,
      1.05,
      0.14,
    );
    const frame = requestAnimationFrame(() => {
      void instance.setViewport(viewport, { duration: reduceMotion ? 0 : 240 });
      hasFittedInitialLayoutRef.current = true;
    });
    return () => cancelAnimationFrame(frame);
  }, [flowReady, followLatest, layoutSignature, nodes, reduceMotion, settledLayoutSignature]);

  const layoutReady = visibleSummaries.length > 0 && settledLayoutSignature === layoutSignature &&
    visibleSummaries.every((summary) => positions[summary.id] !== undefined);
  const minimapLayoutKey = visibleSummaries.map((summary) => {
    const position = positions[summary.id] ?? provisionalPositions[summary.id] ?? { x: 0, y: 0 };
    return `${summary.id}:${position.x}:${position.y}`;
  }).join("|");

  return (
    <div
      aria-busy={!layoutReady}
      aria-label="世界演化因果图"
      className="cg-inspector-graph"
      data-layout-ready={layoutReady || undefined}
      data-semantic-zoom={semanticZoom}
      ref={graphRef}
      role="region"
    >
      <ReactFlow
        colorMode={resolvedTheme === "dark" ? "dark" : "light"}
        edges={edges}
        maxZoom={1.7}
        minZoom={inspectorMinZoom}
        nodeTypes={nodeTypes}
        nodes={nodes}
        nodesConnectable={false}
        nodesDraggable={false}
        nodesFocusable={false}
        onInit={(instance) => {
          instanceRef.current = instance;
          setFlowReady(true);
          setSemanticZoom(semanticZoomLevel(instance.getViewport().zoom));
        }}
        onMove={(_, viewport) => {
          const next = semanticZoomLevel(viewport.zoom);
          setSemanticZoom((current) => current === next ? current : next);
        }}
        onMoveStart={(event) => { if (event) onInteract(); }}
        onlyRenderVisibleElements
        panOnScroll
        proOptions={{ hideAttribution: true }}
      >
        <Background color="var(--cg-inspector-grid)" gap={28} size={1} variant={BackgroundVariant.Dots} />
        {layoutReady && (
          <MiniMap<InspectorFlowNode>
            ariaLabel="世界演化图缩略导航"
            className="cg-inspector-minimap"
            key={minimapLayoutKey}
            maskColor="var(--cg-inspector-minimap-mask)"
            nodeBorderRadius={8}
            nodeColor={(node) => minimapColorByKind[node.data.summary.kind]}
            nodeStrokeColor="var(--cg-background)"
            nodeStrokeWidth={2}
            pannable
            zoomable
          />
        )}
        <Controls className="cg-inspector-controls" position="bottom-left" showInteractive={false} />
        <Panel className="cg-inspector-legend" position="top-left">
          <span><i data-kind="commit" />提交</span>
          <span><i data-kind="action" />行动</span>
          <span><i data-kind="mind" />心智</span>
          <span><i data-kind="attempt" />尝试</span>
        </Panel>
      </ReactFlow>
    </div>
  );
}
