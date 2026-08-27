import { AgentMind } from "./agent-mind";
import { evaluateProposalCausality } from "./causality";
import type {
  ActionGrounding,
  ActionGroundingDraft,
  AlgorithmManifest,
  BootstrapCandidate,
  BootstrapInput,
  ExecutionContext,
  ExternalActionInput,
  FootprintRef,
  PolicyBinding,
  WorldExecutionAlgorithm,
  WorldStepCandidate,
  WorldStepInput,
} from "./execution";
import { actionGroundingSchema, temporalPlanDraftSchema } from "./llm-schemas";
import type { AgentMindOutput } from "./llm-schemas";
import type {
  AgentActionProposal,
  AgentId,
  AgentState,
  ModelExecutionAudit,
  ObservationPacket,
  SimulationState,
  TransitionProposal,
  WorldDeltaOperation,
} from "./model";
import { contentHash } from "./model-audit";
import { applyMindCommit } from "./mind-commit";
import {
  ModelOutputError,
  ModelSemanticRepairError,
  modelInvocationCorrelation,
  modelInvocationIdentity,
  setModelInvocationOutcome,
  setModelInvocationResultKind,
  combineModelExecutionAudits,
  type ModelExecutionScope,
  type StructuredModelProvider,
} from "./model-provider";
import { applyObservationBindings, pendingObservationsFor, validateObservations } from "./observation";
import { ObservationRenderer } from "./observation-renderer";
import type { RulePackageRegistry } from "./rule-package";
import { quantityId, runtimeId } from "./runtime-id";
import { projectAgentSelfState } from "./self-state";
import { applyTransitionProposal } from "./transaction";
import { TruthEngine, type TruthResolution } from "./truth-engine";
import {
  createActivity,
  cancelActivity,
  advanceTemporalState,
  materializeTemporalPlan,
  reconcileTemporalOutcomes,
  selectTemporalBoundary,
  validateActivityResources,
  type ActivityState,
  type TemporalAdvanceResult,
  type TemporalBoundary,
  type TemporalPlan,
} from "./temporal";

const groundingComponent = { id: "action-grounding", version: "1", config: { repairAttempts: 2 } } as const;
const temporalComponent = { id: "temporal-planner", version: "1", config: { repairAttempts: 2 } } as const;
const truthComponent = { id: "truth-conflict-component", version: "1", config: { fallback: "global" } } as const;
const mindComponent = {
  id: "agent-mind",
  version: "4",
  config: { externalUpdates: false, repairExhaustion: "empty-patch-and-idle-action" },
} as const;
const manifestBody = {
  id: "eager-reference",
  version: "2",
  config: {
    activation: "all-model-agents",
    grounding: "per-action",
    resolution: "conflict-components-with-global-fallback",
    observation: "component-bounded",
    mindUpdate: "all-model-agents",
  },
  components: [temporalComponent, groundingComponent, truthComponent, mindComponent].map((component) => ({
    ...component,
    hash: contentHash(component),
  })),
} as const;

export const EAGER_REFERENCE_MANIFEST: AlgorithmManifest = {
  ...manifestBody,
  hash: contentHash(manifestBody),
};

const GROUNDING_SYSTEM = `你是 Living World Engine 的行动 grounding 器。只判断给定行动可能读取、写入和影响哪些已列出的 canonical 资源与 Agent。

必须保守：只要自然语言可能触及目录外资源、远程传播、规则全局状态或无法确定边界，就令 globalFallback=true，并在 reads 与 writes 中加入 {"kind":"global","id":"world"}。
不得创建 ID，不得输出状态修改、结果或叙事。actor 的私有认知只用于理解本行动，不是 canonical Fact；任何私有 claim、evidence 或 goal ID 都不得作为 footprint id。
行动与 actor 身份由调用槽位固定，不要输出。只输出 schema 指定的 JSON。`;

const GROUNDING_PROMPT_VERSION = "action-grounding-v1";

const TEMPORAL_PLANNER_SYSTEM = `你是 Living World Engine 的语义时间计划器。你只能为给定行动选择剧本列出的一个 temporal profile，并说明选择依据。

禁止直接估算、发明或填写任意世界时间。profile basis 不包含秒数；只有当玩家原文明确写出时长时才可使用 explicit_duration，并逐字引用 sourceText。只有当玩家原文明确写出 profile 对应单位的数量时才可使用 explicit_quantity，并逐字引用 sourceText。引擎会独立解析原文并拒绝不一致数值。
不得创建 ID，不得输出状态 delta，不得把未来完成效果写入计划。causes 必须只引用当前行动。只输出 schema 指定的 JSON。`;

const TEMPORAL_PLANNER_PROMPT_VERSION = "temporal-plan-v1";

function temporalPlannerContext(
  state: Readonly<SimulationState>,
  action: AgentActionProposal,
  issues: readonly string[],
): unknown {
  return {
    contractVersion: 1,
    temporalAction: structuredClone(action),
    currentElapsedSeconds: state.truth.elapsedSeconds,
    temporalProfiles: Object.values(state.truth.mechanics.temporalProfiles)
      .map((profile) => structuredClone(profile))
      .sort((left, right) => left.id.localeCompare(right.id)),
    temporalCalibrations: structuredClone(state.truth.mechanics.temporalCalibrations)
      .sort((left, right) => left.id.localeCompare(right.id)),
    existingActivities: Object.values(state.truth.activities)
      .filter((activity) => activity.participantAgentIds.includes(action.actorId) &&
        (activity.status === "active" || activity.status === "paused"))
      .map(({ id, status, plan, progress }) => ({
        id,
        status,
        profileId: plan.profileId,
        description: plan.description,
        progress,
      })),
    validationIssues: issues,
  };
}

