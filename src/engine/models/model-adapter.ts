import { generateText, Output, tool } from "ai";
import { JSONRepairError, jsonrepair } from "jsonrepair";
import { z } from "zod";
import type { ModelExecutionAudit, ModelTokenUsage } from "../contracts/model";
import { vendorDialect, type VendorDialectRequestPlan } from "./model-dialect";
import { protocolDriver } from "./model-protocol";
import type { ResolvedModelBinding } from "./model-registry";
import type { StructuredModelRequest } from "./model-provider";
import { ModelOutputError } from "./model-provider";
import {
  composeContextEnvelope,
  composeJsonObjectPrompt,
  composeToolCallPrompt,
  discriminatorInstruction,
  toolDescription,
} from "../prompts";
import {
  runtimeEventEmitter,
  type RuntimeCorrelation,
  type RuntimeObserver,
} from "../runtime/observability";

export interface ModelAdapterResult {
  value: unknown;
  responseId: string;
  responseModelId: string;
  finishReason: string;
  tokenUsage: ModelTokenUsage;
  resolvedInference: import("./model-catalog").ResolvedModelInference;
  structuredOutputMode: ModelExecutionAudit["structuredOutputMode"];
  jsonRecovery: "strict" | "top-level-correction" | "syntax-repair";
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
    transportCorrelation?: RuntimeCorrelation,
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

export type JsonRecoveryKind = ModelAdapterResult["jsonRecovery"];

export class ModelJsonParseError extends SyntaxError {
  readonly position: number | null;
  readonly line: number | null;
  readonly column: number | null;

