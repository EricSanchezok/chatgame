import type {
  ActionCompilationReferenceAudit,
  CausalRef,
  CommittedStep,
  ModelExecutionAudit,
  SimulationState,
  WorldDeltaOperation,
} from "../engine/contracts/model";
import { contentHash } from "../engine/models/model-audit";
import type { RuntimeError, RuntimeEvent } from "../engine/runtime/observability";
import { EXECUTION_STAGES } from "../engine/runtime/stages";
import { replaySimulationState } from "../engine/runtime/transaction";
import {
  WORLD_INSPECTOR_API_VERSION,
  type WorldInspectorActor,
  type WorldInspectorAttemptDetail,
  type WorldInspectorAttemptStage,
  type WorldInspectorAttemptSummary,
  type WorldInspectorEdgeKind,
  type WorldInspectorEdgeSummary,
  type WorldInspectorModelInvocationDetail,
  type WorldInspectorModelInvocationQuery,
  type WorldInspectorModelInvocationQueryResult,
  type WorldInspectorModelInvocationResult,
  type WorldInspectorModelInvocationSummary,
  type WorldInspectorModelTokenUsage,
  type WorldInspectorNodeSummary,
  type WorldInspectorRuntimeEventDetail,
  type WorldInspectorRuntimeEventSummary,
  type WorldInspectorReplay,
  type WorldInspectorReplayFrame,
  type WorldInspectorStateSnapshot,
  type WorldInspectorStepDetail,
  type WorldInspectorStepSummary,
  type WorldInspectorTokenUsage,
  type WorldInspectorTraceAvailability,
  type WorldInspectorWindow,
} from "../shared/world-inspector-api";
import type { ExecutionRecord } from "./execution-ledger";
import type { WorldInstanceDocument } from "./world-instance-types";

const WORLD_LANE_ID = "world";

function diagnosticErrorMessage(error: RuntimeError): string {
  const nested = [
    ...(error.errors ?? []).map(diagnosticErrorMessage),
    ...(error.cause ? [diagnosticErrorMessage(error.cause)] : []),
  ].filter((message, index, values) => message !== error.message && values.indexOf(message) === index);
  return nested.length === 0 ? error.message : `${error.message}: ${nested.slice(0, 3).join("; ")}`;
}

function snapshot(state: Readonly<SimulationState>): WorldInspectorStateSnapshot {
  return {
    revision: state.revision,
    step: state.step,
    truth: structuredClone(state.truth),
    agents: structuredClone(state.agents),
  };
}

function tokenUsage(audits: readonly ModelExecutionAudit[]): WorldInspectorTokenUsage {
  let input = 0;
  let output = 0;
  let unknown = false;
  for (const invocation of audits.flatMap((audit) => audit.invocations)) {
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
    case "set_quantity": return `设置资源 · ${operation.quantity.id}`;
    case "set_rating": return `设置评级 · ${operation.rating.id}`;
    case "set_condition": return `设置状态 · ${operation.condition.label}`;
    case "remove_condition": return `移除状态 · ${operation.conditionId}`;
    case "set_shared_activity_resource_capacity": return `调整共享容量 · ${operation.poolId}`;
    case "advance_time": return `推进时间 · ${operation.seconds} 秒`;
    case "create_agent": return `创建 Agent · ${operation.agent.id}`;
    case "remove_agent": return `移除 Agent · ${operation.agentId}`;
  }
}

function actorsFor(document: WorldInstanceDocument): WorldInspectorActor[] {
  const agents = new Map<string, { id: string; entityId: string }>();
  for (const agent of Object.values(document.state.historyBase?.agents ?? {})) agents.set(agent.id, agent);
  for (const admission of document.state.admissions) agents.set(admission.agent.id, admission.agent);
  for (const step of document.state.history) {
    for (const operation of step.operations) {
      if (operation.kind === "create_agent") agents.set(operation.agent.id, operation.agent);
    }
  }
  for (const agent of Object.values(document.state.agents)) agents.set(agent.id, agent);
  const entitySources = [
    document.state.truth.entities,
    document.state.historyBase?.truth.entities ?? {},
    Object.fromEntries(document.state.admissions.map((admission) => [admission.entity.id, admission.entity])),
  ];
  return [...agents.values()].sort((left, right) => left.id.localeCompare(right.id)).map((agent) => {
    const entity = entitySources.map((source) => source[agent.entityId]).find(Boolean);
    return {
      id: agent.id,
      entityId: agent.entityId,
      kind: "agent" as const,
      name: entity?.name ?? agent.id,
      description: entity?.description ?? "",
      lifecycle: entity?.lifecycle ?? "retired",
    };
  });
}

function modelAuditsForStep(events: readonly RuntimeEvent[], step: CommittedStep): ModelExecutionAudit[] {
  const candidate = events.find((event) => event.event === "execution.candidate.persisted" &&
    event.attributes?.phase === "step" && event.correlation?.executionId === step.executionRef?.executionId);
  const payload = candidate?.payload as { modelAudits?: unknown } | undefined;
  return Array.isArray(payload?.modelAudits)
    ? structuredClone(payload.modelAudits as ModelExecutionAudit[])
    : [];
}

