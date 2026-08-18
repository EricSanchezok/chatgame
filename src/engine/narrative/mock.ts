// Deterministic mock LLM provider — the default. No API key, fully
// deterministic: it returns schema-valid default data via shape-aware
// synthesis, or uses an optional handler for schemas that need custom
// output. This keeps the engine testable without a real model (testing
// first principle: verify design logic).
import type { z } from "zod";
import type { LLMProvider, GenerateObjectOptions, GenerateTextOptions } from "./provider";

/** Optional callback so callers can supply realistic objects per schema. */
export type MockObjectHandler = (prompt: string) => unknown;

/**
 * Shape-aware synthesis: probes the schema with candidate objects matching
 * the engine's known LLM call shapes (intent / narrative / descriptor),
 * then generic defaults. Returns the first schema-valid candidate.
 */
function synthesizeForSchema<T>(schema: z.ZodType<T>): T {
  const candidates: unknown[] = [
    { actionId: "talk" },                       // intent schema
    { narrative: "（模拟叙事）", mechanics_tags: [] }, // narrative schema
    { description: "（模拟描述）" },             // descriptor schema
    {},
    [],
    "",
    "",
    0,
    false,
  ];
  for (const candidate of candidates) {
    const result = schema.safeParse(candidate);
    if (result.success) return result.data;
  }
  throw new Error(`MockProvider: cannot synthesize a value for schema`);
}

export class MockProvider implements LLMProvider {
  constructor(
    private readonly opts: {
      seed?: string;
      onGenerateObject?: MockObjectHandler;
      onGenerateText?: (prompt: string) => string;
    } = {},
  ) {}

  async generateObject<T>(options: GenerateObjectOptions<T>): Promise<T> {
    if (this.opts.onGenerateObject) {
      const data = this.opts.onGenerateObject(options.prompt);
      const parsed = options.schema.safeParse(data);
      if (parsed.success) return parsed.data as T;
    }
    return synthesizeForSchema(options.schema);
  }

  async generateText(options: GenerateTextOptions): Promise<string> {
    if (this.opts.onGenerateText) {
      return this.opts.onGenerateText(options.prompt);
    }
    const head = options.prompt.slice(0, 120).replace(/\s+/g, " ").trim();
    return `（模拟叙事）${head || "世界安静地运转着。"}`;
  }
}
