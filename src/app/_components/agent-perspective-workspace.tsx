"use client";

import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
  type ReactFlowInstance,
} from "@xyflow/react";
import ELK, { type ELK as ElkLayoutEngine } from "elkjs/lib/elk-api.js";
import {
  Box,
  Building2,
  CircleHelp,
  MapPin,
  Orbit,
  PackageOpen,
  UserRound,
} from "lucide-react";
import { useTheme } from "next-themes";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import type {
  AgentPerspectiveView,
  BeliefValue,
  PerspectiveFactValue,
} from "../../engine/model";

type RelationKind = "exact" | "believed" | "suspected" | "disbelieved";
type RelationSource = "location" | "containment" | "fact" | "claim" | "attitude" | "goal" | "commitment";
type ViewNodeKind = "self" | "entity" | "authorized" | "unidentified" | "value";

export interface PerspectiveViewNode {
  id: string;
  kind: ViewNodeKind;
  name: string;
  description: string;
  status: string;
  targetable: boolean;
}

export interface PerspectiveViewRelation {
  id: string;
  source: string;
  target: string;
  label: string;
  description: string;
  kind: RelationKind;
  origin: RelationSource;
  evidenceIds: string[];
}

interface PerspectiveNodeData extends Record<string, unknown> {
  node: PerspectiveViewNode;
  selected: boolean;
}

type PerspectiveFlowNode = Node<PerspectiveNodeData, "perspective">;

const nodeWidth = 184;
const nodeHeight = 78;
const nodeHandles: NonNullable<PerspectiveFlowNode["handles"]> = [
  { type: "target", position: Position.Left, x: -3, y: 36, width: 6, height: 6 },
  { type: "source", position: Position.Right, x: 181, y: 36, width: 6, height: 6 },
];

const statusLabels: Record<string, string> = {
  observed: "亲自观察",
  reported: "他人告知",
  hypothesized: "推测存在",
  authorized: "关系已授权",
  unidentified: "尚未识别",
};

const relationLabels: Record<RelationKind, string> = {
  exact: "精确",
  believed: "相信",
  suspected: "怀疑",
  disbelieved: "不相信",
};

const sourceLabels: Record<RelationSource, string> = {
  location: "当前位置",
  containment: "随身关系",
  fact: "精确关系",
  claim: "主观认知",
  attitude: "态度",
  goal: "目标",
  commitment: "承诺",
};

function localRef(localEntityId: string): string {
  return `local:${localEntityId}`;
}

function factValueLabel(value: PerspectiveFactValue): string {
  switch (value.kind) {
    case "text": return value.value;
    case "number": return String(value.value);
    case "boolean": return value.value ? "是" : "否";
    case "none": return "无";
    case "entity": return value.entityRef;
  }
}

function beliefValueLabel(value: BeliefValue): string {
  switch (value.kind) {
    case "text": return value.value;
    case "number": return String(value.value);
    case "boolean": return value.value ? "是" : "否";
    case "none": return "无";
    case "local_entity": return value.localEntityId;
  }
}

const iconByNodeKind = {
  self: UserRound,
  entity: Box,
  authorized: Building2,
  unidentified: CircleHelp,
  value: Orbit,
} satisfies Record<ViewNodeKind, typeof Orbit>;

function moveNodeFocus(event: KeyboardEvent<HTMLButtonElement>) {
  if (!["ArrowLeft", "ArrowUp", "ArrowRight", "ArrowDown", "Home", "End"].includes(event.key)) return;
  const graph = event.currentTarget.closest(".cg-perspective-graph");
  const buttons = [...(graph?.querySelectorAll<HTMLButtonElement>(".cg-perspective-node") ?? [])];
  const current = buttons.indexOf(event.currentTarget);
  if (current < 0 || buttons.length === 0) return;
  const target = event.key === "Home"
    ? 0
    : event.key === "End"
      ? buttons.length - 1
      : (current + (event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 1) + buttons.length) % buttons.length;
  event.preventDefault();
  buttons[target]?.focus();
}