function interactionEvidenceForStep(events: readonly RuntimeEvent[], step: CommittedStep) {
  const candidate = events.find((event) => event.event === "execution.candidate.persisted" &&
    event.attributes?.phase === "step" && event.correlation?.executionId === step.executionRef?.executionId);
  const payload = candidate?.payload as {
    interactionDependencies?: unknown;
    diagnostics?: { dependencyComponents?: unknown; globalReadjudication?: unknown };
  } | undefined;
  return {
    dependencies: Array.isArray(payload?.interactionDependencies)
      ? structuredClone(payload.interactionDependencies) as import("../engine/runtime/execution").InteractionDependency[]
      : [],
    components: Array.isArray(payload?.diagnostics?.dependencyComponents)
      ? structuredClone(payload.diagnostics.dependencyComponents) as string[][]
      : [],
    globalReadjudication: payload?.diagnostics?.globalReadjudication === true,
  };
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
  audits: readonly ModelExecutionAudit[],
): ProjectedStep {
  const revision = committed.revision;
  const commitId = `commit:${revision}`;
  const nodes: WorldInspectorNodeSummary[] = [];
  const edges: WorldInspectorEdgeSummary[] = [];
  const edgeKeys = new Set<string>();
  const references = new Map<string, string>();
  const addEdge = (source: string, target: string, kind: WorldInspectorEdgeKind, label?: string) => {
    const id = `${kind}:${source}:${target}:${label ?? ""}`;
    if (edgeKeys.has(id)) return;
    edgeKeys.add(id);
    edges.push({ id, source, target, kind, ...(label ? { label } : {}) });
  };
  const connect = (causes: readonly CausalRef[], target: string) => {
    for (const cause of causes) {
      const source = references.get(`${cause.kind}:${cause.id}`);
      if (source && source !== target) addEdge(source, target, "causal", cause.kind);
    }
  };
  for (const action of committed.actions) references.set(`action:${action.id}`, `action:${action.id}`);
  for (const check of committed.checkRequests) references.set(`check:${check.id}`, `check:${check.id}`);
  for (const random of committed.randomRequests) references.set(`random:${random.id}`, `random:${random.id}`);
  for (const mechanic of committed.mechanicInvocations) references.set(`mechanic:${mechanic.id}`, `mechanic:${mechanic.id}`);
  for (const event of committed.events) references.set(`event:${event.id}`, `event:${event.id}`);

  const primaryAction = committed.actions.length === 0
    ? "本轮没有主体行动"
    : committed.actions.map((action) => `${action.actorId}: ${action.goal}`).join("；");
  nodes.push({
    id: commitId,
    revision,
    laneId: WORLD_LANE_ID,
    kind: "commit",
    label: `Revision ${revision}`,
    description: primaryAction,
    status: "succeeded",
  });
  if (committed.baseRevision > 0) {
    addEdge(`commit:${committed.baseRevision}`, commitId, "temporal", "下一次提交");
  }

  for (const action of committed.actions) {
    const id = `action:${action.id}`;
    const outcome = committed.outcomes.find((candidate) => candidate.proposalId === action.id);
    nodes.push({
      id,
      revision,
      laneId: action.actorId,
      kind: "action",
      label: "主体行动",
      description: outcome?.summary ?? action.goal,
      ...(outcome ? { status: outcome.status } : {}),
    });
    if (outcome) connect(outcome.causeRefs, id);
    addEdge(id, commitId, "commits", "行动结果");
  }
  for (const request of committed.reactionRequests) {
    const id = `reaction:${revision}:${request.agentId}`;
    nodes.push({ id, revision, laneId: request.agentId, kind: "reaction", label: "反应窗口", description: request.stimulus.summary });
    const source = references.get(`action:${request.triggerActionId}`);
    if (source) addEdge(source, id, "observes", "刺激");
    addEdge(id, commitId, "commits", "反应决定");
  }
  for (const request of committed.checkRequests) {
    const id = `check:${request.id}`;
    const result = committed.checks.find((candidate) => candidate.requestId === request.id);
    nodes.push({
      id,
      revision,
      laneId: entityActors.get(request.actorId) ?? WORLD_LANE_ID,
      kind: "check",
      label: request.phase === "perception" ? "感知检定" : "结算检定",
      description: result ? `${result.succeeded ? "成功" : "失败"} · ${result.total} / DC ${result.dc}` : request.stakes,
      ...(result ? { status: result.succeeded ? "succeeded" as const : "failed" as const } : {}),
    });
    connect(request.causes, id);
    addEdge(id, commitId, "commits", "检定结果");
  }
  for (const request of committed.randomRequests) {
    const id = `random:${request.id}`;
    nodes.push({ id, revision, laneId: WORLD_LANE_ID, kind: "random", label: "随机承诺", description: request.distribution.description });
    connect(request.causes, id);
    addEdge(id, commitId, "commits", "随机结果");
  }
  for (const invocation of committed.mechanicInvocations) {
    const id = `mechanic:${invocation.id}`;
    nodes.push({ id, revision, laneId: WORLD_LANE_ID, kind: "mechanic", label: `机制 · ${invocation.ruleId}`, description: invocation.packageId });
    connect(invocation.causes, id);
    addEdge(id, commitId, "commits", "机制结果");
  }
  committed.operations.forEach((operation, index) => {
    const id = `operation:${revision}:${index + 1}`;
    const laneId = operation.kind === "create_agent" ? operation.agent.id
      : operation.kind === "remove_agent" ? operation.agentId : WORLD_LANE_ID;
    nodes.push({ id, revision, laneId, kind: "operation", label: operationLabel(operation), description: `${operation.causes.length} 个直接原因` });
    connect(operation.causes, id);
    addEdge(id, commitId, "commits", "状态变化");
  });
  for (const event of committed.events) {
    const id = `event:${event.id}`;
    nodes.push({ id, revision, laneId: WORLD_LANE_ID, kind: "event", label: "世界事件", description: event.description });
    connect(event.causes, id);
    addEdge(id, commitId, "commits", "事件写入");
  }
  for (const observation of committed.observations) {
    const id = `observation:${observation.id}`;
    nodes.push({ id, revision, laneId: observation.observerId, kind: "observation", label: observation.kind === "stimulus" ? "即时刺激" : "主观观察", description: observation.summary });
    for (const eventId of observation.sourceEventIds) {
      const source = references.get(`event:${eventId}`);
      if (source) addEdge(source, id, "observes", "感知");
    }
  }
  const mindActorIds = [...new Set([
    ...committed.beliefPatches.map((entry) => entry.agentId),
    ...committed.characterPatches.map((entry) => entry.agentId),
    ...committed.nextActions.map((entry) => entry.actorId),
  ])].sort();
  for (const agentId of mindActorIds) {
    const id = `mind:${revision}:${agentId}`;
    const nextAction = committed.nextActions.find((action) => action.actorId === agentId);
    nodes.push({ id, revision, laneId: agentId, kind: "mind", label: "心智演化", description: nextAction?.goal ?? "认知状态更新" });
    for (const observation of committed.observations.filter((entry) => entry.observerId === agentId)) {
      addEdge(`observation:${observation.id}`, id, "updates", "更新认知");
    }
    addEdge(id, commitId, "commits", nextAction ? "准备下一行动" : "更新主体状态");
  }
  return {
    summary: {
      revision,
      step: committed.step,
      contentHash: committed.contentHash,
      elapsedSeconds,
      primaryAction,
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
        mindUpdates: mindActorIds.length,
        modelInvocations: audits.reduce((sum, audit) => sum + audit.invocations.length, 0),
      },
      tokenUsage: tokenUsage(audits),
      nodeIds: nodes.map((node) => node.id),
    },
    nodes,
    edges,
  };
}

export function worldInspectorRuntimeEventId(event: RuntimeEvent): string {
  return `runtime-${contentHash({ executionId: event.correlation?.executionId, sequence: event.sequence })}`;
}

export function summarizeRuntimeEvent(event: RuntimeEvent): WorldInspectorRuntimeEventSummary {
  const { payload, ...summary } = structuredClone(event);
  return { ...summary, id: worldInspectorRuntimeEventId(event), hasPayload: payload !== undefined };
}

function nullableMeasurement(event: RuntimeEvent | undefined, key: string): number | null {
  const value = event?.measurements?.[key];
  return typeof value === "number" ? value : null;
}

function modelTokenUsage(events: readonly RuntimeEvent[]): WorldInspectorModelTokenUsage {
  const source = [...events].reverse().find((event) =>
    event.event === "model.structured_output.parsed" || event.event === "model.structured_output.rejected");
  return {
    input: nullableMeasurement(source, "inputTokens"),
    output: nullableMeasurement(source, "outputTokens"),
    reasoning: nullableMeasurement(source, "reasoningTokens"),
    cacheRead: nullableMeasurement(source, "cacheReadTokens"),
    cacheWrite: nullableMeasurement(source, "cacheWriteTokens"),
  };
}

function payloadEventId(event: RuntimeEvent | undefined): string | undefined {
  return event && event.payload !== undefined ? worldInspectorRuntimeEventId(event) : undefined;
}

function jsonBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value) ?? "", "utf8");
}

function itemCount(value: unknown): number | null {
  return Array.isArray(value) ? value.length
    : value && typeof value === "object" ? Object.keys(value).length : null;
}

function contextSections(context: unknown): WorldInspectorModelInvocationSummary["contextSections"] {
  if (!context || typeof context !== "object" || Array.isArray(context)) return [];
  return Object.entries(context as Record<string, unknown>).map(([key, value]) => ({
    key,
    utf8Bytes: jsonBytes(value),
    itemCount: itemCount(value),
    hash: contentHash(value),
  }));
}

function slotRefs(
  context: unknown,
  actionCompilationAudit?: ActionCompilationReferenceAudit,
): WorldInspectorModelInvocationSummary["slotRefs"] {
  const auditSlots = () => actionCompilationAudit?.slots.map((auditSlot) => ({
    slot: auditSlot.slot,
    agentId: auditSlot.actor.agentId,
    actionId: auditSlot.actionId,
    label: auditSlot.actionLabel,
  })) ?? [];
  if (!context || typeof context !== "object" || Array.isArray(context)) return auditSlots();
  const task = (context as { task?: unknown }).task;
  const slots = task && typeof task === "object" && !Array.isArray(task)
    ? (task as { slots?: unknown }).slots
    : (context as { slots?: unknown }).slots;
  if (!Array.isArray(slots)) return auditSlots();
  const projected = slots.map((entry, index) => {
    const value = entry && typeof entry === "object" ? entry as Record<string, unknown> : {};
    const action = value.action && typeof value.action === "object" ? value.action as Record<string, unknown> : undefined;
    const perspective = (value.perspective ?? value.actorPerspective) &&
      typeof (value.perspective ?? value.actorPerspective) === "object"
      ? (value.perspective ?? value.actorPerspective) as Record<string, unknown>
      : undefined;
    const self = perspective?.self && typeof perspective.self === "object"
      ? perspective.self as Record<string, unknown> : undefined;
    const slot = typeof value.slot === "number" && Number.isSafeInteger(value.slot) ? value.slot : index;
    const agentId = typeof action?.actorId === "string" ? action.actorId
      : typeof perspective?.agentId === "string" ? perspective.agentId : undefined;
    const actionId = typeof action?.id === "string" ? action.id : undefined;
    const label = typeof action?.rawText === "string" ? action.rawText
      : typeof self?.name === "string" ? self.name : undefined;
    return {
      slot,
      ...(agentId ? { agentId } : {}),
      ...(actionId ? { actionId } : {}),
      ...(label ? { label } : {}),
      ...(!agentId && !actionId ? { unresolvedReason: "request context does not expose an Agent or action identity" } : {}),
    };
  });
  if (actionCompilationAudit) return auditSlots();
  return projected;
}

