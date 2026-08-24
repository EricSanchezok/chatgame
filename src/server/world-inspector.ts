import type {
  CausalRef,
  CommittedStep,
  SimulationState,
  WorldDeltaOperation,
} from "../engine/model";
import type {
  RuntimeEvent,
  RuntimeObserver,
} from "../engine/observability";
import { replayCommittedHistory } from "../engine/transaction";
import {
  WORLD_INSPECTOR_API_VERSION,
  type WorldInspectorActor,
  type WorldInspectorAttemptDetail,
  type WorldInspectorAttemptStatus,
  type WorldInspectorAttemptSummary,
  type WorldInspectorEdgeKind,
  type WorldInspectorEdgeSummary,
  type WorldInspectorNodeSummary,
  type WorldInspectorStateSnapshot,
  type WorldInspectorStepDetail,
  type WorldInspectorStepSummary,
  type WorldInspectorTokenUsage,
  type WorldInspectorTraceAvailability,
  type WorldInspectorWindow,
} from "../shared/world-inspector-api";
import type { WorldSessionDocument } from "./world-run-types";

const WORLD_LANE_ID = "world";
const PLAYER_LANE_ID = "player";

function stateSnapshot(state: Readonly<SimulationState>): WorldInspectorStateSnapshot {
  return {
    revision: state.revision,
    step: state.step,
    truth: structuredClone(state.truth),
    agents: structuredClone(state.agents),
    player: structuredClone(state.player),
  };
}

function tokenUsage(step: CommittedStep): WorldInspectorTokenUsage {
  let input = 0;
  let output = 0;
  let unknown = false;
  for (const invocation of step.modelAudits.flatMap((audit) => audit.invocations)) {
    if (invocation.tokenUsage.input === null) unknown = true;
    else input += invocation.tokenUsage.input;
    if (invocation.tokenUsage.output === null) unknown = true;
    else output += invocation.tokenUsage.output;
  }
  return { input, output, total: input + output, unknown };
}

function operationLabel(operation: WorldDeltaOperation): string {
  switch (operation.kind) {
    case "create_entity": return `创建实体 · ${operation.entity.name}`;
    case "retire_entity": return `退役实体 · ${operation.entityId}`;
    case "place_entity": return `移动实体 · ${operation.entityId}`;
    case "set_fact": return `写入事实 · ${operation.fact.predicate}`;
    case "remove_fact": return `移除事实 · ${operation.factId}`;
    case "set_meter": return `设置量表 · ${operation.meter.id}`;
    case "adjust_meter": return `调整量表 · ${operation.meterId}`;
    case "transfer_quantity": return `转移资源 · ${operation.definitionId}`;
    case "produce_quantity": return `产生资源 · ${operation.definitionId}`;
    case "consume_quantity": return `消耗资源 · ${operation.definitionId}`;
    case "set_rating": return `设置评级 · ${operation.rating.id}`;
    case "advance_time": return `推进时间 · ${operation.seconds} 秒`;
    case "create_agent": return `创建 Agent · ${operation.agent.id}`;
    case "remove_agent": return `移除 Agent · ${operation.agentId}`;
  }
}

function actorsFor(document: WorldSessionDocument): WorldInspectorActor[] {
  const states = new Map<string, { id: string; entityId: string }>();
  const base = document.state.historyBase;
  for (const agent of Object.values(base?.agents ?? {})) states.set(agent.id, agent);
  for (const committed of document.state.history) {
    for (const operation of committed.operations) {
      if (operation.kind === "create_agent") states.set(operation.agent.id, operation.agent);
    }
  }
  for (const agent of Object.values(document.state.agents)) states.set(agent.id, agent);
  const entitySources = [document.state.truth.entities, base?.truth.entities ?? {}];
  const entityFor = (entityId: string) => entitySources.map((source) => source[entityId]).find(Boolean);
  const playerEntity = entityFor(document.state.player.entityId);
  const actors: WorldInspectorActor[] = [{
    id: PLAYER_LANE_ID,
    entityId: document.state.player.entityId,
    kind: "player",
    name: playerEntity?.name ?? "玩家",
    description: playerEntity?.description ?? "玩家主体",
    lifecycle: playerEntity?.lifecycle ?? "active",
  }];
  for (const agent of [...states.values()].sort((left, right) => left.id.localeCompare(right.id))) {
    const entity = entityFor(agent.entityId);
    actors.push({
      id: agent.id,
      entityId: agent.entityId,
      kind: "agent",
      name: entity?.name ?? agent.id,
      description: entity?.description ?? "",
      lifecycle: entity?.lifecycle ?? "retired",
    });
  }
  return actors;
}