async function generateTemporalActivity(
  provider: StructuredModelProvider,
  state: Readonly<SimulationState>,
  action: AgentActionProposal,
  scope: ModelExecutionScope,
  profileId: string,
): Promise<{ plan: TemporalPlan; activity: ActivityState; audit: ModelExecutionAudit }> {
  const audits: ModelExecutionAudit[] = [];
  let issues: string[] = [];
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const identity = modelInvocationIdentity(scope, "temporal-planner", action.actorId, attempt + 1);
    try {
      const generated = await provider.generateStructured({
        profileId,
        workloadId: scope.workloadId,
        batchId: scope.batchId,
        abortSignal: scope.abortSignal,
        correlation: scope.correlation,
        observer: scope.observer,
        ...identity,
        role: "temporal-planner",
        subjectId: action.actorId,
        promptVersion: TEMPORAL_PLANNER_PROMPT_VERSION,
        schemaName: "temporal_plan",
        system: TEMPORAL_PLANNER_SYSTEM,
        context: temporalPlannerContext(state, action, issues),
        schema: temporalPlanDraftSchema,
      });
      audits.push(generated.audit);
      const plan = materializeTemporalPlan({
        id: runtimeId({
          worldHash: state.worldHash,
          revision: state.revision,
          kind: "temporal-plan",
          stage: "action-plan",
          owner: action.id,
          round: 0,
          ordinal: 0,
        }),
        actionId: action.id,
        actorId: action.actorId,
        rawText: action.rawText,
        startsAtSeconds: state.truth.elapsedSeconds,
        draft: {
          ...structuredClone(generated.value),
          causes: [{ kind: "action", id: action.id }],
        },
        profiles: state.truth.mechanics.temporalProfiles,
      });
      const activity = createActivity({
        id: runtimeId({
          worldHash: state.worldHash,
          revision: state.revision,
          kind: "activity",
          stage: "action-plan",
          owner: action.id,
          round: 0,
          ordinal: 0,
        }),
        plan,
        sourceAction: action,
      });
      setModelInvocationResultKind(generated.audit, "temporal_plan");
      setModelInvocationOutcome(generated.audit, "accepted");
      return { plan, activity, audit: combineModelExecutionAudits(audits) };
    } catch (error) {
      if (error instanceof ModelOutputError && error.audit) audits.push(error.audit);
      issues = [error instanceof Error ? error.message : String(error)];
      const last = audits.at(-1);
      if (last?.invocations.length) setModelInvocationOutcome(last, "rejected", ["invalid_temporal_plan"]);
      contextlessEmit(scope, action, identity, issues[0]!);
      if (attempt === 2) {
        throw new ModelSemanticRepairError(
          "temporal-planner",
          `temporal planning failed after repairs for ${action.actorId}: ${issues[0]}`,
          { cause: error, audit: audits.length > 0 ? combineModelExecutionAudits(audits) : undefined },
        );
      }
    }
  }
  throw new Error("unreachable temporal planning loop");
}

function contextlessEmit(
  scope: ModelExecutionScope,
  action: AgentActionProposal,
  identity: ReturnType<typeof modelInvocationIdentity>,
  message: string,
): void {
  scope.observer?.emit({
    event: "model.semantic.rejected",
    level: "warn",
    correlation: modelInvocationCorrelation(scope, "temporal-planner", action.actorId, identity),
    attributes: { resultKind: "temporal_plan" },
    error: { name: "TemporalPlanError", message },
  });
}

function observationsFor(packets: readonly ObservationPacket[], observerId: string): ObservationPacket[] {
  return packets.filter((packet) => packet.observerId === observerId);
}

type EagerMindOutput = AgentMindOutput & { modelAudit: ModelExecutionAudit; fallback: boolean };

export function createMindRepairFallback(
  state: Readonly<SimulationState>,
  agent: Readonly<AgentState>,
  audit: ModelExecutionAudit,
  purpose: "bootstrap" | "resume" | "mind",
): EagerMindOutput {
  return {
    beliefPatch: { agentId: agent.id, baseRevision: state.revision, operations: [] },
    characterPatch: { agentId: agent.id, baseRevision: state.revision, operations: [] },
    nextAction: {
      id: runtimeId({
        worldHash: state.worldHash,
        revision: state.revision,
        kind: "action",
        stage: `${purpose}-repair-fallback`,
        owner: agent.id,
        round: 0,
        ordinal: 0,
      }),
      actorId: agent.id,
      baseRevision: state.revision,
      rawText: "观察并等待",
      goal: "在下一次有效决策前不采取新的主动行动",
      means: null,
      targetIds: [],
    },
    modelAudit: structuredClone(audit),
    fallback: true,
  };
}

async function thinkWithFallback(
  state: Readonly<SimulationState>,
  agent: Readonly<AgentState>,
  purpose: "bootstrap" | "resume" | "mind",
  context: ExecutionContext,
  think: () => Promise<AgentMindOutput & { modelAudit: ModelExecutionAudit }>,
): Promise<EagerMindOutput> {
  try {
    return { ...await think(), fallback: false };
  } catch (error) {
    if (!(error instanceof ModelSemanticRepairError) || !error.audit) throw error;
    context.trace.emit({
      event: "algorithm.agent_mind.repair_fallback",
      level: "warn",
      correlation: { ...context.modelScope.correlation, modelSubject: agent.id },
      attributes: { phase: purpose, policy: "empty-patch-and-idle-action" },
      counts: { mindFallbacks: 1 },
      error: { name: error.name, message: error.message },
    });
    return createMindRepairFallback(state, agent, error.audit, purpose);
  }
}

