import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createXai } from "@ai-sdk/xai";
import { generateText, Output } from "ai";
import { z } from "zod";
import type { ModelProviderConfig, ModelProfileConfig } from "./model-catalog";
import type { ModelExecutionAudit } from "./model";
import type { StructuredModelRequest } from "./model-provider";
import { ModelOutputError } from "./model-provider";

export interface ModelAdapterResult {
  value: unknown;
  responseId: string;
  responseModelId: string;
  finishReason: string;
  tokenUsage: ModelExecutionAudit["tokenUsage"];
}

export interface ModelProviderAdapter {
  readonly kind: ModelProviderConfig["kind"];
  readonly structuredOutputMode: ModelExecutionAudit["structuredOutputMode"];
  generate<T>(
    profile: ModelProfileConfig,
    request: StructuredModelRequest<T>,
    contextJson: string,
  ): Promise<ModelAdapterResult>;
}

function schemaExample(schema: unknown, root = schema, seen = new Set<unknown>()): unknown {
  if (!schema || typeof schema !== "object") return null;
  if (seen.has(schema)) return null;
  seen.add(schema);
  const node = schema as Record<string, unknown>;
  if ("const" in node) return node.const;
  if (Array.isArray(node.enum) && node.enum.length > 0) return node.enum[0];
  if (typeof node.$ref === "string" && node.$ref.startsWith("#/$defs/")) {
    const name = node.$ref.slice("#/$defs/".length);
    const definitions = (root as Record<string, unknown>).$defs as Record<string, unknown> | undefined;
    return schemaExample(definitions?.[name], root, seen);
  }
  const alternatives = (node.anyOf ?? node.oneOf) as unknown[] | undefined;
  if (Array.isArray(alternatives) && alternatives.length > 0) {
    const nonNull = alternatives.find((entry) =>
      !(entry && typeof entry === "object" && (entry as Record<string, unknown>).type === "null"));
    return schemaExample(nonNull ?? alternatives[0], root, seen);
  }
  if (node.type === "object" || node.properties) {
    const properties = (node.properties ?? {}) as Record<string, unknown>;
    return Object.fromEntries(Object.entries(properties).map(([key, value]) => [
      key,
      schemaExample(value, root, new Set(seen)),
    ]));
  }
  if (node.type === "array") return [schemaExample(node.items, root, new Set(seen))];
  if (node.type === "string") return "string";
  if (node.type === "integer" || node.type === "number") return 0;
  if (node.type === "boolean") return false;
  return null;
}

function deepSeekPrompt<T>(request: StructuredModelRequest<T>, contextJson: string): string {
  const jsonSchema = z.toJSONSchema(request.schema, { target: "draft-07" });
  return [
    contextJson,
    "",
    "Return exactly one json object. Do not use Markdown or explanatory prose.",
    `JSON Schema: ${JSON.stringify(jsonSchema)}`,
    `Example JSON output shape: ${JSON.stringify(schemaExample(jsonSchema))}`,
  ].join("\n");
}

function usageFrom(result: Awaited<ReturnType<typeof generateText>>): ModelExecutionAudit["tokenUsage"] {
  return {
    input: result.usage.inputTokens ?? null,
    output: result.usage.outputTokens ?? null,
    reasoning: result.usage.outputTokenDetails.reasoningTokens ?? null,
    cacheRead: result.usage.inputTokenDetails.cacheReadTokens ?? null,
    cacheWrite: result.usage.inputTokenDetails.cacheWriteTokens ?? null,
  };
}

class DeepSeekModelAdapter implements ModelProviderAdapter {
  readonly kind = "deepseek" as const;
  readonly structuredOutputMode = "json-object-zod" as const;
  private readonly client: ReturnType<typeof createOpenAICompatible>;

  constructor(
    provider: Extract<ModelProviderConfig, { kind: "deepseek" }>,
    apiKey: string,
    fetchImplementation?: typeof fetch,
  ) {
    this.client = createOpenAICompatible({
      name: "deepseek",
      baseURL: provider.base_url,
      apiKey,
      fetch: fetchImplementation,
    });
  }