function actionCompilationAuditFromEvents(events: readonly RuntimeEvent[]): ActionCompilationReferenceAudit | undefined {
  const event = [...events].reverse().find((candidate) => candidate.event === "model.action_compilation.references");
  const payload = event?.payload;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return undefined;
  const value = payload as Partial<ActionCompilationReferenceAudit>;
  return value.protocolVersion === 1 && value.projection === "candidate-key-v1-deterministic-details" &&
    Array.isArray(value.slots) && value.context && typeof value.context === "object"
    ? structuredClone(payload) as ActionCompilationReferenceAudit
    : undefined;
}

function invocationStatus(events: readonly RuntimeEvent[]): WorldInspectorModelInvocationSummary["status"] {
  if (events.some((event) => event.event === "model.semantic.rejected" || event.event === "model.structured_output.rejected")) {
    return "rejected";
  }
  if (events.some((event) => event.event === "model.invocation.failed")) return "failed";
  if (events.some((event) => event.event === "model.semantic.accepted" || event.event === "model.structured_output.parsed")) {
    return "accepted";
  }
  return "active";
}

function eventDuration(events: readonly RuntimeEvent[], eventName: string): number {
  return events.filter((event) => event.event === eventName)
    .reduce((sum, event) => sum + (event.durationMs ?? 0), 0);
}

export function worldInspectorModelInvocationId(executionId: string, sourceInvocationId: string): string {
  return `${executionId}::${sourceInvocationId}`;
}

function scopeModelInvocation(
  executionId: string,
  invocation: WorldInspectorModelInvocationSummary,
): WorldInspectorModelInvocationSummary {
  return {
    ...invocation,
    id: invocation.id.includes("::") ? invocation.id : worldInspectorModelInvocationId(executionId, invocation.sourceInvocationId),
  };
}