interface ProjectedStep {
  summary: WorldInspectorStepSummary;
  nodes: WorldInspectorNodeSummary[];
  edges: WorldInspectorEdgeSummary[];
}

function projectStep(
  committed: CommittedStep,
  elapsedSeconds: number,
  entityActors: ReadonlyMap<string, string>,
): ProjectedStep {
  const nodes: WorldInspectorNodeSummary[] = [];
  const edges: WorldInspectorEdgeSummary[] = [];
  const edgeIds = new Set<string>();
  const referenceNodes = new Map<string, string>();
  const revision = committed.revision;
  const commitId = `commit:${revision}`;
  const addNode = (node: WorldInspectorNodeSummary): void => {
    nodes.push(node);
  };
  const addEdge = (
    source: string,
    target: string,
    kind: WorldInspectorEdgeKind,
    label?: string,
  ): void => {
    const base = `${kind}:${source}:${target}:${label ?? ""}`;
    if (edgeIds.has(base)) return;
    edgeIds.add(base);
    edges.push({ id: base, source, target, kind, ...(label ? { label } : {}) });
  };
  const registerReference = (kind: CausalRef["kind"], id: string, nodeId: string): void => {
    referenceNodes.set(`${kind}:${id}`, nodeId);
  };
  const connectCauses = (causes: readonly CausalRef[], target: string): void => {
    for (const cause of causes) {
      const source = referenceNodes.get(`${cause.kind}:${cause.id}`);
      if (source && source !== target) addEdge(source, target, "causal", cause.kind);
    }
  };

  addNode({
    id: commitId,
    revision,
    laneId: WORLD_LANE_ID,
    kind: "commit",
    label: `Revision ${revision}`,
    description: committed.playerIntent.goal,
    status: "succeeded",
  });
  if (revision > 1) addEdge(`commit:${revision - 1}`, commitId, "temporal", "下一步");

  for (const action of committed.actions) {
    const nodeId = `action:${action.id}`;
    const outcome = committed.outcomes.find((candidate) => candidate.proposalId === action.id);
    addNode({
      id: nodeId,
      revision,
      laneId: action.actorId,
      kind: "action",
      label: action.actorId === "player" ? "玩家行动" : "Agent 行动",
      description: outcome?.summary ?? action.goal,
      ...(outcome ? { status: outcome.status } : {}),
    });
    registerReference("action", action.id, nodeId);
    if (revision > 1) addEdge(`commit:${revision - 1}`, nodeId, "temporal", "准备行动");
    if (outcome) connectCauses(outcome.causeRefs, nodeId);
    addEdge(nodeId, commitId, "commits", "行动结果");
  }

  for (const request of committed.reactionRequests) {
    const nodeId = `reaction:${revision}:${request.agentId}`;
    addNode({
      id: nodeId,
      revision,
      laneId: request.agentId,
      kind: "reaction",
      label: "反应窗口",
      description: request.stimulus.summary,
    });
    const source = referenceNodes.get(`action:${request.sourceActionId}`);
    if (source) addEdge(source, nodeId, "observes", "刺激");
    addEdge(nodeId, commitId, "commits", "反应决定");
  }

  for (const request of committed.checkRequests) {
    const nodeId = `check:${request.id}`;
    const result = committed.checks.find((candidate) => candidate.requestId === request.id);
    const laneId = entityActors.get(request.actorId) ?? WORLD_LANE_ID;
    addNode({
      id: nodeId,
      revision,
      laneId,
      kind: "check",
      label: request.phase === "perception" ? "感知检定" : "结算检定",
      description: result
        ? `${result.succeeded ? "成功" : "失败"} · ${result.total} / DC ${result.dc}`
        : request.stakes,
      status: result?.succeeded ? "succeeded" : "failed",
    });
    registerReference("check", request.id, nodeId);
    connectCauses(request.causes, nodeId);
    addEdge(nodeId, commitId, "commits", "检定结果");
  }

  for (const request of committed.randomRequests) {
    const nodeId = `random:${request.id}`;
    const result = committed.randomResults.find((candidate) => candidate.requestId === request.id);
    addNode({
      id: nodeId,
      revision,
      laneId: WORLD_LANE_ID,
      kind: "random",
      label: "随机承诺",
      description: result
        ? `${request.distribution.description} · ${result.steps.filter((step) => !step.skipped).length} 轮`
        : request.distribution.description,
    });
    registerReference("random", request.id, nodeId);
    connectCauses(request.causes, nodeId);
    addEdge(nodeId, commitId, "commits", "随机结果");
  }

  for (const invocation of committed.mechanicInvocations) {
    const nodeId = `mechanic:${invocation.id}`;
    addNode({
      id: nodeId,
      revision,
      laneId: WORLD_LANE_ID,
      kind: "mechanic",
      label: `机制 · ${invocation.ruleId}`,
      description: invocation.packageId,
    });
    registerReference("mechanic", invocation.id, nodeId);
    connectCauses(invocation.causes, nodeId);
    addEdge(nodeId, commitId, "commits", "机制结果");
  }

  committed.operations.forEach((operation, index) => {
    const nodeId = `operation:${revision}:${index + 1}`;
    addNode({
      id: nodeId,
      revision,
      laneId: operation.kind === "create_agent" || operation.kind === "remove_agent"
        ? operation.kind === "create_agent" ? operation.agent.id : operation.agentId
        : WORLD_LANE_ID,
      kind: "operation",
      label: operationLabel(operation),
      description: `${operation.causes.length} 个直接原因`,
    });
    connectCauses(operation.causes, nodeId);
    addEdge(nodeId, commitId, "commits", "状态变化");
  });

  for (const event of committed.events) {
    const nodeId = `event:${event.id}`;
    addNode({
      id: nodeId,
      revision,
      laneId: WORLD_LANE_ID,
      kind: "event",
      label: "世界事件",
      description: event.description,
    });
    registerReference("event", event.id, nodeId);
    connectCauses(event.causes, nodeId);
    addEdge(nodeId, commitId, "commits", "事件写入");
  }

  for (const observation of committed.observations) {
    const nodeId = `observation:${observation.id}`;
    addNode({
      id: nodeId,
      revision,
      laneId: observation.observerId,
      kind: "observation",
      label: observation.kind === "stimulus" ? "即时刺激" : "主观观察",
      description: observation.summary,
    });
    for (const eventId of observation.sourceEventIds) {
      const source = referenceNodes.get(`event:${eventId}`);
      if (source) addEdge(source, nodeId, "observes", "感知");
    }
  }

  const mindActorIds = new Set([
    ...committed.beliefPatches.map((patch) => patch.agentId),
    ...committed.characterPatches.map((patch) => patch.agentId),
    ...committed.nextActions.map((action) => action.actorId),
  ]);
  for (const actorId of [...mindActorIds].sort()) {
    const nextAction = committed.nextActions.find((action) => action.actorId === actorId);
    const beliefCount = committed.beliefPatches.find((patch) => patch.agentId === actorId)?.operations.length ?? 0;
    const characterCount = committed.characterPatches.find((patch) => patch.agentId === actorId)?.operations.length ?? 0;
    const nodeId = `mind:${revision}:${actorId}`;
    addNode({
      id: nodeId,
      revision,
      laneId: actorId,
      kind: "mind",
      label: "心智演化",
      description: nextAction?.goal ?? `${beliefCount + characterCount} 项认知或角色变化`,
      count: beliefCount + characterCount,
    });
    for (const observation of committed.observations.filter((candidate) => candidate.observerId === actorId)) {
      addEdge(`observation:${observation.id}`, nodeId, "updates", "更新认知");
    }
    addEdge(nodeId, commitId, "commits", nextAction ? "准备下一行动" : "更新主体状态");
  }

  const summary: WorldInspectorStepSummary = {
    revision,
    step: committed.step,
    contentHash: committed.contentHash,
    elapsedSeconds,
    playerGoal: committed.playerIntent.goal,
    actorIds: committed.actions.map((action) => action.actorId).sort(),
    counts: {
      actions: committed.actions.length,
      reactions: committed.reactionRequests.length,
      checks: committed.checks.length,
      random: committed.randomResults.length,
      mechanics: committed.mechanicInvocations.length,
      operations: committed.operations.length,
      events: committed.events.length,
      observations: committed.observations.length,
      mindUpdates: mindActorIds.size,
      modelInvocations: committed.modelAudits.reduce((sum, audit) => sum + audit.invocations.length, 0),
    },
    tokenUsage: tokenUsage(committed),
    nodeIds: nodes.map((node) => node.id),
  };
  return { summary, nodes, edges };
}