  constructor(message: string, position: number | null, text: string, cause?: unknown) {
    super(message);
    this.name = "ModelJsonParseError";
    this.position = position;
    if (position === null) {
      this.line = null;
      this.column = null;
    } else {
      const before = text.slice(0, position);
      this.line = before.split("\n").length;
      this.column = position - before.lastIndexOf("\n");
    }
    if (cause !== undefined) Object.defineProperty(this, "cause", { value: cause });
  }
}

interface JsonTopLevelCandidate {
  value: unknown;
}

/**
 * Find complete top-level JSON values without ever treating an object nested
 * inside a malformed root as a replacement for that root. This preserves the
 * historical "last complete correction wins" behavior for responses such as
 * `{...}\nexplanation\n{...}`, while preventing the a435 failure mode where a
 * single slot object was mistaken for an AgentMind batch.
 */
function strictTopLevelCandidates(text: string): JsonTopLevelCandidate[] {
  const candidates: JsonTopLevelCandidate[] = [];
  let cursor = 0;
  while (cursor < text.length) {
    let start = cursor;
    while (start < text.length && text[start] !== "{" && text[start] !== "[") start += 1;
    if (start >= text.length) break;
    const end = balancedJsonEnd(text, start);
    // A root that cannot be balanced owns all of its descendants. Stop here;
    // scanning farther would be the unsafe nested-object salvage we removed.
    if (end === null) break;
    try {
      candidates.push({ value: JSON.parse(text.slice(start, end)) });
      cursor = end;
    } catch {
      // A balanced candidate can still contain invalid JSON syntax. Treat it
      // as the malformed root instead of searching inside it.
      break;
    }
  }
  return candidates;
}

function parseErrorPosition(error: unknown): number | null {
  if (error && typeof error === "object" && "position" in error &&
    typeof (error as { position?: unknown }).position === "number") {
    return (error as { position: number }).position;
  }
  const message = error instanceof Error ? error.message : String(error);
  const match = /position\s+(\d+)/u.exec(message);
  return match ? Number(match[1]) : null;
}

/**
 * Parse provider JSON with strict parsing first and a bounded syntax-repair
 * fallback. `jsonrepair` is intentionally applied only when the response
 * starts with a JSON object/array; it never turns arbitrary prose into a JSON
 * string. Every recovered value still passes the caller's Zod and semantic
 * gates. The return value keeps the legacy last-top-level-correction contract.
 */
export function parseLastJsonValueWithRecovery(text: string): { value: unknown; recovery: JsonRecoveryKind } {
  const source = text.replace(/^\uFEFF/u, "").trim();
  try {
    return { value: JSON.parse(source), recovery: "strict" };
  } catch (strictError) {
    const candidates = strictTopLevelCandidates(source);
    if (candidates.length > 0) {
      return { value: candidates.at(-1)!.value, recovery: "top-level-correction" };
    }
    const firstNonWhitespace = source.search(/\S/u);
    const opening = firstNonWhitespace >= 0 ? source[firstNonWhitespace] : undefined;
    if (opening !== "{" && opening !== "[") throw strictError;
    try {
      const repairedText = jsonrepair(source);
      let repairedValue: unknown = JSON.parse(repairedText);
      // jsonrepair wraps concatenated top-level values in an array. If the
      // source began with an object, the only contract-compatible choice is
      // the last top-level value; an intended JSON array keeps its full array.
      if (opening === "{" && Array.isArray(repairedValue)) {
        const last = repairedValue.at(-1);
        if (last === undefined) throw new JSONRepairError("repaired JSON has no top-level value", repairedText.length);
        repairedValue = last;
      }
      return { value: repairedValue, recovery: "syntax-repair" };
    } catch (repairError) {
      const position = parseErrorPosition(repairError) ?? parseErrorPosition(strictError);
      const line = position === null ? "unknown line" : String(source.slice(0, position).split("\n").length);
      const column = position === null ? "unknown column" : String(position - source.slice(0, position).lastIndexOf("\n"));
      throw new ModelJsonParseError(
        `invalid JSON content at ${line}, ${column}; no safe top-level value could be recovered`,
        position,
        source,
        repairError,
      );
    }
  }
}

/** Backward-compatible parser entry point used by model adapter tests/tools. */
export function parseLastJsonValue(text: string): unknown {
  return parseLastJsonValueWithRecovery(text).value;
}

function balancedJsonEnd(text: string, start: number): number | null {
  const opening = text[start];
  if (opening !== "{" && opening !== "[") return null;
  const expectedClosers: string[] = [];
  let inString = false;

  for (let index = start; index < text.length; index += 1) {
    const character = text[index];
    if (inString) {
      if (character === "\\") {
        index += 1;
      } else if (character === '"') {
        inString = false;
      }
      continue;
    }
    if (character === '"') {
      inString = true;
      continue;
    }
    if (character === "{") {
      expectedClosers.push("}");
      continue;
    }
    if (character === "[") {
      expectedClosers.push("]");
      continue;
    }
    if (character !== "}" && character !== "]") continue;
    if (expectedClosers.pop() !== character) return null;
    if (expectedClosers.length === 0) return index + 1;
  }
  return null;
}

function parseStructuredValue<T>(
  schema: z.ZodType<T>,
  value: unknown,
  accountId: string,
): T {
  try {
    return schema.parse(value);
  } catch (error) {
    if (!(error instanceof z.ZodError)) throw error;
    const kind = value && typeof value === "object" && !Array.isArray(value) &&
      typeof (value as Record<string, unknown>).kind === "string"
      ? (value as Record<string, unknown>).kind
      : null;
    const suffix = kind === null ? "" : ` (received kind ${JSON.stringify(kind)})`;
    throw new ModelOutputError(
      `${accountId} returned structured output that failed schema validation${suffix}`,
      undefined,
      { cause: error, rawValue: value },
    );
  }
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
  if (binding.account.dialect === "qwen") {
    // The campus vLLM gateway supports JSON mode consistently across the
    // engine's heterogeneous schemas. Strict JSON Schema can make vLLM pick
    // different structured-output backends (xgrammar/guidance) between
    // requests, while local Zod validation preserves the same semantic gate.
    return "json-object-zod";
  }
  if (binding.account.dialect === "zhipu" && binding.account.channel === "coding-plan" &&
    binding.model.structuredOutput) {
    // GLM Coding Plan supports JSON mode, while its function-call schema
    // handling is unreliable for top-level discriminated unions. Keep the
    // strict local Zod validation and use the provider's JSON mode transport.
    return "json-object-zod";
  }
  if (binding.model.structuredOutput) {
    // DeepSeek's OpenAI-compatible endpoint reliably honors the JSON-object
    // contract. Keep schema validation local after parsing so the engine never
    // accepts an unverified provider response.
    return binding.account.dialect === "deepseek"
      ? "json-object-zod"
      : "json-schema-strict";
  }
  if (binding.model.toolCall) return "tool-call-zod";
  throw new Error(`model ${binding.modelId} cannot produce verified structured output`);
}

interface RawTransportCapture {
  readonly observer: RuntimeObserver;
  readonly correlation: RuntimeCorrelation;
}

function transportUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

function transportMethod(input: RequestInfo | URL, init?: RequestInit): string {
  if (init?.method) return init.method;
  if (typeof Request !== "undefined" && input instanceof Request) return input.method;
  return "GET";
}

function transportHeaders(headers: Headers): Record<string, string> {
  return Object.fromEntries(headers.entries());
}

function emitRawTransport(
  capture: RawTransportCapture | undefined,
  event: "model.transport.request.raw" | "model.transport.response.raw",
  payload: unknown,
): void {
  if (!capture || capture.observer.mode !== "full") return;
  runtimeEventEmitter(capture.observer)?.({
    event,
    correlation: capture.correlation,
    payload,
  });
}

function dialectFetch(
  baseFetch: typeof fetch,
  plan: VendorDialectRequestPlan,
  capture?: RawTransportCapture,
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
    const requestInput = {
      url: transportUrl(input),
      method: transportMethod(input, init),
      headers: transportHeaders(headers),
      body: typeof body === "string" ? body : body === undefined || body === null ? null : null,
    };
    emitRawTransport(capture, "model.transport.request.raw", requestInput);
    const response = await baseFetch(input, { ...init, headers, body });
    let responseBody: string | null = null;
    try {
      responseBody = await response.clone().text();
    } catch {
      // The provider response remains available to the SDK even if a body
      // cannot be duplicated for diagnostics.
    }
    emitRawTransport(capture, "model.transport.response.raw", {
      url: response.url || requestInput.url,
      status: response.status,
      statusText: response.statusText,
      headers: transportHeaders(response.headers),
      body: responseBody,
    });
    return response;
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
    transportCorrelation?: RuntimeCorrelation,
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
    const rawTransportCapture = request.observer?.mode === "full"
      ? {
          observer: request.observer,
          correlation: transportCorrelation ?? request.correlation ?? {},
        }
      : undefined;
    const driver = protocolDriver(binding.account.protocol);
    const model = driver.createModel(binding, {
      apiKey: this.apiKey,
      fetch: dialectFetch(this.fetchImplementation, transportPlan, rawTransportCapture),
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
        prompt: composeContextEnvelope(request.userPrompt, contextJson),
        output: Output.object({ schema: request.schema, name: request.schemaName }),
      });
      return {
        value: parseStructuredValue(request.schema, result.output, binding.accountId),
        responseId: result.response.id,
        responseModelId: result.response.modelId,
        finishReason: result.finishReason,
        tokenUsage: usageFrom(result),
        resolvedInference: plan.inference,
        structuredOutputMode: mode,
        jsonRecovery: "strict",
      };
    }

