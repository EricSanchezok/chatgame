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
import { DEFAULT_EAGER_OUTPUT_RECOVERY } from "./eager-reference/eager-slot-batching";
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
  OutputRecoveryCapability,
  OutputRecoveryRoleAlgorithm,
  ReactionDecisionRoleAlgorithm,
  SymbolRepairRoleAlgorithm,
  TruthResolutionRoleAlgorithm,
  WorkBatchingRoleAlgorithm,
  WorkSchedulingRoleAlgorithm,
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

class WorkBatchingAlgorithm extends ConfiguredAlgorithm<"work-batching"> implements WorkBatchingRoleAlgorithm {
  readonly maxSlots: number;

  constructor(
    algorithmIdentity: AlgorithmIdentity<"work-batching">,
    config: JsonObject,
    children: Readonly<Record<string, ResolvedAlgorithm>>,
  ) {
    super(algorithmIdentity, config, children);
    this.maxSlots = Number(config.maxSlots);
  }
}

class WorkSchedulingAlgorithm extends ConfiguredAlgorithm<"work-scheduling"> implements WorkSchedulingRoleAlgorithm {
  readonly maxConcurrent: number;

  constructor(
    algorithmIdentity: AlgorithmIdentity<"work-scheduling">,
    config: JsonObject,
    children: Readonly<Record<string, ResolvedAlgorithm>>,
  ) {
    super(algorithmIdentity, config, children);
    this.maxConcurrent = Number(config.maxConcurrent);
  }
}

class OutputRecoveryAlgorithm extends ConfiguredAlgorithm<"output-recovery"> implements OutputRecoveryRoleAlgorithm {
  readonly policy: Readonly<OutputRecoveryCapability>;

  constructor(
    algorithmIdentity: AlgorithmIdentity<"output-recovery">,
    config: JsonObject,
    children: Readonly<Record<string, ResolvedAlgorithm>>,
  ) {
    super(algorithmIdentity, config, children);
    this.policy = Object.freeze({
      maxRepairs: Number(config.maxRepairs),
      exhaustion: "fail-step" as const,
      splitAt: DEFAULT_EAGER_OUTPUT_RECOVERY.splitAt,
    });
  }
}

