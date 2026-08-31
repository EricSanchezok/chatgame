import { canonicalize, contentHash, measureModelContext } from "../models/model-audit";
import { parseModelCatalog, type ModelCatalog } from "../models/model-catalog";
import {
  MODELS_DEV_API_URL,
  type ModelRegistryService,
  type ModelRegistrySnapshot,
} from "../models/model-registry";
import type {
  StructuredModelProvider,
  StructuredModelRequest,
  StructuredModelResult,
} from "../models/model-provider";
import type { ModelExecutionAudit } from "../contracts/model";
import { ContextLimitExceededError, modelInvocationIdentity, ModelOutputError } from "../models/model-provider";
import type { ActionCompilationDraft, FootprintRef } from "../runtime/execution";
import type { AgentMindDraftOutput } from "../contracts/llm-schemas";
import { structuredPromptBytes } from "../prompts";
import { referenceHandleFor, type ExistingReferenceHandle } from "../contracts/model-context";

const TEST_PROFILE_IDS = [
  "truth-engine",
  "agent-default",
  "truth-deepseek",
  "agent-deepseek",
  "agent-openai",
  "agent-xai",
];

export function createTestModelCatalog(
  profileIds: readonly string[] = TEST_PROFILE_IDS,
  options: { maxInputBytes?: number } = {},
): ModelCatalog {
  return parseModelCatalog({
    schema_version: 3,
    scheduler: {
      global_concurrency: 16,
      max_queued_requests: 1024,
      queue_timeout_ms: 300_000,
    },
    registry: {
      refresh_interval_ms: 3_600_000,
      request_timeout_ms: 10_000,
      stale_after_ms: 86_400_000,
    },
    accounts: {
      "scripted-test": {
        channel: "api",
        region: "test",
        protocol: "openai-chat",
        dialect: "deepseek",
        models_dev_provider_id: "scripted-test",
        base_url: "https://test.invalid",
        api_key_env: "TEST_MODEL_API_KEY",
        max_concurrency: 16,
      },
    },
    profiles: Object.fromEntries(profileIds.map((profileId) => [profileId, {
      account_id: "scripted-test",
      selector: { kind: "exact", model_id: `scripted:${profileId}` },
      description: `Deterministic test profile ${profileId}`,
      allowed_roles: profileId.startsWith("truth-") || profileId === "truth-engine"
        ? [
            "truth-perception",
            "truth-reaction-routing",
            "truth-resolution",
            "truth-transition",
            "action-compilation",
            "action-grounding",
            "observation-renderer",
            "causal-verifier",
            "arrival-generator",
          ]
        : ["agent-bootstrap", "agent-mind", "agent-reaction"],
      request_timeout_ms: 10_000,
      max_output_tokens: 32_768,
      max_input_bytes: options.maxInputBytes ?? 262_144,
      inference: {
        thinking: "auto",
        effort: "auto",
        reasoning_budget_tokens: "auto",
        reasoning_summary: "auto",
        text_verbosity: "auto",
        temperature: "auto",
        top_p: "auto",
      },
    }])),
    model_overrides: {},
  });
}

export function createTestModelRegistrySnapshot(catalog: ModelCatalog): ModelRegistrySnapshot {
  const providers: ModelRegistrySnapshot["document"]["providers"] = {};
  for (const [profileId, profile] of Object.entries(catalog.profiles)) {
    const account = catalog.account(profile.account_id);
    const provider = providers[account.models_dev_provider_id] ??= {
      id: account.models_dev_provider_id,
      name: `Test provider ${account.models_dev_provider_id}`,
      models: {},
    };
    const modelId = profile.selector.kind === "exact"
      ? profile.selector.model_id
      : `test-latest:${profileId}`;
    provider.models[modelId] = {
      id: modelId,
      name: modelId,
      family: "test",
      status: null,
      disabled: false,
      reasoning: true,
      reasoningToggle: true,
      reasoningEfforts: ["none", "minimal", "low", "medium", "high", "xhigh", "max"],
      reasoningBudget: { min: 1, max: 1_000_000 },
      toolCall: true,
      structuredOutput: true,
      temperature: true,
      releaseDate: "2026-01-01",
      lastUpdated: "2026-01-01",
      modalities: { input: ["text"], output: ["text"] },
      limit: { context: 1_000_000, output: 1_000_000 },
      fieldSources: {},
    };
  }
  const document: ModelRegistrySnapshot["document"] = {
    schemaVersion: 1,
    source: MODELS_DEV_API_URL,
    providers,
  };
  return { hash: contentHash(document), document };
}

export function createTestModelRegistry(catalog: ModelCatalog): ModelRegistryService {
  const snapshot = createTestModelRegistrySnapshot(catalog);
  return {
    catalog,
    async capture(hash) {
      if (hash && hash !== snapshot.hash) throw new Error(`unknown test registry snapshot ${hash}`);
      return snapshot;
    },
    async refresh() {
      return {
        outcome: "unchanged",
        snapshot,
        checkedAt: "2026-01-01T00:00:00.000Z",
        error: null,
      };
    },
    status() {
      return {
        source: MODELS_DEV_API_URL,
        health: "fresh",
        refreshing: false,
        currentHash: snapshot.hash,
        checkedAt: "2026-01-01T00:00:00.000Z",
        ageMs: 0,
        stale: false,
        lastError: null,
      };
    },
  };
}

