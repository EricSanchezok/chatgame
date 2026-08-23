import { readFileSync } from "node:fs";
import path from "node:path";
import { parse } from "yaml";
import { z } from "zod";
import { canonicalize, contentHash } from "./model-audit";

const identifierSchema = z.string().regex(/^[a-z0-9][a-z0-9-]*$/);
const positiveIntegerSchema = z.number().int().positive();
export const modelRoles = [
  "truth-perception",
  "truth-reaction-routing",
  "truth-resolution",
  "truth-transition",
  "causal-verifier",
  "agent-bootstrap",
  "agent-mind",
  "agent-reaction",
] as const;

export type ModelRole = typeof modelRoles[number];

const providerSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("deepseek"),
    base_url: z.url(),
    api_key_env: z.string().regex(/^[A-Z][A-Z0-9_]*$/),
    max_concurrency: positiveIntegerSchema,
  }).strict(),
  z.object({
    kind: z.literal("openai"),
    base_url: z.url(),
    api_key_env: z.string().regex(/^[A-Z][A-Z0-9_]*$/),
    max_concurrency: positiveIntegerSchema,
  }).strict(),
  z.object({
    kind: z.literal("xai"),
    base_url: z.url(),
    api_key_env: z.string().regex(/^[A-Z][A-Z0-9_]*$/),
    max_concurrency: positiveIntegerSchema,
  }).strict(),
]);

const deepseekThinkingSchema = z.object({
  kind: z.literal("deepseek-thinking"),
  effort: z.enum(["high", "max"]),
}).strict();

const deepseekNonThinkingSchema = z.object({
  kind: z.literal("deepseek-non-thinking"),
  temperature: z.number().min(0).max(2).nullable(),
  top_p: z.number().min(0).max(1).nullable(),
}).strict().superRefine((value, context) => {
  if (value.temperature !== null && value.top_p !== null) {
    context.addIssue({
      code: "custom",
      message: "configure temperature or top_p, not both",
    });
  }
});

const openaiReasoningSchema = z.object({
  kind: z.literal("openai-reasoning"),
  effort: z.enum(["none", "minimal", "low", "medium", "high", "xhigh", "max"]),
  summary: z.enum(["auto", "concise", "detailed"]).nullable(),
  text_verbosity: z.enum(["low", "medium", "high"]).nullable(),
}).strict();

const xaiReasoningSchema = z.object({
  kind: z.literal("xai-reasoning"),
  effort: z.enum(["low", "medium", "high", "xhigh"]),
  summary: z.enum(["auto", "concise", "detailed"]).nullable(),
}).strict();

export const modelInferenceSchema = z.union([
  deepseekThinkingSchema,
  deepseekNonThinkingSchema,
  openaiReasoningSchema,
  xaiReasoningSchema,
]);

const profileSchema = z.object({
  provider_id: identifierSchema,
  model: z.string().min(1),
  description: z.string().min(1),
  allowed_roles: z.array(z.enum(modelRoles)).min(1),
  request_timeout_ms: z.number().int().min(1_000).max(3_600_000),
  max_output_tokens: positiveIntegerSchema,
  inference: modelInferenceSchema,
}).strict();

const catalogDocumentSchema = z.object({
  schema_version: z.literal(2),
  scheduler: z.object({
    global_concurrency: positiveIntegerSchema,
    max_queued_requests: positiveIntegerSchema,
    queue_timeout_ms: positiveIntegerSchema,
  }).strict(),
  providers: z.record(identifierSchema, providerSchema),
  profiles: z.record(identifierSchema, profileSchema),
}).strict();

export type ModelProviderConfig = z.infer<typeof providerSchema>;
export type ModelInferenceConfig = z.infer<typeof modelInferenceSchema>;
export type ModelProfileConfig = z.infer<typeof profileSchema>;
export type ModelCatalogDocument = z.infer<typeof catalogDocumentSchema>;

export interface ModelProfileSummary {
  id: string;
  description: string;
  allowedRoles: ModelRole[];
  providerId: string;
  providerKind: ModelProviderConfig["kind"];
  modelId: string;
  inference: ModelInferenceConfig;
}

