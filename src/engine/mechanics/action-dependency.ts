import { actionGroundingSchema } from "../contracts/llm-schemas";
import type {
  InteractionDependency,
  InteractionDependencyDraft,
  FootprintRef,
} from "../runtime/execution";
import type {
  AgentActionProposal,
  AgentId,
  CausalAssertion,
  ModelExecutionAudit,
  SimulationState,
  WorldDeltaOperation,
} from "../contracts/model";
import type { ConditionState } from "./resolution";
import type { ActivityState, WorldTimer } from "./temporal";
import {
  ModelOutputError,
  ModelSemanticRepairError,
  modelInvocationCorrelation,
  modelInvocationIdentity,
  setModelInvocationOutcome,
  setModelInvocationResultKind,
  type ModelExecutionScope,
  type StructuredModelProvider,
} from "../models/model-provider";
import { projectAgentPerspective } from "../cognition/agent-perspective";
import { MODEL_CONTEXT_CONTRACT_VERSION } from "../contracts/prompts";
import { quantityId } from "../runtime/runtime-id";
import { contentHash } from "../models/model-audit";
import type { TruthResolution } from "./truth-engine";
import { materializeSharedActivityResourceClaims } from "./shared-activity-resources";

export const INTERACTION_DEPENDENCY_INSTRUCTIONS = `只判断给定行动可能读取、写入和影响哪些已列出的 canonical 资源与 Agent，并选择行动实际占用的共享物理资源池。

必须保守：只要自然语言可能触及目录外资源、远程传播、规则全局状态或无法确定边界，就令 globalFallback=true，并在 reads 与 writes 中加入 {"kind":"global","id":"world"}。
不得创建新 ID；reads、writes、audienceAgentIds、causes 和 sharedResourceClaims 中的引用 ID 必须从当前输入列出的 canonical catalog 或 action 中原样复制。不得输出状态修改、结果或叙事。共享资源 claim 只能选择 canonicalCatalog.sharedActivityResourcePools[].id；如果该目录为空或没有明确匹配，sharedResourceClaims 必须输出 []。default 只是 basis.kind，绝不是 poolId；只有定义允许且行动原文明确写出数量和单位时才能使用 explicit_quantity。actor 的私有认知只用于理解本行动，不是 canonical Fact；任何私有 claim、evidence 或 goal ID 都不得作为 footprint id。
`;

const GROUNDING_SYSTEM = `你是 Living World Engine 的行动 grounding 器。${INTERACTION_DEPENDENCY_INSTRUCTIONS}
行动与 actor 身份由调用槽位固定，不要输出。只输出 schema 指定的 JSON。`;

const GROUNDING_PROMPT_VERSION = "action-grounding-v3";

export function footprintRefKey(ref: FootprintRef): string {
  return `${ref.kind}:${ref.id}`;
}

function stableRefs(refs: readonly FootprintRef[]): FootprintRef[] {
  return [...new Map(refs.map((ref) => [footprintRefKey(ref), structuredClone(ref)])).values()]
    .sort((left, right) => footprintRefKey(left).localeCompare(footprintRefKey(right)));
}

export function causalAssertionFootprintRefs(
  state: Readonly<SimulationState>,
  assertions: readonly CausalAssertion[],
): FootprintRef[] {
  return assertions.flatMap((assertion): FootprintRef[] => {
    switch (assertion.kind) {
      case "check_result":
      case "random_result":
        throw new Error(`${assertion.kind} cannot be a durable Activity continuation assertion`);
      case "fact_matches":
      case "fact_absent":
        return [{ kind: "fact", id: assertion.factId }];
      case "entity_absent":
      case "entity_lifecycle":
        return [{ kind: "entity", id: assertion.entityId }];
      case "placement_equals":
        return [
          { kind: "entity", id: assertion.entityId },
          ...(assertion.placementId ? [{ kind: "placement" as const, id: assertion.placementId }] : []),
        ];
      case "shared_placement":
        return [
          { kind: "entity", id: assertion.leftEntityId },
          { kind: "entity", id: assertion.rightEntityId },
        ];
      case "meter_compare":
        return [{ kind: "meter", id: assertion.meterId }];
      case "quantity_compare":
        return [{
          kind: "quantity",
          id: quantityId(state.worldHash, assertion.definitionId, assertion.holderId),
        }];
      case "rating_compare":
        return [{ kind: "rating", id: assertion.ratingId }];
      case "shared_resource_capacity_compare":
        return [{ kind: "shared_resource_pool", id: assertion.poolId }];
      case "elapsed_seconds_compare":
        return [];
    }
  });
}

