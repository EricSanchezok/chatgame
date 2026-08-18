// LLM provider interface: the thin adapter isolating the engine from the
// AI SDK (Vercel AI SDK v7) and any provider. The engine only talks to
// this interface — swapping providers (mock / openai-compatible / etc.)
// never touches game logic. I4: the LLM never judges rules; it only
// produces intents, narrative, and descriptions for engine validation.
import type { z } from "zod";
import { MockProvider } from "./mock";
import { VercelProvider } from "./vercel";

export interface GenerateObjectOptions<T> {
  system: string;
  prompt: string;
  schema: z.ZodType<T>;
}

export interface GenerateTextOptions {
  system: string;
  prompt: string;
}

export interface LLMProvider {
  /**
   * Structured output: the model returns data validated by `schema`.
   * Throws on repeated schema failures (caller decides retries).
   */
  generateObject<T>(options: GenerateObjectOptions<T>): Promise<T>;
  /** Free-form text output (used for narration when no structure is needed). */
  generateText(options: GenerateTextOptions): Promise<string>;
}

/** Environment-based provider factory. Default: mock (no API key needed). */
export function createProvider(env: NodeJS.ProcessEnv = process.env): LLMProvider {
  const kind = env.CHATGAME_LLM_PROVIDER ?? "mock";
  switch (kind) {
    case "mock":
      return new MockProvider() as LLMProvider;
    case "vercel":
      return new VercelProvider(env) as LLMProvider;
    default:
      throw new Error(`unknown CHATGAME_LLM_PROVIDER "${kind}" (expected "mock" | "vercel")`);
  }
}