export function createTestModelAudit(
  role: ModelExecutionAudit["role"],
  subjectId: string,
  worldHash: string,
  revision = 0,
): ModelExecutionAudit {
  const catalog = createTestModelCatalog();
  const profileId = role.startsWith("agent-") ? "agent-default" : "truth-engine";
  const profile = catalog.profile(profileId);
  const account = catalog.account(profile.account_id);
  const modelId = profile.selector.kind === "exact" ? profile.selector.model_id : `scripted:${profileId}`;
  const registrySnapshotHash = contentHash({ testRegistry: catalog.hash });
  const modelMetadataHash = contentHash({ modelId, deterministic: true });
  const identity = modelInvocationIdentity({
    workloadId: "test-only-correlation",
    batchId: "test-only-correlation",
    runtimeIdentity: { worldHash, revision },
  }, role, subjectId, 1);
  return {
    role,
    subjectId,
    profileId,
    accountId: profile.account_id,
    accountChannel: account.channel,
    protocol: account.protocol,
    dialect: account.dialect,
    providerId: account.models_dev_provider_id,
    modelId,
    selector: structuredClone(profile.selector),
    registrySnapshotHash,
    modelMetadataHash,
    catalogSchemaVersion: catalog.schemaVersion,
    catalogHash: catalog.hash,
    promptVersion: "test-v1",
    requestedInference: structuredClone(profile.inference),
    resolvedInference: {
      thinking: null,
      effort: null,
      reasoningBudgetTokens: null,
      reasoningSummary: null,
      textVerbosity: null,
      temperature: null,
      topP: null,
    },
    structuredOutputMode: "deterministic-test",
    invocations: [{
      id: identity.modelInvocationId,
      ordinal: 1,
      requestHash: contentHash({ role, subjectId, revision, request: true }),
      responseHash: contentHash({ role, subjectId, revision, response: true }),
      requestUtf8Bytes: 1,
      responseUtf8Bytes: 1,
      context: {
        utf8Bytes: 1,
        sections: {},
        counts: { history: 0, events: 0, agents: 0, entities: 0, facts: 0, beliefs: 0, evidence: 0, observations: 0 },
      },
      transports: [{
        attempt: 1,
        queueWaitMs: 0,
        executionMs: 0,
        retryDelayMs: 0,
        status: "succeeded",
        errorName: null,
        statusCode: null,
      }],
      tokenUsage: { input: null, output: null, reasoning: null, cacheRead: null, cacheWrite: null },
      finishReason: "stop",
      providerRequestId: null,
      resultKind: "test-fixture",
      semanticOutcome: "accepted",
      validationIssueCodes: [],
    }],
  };
}

export type ScriptedModelHandlerRequest = Omit<StructuredModelRequest<unknown>, "schema"> & {
  prompt: string;
};

export type ScriptedModelHandler = (
  request: ScriptedModelHandlerRequest,
) => unknown | Promise<unknown>;

function automaticPlanDirective(context: unknown): unknown {
  const input = context as {
    task?: { assignedActions?: Array<{ actionRef: string; actorRef: string; goal: string }> };
    actors?: Array<{ agentRef: string; entityRef: string }>;
    world?: { disclosure?: { defaultCheckVisibility?: "full" | "result_only" | "hidden" } };
  };
  const actorEntity = new Map((input.actors ?? []).map((actor) => [actor.agentRef, actor.entityRef]));
  return {
    kind: "commit_plans",
    plans: (input.task?.assignedActions ?? []).map((action, index) => {
      const actorEntityRef = actorEntity.get(action.actorRef);
      if (!actorEntityRef) throw new Error(`deterministic plan has no actor entity for ${action.actorRef}`);
      return {
        proposalKey: `plan-${index}`,
        actionRef: action.actionRef,
        targetRefs: [actorEntityRef],
        means: [],
        mode: "automatic",
        difficulty: null,
        actorRatingRef: null,
        factors: [],
        risk: "safe",
        baseEffect: "none",
        primaryEffect: null,
        secondaryEffect: null,
        threatenedEffect: null,
        visibility: input.world?.disclosure?.defaultCheckVisibility ?? "full",
        causes: [{ kind: "action", ref: action.actionRef }],
      };
    }),
  };
}

function referenceSeed(reference: string, kind: string): string {
  return reference.replace(new RegExp(`^ref:${kind}:`, "u"), "");
}

function assignedModelActions(context: unknown): Array<{
  id: string;
  actorId: string;
  actionRef: string;
  actorRef: string;
  rawText: string;
  goal: string;
  means: string | null;
  targetIds: string[];
}> {
  const input = context as {
    task?: { assignedActions?: Array<{ actionRef: string; actorRef: string; rawText: string; goal: string; means: string | null; targetRefs: string[] }> };
  };
  return (input.task?.assignedActions ?? []).map((action) => ({
    id: referenceSeed(action.actionRef, "action"),
    actorId: referenceSeed(action.actorRef, "agent"),
    actionRef: action.actionRef,
    actorRef: action.actorRef,
    rawText: action.rawText,
    goal: action.goal,
    means: action.means,
    targetIds: action.targetRefs.map((target) => referenceSeed(target, "local_entity")),
  }));
}

/** Existing unit fixtures intentionally describe the internal plan shape. The
 * scripted provider is a test boundary, so normalize those fixtures into the
 * model-facing reference protocol before strict schema parsing. Production
 * providers never receive this adapter. */
