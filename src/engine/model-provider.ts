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
  if (kind !== "vercel") {
    throw new Error(`unsupported CHATGAME_LLM_PROVIDER: ${kind}`);
  }
  return new VercelModelProvider(modelProviderOptionsFromEnv(env));
}
