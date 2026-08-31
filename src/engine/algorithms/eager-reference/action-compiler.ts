import { z } from "zod";
import {
  actionCompilationBatchSchema,
  actionCompilationSlotSchema,
  type ModelCausalAssertion,
} from "../../contracts/llm-schemas";
import {
  actionGroundingSharedContext,
  actionGroundingSlotContext,
  materializeModelInteractionDependency,
  actionGroundingReferenceResolver,
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
import type { AgentActionProposal, CausalAssertion, DiscreteRandomAggregate, ModelExecutionAudit, ModelOutputIssue, SimulationState } from "../../contracts/model";
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
  eligibleTemporalProfiles,
  extractActionTemporalEvidence,
  materializeModelTemporalBasis,
  materializeTemporalPlan,
  type ScheduledActivityState,
  type TemporalPlan,
} from "../../mechanics/temporal";
import { promptBundle } from "../../prompts";
import {
  isProposalReference,
  MODEL_CONTEXT_CONTRACT_VERSION,
  modelRepairIssueFromReferenceError,
  modelRoleContract,
  normalizeModelOutput,
  ModelReferenceError,
  type ModelRepairIssue,
  type ModelReference,
  type ModelReferenceUse,
} from "../../contracts/model-context";
import { contentHash } from "../../models/model-audit";
import { semanticRepairFingerprint } from "../../models/semantic-repair";
import {
  ActionCompilationValidationError,
  validateActionCompilationDraft,
} from "./action-compilation-validation";

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
  previousOutput?: unknown;
}

type CompilationSlot = EagerSlot<CompilationPayload, ModelRepairIssue>;

function compilationIssue(input: {
  code: string;
  reason: string;
  class?: ModelRepairIssue["class"];
  path?: Array<string | number>;
  originalValue?: unknown;
  allowedHandles?: readonly string[];
}): ModelRepairIssue {
  return {
    code: input.code,
    class: input.class ?? "semantic",
    path: [...(input.path ?? [])],
    originalValue: input.originalValue === undefined ? null : structuredClone(input.originalValue),
    allowedHandles: [...(input.allowedHandles ?? [])],
    reason: input.reason,
  };
}

function modelIssuePath(path: readonly PropertyKey[]): Array<string | number> {
  return path.filter((segment): segment is string | number =>
    typeof segment === "string" || typeof segment === "number");
}

function existingActivities(
  state: Readonly<SimulationState>,
  action: Readonly<AgentActionProposal>,
  resolver: ReturnType<typeof actionGroundingReferenceResolver>,
) {
  return Object.values(state.truth.activities)
    .filter((activity): activity is ScheduledActivityState =>
      activity.participantAgentIds.includes(action.actorId) &&
      (activity.status === "active" || activity.status === "paused"))
    .map(({ id, status, plan, progress }) => ({
      activityRef: resolver.handleFor("activity", id),
      status,
      profileRef: resolver.handleFor("temporal_profile", plan.profileId),
      description: plan.description,
      progress,
    }));
}

const MAX_BOUNDED_REPAIR_ALTERNATIVES = 64;

function collectModelHandles(value: unknown, target: Set<string>): void {
  if (typeof value === "string") {
    if (value.startsWith("ref:")) target.add(value);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry) => collectModelHandles(entry, target));
    return;
  }
  if (!value || typeof value !== "object") return;
  Object.values(value as Record<string, unknown>).forEach((entry) => collectModelHandles(entry, target));
}

function actionCompilationRepairResolver(
  resolver: ReturnType<typeof actionGroundingReferenceResolver>,
  slots: readonly CompilationSlot[],
): ReturnType<typeof actionGroundingReferenceResolver> {
  if (slots.every((slot) => slot.issues.length === 0)) return resolver;
  if (slots.some((slot) => slot.issues.some((issue) => issue.class === "structure"))) return resolver;
  const alternatives = slots.flatMap((slot) => slot.issues.flatMap((issue) => issue.allowedHandles));
  if (new Set(alternatives).size > MAX_BOUNDED_REPAIR_ALTERNATIVES) return resolver;

  const includedHandles = new Set(alternatives);
  slots.forEach((slot) => collectModelHandles(slot.payload.previousOutput, includedHandles));
  for (const [slotIndex, slot] of slots.entries()) {
    includedHandles.add(resolver.handleFor("action", slot.payload.action.id));
    includedHandles.add(resolver.handleFor("agent", slot.payload.action.actorId));
    resolver.catalog.candidates
      .filter((candidate) => candidate.slot === slotIndex || candidate.kind === "temporal_profile")
      .forEach((candidate) => includedHandles.add(candidate.handle));
  }
  return resolver.narrow((candidate) =>
    includedHandles.has(resolver.handleFor(candidate.kind, candidate.engineId)));
}

