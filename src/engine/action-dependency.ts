import { actionGroundingSchema } from "./llm-schemas";
import type {
  ActionDependency,
  ActionDependencyDraft,
  FootprintRef,
} from "./execution";
import type {
  AgentActionProposal,
  AgentId,
  ModelExecutionAudit,
  SimulationState,
  WorldDeltaOperation,
} from "./model";
import {
  ModelOutputError,
  ModelSemanticRepairError,
  modelInvocationCorrelation,
  modelInvocationIdentity,
  setModelInvocationOutcome,
  setModelInvocationResultKind,
  type ModelExecutionScope,
  type StructuredModelProvider,
} from "./model-provider";
import { projectAgentPerspective } from "./agent-perspective";
import { MODEL_CONTEXT_CONTRACT_VERSION } from "./prompts";
import { quantityId } from "./runtime-id";
import type { TruthResolution } from "./truth-engine";

const GROUNDING_SYSTEM = `你是 Living World Engine 的行动 grounding 器。只判断给定行动可能读取、写入和影响哪些已列出的 canonical 资源与 Agent。

必须保守：只要自然语言可能触及目录外资源、远程传播、规则全局状态或无法确定边界，就令 globalFallback=true，并在 reads 与 writes 中加入 {"kind":"global","id":"world"}。
不得创建 ID，不得输出状态修改、结果或叙事。actor 的私有认知只用于理解本行动，不是 canonical Fact；任何私有 claim、evidence 或 goal ID 都不得作为 footprint id。
行动与 actor 身份由调用槽位固定，不要输出。只输出 schema 指定的 JSON。`;

const GROUNDING_PROMPT_VERSION = "action-grounding-v2";

export function actionDependencyKey(ref: FootprintRef): string {
  return `${ref.kind}:${ref.id}`;
}

function stableRefs(refs: readonly FootprintRef[]): FootprintRef[] {
  return [...new Map(refs.map((ref) => [actionDependencyKey(ref), structuredClone(ref)])).values()]
    .sort((left, right) => actionDependencyKey(left).localeCompare(actionDependencyKey(right)));
}

export function normalizeActionDependency(
  state: Readonly<SimulationState>,
  action: AgentActionProposal,
  value: ActionDependency,
): { dependency: ActionDependency; fallbackReasons: string[] } {
  if (value.actionId !== action.id || value.actorId !== action.actorId) {
    throw new Error("action dependency changed action or actor identity");
  }
  const catalogs: Record<Exclude<FootprintRef["kind"], "global">, Readonly<Record<string, unknown>>> = {
    entity: state.truth.entities,
    fact: state.truth.facts,
    placement: state.truth.entities,
    meter: state.truth.meters,
    quantity: state.truth.quantities,
    rating: state.truth.ratings,
    condition: state.truth.conditions,
  };
  const fallbackReasons: string[] = [];
  const validRefs = (refs: readonly FootprintRef[]): FootprintRef[] => refs.filter((ref) => {
    if (ref.kind === "global" || catalogs[ref.kind][ref.id]) return true;
    fallbackReasons.push(`unknown_${ref.kind}`);
    return false;
  });
  const reads = validRefs(value.reads);
  const writes = validRefs(value.writes);
  const audienceAgentIds = value.audienceAgentIds.filter((agentId) => {
    if (state.agents[agentId]) return true;
    fallbackReasons.push("unknown_audience_agent");
    return false;
  });
  const hasGlobal = [...value.reads, ...value.writes].some((ref) => ref.kind === "global");
  if (value.globalFallback !== hasGlobal) fallbackReasons.push("inconsistent_global_fallback");
  const globalFallback = value.globalFallback || hasGlobal || fallbackReasons.length > 0;
  const globalRef: FootprintRef = { kind: "global", id: "world" };
  return {
    dependency: {
      actionId: action.id,
      actorId: action.actorId,
      reads: stableRefs(globalFallback ? [...reads, globalRef] : reads),
      writes: stableRefs(globalFallback ? [...writes, globalRef] : writes),
      audienceAgentIds: [...new Set(audienceAgentIds)].sort(),
      globalFallback,
    },
    fallbackReasons: [...new Set(fallbackReasons)].sort(),
  };
}