function PerspectiveNode({ data }: NodeProps<PerspectiveFlowNode>) {
  const Icon = iconByNodeKind[data.node.kind];
  return (
    <>
      <Handle aria-hidden="true" className="cg-perspective-node__handle" position={Position.Left} type="target" />
      <button
        aria-label={`${data.node.name}，${statusLabels[data.node.status] ?? data.node.status}。${data.node.description}`}
        aria-pressed={data.selected}
        className="cg-perspective-node nodrag"
        data-kind={data.node.kind}
        data-selected={data.selected || undefined}
        onKeyDown={moveNodeFocus}
        type="button"
      >
        <span className="cg-perspective-node__icon"><Icon aria-hidden="true" /></span>
        <span className="cg-perspective-node__copy">
          <strong>{data.node.name}</strong>
          <small>{statusLabels[data.node.status] ?? data.node.status}</small>
        </span>
      </button>
      <Handle aria-hidden="true" className="cg-perspective-node__handle" position={Position.Right} type="source" />
    </>
  );
}

const nodeTypes = { perspective: PerspectiveNode };

function fallbackPositions(
  nodes: readonly PerspectiveViewNode[],
  selfRef: string,
): Record<string, { x: number; y: number }> {
  const positions: Record<string, { x: number; y: number }> = { [selfRef]: { x: 0, y: 0 } };
  const surrounding = nodes.filter((node) => node.id !== selfRef);
  surrounding.forEach((node, index) => {
    const ring = Math.floor(index / 8);
    const count = Math.min(8, surrounding.length - ring * 8);
    const angle = (Math.PI * 2 * (index % 8)) / Math.max(1, count) - Math.PI / 2;
    const radius = 250 + ring * 180;
    positions[node.id] = {
      x: Math.cos(angle) * radius,
      y: Math.sin(angle) * radius,
    };
  });
  return positions;
}

export function buildAgentPerspectiveGraph(perspective: AgentPerspectiveView): {
  nodes: PerspectiveViewNode[];
  relations: PerspectiveViewRelation[];
  selfRef: string;
} {
  const selfRef = localRef(perspective.self.localEntityId);
  const nodeMap = new Map<string, PerspectiveViewNode>();
  for (const entity of perspective.knowledge.entities) {
    nodeMap.set(entity.ref, {
      id: entity.ref,
      kind: entity.ref === selfRef
        ? "self"
        : entity.status === "authorized" || entity.status === "unidentified"
          ? entity.status
          : "entity",
      name: entity.name,
      description: entity.description,
      status: entity.ref === selfRef ? "observed" : entity.status,
      targetable: entity.targetable,
    });
  }
  nodeMap.set(selfRef, {
    id: selfRef,
    kind: "self",
    name: perspective.self.name,
    description: perspective.self.description,
    status: "observed",
    targetable: true,
  });

  const relations: PerspectiveViewRelation[] = [];
  const locationRef = perspective.self.location?.localEntityId
    ? localRef(perspective.self.location.localEntityId)
    : undefined;
  if (locationRef && nodeMap.has(locationRef)) {
    relations.push({
      id: "location:self",
      source: selfRef,
      target: locationRef,
      label: "位于",
      description: `你当前位于${perspective.self.location?.name ?? "这个地点"}。`,
      kind: "exact",
      origin: "location",
      evidenceIds: [],
    });
  }
  relations.push(...perspective.knowledge.containment.map((relation, index): PerspectiveViewRelation => ({
    id: `containment:${index}`,
    source: relation.containerRef,
    target: relation.entityRef,
    label: relation.viaUnknownContainer ? "随身范围" : relation.depth === 1 ? "随身" : "包含",
    description: relation.viaUnknownContainer
      ? "这个存在处于你的随身范围内，但中间容器尚未识别。"
      : relation.depth === 1 ? "这个存在当前直接由你携带。" : "这个存在位于你携带的容器中。",
    kind: "exact",
    origin: "containment",
    evidenceIds: [],
  })));

  perspective.knowledge.exactFacts.forEach((fact, index) => {
    let target: string;
    if (fact.value.kind === "entity") {
      target = fact.value.entityRef;
    } else {
      target = `fact-value:${index}`;
      nodeMap.set(target, {
        id: target,
        kind: "value",
        name: factValueLabel(fact.value),
        description: fact.description,
        status: "authorized",
        targetable: false,
      });
    }
    relations.push({
      id: `fact:${index}`,
      source: fact.subjectRef,
      target,
      label: fact.predicate,
      description: fact.description,
      kind: "exact",
      origin: "fact",
      evidenceIds: [],
    });
  });

  perspective.knowledge.claims.forEach((claim, index) => {
    let target: string;
    if (claim.value.kind === "local_entity") {
      target = localRef(claim.value.localEntityId);
    } else {
      target = `claim-value:${index}`;
      nodeMap.set(target, {
        id: target,
        kind: "value",
        name: beliefValueLabel(claim.value),
        description: claim.description,
        status: "hypothesized",
        targetable: false,
      });
    }
    if (!nodeMap.has(localRef(claim.subjectId)) || !nodeMap.has(target)) return;
    relations.push({
      id: `claim:${claim.id}`,
      source: localRef(claim.subjectId),
      target,
      label: claim.predicate,
      description: claim.description,
      kind: claim.stance,
      origin: "claim",
      evidenceIds: claim.evidenceIds,
    });
  });

  const addCharacterRelation = (
    id: string,
    targets: readonly string[],
    label: string,
    description: string,
    origin: RelationSource,
    evidenceIds: string[],
  ) => {
    const validTargets = targets.filter((targetId) => nodeMap.has(localRef(targetId)));
    if (validTargets.length === 0) {
      const target = `${origin}-value:${id}`;
      nodeMap.set(target, {
        id: target,
        kind: "value",
        name: description,
        description,
        status: "hypothesized",
        targetable: false,
      });
      relations.push({
        id: `${origin}:${id}:untargeted`,
        source: selfRef,
        target,
        label,
        description,
        kind: "believed",
        origin,
        evidenceIds,
      });
      return;
    }
    for (const targetId of validTargets) {
      const target = localRef(targetId);
      relations.push({
        id: `${origin}:${id}:${targetId}`,
        source: selfRef,
        target,
        label,
        description,
        kind: "believed",
        origin,
        evidenceIds,
      });
    }
  };
  for (const attitude of Object.values(perspective.character.attitudes)) {
    if (attitude.status === "active") addCharacterRelation(
      attitude.id, [attitude.subjectId], "态度", attitude.description, "attitude", attitude.evidenceIds,
    );
  }
  for (const goal of Object.values(perspective.character.goals)) {
    if (goal.status === "active" || goal.status === "suspended") addCharacterRelation(
      goal.id, goal.targetIds, "目标", goal.description, "goal", goal.evidenceIds,
    );
  }
  for (const commitment of Object.values(perspective.character.commitments)) {
    if (commitment.status === "active") addCharacterRelation(
      commitment.id,
      commitment.subjectIds,
      "承诺",
      commitment.description,
      "commitment",
      commitment.evidenceIds,
    );
  }

  return {
    nodes: [...nodeMap.values()].sort((left, right) =>
      Number(right.id === selfRef) - Number(left.id === selfRef) || left.id.localeCompare(right.id)),
    relations: relations.sort((left, right) =>
      left.source.localeCompare(right.source) || left.target.localeCompare(right.target) || left.id.localeCompare(right.id)),
    selfRef,
  };
}

