import { z } from "zod";
import {
  ACTION_COMPILATION_CANDIDATE_KEY_SUFFIX_LENGTH,
  ACTION_COMPILATION_CANDIDATE_KEY_VERSION,
} from "../contracts/model-context";
import {
  createEagerReferenceAlgorithmRef,
  EagerReferenceAlgorithm,
  EAGER_REFERENCE_MANIFEST,
  type EagerReferenceComponents,
  type EagerReferenceAlgorithmConfig,
} from "./eager-reference/eager-reference";
import { compileActions } from "./eager-reference/action-compiler";
import { AgentMind } from "./eager-reference/agent-mind";
import { generateInteractionDependency } from "../mechanics/action-dependency";
import { TruthEngine } from "../mechanics/truth-engine";
import { TruthBatchCoordinator } from "../mechanics/truth-batch-provider";
import { ObservationRenderer } from "../cognition/observation-renderer";
import { createCoreRulePackageRegistry } from "../mechanics/rule-package";
import { DEFAULT_SYMBOL_REPAIR_POLICY } from "../contracts/symbol-repair";
import {
  algorithmRef,
  algorithmManifest,
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
  ResolvedAlgorithm,
} from "./composition";
import type {
  ActionCompilationRoleAlgorithm,
  AgentCognitionRoleAlgorithm,
  CandidateSelectionCapability,
  CandidateSelectionRoleAlgorithm,
  ConfiguredRoleAlgorithm,
  InteractionGroundingRoleAlgorithm,
  ObservationRenderingRoleAlgorithm,
  OnsetPerceptionRoleAlgorithm,
  ReactionDecisionRoleAlgorithm,
  SymbolRepairRoleAlgorithm,
  TruthResolutionRoleAlgorithm,
} from "./roles";
import {
  ACTION_COMPILATION_RETRIEVAL_RUNTIME_VERSION,
} from "./eager-reference/candidate-retrieval/runtime";

export { ACTION_COMPILATION_RETRIEVAL_RUNTIME_VERSION } from "./eager-reference/candidate-retrieval/runtime";

class ConfiguredAlgorithm<R extends AlgorithmRole> implements ConfiguredRoleAlgorithm<R> {
  constructor(
    readonly algorithmIdentity: AlgorithmIdentity<R>,
    readonly config: JsonObject,
    readonly children: Readonly<Record<string, ResolvedAlgorithm>>,
  ) {}
}

class AgentCognitionAlgorithm extends ConfiguredAlgorithm<"agent-cognition"> implements AgentCognitionRoleAlgorithm {
  create(provider: WorldExecutionAlgorithmServices["provider"], repairAttempts: number) {
    return new AgentMind(provider, repairAttempts);
  }
}

class ActionCompilationAlgorithm extends ConfiguredAlgorithm<"action-compilation"> implements ActionCompilationRoleAlgorithm {
  readonly compile = compileActions;
}

class CandidateSelectionAlgorithm extends ConfiguredAlgorithm<"candidate-selection"> implements CandidateSelectionRoleAlgorithm {
  constructor(
    algorithmIdentity: AlgorithmIdentity<"candidate-selection">,
    config: JsonObject,
    children: Readonly<Record<string, ResolvedAlgorithm>>,
    readonly runtime: CandidateSelectionCapability | undefined,
  ) {
    super(algorithmIdentity, config, children);
  }
}

class SymbolRepairAlgorithm extends ConfiguredAlgorithm<"symbol-repair"> implements SymbolRepairRoleAlgorithm {
  readonly policy = DEFAULT_SYMBOL_REPAIR_POLICY;
}

class InteractionGroundingAlgorithm extends ConfiguredAlgorithm<"interaction-grounding"> implements InteractionGroundingRoleAlgorithm {
  readonly ground = generateInteractionDependency;
}

class OnsetPerceptionAlgorithm extends ConfiguredAlgorithm<"onset-perception"> implements OnsetPerceptionRoleAlgorithm {
  create(provider: WorldExecutionAlgorithmServices["provider"], rulePackages: NonNullable<WorldExecutionAlgorithmServices["rulePackages"]>, repairAttempts: number) {
    return new TruthEngine(provider, { rulePackages, repairAttempts });
  }
}

class ReactionDecisionAlgorithm extends ConfiguredAlgorithm<"reaction-decision"> implements ReactionDecisionRoleAlgorithm {
  create(provider: WorldExecutionAlgorithmServices["provider"], repairAttempts: number) {
    return new AgentMind(provider, repairAttempts);
  }
}

class TruthResolutionAlgorithm extends ConfiguredAlgorithm<"truth-resolution"> implements TruthResolutionRoleAlgorithm {
  create(provider: WorldExecutionAlgorithmServices["provider"], rulePackages: NonNullable<WorldExecutionAlgorithmServices["rulePackages"]>, repairAttempts: number) {
    return new TruthEngine(provider, { rulePackages, repairAttempts });
  }
}

