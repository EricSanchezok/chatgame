import { z } from "zod";
import {
  actionCompilationBatchSchema,
  actionCompilationSlotSchema,
} from "../../contracts/llm-schemas";
import {
  actionGroundingSharedContext,
  actionGroundingSlotContext,
  materializeInteractionDependency,
} from "../../mechanics/action-dependency";
import {
  eagerRequestBytes,
  eagerSlotBatchOwner,
  EagerSlotAttemptError,
  isTerminalEagerModelError,
  runEagerSlotBatches,
  type EagerSlot,
  type EagerSlotAttemptResult,
  type EagerSlotBatchMetrics,
} from "./eager-slot-batching";
import type { ActionCompilationDraft, InteractionDependency } from "../../runtime/execution";
import type { AgentActionProposal, ModelExecutionAudit, SimulationState } from "../../contracts/model";
import {
  ModelOutputError,
  ModelSemanticRepairError,
  modelInvocationCorrelation,
  modelInvocationIdentity,
  setModelInvocationOutcome,
  setModelInvocationResultKind,
  type ModelExecutionScope,
  type StructuredModelProvider,
} from "../../models/model-provider";
import { runtimeId } from "../../runtime/runtime-id";
import {
  createActivity,
  materializeTemporalPlan,
  type ScheduledActivityState,
  type TemporalPlan,
} from "../../mechanics/temporal";
import { promptBundle } from "../../prompts";

const ACTION_COMPILER_PROMPT = promptBundle("action-compilation");

export interface CompiledAction {
  plan: TemporalPlan;
  activity: ScheduledActivityState;
  dependency: InteractionDependency;
}

export interface ActionCompilationResult {
  compilations: CompiledAction[];
  modelAudits: ModelExecutionAudit[];
  batchCount: number;
  metrics: EagerSlotBatchMetrics;
}

export type PlannedTemporalActivity = Pick<CompiledAction, "plan" | "activity">;

interface CompilationPayload {
  action: AgentActionProposal;
}

type CompilationSlot = EagerSlot<CompilationPayload, string>;

function existingActivities(state: Readonly<SimulationState>, action: Readonly<AgentActionProposal>) {
  return Object.values(state.truth.activities)
    .filter((activity): activity is ScheduledActivityState =>
      activity.participantAgentIds.includes(action.actorId) &&
      (activity.status === "active" || activity.status === "paused"))
    .map(({ id, status, plan, progress }) => ({
      id,
      status,
      profileId: plan.profileId,
      description: plan.description,
      progress,
    }));
}

function actionCompilationContext(
  state: Readonly<SimulationState>,
  slots: readonly CompilationSlot[],
) {
  const shared = actionGroundingSharedContext(state);
  return {
    contractVersion: shared.contractVersion,
    promptVersion: ACTION_COMPILER_PROMPT.version,
    currentElapsedSeconds: state.truth.elapsedSeconds,
    temporalProfiles: Object.values(state.truth.mechanics.temporalProfiles)
      .map((profile) => structuredClone(profile))
      .sort((left, right) => left.id.localeCompare(right.id)),
    temporalCalibrations: structuredClone(state.truth.mechanics.temporalCalibrations)
      .sort((left, right) => left.id.localeCompare(right.id)),
    canonicalCatalog: shared.canonicalCatalog,
    slots: slots.map((entry, slot) => ({
      slot,
      ...actionGroundingSlotContext(state, entry.payload.action, entry.issues),
      existingActivities: existingActivities(state, entry.payload.action),
    })),
  };
}

function assertSlotCoverage(
  slots: readonly CompilationSlot[],
  drafts: readonly (ActionCompilationDraft & { slot: number })[],
): void {
  if (drafts.length !== slots.length) {
    throw new Error(`action compilation returned ${drafts.length} items for ${slots.length} slots`);
  }
  const indexes = drafts.map((draft) => draft.slot).sort((left, right) => left - right);
  if (indexes.some((slot, index) => slot !== index)) {
    throw new Error("action compilation did not cover every slot exactly once");
  }
}

function errorChainText(error: unknown): string {
  const messages: string[] = [];
  const seen = new Set<unknown>();
  let cursor = error;
  while (cursor && !seen.has(cursor)) {
    seen.add(cursor);
    messages.push(cursor instanceof Error ? cursor.message : String(cursor));
    cursor = cursor instanceof Error ? cursor.cause : undefined;
  }
  return messages.join("\n");
}

function actionCompilationRepairIssues(error: unknown): string[] {
  const message = errorChainText(error);
  if (message.includes("sharedResourceClaims") && message.includes("poolId")) {
    return [
      "sharedResourceClaims.poolId 必须原样复制 canonicalCatalog.sharedActivityResourcePools[].id；目录为空或无明确匹配时输出 []，不得把 default 或 definitionId 当作 poolId。",
    ];
  }
  if (message.includes("action compilation returned") ||
    message.includes("action compilation did not cover")) {
    return ["输出必须恰好覆盖当前输入的每个 slot：数量相同，slot 从 0 连续编号，不得重复或遗漏。"];
  }
  if (error instanceof EagerSlotAttemptError && error.cause instanceof ModelOutputError) {
    return ["上一次输出未通过结构化 schema 验证；请严格按 schema 返回当前所有 slot。"];
  }
  return [message.slice(0, 500)];
}