function PerspectiveGraph({
  nodes: sourceNodes,
  onSelect,
  reduceMotion,
  relations,
  selectedId,
  selfRef,
}: {
  nodes: PerspectiveViewNode[];
  onSelect: (nodeId: string) => void;
  reduceMotion: boolean;
  relations: PerspectiveViewRelation[];
  selectedId: string;
  selfRef: string;
}) {
  const { resolvedTheme } = useTheme();
  const graphRef = useRef<HTMLDivElement>(null);
  const elkRef = useRef<ElkLayoutEngine | null>(null);
  const instanceRef = useRef<ReactFlowInstance<PerspectiveFlowNode, Edge> | null>(null);
  const [flowReady, setFlowReady] = useState(false);
  const [positions, setPositions] = useState<Record<string, { x: number; y: number }>>(() =>
    fallbackPositions(sourceNodes, selfRef));
  const [settledSignature, setSettledSignature] = useState<string>();
  const signature = useMemo(() => [
    sourceNodes.map((node) => node.id).join("|"),
    relations.map((relation) => relation.id).join("|"),
  ].join("::"), [relations, sourceNodes]);
  const fallback = useMemo(() => fallbackPositions(sourceNodes, selfRef), [selfRef, sourceNodes]);

  useEffect(() => {
    const worker = new Worker(new URL("../_workers/agent-perspective-layout.worker.ts", import.meta.url), {
      type: "module",
    });
    const elk = new ELK({ algorithms: ["stress"], workerFactory: () => worker });
    elkRef.current = elk;
    return () => {
      elk.terminateWorker();
      elkRef.current = null;
    };
  }, []);

  useEffect(() => {
    const elk = elkRef.current;
    if (!elk || sourceNodes.length === 0) return;
    let cancelled = false;
    void elk.layout({
      id: `agent-perspective:${signature}`,
      layoutOptions: {
        "elk.algorithm": "stress",
        "elk.edgeRouting": "SPLINES",
        "elk.spacing.nodeNode": "72",
        "elk.stress.desiredEdgeLength": "180",
        "elk.padding": "[top=80,left=80,bottom=80,right=80]",
      },
      children: sourceNodes.map((node) => ({ id: node.id, width: nodeWidth, height: nodeHeight })),
      edges: relations.map((relation) => ({
        id: relation.id,
        sources: [relation.source],
        targets: [relation.target],
      })),
    }).then((graph) => {
      if (cancelled) return;
      const raw = Object.fromEntries((graph.children ?? []).map((node) => [
        node.id,
        { x: node.x ?? 0, y: node.y ?? 0 },
      ]));
      const center = raw[selfRef] ?? { x: 0, y: 0 };
      setPositions(Object.fromEntries(Object.entries(raw).map(([id, position]) => [id, {
        x: position.x - center.x,
        y: position.y - center.y,
      }])));
      setSettledSignature(signature);
    }).catch(() => {
      if (cancelled) return;
      setPositions(fallback);
      setSettledSignature(signature);
    });
    return () => { cancelled = true; };
  }, [fallback, relations, selfRef, signature, sourceNodes]);

  const nodes = useMemo<PerspectiveFlowNode[]>(() => sourceNodes.map((node) => ({
    id: node.id,
    type: "perspective",
    position: positions[node.id] ?? fallback[node.id] ?? { x: 0, y: 0 },
    initialWidth: nodeWidth,
    initialHeight: nodeHeight,
    handles: nodeHandles,
    draggable: false,
    selectable: false,
    ariaLabel: `${node.name}：${node.description}`,
    data: { node, selected: selectedId === node.id },
  })), [fallback, positions, selectedId, sourceNodes]);

  const edges = useMemo<Edge[]>(() => relations.map((relation) => ({
    id: relation.id,
    source: relation.source,
    target: relation.target,
    label: relation.label,
    className: `cg-perspective-edge cg-perspective-edge--${relation.kind}`,
    markerEnd: { type: MarkerType.ArrowClosed },
    style: { stroke: "var(--cg-foreground)" },
    labelStyle: { fill: "var(--cg-muted-foreground)", fontSize: 10 },
    labelBgStyle: { fill: "var(--cg-card)", fillOpacity: 0.9 },
  })), [relations]);

  const layoutReady = sourceNodes.length === 0 || settledSignature === signature;

  useEffect(() => {
    const graph = graphRef.current;
    if (!flowReady || !layoutReady || !instanceRef.current || !graph || nodes.length === 0) return;
    const maxX = Math.max(...nodes.map((node) => Math.abs(node.position.x) + nodeWidth));
    const maxY = Math.max(...nodes.map((node) => Math.abs(node.position.y) + nodeHeight));
    const zoom = Math.max(0.25, Math.min(1.05,
      graph.clientWidth / Math.max(nodeWidth * 1.5, maxX * 2.15),
      graph.clientHeight / Math.max(nodeHeight * 1.5, maxY * 2.15)));
    const frame = requestAnimationFrame(() => {
      void instanceRef.current?.setCenter(nodeWidth / 2, nodeHeight / 2, {
        zoom,
        duration: reduceMotion ? 0 : 240,
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [flowReady, layoutReady, nodes, reduceMotion]);

  return (
    <div
      aria-busy={!layoutReady}
      aria-label="角色关系星图"
      className="cg-perspective-graph"
      ref={graphRef}
      role="region"
    >
      <ReactFlow
        colorMode={resolvedTheme === "dark" ? "dark" : "light"}
        edges={edges}
        maxZoom={1.55}
        minZoom={0.25}
        nodeTypes={nodeTypes}
        nodes={nodes}
        nodesConnectable={false}
        nodesDraggable={false}
        nodesFocusable={false}
        onInit={(instance) => {
          instanceRef.current = instance;
          setFlowReady(true);
        }}
        onNodeClick={(_, node) => onSelect(node.id)}
        panOnScroll
        proOptions={{ hideAttribution: true }}
      >
        <Background color="var(--cg-border)" gap={26} size={1} variant={BackgroundVariant.Dots} />
        <Controls className="cg-perspective-controls" position="bottom-left" showInteractive={false} />
      </ReactFlow>
    </div>
  );
}

function elapsedLabel(seconds: number): string {
  if (seconds < 60) return `${seconds} 秒`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  if (minutes < 60) return remainder ? `${minutes} 分 ${remainder} 秒` : `${minutes} 分`;
  const hours = Math.floor(minutes / 60);
  return `${hours} 时 ${minutes % 60} 分`;
}

function mechanicsExist(perspective: AgentPerspectiveView): boolean {
  return perspective.mechanics.meters.length + perspective.mechanics.quantities.length +
    perspective.mechanics.ratings.length > 0;
}

function Mechanics({ perspective }: { perspective: AgentPerspectiveView }) {
  if (!mechanicsExist(perspective)) return null;
  return (
    <section aria-label="角色数值" className="cg-perspective-mechanics">
      {perspective.mechanics.meters.map((meter) => (
        <div className="cg-perspective-meter" key={meter.name}>
          <span><strong>{meter.name}</strong><small>{meter.current} / {meter.max}</small></span>
          <meter max={meter.max} min={meter.min} value={meter.current}>{meter.current}</meter>
        </div>
      ))}
      {perspective.mechanics.quantities.map((quantity) => (
        <div className="cg-perspective-stat" key={quantity.name}>
          <small>{quantity.name}</small><strong>{quantity.amount}<span>{quantity.unit}</span></strong>
        </div>
      ))}
      {perspective.mechanics.ratings.map((rating) => (
        <div className="cg-perspective-stat" key={rating.name}>
          <small>{rating.name}</small><strong>{rating.value}<span>{rating.min}…{rating.max}</span></strong>
        </div>
      ))}
    </section>
  );
}

function relatedEvidence(perspective: AgentPerspectiveView, relations: readonly PerspectiveViewRelation[]) {
  const ids = new Set(relations.flatMap((relation) => relation.evidenceIds));
  return perspective.knowledge.evidence.filter((evidence) => ids.has(evidence.id));
}

function PerspectiveDetails({
  node,
  perspective,
  relations,
}: {
  node: PerspectiveViewNode;
  perspective: AgentPerspectiveView;
  relations: PerspectiveViewRelation[];
}) {
  const related = relations.filter((relation) => relation.source === node.id || relation.target === node.id);
  const evidence = relatedEvidence(perspective, related);
  const localId = node.id.startsWith("local:") ? node.id.slice("local:".length) : undefined;
  const isSelf = localId === perspective.self.localEntityId;
  const goals = Object.values(perspective.character.goals).filter((goal) =>
    (goal.status === "active" || goal.status === "suspended") &&
    (isSelf || Boolean(localId && goal.targetIds.includes(localId))));
  const commitments = Object.values(perspective.character.commitments).filter((commitment) =>
    commitment.status === "active" &&
    (isSelf || Boolean(localId && commitment.subjectIds.includes(localId))));

  return (
    <aside aria-label={`${node.name}详情`} className="cg-perspective-detail">
      <p className="cg-eyebrow">当前焦点</p>
      <h3>{node.name}</h3>
      <p>{node.description}</p>
      <div className="cg-perspective-tags">
        <span>{statusLabels[node.status] ?? node.status}</span>
        <span>{node.targetable ? "可作为行动对象" : "仅供查看"}</span>
      </div>

      <section>
        <h4>与我有关</h4>
        {related.length ? (
          <ul>
            {related.map((relation) => (
              <li key={relation.id}>
                <span data-relation={relation.kind}>{relationLabels[relation.kind]} · {sourceLabels[relation.origin]}</span>
                <strong>{relation.description}</strong>
                <p>关系标签：{relation.label}</p>
              </li>
            ))}
          </ul>
        ) : <p className="cg-muted">当前没有显式关系。</p>}
      </section>

      {(goals.length > 0 || commitments.length > 0) && (
        <section>
          <h4>目标与承诺</h4>
          <ul>
            {goals.map((goal) => <li key={goal.id}><strong>目标</strong><p>{goal.description}</p></li>)}
            {commitments.map((commitment) => (
              <li key={commitment.id}><strong>承诺</strong><p>{commitment.description}</p></li>
            ))}
          </ul>
        </section>
      )}

      {evidence.length > 0 && (
        <section>
          <h4>依据</h4>
          <ul>{evidence.map((item) => (
            <li key={item.id}><strong>{item.kind}</strong><p>{item.description}</p></li>
          ))}</ul>
        </section>
      )}
    </aside>
  );
}

function SemanticPerspective({
  nodes,
  relations,
}: {
  nodes: PerspectiveViewNode[];
  relations: PerspectiveViewRelation[];
}) {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const groups = (["exact", "believed", "suspected", "disbelieved"] as const).map((kind) => ({
    kind,
    relations: relations.filter((relation) => relation.kind === kind),
  })).filter((group) => group.relations.length > 0);
  return (
    <section aria-label="角色关系语义列表" className="cg-perspective-semantic">
      <h3>关系列表</h3>
      {groups.length === 0 ? <p>当前没有显式关系。</p> : groups.map((group) => (
        <section key={group.kind}>
          <h4>{relationLabels[group.kind]}</h4>
          <ul>
            {group.relations.map((relation) => (
              <li key={relation.id}>
                <strong>{byId.get(relation.source)?.name ?? "未知存在"}</strong>
                <span>{relation.label}</span>
                <strong>{byId.get(relation.target)?.name ?? "未知存在"}</strong>
                <p><strong>{relation.description}</strong><br />{sourceLabels[relation.origin]} · {relationLabels[relation.kind]}</p>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </section>
  );
}

export function AgentPerspectiveWorkspace({
  perspective,
  reduceMotion,
}: {
  perspective: AgentPerspectiveView;
  reduceMotion: boolean;
}) {
  const graph = useMemo(() => buildAgentPerspectiveGraph(perspective), [perspective]);
  const [selectedId, setSelectedId] = useState(graph.selfRef);
  const effectiveSelectedId = graph.nodes.some((node) => node.id === selectedId) ? selectedId : graph.selfRef;
  const selected = graph.nodes.find((node) => node.id === effectiveSelectedId) ?? graph.nodes[0];

  return (
    <section className="cg-perspective-workspace">
      <header className="cg-perspective-summary">
        <div className="cg-perspective-summary__identity">
          <span aria-hidden="true"><UserRound /></span>
          <div><p className="cg-eyebrow">Agent Perspective · R{perspective.revision}</p><h2>{perspective.self.name}</h2></div>
        </div>
        <dl>
          <div><dt><MapPin aria-hidden="true" />地点</dt><dd>{perspective.self.location?.name ?? "位置未知"}</dd></div>
          <div><dt><Orbit aria-hidden="true" />世界时间</dt><dd>{elapsedLabel(perspective.elapsedSeconds)}</dd></div>
          <div><dt><PackageOpen aria-hidden="true" />随身存在</dt><dd>{perspective.knowledge.containment.length}</dd></div>
        </dl>
      </header>

      <Mechanics perspective={perspective} />

      <div className="cg-perspective-legend" aria-label="关系图图例">
        <span data-relation="exact"><i />精确关系</span>
        <span data-relation="believed"><i />相信</span>
        <span data-relation="suspected"><i />怀疑</span>
        <span data-relation="disbelieved"><i />不相信</span>
      </div>

      <div className="cg-perspective-main">
        <PerspectiveGraph
          nodes={graph.nodes}
          onSelect={setSelectedId}
          reduceMotion={reduceMotion}
          relations={graph.relations}
          selectedId={effectiveSelectedId}
          selfRef={graph.selfRef}
        />
        {selected ? <PerspectiveDetails node={selected} perspective={perspective} relations={graph.relations} /> : null}
      </div>

      <SemanticPerspective nodes={graph.nodes} relations={graph.relations} />
    </section>
  );
}

export function perspectiveMessages(perspective?: AgentPerspectiveView) {
  return perspective?.history.flatMap((turn) => {
    const messages: Array<{ id: string; role: "user" | "assistant"; text: string }> = [];
    if (turn.ownAction) messages.push({
      id: `perspective:${perspective.agentId}:${turn.revision}:action`,
      role: "user",
      text: turn.ownAction,
    });
    const observations = turn.observations.map((observation) => observation.summary).filter(Boolean);
    if (observations.length > 0) messages.push({
      id: `perspective:${perspective.agentId}:${turn.revision}:observation`,
      role: "assistant",
      text: observations.join("\n\n"),
    });
    return messages;
  }) ?? [];
}
