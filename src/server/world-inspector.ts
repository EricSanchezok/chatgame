import type {
  CausalRef,
  CommittedStep,
  ModelExecutionAudit,
  SimulationState,
  WorldDeltaOperation,
} from "../engine/contracts/model";
import { contentHash } from "../engine/models/model-audit";
import type { RuntimeError, RuntimeEvent } from "../engine/runtime/observability";
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

function slotRefs(context: unknown): WorldInspectorModelInvocationSummary["slotRefs"] {
  if (!context || typeof context !== "object" || Array.isArray(context)) return [];
  const slots = (context as { slots?: unknown }).slots;
  if (!Array.isArray(slots)) return [];
  return slots.map((entry, index) => {
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

function modelInvocationProjection(events: readonly RuntimeEvent[]): WorldInspectorModelInvocationSummary[] {
  const groups = new Map<string, RuntimeEvent[]>();
  for (const event of events) {
    if (!event.event.startsWith("model.")) continue;
    const id = event.correlation?.modelInvocationId ??
      `unresolved:${event.correlation?.modelRole ?? "model"}:${event.correlation?.modelSubject ?? "unknown"}:${event.sequence}`;
    const group = groups.get(id) ?? [];
    group.push(event);
    groups.set(id, group);
  }
  return [...groups.entries()].map(([id, group]) => {
    const ordered = [...group].sort((left, right) => left.sequence - right.sequence);
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
        ...(failed?.attributes?.statusCode !== undefined ? { statusCode: failed.attributes.statusCode as number } : {}),
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
    const invocationMs = started && terminal
      ? Math.max(0, Date.parse(terminal.timestamp) - Date.parse(started.timestamp)) : undefined;
    const errorEvent = [...ordered].reverse().find((event) => event.error);
    const issueCodes = new Set<string>();
    for (const event of ordered) {
      if (event.error?.name) issueCodes.add(event.error.name);
      const payload = event.payload && typeof event.payload === "object" ? event.payload as Record<string, unknown> : undefined;
      const issues = payload?.issues;
      if (Array.isArray(issues)) {
        issues.forEach((issue) => {
          if (issue && typeof issue === "object" && typeof (issue as { code?: unknown }).code === "string") {
            issueCodes.add((issue as { code: string }).code);
          }
        });
      }
    }
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
      ...(payloadEventId(outputEvent) ? { output: worldInspectorRuntimeEventId(outputEvent!) } : {}),
    };
    return {
      id,
      ordinal: ordered.find((event) => event.correlation?.modelInvocation)?.correlation?.modelInvocation ?? 0,
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
      slotRefs: slotRefs(context),
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
      validationIssueCodes: [...issueCodes],
      ...(errorEvent?.error?.message ? { errorMessage: diagnosticErrorMessage(errorEvent.error) } : {}),
      hasPayload: ordered.some((event) => event.payload !== undefined),
    } satisfies WorldInspectorModelInvocationSummary;
  }).sort((left, right) => left.ordinal - right.ordinal || left.id.localeCompare(right.id));
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
  const groups = new Map<string, RuntimeEvent[]>();
  for (const event of events) {
    const role = event.correlation?.modelRole;
    const phase = role ? `model:${role}` : typeof event.attributes?.phase === "string"
      ? `phase:${event.attributes.phase}` : undefined;
    if (!phase) continue;
    const group = groups.get(phase) ?? [];
    group.push(event);
    groups.set(phase, group);
  }
  return [...groups.entries()].map(([id, group]) => {
    const role = group.find((event) => event.correlation?.modelRole)?.correlation?.modelRole;
    const failed = group.some((event) => event.level === "error" || event.event.endsWith(".failed"));
    const error = [...group].reverse().find((event) => event.error)?.error;
    return {
      id,
      label: role ? stageLabels[role] ?? role : id.slice("phase:".length),
      status: failed ? "failed" : "succeeded",
      startedAt: group[0].timestamp,
      updatedAt: group.at(-1)!.timestamp,
      eventCount: group.length,
      modelInvocationCount: new Set(group.flatMap((event) => event.correlation?.modelInvocationId
        ? [event.correlation.modelInvocationId] : [])).size,
      rejectionCount: group.filter((event) => event.event === "model.semantic.rejected").length,
      repairCount: group.filter((event) => (event.correlation?.modelInvocation ?? 1) > 1).length,
      ...(role ? { modelRole: role } : {}),
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
  const actorIds = new Set(attemptedActions(events).map((action) => action.actorId));
  for (const invocation of invocations) {
    for (const slot of invocation.slotRefs) if (slot.agentId && knownAgents.has(slot.agentId)) actorIds.add(slot.agentId);
    if (invocation.subjectId && knownAgents.has(invocation.subjectId)) actorIds.add(invocation.subjectId);
  }
  const status = record.status === "running" ? "active" : record.status === "succeeded"
    ? "committed" : record.status === "cancelled" ? "cancelled" : "failed";
  const failedEvent = [...events].reverse().find((event) => event.level === "error" || event.event.endsWith(".failed"));
  const failureStage = failedEvent?.correlation?.modelRole ??
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
    rejectionCount: events.filter((event) => event.event === "model.semantic.rejected").length,
    repairCount: events.filter((event) => (event.correlation?.modelInvocation ?? 1) > 1).length,
    ...(failureStage ? { failureStage, failureStageLabel: stageLabels[failureStage] ?? failureStage } : {}),
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
  for (const attempt of attempts) {
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
    },
    actors,
    steps: projected.map((item) => item.summary),
    nodes,
    edges,
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
    modelInvocations: modelInvocationProjection(executionEvents),
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
    modelInvocations: modelInvocationProjection(events),
    trace: traceAvailability(events),
  };
}

function invocationResult(
  record: ExecutionRecord,
  invocation: WorldInspectorModelInvocationSummary,
): WorldInspectorModelInvocationResult {
  return {
    ...invocation,
    executionId: record.id,
    attemptId: record.id,
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
    return modelInvocationProjection(events).map((invocation) => invocationResult(record, invocation));
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
  const sort = input.sort ?? "timestamp";
  all.sort((left, right) => {
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
  const invocation = modelInvocationProjection(events).find((candidate) => candidate.id === invocationId);
  if (!invocation) return undefined;
  const result = invocationResult(record, invocation);
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