async function settledValues<T>(promises: readonly Promise<T>[], label: string): Promise<T[]> {
  const settled = await Promise.allSettled(promises);
  const failures = settled.filter((result): result is PromiseRejectedResult => result.status === "rejected");
  if (failures.length > 0) throw new AggregateError(failures.map((failure) => failure.reason), `${label} batch failed`);
  return settled.map((result) => (result as PromiseFulfilledResult<T>).value);
}

function refKey(ref: FootprintRef): string {
  return `${ref.kind}:${ref.id}`;
}

function stableRefs(refs: readonly FootprintRef[]): FootprintRef[] {
  return [...new Map(refs.map((ref) => [refKey(ref), structuredClone(ref)])).values()]
    .sort((left, right) => refKey(left).localeCompare(refKey(right)));
}

export function normalizeGrounding(
  state: Readonly<SimulationState>,
  action: AgentActionProposal,
  value: ActionGrounding,
): { grounding: ActionGrounding; fallbackReasons: string[] } {
  if (value.actionId !== action.id || value.actorId !== action.actorId) {
    throw new Error("grounding changed action or actor identity");
  }
  const catalogs: Record<Exclude<FootprintRef["kind"], "global">, Readonly<Record<string, unknown>>> = {
    entity: state.truth.entities,
    fact: state.truth.facts,
    placement: state.truth.entities,
    meter: state.truth.meters,
    quantity: state.truth.quantities,
    rating: state.truth.ratings,
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
    grounding: {
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

function groundingFallbackEvent(
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

function acceptedGrounding(
  state: Readonly<SimulationState>,
  action: AgentActionProposal,
  value: ActionGroundingDraft,
  scope: ModelExecutionScope,
): ActionGrounding {
  const normalized = normalizeGrounding(state, action, {
    actionId: action.id,
    actorId: action.actorId,
    ...structuredClone(value),
  });
  groundingFallbackEvent(scope, action, normalized.fallbackReasons);
  return enrichGrounding(state, action, normalized.grounding);
}

function enrichGrounding(
  state: Readonly<SimulationState>,
  action: AgentActionProposal,
  grounding: ActionGrounding,
): ActionGrounding {
  const agent = state.agents[action.actorId];
  const placementId = state.truth.placements[agent.entityId];
  const mandatory: FootprintRef[] = [
    { kind: "entity", id: agent.entityId },
    ...(placementId ? [{ kind: "placement" as const, id: placementId }] : []),
  ];
  return {
    actionId: action.id,
    actorId: action.actorId,
    reads: stableRefs([...grounding.reads, ...mandatory]),
    writes: stableRefs([...grounding.writes, { kind: "entity", id: agent.entityId }]),
    audienceAgentIds: [...new Set([action.actorId, ...grounding.audienceAgentIds])].sort(),
    globalFallback: grounding.globalFallback,
  };
}

function groundingContext(
  state: Readonly<SimulationState>,
  action: AgentActionProposal,
  issues: readonly string[],
): unknown {
  const agent = state.agents[action.actorId];
  return {
    contractVersion: 1,
    action,
    actorPrivateView: {
      character: agent.character,
      belief: agent.belief,
      selfState: projectAgentSelfState(state, agent),
    },
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
      agents: Object.values(state.agents).map(({ id, entityId }) => ({ id, entityId })),
    },
    validationIssues: issues,
  };
}

async function generateGrounding(
  provider: StructuredModelProvider,
  state: Readonly<SimulationState>,
  action: AgentActionProposal,
  scope: ModelExecutionScope,
  profileId: string,
): Promise<{ grounding: ActionGrounding; audit: ModelExecutionAudit }> {
  const audits: ModelExecutionAudit[] = [];
  let issues: string[] = [];
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const identity = modelInvocationIdentity(scope, "action-grounding", action.actorId, attempt + 1);
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
      return { grounding: acceptedGrounding(state, action, generated.value, scope), audit };
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

function materializeExternalAction(
  state: Readonly<SimulationState>,
  input: ExternalActionInput,
  ordinal: number,
  stage: "external" | "replay",
): AgentActionProposal {
  if (!input.rawText.trim() || !input.goal.trim()) throw new Error(`external action for ${input.agentId} is blank`);
  return {
    id: runtimeId({
      worldHash: state.worldHash,
      revision: state.revision,
      kind: "action",
      stage,
      owner: input.agentId,
      round: 0,
      ordinal,
    }),
    actorId: input.agentId,
    baseRevision: state.revision,
    rawText: input.rawText.trim(),
    goal: input.goal.trim(),
    means: input.means?.trim() || null,
    targetIds: [...input.targetIds],
  };
}

function collectActions(
  input: Readonly<WorldStepInput>,
  preparedActions: ReadonlyMap<AgentId, AgentActionProposal>,
  eligibleAgentIds: readonly AgentId[],
): AgentActionProposal[] {
  const state = input.state;
  const agentIds = Object.keys(state.agents).sort();
  const rosterIds = Object.keys(input.policyRoster).sort();
  if (contentHash(agentIds) !== contentHash(rosterIds)) throw new Error("policy roster must cover every Agent exactly once");
  const externalByAgent = new Map<string, ExternalActionInput>();
  for (const external of input.request.externalActions) {
    if (externalByAgent.has(external.agentId)) throw new Error(`duplicate external action for ${external.agentId}`);
    externalByAgent.set(external.agentId, external);
  }
  const eligible = new Set(eligibleAgentIds);
  const actions = agentIds.flatMap((agentId, ordinal) => {
    const binding = input.policyRoster[agentId];
    if (!binding || binding.agentId !== agentId) throw new Error(`invalid policy binding for ${agentId}`);
    if (!eligible.has(agentId)) return [];
    if (binding.kind === "model") {
      const prepared = preparedActions.get(agentId) ?? state.agents[agentId].nextAction;
      if (!prepared) throw new Error(`model Agent ${agentId} has not prepared an action`);
      return [structuredClone(prepared)];
    }
    if (binding.kind === "external" || binding.kind === "replay") {
      const external = externalByAgent.get(agentId);
      if (!external) throw new Error(`${binding.kind} Agent ${agentId} has no supplied action`);
      externalByAgent.delete(agentId);
      return [materializeExternalAction(state, external, ordinal, binding.kind)];
    }
    return [];
  });
  if (externalByAgent.size > 0) throw new Error(`external action targets non-external Agent ${externalByAgent.keys().next().value}`);
  return actions;
}

function decisionEligibleAgentIds(state: Readonly<SimulationState>, forcedAgentIds: readonly AgentId[] = []): AgentId[] {
  const decisionAgents = new Set(state.history.at(-1)?.decisionPoints.map((point) => point.agentId) ?? []);
  forcedAgentIds.forEach((agentId) => decisionAgents.add(agentId));
  const busyAgents = new Set(Object.values(state.truth.activities)
    .filter((activity) => activity.status === "active" || activity.status === "paused")
    .flatMap((activity) => activity.participantAgentIds));
  return Object.keys(state.agents)
    .filter((agentId) => !busyAgents.has(agentId) || decisionAgents.has(agentId))
    .sort();
}

function conflicts(left: ActionGrounding, right: ActionGrounding): boolean {
  if (left.globalFallback || right.globalFallback) return true;
  const leftWrites = new Set(left.writes.map(refKey));
  const rightWrites = new Set(right.writes.map(refKey));
  const leftReads = new Set(left.reads.map(refKey));
  const rightReads = new Set(right.reads.map(refKey));
  return [...leftWrites].some((key) => rightWrites.has(key) || rightReads.has(key)) ||
    [...rightWrites].some((key) => leftReads.has(key)) ||
    left.audienceAgentIds.includes(right.actorId) || right.audienceAgentIds.includes(left.actorId);
}

export function conflictComponents(groundings: readonly ActionGrounding[]): AgentId[][] {
  const parent = groundings.map((_, index) => index);
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
  for (let left = 0; left < groundings.length; left += 1) {
    for (let right = left + 1; right < groundings.length; right += 1) {
      if (conflicts(groundings[left], groundings[right])) union(left, right);
    }
  }
  const groups = new Map<number, AgentId[]>();
  groundings.forEach((grounding, index) => {
    const group = groups.get(root(index)) ?? [];
    group.push(grounding.actorId);
    groups.set(root(index), group);
  });
  return [...groups.values()].map((group) => group.sort()).sort((left, right) => left[0].localeCompare(right[0]));
}

function conflictEdgeCount(groundings: readonly ActionGrounding[]): number {
  let edges = 0;
  for (let left = 0; left < groundings.length; left += 1) {
    for (let right = left + 1; right < groundings.length; right += 1) {
      if (conflicts(groundings[left], groundings[right])) edges += 1;
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
    case "set_rating": writes.add(`rating:${operation.rating.id}`); break;
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

function actualComponentsConflict(
  state: Readonly<SimulationState>,
  left: TruthResolution,
  right: TruthResolution,
): boolean {
  const a = actualComponentFootprint(state, left);
  const b = actualComponentFootprint(state, right);
  return [...a.writes].some((key) => b.writes.has(key) || b.reads.has(key)) ||
    [...b.writes].some((key) => a.reads.has(key));
}

function exceedsDeclaredFootprint(
  state: Readonly<SimulationState>,
  resolution: TruthResolution,
  groundings: readonly ActionGrounding[],
): boolean {
  if (groundings.some((grounding) => grounding.globalFallback)) return false;
  const declared = new Set(groundings.flatMap((grounding) => [...grounding.reads, ...grounding.writes].map(refKey)));
  const actual = actualComponentFootprint(state, resolution);
  return [...actual.reads, ...actual.writes].some((key) => !declared.has(key));
}

function mergeResolutions(
  source: Readonly<SimulationState>,
  resolutions: readonly TruthResolution[],
  boundary: Readonly<TemporalBoundary>,
  fallbackCause: import("./model").CausalRef,
): TruthResolution {
  const actions = resolutions.flatMap((resolution) => structuredClone(resolution.actions));
  const proposal: TransitionProposal = {
    baseRevision: source.revision,
    outcomes: resolutions.flatMap((resolution) => structuredClone(resolution.proposal.outcomes)),
    mechanicInvocations: resolutions.flatMap((resolution) => structuredClone(resolution.proposal.mechanicInvocations)),
    operations: [
      ...resolutions.flatMap((resolution) => resolution.proposal.operations
        .filter((operation) => operation.kind !== "advance_time")
        .map((operation) => structuredClone(operation))),
      {
        kind: "advance_time",
        seconds: boundary.deltaSeconds,
        causes: actions.length > 0
          ? actions.map((action) => ({ kind: "action" as const, id: action.id }))
          : [structuredClone(fallbackCause)],
        assertions: [{
          kind: "elapsed_seconds_compare" as const,
          operator: "eq" as const,
          value: source.truth.elapsedSeconds,
        }],
      },
    ],
    events: resolutions.flatMap((resolution) => structuredClone(resolution.proposal.events)),
    observations: resolutions.flatMap((resolution) => structuredClone(resolution.proposal.observations)),
    decisionRequests: resolutions.flatMap((resolution) => structuredClone(resolution.proposal.decisionRequests)),
  };
  const checks = resolutions.flatMap((resolution) => structuredClone(resolution.checks));
  const randomResults = resolutions.flatMap((resolution) => structuredClone(resolution.randomResults));
  return {
    proposal,
    initialActions: resolutions.flatMap((resolution) => structuredClone(resolution.initialActions)),
    actions,
    reactionRequests: resolutions.flatMap((resolution) => structuredClone(resolution.reactionRequests)),
    reactionDecisions: resolutions.flatMap((resolution) => structuredClone(resolution.reactionDecisions)),
    stimulusObservations: resolutions.flatMap((resolution) => structuredClone(resolution.stimulusObservations)),
    requests: resolutions.flatMap((resolution) => structuredClone(resolution.requests)),
    checks,
    randomRequests: resolutions.flatMap((resolution) => structuredClone(resolution.randomRequests)),
    randomResults,
    commitmentRounds: resolutions.flatMap((resolution) => structuredClone(resolution.commitmentRounds)),
    rng: structuredClone(resolutions.at(-1)?.rng ?? source.truth.rng),
    mechanicResults: resolutions.flatMap((resolution) => structuredClone(resolution.mechanicResults)),
    causalAssertionResults: evaluateProposalCausality(source, checks, randomResults, proposal),
    causalVerification: { verdict: "accept", findings: [] },
    modelAudits: resolutions.flatMap((resolution) => structuredClone(resolution.modelAudits)),
    reactionModelAudits: resolutions.flatMap((resolution) => structuredClone(resolution.reactionModelAudits)),
  };
}

export class EagerReferenceAlgorithm implements WorldExecutionAlgorithm {
  readonly manifest = EAGER_REFERENCE_MANIFEST;
  private readonly truthEngine: TruthEngine;
  private readonly agentMind: AgentMind;
  private readonly observationRenderer: ObservationRenderer;
  private readonly provider: StructuredModelProvider;

  constructor(provider: StructuredModelProvider, rulePackages?: RulePackageRegistry) {
    this.provider = provider;
    this.truthEngine = new TruthEngine(provider, { rulePackages });
    this.agentMind = new AgentMind(provider);
    this.observationRenderer = new ObservationRenderer(provider);
  }

  async bootstrap(input: Readonly<BootstrapInput>, context: ExecutionContext): Promise<BootstrapCandidate> {
    const source = structuredClone(input.state);
    const agents = Object.values(source.agents).sort((left, right) => left.id.localeCompare(right.id));
    const outputs = await settledValues(agents.map((agent) => thinkWithFallback(
      source,
      agent,
      "bootstrap",
      context,
      () => this.agentMind.think(
        source,
        agent,
        [],
        context.modelScope,
        { action: null, outcome: null },
        [],
        "bootstrap",
      ),
    )), "AgentMind bootstrap");
    context.trace.emit({
      event: "algorithm.activation.completed",
      attributes: { phase: "bootstrap", policy: "all-model-agents" },
      counts: { persistentAgents: agents.length, eligibleAgents: agents.length, activatedAgents: agents.length },
    });
    return {
      sourceStateHash: contentHash(source),
      agentCommits: outputs.map((output, index) => ({
        agentId: agents[index].id,
        beliefPatch: structuredClone(output.beliefPatch),
        characterPatch: structuredClone(output.characterPatch),
        nextAction: structuredClone(output.nextAction),
      })),
      modelAudits: outputs.map((output) => structuredClone(output.modelAudit)),
    };
  }

  private async resolveComponent(
    input: Readonly<WorldStepInput>,
    actions: readonly AgentActionProposal[],
    groundings: readonly ActionGrounding[],
    actorIds: readonly AgentId[],
    rngState: SimulationState["truth"]["rng"],
    context: ExecutionContext,
    globalFallback: boolean,
    temporal: Readonly<TemporalAdvanceResult>,
    newActionIds: ReadonlySet<string>,
  ): Promise<TruthResolution> {
    const scopedState = structuredClone(input.state);
    scopedState.truth.rng = structuredClone(rngState);
    scopedState.agents = Object.fromEntries(actorIds.map((agentId) => [agentId, structuredClone(input.state.agents[agentId])]));
    const scopedActions = actions.filter((action) => actorIds.includes(action.actorId));
    const scopedGroundings = groundings.filter((grounding) => actorIds.includes(grounding.actorId));
    const scopedTemporalBase: TemporalAdvanceResult = {
      ...structuredClone(temporal),
      activities: Object.fromEntries(Object.entries(temporal.activities)
        .filter(([, activity]) => actorIds.includes(activity.actorId))
        .map(([id, activity]) => [id, structuredClone(activity)])),
      timers: Object.fromEntries(Object.entries(temporal.timers)
        .filter(([, timer]) => timer.wakeAgentIds.every((agentId) => actorIds.includes(agentId)))
        .map(([id, timer]) => [id, structuredClone(timer)])),
      transitions: temporal.transitions.filter((transition) => actorIds.includes(transition.actorId))
        .map((transition) => structuredClone(transition)),
      decisionPoints: temporal.decisionPoints.filter((point) => actorIds.includes(point.agentId))
        .map((point) => structuredClone(point)),
    };
    const identityOwner = globalFallback ? "component-global" : `component-${actorIds.join("+")}`;
    let transitionCandidate: SimulationState | undefined;
    const resolution = await this.truthEngine.resolve({
      definition: input.definition,
      state: scopedState,
      initialActions: scopedActions.map((action) => structuredClone(action)),
      temporalBoundary: temporal.boundary,
      identityOwner,
      groundings: scopedGroundings,
      resolveReactions: async (requests) => {
        const continuing = requests.filter((request) => !newActionIds.has(request.sourceActionId));
        const outputs = await settledValues(requests.map((request) => {
          if (continuing.includes(request)) return Promise.resolve(null);
          const agent = applyObservationBindings(scopedState.agents[request.agentId], [request.stimulus]);
          const originalAction = scopedActions.find((action) => action.actorId === request.agentId);
          if (!originalAction) throw new Error(`reaction Agent ${request.agentId} has no prepared action`);
          return this.agentMind.react(scopedState, agent, originalAction, request.stimulus, context.modelScope);
        }), "Agent reaction");
        const reactiveOutputs = outputs.filter((output): output is Exclude<typeof output, null> => output !== null);
        return {
          decisions: requests.map((request) => {
            const output = reactiveOutputs.find((candidate) => candidate.agentId === request.agentId);
            if (!output) return {
              agentId: request.agentId,
              baseRevision: scopedState.revision,
              originalProposalId: request.sourceActionId,
              kind: "keep" as const,
            };
            return output.kind === "keep" ? {
            agentId: output.agentId,
            baseRevision: output.baseRevision,
            originalProposalId: output.originalProposalId,
            kind: output.kind,
            } : {
            agentId: output.agentId,
            baseRevision: output.baseRevision,
            originalProposalId: output.originalProposalId,
            kind: output.kind,
            replacementAction: output.replacementAction,
            };
          }),
          modelAudits: reactiveOutputs.map((output) => output.modelAudit),
        };
      },
      renderObservations: async (proposal, finalActions, transitionAttempt) => {
        const resolvedTemporal = reconcileTemporalOutcomes(scopedTemporalBase, proposal.outcomes);
        const transitioned = applyTransitionProposal(scopedState, proposal, resolvedTemporal);
        const observationIdentityOwner = `${identityOwner}:transition-${transitionAttempt}`;
        const rendered = await this.observationRenderer.render({
          definition: input.definition,
          state: scopedState,
          proposal: structuredClone(proposal),
          actions: structuredClone(finalActions),
          observerIds: Object.keys(transitioned.agents).sort(),
          identityOwner: observationIdentityOwner,
          temporalState: resolvedTemporal,
        }, context.modelScope);
        context.trace.emit({
          event: "observation.rendering.completed",
          attributes: { identityOwner: observationIdentityOwner, transitionAttempt },
          counts: {
            observationBatches: rendered.batchCount,
            observations: rendered.packets.length,
          },
        });
        return rendered;
      },
      validateProposal: (proposal, _checks, _randomResults, finalActions, stimulus) => {
        const resolvedTemporal = reconcileTemporalOutcomes(scopedTemporalBase, proposal.outcomes);
        const candidate = applyTransitionProposal(scopedState, proposal, resolvedTemporal);
        validateObservations(candidate, [...stimulus, ...proposal.observations], candidate.step);
        const observers = new Set(proposal.observations
          .filter((packet) => packet.kind === "outcome")
          .map((packet) => packet.observerId));
        for (const agentId of actorIds) {
          if (!observers.has(agentId)) throw new Error(`component transition omitted observation for ${agentId}`);
        }
        if (finalActions.length !== actorIds.length) throw new Error("component transition changed action cardinality");
        const continuingActionIds = new Set(Object.values(resolvedTemporal.activities)
          .filter((activity) => activity.status === "active")
          .map((activity) => activity.sourceActionId));
        for (const actionId of continuingActionIds) {
          const outcome = proposal.outcomes.find((entry) => entry.proposalId === actionId);
          if (outcome && outcome.status !== "continuing") {
            throw new Error(`activity action ${actionId} must remain continuing before completion`);
          }
        }
        for (const operation of proposal.operations) {
          if (operation.kind === "advance_time") continue;
          if (operation.causes.some((cause) => cause.kind === "action" && continuingActionIds.has(cause.id))) {
            throw new Error("continuing activity cannot commit semantic completion effects before its boundary");
          }
        }
        for (const event of proposal.events) {
          if (event.causes.some((cause) => cause.kind === "action" && continuingActionIds.has(cause.id))) {
            throw new Error("continuing activity cannot emit completion events before its boundary");
          }
        }
        transitionCandidate = candidate;
      },
    }, context.modelScope);
    if (!transitionCandidate) throw new Error("component TruthEngine returned no candidate");
    return resolution;
  }

  async step(input: Readonly<WorldStepInput>, context: ExecutionContext): Promise<WorldStepCandidate> {
    const source = structuredClone(input.state);
    const eligibleAgentIds = decisionEligibleAgentIds(
      source,
      input.request.externalActions.map((action) => action.agentId),
    );
    const eligibleAgents = new Set(eligibleAgentIds);
    const resumedAgentIds = Object.entries(input.policyRoster)
      .filter(([agentId, binding]) => eligibleAgents.has(agentId) && binding.kind === "model" &&
        (binding.resumeFromRevision !== undefined || source.agents[agentId]?.nextAction === null))
      .map(([agentId]) => agentId)
      .sort();
    const resumedOutputs = await settledValues(resumedAgentIds.map((agentId) => thinkWithFallback(
      source,
      source.agents[agentId],
      "resume",
      context,
      () => this.agentMind.think(
        source,
        source.agents[agentId],
        pendingObservationsFor(source, source.agents[agentId]),
        context.modelScope,
        { action: null, outcome: null },
        [],
        "resume",
      ),
    )), "AgentMind policy resume");
    const resumedByAgent = new Map(resumedAgentIds.map((agentId, index) => [agentId, resumedOutputs[index]]));
    const preparedActions = new Map(resumedAgentIds.map((agentId, index) => [
      agentId,
      resumedOutputs[index].nextAction,
    ]));
    const newActions = collectActions(input, preparedActions, eligibleAgentIds);
    const temporalPlanning = await settledValues(newActions.map((action) => generateTemporalActivity(
      this.provider,
      source,
      action,
      context.modelScope,
      input.definition.modelProfiles.resolution,
    )), "temporal planning");
    const planningState = structuredClone(source);
    const interruptionTransitions = newActions.flatMap((action) => Object.values(planningState.truth.activities)
      .filter((activity) => activity.actorId === action.actorId &&
        (activity.status === "active" || activity.status === "paused"))
      .map((activity) => {
        const cancelled = cancelActivity(activity, source.truth.elapsedSeconds);
        planningState.truth.activities[activity.id] = cancelled.activity;
        return cancelled.transition;
      }));
    for (const result of temporalPlanning) {
      if (planningState.truth.activities[result.activity.id]) {
        throw new Error(`duplicate activity identity ${result.activity.id}`);
      }
      planningState.truth.activities[result.activity.id] = structuredClone(result.activity);
    }
    validateActivityResources(
      planningState.truth.activities,
      planningState.truth.mechanics.activityResources,
    );
    const temporalBoundary = selectTemporalBoundary({
      elapsedSeconds: source.truth.elapsedSeconds,
      maxAutonomousSpanSeconds: input.definition.runtimeDefaults.maxAutonomousSpanSeconds,
      activities: planningState.truth.activities,
      timers: planningState.truth.timers,
      conditionExpiries: Object.fromEntries(Object.values(planningState.truth.conditions)
        .filter((condition) => condition.expiresAtElapsedSeconds !== null)
        .map((condition) => [condition.id, condition.expiresAtElapsedSeconds!])),
    });
    let temporal = advanceTemporalState({
      boundary: temporalBoundary,
      activities: planningState.truth.activities,
      timers: planningState.truth.timers,
    });
    temporal.transitions = [...interruptionTransitions, ...temporal.transitions];
    const dueActions = temporalBoundary.dueActivityIds.flatMap((activityId) => {
      const activity = planningState.truth.activities[activityId];
      if (!activity) throw new Error(`temporal boundary references unknown activity ${activityId}`);
      return [{ ...structuredClone(activity.sourceAction), baseRevision: source.revision }];
    });
    const actions = [...new Map([...newActions, ...dueActions].map((action) => [action.id, action])).values()]
      .sort((left, right) => left.actorId.localeCompare(right.actorId) || left.id.localeCompare(right.id));
    const newActionIds = new Set(newActions.map((action) => action.id));
    const temporalInput: WorldStepInput = { ...input, state: planningState };
    const groundingResults = await settledValues(actions.map((action) =>
      generateGrounding(
        this.provider,
        planningState,
        action,
        context.modelScope,
        input.definition.modelProfiles.grounding,
      )), "action grounding");
    const groundings = groundingResults.map((result) => result.grounding);
    let components = conflictComponents(groundings);
    let resolutions: TruthResolution[] = [];
    let rng = structuredClone(source.truth.rng);
    for (const component of components) {
      const resolution = await this.resolveComponent(
        temporalInput,
        actions,
        groundings,
        component,
        rng,
        context,
        false,
        temporal,
        newActionIds,
      );
      resolutions.push(resolution);
      rng = structuredClone(resolution.rng);
    }
    let fallback = false;
    for (let left = 0; left < resolutions.length; left += 1) {
      for (let right = left + 1; right < resolutions.length; right += 1) {
        if (actualComponentsConflict(source, resolutions[left], resolutions[right])) fallback = true;
      }
    }
    for (const [index, resolution] of resolutions.entries()) {
      const componentGroundings = groundings.filter((grounding) => components[index].includes(grounding.actorId));
      if (exceedsDeclaredFootprint(source, resolution, componentGroundings)) fallback = true;
    }
    if (fallback) {
      components = [actions.map((action) => action.actorId).sort()];
      resolutions = [await this.resolveComponent(
        temporalInput,
        actions,
        groundings.map((grounding) => ({
          ...grounding,
          reads: stableRefs([...grounding.reads, { kind: "global", id: "world" }]),
          writes: stableRefs([...grounding.writes, { kind: "global", id: "world" }]),
          globalFallback: true,
        })),
        components[0],
        source.truth.rng,
        context,
        true,
        temporal,
        newActionIds,
      )];
    }
    const fallbackLaw = input.definition.laws[0];
    if (!fallbackLaw) throw new Error("temporal advancement requires at least one world law");
    const resolution = mergeResolutions(
      planningState,
      resolutions,
      temporalBoundary,
      { kind: "law", id: fallbackLaw.id },
    );
    temporal = reconcileTemporalOutcomes(temporal, resolution.proposal.outcomes);
    const globalObservationAudits: ModelExecutionAudit[] = [];
    if (components.length > 1) {
      const preview = applyTransitionProposal(planningState, resolution.proposal, temporal);
      const rendered = await this.observationRenderer.render({
        definition: input.definition,
        state: planningState,
        proposal: structuredClone(resolution.proposal),
        actions: structuredClone(resolution.actions),
        observerIds: Object.keys(preview.agents).sort(),
        identityOwner: "step-global-observation",
        temporalState: temporal,
      }, context.modelScope);
      resolution.proposal.observations = structuredClone(rendered.packets);
      globalObservationAudits.push(...structuredClone(rendered.modelAudits));
      context.trace.emit({
        event: "algorithm.observation.global_projection_completed",
        attributes: { phase: "observation", reason: "multiple-conflict-components" },
        counts: {
          observations: rendered.packets.length,
          observationBatches: rendered.batchCount,
          dependencyComponents: components.length,
        },
      });
    }
    const candidate = applyTransitionProposal(source, resolution.proposal, temporal);
    candidate.truth.rng = structuredClone(resolution.rng);
    const observations = [...resolution.stimulusObservations, ...resolution.proposal.observations];
    validateObservations(candidate, observations, candidate.step);
    const postBoundaryDecisionAgents = new Set(temporal.decisionPoints.map((point) => point.agentId));
    const busyAfterBoundary = new Set(Object.values(temporal.activities)
      .filter((activity) => activity.status === "active" || activity.status === "paused")
      .flatMap((activity) => activity.participantAgentIds));
    const modelAgentIds = Object.keys(candidate.agents)
      .filter((agentId) => !source.agents[agentId] ||
        input.policyRoster[agentId]?.kind === "model" &&
        (!busyAfterBoundary.has(agentId) || postBoundaryDecisionAgents.has(agentId)))
      .sort();
    const outputs = await settledValues(modelAgentIds.map((agentId) => {
      let agent = applyObservationBindings(candidate.agents[agentId], observationsFor(observations, agentId));
      const resumed = resumedByAgent.get(agentId);
      if (resumed) {
        agent = applyMindCommit(
          agent,
          resumed,
          source.step,
          [],
          [],
        );
      }
      const action = resolution.actions.find((entry) => entry.actorId === agentId) ?? null;
      const outcome = action
        ? resolution.proposal.outcomes.find((entry) => entry.proposalId === action.id) ?? null
        : null;
      const purpose = source.agents[agentId] ? "mind" : "bootstrap";
      const pendingObservations = pendingObservationsFor(
        candidate,
        agent,
        observationsFor(observations, agentId),
      );
      return thinkWithFallback(candidate, agent, purpose, context, () => this.agentMind.think(
          candidate,
          agent,
          pendingObservations,
          context.modelScope,
          { action, outcome: outcome ? { status: outcome.status } : null },
          resolution.proposal.events,
          purpose,
        ));
    }), "AgentMind");
    const policyCounts = Object.values(input.policyRoster).reduce((counts, binding) => {
      counts[binding.kind] = (counts[binding.kind] ?? 0) + 1;
      return counts;
    }, {} as Record<PolicyBinding["kind"], number>);
    const persistentAgents = Object.keys(source.agents).length;
    const activatedAgents = modelAgentIds.length;
    context.trace.emit({
      event: "algorithm.activation.completed",
      attributes: { phase: "step", policy: "decision-points-only" },
      counts: {
        persistentAgents,
        eligibleAgents: eligibleAgentIds.length,
        activatedAgents,
        skippedAgents: persistentAgents - activatedAgents,
        reusedAgents: 0,
        noopAgents: policyCounts.idle ?? 0,
        externalAgents: policyCounts.external ?? 0,
      },
    });
    context.trace.emit({
      event: "algorithm.candidate.completed",
      attributes: { phase: "step", dependencyAnalysis: "grounded-conflict-components", trigger: input.request.trigger },
      counts: {
        persistentAgents,
        eligibleAgents: activatedAgents,
        activatedAgents,
        noopAgents: policyCounts.idle ?? 0,
        externalAgents: policyCounts.external ?? 0,
        observedAgents: new Set(observations.map((observation) => observation.observerId)).size,
        actions: resolution.actions.length,
        reactions: resolution.reactionDecisions.length,
        checks: resolution.checks.length,
        randomResults: resolution.randomResults.length,
        outcomes: resolution.proposal.outcomes.length,
        operations: resolution.proposal.operations.length,
        events: resolution.proposal.events.length,
        observations: observations.length,
        mindCommits: outputs.length,
        updatedAgents: outputs.length,
        mindFallbacks: outputs.filter((output) => output.fallback).length,
        resumedAgents: resumedAgentIds.length,
        dependencyNodes: groundings.length,
        dependencyEdges: conflictEdgeCount(groundings),
        dependencyComponents: components.length,
        maxDependencyComponent: Math.max(0, ...components.map((component) => component.length)),
        globalFallbacks: groundings.filter((grounding) => grounding.globalFallback).length + (fallback ? 1 : 0),
        footprintCardinality: groundings.reduce((total, grounding) =>
          total + new Set([...grounding.reads, ...grounding.writes].map(refKey)).size, 0),
        audienceCardinality: groundings.reduce(
          (total, grounding) => total + grounding.audienceAgentIds.length,
          0,
        ),
      },
      payload: { groundings, components },
    });
    return {
      sourceStateHash: contentHash(source),
      resolution,
      observations,
      mindCommits: outputs.map((output, index) => {
        const agentId = modelAgentIds[index];
        const resumed = resumedByAgent.get(agentId);
        return {
          agentId,
          beliefPatch: {
            ...structuredClone(output.beliefPatch),
            operations: [
              ...structuredClone(resumed?.beliefPatch.operations ?? []),
              ...structuredClone(output.beliefPatch.operations),
            ],
          },
          characterPatch: {
            ...structuredClone(output.characterPatch),
            operations: [
              ...structuredClone(resumed?.characterPatch.operations ?? []),
              ...structuredClone(output.characterPatch.operations),
            ],
          },
          nextAction: structuredClone(output.nextAction),
        };
      }),
      modelAudits: [
        ...resumedOutputs.map((output) => output.modelAudit),
        ...temporalPlanning.map((result) => result.audit),
        ...groundingResults.map((result) => result.audit),
        ...resolution.modelAudits,
        ...resolution.reactionModelAudits,
        ...globalObservationAudits,
        ...outputs.map((output) => output.modelAudit),
      ],
      groundings,
      components,
      temporalPlans: temporalPlanning.map((result) => structuredClone(result.plan)),
      temporalBoundary: structuredClone(temporalBoundary),
      temporalState: {
        activities: structuredClone(temporal.activities),
        timers: structuredClone(temporal.timers),
      },
      activityTransitions: structuredClone(temporal.transitions),
      decisionPoints: structuredClone(temporal.decisionPoints),
    };
  }
}