function modelInvocationProjection(events: readonly RuntimeEvent[]): WorldInspectorModelInvocationSummary[] {
  const groups = new Map<string, RuntimeEvent[]>();
  for (const event of events) {
    if (!event.event.startsWith("model.")) continue;
    const sourceInvocationId = event.correlation?.modelInvocationId ??
      `unresolved:${event.correlation?.modelRole ?? "model"}:${event.correlation?.modelSubject ?? "unknown"}:${event.correlation?.modelInvocation ?? event.sequence}`;
    const executionId = event.correlation?.executionId ?? "unscoped";
    const id = worldInspectorModelInvocationId(executionId, sourceInvocationId);
    const group = groups.get(id) ?? [];
    group.push(event);
    groups.set(id, group);
  }
  const firstSequenceById = new Map(
    [...groups.entries()].map(([id, group]) => [id, Math.min(...group.map((event) => event.sequence))]),
  );
  const projected = [...groups.entries()].map(([id, group]) => {
    const ordered = [...group].sort((left, right) => left.sequence - right.sequence);
    const stageEvent = ordered.find((event) => event.correlation?.logicalStageIndex !== undefined || event.correlation?.logicalStageKey);
    const logicalStageIndex = stageEvent?.correlation?.logicalStageIndex ?? Number.MAX_SAFE_INTEGER;
    const logicalStageKey = stageEvent?.correlation?.logicalStageKey ?? "unclassified";
    const logicalStageLabel = EXECUTION_STAGES.find((stage) => stage.key === logicalStageKey)?.label ?? "未分类证据";
    const parallelGroupId = typeof stageEvent?.attributes?.parallelGroupId === "string"
      ? stageEvent.attributes.parallelGroupId : logicalStageIndex === Number.MAX_SAFE_INTEGER ? undefined : `stage:${logicalStageIndex}`;
    const started = ordered.find((event) => event.event === "model.invocation.started");
    const contextEvent = ordered.find((event) => event.event === "model.context.serialized");
    const parsed = [...ordered].reverse().find((event) =>
      event.event === "model.structured_output.parsed" || event.event === "model.structured_output.rejected");
    const terminal = [...ordered].reverse().find((event) =>
      event.event === "model.semantic.accepted" || event.event === "model.semantic.rejected" ||
      event.event === "model.invocation.failed" || event.event === "model.structured_output.rejected" ||
      event.event === "model.structured_output.parsed");
    const contextDocument = contextEvent?.payload && typeof contextEvent.payload === "object"
      ? contextEvent.payload as { context?: unknown } : undefined;
    const actionCompilationReferenceAudit = actionCompilationAuditFromEvents(ordered);
    const transportGroups = new Map<number, RuntimeEvent[]>();
    for (const event of ordered) {
      const attempt = event.correlation?.transportAttempt;
      if (!attempt) continue;
      const transport = transportGroups.get(attempt) ?? [];
      transport.push(event);
      transportGroups.set(attempt, transport);
    }
    const transportAttempts = [...transportGroups.entries()].sort(([left], [right]) => left - right).map(([attempt, transport]) => {
      const completed = [...transport].reverse().find((event) => event.event === "model.transport.completed");
      const failed = [...transport].reverse().find((event) => event.event === "model.transport.failed");
      const retry = [...transport].reverse().find((event) => event.event === "model.transport.retry_wait");
      const status: WorldInspectorModelInvocationSummary["transportAttempts"][number]["status"] = completed ? "succeeded" : failed
        ? (failed.attributes?.status === "retryable_error" ? "retryable_error" : "failed")
        : "failed";
      return {
        attempt,
        status,
        ...((failed?.error?.status ?? failed?.attributes?.statusCode) !== undefined
          ? { statusCode: failed?.error?.status ?? failed?.attributes?.statusCode as number }
          : {}),
        ...(failed?.error ? { errorName: failed.error.name } : {}),
        queueWaitMs: eventDuration(transport, "model.queue.completed"),
        executionMs: completed?.durationMs ?? failed?.durationMs ?? eventDuration(transport, "model.transport.completed"),
        retryDelayMs: retry?.measurements?.retryDelayMs ?? retry?.durationMs ?? 0,
        eventIds: transport.map(worldInspectorRuntimeEventId),
      };
    });
    const requestEvent = ordered.find((event) => event.event === "model.transport.request.raw");
    const responseEvent = [...ordered].reverse().find((event) => event.event === "model.transport.response.raw");
    const outputEvent = [...ordered].reverse().find((event) =>
      event.event === "model.structured_output.parsed" || event.event === "model.structured_output.rejected");
    const normalizationEvent = [...ordered].reverse().find((event) => event.event === "model.output.normalized");
    const invocationMs = started && terminal
      ? Math.max(0, Date.parse(terminal.timestamp) - Date.parse(started.timestamp)) : undefined;
    const errorEvent = [...ordered].reverse().find((event) => event.error);
    const issueCodes = new Set<string>();
    const issueDetails = new Map<string, {
      code: string;
      class: string;
      path: Array<string | number>;
      message: string;
      originalValue?: unknown;
      allowedHandles?: string[];
    }>();
    for (const event of ordered) {
      if (event.error?.name) issueCodes.add(event.error.name);
      const payload = event.payload && typeof event.payload === "object" ? event.payload as Record<string, unknown> : undefined;
      const issues = payload?.issues;
      if (Array.isArray(issues)) {
        issues.forEach((issue) => {
          if (issue && typeof issue === "object" && typeof (issue as { code?: unknown }).code === "string") {
            const value = issue as {
              code: string;
              class?: unknown;
              path?: unknown;
              message?: unknown;
              reason?: unknown;
              originalValue?: unknown;
              allowedHandles?: unknown;
            };
            issueCodes.add(value.code);
            const path = Array.isArray(value.path)
              ? value.path.filter((part): part is string | number => typeof part === "string" || typeof part === "number")
              : [];
            const key = `${value.code}:${JSON.stringify(path)}:${String(value.message ?? value.reason ?? value.code)}`;
            issueDetails.set(key, {
              code: value.code,
              class: typeof value.class === "string" ? value.class : "semantic",
              path,
              message: typeof value.message === "string" ? value.message : typeof value.reason === "string" ? value.reason : value.code,
              ...(value.originalValue !== undefined ? { originalValue: structuredClone(value.originalValue) } : {}),
              ...(Array.isArray(value.allowedHandles) ? { allowedHandles: value.allowedHandles.filter((handle): handle is string => typeof handle === "string") } : {}),
            });
          }
        });
      }
    }
    const normalizationCounts = normalizationEvent?.counts ?? {};
    const normalizationApplied = normalizationEvent?.attributes?.applied === true;
    const normalizedOutputHash = normalizationEvent?.hashes?.normalizedOutput ?? outputEvent?.hashes?.response ?? null;
    const rawOutputHash = normalizationEvent?.hashes?.rawOutput ?? outputEvent?.hashes?.response ?? null;
    const tokenUsage = modelTokenUsage(ordered);
    const context = contextDocument?.context;
    const requestMeasurements = contextEvent?.measurements;
    const queueWaitMs = transportAttempts.reduce((sum, attempt) => sum + attempt.queueWaitMs, 0);
    const transportMs = transportAttempts.reduce((sum, attempt) => sum + attempt.executionMs, 0);
    const retryDelayMs = transportAttempts.reduce((sum, attempt) => sum + attempt.retryDelayMs, 0);
    const payloadEventIds = {
      ...(payloadEventId(contextEvent) ? { context: worldInspectorRuntimeEventId(contextEvent!) } : {}),
      ...(payloadEventId(requestEvent) ? { request: worldInspectorRuntimeEventId(requestEvent!) } : {}),
      ...(payloadEventId(responseEvent) ? { response: worldInspectorRuntimeEventId(responseEvent!) } : {}),
      ...((normalizationEvent ?? outputEvent) ? { output: worldInspectorRuntimeEventId((normalizationEvent ?? outputEvent)!) } : {}),
    };
    const artifactHashes = {
      ...(contextEvent?.hashes?.request ? { context: contextEvent.hashes.context ?? contextEvent.hashes.request } : {}),
      ...(requestEvent?.hashes?.request ? { request: requestEvent.hashes.request } : {}),
      ...(responseEvent?.hashes?.response ? { response: responseEvent.hashes.response } : {}),
      ...(normalizationEvent?.hashes?.normalizedOutput ?? outputEvent?.hashes?.response ? { output: normalizationEvent?.hashes?.normalizedOutput ?? outputEvent?.hashes?.response } : {}),
    };
    return {
      id,
      sourceInvocationId: id.slice(id.indexOf("::") + 2),
      // The provider correlation ordinal is scoped to the producer/batch and is
      // commonly `1` for every request in an attempt. The Inspector contract
      // needs a stable, human-readable sequence for the logical invocations in
      // this attempt, so ordinals are assigned after grouping and chronological
      // ordering below.
      ordinal: ordered.find((event) => event.correlation?.modelInvocation)?.correlation?.modelInvocation ?? 0,
      logicalStageIndex,
      logicalStageKey,
      logicalStageLabel,
      ...(parallelGroupId ? { parallelGroupId } : {}),
      ...(started?.correlation?.modelRole ? { role: started.correlation.modelRole } : {}),
      ...(started?.correlation?.modelSubject ? { subjectId: started.correlation.modelSubject } : {}),
      ...(started?.attributes?.providerId ? { providerId: String(started.attributes.providerId) } : {}),
      ...(started?.attributes?.accountId ? { accountId: String(started.attributes.accountId) } : {}),
      ...(started?.attributes?.modelId ? { modelId: String(started.attributes.modelId) } : {}),
      ...(started?.attributes?.profileId ? { profileId: String(started.attributes.profileId) } : {}),
      ...(started?.attributes?.promptVersion ? { promptVersion: String(started.attributes.promptVersion) } : {}),
      ...(started?.attributes?.schemaName ? { schemaName: String(started.attributes.schemaName) } : {}),
      status: invocationStatus(ordered),
      ...(started ? { startedAt: started.timestamp } : {}),
      ...(terminal ? { updatedAt: terminal.timestamp } : ordered.at(-1) ? { updatedAt: ordered.at(-1)!.timestamp } : {}),
      slotRefs: slotRefs(context, actionCompilationReferenceAudit),
      transportAttempts,
      retryCount: Math.max(0, transportAttempts.length - 1),
      tokenUsage,
      ...(requestMeasurements?.requestUtf8Bytes !== undefined ? { requestUtf8Bytes: requestMeasurements.requestUtf8Bytes } : {}),
      ...(requestMeasurements?.contextUtf8Bytes !== undefined ? { contextUtf8Bytes: requestMeasurements.contextUtf8Bytes } : {}),
      ...(parsed?.measurements?.responseUtf8Bytes !== undefined ? { responseUtf8Bytes: parsed.measurements.responseUtf8Bytes } : {}),
      contextSections: contextSections(context),
      timings: {
        ...(invocationMs === undefined ? {} : { invocationMs }),
        queueWaitMs,
        transportMs,
        parseMs: eventDuration(ordered, "model.structured_output.parsed") + eventDuration(ordered, "model.structured_output.rejected"),
        retryDelayMs,
      },
      eventIds: ordered.map(worldInspectorRuntimeEventId),
      payloadEventIds,
      artifactHashes,
      outputDisposition: ordered.some((event) => event.event === "model.semantic.rejected" || event.event === "model.structured_output.rejected")
        ? "rejected"
        : ordered.some((event) => event.event === "model.semantic.repaired")
          ? "llm-repaired"
          : normalizationApplied ? "auto-normalized" : "accepted",
      issues: (() => {
        const details = new Map(issueDetails);
        for (const code of issueCodes) {
          if (details.has(`${code}:[]:${code}`) || [...details.values()].some((issue) => issue.code === code)) continue;
          const event = ordered.find((candidate) => candidate.error?.name === code);
          details.set(`${code}:[]:${code}`, {
            code,
            class: code.includes("Transport") ? "transport" : code.includes("Schema") ? "structure" : "semantic",
            path: [],
            message: event?.error?.message ?? code,
          });
        }
        return [...details.values()];
      })(),
      normalization: {
        applied: normalizationApplied,
        modifiedFieldCount: typeof normalizationCounts.modifiedFields === "number" ? normalizationCounts.modifiedFields : 0,
        resolvedReferenceCount: typeof normalizationCounts.resolvedReferences === "number" ? normalizationCounts.resolvedReferences : 0,
        proposalCount: typeof normalizationCounts.proposals === "number" ? normalizationCounts.proposals : 0,
        deduplicatedCount: typeof normalizationCounts.deduplicated === "number" ? normalizationCounts.deduplicated : 0,
      },
      referenceCatalogVersion: 1,
      referenceCatalogHash: (() => {
        if (typeof context !== "object" || context === null || Array.isArray(context)) return contentHash(null);
        const envelope = context as {
          referenceCatalog?: { hash?: unknown };
        };
        if (typeof envelope.referenceCatalog?.hash === "string") return envelope.referenceCatalog.hash;
        return contentHash(null);
      })(),
      rawOutputHash,
      normalizedOutputHash,
      ...(actionCompilationReferenceAudit ? { actionCompilationReferenceAudit } : {}),
      ...(errorEvent?.error?.message ? { errorMessage: diagnosticErrorMessage(errorEvent.error) } : {}),
      hasPayload: ordered.some((event) => event.payload !== undefined),
    } satisfies WorldInspectorModelInvocationSummary;
  });
  const ordered = projected.sort((left, right) => {
    return (left.logicalStageIndex ?? Number.MAX_SAFE_INTEGER) - (right.logicalStageIndex ?? Number.MAX_SAFE_INTEGER) ||
      (firstSequenceById.get(left.id) ?? Number.MAX_SAFE_INTEGER) - (firstSequenceById.get(right.id) ?? Number.MAX_SAFE_INTEGER) ||
      left.id.localeCompare(right.id);
  });
  const stageOrdinals = new Map<number, number>();
  return ordered.map((invocation, index) => {
    const stageIndex = invocation.logicalStageIndex ?? Number.MAX_SAFE_INTEGER;
    const logicalInvocationOrdinal = (stageOrdinals.get(stageIndex) ?? 0) + 1;
    stageOrdinals.set(stageIndex, logicalInvocationOrdinal);
    return { ...invocation, ordinal: index + 1, logicalInvocationOrdinal };
  });
}

function sumModelTokens(invocations: readonly WorldInspectorModelInvocationSummary[]): WorldInspectorTokenUsage {
  let input = 0;
  let output = 0;
  let unknown = false;
  for (const invocation of invocations) {
    if (invocation.tokenUsage.input === null) unknown = true; else input += invocation.tokenUsage.input;
    if (invocation.tokenUsage.output === null) unknown = true; else output += invocation.tokenUsage.output;
  }
  return { input, output, total: input + output, unknown };
}

interface MutableActorActivity {
  steps: number;
  attempts: number;
  modelInvocations: number;
  transportAttempts: number;
  retries: number;
  rejectionCount: number;
  input: number;
  output: number;
  unknown: boolean;
  durationMs: number;
}

