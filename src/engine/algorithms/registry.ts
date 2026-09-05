import { z } from "zod";
import {
  ACTION_COMPILATION_CANDIDATE_KEY_SUFFIX_LENGTH,
  ACTION_COMPILATION_CANDIDATE_KEY_VERSION,
} from "../contracts/model-context";
import {
  createEagerReferenceAlgorithmRef,
  EagerReferenceAlgorithm,
  EAGER_REFERENCE_MANIFEST,
  type EagerReferenceAlgorithmConfig,
} from "./eager-reference/eager-reference";
import {
  algorithmRef,
  WorldExecutionAlgorithmRegistry,
  type AlgorithmRef,
  type JsonObject,
  type WorldExecutionAlgorithmServices,
} from "../runtime/execution";
import type {
  AlgorithmDefinition,
  AlgorithmIdentity,
  AlgorithmImplementation,
  AlgorithmRole,
} from "./composition";
import { ACTION_COMPILATION_RETRIEVAL_RUNTIME_VERSION } from "./eager-reference/candidate-retrieval/runtime";

export { ACTION_COMPILATION_RETRIEVAL_RUNTIME_VERSION } from "./eager-reference/candidate-retrieval/runtime";

class ConfiguredAlgorithm<R extends AlgorithmRole> implements AlgorithmImplementation<R> {
  constructor(
    readonly algorithmIdentity: AlgorithmIdentity<R>,
    readonly config: JsonObject,
  ) {}
}

const positiveSlots = z.number().int().min(1).max(64);
const noChildren = [] as const;

function identity<R extends AlgorithmRole>(
  role: R,
  id: string,
  version = "1",
  contractVersion = 1,
): AlgorithmIdentity<R> {
  return { role, id, version, contractVersion };
}

function configuredDefinition<R extends AlgorithmRole>(input: Omit<
  AlgorithmDefinition<R, WorldExecutionAlgorithmServices>,
  "create"
>): AlgorithmDefinition<R, WorldExecutionAlgorithmServices> {
  return {
    ...input,
    create: ({ ref }) => new ConfiguredAlgorithm(input, ref.config),
  };
}

const definitions = [
  configuredDefinition({
    ...identity("work-batching", "bounded-slot-batching"),
    maturity: "reference",
    configSchema: z.strictObject({ maxSlots: positiveSlots }),
    children: noChildren,
  }),
  configuredDefinition({
    ...identity("work-scheduling", "bounded-concurrency"),
    maturity: "reference",
    configSchema: z.strictObject({ maxConcurrent: positiveSlots }),
    children: noChildren,
  }),
  configuredDefinition({
    ...identity("output-recovery", "localized-repair-bisect"),
    maturity: "reference",
    configSchema: z.strictObject({
      maxRepairs: z.number().int().min(0).max(8),
      exhaustion: z.literal("fail-step"),
      split: z.literal("bisect"),
    }),
    children: noChildren,
  }),
  configuredDefinition({
    ...identity("candidate-selection", "full-catalog"),
    maturity: "reference",
    configSchema: z.strictObject({}),
    children: noChildren,
  }),
  configuredDefinition({
    ...identity("candidate-selection", "graph-hybrid-e5"),
    maturity: "candidate",
    configSchema: z.strictObject({
      budgetRatio: z.literal(0.2),
      maxPathDepth: z.literal(3),
      encoderFingerprint: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
      encoderModel: z.literal("intfloat/multilingual-e5-small"),
      graphFeatureSchemaVersion: z.literal(1),
      passageSchemaVersion: z.literal(1),
      cacheSchemaVersion: z.literal(1),
      rankerArtifactHash: z.null(),
    }),
    children: noChildren,
  }),
  configuredDefinition({
    ...identity("symbol-repair", "bounded-symbol-repair"),
    maturity: "reference",
    configSchema: z.strictObject({
      mode: z.literal("auto"),
      policyVersion: z.literal("symbol-repair-v2"),
      maxDistance: z.literal(3),
      minDistanceMargin: z.literal(1),
      minPayloadLength: z.literal(8),
      allowAdjacentTransposition: z.literal(true),
      maxAuditCandidates: z.literal(8),
    }),
    children: noChildren,
  }),
  configuredDefinition({
    ...identity("onset-perception", "model-onset-perception"),
    maturity: "reference",
    configSchema: z.strictObject({ fallback: z.literal("global"), contextMode: z.literal("full") }),
    children: noChildren,
  }),
  configuredDefinition({
    ...identity("reaction-decision", "model-reaction-decision"),
    maturity: "reference",
    configSchema: z.strictObject({}),
    children: noChildren,
  }),
  configuredDefinition({
    ...identity("agent-cognition", "model-agent-cognition"),
    maturity: "reference",
    configSchema: z.strictObject({ externalUpdates: z.literal(false) }),
    children: [
      { name: "batching", role: "work-batching" },
      { name: "recovery", role: "output-recovery" },
    ],
  }),
  configuredDefinition({
    ...identity("action-compilation", "model-action-compilation"),
    maturity: "reference",
    configSchema: z.strictObject({
      repairAttempts: z.literal(2),
      candidateKeyVersion: z.literal(ACTION_COMPILATION_CANDIDATE_KEY_VERSION),
      candidateKeyPayloadLength: z.literal(ACTION_COMPILATION_CANDIDATE_KEY_SUFFIX_LENGTH),
    }),
    children: [
      { name: "candidateSelection", role: "candidate-selection" },
      { name: "symbolRepair", role: "symbol-repair" },
      { name: "batching", role: "work-batching" },
      { name: "recovery", role: "output-recovery" },
    ],
  }),
  configuredDefinition({
    ...identity("interaction-grounding", "model-interaction-grounding"),
    maturity: "reference",
    configSchema: z.strictObject({ repairAttempts: z.literal(2) }),
    children: [
      { name: "scheduling", role: "work-scheduling" },
      { name: "recovery", role: "output-recovery" },
    ],
  }),
  configuredDefinition({
    ...identity("reaction-resolution", "onset-reaction"),
    maturity: "reference",
    configSchema: z.strictObject({}),
    children: [
      { name: "onsetPerception", role: "onset-perception" },
      { name: "reactionDecision", role: "reaction-decision" },
      { name: "scheduling", role: "work-scheduling" },
      { name: "recovery", role: "output-recovery" },
    ],
  }),
  configuredDefinition({
    ...identity("truth-resolution", "model-truth-resolution"),
    maturity: "reference",
    configSchema: z.strictObject({}),
    children: [
      { name: "batching", role: "work-batching" },
      { name: "recovery", role: "output-recovery" },
    ],
  }),
  configuredDefinition({
    ...identity("observation-rendering", "model-observation-rendering"),
    maturity: "reference",
    configSchema: z.strictObject({}),
    children: [
      { name: "batching", role: "work-batching" },
      { name: "recovery", role: "output-recovery" },
    ],
  }),
] as const;