/* eslint-disable @typescript-eslint/no-explicit-any -- legacy fixture adapter is isolated to tests. */
function adaptScriptedResolutionOutput(raw: unknown): unknown {
  if (!raw || typeof raw !== "object") return raw;
  const value = raw as { kind?: string; plans?: unknown[] };
  if (value.kind !== "commit_plans" || !Array.isArray(value.plans)) return raw;
  const ref = (kind: string, id: unknown): unknown =>
    typeof id === "string" ? referenceHandleFor(kind as "action", id) : id;
  const source = (item: any): any => ({ kind: item.kind, ref: ref(item.kind, item.id) });
  const effect = (item: any, includeMagnitude = true): any => item === null ? null : item.kind === "meter" ? {
    kind: item.kind,
    proposalKey: item.proposalKey ?? item.id,
    targetRef: item.targetRef ?? ref("entity", item.targetId),
    channel: item.channel,
    label: item.label,
    description: item.description,
    sourceRefs: (item.sourceRefs ?? []).map(source),
    meterRef: item.meterRef ?? ref("meter", item.meterId),
    impactProfileRef: item.impactProfileRef ?? ref("mechanic", item.impactProfileId),
    ...(includeMagnitude ? { magnitude: item.magnitude } : {}),
  } : {
    kind: item.kind,
    proposalKey: item.proposalKey ?? item.id,
    targetRef: item.targetRef ?? ref("entity", item.targetId),
    channel: item.channel,
    label: item.label,
    description: item.description,
    sourceRefs: (item.sourceRefs ?? []).map(source),
    conditionRef: item.conditionRef ?? { proposalKey: item.conditionId },
    durationProfileRef: item.durationProfileRef ?? ref("mechanic", item.durationProfileId),
    conditionProfileRef: item.conditionProfileRef === null ? null : item.conditionProfileRef ?? ref("mechanic", item.conditionProfileId),
    access: item.access,
    ...(includeMagnitude ? { magnitude: item.magnitude } : {}),
  };
  const plan = (item: any): any => ({
    proposalKey: item.proposalKey ?? item.id,
    actionRef: item.actionRef ?? ref("action", item.actionId),
    targetRefs: item.targetRefs ?? (item.targetIds ?? []).map((id: string) => ref("entity", id)),
    means: (item.means ?? []).map((mean: any) => ({ ...mean, source: mean.source?.ref ? mean.source : source(mean.source) })),
    mode: item.mode,
    difficulty: item.difficulty === null ? null : item.difficulty ? item.difficulty.kind === "opposed"
      ? { kind: "opposed", targetRef: item.difficulty.targetRef ?? ref("entity", item.difficulty.targetId), ratingRef: item.difficulty.ratingRef ?? ref("rating", item.difficulty.ratingId), source: item.difficulty.source?.ref ? item.difficulty.source : source(item.difficulty.source) }
      : { kind: "environment", band: item.difficulty.band, source: item.difficulty.source?.ref ? item.difficulty.source : source(item.difficulty.source) }
      : null,
    actorRatingRef: item.actorRatingRef !== undefined
      ? item.actorRatingRef
      : item.actorRatingId == null ? null : ref("rating", item.actorRatingId),
    factors: (item.factors ?? []).map((factor: any) => ({ ...factor, source: factor.source?.ref ? factor.source : source(factor.source) })),
    risk: item.risk,
    baseEffect: item.baseEffect,
    primaryEffect: effect(item.primaryEffect),
    secondaryEffect: effect(item.secondaryEffect),
    threatenedEffect: effect(item.threatenedEffect, false),
    visibility: item.visibility,
    causes: (item.causes ?? []).map((cause: any) => ({ kind: cause.kind, ref: cause.ref ?? ref(cause.kind, cause.id) })),
  });
  return { ...value, plans: value.plans.map(plan) };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/* Unit fixtures may still use the persisted transition vocabulary. This
 * adapter is intentionally confined to ScriptedModelProvider; production
 * model providers are parsed directly against the semantic protocol. */
/* eslint-disable @typescript-eslint/no-explicit-any -- isolated fixture adapter. */
function adaptScriptedTransitionOutput(raw: unknown): unknown {
  if (!raw || typeof raw !== "object") return raw;
  if ("slots" in raw && Array.isArray(raw.slots)) {
    return {
      ...raw,
      slots: raw.slots.map((slot: any) => ({ ...slot, result: adaptScriptedTransitionOutput(slot.result) })),
    };
  }
  if ((raw as { kind?: string }).kind === "transition" && "proposal" in raw) {
    return adaptScriptedTransitionOutput((raw as { proposal: unknown }).proposal);
  }
  if ("invocation" in raw && raw.invocation && typeof raw.invocation === "object") {
    const adapted = adaptScriptedTransitionOutput({ mechanicInvocations: [raw.invocation] }) as { mechanicInvocations: unknown[] };
    return { invocation: adapted.mechanicInvocations[0] };
  }
  const value = raw as { outcomes?: any[]; mechanicInvocations?: any[]; operations?: any[]; events?: any[]; decisionRequests?: any[] };
  const createdEntityIds = new Set((value.operations ?? [])
    .filter((item) => item?.kind === "create_entity" && typeof item.entity?.id === "string")
    .map((item) => item.entity.id as string));
  const ref = (kind: string, id: unknown): unknown => typeof id === "string" ? referenceHandleFor(kind as "action", id) : id;
  const causal = (item: any): any => ({ kind: item.kind, ref: item.ref ?? ref(item.kind, item.id) });
  const assertion = (item: any): any => {
    switch (item.kind) {
      case "check_result": return { kind: item.kind, checkRef: ref("check", item.checkId), expected: item.expected };
      case "random_result": return { kind: item.kind, requestRef: ref("random", item.requestId), stepRef: ref("random", item.stepId), expected: item.expected };
      case "fact_matches": return { kind: item.kind, factRef: ref("fact", item.factId), expected: item.expected?.kind === "entity" ? { kind: "entity", entityRef: ref("entity", item.expected.entityId) } : item.expected };
      case "fact_absent": return { kind: item.kind, factRef: ref("fact", item.factId) };
      case "entity_absent": return { kind: item.kind, entityRef: { proposalKey: item.entityId } };
      case "entity_lifecycle": return { kind: item.kind, entityRef: createdEntityIds.has(item.entityId) ? { proposalKey: item.entityId } : ref("entity", item.entityId), expected: item.expected };
      case "placement_equals": return { kind: item.kind, entityRef: ref("entity", item.entityId), placementRef: item.placementId === null ? null : ref("entity", item.placementId) };
      case "shared_placement": return { kind: item.kind, leftEntityRef: ref("entity", item.leftEntityId), rightEntityRef: ref("entity", item.rightEntityId) };
      case "meter_compare": return { kind: item.kind, meterRef: ref("meter", item.meterId), operator: item.operator, value: item.value };
      case "quantity_compare": return { kind: item.kind, definitionRef: ref("quantity", item.definitionId), holderRef: ref("entity", item.holderId), operator: item.operator, value: item.value };
      case "rating_compare": return { kind: item.kind, ratingRef: ref("rating", item.ratingId), operator: item.operator, value: item.value };
      case "shared_resource_capacity_compare": return { kind: item.kind, poolRef: ref("shared_resource_pool", item.poolId), operator: item.operator, value: item.value };
      default: return item;
    }
  };
  const operation = (item: any): any => {
    const common = { causes: (item.causes ?? []).map(causal), assertions: (item.assertions ?? []).map(assertion) };
    switch (item.kind) {
      case "create_entity": return { kind: item.kind, entity: { proposalKey: item.entity.id, kind: item.entity.kind, name: item.entity.name, description: item.entity.description }, placementRef: item.placementId === null ? null : ref("entity", item.placementId), ...common };
      case "retire_entity": return { kind: item.kind, entityRef: ref("entity", item.entityId), ...common };
      case "place_entity": return { kind: item.kind, entityRef: ref("entity", item.entityId), placementRef: item.placementId === null ? null : ref("entity", item.placementId), ...common };
      case "set_fact": return { kind: item.kind, fact: { proposalKey: item.fact.id, subjectRef: ref("entity", item.fact.subjectId), predicate: item.fact.predicate, value: item.fact.value?.kind === "entity" ? { kind: "entity", entityRef: ref("entity", item.fact.value.entityId) } : item.fact.value, description: item.fact.description, access: item.fact.access }, ...common };
      case "create_agent": return { kind: item.kind, agent: { proposalKey: item.agent.id, entityRef: { proposalKey: item.agent.entityId }, character: item.agent.character, belief: item.agent.belief, bindings: item.agent.bindings }, ...common };
      case "remove_fact": return { kind: item.kind, factRef: ref("fact", item.factId), ...common };
      case "remove_agent": return { kind: item.kind, agentRef: ref("agent", item.agentId), ...common };
      default: return item;
    }
  };
  return {
    outcomes: (value.outcomes ?? []).map((item) => ({ proposalKey: item.proposalKey ?? item.id ?? item.proposalId, actionRef: item.actionRef ?? ref("action", item.proposalId), status: item.status, summary: item.summary, causes: (item.causes ?? item.causeRefs ?? []).map(causal), assertions: (item.assertions ?? []).map(assertion), knownAlternatives: (item.knownAlternatives ?? []).map((alternative: any) => ({ description: alternative.description, evidenceRefs: alternative.evidenceRefs ?? alternative.basis?.evidenceIds?.map((id: string) => ref("evidence", id)) ?? [] })) })),
    mechanicInvocations: (value.mechanicInvocations ?? []).map((item) => ({ proposalKey: item.proposalKey ?? item.id, packageId: item.packageId, ruleId: item.ruleId, input: item.input, causes: (item.causes ?? []).map(causal), assertions: (item.assertions ?? []).map(assertion) })),
    operations: (value.operations ?? []).map(operation),
    events: (value.events ?? []).map((item) => ({ proposalKey: item.proposalKey ?? item.id, description: item.description, impact: item.impact, causes: (item.causes ?? []).map(causal), assertions: (item.assertions ?? []).map(assertion) })),
    decisionRequests: (value.decisionRequests ?? []).map((item) => ({ agentRef: item.agentRef ?? ref("agent", item.agentId), prompt: item.prompt, suggestions: item.suggestions })),
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/* Normalize legacy verifier fixtures at the test provider boundary. */
/* eslint-disable @typescript-eslint/no-explicit-any -- isolated fixture adapter. */
function adaptScriptedVerifierOutput(raw: unknown): unknown {
  if (!raw || typeof raw !== "object") return raw;
  if ("slots" in raw && Array.isArray(raw.slots)) {
    return {
      ...raw,
      slots: raw.slots.map((slot: any) => ({ ...slot, result: adaptScriptedVerifierOutput(slot.result) })),
    };
  }
  const value = raw as { verdict?: string; findings?: any[] };
  if (!Array.isArray(value.findings)) return raw;
  return {
    ...value,
    findings: value.findings.map((finding) => {
      const { planId: legacyPlanId, target: legacyTarget, ...rest } = finding;
      const target = legacyTarget && typeof legacyTarget === "object"
        ? (() => {
          const { id: legacyTargetId, ...targetRest } = legacyTarget;
          return legacyTargetId !== undefined
            ? { ...targetRest, ref: refForVerifier(legacyTarget.kind, legacyTargetId) }
            : legacyTarget;
        })()
        : legacyTarget;
      return {
        ...rest,
        ...(legacyPlanId !== undefined ? { planRef: refForVerifier("plan", legacyPlanId) } : {}),
        ...(target !== undefined ? { target } : {}),
      };
    }),
  };
}

/* Action compilation fixtures predate model-owned causal handles. Keep the
 * compatibility shim in the scripted provider only; production providers are
 * parsed directly against the semantic temporal-plan schema. */
/* eslint-disable @typescript-eslint/no-explicit-any -- isolated fixture adapter. */
function adaptScriptedCompilationOutput(raw: unknown): unknown {
  if (!raw || typeof raw !== "object") return raw;
  if ("slots" in raw && Array.isArray(raw.slots)) {
    return {
      ...raw,
      slots: raw.slots.map((slot: any) => {
        const temporalPlan = slot.temporalPlan && typeof slot.temporalPlan === "object"
          ? {
            ...slot.temporalPlan,
            causes: Array.isArray(slot.temporalPlan.causes)
              ? slot.temporalPlan.causes.map((cause: any) => {
                const { id: _legacyId, ...rest } = cause;
                return {
                  kind: rest.kind,
                  ref: rest.ref ?? (typeof _legacyId === "string" ? referenceHandleFor(rest.kind, _legacyId) : rest.ref),
                };
              })
              : slot.temporalPlan.causes,
          }
          : slot.temporalPlan;
        return { ...slot, temporalPlan };
      }),
    };
  }
  return raw;
}
/* eslint-enable @typescript-eslint/no-explicit-any */
function refForVerifier(kind: string, id: unknown): unknown {
  return typeof id === "string" ? referenceHandleFor(kind as "action", id) : id;
}

export class ScriptedModelProvider implements StructuredModelProvider {
  readonly requests: ScriptedModelHandlerRequest[] = [];
  private pendingTransition: unknown;
  private pendingResolution: unknown;
  private pendingRouting: unknown;

  constructor(
    private readonly handler: ScriptedModelHandler,
    readonly catalog: ModelCatalog = createTestModelCatalog(),
    private readonly adaptTruthScenario = true,
    private readonly captureRequests = true,
  ) {}

  availableProfileSummaries(role?: Parameters<ModelCatalog["profileSummaries"]>[0]) {
    return this.catalog.profileSummaries(role);
  }

  async assertProfilesAvailable(profileIds: readonly string[]): Promise<void> {
    for (const profileId of profileIds) this.catalog.profile(profileId);
  }

  private async handlerValue(request: ScriptedModelHandlerRequest): Promise<unknown> {
    const batchContext = request.context as {
      sharedContext?: Record<string, unknown>;
      slots?: Array<{ slot: number; key: string; context: Record<string, unknown> }>;
    };
    if (request.schemaName.endsWith("_batch") && batchContext?.sharedContext && batchContext.slots) {
      const baseSchemaName = request.schemaName
        .replace("truth_resolution_batch", "truth_resolution_directive")
        .replace("resolution_plan_verification_batch", "resolution_plan_verification")
        .replace("truth_transition_batch", "truth_transition")
        .replace("causal_verification_batch", "causal_verification")
        .replace("observation_projection_batch", "observation_render");
      const slots = [...batchContext.slots].sort((left, right) => left.slot - right.slot);
      const values: unknown[] = [];
      for (const slot of slots) {
        values.push(await this.handlerValue({
          ...request,
          schemaName: baseSchemaName,
          subjectId: slot.key,
          // Shared context is immutable by contract; avoid cloning the same
          // multi-megabyte truth projection once per logical slot in tests.
          // Each slot still receives a fresh top-level envelope.
          context: { ...batchContext.sharedContext, ...slot.context },
        }));
      }
      return { slots: slots.map((slot, index) => ({ slot: slot.slot, result: values[index] })) };
    }
    if (!this.adaptTruthScenario || !request.role.startsWith("truth-") && request.role !== "causal-verifier") {
      return this.handler(request);
    }
    if (request.role === "causal-verifier") return { verdict: "accept", findings: [] };
    if (request.role === "truth-transition" && this.pendingTransition !== undefined) {
      const value = this.pendingTransition;
      this.pendingTransition = undefined;
      return value;
    }
    if (request.role === "truth-resolution" && this.pendingResolution !== undefined) {
      const context = request.context as { committedResolutionPlans?: unknown[] };
      if (!context.committedResolutionPlans?.length) return automaticPlanDirective(request.context);
      const value = this.pendingResolution;
      this.pendingResolution = undefined;
      return value;
    }
    if (request.role === "truth-reaction-routing" && this.pendingRouting !== undefined) {
      const value = this.pendingRouting;
      this.pendingRouting = undefined;
      return value;
    }
    if (request.role === "truth-reaction-routing" &&
      (this.pendingResolution !== undefined || this.pendingTransition !== undefined)) {
      return { requests: [] };
    }
    if (request.role === "truth-resolution" && this.pendingTransition !== undefined) {
      const context = request.context as { committedResolutionPlans?: unknown[] };
      return context.committedResolutionPlans?.length ? { kind: "done" } : automaticPlanDirective(request.context);
    }

    const value = await this.handler(request) as {
      kind?: string;
      requests?: Array<{ phase?: string }>;
      proposal?: unknown;
    };
    if (request.role === "truth-perception") {
      if (value.kind === "request_checks") return value;
      if (value.kind === "request_random") this.pendingResolution = value;
      if (value.kind === "request_reactions") this.pendingRouting = { requests: value.requests ?? [] };
      if (value.kind === "transition") this.pendingTransition = value.proposal;
      return { kind: "done" };
    }
    if (request.role === "truth-reaction-routing") {
      if (value.kind === "request_reactions") return { requests: value.requests ?? [] };
      if (value.kind === "request_checks" || value.kind === "request_random") this.pendingResolution = value;
      if (value.kind === "transition") this.pendingTransition = value.proposal;
      return { requests: [] };
    }
    if (request.role === "truth-resolution") {
      if (value.kind === "request_checks" || value.kind === "request_random") return value;
      if (value.kind === "commit_plans") return value;
      if (value.kind === "transition") {
        this.pendingTransition = value.proposal;
        const context = request.context as { committedResolutionPlans?: unknown[] };
        return context.committedResolutionPlans?.length ? { kind: "done" } : automaticPlanDirective(request.context);
      }
      return { kind: "done" };
    }
    if (value.kind === "transition") return value.proposal;
    return value;
  }

  async generateStructured<T>(request: StructuredModelRequest<T>): Promise<StructuredModelResult<T>> {
    this.catalog.assertProfile(request.profileId, request.role);
    const profile = this.catalog.profile(request.profileId);
    const account = this.catalog.account(profile.account_id);
    const modelId = profile.selector.kind === "exact"
      ? profile.selector.model_id
      : `scripted:${request.profileId}`;
    const context = canonicalize(request.context);
    const promptBytes = structuredPromptBytes({
      system: request.system,
      userPrompt: request.userPrompt,
      context,
      schema: request.schema,
    });
    if (promptBytes.requestUtf8Bytes > profile.max_input_bytes) {
      throw new ContextLimitExceededError(
        `model profile ${request.profileId} request is ${promptBytes.requestUtf8Bytes} bytes; ` +
        `maximum is ${profile.max_input_bytes} bytes`,
      );
    }
    const captured: ScriptedModelHandlerRequest = {
      profileId: request.profileId,
      workloadId: request.workloadId,
      batchId: request.batchId,
      role: request.role,
      subjectId: request.subjectId,
      promptVersion: request.promptVersion,
      schemaName: request.schemaName,
      system: request.system,
      userPrompt: request.userPrompt,
      context,
      prompt: promptBytes.userMessage,
      abortSignal: request.abortSignal,
      correlation: request.correlation,
      observer: request.observer,
      modelRegistrySnapshotHash: request.modelRegistrySnapshotHash,
      modelInvocationId: request.modelInvocationId,
      modelInvocation: request.modelInvocation,
    };
    if (this.captureRequests) this.requests.push(captured);
    if (request.abortSignal?.aborted) {
      const error = new Error("model request aborted");
      error.name = "AbortError";
      throw error;
    }
    const raw = await this.handlerValue(captured);
    const modelInvocation = request.modelInvocation ?? 1;
    const modelInvocationId = request.modelInvocationId ?? modelInvocationIdentity(
      request,
      request.role,
      request.subjectId,
      modelInvocation,
    ).modelInvocationId;
    const contextJson = promptBytes.contextJson;
    const requestDocument = { system: request.system, userPrompt: request.userPrompt, context };
    const responseJson = JSON.stringify(canonicalize(raw));
    const audit: StructuredModelResult<T>["audit"] = {
      role: request.role,
      subjectId: request.subjectId,
      profileId: request.profileId,
      accountId: profile.account_id,
      accountChannel: account.channel,
      protocol: account.protocol,
      dialect: account.dialect,
      providerId: account.models_dev_provider_id,
      modelId,
      selector: structuredClone(profile.selector),
      registrySnapshotHash: request.modelRegistrySnapshotHash ?? contentHash({ testRegistry: this.catalog.hash }),
      modelMetadataHash: contentHash({ modelId, deterministic: true }),
      catalogSchemaVersion: this.catalog.schemaVersion,
      catalogHash: this.catalog.hash,
      promptVersion: request.promptVersion,
      requestedInference: structuredClone(profile.inference),
      resolvedInference: {
        thinking: null,
        effort: null,
        reasoningBudgetTokens: null,
        reasoningSummary: null,
        textVerbosity: null,
        temperature: null,
        topP: null,
      },
      structuredOutputMode: "deterministic-test",
      invocations: [{
        id: modelInvocationId,
        ordinal: modelInvocation,
        requestHash: contentHash(requestDocument),
        responseHash: contentHash(raw),
        requestUtf8Bytes: promptBytes.requestUtf8Bytes,
        responseUtf8Bytes: Buffer.byteLength(responseJson, "utf8"),
        context: measureModelContext(context, contextJson),
        transports: [{
          attempt: 1,
          queueWaitMs: 0,
          executionMs: 0,
          retryDelayMs: 0,
          status: "succeeded",
          errorName: null,
          statusCode: null,
        }],
        tokenUsage: { input: null, output: null, reasoning: null, cacheRead: null, cacheWrite: null },
        finishReason: "stop",
        providerRequestId: null,
        resultKind: null,
        semanticOutcome: "accepted",
        validationIssueCodes: [],
      }],
    };
    try {
      const normalizedRaw = request.schemaName.startsWith("truth_resolution")
        ? adaptScriptedResolutionOutput(raw)
          : request.schemaName.startsWith("truth_transition")
          ? adaptScriptedTransitionOutput(raw)
          : request.schemaName.startsWith("action_compilation")
            ? adaptScriptedCompilationOutput(raw)
          : request.schemaName.startsWith("resolution_plan_verification") || request.schemaName.startsWith("causal_verification")
            ? adaptScriptedVerifierOutput(raw)
          : raw;
      return { value: request.schema.parse(normalizedRaw), audit };
    } catch (error) {
      audit.invocations[0]!.semanticOutcome = "rejected";
      audit.invocations[0]!.validationIssueCodes = ["schema_validation"];
      throw new ModelOutputError("scripted model output failed schema validation", audit, {
        cause: error,
        rawValue: raw,
      });
    }
  }
}

interface DeterministicCompilationAction {
  id: string;
  actorId: string;
  rawText: string;
}

interface DeterministicCompilationContextAction {
  id?: string;
  actionRef?: string;
  actorId?: string;
  actorRef?: string;
  rawText: string;
}

interface DeterministicCompilationSlot {
  slot: number;
  action: DeterministicCompilationAction;
}

export function deterministicInteractionDependency(
  input: {
    reads?: readonly FootprintRef[];
    writes?: readonly FootprintRef[];
    audienceAgentIds?: readonly string[];
    sharedResourceClaims?: Array<{ poolId: string; basis: ActionCompilationDraft["interactionDependency"]["sharedResourceClaims"][number]["basis"] }>;
    globalFallback?: boolean;
  },
): ActionCompilationDraft["interactionDependency"] {
  const handle = (ref: FootprintRef): ExistingReferenceHandle => referenceHandleFor(
    ref.kind === "global" ? "world" : ref.kind,
    ref.id,
  );
  return {
    stateDependencies: {
      requiredExistingRefs: (input.reads ?? []).map(handle),
      potentiallyAffectedExistingRefs: (input.writes ?? []).map(handle),
    },
    audienceAgentHandles: (input.audienceAgentIds ?? []).map((id) => referenceHandleFor("agent", id)),
    sharedResourceClaims: (input.sharedResourceClaims ?? []).map((claim) => ({
      resourcePoolHandle: referenceHandleFor("shared_resource_pool", claim.poolId),
      basis: structuredClone(claim.basis),
    })),
    requiresWorldWideArbitration: input.globalFallback ?? false,
  };
}

interface DeterministicMindSlot {
  slot: number;
  state: {
    perspective: {
      agentId: string;
      self: { name: string; location: { name: string } | null };
    };
  };
}

function deterministicActionCompilation(
  action: DeterministicCompilationAction,
  temporalProfiles: readonly { id: string }[],
): ActionCompilationDraft {
  const profile = temporalProfiles[0];
  if (!profile) throw new Error("deterministic action compiler has no temporal profile");
  return {
    temporalPlan: {
      profileId: profile.id,
      basis: { kind: "profile" },
      description: action.rawText,
      continuationAssertions: [],
      causes: [{ kind: "action", ref: referenceHandleFor("action", action.id) }],
    },
    interactionDependency: {
      // Ordinary deterministic actions are sparse by default. Tests that
      // exercise world-wide semantics must opt in through the explicit global
      // helper below instead of making every fixture a single component.
      stateDependencies: {
        requiredExistingRefs: [],
        potentiallyAffectedExistingRefs: [],
      },
      audienceAgentHandles: [],
      sharedResourceClaims: [],
      requiresWorldWideArbitration: false,
    },
  };
}

export function deterministicGlobalActionCompilationBatch(
  profileId: string,
  context: unknown,
  customize?: (
    compilation: ActionCompilationDraft,
    slot: DeterministicCompilationSlot,
    context: unknown,
  ) => void,
): { slots: Array<ActionCompilationDraft & { slot: number }> } {
  return deterministicActionCompilationBatch(profileId, context, (compilation, slot) => {
    const candidates = (context as { referenceCatalog?: { candidates?: Array<{ kind: string; handle: string }> } })
      .referenceCatalog?.candidates ?? [];
    const worldHandle = candidates.find((candidate) => candidate.kind === "world")?.handle;
    if (!worldHandle) throw new Error("deterministic global action compiler requires a world reference handle");
    const handle = worldHandle as ExistingReferenceHandle;
    compilation.interactionDependency.stateDependencies.requiredExistingRefs = [handle];
    compilation.interactionDependency.stateDependencies.potentiallyAffectedExistingRefs = [handle];
    compilation.interactionDependency.requiresWorldWideArbitration = true;
    customize?.(compilation, slot, context);
  });
}

export function deterministicActionCompilationBatch(
  profileId: string,
  context: unknown,
  customize?: (
    compilation: ActionCompilationDraft,
    slot: DeterministicCompilationSlot,
    context: unknown,
  ) => void,
): { slots: Array<ActionCompilationDraft & { slot: number }> } {
  void profileId;
  const input = context as {
    slots?: Array<{ slot: number; action: DeterministicCompilationContextAction }>;
    temporalProfiles?: Array<{ id: string }>;
  };
  if (!input.slots || !input.temporalProfiles) {
    throw new Error("deterministic action compiler expected a slot batch");
  }
  return {
    slots: input.slots.map((slot) => {
      const actionId = slot.action.id ?? slot.action.actionRef?.replace(/^ref:action:/u, "");
      const actorId = slot.action.actorId ?? slot.action.actorRef?.replace(/^ref:agent:/u, "");
      if (!actionId || !actorId) throw new Error("deterministic action compiler could not recover fixture identities");
      const fixtureSlot = { ...slot, action: { ...slot.action, id: actionId, actorId } } as DeterministicCompilationSlot;
      const compilation = deterministicActionCompilation(fixtureSlot.action, input.temporalProfiles!);
      customize?.(compilation, fixtureSlot, context);
      return { slot: fixtureSlot.slot, ...compilation };
    }),
  };
}

function deterministicAgentMindOutput(): AgentMindDraftOutput {
  return {
    beliefChanges: { operations: [] },
    characterChanges: { operations: [] },
    nextActionIntent: {
      rawText: "维持当前目标并观察世界",
      goal: "继续自主行动",
      means: null,
      targetHandles: [],
    },
  };
}

export function deterministicAgentMindBatch(
  context: unknown,
  customize?: (output: AgentMindDraftOutput, slot: DeterministicMindSlot) => void,
): unknown {
  const input = context as { slots?: DeterministicMindSlot[] };
  if (!input.slots) throw new Error("deterministic AgentMind expected a slot batch");
  return {
    slots: input.slots.map((slot) => {
      const output = deterministicAgentMindOutput();
      customize?.(output, slot);
      return { slot: slot.slot, ...output };
    }),
  };
}

export function deterministicModelOutput(profileId: string, context: unknown): unknown {
      const input = context as {
        stage?: "perception" | "reaction-routing" | "resolution" | "transition";
        revision?: number;
        step?: number;
        baseRevision?: number;
        agent?: { id: string };
        perspective?: {
          agentId: string;
          self: { name: string; location: { name: string } | null };
        };
        action?: { id: string; actorId: string; rawText: string };
        slots?: Array<DeterministicCompilationSlot | DeterministicMindSlot>;
        entity?: { name: string; location: string | null };
        world?: { laws: Array<{ id: string }> };
        actors?: Record<string, unknown>;
        observationSlots?: Array<{ observer: { agentId: string } }>;
        currentEvents?: Array<{ eventRef?: string; id?: string }>;
        committedResolutionPlans?: unknown[];
        temporalProfiles?: Array<{ id: string; kind: string; allowExplicitDuration?: boolean }>;
        temporalBoundary?: { toElapsedSeconds: number };
        canonicalTruth?: {
          activities?: Record<string, { sourceActionId?: string; sourceActionRef?: string; completionAtSeconds: number | null }>;
        };
        referenceCatalog?: { candidates: Array<{ kind: string; handle: string; statePath?: string }> };
        task?: { action?: DeterministicCompilationAction };
        state?: {
          perspective?: { agentId: string; self: { name: string; location: { name: string } | null } };
          preparedAction?: unknown;
          stimulus?: unknown;
        };
      };
      const actionInput = input.action ?? input.task?.action;
      if (input.slots?.every((slot): slot is DeterministicCompilationSlot => "action" in slot) &&
        input.temporalProfiles) {
        return deterministicActionCompilationBatch(profileId, context);
      }
      if (input.slots?.every((slot): slot is DeterministicMindSlot => "state" in slot &&
        Boolean((slot as DeterministicMindSlot).state?.perspective))) {
        return deterministicAgentMindBatch(context);
      }
      if (actionInput && input.temporalProfiles) {
        return deterministicActionCompilation(actionInput, input.temporalProfiles);
      }
      if (actionInput) {
        const worldHandle = (input.referenceCatalog?.candidates as Array<{ kind: string; handle: string; statePath?: string }> | undefined)
          ?.find((candidate) => candidate.kind === "world")?.handle;
        if (!worldHandle) throw new Error("deterministic grounding requires a world reference handle");
        return {
          stateDependencies: {
            requiredExistingRefs: [worldHandle as ExistingReferenceHandle],
            potentiallyAffectedExistingRefs: [worldHandle as ExistingReferenceHandle],
          },
          audienceAgentHandles: [],
          sharedResourceClaims: [],
          requiresWorldWideArbitration: true,
        };
      }
      if (input.state?.preparedAction && input.state.stimulus) return { kind: "keep" };
      if (input.perspective && input.revision === undefined) {
        return {
          title: `此刻，你是${input.perspective.self.name}`,
          scene: input.perspective.self.location
            ? `你在${input.perspective.self.location.name}恢复了对周围的注意。`
            : "你恢复了对周围的注意，但还不能确定当前位置。",
          suggestions: ["观察四周", "确认当前位置", "寻找可以交谈的人"],
        };
      }
      if (input.entity) {
        return {
          title: `此刻，你是${input.entity.name}`,
          scene: input.entity.location
            ? `你在${input.entity.location}恢复了对周围的注意。`
            : "你恢复了对周围的注意，但还不能确定当前位置。",
          suggestions: ["观察四周", "确认当前位置", "寻找可以交谈的人"],
        };
      }
      if (input.observationSlots) {
        return {
          summary: "世界继续变化。",
          introductions: [],
          apparentClaims: [],
          sourceEventRefs: (input.currentEvents ?? [])
            .map((event) => event.eventRef)
            .filter((handle): handle is string => Boolean(handle)),
        };
      }
      if (profileId.startsWith("truth-")) {
        if (input.stage === "perception") return { kind: "done" };
        if (input.stage === "reaction-routing") return { requests: [] };
        if (input.stage === "resolution") {
          return input.committedResolutionPlans?.length ? { kind: "done" } : automaticPlanDirective(context);
        }
        const step = input.step;
        const revision = input.baseRevision;
        const lawId = input.world?.laws[0]?.id;
        const lawRef = input.referenceCatalog?.candidates.find((candidate) => candidate.kind === "law")?.handle;
        const actions = assignedModelActions(context);
        if (step === undefined || revision === undefined || !lawId || !lawRef || !actions) {
          throw new Error("deterministic Truth Engine context is incomplete");
        }
        const nextStep = step + 1;
        return {
          kind: "transition",
          proposal: {
            outcomes: actions.map((action, index) => {
              const activity = Object.values(input.canonicalTruth?.activities ?? {})
                .find((candidate) => candidate.sourceActionId === action.id ||
                  candidate.sourceActionRef === `ref:action:${action.id}`);
              const continuing = Boolean(activity && (activity.completionAtSeconds === null ||
                activity.completionAtSeconds > (input.temporalBoundary?.toElapsedSeconds ?? 0)));
              return {
              proposalKey: `outcome-${index}`,
              actionRef: action.actionRef,
              status: continuing ? "continuing" : "succeeded",
              summary: continuing ? "行动推进到下一个时间检查点。" : "模拟 Truth Engine 已联合裁决行动。",
              causes: [{ kind: "action", ref: action.actionRef }],
              assertions: [{ kind: "elapsed_seconds_compare", operator: "gte", value: 0 }],
              knownAlternatives: [],
            }; }),
            mechanicInvocations: [],
            operations: [],
            events: [{
              proposalKey: `event-${nextStep}`,
              description: "模拟世界推进了一秒。",
              impact: "ordinary",
              causes: [{ kind: "law", ref: lawRef }],
              assertions: [{ kind: "elapsed_seconds_compare", operator: "gte", value: 0 }],
            }],
            decisionRequests: [],
          },
        };
      }
      const agentId = input.perspective?.agentId;
      const revision = input.revision;
      if (!agentId || revision === undefined) throw new Error("deterministic AgentMind context is incomplete");
      return deterministicAgentMindOutput();
}

export class DeterministicModelProvider extends ScriptedModelProvider {
  constructor(catalog = createTestModelCatalog(), captureRequests = true) {
    super(
      ({ profileId, context }) => deterministicModelOutput(profileId, context),
      catalog,
      true,
      captureRequests,
    );
  }
}