class ObservationRenderingAlgorithm extends ConfiguredAlgorithm<"observation-rendering"> implements ObservationRenderingRoleAlgorithm {
  create(provider: WorldExecutionAlgorithmServices["provider"]) {
    return new ObservationRenderer(provider);
  }
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
>, create: (
  identity: AlgorithmIdentity<R>,
  config: JsonObject,
  children: Readonly<Record<string, ResolvedAlgorithm>>,
  services: Readonly<WorldExecutionAlgorithmServices>,
  ref: AlgorithmRef<R>,
) => AlgorithmImplementation<R> = (algorithmIdentity, config, children) =>
    new ConfiguredAlgorithm(algorithmIdentity, config, children)
): AlgorithmDefinition<R, WorldExecutionAlgorithmServices> {
  return {
    ...input,
    create: ({ ref, children, services }) => create(input, ref.config, children, services, ref as AlgorithmRef<R>),
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
  }, (algorithmIdentity, config, children) =>
    new CandidateSelectionAlgorithm(algorithmIdentity, config, children, undefined)),
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
  }, (algorithmIdentity, config, children, services, ref) => {
    const runtime = services.resources?.resolve<CandidateSelectionCapability>("candidate-selection-runtime", ref);
    if (!runtime) {
      throw new Error("graph-hybrid-e5 candidate selection requires its pinned runtime");
    }
    return new CandidateSelectionAlgorithm(algorithmIdentity, config, children, runtime);
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
  }, (algorithmIdentity, config, children) => new SymbolRepairAlgorithm(algorithmIdentity, config, children)),
  configuredDefinition({
    ...identity("onset-perception", "model-onset-perception"),
    maturity: "reference",
    configSchema: z.strictObject({ fallback: z.literal("global"), contextMode: z.literal("full") }),
    children: noChildren,
  }, (algorithmIdentity, config, children) => new OnsetPerceptionAlgorithm(algorithmIdentity, config, children)),
  configuredDefinition({
    ...identity("reaction-decision", "model-reaction-decision"),
    maturity: "reference",
    configSchema: z.strictObject({}),
    children: noChildren,
  }, (algorithmIdentity, config, children) => new ReactionDecisionAlgorithm(algorithmIdentity, config, children)),
  configuredDefinition({
    ...identity("agent-cognition", "model-agent-cognition"),
    maturity: "reference",
    configSchema: z.strictObject({ externalUpdates: z.literal(false) }),
    children: [
      { name: "batching", role: "work-batching" },
      { name: "recovery", role: "output-recovery" },
    ],
  }, (algorithmIdentity, config, children) => new AgentCognitionAlgorithm(algorithmIdentity, config, children)),
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
  }, (algorithmIdentity, config, children) => new ActionCompilationAlgorithm(algorithmIdentity, config, children)),
  configuredDefinition({
    ...identity("interaction-grounding", "model-interaction-grounding"),
    maturity: "reference",
    configSchema: z.strictObject({ repairAttempts: z.literal(2) }),
    children: [
      { name: "scheduling", role: "work-scheduling" },
      { name: "recovery", role: "output-recovery" },
    ],
  }, (algorithmIdentity, config, children) => new InteractionGroundingAlgorithm(algorithmIdentity, config, children)),
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
  }, (algorithmIdentity, config, children) => new TruthResolutionAlgorithm(algorithmIdentity, config, children)),
  configuredDefinition({
    ...identity("observation-rendering", "model-observation-rendering"),
    maturity: "reference",
    configSchema: z.strictObject({}),
    children: [
      { name: "batching", role: "work-batching" },
      { name: "recovery", role: "output-recovery" },
    ],
  }, (algorithmIdentity, config, children) => new ObservationRenderingAlgorithm(algorithmIdentity, config, children)),
] as const;

function configured(node: ResolvedAlgorithm | undefined, label: string): ConfiguredRoleAlgorithm {
  const implementation = node?.implementation as Partial<ConfiguredRoleAlgorithm> | undefined;
  if (!implementation || !implementation.config || !implementation.children) {
    throw new Error(`${label} did not resolve a configured algorithm implementation`);
  }
  return implementation as ConfiguredRoleAlgorithm;
}

function child(algorithm: ConfiguredRoleAlgorithm, slot: string): ConfiguredRoleAlgorithm {
  return configured(algorithm.children[slot], `${algorithm.algorithmIdentity.role}.${slot}`);
}

function configNumber(algorithm: ConfiguredRoleAlgorithm, field: string): number {
  const value = algorithm.config[field];
  if (typeof value !== "number") {
    throw new Error(`${algorithm.algorithmIdentity.role}/${algorithm.algorithmIdentity.id} config ${field} must be a number`);
  }
  return value;
}

function eagerAlgorithms(children: Readonly<Record<string, ResolvedAlgorithm>>) {
  const actionCompilation = configured(children.actionCompilation, "actionCompilation");
  const agentCognition = configured(children.agentCognition, "agentCognition");
  const interactionGrounding = configured(children.interactionGrounding, "interactionGrounding");
  const reactionResolution = configured(children.reactionResolution, "reactionResolution");
  const truthResolution = configured(children.truthResolution, "truthResolution");
  const observationRendering = configured(children.observationRendering, "observationRendering");
  const candidateSelection = child(actionCompilation, "candidateSelection") as CandidateSelectionRoleAlgorithm;
  if (!("runtime" in candidateSelection)) {
    throw new Error("candidate-selection implementation must expose its selected runtime");
  }
  return { actionCompilation, agentCognition, interactionGrounding, reactionResolution, truthResolution, observationRendering, candidateSelection };
}