export function interactionDependencyForTimer(
  state: Readonly<SimulationState>,
  timer: Readonly<WorldTimer>,
): InteractionDependency {
  return {
    kind: "timer",
    id: timer.id,
    actorId: null,
    reads: stableRefs(causalAssertionFootprintRefs(state, timer.assertions)),
    writes: [],
    audienceAgentIds: [...new Set(timer.wakeAgentIds)].sort(),
    sharedResourceClaims: [],
    globalFallback: false,
  };
}

export function interactionDependencyForCondition(
  state: Readonly<SimulationState>,
  condition: Readonly<ConditionState>,
): InteractionDependency {
  const audienceAgentIds = condition.access.kind === "public"
    ? Object.keys(state.agents).sort()
    : condition.access.kind === "agents"
      ? [...new Set(condition.access.agentIds)].sort()
      : [];
  return {
    kind: "condition",
    id: condition.id,
    actorId: null,
    reads: [{ kind: "condition", id: condition.id }],
    writes: [{ kind: "condition", id: condition.id }],
    audienceAgentIds,
    sharedResourceClaims: [],
    globalFallback: false,
  };
}

export function unresolvedActivityInteractionFootprint(
  activityId: string,
  actorId: AgentId,
): InteractionDependency {
  const global: FootprintRef = { kind: "global", id: "world" };
  return {
    kind: "activity",
    id: activityId,
    actorId,
    reads: [global],
    writes: [global],
    audienceAgentIds: [actorId],
    sharedResourceClaims: [],
    globalFallback: true,
  };
}

export function interactionDependencyForActivity(
  state: Readonly<SimulationState>,
  activity: Readonly<ActivityState>,
  source: Readonly<InteractionDependency>,
): InteractionDependency {
  if (source.kind !== "action" || source.id !== activity.sourceActionId || source.actorId !== activity.actorId) {
    throw new Error(`activity ${activity.id} footprint source does not match its action`);
  }
  return {
    kind: "activity",
    id: activity.id,
    actorId: activity.actorId,
    reads: stableRefs([
      ...source.reads,
      ...causalAssertionFootprintRefs(
        state,
        activity.status === "queued" || activity.status === "ready"
          ? activity.planDraft.continuationAssertions
          : activity.plan.continuationAssertions,
      ),
    ]),
    writes: stableRefs(source.writes),
    audienceAgentIds: [...new Set([
      ...source.audienceAgentIds,
      ...activity.participantAgentIds,
    ])].sort(),
    sharedResourceClaims: structuredClone(source.sharedResourceClaims),
    globalFallback: source.globalFallback,
  };
}

export function affectedActivityIdsExhaustive(
  activities: Readonly<Record<string, ActivityState>>,
  incoming: readonly InteractionDependency[],
): string[] {
  const live = Object.values(activities)
    .filter((activity) => activity.status === "active" || activity.status === "paused" ||
      activity.status === "queued" || activity.status === "ready")
    .sort((left, right) => left.id.localeCompare(right.id));
  const affected = new Set<string>();
  const pending = [...incoming];
  for (let cursor = 0; cursor < pending.length; cursor += 1) {
    const dependency = pending[cursor]!;
    for (const activity of live) {
      if (affected.has(activity.id) ||
        !interactionDependenciesConflict(activity.interactionFootprint, dependency)) continue;
      affected.add(activity.id);
      pending.push(activity.interactionFootprint);
    }
  }
  return [...affected].sort();
}

export class ActivityFootprintIndex {
  private readonly activeIds: string[];
  private readonly globalIds = new Set<string>();
  private readonly readers = new Map<string, Set<string>>();
  private readonly writers = new Map<string, Set<string>>();
  private readonly actors = new Map<AgentId, Set<string>>();
  private readonly audiences = new Map<AgentId, Set<string>>();
  private readonly footprints = new Map<string, InteractionDependency>();