    if (mode === "json-object-zod") {
      const result = await generateText({
        ...common,
        prompt: composeJsonObjectPrompt({
          userPrompt: request.userPrompt,
          contextJson,
          schemaJson: JSON.stringify(z.toJSONSchema(request.schema, { target: "draft-07" })),
          exampleJson: JSON.stringify(schemaExample(z.toJSONSchema(request.schema, { target: "draft-07" }))),
          discriminator: discriminatorInstruction(request.schemaName),
        }),
      });
      if (!result.text.trim()) {
        throw new ModelOutputError(`${binding.accountId} returned empty JSON content`);
      }
      if (result.finishReason === "length") {
        throw new ModelOutputError(`${binding.accountId} JSON output was truncated`);
      }
      let value: unknown;
      let jsonRecovery: JsonRecoveryKind;
      try {
        const parsed = parseLastJsonValueWithRecovery(result.text);
        value = parsed.value;
        jsonRecovery = parsed.recovery;
      } catch (error) {
        const detail = error instanceof Error ? `: ${error.message}` : "";
        throw new ModelOutputError(`${binding.accountId} returned invalid JSON content${detail}`, undefined, {
          cause: error,
          rawValue: result.text,
        });
      }
      return {
        value: parseStructuredValue(request.schema, value, binding.accountId),
        responseId: result.response.id,
        responseModelId: result.response.modelId,
        finishReason: result.finishReason,
        tokenUsage: usageFrom(result),
        resolvedInference: plan.inference,
        structuredOutputMode: mode,
        jsonRecovery,
      };
    }

    const result = await generateText({
      ...common,
      prompt: composeToolCallPrompt({
        userPrompt: request.userPrompt,
        contextJson,
        discriminator: discriminatorInstruction(request.schemaName),
      }),
      tools: {
        submit_result: tool({
          description: toolDescription(request.schemaName),
          inputSchema: request.schema,
        }),
      },
      // Zhipu's OpenAI-compatible Coding Plan endpoint supports tool_choice
      // only in the `auto` form. The prompt and single-tool surface still
      // require exactly one submit_result call, while avoiding an ignored
      // forced-choice payload that can destabilize GLM's argument schema.
      toolChoice: "auto",
    });
    const calls = result.toolCalls.filter((call) => call.toolName === "submit_result");
    if (calls.length !== 1) {
      throw new ModelOutputError(
        `${binding.accountId} returned ${calls.length} submit_result tool calls; expected exactly one`,
      );
    }
    return {
      value: parseStructuredValue(request.schema, calls[0]!.input, binding.accountId),
      responseId: result.response.id,
      responseModelId: result.response.modelId,
      finishReason: result.finishReason,
      tokenUsage: usageFrom(result),
      resolvedInference: plan.inference,
      structuredOutputMode: mode,
      jsonRecovery: "strict",
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