function attemptStatus(events: readonly RuntimeEvent[]): WorldInspectorAttemptStatus {
  if (events.some((event) => event.event === "step.rolled_back" || event.event === "step.persistence_rolled_back")) {
    return "rolled_back";
  }
  if (events.some((event) => event.event === "step.committed")) return "committed";
  if (events.some((event) => event.event === "run.cancel_requested")) return "cancelled";
  if (events.some((event) => event.level === "error" || event.event.endsWith(".failed"))) return "failed";
  return "active";
}

export function summarizeRuntimeAttempts(events: readonly RuntimeEvent[]): WorldInspectorAttemptSummary[] {
  const grouped = new Map<string, RuntimeEvent[]>();
  for (const event of events) {
    const id = event.correlation?.stepAttemptId;
    if (!id) continue;
    const group = grouped.get(id) ?? [];
    group.push(event);
    grouped.set(id, group);
  }
  return [...grouped.entries()].map(([id, group]) => {
    const ordered = [...group].sort((left, right) =>
      left.timestamp.localeCompare(right.timestamp) || left.sequence - right.sequence);
    const first = ordered[0];
    const last = ordered.at(-1)!;
    const error = [...ordered].reverse().find((event) => event.error)?.error;
    return {
      id,
      ...(first.correlation?.runId ? { runId: first.correlation.runId } : {}),
      ...(first.correlation?.runAttempt !== undefined ? { runAttempt: first.correlation.runAttempt } : {}),
      ...(first.correlation?.revision !== undefined ? { revision: first.correlation.revision } : {}),
      ...(first.correlation?.step !== undefined ? { step: first.correlation.step } : {}),
      status: attemptStatus(ordered),
      startedAt: first.timestamp,
      updatedAt: last.timestamp,
      latestEvent: last.event,
      eventCount: ordered.length,
      modelInvocationCount: new Set(ordered.flatMap((event) =>
        event.correlation?.modelInvocationId ? [event.correlation.modelInvocationId] : [])).size,
      ...(error?.message ? { errorMessage: error.message } : {}),
    };
  }).sort((left, right) => left.startedAt.localeCompare(right.startedAt) || left.id.localeCompare(right.id));
}