function eagerConfig(children: Readonly<Record<string, ResolvedAlgorithm>>): EagerReferenceAlgorithmConfig {
  const algorithms = eagerAlgorithms(children);
  const candidateRetrieval = algorithms.candidateSelection.runtime
    ? {
        mode: "runtime" as const,
        runtimeVersion: ACTION_COMPILATION_RETRIEVAL_RUNTIME_VERSION,
        encoderFingerprint: String(algorithms.candidateSelection.config.encoderFingerprint),
        budgetRatio: 0.2 as const,
      }
    : { mode: "off" as const };
  return {
    actionCompilationMaxSlots: configNumber(child(algorithms.actionCompilation, "batching"), "maxSlots"),
    agentMindMaxSlots: configNumber(child(algorithms.agentCognition, "batching"), "maxSlots"),
    reactionMaxSlots: configNumber(child(algorithms.reactionResolution, "scheduling"), "maxConcurrent"),
    groundingMaxSlots: configNumber(child(algorithms.interactionGrounding, "scheduling"), "maxConcurrent"),
    truthBatchMaxSlots: configNumber(child(algorithms.truthResolution, "batching"), "maxSlots"),
    candidateRetrieval,
  };
}

function recoveryAttempts(algorithm: ConfiguredRoleAlgorithm): number {
  return configNumber(child(algorithm, "recovery"), "maxRepairs");
}

function eagerComponents(
  children: Readonly<Record<string, ResolvedAlgorithm>>,
  services: Readonly<WorldExecutionAlgorithmServices>,
  config: Readonly<EagerReferenceAlgorithmConfig>,
): EagerReferenceComponents {
  const algorithms = eagerAlgorithms(children);
  const agentCognition = algorithms.agentCognition as AgentCognitionRoleAlgorithm;
  const actionCompilation = algorithms.actionCompilation as ActionCompilationRoleAlgorithm;
  const interactionGrounding = algorithms.interactionGrounding as InteractionGroundingRoleAlgorithm;
  const truthResolution = algorithms.truthResolution as TruthResolutionRoleAlgorithm;
  const observationRendering = algorithms.observationRendering as ObservationRenderingRoleAlgorithm;
  if (typeof agentCognition.create !== "function" || typeof actionCompilation.compile !== "function" ||
    typeof interactionGrounding.ground !== "function" || typeof truthResolution.create !== "function" ||
    typeof observationRendering.create !== "function") {
    throw new Error("eager-reference composition resolved incompatible Role implementations");
  }
  const onsetPerception = child(algorithms.reactionResolution, "onsetPerception") as OnsetPerceptionRoleAlgorithm;
  const reactionDecision = child(algorithms.reactionResolution, "reactionDecision") as ReactionDecisionRoleAlgorithm;
  if (typeof onsetPerception.create !== "function" || typeof reactionDecision.create !== "function") {
    throw new Error("eager-reference reaction or candidate composition is incompatible");
  }
  const symbolRepair = child(algorithms.actionCompilation, "symbolRepair") as SymbolRepairRoleAlgorithm;
  if (!symbolRepair.policy) throw new Error("symbol-repair implementation must expose its policy");
  const rulePackages = services.rulePackages ?? createCoreRulePackageRegistry();
  const truthProvider = new TruthBatchCoordinator(services.provider, config.truthBatchMaxSlots);
  return {
    provider: truthProvider,
    agentCognition: agentCognition.create(services.provider, recoveryAttempts(agentCognition)),
    actionCompilation: actionCompilation.compile,
    interactionGrounding: interactionGrounding.ground,
    onsetPerception: onsetPerception.create(truthProvider, rulePackages, recoveryAttempts(algorithms.reactionResolution)),
    reactionDecision: reactionDecision.create(services.provider, recoveryAttempts(algorithms.reactionResolution)),
    truthResolution: truthResolution.create(truthProvider, rulePackages, recoveryAttempts(truthResolution)),
    observationRendering: observationRendering.create(truthProvider),
    symbolRepair: symbolRepair.policy,
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
    create: ({ ref, children, services }) => {
      const config = eagerConfig(children);
      const algorithms = eagerAlgorithms(children);
      const candidateSelection = algorithms.candidateSelection;
      return new EagerReferenceAlgorithm(
        services.provider,
        services.rulePackages,
        config,
        candidateSelection.runtime,
        eagerComponents(children, services, config),
        algorithmManifest(ref as AlgorithmRef<"world-execution">),
      );
    },
  });
  if (!registry.has(DEFAULT_ALGORITHM_REF)) throw new Error("built-in eager-reference composition did not register");
  return registry;
}