function actionCompilationSlotIssues(error: unknown): string[] {
  if (error instanceof z.ZodError) {
    const poolIssue = error.issues.find((issue) =>
      issue.path.includes("sharedResourceClaims") && issue.path.includes("poolId"));
    if (poolIssue) {
      return [
        "sharedResourceClaims.poolId 必须原样复制 canonicalCatalog.sharedActivityResourcePools[].id；目录为空或无明确匹配时输出 []，不得把 default 或 definitionId 当作 poolId。",
      ];
    }
  }
  const message = error instanceof Error ? error.message : String(error);
  if (message === "explicit duration is not grounded in the action text") {
    return [
      "action.rawText 没有可逐字复制的数字时长与单位；改选非 rate temporal profile 并使用 {\"kind\":\"profile\"}，不得估算时长或改写 sourceText。",
    ];
  }
  if (message === "explicit progress quantity is not grounded in the action text") {
    return [
      "action.rawText 没有可逐字复制的数字距离与 rate profile 单位；改选非 rate temporal profile 并使用 {\"kind\":\"profile\"}，不得把人数、物品数、地点数或轮次当作距离。",
    ];
  }
  if (message.includes("requires explicit quantity")) {
    return [
      "rate temporal profile 只能用 action.rawText 中明写的数字距离和相同单位；如果原文没有，改选非 rate profile 并使用 {\"kind\":\"profile\"}。",
    ];
  }
  return [message];
}

function localizedSchemaFailure(
  error: unknown,
  batch: readonly CompilationSlot[],
  state: Readonly<SimulationState>,
): EagerSlotAttemptResult<CompiledAction, CompilationPayload, string> | null {
  if (!(error instanceof ModelOutputError) || !error.audit || !error.rawValue || typeof error.rawValue !== "object" ||
    !Array.isArray((error.rawValue as { slots?: unknown }).slots)) return null;
  const rawSlots = (error.rawValue as { slots: unknown[] }).slots;
  const accepted: Array<{ key: string; result: CompiledAction }> = [];
  const rejected: Array<{ slot: CompilationSlot; issues: string[] }> = [];
  const rawByIndex = new Map<number, unknown>();
  const duplicateIndexes = new Set<number>();
  rawSlots.forEach((raw, position) => {
    const candidateIndex = raw && typeof raw === "object" && typeof (raw as { slot?: unknown }).slot === "number"
      ? (raw as { slot: number }).slot
      : position;
    if (rawByIndex.has(candidateIndex)) duplicateIndexes.add(candidateIndex);
    rawByIndex.set(candidateIndex, raw);
  });
  for (const [index, slot] of batch.entries()) {
    const raw = rawByIndex.get(index);
    if (raw === undefined || duplicateIndexes.has(index)) {
      rejected.push({
        slot,
        issues: [`slot ${index} 未通过结构化 schema：${raw === undefined ? "slot missing" : "slot duplicated"}`],
      });
      continue;
    }
    const parsed = actionCompilationSlotSchema.safeParse(raw);
    if (!parsed.success) {
      rejected.push({
        slot,
        issues: actionCompilationSlotIssues(parsed.error),
      });
      continue;
    }
    try {
      accepted.push({
        key: slot.key,
        result: materializeCompilation(state, slot.payload.action, parsed.data),
      });
    } catch (materializationError) {
      rejected.push({ slot, issues: actionCompilationSlotIssues(materializationError) });
    }
  }
  return { audit: error.audit!, accepted, rejected };
}

function materializeCompilation(
  state: Readonly<SimulationState>,
  action: AgentActionProposal,
  draft: ActionCompilationDraft,
): CompiledAction {
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
      ...structuredClone(draft.temporalPlan),
      causes: [{ kind: "action", id: action.id }],
    },
    profiles: state.truth.mechanics.temporalProfiles,
  });
  return {
    plan,
    activity: createActivity({
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
    }),
    dependency: materializeInteractionDependency(
      state,
      action,
      draft.interactionDependency,
    ),
  };
}

function emitSemanticRejection(
  scope: ModelExecutionScope,
  owner: string,
  identity: ReturnType<typeof modelInvocationIdentity>,
  message: string,
  slots: number,
): void {
  scope.observer?.emit({
    event: "model.semantic.rejected",
    level: "warn",
    correlation: modelInvocationCorrelation(scope, "action-compilation", owner, identity),
    attributes: { resultKind: "action_compilation_batch" },
    counts: { validationIssues: slots },
    error: { name: "ActionCompilationError", message },
  });
}