function emitFallback(
  scope: ModelExecutionScope,
  action: AgentActionProposal,
  fallbackReasons: readonly string[],
): void {
  if (fallbackReasons.length === 0) return;
  scope.observer?.emit({
    event: "algorithm.grounding.global_fallback",
    level: "warn",
    correlation: { ...scope.correlation, modelSubject: action.actorId },
    attributes: { phase: "grounding", reasons: fallbackReasons.join(",") },
    counts: { normalizedGroundingFields: fallbackReasons.length, globalFallbacks: 1 },
  });
}

function enrichDependency(
  state: Readonly<SimulationState>,
  action: AgentActionProposal,
  dependency: ActionDependency,
): ActionDependency {
  const agent = state.agents[action.actorId];
  const placementId = state.truth.placements[agent.entityId];
  const mandatory: FootprintRef[] = [
    { kind: "entity", id: agent.entityId },
    ...(placementId ? [{ kind: "placement" as const, id: placementId }] : []),
  ];
  return {
    actionId: action.id,
    actorId: action.actorId,
    reads: stableRefs([...dependency.reads, ...mandatory]),
    writes: stableRefs([...dependency.writes, { kind: "entity", id: agent.entityId }]),
    audienceAgentIds: [...new Set([action.actorId, ...dependency.audienceAgentIds])].sort(),
    globalFallback: dependency.globalFallback,
  };
}

function acceptedDependency(
  state: Readonly<SimulationState>,
  action: AgentActionProposal,
  value: ActionDependencyDraft,
  scope: ModelExecutionScope,
): ActionDependency {
  const normalized = normalizeActionDependency(state, action, {
    actionId: action.id,
    actorId: action.actorId,
    ...structuredClone(value),
  });
  emitFallback(scope, action, normalized.fallbackReasons);
  return enrichDependency(state, action, normalized.dependency);
}

function groundingContext(
  state: Readonly<SimulationState>,
  action: AgentActionProposal,
  issues: readonly string[],
): unknown {
  const agent = state.agents[action.actorId];
  return {
    contractVersion: MODEL_CONTEXT_CONTRACT_VERSION,
    action,
    actorPerspective: projectAgentPerspective(state, agent),
    canonicalCatalog: {
      entities: Object.values(state.truth.entities).map(({ id, kind, name, description, lifecycle }) => ({
        id, kind, name, description, lifecycle,
      })),
      facts: Object.values(state.truth.facts).map(({ id, subjectId, predicate, value, description, access }) => ({
        id, subjectId, predicate, value, description, access,
      })),
      placements: state.truth.placements,
      meters: state.truth.meters,
      quantities: state.truth.quantities,
      ratings: state.truth.ratings,
      conditions: state.truth.conditions,
      agents: Object.values(state.agents).map(({ id, entityId }) => ({ id, entityId })),
    },
    validationIssues: issues,
  };
}