  constructor(activities: Readonly<Record<string, ActivityState>>) {
    const active = Object.values(activities)
      .filter((activity) => activity.status === "active" || activity.status === "paused" ||
        activity.status === "queued" || activity.status === "ready")
      .sort((left, right) => left.id.localeCompare(right.id));
    this.activeIds = active.map((activity) => activity.id);
    const add = (index: Map<string, Set<string>>, key: string, activityId: string): void => {
      const values = index.get(key) ?? new Set<string>();
      values.add(activityId);
      index.set(key, values);
    };
    for (const activity of active) {
      const footprint = activity.interactionFootprint;
      if (footprint.kind !== "activity" || footprint.id !== activity.id || footprint.actorId !== activity.actorId) {
        throw new Error(`activity ${activity.id} has an invalid interaction footprint identity`);
      }
      this.footprints.set(activity.id, footprint);
      if (footprint.globalFallback) this.globalIds.add(activity.id);
      footprint.reads.forEach((ref) => add(this.readers, footprintRefKey(ref), activity.id));
      footprint.writes.forEach((ref) => add(this.writers, footprintRefKey(ref), activity.id));
      footprint.sharedResourceClaims.forEach((claim) =>
        add(this.writers, `shared_resource_pool:${claim.poolId}`, activity.id));
      add(this.actors, activity.actorId, activity.id);
      footprint.audienceAgentIds.forEach((agentId) => add(this.audiences, agentId, activity.id));
    }
  }

  affectedBy(incoming: readonly InteractionDependency[]): string[] {
    const affected = new Set<string>();
    const pending = [...incoming];
    for (let cursor = 0; cursor < pending.length; cursor += 1) {
      const dependency = pending[cursor]!;
      const matched = new Set<string>();
      const include = (values: ReadonlySet<string> | undefined): void => values?.forEach((id) => matched.add(id));
      if (dependency.globalFallback) {
        this.activeIds.forEach((id) => matched.add(id));
      } else {
        include(this.globalIds);
      }
      const writeKeys = [
        ...dependency.writes.map(footprintRefKey),
        ...dependency.sharedResourceClaims.map((claim) => `shared_resource_pool:${claim.poolId}`),
      ];
      writeKeys.forEach((key) => {
        include(this.readers.get(key));
        include(this.writers.get(key));
      });
      dependency.reads.forEach((ref) => include(this.writers.get(footprintRefKey(ref))));
      dependency.audienceAgentIds.forEach((agentId) => include(this.actors.get(agentId)));
      if (dependency.actorId !== null) include(this.audiences.get(dependency.actorId));
      for (const activityId of [...matched].sort()) {
        if (affected.has(activityId)) continue;
        const footprint = this.footprints.get(activityId);
        if (!footprint) throw new Error(`indexed Activity ${activityId} has no interaction footprint`);
        affected.add(activityId);
        pending.push(footprint);
      }
    }
    return [...affected].sort();
  }
}

export function normalizeInteractionDependency(
  state: Readonly<SimulationState>,
  action: AgentActionProposal,
  value: InteractionDependency,
): { dependency: InteractionDependency; fallbackReasons: string[] } {
  if (value.kind !== "action" || value.id !== action.id || value.actorId !== action.actorId) {
    throw new Error("interaction dependency changed action or actor identity");
  }
  const catalogs: Record<Exclude<FootprintRef["kind"], "global">, Readonly<Record<string, unknown>>> = {
    entity: state.truth.entities,
    fact: state.truth.facts,
    placement: state.truth.entities,
    meter: state.truth.meters,
    quantity: state.truth.quantities,
    rating: state.truth.ratings,
    condition: state.truth.conditions,
    shared_resource_pool: state.truth.sharedActivityResourcePools,
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
      kind: "action",
      id: action.id,
      actorId: action.actorId,
      reads: stableRefs(globalFallback ? [...reads, globalRef] : reads),
      writes: stableRefs(globalFallback ? [...writes, globalRef] : writes),
      audienceAgentIds: [...new Set(audienceAgentIds)].sort(),
      sharedResourceClaims: structuredClone(value.sharedResourceClaims),
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
  dependency: InteractionDependency,
): InteractionDependency {
  const agent = state.agents[action.actorId];
  const placementId = state.truth.placements[agent.entityId];
  const mandatory: FootprintRef[] = [
    { kind: "entity", id: agent.entityId },
    ...(placementId ? [{ kind: "placement" as const, id: placementId }] : []),
  ];
  return {
    kind: "action",
    id: action.id,
    actorId: action.actorId,
    reads: stableRefs([...dependency.reads, ...mandatory]),
    writes: stableRefs([...dependency.writes, { kind: "entity", id: agent.entityId }]),
    audienceAgentIds: [...new Set([action.actorId, ...dependency.audienceAgentIds])].sort(),
    sharedResourceClaims: structuredClone(dependency.sharedResourceClaims),
    globalFallback: dependency.globalFallback,
  };
}

export function materializeInteractionDependency(
  state: Readonly<SimulationState>,
  action: AgentActionProposal,
  value: InteractionDependencyDraft,
  scope: ModelExecutionScope,
): InteractionDependency {
  const sharedResourceClaims = materializeSharedActivityResourceClaims({
    drafts: value.sharedResourceClaims,
    rawText: action.rawText,
    pools: state.truth.sharedActivityResourcePools,
    definitions: state.truth.mechanics.sharedActivityResources,
  });
  const normalized = normalizeInteractionDependency(state, action, {
    kind: "action",
    id: action.id,
    actorId: action.actorId,
    ...structuredClone(value),
    sharedResourceClaims,
  });
  emitFallback(scope, action, normalized.fallbackReasons);
  return enrichDependency(state, action, normalized.dependency);
}

export function actionGroundingSharedContext(state: Readonly<SimulationState>) {
  return {
    contractVersion: MODEL_CONTEXT_CONTRACT_VERSION,
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
      sharedActivityResourcePools: Object.values(state.truth.sharedActivityResourcePools).map((pool) => ({
        ...structuredClone(pool),
        definition: structuredClone(state.truth.mechanics.sharedActivityResources[pool.definitionId]),
        entityLifecycle: state.truth.entities[pool.entityId]?.lifecycle ?? "retired",
      })),
      agents: Object.values(state.agents).map(({ id, entityId }) => ({ id, entityId })),
    },
  };
}

