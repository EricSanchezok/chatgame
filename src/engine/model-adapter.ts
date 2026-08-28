import { generateText, Output, tool } from "ai";
import { z } from "zod";
import type { ModelExecutionAudit, ModelTokenUsage } from "./model";
import { vendorDialect, type VendorDialectRequestPlan } from "./model-dialect";
import { protocolDriver } from "./model-protocol";
import type { ResolvedModelBinding } from "./model-registry";
import type { StructuredModelRequest } from "./model-provider";
import { ModelOutputError } from "./model-provider";

export interface ModelAdapterResult {
  value: unknown;
  responseId: string;
  responseModelId: string;
  finishReason: string;
  tokenUsage: ModelTokenUsage;
  resolvedInference: import("./model-catalog").ResolvedModelInference;
  structuredOutputMode: ModelExecutionAudit["structuredOutputMode"];
}

export interface ModelProviderAdapter {
  readonly accountId: string;
  readonly protocol: import("./model-catalog").ModelProtocol;
  readonly dialect: string;
  describe<T>(
    binding: ResolvedModelBinding,
    request: StructuredModelRequest<T>,
  ): Pick<ModelAdapterResult, "resolvedInference" | "structuredOutputMode">;
  generate<T>(
    binding: ResolvedModelBinding,
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
    const required = new Set(Array.isArray(node.required)
      ? node.required.filter((value): value is string => typeof value === "string")
      : []);
    return Object.fromEntries(Object.entries(properties)
      .filter(([key]) => required.has(key))
      .map(([key, value]) => [key, schemaExample(value, root, new Set(seen))]));
  }
  if (node.type === "array") {
    const minimum = typeof node.minItems === "number" && Number.isSafeInteger(node.minItems)
      ? Math.max(0, node.minItems)
      : 0;
    return Array.from({ length: minimum }, () => schemaExample(node.items, root, new Set(seen)));
  }
  if (node.type === "string") return "string";
  if (node.type === "integer" || node.type === "number") return 0;
  if (node.type === "boolean") return false;
  return null;
}

function jsonObjectPrompt<T>(request: StructuredModelRequest<T>, contextJson: string): string {
  const jsonSchema = z.toJSONSchema(request.schema, { target: "draft-07" });
  return [
    contextJson,
    "",
    "Return exactly one JSON object matching the supplied schema. Do not use Markdown or explanatory prose.",
    `JSON Schema: ${JSON.stringify(jsonSchema)}`,
    `Example JSON output shape: ${JSON.stringify(schemaExample(jsonSchema))}`,
  ].join("\n");
}

function toolCallPrompt(contextJson: string): string {
  return [
    contextJson,
    "",
    "Call submit_result exactly once with the complete structured result.",
  ].join("\n");
}

function usageFrom(result: {
  usage: {
    inputTokens?: number;
    outputTokens?: number;
    outputTokenDetails: { reasoningTokens?: number };
    inputTokenDetails: { cacheReadTokens?: number; cacheWriteTokens?: number };
  };
}): ModelTokenUsage {
  return {
    input: result.usage.inputTokens ?? null,
    output: result.usage.outputTokens ?? null,
    reasoning: result.usage.outputTokenDetails.reasoningTokens ?? null,
    cacheRead: result.usage.inputTokenDetails.cacheReadTokens ?? null,
    cacheWrite: result.usage.inputTokenDetails.cacheWriteTokens ?? null,
  };
}

export function structuredOutputMode(
  binding: ResolvedModelBinding,
): Exclude<ModelExecutionAudit["structuredOutputMode"], "deterministic-test"> {
  if (binding.account.protocol === "anthropic-messages") {
    if (binding.model.toolCall) return "tool-call-zod";
    throw new Error(`model ${binding.modelId} cannot produce verified structured output`);
  }
  if (binding.model.structuredOutput) {
    return binding.account.dialect === "deepseek" ? "json-object-zod" : "json-schema-strict";
  }
  if (binding.model.toolCall) return "tool-call-zod";
  throw new Error(`model ${binding.modelId} cannot produce verified structured output`);
}

function dialectFetch(
  baseFetch: typeof fetch,
  plan: VendorDialectRequestPlan,
): typeof fetch {
  return async (input, init) => {
    const headers = new Headers(init?.headers);
    for (const [name, value] of Object.entries(plan.headers)) headers.set(name, value);
    let body = init?.body;
    if (typeof body === "string") {
      let parsed: unknown;
      try {
        parsed = JSON.parse(body);
      } catch (error) {
        throw new Error("model protocol driver produced a non-JSON request body", { cause: error });
      }
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("model protocol driver produced an invalid request body");
      }
      body = JSON.stringify(plan.transformBody(parsed as Record<string, unknown>));
    }
    return baseFetch(input, { ...init, headers, body });
  };
}

class ProtocolModelAdapter implements ModelProviderAdapter {
  readonly accountId: string;
  readonly protocol: import("./model-catalog").ModelProtocol;
  readonly dialect: string;