export async function compileActions(
  provider: StructuredModelProvider,
  state: Readonly<SimulationState>,
  actions: readonly AgentActionProposal[],
  scope: ModelExecutionScope,
  profileId: string,
  maxSlots: number,
): Promise<ActionCompilationResult> {
  if (actions.length === 0) {
    return {
      compilations: [],
      modelAudits: [],
      batchCount: 0,
      metrics: { submittedSlots: 0, repairCalls: 0, splitCount: 0, partialFailureSlots: 0, singletonFailures: 0 },
    };
  }
  const slots: CompilationSlot[] = [...actions]
    .sort((left, right) => left.actorId.localeCompare(right.actorId) || left.id.localeCompare(right.id))
    .map((action) => ({ key: action.id, payload: { action }, issues: [] }));
  const maxInputBytes = provider.catalog.profile(profileId).max_input_bytes;
  const result = await runEagerSlotBatches({
    slots,
    maxSlots,
    maxInputBytes,
    requestBytes: (batch) => eagerRequestBytes(
      ACTION_COMPILER_PROMPT.system,
      ACTION_COMPILER_PROMPT.userPrompt,
      actionCompilationContext(state, batch),
      actionCompilationBatchSchema,
    ),
    label: "action compilation",
    issuesForError: actionCompilationRepairIssues,
    invoke: async (batch, attempt) => {
      const owner = eagerSlotBatchOwner("action-compilation", batch);
      const identity = modelInvocationIdentity(scope, "action-compilation", owner, attempt + 1);
      let generated;
      try {
        generated = await provider.generateStructured({
          profileId,
          workloadId: scope.workloadId,
          batchId: scope.batchId,
          abortSignal: scope.abortSignal,
          correlation: scope.correlation,
          observer: scope.observer,
          ...identity,
          role: "action-compilation",
          subjectId: owner,
          promptVersion: ACTION_COMPILER_PROMPT.version,
          schemaName: "action_compilation_batch",
          system: ACTION_COMPILER_PROMPT.system,
          userPrompt: ACTION_COMPILER_PROMPT.userPrompt,
          context: actionCompilationContext(state, batch),
          schema: actionCompilationBatchSchema,
        });
        assertSlotCoverage(batch, generated.value.slots);
      } catch (error) {
        if (isTerminalEagerModelError(error)) throw error;
        const localized = localizedSchemaFailure(error, batch, state);
        if (localized) {
          setModelInvocationResultKind(localized.audit, "action_compilation_batch");
          if (localized.rejected.length === 0) setModelInvocationOutcome(localized.audit, "accepted");
          else setModelInvocationOutcome(localized.audit, "rejected", ["invalid_action_compilation_slot"]);
          emitSemanticRejection(
            scope,
            owner,
            identity,
            `action compilation localized ${localized.rejected.length} slot failure(s)`,
            localized.rejected.length,
          );
          return localized;
        }
        const audit = error && typeof error === "object" && "audit" in error
          ? (error as { audit?: ModelExecutionAudit }).audit
          : generated?.audit;
        if (audit?.invocations.length) {
          setModelInvocationOutcome(audit, "rejected", ["invalid_action_compilation_batch"]);
        }
        emitSemanticRejection(
          scope,
          owner,
          identity,
          error instanceof Error ? error.message : String(error),
          batch.length,
        );
        throw new EagerSlotAttemptError(
          error instanceof Error ? error.message : String(error),
          audit,
          { cause: error },
        );
      }

      const accepted: Array<{ key: string; result: CompiledAction }> = [];
      const rejected: Array<{ slot: CompilationSlot; issues: string[] }> = [];
      const ordered = [...generated.value.slots].sort((left, right) => left.slot - right.slot);
      for (const [index, draft] of ordered.entries()) {
        const slot = batch[index]!;
        try {
          accepted.push({
            key: slot.key,
            result: materializeCompilation(state, slot.payload.action, draft),
          });
        } catch (error) {
          rejected.push({ slot, issues: actionCompilationSlotIssues(error) });
        }
      }
      setModelInvocationResultKind(generated.audit, "action_compilation_batch");
      if (rejected.length === 0) {
        setModelInvocationOutcome(generated.audit, "accepted");
      } else {
        setModelInvocationOutcome(generated.audit, "rejected", ["invalid_action_compilation_slot"]);
        emitSemanticRejection(
          scope,
          owner,
          identity,
          `action compilation rejected ${rejected.length} slot(s)`,
          rejected.length,
        );
      }
      return { audit: generated.audit, accepted, rejected };
    },
  });
  if (result.failures.length > 0) {
    const failure = result.failures[0]!;
    const action = failure.slot.payload.action;
    throw new ModelSemanticRepairError(
      "action-compilation",
      `action compilation failed after repairs for ${action.actorId}: ${
        failure.error instanceof Error ? failure.error.message : String(failure.error)
      }`,
      { cause: failure.error, audit: failure.audit },
    );
  }
  return {
    compilations: actions.map((action) => {
      const compilation = result.results.get(action.id);
      if (!compilation) throw new Error(`action compilation omitted ${action.id}`);
      return compilation;
    }),
    modelAudits: result.audits,
    batchCount: result.batchCount,
    metrics: result.metrics,
  };
}