function actorActivityMap(actors: readonly WorldInspectorActor[]): Map<string, MutableActorActivity> {
  return new Map(actors.map((actor) => [actor.id, {
    steps: 0,
    attempts: 0,
    modelInvocations: 0,
    transportAttempts: 0,
    retries: 0,
    rejectionCount: 0,
    input: 0,
    output: 0,
    unknown: false,
    durationMs: 0,
  }]));
}

function addActorInvocations(
  stats: Map<string, MutableActorActivity>,
  invocations: readonly WorldInspectorModelInvocationSummary[],
): void {
  for (const invocation of invocations) {
    const actorIds = new Set(invocation.slotRefs.flatMap((slot) => slot.agentId ? [slot.agentId] : []));
    if (actorIds.size === 0 && invocation.subjectId && stats.has(invocation.subjectId)) actorIds.add(invocation.subjectId);
    for (const actorId of actorIds) {
      const activity = stats.get(actorId);
      if (!activity) continue;
      activity.modelInvocations += 1;
      activity.transportAttempts += invocation.transportAttempts.length;
      activity.retries += invocation.retryCount;
      if (invocation.status === "rejected") activity.rejectionCount += 1;
      if (invocation.tokenUsage.input === null) activity.unknown = true; else activity.input += invocation.tokenUsage.input;
      if (invocation.tokenUsage.output === null) activity.unknown = true; else activity.output += invocation.tokenUsage.output;
      activity.durationMs += invocation.timings.invocationMs ?? 0;
    }
  }
}

function eventActors(events: readonly RuntimeEvent[], knownAgents: ReadonlySet<string>): string[] {
  const found = new Set<string>();
  const visit = (value: unknown, depth = 0): void => {
    if (depth > 10 || value === null || value === undefined) return;
    if (Array.isArray(value)) {
      for (const entry of value) visit(entry, depth + 1);
      return;
    }
    if (typeof value !== "object") return;
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (["actorId", "agentId", "observerId"].includes(key) && typeof entry === "string" && knownAgents.has(entry)) {
        found.add(entry);
      }
      visit(entry, depth + 1);
    }
  };
  for (const event of events) {
    if (event.correlation?.modelSubject && knownAgents.has(event.correlation.modelSubject)) {
      found.add(event.correlation.modelSubject);
    }
    visit(event.payload);
  }
  return [...found].sort();
}

const stageLabels: Readonly<Record<string, string>> = {
  "action-compilation": "行动编译",
  "action-grounding": "行动 Grounding",
  "truth-perception": "感知裁决",
  "truth-reaction-routing": "反应路由",
  "agent-reaction": "Agent 反应",
  "truth-resolution": "冲突结算",
  "truth-transition": "状态转移",
  "causal-verifier": "因果复核",
  "agent-mind": "Agent 心智更新",
  "arrival-generator": "入场生成",
};

function attemptStages(events: readonly RuntimeEvent[]): WorldInspectorAttemptStage[] {
  const groups = new Map<number, RuntimeEvent[]>();
  for (const event of events) {
    const index = event.correlation?.logicalStageIndex;
    if (typeof index !== "number") continue;
    const group = groups.get(index) ?? [];
    group.push(event);
    groups.set(index, group);
  }
  return [...groups.entries()].sort(([left], [right]) => left - right).map(([index, group]) => {
    const ordered = [...group].sort((left, right) => left.sequence - right.sequence);
    const terminal = [...ordered].reverse().find((event) => event.event === "debug.stage.completed" ||
      event.event === "debug.stage.failed" || event.event === "model.semantic.accepted" ||
      event.event === "model.semantic.rejected" || event.event === "model.structured_output.parsed" ||
      event.event === "model.structured_output.rejected" || event.event === "model.invocation.failed");
    const failed = terminal?.event === "debug.stage.failed" || terminal?.event === "model.semantic.rejected" ||
      terminal?.event === "model.structured_output.rejected" || terminal?.event === "model.invocation.failed";
    const error = [...ordered].reverse().find((event) => event.error)?.error;
    const stage = EXECUTION_STAGES.find((candidate) => candidate.index === index);
    const role = ordered.find((event) => event.correlation?.modelRole)?.correlation?.modelRole;
    return {
      id: `stage:${index}`,
      label: stage?.label ?? `阶段 ${index + 1}`,
      status: failed ? "failed" : terminal ? "succeeded" : "active",
      startedAt: ordered[0].timestamp,
      updatedAt: ordered.at(-1)!.timestamp,
      eventCount: ordered.length,
      modelInvocationCount: new Set(ordered.flatMap((event) => event.correlation?.modelInvocationId
        ? [event.correlation.modelInvocationId] : [])).size,
      rejectionCount: ordered.filter((event) => event.event === "model.semantic.rejected").length,
      repairCount: ordered.filter((event) => (event.correlation?.modelInvocation ?? 1) > 1).length,
      ...(role ? { modelRole: role } : {}),
      ...(stage ? { logicalStageIndex: stage.index, logicalStageKey: stage.key } : {}),
      ...(error?.message ? { errorMessage: diagnosticErrorMessage(error) } : {}),
    };
  });
}

function attemptedActions(events: readonly RuntimeEvent[]): CommittedStep["initialActions"] {
  const candidate = events.find((event) => event.event === "execution.candidate.persisted")?.payload as {
    resolution?: { initialActions?: unknown };
  } | undefined;
  return Array.isArray(candidate?.resolution?.initialActions)
    ? structuredClone(candidate.resolution.initialActions) as CommittedStep["initialActions"]
    : [];
}

function attemptSummary(
  record: ExecutionRecord,
  events: readonly RuntimeEvent[],
  knownAgents: ReadonlySet<string>,
): WorldInspectorAttemptSummary {
  const last = events.at(-1);
  const error = [...events].reverse().find((event) => event.error)?.error;
  const invocations = modelInvocationProjection(events);
  const stages = attemptStages(events);
  const actorIds = new Set(attemptedActions(events).map((action) => action.actorId));
  for (const invocation of invocations) {
    for (const slot of invocation.slotRefs) if (slot.agentId && knownAgents.has(slot.agentId)) actorIds.add(slot.agentId);
    if (invocation.subjectId && knownAgents.has(invocation.subjectId)) actorIds.add(invocation.subjectId);
  }
  const status = record.status === "running" ? "active" : record.status === "succeeded"
    ? "committed" : record.status === "cancelled" ? "cancelled" : "failed";
  const failedEvent = [...events].reverse().find((event) =>
    event.event === "model.semantic.rejected" || event.event === "model.structured_output.rejected" ||
    event.event === "model.invocation.failed" || (event.level === "error" && !event.event.startsWith("model.transport.")));
  const failureStage = failedEvent?.correlation?.logicalStageKey ?? failedEvent?.correlation?.modelRole ??
    (typeof failedEvent?.attributes?.phase === "string" ? failedEvent.attributes.phase : undefined);
  return {
    id: record.id,
    ...(record.advanceId ? { advanceId: record.advanceId } : {}),
    ...(record.commitRevision !== undefined ? { revision: record.commitRevision } : {}),
    ...(record.step !== undefined ? { step: record.step } : {}),
    status,
    startedAt: record.startedAt ?? events[0]?.timestamp ?? "",
    updatedAt: record.finishedAt ?? last?.timestamp ?? record.startedAt ?? "",
    ...(record.finishedAt ? { terminalAt: record.finishedAt } : {}),
    ...(record.finishedAt ? { durationMs: Math.max(0, Date.parse(record.finishedAt) - Date.parse(record.startedAt ?? record.finishedAt)) } : {}),
    latestEvent: last?.event ?? `execution.${record.status}`,
    eventCount: events.length,
    modelInvocationCount: invocations.length,
    transportAttemptCount: invocations.reduce((sum, invocation) => sum + invocation.transportAttempts.length, 0),
    retryCount: invocations.reduce((sum, invocation) => sum + invocation.retryCount, 0),
    tokenUsage: sumModelTokens(invocations),
    actorIds: [...actorIds].sort(),
    relatedActorIds: eventActors(events, knownAgents),
    stages,
    rejectionCount: events.filter((event) => event.event === "model.semantic.rejected").length,
    repairCount: events.filter((event) => (event.correlation?.modelInvocation ?? 1) > 1).length,
    ...(failureStage ? { failureStage, failureStageLabel: EXECUTION_STAGES.find((stage) => stage.key === failureStage)?.label ?? stageLabels[failureStage] ?? failureStage } : {}),
    ...(error?.message ? { errorMessage: diagnosticErrorMessage(error) } : {}),
  };
}