  constructor(
    accountId: string,
    private readonly apiKey: string,
    private readonly fetchImplementation: typeof fetch,
    account: import("./model-catalog").ProviderAccountConfig,
  ) {
    this.accountId = accountId;
    this.protocol = account.protocol;
    this.dialect = account.dialect;
    vendorDialect(account.dialect, account.protocol);
    protocolDriver(account.protocol);
  }

  describe<T>(
    binding: ResolvedModelBinding,
    request: StructuredModelRequest<T>,
  ): Pick<ModelAdapterResult, "resolvedInference" | "structuredOutputMode"> {
    if (binding.accountId !== this.accountId) {
      throw new Error(`model adapter ${this.accountId} received binding for ${binding.accountId}`);
    }
    return {
      structuredOutputMode: structuredOutputMode(binding),
      resolvedInference: vendorDialect(binding.account.dialect, binding.account.protocol)
        .compile(binding, request).inference,
    };
  }

  async generate<T>(
    binding: ResolvedModelBinding,
    request: StructuredModelRequest<T>,
    contextJson: string,
  ): Promise<ModelAdapterResult> {
    if (binding.accountId !== this.accountId) {
      throw new Error(`model adapter ${this.accountId} received binding for ${binding.accountId}`);
    }
    const mode = structuredOutputMode(binding);
    const dialect = vendorDialect(binding.account.dialect, binding.account.protocol);
    const plan = dialect.compile(binding, request);
    const transportPlan: VendorDialectRequestPlan = mode === "json-object-zod"
      ? {
          ...plan,
          transformBody(body) {
            return { ...plan.transformBody(body), response_format: { type: "json_object" } };
          },
        }
      : plan;
    const driver = protocolDriver(binding.account.protocol);
    const model = driver.createModel(binding, {
      apiKey: this.apiKey,
      fetch: dialectFetch(this.fetchImplementation, transportPlan),
      authentication: plan.authentication,
      structuredOutputMode: mode,
    });
    const common = {
      model,
      system: request.system,
      maxOutputTokens: binding.profile.max_output_tokens,
      temperature: plan.inference.temperature ?? undefined,
      topP: plan.inference.topP ?? undefined,
      maxRetries: 0,
      timeout: binding.profile.request_timeout_ms,
      abortSignal: request.abortSignal,
    } as const;

    if (mode === "json-schema-strict") {
      const result = await generateText({
        ...common,
        prompt: contextJson,
        output: Output.object({ schema: request.schema, name: request.schemaName }),
      });
      return {
        value: request.schema.parse(result.output),
        responseId: result.response.id,
        responseModelId: result.response.modelId,
        finishReason: result.finishReason,
        tokenUsage: usageFrom(result),
        resolvedInference: plan.inference,
        structuredOutputMode: mode,
      };
    }

    if (mode === "json-object-zod") {
      const result = await generateText({
        ...common,
        prompt: jsonObjectPrompt(request, contextJson),
      });
      if (!result.text.trim()) {
        throw new ModelOutputError(`${binding.accountId} returned empty JSON content`);
      }
      if (result.finishReason === "length") {
        throw new ModelOutputError(`${binding.accountId} JSON output was truncated`);
      }
      let value: unknown;
      try {
        value = JSON.parse(result.text);
      } catch (error) {
        throw new ModelOutputError(`${binding.accountId} returned invalid JSON content`, undefined, {
          cause: error,
        });
      }
      return {
        value: request.schema.parse(value),
        responseId: result.response.id,
        responseModelId: result.response.modelId,
        finishReason: result.finishReason,
        tokenUsage: usageFrom(result),
        resolvedInference: plan.inference,
        structuredOutputMode: mode,
      };
    }

    const result = await generateText({
      ...common,
      prompt: toolCallPrompt(contextJson),
      tools: {
        submit_result: tool({
          description: `Submit one ${request.schemaName} result.`,
          inputSchema: request.schema,
        }),
      },
      toolChoice: { type: "tool", toolName: "submit_result" },
    });
    const calls = result.toolCalls.filter((call) => call.toolName === "submit_result");
    if (calls.length !== 1) {
      throw new ModelOutputError(
        `${binding.accountId} returned ${calls.length} submit_result tool calls; expected exactly one`,
      );
    }
    return {
      value: request.schema.parse(calls[0]!.input),
      responseId: result.response.id,
      responseModelId: result.response.modelId,
      finishReason: result.finishReason,
      tokenUsage: usageFrom(result),
      resolvedInference: plan.inference,
      structuredOutputMode: mode,
    };
  }
}

export function createModelProviderAdapter(
  accountId: string,
  account: import("./model-catalog").ProviderAccountConfig,
  apiKey: string,
  fetchImplementation: typeof fetch = fetch,
): ModelProviderAdapter {
  return new ProtocolModelAdapter(accountId, apiKey, fetchImplementation, account);
}

export function validateModelProviderAccount(
  account: import("./model-catalog").ProviderAccountConfig,
): void {
  vendorDialect(account.dialect, account.protocol);
  protocolDriver(account.protocol);
}