export function traceAvailability(
  observer: RuntimeObserver,
  events: readonly RuntimeEvent[],
  degraded = observer.degraded,
): WorldInspectorTraceAvailability {
  return {
    mode: observer.mode,
    degraded,
    retainedEventCount: events.length,
    ...(events[0] ? { earliestTimestamp: events[0].timestamp } : {}),
    ...(events.at(-1) ? { latestTimestamp: events.at(-1)!.timestamp } : {}),
    hasFullPayload: observer.mode === "full",
  };
}

export type WorldInspectorCommittedProjection = Pick<
  WorldInspectorWindow,
  "actors" | "steps" | "nodes" | "edges" | "pagination"
>;

export type WorldInspectorCommittedStepDetail = Omit<
  WorldInspectorStepDetail,
  "runtimeEvents" | "trace"
>;

export function buildWorldInspectorCommittedProjection(
  document: WorldSessionDocument,
  input: { beforeRevision?: number; limit: number },
): WorldInspectorCommittedProjection {
  const elapsedByRevision = new Map<number, number>();
  replayCommittedHistory(document.state, {
    commit(replayed, committed) {
      elapsedByRevision.set(committed.revision, replayed.truth.elapsedSeconds);
    },
  });
  const eligible = document.state.history.filter((committed) =>
    input.beforeRevision === undefined || committed.revision < input.beforeRevision);
  const selected = eligible.slice(-input.limit);
  const actors = actorsFor(document);
  const entityActors = new Map(actors.map((actor) => [actor.entityId, actor.id]));
  const projected = selected.map((committed) => projectStep(
    committed,
    elapsedByRevision.get(committed.revision) ?? document.state.truth.elapsedSeconds,
    entityActors,
  ));
  return {
    actors,
    steps: projected.map((item) => item.summary),
    nodes: projected.flatMap((item) => item.nodes),
    edges: projected.flatMap((item) => item.edges),
    pagination: {
      limit: input.limit,
      hasOlder: eligible.length > selected.length,
      ...(selected[0] ? { oldestRevision: selected[0].revision } : {}),
      ...(selected.at(-1) ? { newestRevision: selected.at(-1)!.revision } : {}),
    },
  };
}

