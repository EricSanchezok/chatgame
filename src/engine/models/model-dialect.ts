import packageJson from "../../../package.json";
import type {
  ModelProtocol,
  ResolvedModelInference,
} from "./model-catalog";
import { contentHash } from "./model-audit";
import type { ResolvedModelBinding } from "./model-registry";
import type { StructuredModelRequest } from "./model-provider";

export interface VendorDialectRequestPlan {
  authentication: "bearer" | "api-key" | "x-api-key";
  headers: Readonly<Record<string, string>>;
  inference: ResolvedModelInference;
  transformBody(body: Record<string, unknown>): Record<string, unknown>;
}

export interface VendorDialect {
  readonly id: string;
  readonly protocols: readonly ModelProtocol[];
  compile<T>(
    binding: ResolvedModelBinding,
    request: StructuredModelRequest<T>,
  ): VendorDialectRequestPlan;
}

const livingWorldUserAgent = `LivingWorldEngine/${packageJson.version}`;

function resolvedInference(binding: ResolvedModelBinding): ResolvedModelInference {
  const inference = binding.profile.inference;
  return {
    thinking: inference.thinking === "auto" ? null : inference.thinking,
    effort: inference.effort === "auto" ? null : inference.effort,
    reasoningBudgetTokens: inference.reasoning_budget_tokens === "auto"
      ? null
      : inference.reasoning_budget_tokens,
    reasoningSummary: inference.reasoning_summary === "auto"
      ? null
      : inference.reasoning_summary,
    textVerbosity: inference.text_verbosity === "auto" ? null : inference.text_verbosity,
    temperature: inference.temperature === "auto" ? null : inference.temperature,
    topP: inference.top_p === "auto" ? null : inference.top_p,
  };
}

function copyBody(body: Record<string, unknown>): Record<string, unknown> {
  return structuredClone(body);
}

function compileOpenAICompatible(
  binding: ResolvedModelBinding,
): VendorDialectRequestPlan {
  const inference = resolvedInference(binding);
  return {
    authentication: "bearer",
    headers: {},
    inference,
    transformBody(body) {
      const transformed = copyBody(body);
      if (inference.thinking !== null) {
        transformed.thinking = { type: inference.thinking };
      }
      if (inference.effort !== null) transformed.reasoning_effort = inference.effort;
      if (inference.reasoningBudgetTokens !== null) {
        transformed.reasoning_budget = inference.reasoningBudgetTokens;
      }
      return transformed;
    },
  };
}

function compileResponses(
  binding: ResolvedModelBinding,
): VendorDialectRequestPlan {
  const inference = resolvedInference(binding);
  return {
    authentication: "bearer",
    headers: {},
    inference,
    transformBody(body) {
      const transformed = copyBody(body);
      transformed.store = false;
      const reasoning = {
        ...(inference.effort !== null ? { effort: inference.effort } : {}),
        ...(inference.reasoningSummary !== null ? { summary: inference.reasoningSummary } : {}),
      };
      if (Object.keys(reasoning).length > 0) transformed.reasoning = reasoning;
      if (inference.textVerbosity !== null) {
        transformed.text = {
          ...(transformed.text && typeof transformed.text === "object" ? transformed.text : {}),
          verbosity: inference.textVerbosity,
        };
      }
      return transformed;
    },
  };
}

function compileAnthropicCompatible(
  binding: ResolvedModelBinding,
): VendorDialectRequestPlan {
  const inference = resolvedInference(binding);
  return {
    authentication: "bearer",
    headers: {},
    inference,
    transformBody(body) {
      const transformed = copyBody(body);
      if (inference.thinking !== null) {
        transformed.thinking = {
          type: inference.thinking,
          ...(inference.reasoningBudgetTokens !== null
            ? { budget_tokens: inference.reasoningBudgetTokens }
            : {}),
        };
      }
      if (inference.effort !== null) {
        transformed.output_config = { effort: inference.effort };
      }
      return transformed;
    },
  };
}

function compileMimo(
  binding: ResolvedModelBinding,
): VendorDialectRequestPlan {
  return { ...compileOpenAICompatible(binding), authentication: "api-key" };
}

export function kimiPromptCacheKey<T>(
  binding: ResolvedModelBinding,
  request: StructuredModelRequest<T>,
): string {
  return contentHash({
    profileId: binding.profileId,
    promptBundleHash: contentHash({
      system: request.system,
      userPrompt: request.userPrompt,
    }),
    promptVersion: request.promptVersion,
  });
}

function compileKimiCoding<T>(
  binding: ResolvedModelBinding,
  request: StructuredModelRequest<T>,
): VendorDialectRequestPlan {
  const base = compileAnthropicCompatible(binding);
  return {
    ...base,
    headers: { "user-agent": livingWorldUserAgent },
    transformBody(body) {
      return {
        ...base.transformBody(body),
        prompt_cache_key: kimiPromptCacheKey(binding, request),
      };
    },
  };
}

function dialect(
  id: string,
  protocols: readonly ModelProtocol[],
  compile: VendorDialect["compile"],
): VendorDialect {
  return Object.freeze({ id, protocols, compile });
}

const dialects = new Map<string, VendorDialect>([
  ["deepseek", dialect("deepseek", ["openai-chat"], compileOpenAICompatible)],
  ["zhipu", dialect("zhipu", ["openai-chat"], compileOpenAICompatible)],
  ["moonshot", dialect("moonshot", ["openai-chat"], compileOpenAICompatible)],
  ["mimo", dialect("mimo", ["openai-chat"], compileMimo)],
  ["openai", dialect("openai", ["openai-responses"], compileResponses)],
  ["xai", dialect("xai", ["openai-responses"], compileResponses)],
  ["minimax", dialect("minimax", ["anthropic-messages"], compileAnthropicCompatible)],
  ["kimi", dialect("kimi", ["anthropic-messages"], compileKimiCoding)],
]);

export function vendorDialect(id: string, protocol: ModelProtocol): VendorDialect {
  const found = dialects.get(id);
  if (!found) throw new Error(`unknown model vendor dialect ${id}`);
  if (!found.protocols.includes(protocol)) {
    throw new Error(`model vendor dialect ${id} does not support protocol ${protocol}`);
  }
  return found;
}

export function registeredVendorDialects(): readonly string[] {
  return [...dialects.keys()].sort();
}
