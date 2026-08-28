import { temporalPlanDraftSchema } from "./llm-schemas";
import type { AgentActionProposal, AgentId, ModelExecutionAudit, SimulationState } from "./model";
import { contentHash } from "./model-audit";
import {
  combineModelExecutionAudits,
  ModelOutputError,
  ModelSemanticRepairError,
  modelInvocationCorrelation,
  modelInvocationIdentity,
  setModelInvocationOutcome,
  setModelInvocationResultKind,
  type ModelExecutionScope,
  type StructuredModelProvider,
} from "./model-provider";
import { runtimeId } from "./runtime-id";
import {
  advanceTemporalState,
  createActivity,
  materializeTemporalPlan,
  type ActivityState,
  type TemporalAdvanceResult,
  type TemporalBoundary,
  type TemporalPlan,
} from "./temporal";

const TEMPORAL_PLANNER_SYSTEM = `你是 Living World Engine 的语义时间计划器。你只能为给定行动选择剧本列出的一个 temporal profile，并说明选择依据。

禁止直接估算、发明或填写任意世界时间。profile basis 不包含秒数；只有当玩家原文明确写出时长时才可使用 explicit_duration，并逐字引用 sourceText。只有当玩家原文明确写出 profile 对应单位的数量时才可使用 explicit_quantity，并逐字引用 sourceText。引擎会独立解析原文并拒绝不一致数值。
不得创建 ID，不得输出状态 delta，不得把未来完成效果写入计划。causes 必须只引用当前行动。只输出 schema 指定的 JSON。`;

const TEMPORAL_PLANNER_PROMPT_VERSION = "temporal-plan-v1";

export interface PlannedTemporalActivity {
  plan: TemporalPlan;
  activity: ActivityState;
  audit: ModelExecutionAudit;
}

export interface TemporalReactionReplacement {
  actorId: AgentId;
  originalActionId: string;
  replacementAction: AgentActionProposal;
  plan: TemporalPlan;
  sourceActivity: ActivityState;
  advancedActivity: ActivityState;
  transition: TemporalAdvanceResult["transitions"][number];
  decisionPoints: TemporalAdvanceResult["decisionPoints"];
}

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