export function buildWorldInspectorWindow(
  document: WorldSessionDocument,
  observer: RuntimeObserver,
  runtimeEvents: readonly RuntimeEvent[],
  input: { beforeRevision?: number; limit: number },
  cachedProjection?: WorldInspectorCommittedProjection,
  traceDegraded = observer.degraded,
): WorldInspectorWindow {
  const projection = structuredClone(cachedProjection ??
    buildWorldInspectorCommittedProjection(document, input));
  const attempts = summarizeRuntimeAttempts(runtimeEvents).slice(-50);
  const nodes = projection.nodes;
  const edges = projection.edges;
  const nodeIds = new Set(nodes.map((node) => node.id));
  for (const attempt of attempts) {
    const nodeId = `attempt:${attempt.id}`;
    const baseRevision = attempt.revision ?? document.state.revision;
    nodes.push({
      id: nodeId,
      revision: Math.max(1, baseRevision + 1),
      laneId: WORLD_LANE_ID,
      kind: "attempt",
      label: `Step ${attempt.step ?? baseRevision + 1} 尝试`,
      description: attempt.errorMessage ?? attempt.latestEvent,
      status: attempt.status === "active" ? "active" : attempt.status === "committed" ? "succeeded" : "rolled_back",
    });
    const source = attempt.status === "committed" ? nodeId : `commit:${baseRevision}`;
    const target = attempt.status === "committed" ? `commit:${baseRevision + 1}` : nodeId;
    if (nodeIds.has(source) || source === nodeId) {
      if (!nodeIds.has(target) && target !== nodeId) continue;
      edges.push({
        id: `attempt:${source}:${target}`,
        source,
        target,
        kind: attempt.status === "rolled_back" || attempt.status === "failed" ? "rollback" : "temporal",
        label: attempt.status === "active" ? "进行中" : attempt.status,
      });
    }
  }
  return {
    apiVersion: WORLD_INSPECTOR_API_VERSION,
    session: {
      id: document.id,
      title: document.title,
      worldId: document.world.id,
      worldName: document.world.name,
      worldHash: document.world.contentHash,
      revision: document.state.revision,
      step: document.state.step,
      elapsedSeconds: document.state.truth.elapsedSeconds,
      updatedAt: document.updatedAt,
    },
    actors: projection.actors,
    steps: projection.steps,
    nodes,
    edges,
    attempts,
    trace: traceAvailability(observer, runtimeEvents, traceDegraded),
    pagination: projection.pagination,
  };
}

export function buildWorldInspectorCommittedStepDetail(
  document: WorldSessionDocument,
  revision: number,
): WorldInspectorCommittedStepDetail | undefined {
  const committed = document.state.history.find((candidate) => candidate.revision === revision);
  if (!committed) return undefined;
  let before: WorldInspectorStateSnapshot | undefined;
  let after: WorldInspectorStateSnapshot | undefined;
  replayCommittedHistory(document.state, {
    base(replayed) {
      if (revision === 1) before = stateSnapshot(replayed);
    },
    commit(replayed, current) {
      if (current.revision === revision - 1) before = stateSnapshot(replayed);
      if (current.revision === revision) after = stateSnapshot(replayed);
    },
  });
  if (!before || !after) return undefined;
  const actors = actorsFor(document);
  const projected = projectStep(committed, after.truth.elapsedSeconds, new Map(
    actors.map((actor) => [actor.entityId, actor.id]),
  ));
  return {
    apiVersion: WORLD_INSPECTOR_API_VERSION,
    summary: projected.summary,
    committed: structuredClone(committed),
    before,
    after,
  };
}

export function buildWorldInspectorStepDetail(
  document: WorldSessionDocument,
  revision: number,
  observer: RuntimeObserver,
  runtimeEvents: readonly RuntimeEvent[],
  cachedDetail?: WorldInspectorCommittedStepDetail,
  traceDegraded = observer.degraded,
): WorldInspectorStepDetail | undefined {
  const detail = structuredClone(cachedDetail ??
    buildWorldInspectorCommittedStepDetail(document, revision));
  if (!detail) return undefined;
  return {
    ...detail,
    runtimeEvents: structuredClone(runtimeEvents.filter((event) =>
      event.correlation?.step === detail.committed.step ||
      event.correlation?.revision === detail.committed.baseRevision)),
    trace: traceAvailability(observer, runtimeEvents, traceDegraded),
  };
}

export function buildWorldInspectorAttemptDetail(
  attemptId: string,
  observer: RuntimeObserver,
  runtimeEvents: readonly RuntimeEvent[],
  traceDegraded = observer.degraded,
): WorldInspectorAttemptDetail | undefined {
  const events = runtimeEvents.filter((event) => event.correlation?.stepAttemptId === attemptId);
  const summary = summarizeRuntimeAttempts(events)[0];
  if (!summary) return undefined;
  return {
    apiVersion: WORLD_INSPECTOR_API_VERSION,
    summary,
    events: structuredClone(events),
    trace: traceAvailability(observer, runtimeEvents, traceDegraded),
  };
}