function traceAvailability(events: readonly RuntimeEvent[]): WorldInspectorTraceAvailability {
  return {
    mode: "full",
    degraded: false,
    retainedEventCount: events.length,
    ...(events[0] ? { earliestTimestamp: events[0].timestamp } : {}),
    ...(events.at(-1) ? { latestTimestamp: events.at(-1)!.timestamp } : {}),
    hasFullPayload: true,
  };
}

function semanticGraph(
  document: WorldInstanceDocument,
  attempts: readonly WorldInspectorAttemptSummary[],
  steps: readonly WorldInspectorStepSummary[],
): { nodes: WorldInspectorNodeSummary[]; edges: WorldInspectorEdgeSummary[] } {
  const nodes: WorldInspectorNodeSummary[] = [];
  const edges: WorldInspectorEdgeSummary[] = [];
  const attempt = attempts.at(-1);
  const step = steps.at(-1);
  const revision = attempt?.revision ?? step?.revision ?? document.state.revision;
  const rootId = attempt ? `semantic:intent:${attempt.id}` : `semantic:intent:revision-${revision}`;
  nodes.push({
    id: rootId,
    revision,
    laneId: WORLD_LANE_ID,
    kind: "action",
    label: "用户企图",
    description: attempt?.errorMessage ?? step?.primaryAction ?? "等待世界推演",
    status: attempt?.status === "failed" ? "failed" : attempt?.status === "active" ? "active" : "succeeded",
    ...(attempt ? { relatedAttemptId: attempt.id } : {}),
  });
  const stageByIndex = new Map((attempt?.stages ?? []).flatMap((stage) =>
    stage.logicalStageIndex === undefined ? [] : [[stage.logicalStageIndex, stage]]));
  let previous = rootId;
  for (const stage of EXECUTION_STAGES) {
    const evidence = stageByIndex.get(stage.index);
    const id = `semantic:stage:${attempt?.id ?? `revision-${revision}`}:${stage.index}`;
    const status = evidence?.status ?? (attempt ? "active" : "succeeded");
    nodes.push({
      id,
      revision,
      laneId: WORLD_LANE_ID,
      kind: "stage",
      label: `${stage.index + 1}. ${stage.label}`,
      description: evidence
        ? `${evidence.modelInvocationCount} 个逻辑调用 · ${evidence.eventCount} 条证据`
        : attempt ? "尚未到达" : "由已有 Ledger 证据推导",
      status,
      ...(evidence?.modelInvocationCount ? { count: evidence.modelInvocationCount } : {}),
      ...(attempt ? { relatedAttemptId: attempt.id } : {}),
    });
    edges.push({
      id: `semantic:feeds:${previous}:${id}`,
      source: previous,
      target: id,
      kind: "causal",
      label: stage.index === 0 ? "开始" : "推进",
    });
    previous = id;
  }
  if (step) {
    const commitId = `semantic:commit:${step.revision}`;
    nodes.push({
      id: commitId,
      revision: step.revision,
      laneId: WORLD_LANE_ID,
      kind: "commit",
      label: "提交",
      description: `Revision ${step.revision} · 世界时间 ${step.elapsedSeconds} 秒`,
      status: "succeeded",
    });
    edges.push({ id: `semantic:commit:${previous}:${commitId}`, source: previous, target: commitId, kind: "commits", label: "原子提交" });
  }
  return { nodes, edges };
}

