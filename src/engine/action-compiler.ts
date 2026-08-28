import { actionCompilationSchema } from "./llm-schemas";
import {
  actionGroundingContext,
  INTERACTION_DEPENDENCY_INSTRUCTIONS,
  materializeInteractionDependency,
} from "./action-dependency";
import type { InteractionDependency } from "./execution";
import type { AgentActionProposal, ModelExecutionAudit, SimulationState } from "./model";
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
  createActivity,
  materializeTemporalPlan,
  type ScheduledActivityState,
  type TemporalPlan,
} from "./temporal";

const ACTION_COMPILER_SYSTEM = `你是 Living World Engine 的行动编译器。你要在一次响应中为给定行动完成两个互相独立的语义任务：选择时间计划，并声明保守的 canonical 交互依赖。

时间计划只能选择剧本列出的一个 temporal profile，并说明选择依据。禁止直接估算、发明或填写任意世界时间。profile basis 不包含秒数；只有当行动原文明确写出时长时才可使用 explicit_duration，并逐字引用 sourceText。只有当行动原文明确写出 profile 对应单位的数量时才可使用 explicit_quantity，并逐字引用 sourceText。引擎会独立解析原文并拒绝不一致数值。不得把未来完成效果写入计划，causes 必须只引用当前行动。

交互依赖部分遵守以下契约：
${INTERACTION_DEPENDENCY_INSTRUCTIONS}

不得创建 ID，不得输出状态修改、行动结果或叙事。行动与 actor 身份由调用槽位固定，不要输出。两部分都会由引擎分别验证，任一部分无效都会拒绝整个响应。只输出 schema 指定的 JSON。`;

const ACTION_COMPILER_PROMPT_VERSION = "action-compilation-v1";

export interface CompiledAction {
  plan: TemporalPlan;
  activity: ScheduledActivityState;
  dependency: InteractionDependency;
  audit: ModelExecutionAudit;
}

export type PlannedTemporalActivity = Pick<CompiledAction, "plan" | "activity">;

function actionCompilationContext(
  state: Readonly<SimulationState>,
  action: AgentActionProposal,
  issues: readonly string[],
) {
  return {
    ...actionGroundingContext(state, action, issues),
    currentElapsedSeconds: state.truth.elapsedSeconds,
    temporalProfiles: Object.values(state.truth.mechanics.temporalProfiles)
      .map((profile) => structuredClone(profile))
      .sort((left, right) => left.id.localeCompare(right.id)),
    temporalCalibrations: structuredClone(state.truth.mechanics.temporalCalibrations)
      .sort((left, right) => left.id.localeCompare(right.id)),
    existingActivities: Object.values(state.truth.activities)
      .filter((activity): activity is ScheduledActivityState =>
        activity.participantAgentIds.includes(action.actorId) &&
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
    correlation: modelInvocationCorrelation(scope, "action-compilation", action.actorId, identity),
    attributes: { resultKind: "action_compilation" },
    error: { name: "ActionCompilationError", message },
  });
}

export async function compileAction(
  provider: StructuredModelProvider,
  state: Readonly<SimulationState>,
  action: AgentActionProposal,
  scope: ModelExecutionScope,
  profileId: string,
  invocationOffset = 0,
): Promise<CompiledAction> {
  const audits: ModelExecutionAudit[] = [];
  let issues: string[] = [];
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const identity = modelInvocationIdentity(
      scope,
      "action-compilation",
      action.actorId,
      invocationOffset + attempt + 1,
    );
    try {
      const generated = await provider.generateStructured({
        profileId,
        workloadId: scope.workloadId,
        batchId: scope.batchId,
        abortSignal: scope.abortSignal,
        correlation: scope.correlation,
        observer: scope.observer,
        ...identity,
        role: "action-compilation",
        subjectId: action.actorId,
        promptVersion: ACTION_COMPILER_PROMPT_VERSION,
        schemaName: "action_compilation",
        system: ACTION_COMPILER_SYSTEM,
        context: actionCompilationContext(state, action, issues),
        schema: actionCompilationSchema,
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
          ...structuredClone(generated.value.temporalPlan),
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
      const dependency = materializeInteractionDependency(
        state,
        action,
        generated.value.interactionDependency,
        scope,
      );
      setModelInvocationResultKind(generated.audit, "action_compilation");
      setModelInvocationOutcome(generated.audit, "accepted");
      return {
        plan,
        activity,
        dependency,
        audit: combineModelExecutionAudits(audits),
      };
    } catch (error) {
      if (error instanceof ModelOutputError && error.audit) audits.push(error.audit);
      issues = [error instanceof Error ? error.message : String(error)];
      const last = audits.at(-1);
      if (last?.invocations.length) {
        setModelInvocationOutcome(last, "rejected", ["invalid_action_compilation"]);
      }
      emitSemanticRejection(scope, action, identity, issues[0]!);
      if (attempt === 2) {
        throw new ModelSemanticRepairError(
          "action-compilation",
          `action compilation failed after repairs for ${action.actorId}: ${issues[0]}`,
          { cause: error, audit: audits.length > 0 ? combineModelExecutionAudits(audits) : undefined },
        );
      }
    }
  }
  throw new Error("unreachable action compilation loop");
}