function emitSemanticRejection(
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

export async function planTemporalActivity(
  provider: StructuredModelProvider,
  state: Readonly<SimulationState>,
  action: AgentActionProposal,
  scope: ModelExecutionScope,
  profileId: string,
  invocationOffset = 0,
): Promise<PlannedTemporalActivity> {
  const audits: ModelExecutionAudit[] = [];
  let issues: string[] = [];
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const identity = modelInvocationIdentity(scope, "temporal-planner", action.actorId, invocationOffset + attempt + 1);
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
      emitSemanticRejection(scope, action, identity, issues[0]!);
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

function temporalSchedule(plan: Readonly<TemporalPlan>): unknown {
  const basis = plan.basis.kind === "explicit_duration"
    ? { kind: plan.basis.kind, seconds: plan.basis.seconds }
    : plan.basis.kind === "explicit_quantity"
      ? { kind: plan.basis.kind, amount: plan.basis.amount, unit: plan.basis.unit }
      : plan.basis.kind === "mechanic"
        ? {
            kind: plan.basis.kind,
            durationSeconds: plan.basis.durationSeconds,
            checkpointSeconds: plan.basis.checkpointSeconds,
            progress: structuredClone(plan.basis.progress),
          }
        : { kind: plan.basis.kind };
  return {
    profileId: plan.profileId,
    mode: plan.mode,
    basis,
    startsAtSeconds: plan.startsAtSeconds,
    completionAtSeconds: plan.completionAtSeconds,
    checkpointSeconds: plan.checkpointSeconds,
    progress: structuredClone(plan.progress),
    stages: structuredClone(plan.stages),
    interruptible: plan.interruptible,
    resourceClaims: structuredClone(plan.resourceClaims),
  };
}

export function sameTemporalSchedule(left: Readonly<TemporalPlan>, right: Readonly<TemporalPlan>): boolean {
  return contentHash(temporalSchedule(left)) === contentHash(temporalSchedule(right));
}

export function createTemporalReactionReplacement(input: {
  originalActivity: Readonly<ActivityState>;
  replacementAction: Readonly<AgentActionProposal>;
  generated: Readonly<PlannedTemporalActivity>;
  boundary: Readonly<TemporalBoundary>;
}): TemporalReactionReplacement {
  if (!sameTemporalSchedule(input.originalActivity.plan, input.generated.plan)) {
    throw new Error(`reaction replacement for ${input.replacementAction.actorId} changes the selected temporal schedule`);
  }
  const plan: TemporalPlan = {
    ...structuredClone(input.generated.plan),
    id: input.originalActivity.plan.id,
  };
  const sourceActivity = createActivity({
    id: input.originalActivity.id,
    plan,
    sourceAction: input.replacementAction,
    participantAgentIds: input.originalActivity.participantAgentIds,
  });
  const advanced = advanceTemporalState({
    boundary: {
      ...structuredClone(input.boundary),
      dueTimerIds: [],
      dueConditionIds: [],
    },
    activities: { [sourceActivity.id]: sourceActivity },
    timers: {},
  });
  const advancedActivity = advanced.activities[sourceActivity.id];
  const transition = advanced.transitions[0];
  if (!advancedActivity || !transition) {
    throw new Error(`reaction replacement for ${input.replacementAction.actorId} produced no temporal transition`);
  }
  return {
    actorId: input.replacementAction.actorId,
    originalActionId: input.originalActivity.sourceActionId,
    replacementAction: structuredClone(input.replacementAction),
    plan,
    sourceActivity,
    advancedActivity,
    transition,
    decisionPoints: structuredClone(advanced.decisionPoints),
  };
}

export function applyTemporalReactionReplacements(
  state: Readonly<SimulationState>,
  temporal: Readonly<TemporalAdvanceResult>,
  replacements: readonly TemporalReactionReplacement[],
): { state: SimulationState; temporal: TemporalAdvanceResult } {
  const nextState: SimulationState = structuredClone(state);
  const nextTemporal: TemporalAdvanceResult = structuredClone(temporal);
  for (const replacement of replacements) {
    nextState.truth.activities[replacement.sourceActivity.id] = structuredClone(replacement.sourceActivity);
    nextTemporal.activities[replacement.advancedActivity.id] = structuredClone(replacement.advancedActivity);
    nextTemporal.transitions = [
      ...nextTemporal.transitions.filter((transition) => transition.activityId !== replacement.sourceActivity.id),
      structuredClone(replacement.transition),
    ].sort((left, right) => left.activityId.localeCompare(right.activityId));
    nextTemporal.decisionPoints = [
      ...nextTemporal.decisionPoints.filter((point) => point.activityId !== replacement.sourceActivity.id),
      ...structuredClone(replacement.decisionPoints),
    ].sort((left, right) => left.agentId.localeCompare(right.agentId));
  }
  return { state: nextState, temporal: nextTemporal };
}

export function replaceTemporalPlanning(
  planning: readonly PlannedTemporalActivity[],
  replacements: readonly TemporalReactionReplacement[],
): PlannedTemporalActivity[] {
  const replacementByAction = new Map(replacements.map((replacement) => [replacement.originalActionId, replacement]));
  for (const replacement of replacements) {
    if (!planning.some((result) => result.plan.actionId === replacement.originalActionId)) {
      throw new Error(`reaction replacement for ${replacement.actorId} has no temporal planning slot`);
    }
  }
  return planning.map((result) => {
    const replacement = replacementByAction.get(result.plan.actionId);
    return replacement ? {
      plan: structuredClone(replacement.plan),
      activity: structuredClone(replacement.sourceActivity),
      audit: result.audit,
    } : structuredClone(result);
  });
}