export function actionGroundingSlotContext(
  state: Readonly<SimulationState>,
  action: AgentActionProposal,
  issues: readonly string[],
) {
  const agent = state.agents[action.actorId];
  return {
    action,
    actorPerspective: projectAgentPerspective(state, agent),
    validationIssues: issues,
  };
}

export function actionGroundingContext(
  state: Readonly<SimulationState>,
  action: AgentActionProposal,
  issues: readonly string[],
) {
  const shared = actionGroundingSharedContext(state);
  const slot = actionGroundingSlotContext(state, action, issues);
  return {
    contractVersion: shared.contractVersion,
    action: slot.action,
    actorPerspective: slot.actorPerspective,
    canonicalCatalog: shared.canonicalCatalog,
    validationIssues: slot.validationIssues,
  };
}

export async function generateInteractionDependency(
  provider: StructuredModelProvider,
  state: Readonly<SimulationState>,
  action: AgentActionProposal,
  scope: ModelExecutionScope,
  profileId: string,
  invocationOffset = 0,
): Promise<{ dependency: InteractionDependency; audit: ModelExecutionAudit }> {
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
        context: actionGroundingContext(state, action, issues),
        schema: actionGroundingSchema,
      });
      audits.push(generated.audit);
      setModelInvocationResultKind(generated.audit, "action-grounding_footprint");
      setModelInvocationOutcome(generated.audit, "accepted");
      const audit = audits.length === 1 ? audits[0] : {
        ...structuredClone(audits[0]),
        invocations: audits.flatMap((entry) => structuredClone(entry.invocations)),
      };
      return { dependency: materializeInteractionDependency(state, action, generated.value, scope), audit };
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

export function forceGlobalInteractionDependency(dependency: Readonly<InteractionDependency>): InteractionDependency {
  const globalRef: FootprintRef = { kind: "global", id: "world" };
  return {
    ...structuredClone(dependency),
    reads: stableRefs([...dependency.reads, globalRef]),
    writes: stableRefs([...dependency.writes, globalRef]),
    globalFallback: true,
  };
}

export function replaceInteractionDependencies(
  current: readonly InteractionDependency[],
  replacements: readonly { actorId: AgentId; dependency: InteractionDependency }[],
): InteractionDependency[] {
  const replacedActors = new Set(replacements.map((replacement) => replacement.actorId));
  return [
    ...current.filter((dependency) => dependency.kind !== "action" ||
      dependency.actorId === null || !replacedActors.has(dependency.actorId)),
    ...replacements.map((replacement) => structuredClone(replacement.dependency)),
  ].sort((left, right) => left.id.localeCompare(right.id));
}