export function buildWorldInspectorWindow(
  document: WorldInstanceDocument,
  records: readonly ExecutionRecord[],
  runtimeEvents: readonly RuntimeEvent[],
  input: { beforeRevision?: number; limit: number },
): WorldInspectorWindow {
  const eligible = document.state.history.filter((step) =>
    input.beforeRevision === undefined || step.revision < input.beforeRevision);
  const selected = eligible.slice(-input.limit);
  const actors = actorsFor(document);
  const actorIds = new Set(actors.map((actor) => actor.id));
  const entityActors = new Map(actors.map((actor) => [actor.entityId, actor.id]));
  const projected = selected.map((step) => {
    const after = replaySimulationState(document.state, step.revision);
    return projectStep(step, after.truth.elapsedSeconds, entityActors, modelAuditsForStep(runtimeEvents, step));
  });
  const nodes = projected.flatMap((item) => item.nodes);
  const nodeIds = new Set(nodes.map((node) => node.id));
  const edges = projected.flatMap((item) => item.edges)
    .filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target));
  const attempts = records.map((record) => attemptSummary(
    record,
    runtimeEvents.filter((event) => event.correlation?.executionId === record.id),
    actorIds,
  )).slice(-50);
  const semantic = semanticGraph(document, attempts, projected.map((item) => item.summary));
  const activeRun = Object.values(document.runs).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
  const actorStats = actorActivityMap(actors);
  const attemptIds = new Set(attempts.map((attempt) => attempt.id));
  for (const step of selected) {
    for (const actorId of step.actions.map((action) => action.actorId)) {
      const activity = actorStats.get(actorId);
      if (activity) activity.steps += 1;
    }
    const executionEvents = runtimeEvents.filter((event) => event.correlation?.executionId === step.executionRef?.executionId);
    if (step.executionRef?.executionId && !attemptIds.has(step.executionRef.executionId)) {
      addActorInvocations(actorStats, modelInvocationProjection(executionEvents));
    }
  }
  for (const attempt of attempts) {
    const activityEvents = runtimeEvents.filter((event) => event.correlation?.executionId === attempt.id);
    for (const actorId of attempt.actorIds) {
      const activity = actorStats.get(actorId);
      if (activity) activity.attempts += 1;
    }
    addActorInvocations(actorStats, modelInvocationProjection(activityEvents));
  }
  for (const attempt of attempts) {
    const activityEvents = runtimeEvents.filter((event) => event.correlation?.executionId === attempt.id);
    const stages = attemptStages(activityEvents);
    const invocations = modelInvocationProjection(activityEvents);
    nodes.push({
      id: `attempt:${attempt.id}`,
      revision: attempt.revision ?? document.state.revision,
      laneId: WORLD_LANE_ID,
      kind: "attempt",
      label: attempt.status === "active" ? "运行中" : "执行记录",
      description: attempt.errorMessage ?? attempt.latestEvent,
      status: attempt.status === "active" ? "active" : attempt.status === "committed" ? "succeeded" : "rolled_back",
      relatedActorIds: attempt.relatedActorIds,
    });
    for (const stage of stages) {
      const stageNodeId = `stage:${attempt.id}:${stage.id}`;
      nodes.push({
        id: stageNodeId,
        revision: attempt.revision ?? document.state.revision,
        laneId: WORLD_LANE_ID,
        kind: "stage",
        label: stage.label,
        description: `${stage.id} · ${stage.eventCount} 条运行事件 · ${stage.modelInvocationCount} 次逻辑调用`,
        status: stage.status,
        relatedActorIds: invocations
          .filter((invocation) => invocation.role === stage.modelRole)
          .flatMap((invocation) => invocation.slotRefs.flatMap((slot) => slot.agentId ? [slot.agentId] : [])),
        relatedAttemptId: attempt.id,
      });
      edges.push({ id: `contains:attempt:${attempt.id}:${stageNodeId}`, source: `attempt:${attempt.id}`, target: stageNodeId, kind: "contains" });
    }
    for (const invocation of invocations) {
      const publicInvocation = scopeModelInvocation(attempt.id, invocation);
      const invocationNodeId = `invocation:${attempt.id}:${invocation.sourceInvocationId}`;
      const invocationLane = invocation.slotRefs.find((slot) => slot.agentId)?.agentId ?? WORLD_LANE_ID;
      nodes.push({
        id: invocationNodeId,
        revision: attempt.revision ?? document.state.revision,
        laneId: invocationLane,
        kind: "model_invocation",
        label: `Invocation ${invocation.ordinal || "?"}`,
        description: `${invocation.role ?? "模型调用"} · ${invocation.providerId ?? "未知 provider"} / ${invocation.modelId ?? "未知 model"}`,
        status: invocation.status,
        relatedActorIds: invocation.slotRefs.flatMap((slot) => slot.agentId ? [slot.agentId] : []),
        relatedAttemptId: attempt.id,
        relatedInvocationId: publicInvocation.id,
      });
      const stage = stages.find((candidate) => candidate.modelRole === invocation.role);
      const parentNodeId = stage ? `stage:${attempt.id}:${stage.id}` : `attempt:${attempt.id}`;
      edges.push({ id: `contains:${parentNodeId}:${invocationNodeId}`, source: parentNodeId, target: invocationNodeId, kind: "contains" });
      invocation.transportAttempts.forEach((transport) => {
        const transportNodeId = `transport:${attempt.id}:${invocation.sourceInvocationId}:${transport.attempt}`;
        nodes.push({
          id: transportNodeId,
          revision: attempt.revision ?? document.state.revision,
          laneId: invocationLane,
          kind: "transport_attempt",
          label: `Transport ${transport.attempt}`,
          description: `${transport.status}${transport.statusCode ? ` · HTTP ${transport.statusCode}` : ""} · ${transport.executionMs} ms`,
          status: transport.status === "succeeded" ? "succeeded" : "failed",
          relatedActorIds: invocation.slotRefs.flatMap((slot) => slot.agentId ? [slot.agentId] : []),
          relatedAttemptId: attempt.id,
          relatedInvocationId: publicInvocation.id,
        });
        edges.push({ id: `contains:${invocationNodeId}:${transportNodeId}`, source: invocationNodeId, target: transportNodeId, kind: "contains" });
        if (transport.attempt > 1) {
          const previous = `transport:${attempt.id}:${invocation.sourceInvocationId}:${transport.attempt - 1}`;
          edges.push({ id: `retry_of:${transportNodeId}:${previous}`, source: transportNodeId, target: previous, kind: "retry_of" });
        }
      });
      for (const issue of invocation.issues) {
        const code = issue.code;
        const validationNodeId = `validation:${attempt.id}:${invocation.sourceInvocationId}:${code}`;
        nodes.push({
          id: validationNodeId,
          revision: attempt.revision ?? document.state.revision,
          laneId: invocationLane,
          kind: "validation",
          label: "语义校验",
          description: code,
          status: "failed",
          relatedActorIds: invocation.slotRefs.flatMap((slot) => slot.agentId ? [slot.agentId] : []),
          relatedAttemptId: attempt.id,
          relatedInvocationId: publicInvocation.id,
        });
        edges.push({ id: `rejected_by:${invocationNodeId}:${validationNodeId}`, source: invocationNodeId, target: validationNodeId, kind: "rejected_by" });
      }
      for (const [kind, eventId] of Object.entries(invocation.payloadEventIds)) {
        if (!eventId) continue;
        const eventNodeId = `runtime-event:${eventId}`;
        nodes.push({
          id: eventNodeId,
          revision: attempt.revision ?? document.state.revision,
          laneId: WORLD_LANE_ID,
          kind: "event",
          label: "运行事件",
          description: `${kind} · ${eventId}`,
          relatedActorIds: invocation.slotRefs.flatMap((slot) => slot.agentId ? [slot.agentId] : []),
          relatedAttemptId: attempt.id,
          relatedInvocationId: publicInvocation.id,
        });
        edges.push({ id: `produces:${invocationNodeId}:${eventNodeId}`, source: invocationNodeId, target: eventNodeId, kind: "produces" });
        const artifactNodeId = `artifact:${eventId}`;
        nodes.push({
          id: artifactNodeId,
          revision: attempt.revision ?? document.state.revision,
          laneId: WORLD_LANE_ID,
          kind: "artifact",
          label: "Payload artifact",
          description: invocation.hasPayload ? eventId : "载荷不可用",
          relatedActorIds: invocation.slotRefs.flatMap((slot) => slot.agentId ? [slot.agentId] : []),
          relatedAttemptId: attempt.id,
          relatedInvocationId: publicInvocation.id,
        });
        edges.push({ id: `produces:${eventNodeId}:${artifactNodeId}`, source: eventNodeId, target: artifactNodeId, kind: "produces" });
      }
    }
  }
  return {
    apiVersion: WORLD_INSPECTOR_API_VERSION,
    instance: {
      id: document.id,
      title: document.title,
      worldId: document.world.id,
      worldName: document.world.name,
      worldHash: document.world.contentHash,
      revision: document.state.revision,
      step: document.state.step,
      elapsedSeconds: document.state.truth.elapsedSeconds,
      updatedAt: document.updatedAt,
      ...(activeRun ? {
        run: {
          id: activeRun.id,
          generation: activeRun.generation,
          status: activeRun.status,
          boundaryIndex: activeRun.debugCheckpoint?.boundaryIndex ?? activeRun.committedRevisions.length,
          stageIndex: activeRun.debugCheckpoint?.stageIndex ?? 0,
          stageCount: EXECUTION_STAGES.length,
          stageKey: activeRun.debugCheckpoint?.stageKey ?? null,
          stageLabel: activeRun.debugCheckpoint ? EXECUTION_STAGES.find((stage) => stage.key === activeRun.debugCheckpoint?.stageKey)?.label ?? null : null,
          checkpointId: activeRun.debugCheckpoint?.id ?? null,
          canAdvance: activeRun.status === "debug-paused",
        },
      } : {}),
    },
    actors: actors.map((actor) => {
      const activity = actorStats.get(actor.id);
      return activity ? {
        ...actor,
        activity: {
          steps: activity.steps,
          attempts: activity.attempts,
          modelInvocations: activity.modelInvocations,
          transportAttempts: activity.transportAttempts,
          retries: activity.retries,
          rejectionCount: activity.rejectionCount,
          tokenUsage: { input: activity.input, output: activity.output, total: activity.input + activity.output, unknown: activity.unknown },
          durationMs: activity.durationMs,
        },
      } : actor;
    }),
    steps: projected.map((item) => item.summary),
    nodes,
    edges,
    semanticNodes: semantic.nodes,
    semanticEdges: semantic.edges,
    attempts,
    trace: traceAvailability(runtimeEvents),
    pagination: {
      limit: input.limit,
      hasOlder: eligible.length > selected.length,
      ...(selected[0] ? { oldestRevision: selected[0].revision } : {}),
      ...(selected.at(-1) ? { newestRevision: selected.at(-1)!.revision } : {}),
    },
  };
}

export function buildWorldInspectorStepDetail(
  document: WorldInstanceDocument,
  revision: number,
  runtimeEvents: readonly RuntimeEvent[],
): WorldInspectorStepDetail | undefined {
  const committed = document.state.history.find((step) => step.revision === revision);
  if (!committed) return undefined;
  const before = replaySimulationState(document.state, committed.baseRevision);
  const after = replaySimulationState(document.state, committed.revision);
  const audits = modelAuditsForStep(runtimeEvents, committed);
  const actors = actorsFor(document);
  const projection = projectStep(
    committed,
    after.truth.elapsedSeconds,
    new Map(actors.map((actor) => [actor.entityId, actor.id])),
    audits,
  );
  const executionEvents = runtimeEvents.filter((event) =>
    event.correlation?.executionId === committed.executionRef?.executionId);
  return {
    apiVersion: WORLD_INSPECTOR_API_VERSION,
    summary: projection.summary,
    committed: { ...structuredClone(committed), modelAudits: audits },
    interaction: interactionEvidenceForStep(runtimeEvents, committed),
    before: snapshot(before),
    after: snapshot(after),
    runtimeEvents: executionEvents.map(summarizeRuntimeEvent),
    modelInvocations: modelInvocationProjection(executionEvents).map((invocation) =>
      scopeModelInvocation(committed.executionRef?.executionId ?? `revision-${revision}`, invocation)),
    trace: traceAvailability(executionEvents),
  };
}

export function buildWorldInspectorAttemptDetail(
  executionId: string,
  record: ExecutionRecord | undefined,
  runtimeEvents: readonly RuntimeEvent[],
  knownAgentIds: readonly string[],
): WorldInspectorAttemptDetail | undefined {
  if (!record) return undefined;
  const events = runtimeEvents.filter((event) => event.correlation?.executionId === executionId);
  return {
    apiVersion: WORLD_INSPECTOR_API_VERSION,
    summary: attemptSummary(record, events, new Set(knownAgentIds)),
    attemptedActions: attemptedActions(events),
    stages: attemptStages(events),
    events: events.map(summarizeRuntimeEvent),
    modelInvocations: modelInvocationProjection(events).map((invocation) =>
      scopeModelInvocation(executionId, invocation)),
    trace: traceAvailability(events),
  };
}

function invocationResult(
  record: ExecutionRecord,
  invocation: WorldInspectorModelInvocationSummary,
  ledgerSequence: number,
): WorldInspectorModelInvocationResult {
  return {
    ...invocation,
    id: worldInspectorModelInvocationId(record.id, invocation.sourceInvocationId),
    executionId: record.id,
    attemptId: record.id,
    boundaryIndex: record.step ?? record.commitRevision ?? 0,
    ledgerSequence,
    ...(record.commitRevision !== undefined ? { revision: record.commitRevision } : {}),
    ...(record.step !== undefined ? { step: record.step } : {}),
  };
}

