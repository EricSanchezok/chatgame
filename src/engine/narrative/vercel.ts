// Vercel AI SDK v7 provider adapter. Isolates the engine from the AI SDK
// API surface (which evolves across major versions — the adapter is the
// only place that imports `ai`). Uses `generateObject` with a zod schema
// for structured output, routed through an OpenAI-compatible endpoint by
// default (env-configurable).
import { z } from "zod";
import { generateObject } from "ai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LLMProvider, GenerateObjectOptions, GenerateTextOptions } from "./provider";

export interface VercelProviderOptions {
  baseUrl?: string;
  apiKey?: string;
  model?: string;
}

/** Reads env config with sane defaults. */
export function vercelOptionsFromEnv(env: NodeJS.ProcessEnv): VercelProviderOptions {
  return {
    baseUrl: env.CHATGAME_LLM_BASE_URL ?? "https://api.openai.com/v1",
    apiKey: env.CHATGAME_LLM_API_KEY,
    model: env.CHATGAME_LLM_MODEL ?? "gpt-4o-mini",
  };
}

export class VercelProvider implements LLMProvider {
  private readonly model;

  constructor(options: VercelProviderOptions | NodeJS.ProcessEnv) {
    const opts: VercelProviderOptions =
      "baseUrl" in options || "model" in options
        ? (options as VercelProviderOptions)
        : vercelOptionsFromEnv(options as NodeJS.ProcessEnv);
    const provider = createOpenAICompatible({
      name: "chatgame-llm",
      baseURL: opts.baseUrl ?? "https://api.openai.com/v1",
      apiKey: opts.apiKey,
    });
    this.model = provider(opts.model ?? "gpt-4o-mini");
  }

  async generateObject<T>(options: GenerateObjectOptions<T>): Promise<T> {
    const result = await generateObject({
      model: this.model,
      system: options.system,
      prompt: options.prompt,
      schema: options.schema,
    });
    return result.object as T;
  }

  async generateText(options: GenerateTextOptions): Promise<string> {
    const result = await generateObject({
      model: this.model,
      system: options.system,
      prompt: options.prompt,
      schema: z.object({ text: z.string() }),
    });
    return (result.object as { text: string }).text;
  }
}
