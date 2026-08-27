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
import { actionGroundingSchema } from "./llm-schemas";
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
  type ModelExecutionScope,
  type StructuredModelProvider,
} from "./model-provider";
import { applyObservationBindings, validateObservations } from "./observation";
import { ObservationRenderer } from "./observation-renderer";
import type { RulePackageRegistry } from "./rule-package";
import { quantityId, runtimeId } from "./runtime-id";
import { projectAgentSelfState } from "./self-state";
import { applyTransitionProposal } from "./transaction";
import { TruthEngine, type TruthResolution } from "./truth-engine";

const groundingComponent = { id: "action-grounding", version: "1", config: { repairAttempts: 2 } } as const;
const truthComponent = { id: "truth-conflict-component", version: "1", config: { fallback: "global" } } as const;
const mindComponent = {
  id: "agent-mind",
  version: "4",
  config: { externalUpdates: false, repairExhaustion: "empty-patch-and-idle-action" },
} as const;
const manifestBody = {
  id: "eager-reference",
  version: "1",
  config: {
    activation: "all-model-agents",
    grounding: "per-action",
    resolution: "conflict-components-with-global-fallback",
    observation: "component-bounded",
    mindUpdate: "all-model-agents",
  },
  components: [groundingComponent, truthComponent, mindComponent].map((component) => ({
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
      conditions: state.truth.conditions,
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
  const actions = agentIds.map((agentId, ordinal) => {
    const binding = input.policyRoster[agentId];
    if (!binding || binding.agentId !== agentId) throw new Error(`invalid policy binding for ${agentId}`);
    if (binding.kind === "model") {
      const prepared = preparedActions.get(agentId) ?? state.agents[agentId].nextAction;
      if (!prepared) throw new Error(`model Agent ${agentId} has not prepared an action`);
      return structuredClone(prepared);
    }
    if (binding.kind === "external" || binding.kind === "replay") {
      const external = externalByAgent.get(agentId);
      if (!external) throw new Error(`${binding.kind} Agent ${agentId} has no supplied action`);
      externalByAgent.delete(agentId);
      return materializeExternalAction(state, external, ordinal, binding.kind);
    }
    return {
      id: runtimeId({
        worldHash: state.worldHash,
        revision: state.revision,
        kind: "action",
        stage: "idle",
        owner: agentId,
        round: 0,
        ordinal,
      }),
      actorId: agentId,
      baseRevision: state.revision,
      rawText: `保持空闲（${binding.reason}）`,
      goal: "本步骤不采取主动行动",
      means: null,
      targetIds: [],
    };
  });
  if (externalByAgent.size > 0) throw new Error(`external action targets non-external Agent ${externalByAgent.keys().next().value}`);
  return actions;
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
  simulatedSeconds: number,
): TruthResolution {
  const actions = resolutions.flatMap((resolution) => structuredClone(resolution.actions));
  const allMechanicInvocations = resolutions.flatMap((resolution) =>
    structuredClone(resolution.proposal.mechanicInvocations));
  const allMechanicResults = resolutions.flatMap((resolution) => structuredClone(resolution.mechanicResults));
  const conditionAdvances = allMechanicInvocations.filter((invocation) =>
    invocation.packageId === "core-resolution" && invocation.ruleId === "advance-conditions");
  const keptConditionAdvanceId = conditionAdvances[0]?.id;
  if (conditionAdvances.length > 1 && conditionAdvances.some((invocation) =>
    allMechanicResults.find((result) => result.invocationId === invocation.id)?.operations.length !== 0)) {
    throw new Error("condition advancement with effects requires global resolution");
  }
  const mechanicInvocations = allMechanicInvocations.filter((invocation) =>
    invocation.packageId !== "core-resolution" || invocation.ruleId !== "advance-conditions" ||
    invocation.id === keptConditionAdvanceId);
  const mechanicInvocationIds = new Set(mechanicInvocations.map((invocation) => invocation.id));
  const mechanicResults = allMechanicResults.filter((result) => mechanicInvocationIds.has(result.invocationId));
  const proposal: TransitionProposal = {
    baseRevision: source.revision,
    outcomes: resolutions.flatMap((resolution) => structuredClone(resolution.proposal.outcomes)),
    mechanicInvocations,
    operations: [
      ...resolutions.flatMap((resolution) => resolution.proposal.operations
        .filter((operation) => operation.kind !== "advance_time")
        .map((operation) => structuredClone(operation))),
      {
        kind: "advance_time",
        seconds: simulatedSeconds,
        causes: actions.map((action) => ({ kind: "action" as const, id: action.id })),
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
    resolutionPlans: resolutions.flatMap((resolution) => structuredClone(resolution.resolutionPlans)),
    resolutionReceipts: resolutions.flatMap((resolution) => structuredClone(resolution.resolutionReceipts)),
    rng: structuredClone(resolutions.at(-1)?.rng ?? source.truth.rng),
    mechanicResults,
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
  ): Promise<TruthResolution> {
    const scopedState = structuredClone(input.state);
    scopedState.truth.rng = structuredClone(rngState);
    scopedState.agents = Object.fromEntries(actorIds.map((agentId) => [agentId, structuredClone(input.state.agents[agentId])]));
    const scopedActions = actions.filter((action) => actorIds.includes(action.actorId));
    const scopedGroundings = groundings.filter((grounding) => actorIds.includes(grounding.actorId));
    const identityOwner = globalFallback ? "component-global" : `component-${actorIds.join("+")}`;
    let transitionCandidate: SimulationState | undefined;
    const resolution = await this.truthEngine.resolve({
      definition: input.definition,
      state: scopedState,
      initialActions: scopedActions.map((action) => structuredClone(action)),
      simulatedSeconds: input.request.simulatedSeconds,
      identityOwner,
      groundings: scopedGroundings,
      resolveReactions: async (requests) => {
        const outputs = await settledValues(requests.map((request) => {
          const agent = applyObservationBindings(scopedState.agents[request.agentId], [request.stimulus]);
          const originalAction = scopedActions.find((action) => action.actorId === request.agentId);
          if (!originalAction) throw new Error(`reaction Agent ${request.agentId} has no prepared action`);
          return this.agentMind.react(scopedState, agent, originalAction, request.stimulus, context.modelScope);
        }), "Agent reaction");
        return {
          decisions: outputs.map((output) => output.kind === "keep" ? {
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
          }),
          modelAudits: outputs.map((output) => output.modelAudit),
        };
      },
      renderObservations: async (proposal, finalActions, transitionAttempt) => {
        const transitioned = applyTransitionProposal(scopedState, proposal);
        const observationIdentityOwner = `${identityOwner}:transition-${transitionAttempt}`;
        const rendered = await this.observationRenderer.render({
          definition: input.definition,
          state: scopedState,
          proposal: structuredClone(proposal),
          actions: structuredClone(finalActions),
          observerIds: Object.keys(transitioned.agents).sort(),
          identityOwner: observationIdentityOwner,
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
        const candidate = applyTransitionProposal(scopedState, proposal);
        validateObservations(candidate, [...stimulus, ...proposal.observations], candidate.step);
        const observers = new Set(proposal.observations
          .filter((packet) => packet.kind === "outcome")
          .map((packet) => packet.observerId));
        for (const agentId of actorIds) {
          if (!observers.has(agentId)) throw new Error(`component transition omitted observation for ${agentId}`);
        }
        if (finalActions.length !== actorIds.length) throw new Error("component transition changed action cardinality");
        transitionCandidate = candidate;
      },
    }, context.modelScope);
    if (!transitionCandidate) throw new Error("component TruthEngine returned no candidate");
    return resolution;
  }

  async step(input: Readonly<WorldStepInput>, context: ExecutionContext): Promise<WorldStepCandidate> {
    const source = structuredClone(input.state);
    const resumedAgentIds = Object.entries(input.policyRoster)
      .filter(([agentId, binding]) => binding.kind === "model" &&
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
        [],
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
    const actions = collectActions(input, preparedActions);
    const groundingResults = await settledValues(actions.map((action) =>
      generateGrounding(
        this.provider,
        source,
        action,
        context.modelScope,
        input.definition.modelProfiles.grounding,
      )), "action grounding");
    const groundings = groundingResults.map((result) => result.grounding);
    let components = conflictComponents(groundings);
    let resolutions: TruthResolution[] = [];
    let rng = structuredClone(source.truth.rng);
    for (const component of components) {
      const resolution = await this.resolveComponent(input, actions, groundings, component, rng, context, false);
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
        input,
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
      )];
    }
    const resolution = mergeResolutions(source, resolutions, input.request.simulatedSeconds);
    const globalObservationAudits: ModelExecutionAudit[] = [];
    if (components.length > 1) {
      const preview = applyTransitionProposal(source, resolution.proposal);
      const rendered = await this.observationRenderer.render({
        definition: input.definition,
        state: source,
        proposal: structuredClone(resolution.proposal),
        actions: structuredClone(resolution.actions),
        observerIds: Object.keys(preview.agents).sort(),
        identityOwner: "step-global-observation",
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
    const candidate = applyTransitionProposal(source, resolution.proposal);
    candidate.truth.rng = structuredClone(resolution.rng);
    const observations = [...resolution.stimulusObservations, ...resolution.proposal.observations];
    validateObservations(candidate, observations, candidate.step);
    const modelAgentIds = Object.keys(candidate.agents)
      .filter((agentId) => !source.agents[agentId] || input.policyRoster[agentId]?.kind === "model")
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
      return thinkWithFallback(candidate, agent, purpose, context, () => this.agentMind.think(
          candidate,
          agent,
          observationsFor(observations, agentId),
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
    const activatedAgents = policyCounts.model ?? 0;
    context.trace.emit({
      event: "algorithm.activation.completed",
      attributes: { phase: "step", policy: "all-model-agents" },
      counts: {
        persistentAgents,
        eligibleAgents: activatedAgents,
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
        ...groundingResults.map((result) => result.audit),
        ...resolution.modelAudits,
        ...resolution.reactionModelAudits,
        ...globalObservationAudits,
        ...outputs.map((output) => output.modelAudit),
      ],
      groundings,
      components,
    };
  }
}