  async generate<T>(
    profile: ModelProfileConfig,
    request: StructuredModelRequest<T>,
    contextJson: string,
  ): Promise<ModelAdapterResult> {
    const inference = profile.inference;
    if (inference.kind !== "deepseek-thinking" && inference.kind !== "deepseek-non-thinking") {
      throw new Error(`profile ${request.profileId} has invalid DeepSeek inference settings`);
    }
    const result = await generateText({
      model: this.client(profile.model),
      system: request.system,
      prompt: deepSeekPrompt(request, contextJson),
      maxOutputTokens: profile.max_output_tokens,
      temperature: inference.kind === "deepseek-non-thinking" ? inference.temperature ?? undefined : undefined,
      topP: inference.kind === "deepseek-non-thinking" ? inference.top_p ?? undefined : undefined,
      providerOptions: {
        deepseek: {
          response_format: { type: "json_object" },
          thinking: { type: inference.kind === "deepseek-thinking" ? "enabled" : "disabled" },
          ...(inference.kind === "deepseek-thinking" ? { reasoningEffort: inference.effort } : {}),
        },
      },
      maxRetries: 0,
      timeout: profile.request_timeout_ms,
      abortSignal: request.abortSignal,
    });
    if (!result.text.trim()) throw new ModelOutputError("DeepSeek returned empty JSON content");
    if (result.finishReason === "length") throw new ModelOutputError("DeepSeek JSON output was truncated");
    let parsed: unknown;
    try {
      parsed = JSON.parse(result.text);
    } catch (error) {
      throw new ModelOutputError("DeepSeek returned invalid JSON content", undefined, { cause: error });
    }
    return {
      value: parsed,
      responseId: result.response.id,
      responseModelId: result.response.modelId,
      finishReason: result.finishReason,
      tokenUsage: usageFrom(result),
    };
  }
}

class OpenAIModelAdapter implements ModelProviderAdapter {
  readonly kind = "openai" as const;
  readonly structuredOutputMode = "json-schema-strict" as const;
  private readonly client: ReturnType<typeof createOpenAI>;

  constructor(
    provider: Extract<ModelProviderConfig, { kind: "openai" }>,
    apiKey: string,
    fetchImplementation?: typeof fetch,
  ) {
    this.client = createOpenAI({ baseURL: provider.base_url, apiKey, fetch: fetchImplementation });
  }

  async generate<T>(
    profile: ModelProfileConfig,
    request: StructuredModelRequest<T>,
    contextJson: string,
  ): Promise<ModelAdapterResult> {
    if (profile.inference.kind !== "openai-reasoning") {
      throw new Error(`profile ${request.profileId} has invalid OpenAI inference settings`);
    }
    const result = await generateText({
      model: this.client.responses(profile.model),
      system: request.system,
      prompt: contextJson,
      output: Output.object({ schema: request.schema, name: request.schemaName }),
      maxOutputTokens: profile.max_output_tokens,
      providerOptions: {
        openai: {
          reasoningEffort: profile.inference.effort,
          reasoningSummary: profile.inference.summary ?? undefined,
          textVerbosity: profile.inference.text_verbosity ?? undefined,
          strictJsonSchema: true,
          store: false,
        },
      },
      maxRetries: 0,
      timeout: profile.request_timeout_ms,
      abortSignal: request.abortSignal,
    });
    return {
      value: request.schema.parse(result.output),
      responseId: result.response.id,
      responseModelId: result.response.modelId,
      finishReason: result.finishReason,
      tokenUsage: usageFrom(result),
    };
  }
}

class XaiModelAdapter implements ModelProviderAdapter {
  readonly kind = "xai" as const;
  readonly structuredOutputMode = "json-schema-strict" as const;
  private readonly client: ReturnType<typeof createXai>;

  constructor(
    provider: Extract<ModelProviderConfig, { kind: "xai" }>,
    apiKey: string,
    fetchImplementation?: typeof fetch,
  ) {
    this.client = createXai({ baseURL: provider.base_url, apiKey, fetch: fetchImplementation });
  }

  async generate<T>(
    profile: ModelProfileConfig,
    request: StructuredModelRequest<T>,
    contextJson: string,
  ): Promise<ModelAdapterResult> {
    if (profile.inference.kind !== "xai-reasoning") {
      throw new Error(`profile ${request.profileId} has invalid xAI inference settings`);
    }
    const result = await generateText({
      model: this.client.responses(profile.model),
      system: request.system,
      prompt: contextJson,
      output: Output.object({ schema: request.schema, name: request.schemaName }),
      maxOutputTokens: profile.max_output_tokens,
      providerOptions: {
        xai: {
          reasoningEffort: profile.inference.effort,
          reasoningSummary: profile.inference.summary ?? undefined,
          store: false,
        },
      },
      maxRetries: 0,
      timeout: profile.request_timeout_ms,
      abortSignal: request.abortSignal,
    });
    return {
      value: request.schema.parse(result.output),
      responseId: result.response.id,
      responseModelId: result.response.modelId,
      finishReason: result.finishReason,
      tokenUsage: usageFrom(result),
    };
  }
}

export function createModelProviderAdapter(
  provider: ModelProviderConfig,
  apiKey: string,
  fetchImplementation?: typeof fetch,
): ModelProviderAdapter {
  switch (provider.kind) {
    case "deepseek":
      return new DeepSeekModelAdapter(provider, apiKey, fetchImplementation);
    case "openai":
      return new OpenAIModelAdapter(provider, apiKey, fetchImplementation);
    case "xai":
      return new XaiModelAdapter(provider, apiKey, fetchImplementation);
    default: {
      const unsupported: never = provider;
      throw new Error(`unsupported model provider: ${String(unsupported)}`);
    }
  }
}
