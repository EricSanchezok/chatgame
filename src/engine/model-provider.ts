import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { generateObject } from "ai";
import { z } from "zod";

export interface StructuredModelRequest<T> {
  profileId: string;
  system: string;
  prompt: string;
  schema: z.ZodType<T>;
}

export interface StructuredModelProvider {
  generateObject<T>(request: StructuredModelRequest<T>): Promise<T>;
  describe(profileId: string): ModelProfileDescriptor;
}

export interface ModelProfileDescriptor {
  providerId: string;
  modelId: string;
}

export type ScriptedModelHandler = (request: Omit<StructuredModelRequest<unknown>, "schema">) => unknown | Promise<unknown>;

export class ScriptedModelProvider implements StructuredModelProvider {
  readonly requests: Array<Omit<StructuredModelRequest<unknown>, "schema">> = [];

  constructor(
    private readonly handler: ScriptedModelHandler,
    private readonly descriptor: ModelProfileDescriptor = {
      providerId: "scripted",
      modelId: "scripted-structured-output",
    },
  ) {}

  describe(): ModelProfileDescriptor {
    return { ...this.descriptor };
  }

  async generateObject<T>(request: StructuredModelRequest<T>): Promise<T> {
    const captured = {
      profileId: request.profileId,
      system: request.system,
      prompt: request.prompt,
    };
    this.requests.push(captured);
    const value = await this.handler(captured);
    return request.schema.parse(value);
  }
}

export class DeterministicModelProvider implements StructuredModelProvider {
  describe(profileId: string): ModelProfileDescriptor {
    return { providerId: "deterministic", modelId: `deterministic:${profileId}` };
  }

  async generateObject<T>(request: StructuredModelRequest<T>): Promise<T> {
    const context = JSON.parse(request.prompt) as {
      revision?: number;
      step?: number;
      agent?: { id: string };
      baseRevision?: number;
      world?: { laws: Array<{ id: string }> };
      agentEpistemics?: Record<string, unknown>;
      jointActions?: Array<{ id: string }>;
    };
    const output = request.profileId === "truth-engine"
      ? this.truthOutput(context)
      : this.agentOutput(context);
    return request.schema.parse(output);
  }

  private agentOutput(context: { revision?: number; agent?: { id: string } }): unknown {
    const agentId = context.agent?.id;
    const revision = context.revision;
    if (!agentId || revision === undefined) throw new Error("deterministic AgentMind context is incomplete");
    return {
      beliefPatch: { agentId, baseRevision: revision, operations: [] },
      nextAction: {
        id: `mock-action:${agentId}:${revision}`,
        actorId: agentId,
        baseRevision: revision,
        rawText: "维持当前目标并观察世界",
        goal: "继续自主行动",
        targetIds: [],
      },
    };
  }