function actionCompilationContext(
  state: Readonly<SimulationState>,
  slots: readonly CompilationSlot[],
  scope: Pick<ModelExecutionScope, "workloadId" | "batchId">,
  batchResolver?: ReturnType<typeof actionGroundingReferenceResolver>,
) {
  const actions = slots.map((slot) => slot.payload.action);
  const slotByActionId = new Map(slots.map((entry, slot) => [entry.payload.action.id, slot]));
  const initialResolver = batchResolver ?? actionGroundingReferenceResolver(state, actions, slotByActionId);
  const shared = actionGroundingSharedContext(state, actions, initialResolver, true);
  const referenceResolver = actionCompilationRepairResolver(shared.referenceResolver, slots);
  const slotContexts = slots.map((entry, slot) => {
    const slotResolver = referenceResolver.scopedToSlot(slot);
    const slotContext = actionGroundingSlotContext(
      state,
      entry.payload.action,
      entry.issues.map((issue) => issue.reason),
      slotResolver,
    );
    const temporalEvidence = extractActionTemporalEvidence(
      entry.payload.action.rawText,
      state.truth.mechanics.temporalProfiles,
    );
    return {
      slot,
      assignment: {
        targetHandles: [slotContext.action.actionRef],
        allowedProposalKinds: [],
      },
      constraints: entry.issues.map((issue) => issue.reason),
      repair: entry.issues.length > 0
        ? {
            fingerprint: semanticRepairFingerprint(entry.issues, MODEL_CONTEXT_CONTRACT_VERSION),
            previousOutput: structuredClone(entry.payload.previousOutput ?? null),
            issues: structuredClone(entry.issues),
          }
        : null,
      state: {
        action: slotContext.action,
        actorPerspective: slotContext.actorPerspective,
        existingActivities: existingActivities(state, entry.payload.action, slotResolver),
        temporalEvidence,
        temporalProfileEligibility: eligibleTemporalProfiles(
          state.truth.mechanics.temporalProfiles,
          temporalEvidence,
        ).map(({ profile, eligibility }) => ({
            profileRef: slotResolver.handleFor("temporal_profile", profile.id),
            ...eligibility,
          }))
          .sort((left, right) => left.profileRef.localeCompare(right.profileRef)),
      },
    };
  });
  return {
    contractVersion: shared.contractVersion,
    roleContract: modelRoleContract("action-compilation"),
    execution: { worldId: state.worldId, instanceId: scope.workloadId, advanceId: scope.batchId, revision: state.revision, step: state.step },
    task: {
      assignment: { targetHandles: [], allowedProposalKinds: [] },
      constraints: slots.flatMap((slot) => slot.issues.map((issue) => issue.reason)),
      slots: slotContexts.map(({ slot, assignment, constraints, repair }) => ({ slot, assignment, constraints, repair })),
    },
    state: {
      currentElapsedSeconds: state.truth.elapsedSeconds,
      temporalProfiles: Object.values(state.truth.mechanics.temporalProfiles)
        .map((profile) => {
          const profileWithoutId = Object.fromEntries(
            Object.entries(profile).filter(([key]) => key !== "id"),
          );
          return profile.kind === "staged"
            ? {
                ...structuredClone(profileWithoutId),
                profileRef: referenceResolver.handleFor("temporal_profile", profile.id),
                stages: profile.stages.map((stage) => Object.fromEntries(
                  Object.entries(stage).filter(([key]) => key !== "id"),
                )),
              }
            : {
                ...structuredClone(profileWithoutId),
                profileRef: referenceResolver.handleFor("temporal_profile", profile.id),
              };
        })
        .sort((left, right) => left.profileRef.localeCompare(right.profileRef)),
      temporalCalibrations: state.truth.mechanics.temporalCalibrations.map((calibration) => ({
        ...structuredClone(Object.fromEntries(
          Object.entries(calibration).filter(([key]) => key !== "id" && key !== "profileId"),
        )),
        profileRef: referenceResolver.handleFor("temporal_profile", calibration.profileId),
      })),
      slots: slotContexts.map(({ slot, state: slotState }) => ({ slot, ...slotState })),
    },
    referenceCatalog: referenceResolver.catalog,
    repair: slots.some((slot) => slot.issues.length > 0)
      ? {
          target: null,
          issues: slots.flatMap((slot, index) => slot.issues.map((issue) => ({
            ...structuredClone(issue),
            path: ["slots", index, ...issue.path],
          }))),
        }
      : null,
  };
}