function configNumber(ref: AlgorithmRef, field: string): number {
  const value = ref.config[field];
  if (typeof value !== "number") throw new Error(`${ref.role}/${ref.id} config ${field} must be a number`);
  return value;
}

function eagerConfig(ref: AlgorithmRef<"world-execution">): EagerReferenceAlgorithmConfig {
  const actionCompilation = ref.children.actionCompilation;
  const agentCognition = ref.children.agentCognition;
  const interactionGrounding = ref.children.interactionGrounding;
  const reactionResolution = ref.children.reactionResolution;
  const truthResolution = ref.children.truthResolution;
  if (!actionCompilation || !agentCognition || !interactionGrounding || !reactionResolution || !truthResolution) {
    throw new Error("eager-reference composition is incomplete");
  }
  const candidateSelection = actionCompilation.children.candidateSelection;
  if (!candidateSelection) throw new Error("eager-reference candidate selection is missing");
  const candidateRetrieval = candidateSelection.id === "full-catalog"
    ? { mode: "off" as const }
    : {
        mode: "runtime" as const,
        runtimeVersion: ACTION_COMPILATION_RETRIEVAL_RUNTIME_VERSION,
        encoderFingerprint: String(candidateSelection.config.encoderFingerprint),
        budgetRatio: 0.2 as const,
      };
  return {
    actionCompilationMaxSlots: configNumber(actionCompilation.children.batching!, "maxSlots"),
    agentMindMaxSlots: configNumber(agentCognition.children.batching!, "maxSlots"),
    reactionMaxSlots: configNumber(reactionResolution.children.scheduling!, "maxConcurrent"),
    groundingMaxSlots: configNumber(interactionGrounding.children.scheduling!, "maxConcurrent"),
    truthBatchMaxSlots: configNumber(truthResolution.children.batching!, "maxSlots"),
    candidateRetrieval,
  };
}

export const DEFAULT_ALGORITHM_REF: AlgorithmRef<"world-execution"> = algorithmRef(EAGER_REFERENCE_MANIFEST);

export function eagerReferenceAlgorithmRef(
  config: Readonly<EagerReferenceAlgorithmConfig>,
): AlgorithmRef<"world-execution"> {
  return createEagerReferenceAlgorithmRef(config);
}

export function registerBuiltinAlgorithms(
  registry: WorldExecutionAlgorithmRegistry = new WorldExecutionAlgorithmRegistry(),
): WorldExecutionAlgorithmRegistry {
  if (registry.has(DEFAULT_ALGORITHM_REF)) return registry;
  for (const definition of definitions) registry.registerAlgorithmDefinition(definition);
  registry.registerDefinition({
    ...identity("world-execution", "eager-reference", "16", 6),
    maturity: "reference",
    configSchema: z.strictObject({}),
    children: [
      { name: "agentCognition", role: "agent-cognition" },
      { name: "actionCompilation", role: "action-compilation" },
      { name: "interactionGrounding", role: "interaction-grounding" },
      { name: "reactionResolution", role: "reaction-resolution" },
      { name: "truthResolution", role: "truth-resolution" },
      { name: "observationRendering", role: "observation-rendering" },
    ],
    create: ({ ref, services }) => new EagerReferenceAlgorithm(
      services.provider,
      services.rulePackages,
      eagerConfig(ref as AlgorithmRef<"world-execution">),
      services.actionCompilationRetrieval,
    ),
  });
  if (!registry.has(DEFAULT_ALGORITHM_REF)) throw new Error("built-in eager-reference composition did not register");
  return registry;
}
