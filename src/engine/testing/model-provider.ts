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
import type { ActionCompilationDraft } from "../runtime/execution";
import type { AgentMindDraftOutput } from "../contracts/llm-schemas";
import { structuredPromptBytes } from "../prompts";

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
    jointActions?: Array<{ id: string; actorId: string; goal: string }>;
    actors?: Record<string, { entityId: string }>;
    world?: { disclosure?: { defaultCheckVisibility?: "full" | "result_only" | "hidden" } };
  };
  return {
    kind: "commit_plans",
    plans: (input.jointActions ?? []).map((action, index) => {
      const actorId = input.actors?.[action.actorId]?.entityId;
      if (!actorId) throw new Error(`deterministic plan has no actor entity for ${action.actorId}`);
      return {
        id: `plan-${index}`,
        actionId: action.id,
        actorId,
        targetIds: [actorId],
        goal: action.goal,
        means: [],
        mode: "automatic",
        difficulty: null,
        actorRatingId: null,
        factors: [],
        risk: "safe",
        baseEffect: "none",
        primaryEffect: null,
        secondaryEffect: null,
        threatenedEffect: null,
        visibility: input.world?.disclosure?.defaultCheckVisibility ?? "full",
        causes: [{ kind: "action", id: action.id }],
      };
    }),
  };
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
          context: { ...structuredClone(batchContext.sharedContext), ...structuredClone(slot.context) },
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
      return { value: request.schema.parse(raw), audit };
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

interface DeterministicCompilationSlot {
  slot: number;
  action: DeterministicCompilationAction;
}

interface DeterministicMindSlot {
  slot: number;
  perspective: {
    agentId: string;
    self: { name: string; location: { name: string } | null };
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
      causes: [{ kind: "action", id: action.id }],
    },
    interactionDependency: {
      // Ordinary deterministic actions are sparse by default. Tests that
      // exercise world-wide semantics must opt in through the explicit global
      // helper below instead of making every fixture a single component.
      reads: [],
      writes: [],
      audienceAgentIds: [action.actorId],
      sharedResourceClaims: [],
      globalFallback: false,
    },
  };
}

export function deterministicGlobalActionCompilationBatch(
  profileId: string,
  context: unknown,
  customize?: (
    compilation: ActionCompilationDraft,
    slot: DeterministicCompilationSlot,
  ) => void,
): { slots: Array<ActionCompilationDraft & { slot: number }> } {
  return deterministicActionCompilationBatch(profileId, context, (compilation, slot) => {
    compilation.interactionDependency.reads = [{ kind: "global", id: "world" }];
    compilation.interactionDependency.writes = [{ kind: "global", id: "world" }];
    compilation.interactionDependency.globalFallback = true;
    customize?.(compilation, slot);
  });
}

export function deterministicActionCompilationBatch(
  profileId: string,
  context: unknown,
  customize?: (
    compilation: ActionCompilationDraft,
    slot: DeterministicCompilationSlot,
  ) => void,
): { slots: Array<ActionCompilationDraft & { slot: number }> } {
  void profileId;
  const input = context as {
    slots?: DeterministicCompilationSlot[];
    temporalProfiles?: Array<{ id: string }>;
  };
  if (!input.slots || !input.temporalProfiles) {
    throw new Error("deterministic action compiler expected a slot batch");
  }
  return {
    slots: input.slots.map((slot) => {
      const compilation = deterministicActionCompilation(slot.action, input.temporalProfiles!);
      customize?.(compilation, slot);
      return { slot: slot.slot, ...compilation };
    }),
  };
}

function deterministicAgentMindOutput(): AgentMindDraftOutput {
  return {
    beliefPatch: { operations: [] },
    characterPatch: { operations: [] },
    nextAction: {
      rawText: "维持当前目标并观察世界",
      goal: "继续自主行动",
      means: null,
      targetIds: [],
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
        jointActions?: Array<{ id: string }>;
        observationSlots?: Array<{ observer: { agentId: string } }>;
        currentEvents?: Array<{ id: string }>;
        committedResolutionPlans?: unknown[];
        temporalProfiles?: Array<{ id: string; kind: string; allowExplicitDuration?: boolean }>;
        temporalBoundary?: { toElapsedSeconds: number };
        canonicalTruth?: {
          activities?: Record<string, { sourceActionId: string; completionAtSeconds: number | null }>;
        };
      };
      if (input.slots?.every((slot): slot is DeterministicCompilationSlot => "action" in slot) &&
        input.temporalProfiles) {
        return deterministicActionCompilationBatch(profileId, context);
      }
      if (input.slots?.every((slot): slot is DeterministicMindSlot => "perspective" in slot)) {
        return deterministicAgentMindBatch(context);
      }
      if (input.action && input.temporalProfiles) {
        return deterministicActionCompilation(input.action, input.temporalProfiles);
      }
      if (input.action) {
        return {
          reads: [{ kind: "global", id: "world" }],
          writes: [{ kind: "global", id: "world" }],
          audienceAgentIds: [input.action.actorId],
          sharedResourceClaims: [],
          globalFallback: true,
        };
      }
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
          sourceEventIds: input.currentEvents?.map((event) => event.id) ?? [],
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
        const actions = input.jointActions;
        if (step === undefined || revision === undefined || !lawId || !actions) {
          throw new Error("deterministic Truth Engine context is incomplete");
        }
        const nextStep = step + 1;
        const eventId = `mock-event:${nextStep}`;
        return {
          kind: "transition",
          proposal: {
            outcomes: actions.map((action) => {
              const activity = Object.values(input.canonicalTruth?.activities ?? {})
                .find((candidate) => candidate.sourceActionId === action.id);
              const continuing = Boolean(activity && (activity.completionAtSeconds === null ||
                activity.completionAtSeconds > (input.temporalBoundary?.toElapsedSeconds ?? 0)));
              return {
              proposalId: action.id,
              status: continuing ? "continuing" : "succeeded",
              summary: continuing ? "行动推进到下一个时间检查点。" : "模拟 Truth Engine 已联合裁决行动。",
              causeRefs: [{ kind: "action", id: action.id }],
              assertions: [{ kind: "elapsed_seconds_compare", operator: "gte", value: 0 }],
              knownAlternatives: [],
            }; }),
            mechanicInvocations: [],
            operations: [],
            events: [{
              id: eventId,
              description: "模拟世界推进了一秒。",
              impact: "ordinary",
              causes: [{ kind: "law", id: lawId }],
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