export async function generateActionDependency(
  provider: StructuredModelProvider,
  state: Readonly<SimulationState>,
  action: AgentActionProposal,
  scope: ModelExecutionScope,
  profileId: string,
  invocationOffset = 0,
): Promise<{ dependency: ActionDependency; audit: ModelExecutionAudit }> {
  const audits: ModelExecutionAudit[] = [];
  let issues: string[] = [];
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const identity = modelInvocationIdentity(scope, "action-grounding", action.actorId, invocationOffset + attempt + 1);
    try {
      const generated = await provider.generateStructured({
        profileId,
        workloadId: scope.workloadId,
        batchId: scope.batchId,
        abortSignal: scope.abortSignal,
        correlation: scope.correlation,
        observer: scope.observer,
        ...identity,
        role: "action-grounding",
        subjectId: action.actorId,
        promptVersion: GROUNDING_PROMPT_VERSION,
        schemaName: "action_grounding",
        system: GROUNDING_SYSTEM,
        context: groundingContext(state, action, issues),
        schema: actionGroundingSchema,
      });
      audits.push(generated.audit);
      setModelInvocationResultKind(generated.audit, "action-grounding_footprint");
      setModelInvocationOutcome(generated.audit, "accepted");
      const audit = audits.length === 1 ? audits[0] : {
        ...structuredClone(audits[0]),
        invocations: audits.flatMap((entry) => structuredClone(entry.invocations)),
      };
      return { dependency: acceptedDependency(state, action, generated.value, scope), audit };
    } catch (error) {
      if (error instanceof ModelOutputError && error.audit) audits.push(error.audit);
      const last = audits.at(-1);
      issues = [error instanceof Error ? error.message : String(error)];
      if (last?.invocations.length) setModelInvocationOutcome(last, "rejected", ["invalid_grounding"]);
      scope.observer?.emit({
        event: "model.semantic.rejected",
        level: "warn",
        correlation: modelInvocationCorrelation(scope, "action-grounding", action.actorId, identity),
        attributes: { resultKind: "action-grounding_footprint" },
        error: { name: error instanceof Error ? error.name : "Error", message: issues[0] },
      });
      if (attempt === 2) {
        throw new ModelSemanticRepairError(
          "action-grounding",
          `action grounding failed after repairs for ${action.actorId}: ${issues[0]}`,
          { cause: error },
        );
      }
    }
  }
  throw new Error("unreachable grounding loop");
}

export function forceGlobalActionDependency(dependency: Readonly<ActionDependency>): ActionDependency {
  const globalRef: FootprintRef = { kind: "global", id: "world" };
  return {
    ...structuredClone(dependency),
    reads: stableRefs([...dependency.reads, globalRef]),
    writes: stableRefs([...dependency.writes, globalRef]),
    globalFallback: true,
  };
}

export function replaceActionDependencies(
  current: readonly ActionDependency[],
  replacements: readonly { actorId: AgentId; dependency: ActionDependency }[],
): ActionDependency[] {
  const replacedActors = new Set(replacements.map((replacement) => replacement.actorId));
  return [
    ...current.filter((dependency) => !replacedActors.has(dependency.actorId)),
    ...replacements.map((replacement) => structuredClone(replacement.dependency)),
  ].sort((left, right) => left.actorId.localeCompare(right.actorId));
}

export function actionDependenciesConflict(left: ActionDependency, right: ActionDependency): boolean {
  if (left.globalFallback || right.globalFallback) return true;
  const leftWrites = new Set(left.writes.map(actionDependencyKey));
  const rightWrites = new Set(right.writes.map(actionDependencyKey));
  const leftReads = new Set(left.reads.map(actionDependencyKey));
  const rightReads = new Set(right.reads.map(actionDependencyKey));
  return [...leftWrites].some((key) => rightWrites.has(key) || rightReads.has(key)) ||
    [...rightWrites].some((key) => leftReads.has(key)) ||
    left.audienceAgentIds.includes(right.actorId) || right.audienceAgentIds.includes(left.actorId);
}

export function actionDependencyComponents(dependencies: readonly ActionDependency[]): AgentId[][] {
  const parent = dependencies.map((_, index) => index);
  const root = (index: number): number => {
    while (parent[index] !== index) {
      parent[index] = parent[parent[index]];
      index = parent[index];
    }
    return index;
  };
  const union = (left: number, right: number): void => {
    const leftRoot = root(left);
    const rightRoot = root(right);
    if (leftRoot !== rightRoot) parent[Math.max(leftRoot, rightRoot)] = Math.min(leftRoot, rightRoot);
  };
  for (let left = 0; left < dependencies.length; left += 1) {
    for (let right = left + 1; right < dependencies.length; right += 1) {
      if (actionDependenciesConflict(dependencies[left], dependencies[right])) union(left, right);
    }
  }
  const groups = new Map<number, AgentId[]>();
  dependencies.forEach((dependency, index) => {
    const group = groups.get(root(index)) ?? [];
    group.push(dependency.actorId);
    groups.set(root(index), group);
  });
  return [...groups.values()].map((group) => group.sort()).sort((left, right) => left[0].localeCompare(right[0]));
}

