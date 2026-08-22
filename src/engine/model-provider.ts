import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { generateObject } from "ai";
import type { z } from "zod";

export interface StructuredModelRequest<T> {
  profileId: string;
  system: string;
  prompt: string;
  schema: z.ZodType<T>;
}

export interface StructuredModelProvider {
  generateObject<T>(request: StructuredModelRequest<T>): Promise<T>;
}

export type ScriptedModelHandler = (request: Omit<StructuredModelRequest<unknown>, "schema">) => unknown | Promise<unknown>;

export class ScriptedModelProvider implements StructuredModelProvider {
  readonly requests: Array<Omit<StructuredModelRequest<unknown>, "schema">> = [];

  constructor(private readonly handler: ScriptedModelHandler) {}

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
}

export function modelProviderOptionsFromEnv(env: NodeJS.ProcessEnv): VercelModelProviderOptions {
  const defaultModel = env.CHATGAME_LLM_MODEL ?? "gpt-4o-mini";
  return {
    baseUrl: env.CHATGAME_LLM_BASE_URL ?? "https://api.openai.com/v1",
    apiKey: env.CHATGAME_LLM_API_KEY,
    defaultModel,
    profileModels: {
      "truth-engine": env.CHATGAME_TRUTH_MODEL ?? defaultModel,
      "agent-default": env.CHATGAME_AGENT_MODEL ?? defaultModel,
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

  async generateObject<T>(request: StructuredModelRequest<T>): Promise<T> {
    const modelName = this.options.profileModels[request.profileId] ?? this.options.defaultModel;
    const result = await generateObject({
      model: this.provider(modelName),
      system: request.system,
      prompt: request.prompt,
      schema: request.schema,
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
