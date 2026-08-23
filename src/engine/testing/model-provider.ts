import { canonicalize, contentHash, measureModelContext } from "../model-audit";
import { parseModelCatalog, type ModelCatalog } from "../model-catalog";
import type {
  StructuredModelProvider,
  StructuredModelRequest,
  StructuredModelResult,
} from "../model-provider";

const TEST_PROFILE_IDS = [
  "truth-engine",
  "agent-default",
  "truth-deepseek",
  "agent-deepseek",
  "agent-openai",
  "agent-xai",
];

export function createTestModelCatalog(profileIds: readonly string[] = TEST_PROFILE_IDS): ModelCatalog {
  return parseModelCatalog({
    schema_version: 1,
    scheduler: {
      global_concurrency: 16,
      max_queued_requests: 1024,
      queue_timeout_ms: 300_000,
    },
    providers: {
      "scripted-test": {
        kind: "deepseek",
        base_url: "https://test.invalid",
        api_key_env: "TEST_MODEL_API_KEY",
        max_concurrency: 16,
      },
    },
    profiles: Object.fromEntries(profileIds.map((profileId) => [profileId, {
      provider_id: "scripted-test",
      model: `scripted:${profileId}`,
      description: `Deterministic test profile ${profileId}`,
      allowed_roles: [profileId.startsWith("truth-") || profileId === "truth-engine"
        ? "truth-engine"
        : "agent-mind"],
      request_timeout_ms: 10_000,
      max_output_tokens: 32_768,
      inference: {
        kind: "deepseek-non-thinking",
        temperature: null,
        top_p: null,
      },
    }])),
  });
}

export type ScriptedModelHandlerRequest = Omit<StructuredModelRequest<unknown>, "schema"> & {
  prompt: string;
};

export type ScriptedModelHandler = (
  request: ScriptedModelHandlerRequest,
) => unknown | Promise<unknown>;

export class ScriptedModelProvider implements StructuredModelProvider {
  readonly requests: ScriptedModelHandlerRequest[] = [];

  constructor(
    private readonly handler: ScriptedModelHandler,
    readonly catalog: ModelCatalog = createTestModelCatalog(),
    private readonly captureRequests = true,
  ) {}

  async generateStructured<T>(request: StructuredModelRequest<T>): Promise<StructuredModelResult<T>> {
    this.catalog.assertProfile(
      request.profileId,
      request.role === "agent-reaction" ? "agent-mind" : request.role,
    );
    const profile = this.catalog.profile(request.profileId);
    const context = canonicalize(request.context);
    const captured: ScriptedModelHandlerRequest = {
      profileId: request.profileId,
      workloadId: request.workloadId,
      batchId: request.batchId,
      role: request.role,
      subjectId: request.subjectId,
      promptVersion: request.promptVersion,
      schemaName: request.schemaName,
      system: request.system,
      context,
      prompt: JSON.stringify(context, null, 2),
      abortSignal: request.abortSignal,
      correlation: request.correlation,
      observer: request.observer,
      modelInvocationId: request.modelInvocationId,
      modelInvocation: request.modelInvocation,
    };
    if (this.captureRequests) this.requests.push(captured);
    if (request.abortSignal?.aborted) {
      const error = new Error("model request aborted");
      error.name = "AbortError";
      throw error;
    }
    const value = request.schema.parse(await this.handler(captured));
    const modelInvocation = request.modelInvocation ?? 1;
    const modelInvocationId = request.modelInvocationId ??
      `${request.workloadId}:${request.batchId}:${request.role}:${request.subjectId}:${modelInvocation}`;
    const contextJson = JSON.stringify(context, null, 2);
    const requestDocument = { system: request.system, context };
    const responseJson = JSON.stringify(canonicalize(value));
    return {
      value,
      audit: {
        role: request.role,
        subjectId: request.subjectId,
        profileId: request.profileId,
        providerId: profile.provider_id,
        modelId: profile.model,
        catalogSchemaVersion: this.catalog.schemaVersion,
        catalogHash: this.catalog.hash,
        promptVersion: request.promptVersion,
        inference: structuredClone(profile.inference),
        structuredOutputMode: "deterministic-test",
        invocations: [{
          id: modelInvocationId,
          ordinal: modelInvocation,
          requestHash: contentHash(requestDocument),
          responseHash: contentHash(value),
          requestUtf8Bytes: Buffer.byteLength(JSON.stringify(requestDocument, null, 2), "utf8"),
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
          tokenUsage: {
            input: null,
            output: null,
            reasoning: null,
            cacheRead: null,
            cacheWrite: null,
          },
          finishReason: "stop",
          providerRequestId: null,
          resultKind: null,
          semanticOutcome: "accepted",
          validationIssueCodes: [],
        }],
      },
    };
  }
}

export function deterministicModelOutput(profileId: string, context: unknown): unknown {
  const input = context as {
    revision?: number;
    step?: number;
    baseRevision?: number;
    agent?: { id: string };
    world?: { laws: Array<{ id: string }> };
    agentEpistemics?: Record<string, unknown>;
    jointActions?: Array<{ id: string }>;
  };
  if (profileId === "truth-engine" || profileId === "truth-deepseek") {
    const step = input.step;
    const revision = input.baseRevision;
    const lawId = input.world?.laws[0]?.id;
    const actions = input.jointActions;
    if (step === undefined || revision === undefined || !lawId || !actions) {
      throw new Error("deterministic Truth Engine context is incomplete");
    }
    const nextStep = step + 1;
    const eventId = `mock-event:${nextStep}`;
    const observers = ["player", ...Object.keys(input.agentEpistemics ?? {})];
    return {
      kind: "transition",
      proposal: {
        baseRevision: revision,
        outcomes: actions.map((action) => ({
          proposalId: action.id,
          status: "succeeded",
          summary: "模拟 Truth Engine 已联合裁决行动。",
          causeRefs: [{ kind: "action", id: action.id }],
          knownAlternatives: [],
        })),
        operations: [{ kind: "advance_time", seconds: 1, causes: [{ kind: "law", id: lawId }] }],
        events: [{
          id: eventId,
          step: nextStep,
          description: "模拟世界推进了一秒。",
          impact: "ordinary",
          causes: [{ kind: "law", id: lawId }],
        }],
        observations: observers.map((observerId) => ({
          id: `mock-observation:${observerId}:${nextStep}`,
          observerId,
          step: nextStep,
          kind: "outcome",
          summary: observerId === "player" ? "世界回应了你的自由行动。" : "世界继续变化。",
          introductions: [],
          apparentClaims: [],
          sourceEventIds: [eventId],
        })),
        intentStatus: "completed",
        requiresPlayerDecision: false,
      },
    };
  }
  const agentId = input.agent?.id;
  const revision = input.revision;
  if (!agentId || revision === undefined) throw new Error("deterministic AgentMind context is incomplete");
  return {
    beliefPatch: { agentId, baseRevision: revision, operations: [] },
    characterPatch: { agentId, baseRevision: revision, operations: [] },
    nextAction: {
      id: `mock-action:${agentId}:${revision}`,
      actorId: agentId,
      baseRevision: revision,
      rawText: "维持当前目标并观察世界",
      goal: "继续自主行动",
      means: null,
      targetIds: [],
    },
  };
}

export class DeterministicModelProvider extends ScriptedModelProvider {
  constructor(catalog = createTestModelCatalog(), captureRequests = true) {
    super(({ profileId, context }) => deterministicModelOutput(profileId, context), catalog, captureRequests);
  }
}