function cursorOffset(cursor: string | undefined): number {
  if (!cursor) return 0;
  try {
    const value = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as { offset?: unknown };
    return typeof value.offset === "number" && Number.isSafeInteger(value.offset) && value.offset >= 0 ? value.offset : 0;
  } catch {
    return 0;
  }
}

function nextCursor(offset: number, total: number): string | undefined {
  if (offset >= total) return undefined;
  return Buffer.from(JSON.stringify({ offset }), "utf8").toString("base64url");
}

function querySortValue(item: WorldInspectorModelInvocationResult, sort: NonNullable<WorldInspectorModelInvocationQuery["sort"]>): number {
  if (sort === "stage") return (item.logicalStageIndex ?? Number.MAX_SAFE_INTEGER) * 1_000_000 + (item.logicalInvocationOrdinal ?? item.ordinal);
  if (sort === "duration") return item.timings.invocationMs ?? -1;
  if (sort === "inputTokens") return item.tokenUsage.input ?? -1;
  if (sort === "outputTokens") return item.tokenUsage.output ?? -1;
  if (sort === "retries") return item.retryCount;
  return item.startedAt ? Date.parse(item.startedAt) : item.ordinal;
}

export function queryWorldInspectorModelInvocations(
  records: readonly ExecutionRecord[],
  runtimeEvents: readonly RuntimeEvent[],
  input: WorldInspectorModelInvocationQuery = {},
): WorldInspectorModelInvocationQueryResult {
  const all = records.flatMap((record) => {
    const events = runtimeEvents.filter((event) => event.correlation?.executionId === record.id);
    return modelInvocationProjection(events).map((invocation) => invocationResult(record, invocation,
      events.find((event) => event.correlation?.modelInvocationId === invocation.sourceInvocationId)?.sequence ?? Number.MAX_SAFE_INTEGER));
  }).filter((item) => {
    const actorMatch = !input.actorId || item.slotRefs.some((slot) => slot.agentId === input.actorId) || item.subjectId === input.actorId;
    const duration = item.timings.invocationMs;
    const inputTokens = item.tokenUsage.input;
    return (!input.executionId || item.executionId === input.executionId) &&
      actorMatch && (!input.role || item.role === input.role) &&
      (!input.providerId || item.providerId === input.providerId) &&
      (!input.modelId || item.modelId === input.modelId) &&
      (!input.status || item.status === input.status) &&
      (input.minDurationMs === undefined || duration !== undefined && duration >= input.minDurationMs) &&
      (input.maxDurationMs === undefined || duration !== undefined && duration <= input.maxDurationMs) &&
      (input.minInputTokens === undefined || inputTokens !== null && inputTokens !== undefined && inputTokens >= input.minInputTokens) &&
      (input.maxInputTokens === undefined || inputTokens !== null && inputTokens !== undefined && inputTokens <= input.maxInputTokens) &&
      (input.minRetries === undefined || item.retryCount >= input.minRetries);
  });
  const sort = input.sort ?? "stage";
  all.sort((left, right) => {
    if (sort === "stage") {
      return left.boundaryIndex - right.boundaryIndex ||
        (left.logicalStageIndex ?? Number.MAX_SAFE_INTEGER) - (right.logicalStageIndex ?? Number.MAX_SAFE_INTEGER) ||
        (left.logicalInvocationOrdinal ?? left.ordinal) - (right.logicalInvocationOrdinal ?? right.ordinal) ||
        left.ledgerSequence - right.ledgerSequence || left.id.localeCompare(right.id);
    }
    const delta = querySortValue(right, sort) - querySortValue(left, sort);
    return delta || right.ordinal - left.ordinal || right.executionId.localeCompare(left.executionId) || right.id.localeCompare(left.id);
  });
  const limit = Math.min(100, Math.max(1, input.limit ?? 50));
  const offset = Math.min(cursorOffset(input.cursor), all.length);
  const items = all.slice(offset, offset + limit);
  return {
    apiVersion: WORLD_INSPECTOR_API_VERSION,
    items,
    ...(nextCursor(offset + items.length, all.length) ? { nextCursor: nextCursor(offset + items.length, all.length) } : {}),
    total: all.length,
  };
}

export function buildWorldInspectorModelInvocationDetail(
  executionId: string,
  invocationId: string,
  record: ExecutionRecord | undefined,
  runtimeEvents: readonly RuntimeEvent[],
): WorldInspectorModelInvocationDetail | undefined {
  if (!record) return undefined;
  const events = runtimeEvents.filter((event) => event.correlation?.executionId === executionId);
  const invocation = modelInvocationProjection(events).find((candidate) =>
    worldInspectorModelInvocationId(executionId, candidate.sourceInvocationId) === invocationId);
  if (!invocation) return undefined;
  const result = invocationResult(record, invocation,
    events.find((event) => event.correlation?.modelInvocationId === invocation.sourceInvocationId)?.sequence ?? Number.MAX_SAFE_INTEGER);
  const eventIds = new Set(invocation.eventIds);
  return {
    ...result,
    eventSummaries: events.filter((event) => eventIds.has(worldInspectorRuntimeEventId(event))).map(summarizeRuntimeEvent),
  };
}

export function buildWorldInspectorRuntimeEventDetail(
  eventId: string,
  runtimeEvents: readonly RuntimeEvent[],
): WorldInspectorRuntimeEventDetail | undefined {
  const event = runtimeEvents.find((candidate) => worldInspectorRuntimeEventId(candidate) === eventId);
  return event ? { apiVersion: WORLD_INSPECTOR_API_VERSION, event: structuredClone(event) } : undefined;
}

function derivedStageIndex(event: RuntimeEvent): number {
  if (typeof event.correlation?.logicalStageIndex === "number") return event.correlation.logicalStageIndex;
  const role = event.correlation?.modelRole ?? "";
  if (role.includes("action") || event.event.includes("action.compil")) return 1;
  if (role.includes("ground") || role.includes("resource")) return 2;
  if (role.includes("reaction") || role.includes("perception")) return 3;
  if (role.includes("truth") || role.includes("resolution")) return 5;
  if (role.includes("mind") || role.includes("observation")) return 7;
  if (event.event.startsWith("canonical.validation")) return 8;
  if (event.event === "step.committed") return 9;
  return 0;
}

export function buildWorldInspectorReplay(
  document: WorldInstanceDocument,
  executionId: string,
  record: ExecutionRecord | undefined,
  runtimeEvents: readonly RuntimeEvent[],
  checkpoint?: { id: string; artifactHash: string },
): WorldInspectorReplay | undefined {
  if (!record) return undefined;
  const events = runtimeEvents
    .filter((event) => event.correlation?.executionId === executionId)
    .sort((left, right) => left.sequence - right.sequence);
  const groups = new Map<number, RuntimeEvent[]>();
  for (const event of events) {
    const index = derivedStageIndex(event);
    const group = groups.get(index) ?? [];
    group.push(event);
    groups.set(index, group);
  }
  const boundaryIndex = Math.max(0, (record.commitRevision ?? document.state.revision) - (record.step ?? 0) + 1);
  const frames: WorldInspectorReplayFrame[] = EXECUTION_STAGES.map((stage, index) => {
    const group = groups.get(index) ?? [];
    const invocationIds = [...new Set(group.flatMap((event) => event.correlation?.modelInvocationId
      ? [worldInspectorModelInvocationId(executionId, event.correlation.modelInvocationId)] : []))];
    const artifactHashes = [...new Set(group.flatMap((event) => Object.values(event.hashes ?? {})
      .filter((hash): hash is string => typeof hash === "string")))];
    const failed = group.some((event) => event.level === "error" || event.event === "debug.stage.failed");
    const active = group.length > 0 && !group.some((event) => event.event === "debug.stage.completed" || event.event === "step.committed");
    return {
      index,
      boundaryIndex,
      stageIndex: index,
      stageKey: stage.key,
      stageLabel: stage.label,
      status: failed ? "failed" : active ? "active" : group.length > 0 ? "succeeded" : "pending",
      eventIds: group.map(worldInspectorRuntimeEventId),
      invocationIds,
      nodeIds: [`semantic:stage:${executionId}:${index}`],
      artifactHashes,
      derived: !group.some((event) => event.correlation?.logicalStageIndex === index),
    };
  });
  return {
    apiVersion: WORLD_INSPECTOR_API_VERSION,
    executionId,
    source: checkpoint ? "checkpoint" : "derived",
    ...(checkpoint ? { checkpointId: checkpoint.id } : {}),
    frames,
  };
}