export type InteractionGraphMode = "canonical" | "notification";

export type InteractionDependencyConflictKind =
  | "global"
  | "read-write"
  | "write-write"
  | "shared-resource"
  | "audience";

export interface InteractionDependencyGraphEdge {
  from: string;
  to: string;
  kinds: InteractionDependencyConflictKind[];
}

export interface InteractionDependencyGraphSnapshot {
  mode: InteractionGraphMode;
  nodeIds: string[];
  edges: InteractionDependencyGraphEdge[];
  components: string[][];
  globalFallbackNodeIds: string[];
  edgeCount: number;
  maxComponentSize: number;
  contentHash: string;
}

function dependencyWriteKeys(dependency: InteractionDependency): string[] {
  return [
    ...dependency.writes.map(footprintRefKey),
    ...dependency.sharedResourceClaims.map((claim) => `shared_resource_pool:${claim.poolId}`),
  ];
}

function dependencyReadKeys(dependency: InteractionDependency): string[] {
  return dependency.reads.map(footprintRefKey);
}

/**
 * Canonical conflict excludes audience-only links. Audience is an observation
 * fan-out and becomes a Truth dependency only when onset reaction grounding
 * proves that the actor can perceive and change the ongoing action.
 */
export function interactionDependenciesConflict(
  left: InteractionDependency,
  right: InteractionDependency,
  mode: InteractionGraphMode = "notification",
): boolean {
  if (left.globalFallback || right.globalFallback) return true;
  const leftWrites = new Set(dependencyWriteKeys(left));
  const rightWrites = new Set(dependencyWriteKeys(right));
  const leftReads = new Set(dependencyReadKeys(left));
  const rightReads = new Set(dependencyReadKeys(right));
  if ([...leftWrites].some((key) => rightWrites.has(key) || rightReads.has(key)) ||
    [...rightWrites].some((key) => leftReads.has(key))) return true;
  if (mode === "notification" &&
    ((right.actorId !== null && left.audienceAgentIds.includes(right.actorId)) ||
      (left.actorId !== null && right.audienceAgentIds.includes(left.actorId)))) return true;
  return false;
}

function addIndexed(index: Map<string, number[]>, key: string, value: number): void {
  const entries = index.get(key) ?? [];
  entries.push(value);
  index.set(key, entries);
}

/**
 * Builds a deterministic sparse dependency graph using inverted indexes. The
 * graph is ephemeral evidence: canonical state remains authoritative and the
 * committer independently reconstructs the partition.
 */