function jsonUtf8Bytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

function emitActionCompilationContextProjection(
  scope: ModelExecutionScope,
  owner: string,
  identity: ReturnType<typeof modelInvocationIdentity>,
  context: ReturnType<typeof actionCompilationContext>,
): void {
  const candidates = context.referenceCatalog.candidates;
  scope.observer?.emit({
    event: "algorithm.eager_reference.action_compilation_context_projected",
    correlation: modelInvocationCorrelation(scope, "action-compilation", owner, identity),
    attributes: {
      phase: "action-compilation",
      projection: "c2-normalized-complete-catalog",
      repair: context.repair !== null,
    },
    counts: {
      slots: context.state.slots.length,
      candidateHandles: new Set(candidates.map((candidate) => candidate.handle)).size,
      serializedCandidates: candidates.length,
      detailedCandidates: candidates.filter((candidate) => candidate.details !== undefined).length,
      repairIssues: context.repair?.issues.length ?? 0,
      contextUtf8Bytes: jsonUtf8Bytes(context),
      referenceCatalogUtf8Bytes: jsonUtf8Bytes(context.referenceCatalog),
      canonicalTruthUtf8Bytes: 0,
      taskUtf8Bytes: jsonUtf8Bytes(context.task),
    },
  });
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

function actionCompilationRepairIssues(error: unknown): ModelRepairIssue[] {
  const message = errorChainText(error);
  if (message.includes("sharedResourceClaims") && (message.includes("poolId") || message.includes("resourcePoolHandle"))) {
    return [
      compilationIssue({
        code: "reference.shared_resource_pool_required",
        class: "reference",
        path: ["interactionDependency", "sharedResourceClaims"],
        reason: "resourcePoolHandle must be an exact shared-resource-pool handle from referenceCatalog; use [] when no listed pool is justified.",
      }),
    ];
  }
  if (message.includes("action compilation returned") ||
    message.includes("action compilation did not cover")) {
    return [compilationIssue({
      code: "structure.slot_coverage",
      class: "structure",
      path: ["slots"],
      reason: "Return exactly one result for every current slot, numbered contiguously from zero without duplicates.",
    })];
  }
  if (error instanceof EagerSlotAttemptError && error.cause instanceof ModelOutputError) {
    return [compilationIssue({
      code: "structure.batch_schema",
      class: "structure",
      reason: "The previous output failed the structured schema; return the complete current slot batch in schema form.",
    })];
  }
  return [compilationIssue({ code: "action_compilation.invalid_batch", reason: message })];
}

function actionCompilationSlotIssues(error: unknown): ModelRepairIssue[] {
  if (error instanceof ActionCompilationValidationError) {
    return error.issues.map((issue) => structuredClone(issue));
  }
  if (error instanceof ModelReferenceError) {
    return [modelRepairIssueFromReferenceError(error, [])];
  }
  if (error instanceof z.ZodError) {
    const poolIssue = error.issues.find((issue) =>
      issue.path.includes("sharedResourceClaims") && (issue.path.includes("poolId") || issue.path.includes("resourcePoolHandle")));
    if (poolIssue) {
      return [
        compilationIssue({
          code: "reference.shared_resource_pool_required",
          class: "reference",
          path: modelIssuePath(poolIssue.path),
          originalValue: poolIssue.input,
          reason: "resourcePoolHandle must be an exact shared-resource-pool handle from referenceCatalog; use [] when no listed pool is justified.",
        }),
      ];
    }
    return error.issues.map((issue) => compilationIssue({
      code: `structure.${issue.code}`,
      class: "structure",
      path: modelIssuePath(issue.path),
      originalValue: issue.input,
      reason: issue.message,
    }));
  }
  const message = error instanceof Error ? error.message : String(error);
  if (message === "explicit duration is not grounded in the action text") {
    return [
      compilationIssue({
        code: "temporal.duration_evidence_missing",
        class: "mechanic",
        path: ["temporalPlan", "basis"],
        reason: "The action has no exact duration-and-unit span. Select an eligible non-rate profile with profile basis; do not estimate or rewrite evidence.",
      }),
    ];
  }
  if (message === "explicit progress quantity is not grounded in the action text") {
    return [
      compilationIssue({
        code: "temporal.progress_evidence_missing",
        class: "mechanic",
        path: ["temporalPlan", "basis"],
        reason: "The action has no exact progress quantity compatible with the rate profile. Select an eligible non-rate profile; counts are not distance.",
      }),
    ];
  }
  if (message.includes("requires explicit quantity")) {
    return [
      compilationIssue({
        code: "temporal.profile_ineligible",
        class: "mechanic",
        path: ["temporalPlan", "profileRef"],
        reason: "A rate profile requires an exact compatible quantity in action.rawText. Select an eligible non-rate profile when the evidence is absent.",
      }),
    ];
  }
  if (message.includes("requires a continuation assertion")) {
    return [
      compilationIssue({
        code: "temporal.continuation_condition_missing",
        class: "mechanic",
        path: ["temporalPlan", "continuationAssertions"],
        originalValue: [],
        reason: "The selected conditional temporal profile requires at least one continuation assertion grounded in exact catalog handles. Preserve the selected profile and describe the still-pending world condition; do not return an empty array or invent a reference.",
      }),
    ];
  }
  return [compilationIssue({ code: "action_compilation.invalid_slot", reason: message })];
}

function localizedSchemaFailure(
  error: unknown,
  batch: readonly CompilationSlot[],
  state: Readonly<SimulationState>,
  resolver: ReturnType<typeof actionGroundingReferenceResolver>,
): EagerSlotAttemptResult<CompiledAction, CompilationPayload, ModelRepairIssue> | null {
  if (!(error instanceof ModelOutputError) || !error.audit || !error.rawValue || typeof error.rawValue !== "object" ||
    !Array.isArray((error.rawValue as { slots?: unknown }).slots)) return null;
  const rawSlots = (error.rawValue as { slots: unknown[] }).slots;
  const accepted: Array<{ key: string; result: CompiledAction }> = [];
  const rejected: Array<{ slot: CompilationSlot; issues: ModelRepairIssue[] }> = [];
  const rawByIndex = new Map<number, unknown>();
  const duplicateIndexes = new Set<number>();
  rawSlots.forEach((raw, position) => {
    const candidateIndex = raw && typeof raw === "object" && typeof (raw as { slot?: unknown }).slot === "number"
      ? (raw as { slot: number }).slot
      : position;
    if (rawByIndex.has(candidateIndex)) duplicateIndexes.add(candidateIndex);
    rawByIndex.set(candidateIndex, raw);
  });
  const expectedIndexes = new Set(batch.map((_, index) => index));
  if ([...rawByIndex.keys()].some((index) => !expectedIndexes.has(index))) return null;
  for (const [index, slot] of batch.entries()) {
    const raw = rawByIndex.get(index);
    if (raw === undefined || duplicateIndexes.has(index)) {
      rejected.push({
        slot: { ...slot, payload: { ...slot.payload, previousOutput: structuredClone(raw ?? null) } },
        issues: [compilationIssue({
          code: raw === undefined ? "structure.slot_missing" : "structure.slot_duplicated",
          class: "structure",
          path: ["slot"],
          originalValue: raw ?? null,
          reason: `Slot ${index} ${raw === undefined ? "is missing" : "is duplicated"}.`,
        })],
      });
      continue;
    }
    const parsed = actionCompilationSlotSchema.safeParse(raw);
    if (!parsed.success) {
      rejected.push({
        slot: { ...slot, payload: { ...slot.payload, previousOutput: structuredClone(raw) } },
        issues: actionCompilationSlotIssues(parsed.error),
      });
      continue;
    }
    try {
      accepted.push({
        key: slot.key,
        result: materializeCompilation(state, slot.payload.action, parsed.data, resolver.scopedToSlot(index)),
      });
    } catch (materializationError) {
      rejected.push({
        slot: { ...slot, payload: { ...slot.payload, previousOutput: structuredClone(parsed.data) } },
        issues: actionCompilationSlotIssues(materializationError),
      });
    }
  }
  return { audit: error.audit!, accepted, rejected };
}

function actionCompilationAuditIssues(
  rejected: readonly { slot: CompilationSlot; issues: readonly ModelRepairIssue[] }[],
  batch: readonly CompilationSlot[],
): ModelOutputIssue[] {
  return rejected.flatMap(({ slot, issues }) => issues.map((issue) => ({
    code: issue.code,
    class: issue.class,
    path: ["slots", batch.findIndex((entry) => entry.key === slot.key), ...issue.path],
    message: issue.reason,
    originalValue: structuredClone(issue.originalValue),
    allowedHandles: [...issue.allowedHandles],
    targetIds: [slot.key],
  })));
}

function materializeCompilation(
  state: Readonly<SimulationState>,
  action: AgentActionProposal,
  draft: ActionCompilationDraft,
  resolver = actionGroundingReferenceResolver(state, action),
): CompiledAction {
  if (isProposalReference(draft.temporalPlan.profileRef)) {
    throw new Error(`temporal plan profile cannot use proposalKey ${draft.temporalPlan.profileRef.proposalKey}`);
  }
  const profileId = resolver.resolve(draft.temporalPlan.profileRef, "profile").engineId;
  const profile = state.truth.mechanics.temporalProfiles[profileId];
  if (!profile) throw new Error(`unknown temporal profile ${profileId}`);
  const temporalEvidence = extractActionTemporalEvidence(action.rawText, state.truth.mechanics.temporalProfiles);
  const profileEligibility = eligibleTemporalProfiles(state.truth.mechanics.temporalProfiles, temporalEvidence);
  const fieldIssues = validateActionCompilationDraft({
    draft,
    resolver,
    eligibleProfileHandles: new Set(profileEligibility
      .filter((entry) => entry.eligibility.eligible)
      .map((entry) => resolver.handleFor("temporal_profile", entry.profile.id))),
    ineligibleProfileReasons: new Map(profileEligibility
      .filter((entry) => !entry.eligibility.eligible && entry.eligibility.rejectionCode !== null)
      .map((entry) => [
        resolver.handleFor("temporal_profile", entry.profile.id),
        entry.eligibility.rejectionCode!,
      ])),
    conditionalProfileHandles: new Set(Object.values(state.truth.mechanics.temporalProfiles)
      .filter((entry) => entry.kind === "conditional")
      .map((entry) => resolver.handleFor("temporal_profile", entry.id))),
  });
  if (fieldIssues.length > 0) throw new ActionCompilationValidationError(fieldIssues);
  const resolveCause = (cause: ActionCompilationDraft["temporalPlan"]["causes"][number]) => {
    if (isProposalReference(cause.ref)) throw new Error(`temporal plan cause cannot use proposalKey ${cause.ref.proposalKey}`);
    return { kind: cause.kind, id: resolver.resolve(cause.ref, "cause").engineId } as const;
  };
  const resolveAssertion = (assertion: ModelCausalAssertion): CausalAssertion => {
    const resolve = (reference: ModelReference, use: ModelReferenceUse) => {
      if (isProposalReference(reference)) throw new Error(`temporal continuation assertion cannot use proposalKey ${reference.proposalKey}`);
      return resolver.resolve(reference, use).engineId;
    };
    switch (assertion.kind) {
      case "check_result": return { kind: assertion.kind, checkId: resolve(assertion.checkRef, "assertion"), expected: assertion.expected };
      case "random_result": return { kind: assertion.kind, requestId: resolve(assertion.requestRef, "assertion"), stepId: resolve(assertion.stepRef, "assertion"), expected: structuredClone(assertion.expected) as DiscreteRandomAggregate };
      case "fact_matches": return { kind: assertion.kind, factId: resolve(assertion.factRef, "assertion"), expected: structuredClone(assertion.expected) as never };
      case "fact_absent": return { kind: assertion.kind, factId: resolve(assertion.factRef, "assertion") };
      case "entity_absent": return { kind: assertion.kind, entityId: resolve(assertion.entityRef, "assertion") };
      case "entity_lifecycle": return { kind: assertion.kind, entityId: resolve(assertion.entityRef, "assertion"), expected: assertion.expected };
      case "placement_equals": return { kind: assertion.kind, entityId: resolve(assertion.entityRef, "assertion"), placementId: assertion.placementRef === null ? null : resolve(assertion.placementRef, "assertion") };
      case "shared_placement": return { kind: assertion.kind, leftEntityId: resolve(assertion.leftEntityRef, "assertion"), rightEntityId: resolve(assertion.rightEntityRef, "assertion") };
      case "meter_compare": return { kind: assertion.kind, meterId: resolve(assertion.meterRef, "assertion"), operator: assertion.operator, value: assertion.value };
      case "quantity_compare": {
        const quantityId = resolve(assertion.quantityRef, "assertion");
        const quantity = state.truth.quantities[quantityId];
        if (!quantity) throw new Error(`quantity assertion references unknown quantity ${quantityId}`);
        return { kind: assertion.kind, definitionId: quantity.definitionId, holderId: quantity.holderId, operator: assertion.operator, value: assertion.value };
      }
      case "rating_compare": return { kind: assertion.kind, ratingId: resolve(assertion.ratingRef, "assertion"), operator: assertion.operator, value: assertion.value };
      case "shared_resource_capacity_compare": return { kind: assertion.kind, poolId: resolve(assertion.poolRef, "assertion"), operator: assertion.operator, value: assertion.value };
      case "elapsed_seconds_compare": return { kind: assertion.kind, operator: assertion.operator, value: assertion.value };
    }
    throw new Error(`unsupported continuation assertion ${String((assertion as { kind?: unknown }).kind)}`);
  };
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
      profileId,
      basis: materializeModelTemporalBasis(profile, draft.temporalPlan.basis, temporalEvidence),
      causes: draft.temporalPlan.causes.map(resolveCause),
      continuationAssertions: draft.temporalPlan.continuationAssertions.map(resolveAssertion),
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
    dependency: materializeModelInteractionDependency(
      state,
      action,
      draft.interactionDependency,
      resolver,
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
  repairAttempts = 2,
): Promise<ActionCompilationResult> {
  if (actions.length === 0) {
    return {
      compilations: [],
      modelAudits: [],
      batchCount: 0,
      metrics: { submittedSlots: 0, repairCalls: 0, repeatedFingerprints: 0, splitCount: 0, partialFailureSlots: 0, singletonFailures: 0 },
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
      actionCompilationContext(state, batch, scope),
      actionCompilationBatchSchema,
    ),
    label: "action compilation",
    issuesForError: actionCompilationRepairIssues,
    issueFingerprint: (issue) => semanticRepairFingerprint([issue], MODEL_CONTEXT_CONTRACT_VERSION),
    maxRepairs: repairAttempts,
    invoke: async (batch, attempt) => {
      const owner = eagerSlotBatchOwner("action-compilation", batch);
      const identity = modelInvocationIdentity(scope, "action-compilation", owner, attempt + 1);
      const slotByActionId = new Map(batch.map((entry, slot) => [entry.payload.action.id, slot]));
      const baseResolver = actionGroundingReferenceResolver(
        state,
        batch.map((entry) => entry.payload.action),
        slotByActionId,
      );
      const fullBatchResolver = actionGroundingSharedContext(
        state,
        batch.map((entry) => entry.payload.action),
        baseResolver,
        true,
      ).referenceResolver;
      const batchResolver = actionCompilationRepairResolver(fullBatchResolver, batch);
      const context = actionCompilationContext(state, batch, scope, fullBatchResolver);
      emitActionCompilationContextProjection(scope, owner, identity, context);
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
          context,
          schema: actionCompilationBatchSchema,
        });
        assertSlotCoverage(batch, generated.value.slots);
      } catch (error) {
        if (isTerminalEagerModelError(error)) throw error;
        const localized = localizedSchemaFailure(error, batch, state, batchResolver);
        if (localized) {
          setModelInvocationResultKind(localized.audit, "action_compilation_batch");
          if (localized.rejected.length === 0) setModelInvocationOutcome(localized.audit, "accepted");
          else setModelInvocationOutcome(
            localized.audit,
            "rejected",
            actionCompilationAuditIssues(localized.rejected, batch),
          );
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
      const rejected: Array<{ slot: CompilationSlot; issues: ModelRepairIssue[] }> = [];
      const normalizedSlots: Array<{ slot: number; result: unknown }> = [];
      let modifiedFieldCount = 0;
      let resolvedReferenceCount = 0;
      let proposalCount = 0;
      let deduplicatedCount = 0;
      const ordered = [...generated.value.slots].sort((left, right) => left.slot - right.slot);
      for (const [index, draft] of ordered.entries()) {
        const slot = batch[index]!;
        try {
          // The physical batch has one catalog. Resolution is scoped to the
          // output slot so a private candidate from another slot is rejected
          // before domain materialization.
          const slotResolver = batchResolver.scopedToSlot(index);
          const normalized = normalizeModelOutput(draft, { resolver: slotResolver, dedupeArrays: true });
          modifiedFieldCount += normalized.modifiedFieldCount;
          resolvedReferenceCount += normalized.resolvedReferenceCount;
          proposalCount += normalized.proposalCount;
          deduplicatedCount += normalized.deduplicatedCount;
          normalizedSlots.push({ slot: draft.slot, result: normalized.value });
          if (normalized.issues.length > 0) {
            rejected.push({
              slot: { ...slot, payload: { ...slot.payload, previousOutput: structuredClone(draft) } },
              issues: normalized.issues,
            });
            const invocationAudit = generated.audit.invocations.at(-1);
            if (invocationAudit) {
              invocationAudit.issues = [
                ...invocationAudit.issues,
                ...normalized.issues.map((issue) => ({
                  code: issue.code,
                  class: issue.class,
                  path: [...issue.path],
                  message: issue.reason,
                  originalValue: structuredClone(issue.originalValue),
                  allowedHandles: [...issue.allowedHandles],
                })),
              ].filter((issue, issueIndex, all) => all.findIndex((candidate) =>
                candidate.code === issue.code && JSON.stringify(candidate.path) === JSON.stringify(issue.path) &&
                candidate.message === issue.message) === issueIndex);
            }
            continue;
          }
          accepted.push({
            key: slot.key,
            result: materializeCompilation(state, slot.payload.action, normalized.value, slotResolver),
          });
        } catch (error) {
          rejected.push({
            slot: { ...slot, payload: { ...slot.payload, previousOutput: structuredClone(draft) } },
            issues: actionCompilationSlotIssues(error),
          });
        }
      }
      const invocationAudit = generated.audit.invocations.at(-1);
      if (invocationAudit) {
        invocationAudit.rawOutputHash ??= contentHash(generated.value);
        invocationAudit.normalizedOutputHash = contentHash({ slots: normalizedSlots });
        invocationAudit.normalization = {
          applied: modifiedFieldCount > 0 || deduplicatedCount > 0,
          modifiedFieldCount,
          resolvedReferenceCount,
          proposalCount,
          deduplicatedCount,
        };
        if (rejected.length === 0) {
          invocationAudit.outputDisposition = invocationAudit.normalization.applied ? "auto-normalized" : "accepted";
        }
        scope.observer?.emit({
          event: "model.output.normalized",
          correlation: modelInvocationCorrelation(scope, "action-compilation", owner, identity),
          attributes: { applied: invocationAudit.normalization.applied },
          counts: {
            modifiedFields: modifiedFieldCount,
            resolvedReferences: resolvedReferenceCount,
            proposals: proposalCount,
            deduplicated: deduplicatedCount,
          },
          hashes: {
            rawOutput: invocationAudit.rawOutputHash,
            normalizedOutput: invocationAudit.normalizedOutputHash,
          },
        });
      }
      setModelInvocationResultKind(generated.audit, "action_compilation_batch");
      if (rejected.length === 0) {
        setModelInvocationOutcome(generated.audit, "accepted");
      } else {
        setModelInvocationOutcome(
          generated.audit,
          "rejected",
          actionCompilationAuditIssues(rejected, batch),
        );
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