export function actionDependencyEdgeCount(dependencies: readonly ActionDependency[]): number {
  let edges = 0;
  for (let left = 0; left < dependencies.length; left += 1) {
    for (let right = left + 1; right < dependencies.length; right += 1) {
      if (actionDependenciesConflict(dependencies[left], dependencies[right])) edges += 1;
    }
  }
  return edges;
}

function operationResources(
  state: Readonly<SimulationState>,
  operation: WorldDeltaOperation,
): { reads: Set<string>; writes: Set<string> } {
  const reads = new Set<string>();
  const writes = new Set<string>();
  const addEntity = (id: string | null | undefined, target = writes) => {
    if (id) target.add(`entity:${id}`);
  };
  switch (operation.kind) {
    case "create_entity": addEntity(operation.entity.id); addEntity(operation.placementId, reads); break;
    case "retire_entity": addEntity(operation.entityId); break;
    case "place_entity": addEntity(operation.entityId); addEntity(operation.placementId, reads); break;
    case "set_fact": writes.add(`fact:${operation.fact.id}`); addEntity(operation.fact.subjectId, reads); break;
    case "remove_fact": writes.add(`fact:${operation.factId}`); break;
    case "set_meter": writes.add(`meter:${operation.meter.id}`); break;
    case "adjust_meter": writes.add(`meter:${operation.meterId}`); break;
    case "transfer_quantity":
      writes.add(`quantity:${quantityId(state.worldHash, operation.definitionId, operation.fromHolderId)}`);
      writes.add(`quantity:${quantityId(state.worldHash, operation.definitionId, operation.toHolderId)}`);
      break;
    case "produce_quantity":
    case "consume_quantity":
      writes.add(`quantity:${quantityId(state.worldHash, operation.definitionId, operation.holderId)}`);
      break;
    case "set_quantity": writes.add(`quantity:${operation.quantity.id}`); break;
    case "set_rating": writes.add(`rating:${operation.rating.id}`); break;
    case "set_condition": writes.add(`condition:${operation.condition.id}`); addEntity(operation.condition.subjectId, reads); break;
    case "remove_condition": writes.add(`condition:${operation.conditionId}`); break;
    case "create_agent": addEntity(operation.agent.entityId); break;
    case "remove_agent": writes.add(`agent:${operation.agentId}`); break;
    case "advance_time": break;
  }
  return { reads, writes };
}

function actualComponentFootprint(
  state: Readonly<SimulationState>,
  resolution: TruthResolution,
): { reads: Set<string>; writes: Set<string> } {
  const reads = new Set<string>();
  const writes = new Set<string>();
  for (const operation of resolution.proposal.operations) {
    const actual = operationResources(state, operation);
    actual.reads.forEach((key) => reads.add(key));
    actual.writes.forEach((key) => writes.add(key));
  }
  return { reads, writes };
}

export function resolvedComponentsConflict(
  state: Readonly<SimulationState>,
  left: TruthResolution,
  right: TruthResolution,
): boolean {
  const leftFootprint = actualComponentFootprint(state, left);
  const rightFootprint = actualComponentFootprint(state, right);
  return [...leftFootprint.writes].some((key) =>
    rightFootprint.writes.has(key) || rightFootprint.reads.has(key)) ||
    [...rightFootprint.writes].some((key) => leftFootprint.reads.has(key));
}

export function resolutionExceedsDeclaredDependencies(
  state: Readonly<SimulationState>,
  resolution: TruthResolution,
  dependencies: readonly ActionDependency[],
): boolean {
  if (dependencies.some((dependency) => dependency.globalFallback)) return false;
  const declared = new Set(dependencies.flatMap((dependency) =>
    [...dependency.reads, ...dependency.writes].map(actionDependencyKey)));
  const actual = actualComponentFootprint(state, resolution);
  return [...actual.reads, ...actual.writes].some((key) => !declared.has(key));
}