  private truthOutput(context: {
    step?: number;
    baseRevision?: number;
    world?: { laws: Array<{ id: string }> };
    agentEpistemics?: Record<string, unknown>;
    jointActions?: Array<{ id: string }>;
  }): unknown {
    const step = context.step;
    const revision = context.baseRevision;
    const lawId = context.world?.laws[0]?.id;
    const actions = context.jointActions;
    if (step === undefined || revision === undefined || !lawId || !actions) {
      throw new Error("deterministic Truth Engine context is incomplete");
    }
    const nextStep = step + 1;
    const eventId = `mock-event:${nextStep}`;
    const observers = ["player", ...Object.keys(context.agentEpistemics ?? {})];
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
        operations: [
          {
            kind: "advance_time",
            seconds: 1,
            causes: [{ kind: "law", id: lawId }],
          },
        ],
        events: [
          {
            id: eventId,
            step: nextStep,
            description: "模拟世界推进了一秒。",
            causes: [{ kind: "law", id: lawId }],
          },
        ],
        observations: observers.map((observerId) => ({
          id: `mock-observation:${observerId}:${nextStep}`,
          observerId,
          step: nextStep,
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
}

export interface VercelModelProviderOptions {
  baseUrl: string;
  apiKey?: string;
  defaultModel: string;
  profileModels: Record<string, string>;
  timeoutMs: number;
}

function parseProfileModels(value: string | undefined): Record<string, string> {
  if (!value) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("CHATGAME_LLM_PROFILE_MODELS must be a JSON object");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("CHATGAME_LLM_PROFILE_MODELS must be a JSON object");
  }
  const result: Record<string, string> = {};
  for (const [profileId, modelId] of Object.entries(parsed)) {
    if (!profileId.trim() || typeof modelId !== "string" || !modelId.trim()) {
      throw new Error("CHATGAME_LLM_PROFILE_MODELS contains an invalid profile mapping");
    }
    result[profileId] = modelId;
  }
  return result;
}

function nonEmpty(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized || undefined;
}

export function modelProviderOptionsFromEnv(
  env: Readonly<Record<string, string | undefined>>,
): VercelModelProviderOptions {
  const deepseekApiKey = nonEmpty(env.DEEPSEEK_API_KEY)
    ?? nonEmpty(env.DEEPSEEKAPIKEY)
    ?? nonEmpty(env.deepseekapikey);
  const configuredApiKey = nonEmpty(env.CHATGAME_LLM_API_KEY);
  const configuredBaseUrl = nonEmpty(env.CHATGAME_LLM_BASE_URL);
  const useDeepseekDefaults = !configuredApiKey && !configuredBaseUrl && Boolean(deepseekApiKey);
  const defaultModel = nonEmpty(env.CHATGAME_LLM_MODEL) ?? (useDeepseekDefaults ? "deepseek-chat" : "gpt-4o-mini");
  const timeoutMs = Number(nonEmpty(env.CHATGAME_LLM_TIMEOUT_MS) ?? "120000");
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 600_000) {
    throw new Error("CHATGAME_LLM_TIMEOUT_MS must be an integer from 1000 to 600000");
  }
  return {
    baseUrl: configuredBaseUrl ?? (useDeepseekDefaults ? "https://api.deepseek.com/v1" : "https://api.openai.com/v1"),
    apiKey: configuredApiKey ?? deepseekApiKey,
    defaultModel,
    timeoutMs,
    profileModels: {
      "truth-engine": nonEmpty(env.CHATGAME_TRUTH_MODEL) ?? defaultModel,
      "agent-default": nonEmpty(env.CHATGAME_AGENT_MODEL) ?? defaultModel,
      ...parseProfileModels(env.CHATGAME_LLM_PROFILE_MODELS),
    },
  };
}

export class VercelModelProvider implements StructuredModelProvider {
  private readonly provider;

  constructor(private readonly options: VercelModelProviderOptions) {
    this.provider = createOpenAICompatible({
      name: "chatgame",
      baseURL: options.baseUrl,
      apiKey: options.apiKey,
    });
  }

  describe(profileId: string): ModelProfileDescriptor {
    return {
      providerId: `openai-compatible:${new URL(this.options.baseUrl).host}`,
      modelId: this.options.profileModels[profileId] ?? this.options.defaultModel,
    };
  }

  async generateObject<T>(request: StructuredModelRequest<T>): Promise<T> {
    const modelName = this.options.profileModels[request.profileId] ?? this.options.defaultModel;
    const schema = z.toJSONSchema(request.schema, { target: "draft-07" });
    const prompt = `${request.prompt}\n\n只返回一个 JSON 对象，不要使用 Markdown 代码块。该对象必须严格满足以下 JSON Schema，不得增加未声明字段：\n${JSON.stringify(schema)}`;
    const result = await generateObject({
      model: this.provider(modelName),
      system: request.system,
      prompt,
      schema: request.schema,
      abortSignal: AbortSignal.timeout(this.options.timeoutMs),
    });
    return result.object as T;
  }
}

export function createStructuredModelProvider(env: NodeJS.ProcessEnv = process.env): StructuredModelProvider {
  const kind = env.CHATGAME_LLM_PROVIDER ?? "vercel";
  if (kind === "mock") return new DeterministicModelProvider();
  if (kind === "vercel") return new VercelModelProvider(modelProviderOptionsFromEnv(env));
  throw new Error(`unsupported CHATGAME_LLM_PROVIDER: ${kind}`);
}