export function buildInteractionDependencyGraph(
  dependencies: readonly InteractionDependency[],
  mode: InteractionGraphMode = "canonical",
): InteractionDependencyGraphSnapshot {
  const nodeIds = dependencies.map((dependency) => dependency.id);
  const seenIds = new Set<string>();
  for (const id of nodeIds) {
    if (seenIds.has(id)) throw new Error(`interaction dependency graph contains duplicate node ${id}`);
    seenIds.add(id);
  }
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
  const edgeKinds = new Map<string, Set<InteractionDependencyConflictKind>>();
  const addEdge = (left: number, right: number, kind: InteractionDependencyConflictKind): void => {
    if (left === right) return;
    const fromIndex = Math.min(left, right);
    const toIndex = Math.max(left, right);
    const key = `${fromIndex}:${toIndex}`;
    const kinds = edgeKinds.get(key) ?? new Set<InteractionDependencyConflictKind>();
    kinds.add(kind);
    edgeKinds.set(key, kinds);
    union(fromIndex, toIndex);
  };

  const readers = new Map<string, number[]>();
  const writers = new Map<string, number[]>();
  const actors = new Map<string, number[]>();
  const globalNodes: number[] = [];
  dependencies.forEach((dependency, index) => {
    dependencyReadKeys(dependency).forEach((key) => addIndexed(readers, key, index));
    dependencyWriteKeys(dependency).forEach((key) => addIndexed(writers, key, index));
    if (dependency.actorId !== null) addIndexed(actors, dependency.actorId, index);
    if (dependency.globalFallback) globalNodes.push(index);
  });

  const connectAll = (indices: readonly number[], kind: InteractionDependencyConflictKind): void => {
    for (let left = 0; left < indices.length; left += 1) {
      for (let right = left + 1; right < indices.length; right += 1) {
        addEdge(indices[left]!, indices[right]!, kind);
      }
    }
  };
  const connectIndexes = (
    index: Map<string, number[]>,
    kind: InteractionDependencyConflictKind,
  ): void => {
    for (const indices of index.values()) connectAll(indices, kind);
  };
  connectIndexes(writers, "write-write");
  for (const [key, readIndexes] of readers.entries()) {
    const writeIndexes = writers.get(key) ?? [];
    for (const reader of readIndexes) {
      for (const writer of writeIndexes) addEdge(reader, writer, "read-write");
    }
  }
  dependencies.forEach((dependency, index) => {
    if (dependency.sharedResourceClaims.length === 0) return;
    const keys = new Set(dependencyWriteKeys(dependency)
      .filter((key) => key.startsWith("shared_resource_pool:")));
    for (const key of keys) {
      for (const other of writers.get(key) ?? []) addEdge(index, other, "shared-resource");
    }
  });
  if (globalNodes.length > 0) {
    for (const globalNode of globalNodes) {
      for (let index = 0; index < dependencies.length; index += 1) {
        addEdge(globalNode, index, "global");
      }
    }
  }
  if (mode === "notification") {
    dependencies.forEach((dependency, index) => {
      for (const audienceAgentId of dependency.audienceAgentIds) {
        for (const actorIndex of actors.get(audienceAgentId) ?? []) {
          addEdge(index, actorIndex, "audience");
        }
      }
    });
  }

  const groups = new Map<number, string[]>();
  dependencies.forEach((dependency, index) => {
    const group = groups.get(root(index)) ?? [];
    group.push(dependency.id);
    groups.set(root(index), group);
  });
  const components = [...groups.values()]
    .map((group) => group.sort())
    .sort((left, right) => left[0]!.localeCompare(right[0]!));
  const edges = [...edgeKinds.entries()]
    .map(([key, kinds]) => {
      const [fromIndex, toIndex] = key.split(":").map(Number);
      const ids = [nodeIds[fromIndex]!, nodeIds[toIndex]!].sort((left, right) => left.localeCompare(right));
      return {
        from: ids[0]!,
        to: ids[1]!,
        kinds: [...kinds].sort(),
      };
    })
    .sort((left, right) => `${left.from}:${left.to}`.localeCompare(`${right.from}:${right.to}`));
  const snapshotBody = {
    mode,
    nodeIds: [...nodeIds].sort(),
    edges,
    components,
    globalFallbackNodeIds: globalNodes.map((index) => nodeIds[index]!).sort(),
    edgeCount: edges.length,
    maxComponentSize: Math.max(0, ...components.map((component) => component.length)),
  };
  return {
    ...snapshotBody,
    contentHash: contentHash(snapshotBody),
  };
}

export function interactionDependencyComponents(
  dependencies: readonly InteractionDependency[],
  mode: InteractionGraphMode = "canonical",
): string[][] {
  return buildInteractionDependencyGraph(dependencies, mode).components;
}

/**
 * Small, intentionally slow oracle used by regression tests. The production
 * scheduler uses the indexed graph above; this pairwise implementation gives
 * us an independent reference for proving that optimization did not change
 * component semantics.
 */
export function interactionDependencyComponentsExhaustive(
  dependencies: readonly InteractionDependency[],
  mode: InteractionGraphMode = "canonical",
): string[][] {
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
      if (interactionDependenciesConflict(dependencies[left]!, dependencies[right]!, mode)) union(left, right);
    }
  }
  const groups = new Map<number, string[]>();
  dependencies.forEach((dependency, index) => {
    const group = groups.get(root(index)) ?? [];
    group.push(dependency.id);
    groups.set(root(index), group);
  });
  return [...groups.values()]
    .map((group) => group.sort())
    .sort((left, right) => left[0]!.localeCompare(right[0]!));
}

export function interactionDependencyEdgeCount(
  dependencies: readonly InteractionDependency[],
  mode: InteractionGraphMode = "canonical",
): number {
  return buildInteractionDependencyGraph(dependencies, mode).edgeCount;
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
  dependencies: readonly InteractionDependency[],
): boolean {
  if (dependencies.some((dependency) => dependency.globalFallback)) return false;
  const declared = new Set(dependencies.flatMap((dependency) =>
    [...dependency.reads, ...dependency.writes].map(footprintRefKey)));
  const actual = actualComponentFootprint(state, resolution);
  return [...actual.reads, ...actual.writes].some((key) => !declared.has(key));
}