function expectedProviderKind(inference: ModelInferenceConfig): ModelProviderConfig["kind"] {
  if (inference.kind.startsWith("deepseek-")) return "deepseek";
  if (inference.kind === "openai-reasoning") return "openai";
  return "xai";
}

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const entry of Object.values(value as Record<string, unknown>)) deepFreeze(entry);
  return value;
}

export class ModelCatalog {
  readonly schemaVersion: 2;
  readonly hash: string;
  readonly scheduler: Readonly<ModelCatalogDocument["scheduler"]>;
  readonly providers: Readonly<Record<string, Readonly<ModelProviderConfig>>>;
  readonly profiles: Readonly<Record<string, Readonly<ModelProfileConfig>>>;

  constructor(document: ModelCatalogDocument) {
    const parsed = catalogDocumentSchema.parse(document);
    if (Object.keys(parsed.providers).length === 0) throw new Error("model catalog requires at least one provider");
    if (Object.keys(parsed.profiles).length === 0) throw new Error("model catalog requires at least one profile");
    if (parsed.scheduler.global_concurrency > parsed.scheduler.max_queued_requests) {
      throw new Error("model scheduler queue must be at least as large as global concurrency");
    }
    for (const [profileId, profile] of Object.entries(parsed.profiles)) {
      const provider = parsed.providers[profile.provider_id];
      if (!provider) throw new Error(`model profile ${profileId} references unknown provider ${profile.provider_id}`);
      const expected = expectedProviderKind(profile.inference);
      if (provider.kind !== expected) {
        throw new Error(`model profile ${profileId} uses ${profile.inference.kind} with ${provider.kind} provider`);
      }
      if (new Set(profile.allowed_roles).size !== profile.allowed_roles.length) {
        throw new Error(`model profile ${profileId} has duplicate allowed roles`);
      }
    }
    this.schemaVersion = parsed.schema_version;
    this.hash = contentHash(canonicalize(parsed));
    this.scheduler = deepFreeze(parsed.scheduler);
    this.providers = deepFreeze(parsed.providers);
    this.profiles = deepFreeze(parsed.profiles);
    Object.freeze(this);
  }

  profile(profileId: string): ModelProfileConfig {
    const profile = this.profiles[profileId];
    if (!profile) throw new Error(`unknown model profile ${profileId}`);
    return profile;
  }

  provider(providerId: string): ModelProviderConfig {
    const provider = this.providers[providerId];
    if (!provider) throw new Error(`unknown model provider ${providerId}`);
    return provider;
  }

  assertProfile(profileId: string, role?: ModelRole): void {
    const profile = this.profile(profileId);
    if (role && !profile.allowed_roles.includes(role)) {
      throw new Error(`model profile ${profileId} does not allow role ${role}`);
    }
  }

  profileSummaries(role?: ModelRole): ModelProfileSummary[] {
    return Object.entries(this.profiles)
      .filter(([, profile]) => !role || profile.allowed_roles.includes(role))
      .map(([id, profile]) => ({
        id,
        description: profile.description,
        allowedRoles: [...profile.allowed_roles],
        providerId: profile.provider_id,
        providerKind: this.provider(profile.provider_id).kind,
        modelId: profile.model,
        inference: structuredClone(profile.inference),
      }))
      .sort((left, right) => left.id.localeCompare(right.id));
  }

  resolveApiKeys(env: Readonly<Record<string, string | undefined>>): ReadonlyMap<string, string> {
    const keys = new Map<string, string>();
    for (const [providerId, provider] of Object.entries(this.providers)) {
      const value = env[provider.api_key_env]?.trim();
      if (!value) throw new Error(`model provider ${providerId} requires ${provider.api_key_env}`);
      keys.set(providerId, value);
    }
    return keys;
  }
}

export function parseModelCatalog(value: unknown): ModelCatalog {
  return new ModelCatalog(catalogDocumentSchema.parse(value));
}

export function loadModelCatalog(file = path.resolve("config/models.yaml")): ModelCatalog {
  let value: unknown;
  try {
    value = parse(readFileSync(file, "utf8"));
  } catch (error) {
    throw new Error(`cannot read model catalog ${file}: ${error instanceof Error ? error.message : String(error)}`);
  }
  try {
    return parseModelCatalog(value);
  } catch (error) {
    throw new Error(`invalid model catalog ${file}: ${error instanceof Error ? error.message : String(error)}`);
  }
}