class AgentCognitionAlgorithm extends ConfiguredAlgorithm<"agent-cognition"> implements AgentCognitionRoleAlgorithm {
  create(provider: WorldExecutionAlgorithmServices["provider"], recovery: Readonly<OutputRecoveryCapability>) {
    return new AgentMind(provider, recovery);
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
  create(provider: WorldExecutionAlgorithmServices["provider"], rulePackages: NonNullable<WorldExecutionAlgorithmServices["rulePackages"]>, recovery: Readonly<OutputRecoveryCapability>) {
    return new TruthEngine(provider, { rulePackages, repairAttempts: recovery.maxRepairs });
  }
}

class ReactionDecisionAlgorithm extends ConfiguredAlgorithm<"reaction-decision"> implements ReactionDecisionRoleAlgorithm {
  create(provider: WorldExecutionAlgorithmServices["provider"], recovery: Readonly<OutputRecoveryCapability>) {
    return new AgentMind(provider, recovery);
  }
}

class TruthResolutionAlgorithm extends ConfiguredAlgorithm<"truth-resolution"> implements TruthResolutionRoleAlgorithm {
  create(provider: WorldExecutionAlgorithmServices["provider"], rulePackages: NonNullable<WorldExecutionAlgorithmServices["rulePackages"]>, recovery: Readonly<OutputRecoveryCapability>) {
    return new TruthEngine(provider, { rulePackages, repairAttempts: recovery.maxRepairs });
  }
}

class ObservationRenderingAlgorithm extends ConfiguredAlgorithm<"observation-rendering"> implements ObservationRenderingRoleAlgorithm {
  create(provider: WorldExecutionAlgorithmServices["provider"], recovery: Readonly<OutputRecoveryCapability>) {
    return new ObservationRenderer(provider, recovery.maxRepairs);
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

function candidateSelectionRuntime(
  services: Readonly<WorldExecutionAlgorithmServices>,
  ref: AlgorithmRef<"candidate-selection">,
): CandidateSelectionCapability {
  const runtime = services.resources?.resolve<CandidateSelectionCapability>("candidate-selection-runtime", ref);
  if (!runtime) throw new Error("graph-hybrid-e5 candidate selection requires its pinned runtime");
  if (runtime.role !== "candidate-selection" ||
    runtime.version !== ACTION_COMPILATION_RETRIEVAL_RUNTIME_VERSION ||
    typeof runtime.retrieveBatch !== "function") {
    throw new Error("graph-hybrid-e5 candidate selection received an incompatible runtime");
  }
  return runtime;
}

const definitions = [
  configuredDefinition({
    ...identity("work-batching", "bounded-slot-batching"),
    maturity: "reference",
    configSchema: z.strictObject({ maxSlots: positiveSlots }),
    children: noChildren,
  }, (algorithmIdentity, config, children) => new WorkBatchingAlgorithm(algorithmIdentity, config, children)),
  configuredDefinition({
    ...identity("work-scheduling", "bounded-concurrency"),
    maturity: "reference",
    configSchema: z.strictObject({ maxConcurrent: positiveSlots }),
    children: noChildren,
  }, (algorithmIdentity, config, children) => new WorkSchedulingAlgorithm(algorithmIdentity, config, children)),
  configuredDefinition({
    ...identity("output-recovery", "localized-repair-bisect"),
    maturity: "reference",
    configSchema: z.strictObject({
      maxRepairs: z.number().int().min(0).max(8),
      exhaustion: z.literal("fail-step"),
      split: z.literal("bisect"),
    }),
    children: noChildren,
  }, (algorithmIdentity, config, children) => new OutputRecoveryAlgorithm(algorithmIdentity, config, children)),
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
    preflight: ({ services, ref }) => {
      candidateSelectionRuntime(services, ref as AlgorithmRef<"candidate-selection">);
    },
  }, (algorithmIdentity, config, children, services, ref) => {
    return new CandidateSelectionAlgorithm(
      algorithmIdentity,
      config,
      children,
      candidateSelectionRuntime(services, ref),
    );
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
    configSchema: z.strictObject({}),
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

function batchLimit(algorithm: ConfiguredRoleAlgorithm): number {
  const batching = algorithm as Partial<WorkBatchingRoleAlgorithm>;
  if (!Number.isSafeInteger(batching.maxSlots) || Number(batching.maxSlots) < 1) {
    throw new Error(`${algorithm.algorithmIdentity.role}/${algorithm.algorithmIdentity.id} must expose a positive maxSlots capability`);
  }
  return Number(batching.maxSlots);
}

function concurrencyLimit(algorithm: ConfiguredRoleAlgorithm): number {
  const scheduling = algorithm as Partial<WorkSchedulingRoleAlgorithm>;
  if (!Number.isSafeInteger(scheduling.maxConcurrent) || Number(scheduling.maxConcurrent) < 1) {
    throw new Error(`${algorithm.algorithmIdentity.role}/${algorithm.algorithmIdentity.id} must expose a positive maxConcurrent capability`);
  }
  return Number(scheduling.maxConcurrent);
}

function recoveryPolicy(algorithm: ConfiguredRoleAlgorithm): Readonly<OutputRecoveryCapability> {
  const recovery = (algorithm as Partial<OutputRecoveryRoleAlgorithm>).policy;
  if (!recovery || !Number.isSafeInteger(recovery.maxRepairs) || recovery.maxRepairs < 0 ||
    recovery.exhaustion !== "fail-step" || typeof recovery.splitAt !== "function") {
    throw new Error(`${algorithm.algorithmIdentity.role}/${algorithm.algorithmIdentity.id} must expose a valid recovery capability`);
  }
  return recovery;
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
    actionCompilationMaxSlots: batchLimit(child(algorithms.actionCompilation, "batching")),
    agentMindMaxSlots: batchLimit(child(algorithms.agentCognition, "batching")),
    reactionMaxSlots: concurrencyLimit(child(algorithms.reactionResolution, "scheduling")),
    groundingMaxSlots: concurrencyLimit(child(algorithms.interactionGrounding, "scheduling")),
    truthBatchMaxSlots: batchLimit(child(algorithms.truthResolution, "batching")),
    candidateRetrieval,
  };
}

function eagerComponents(
  children: Readonly<Record<string, ResolvedAlgorithm>>,
  services: Readonly<WorldExecutionAlgorithmServices>,
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
  const actionCompilationRecovery = recoveryPolicy(child(algorithms.actionCompilation, "recovery"));
  const interactionGroundingRecovery = recoveryPolicy(child(algorithms.interactionGrounding, "recovery"));
  const reactionRecovery = recoveryPolicy(child(algorithms.reactionResolution, "recovery"));
  const truthRecovery = recoveryPolicy(child(algorithms.truthResolution, "recovery"));
  const observationRecovery = recoveryPolicy(child(algorithms.observationRendering, "recovery"));
  const truthProvider = new TruthBatchCoordinator(
    services.provider,
    batchLimit(child(algorithms.truthResolution, "batching")),
  );
  const observationProvider = new TruthBatchCoordinator(
    services.provider,
    batchLimit(child(algorithms.observationRendering, "batching")),
  );
  return {
    provider: services.provider,
    agentCognition: agentCognition.create(
      services.provider,
      recoveryPolicy(child(agentCognition, "recovery")),
    ),
    actionCompilation: actionCompilation.compile,
    interactionGrounding: interactionGrounding.ground,
    onsetPerception: onsetPerception.create(services.provider, rulePackages, reactionRecovery),
    reactionDecision: reactionDecision.create(services.provider, reactionRecovery),
    truthResolution: truthResolution.create(truthProvider, rulePackages, truthRecovery),
    observationRendering: observationRendering.create(observationProvider, observationRecovery),
    symbolRepair: symbolRepair.policy,
    actionCompilationRecovery,
    interactionGroundingRecovery,
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
        eagerComponents(children, services),
        algorithmManifest(ref as AlgorithmRef<"world-execution">),
      );
    },
  });
  if (!registry.has(DEFAULT_ALGORITHM_REF)) throw new Error("built-in eager-reference composition did not register");
  return registry;
}
