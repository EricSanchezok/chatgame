import type { AgentMindOutput, ModelCausalAssertion } from "../contracts/llm-schemas";
import { contentHash } from "../models/model-audit";
import type {
  AgentActionProposal,
  AgentId,
  CausalAssertionResult,
  CausalVerification,
  CommitmentRound,
  D20CheckRequest,
  D20CheckResult,
  DiscreteRandomRequest,
  DiscreteRandomResult,
  MechanicResult,
  ModelExecutionAudit,
  ObservationPacket,
  ReactionDecision,
  ReactionRequest,
  SeededRngState,
  SimulationState,
  TransitionProposal,
} from "../contracts/model";
import type { ModelExecutionScope } from "../models/model-provider";
import type { StructuredModelProvider } from "../models/model-provider";
import type { AlgorithmInstrumentation, RuntimeObserver } from "./observability";
import type { RulePackageRegistry } from "../mechanics/rule-package";
import type { WorldDefinition } from "./world-definition";
import type { ResolutionPlan, ResolutionReceipt } from "../mechanics/resolution";
import type {
  ActivityDisposition,
  ActivityTransition,
  DecisionPoint,
  TemporalBoundary,
  TemporalPlan,
  TemporalPlanDraft,
  TemporalStateSnapshot,
} from "../mechanics/temporal";
import type { ExistingReferenceHandle, ModelCausalRef, ModelReference } from "../contracts/model-context";
import type {
  SharedActivityResourceClaim,
  SharedActivityResourceClaimDraft,
} from "../mechanics/shared-activity-resources";
import type { SharedResourceAdmission } from "../mechanics/shared-resource-allocation";

export type ExecutionKind = "interactive" | "diagnostic" | "benchmark" | "replay";

export const WORLD_EXECUTION_CONTRACT_VERSION = 5 as const;
export const ENGINE_OPERATION_CONTRACT_VERSION = 1 as const;
export const WORLD_STEP_CANDIDATE_SCHEMA_VERSION = 5 as const;
export const WORLD_STEP_PREPARATION_SCHEMA_VERSION = 4 as const;

export class StepPreparationInvalidatedError extends Error {
  constructor(message = "step preparation no longer matches its execution inputs") {
    super(message);
    this.name = "StepPreparationInvalidatedError";
  }
}

export type JsonPrimitive = null | boolean | number | string;
export type JsonValue = JsonPrimitive | JsonObject | readonly JsonValue[];
export type JsonObject = Readonly<{ [key: string]: JsonValue }>;

interface AlgorithmComponentDefinition {
  id: string;
  version: string;
  config: JsonObject;
}

export interface AlgorithmComponentManifest {
  id: string;
  version: string;
  config: JsonObject;
  hash: string;
}

export interface AlgorithmManifest {
  kind: "algorithm";
  contractVersion: typeof WORLD_EXECUTION_CONTRACT_VERSION;
  id: string;
  version: string;
  config: JsonObject;
  components: readonly AlgorithmComponentManifest[];
  hash: string;
}

export interface EngineOperationManifest {
  kind: "engine-operation";
  contractVersion: typeof ENGINE_OPERATION_CONTRACT_VERSION;
  id: string;
  version: string;
  config: JsonObject;
  hash: string;
}

export type ExecutionProducerManifest = AlgorithmManifest | EngineOperationManifest;

export interface AlgorithmRef {
  id: string;
  version: string;
  contractVersion: typeof WORLD_EXECUTION_CONTRACT_VERSION;
  config: JsonObject;
  manifestHash: string;
}

function requireManifestText(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} is required`);
}

function assertJsonValue(value: unknown, label: string, seen = new Set<object>()): asserts value is JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error(`${label} must contain only finite JSON numbers`);
    return;
  }
  if (typeof value !== "object") throw new Error(`${label} must be JSON-safe`);
  if (seen.has(value)) throw new Error(`${label} must not contain cycles`);
  seen.add(value);
  if (Array.isArray(value)) {
    const allowedKeys = new Set<PropertyKey>([
      "length",
      ...Array.from({ length: value.length }, (_, index) => String(index)),
    ]);
    for (const key of Reflect.ownKeys(value)) {
      if (!allowedKeys.has(key)) throw new Error(`${label} must not contain non-JSON array properties`);
    }
    for (let index = 0; index < value.length; index += 1) {
      if (!(index in value)) throw new Error(`${label} must not contain sparse arrays`);
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor || !("value" in descriptor)) throw new Error(`${label}[${index}] must be a data property`);
      assertJsonValue(descriptor.value, `${label}[${index}]`, seen);
    }
  } else {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new Error(`${label} must contain only plain objects`);
    }
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== "string") throw new Error(`${label} must not contain symbol keys`);
      if (!key.trim()) throw new Error(`${label} keys must be non-empty`);
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
        throw new Error(`${label}.${key} must be an enumerable data property`);
      }
      assertJsonValue(descriptor.value, `${label}.${key}`, seen);
    }
  }
  seen.delete(value);
}

function frozenClone<T>(value: T): T {
  const clone = structuredClone(value);
  const freeze = (entry: unknown): void => {
    if (!entry || typeof entry !== "object" || Object.isFrozen(entry)) return;
    for (const child of Object.values(entry)) freeze(child);
    Object.freeze(entry);
  };
  freeze(clone);
  return clone;
}

export function defineAlgorithmManifest(input: {
  id: string;
  version: string;
  config: JsonObject;
  components: readonly AlgorithmComponentDefinition[];
}): AlgorithmManifest {
  requireManifestText(input.id, "execution algorithm id");
  requireManifestText(input.version, "execution algorithm version");
  assertJsonValue(input.config, "execution algorithm config");
  const componentIds = new Set<string>();
  const components = input.components.map((component) => {
    requireManifestText(component.id, "execution algorithm component id");
    requireManifestText(component.version, `execution algorithm component ${component.id} version`);
    if (componentIds.has(component.id)) {
      throw new Error(`execution algorithm contains duplicate component id: ${component.id}`);
    }
    componentIds.add(component.id);
    assertJsonValue(component.config, `execution algorithm component ${component.id} config`);
    const body = frozenClone(component);
    return frozenClone({ ...body, hash: contentHash(body) });
  });
  const body = frozenClone({
    kind: "algorithm" as const,
    contractVersion: WORLD_EXECUTION_CONTRACT_VERSION,
    id: input.id,
    version: input.version,
    config: input.config,
    components,
  });
  return frozenClone({ ...body, hash: contentHash(body) });
}

export function defineEngineOperationManifest(input: {
  id: string;
  version: string;
  config?: JsonObject;
}): EngineOperationManifest {
  requireManifestText(input.id, "engine operation id");
  requireManifestText(input.version, "engine operation version");
  const config = input.config ?? {};
  assertJsonValue(config, "engine operation config");
  const body = frozenClone({
    kind: "engine-operation" as const,
    contractVersion: ENGINE_OPERATION_CONTRACT_VERSION,
    id: input.id,
    version: input.version,
    config,
  });
  return frozenClone({ ...body, hash: contentHash(body) });
}

export function validateExecutionProducerManifest(manifest: ExecutionProducerManifest): void {
  if (!manifest || typeof manifest !== "object") throw new Error("execution producer manifest is required");
  requireManifestText(manifest.id, "execution producer id");
  requireManifestText(manifest.version, "execution producer version");
  assertJsonValue(manifest.config, "execution producer config");
  if (manifest.kind === "algorithm") {
    const contractVersion = Number(manifest.contractVersion);
    if (contractVersion !== WORLD_EXECUTION_CONTRACT_VERSION) {
      throw new Error(`unsupported execution algorithm contract version: ${contractVersion}`);
    }
    const componentIds = new Set<string>();
    for (const component of manifest.components) {
      requireManifestText(component.id, "execution algorithm component id");
      requireManifestText(component.version, `execution algorithm component ${component.id} version`);
      if (componentIds.has(component.id)) {
        throw new Error(`execution algorithm contains duplicate component id: ${component.id}`);
      }
      componentIds.add(component.id);
      assertJsonValue(component.config, `execution algorithm component ${component.id} config`);
      const { hash: componentHash, ...componentBody } = component;
      if (contentHash(componentBody) !== componentHash) {
        throw new Error(`execution algorithm component hash mismatch: ${component.id}`);
      }
    }
  } else if (manifest.kind === "engine-operation") {
    const contractVersion = Number(manifest.contractVersion);
    if (contractVersion !== ENGINE_OPERATION_CONTRACT_VERSION) {
      throw new Error(`unsupported engine operation contract version: ${contractVersion}`);
    }
  } else {
    throw new Error("execution producer manifest kind is invalid");
  }
  const { hash, ...body } = manifest;
  if (contentHash(body) !== hash) {
    throw new Error(`execution producer manifest hash mismatch: ${manifest.id}@${manifest.version}`);
  }
}

export function algorithmRef(manifest: AlgorithmManifest): AlgorithmRef {
  validateExecutionProducerManifest(manifest);
  return frozenClone({
    id: manifest.id,
    version: manifest.version,
    contractVersion: manifest.contractVersion,
    config: manifest.config,
    manifestHash: manifest.hash,
  });
}

export function validateAlgorithmRef(ref: AlgorithmRef): void {
  if (!ref || typeof ref !== "object") throw new Error("execution algorithm reference is required");
  requireManifestText(ref.id, "execution algorithm reference id");
  requireManifestText(ref.version, "execution algorithm reference version");
  requireManifestText(ref.manifestHash, "execution algorithm reference manifest hash");
  assertJsonValue(ref.config, "execution algorithm reference config");
  if (ref.contractVersion !== WORLD_EXECUTION_CONTRACT_VERSION) {
    throw new Error(`unsupported execution algorithm contract version: ${ref.contractVersion}`);
  }
}

export interface ExecutionRef {
  executionId: string;
  terminalEventSequence: number;
  traceHash: string;
}

export interface ExecutionTraceWriter extends RuntimeObserver {
  readonly executionId: string;
  readonly traceId: string;
  artifact(kind: string, value: unknown): string;
  flush(): void;
}

export interface ExecutionContext {
  modelScope: ModelExecutionScope;
  instrumentation: AlgorithmInstrumentation;
}

export interface BootstrapInput {
  definition: WorldDefinition;
  state: SimulationState;
}

export interface BootstrapCandidate {
  schemaVersion: typeof WORLD_STEP_CANDIDATE_SCHEMA_VERSION;
  sourceStateHash: string;
  agentCommits: Array<AgentMindOutput & { agentId: string }>;
  modelAudits: ModelExecutionAudit[];
  diagnostics: AlgorithmCandidateDiagnostics;
}

export interface WorldStepInput {
  definition: WorldDefinition;
  state: SimulationState;
  policyRoster: Readonly<Record<AgentId, PolicyBinding>>;
  request: Readonly<WorldAdvanceRequest>;
  decisionEligibleAgentIds: readonly AgentId[];
}

export type ParticipantId = string;

export type PolicyBinding =
  | {
      kind: "model";
      agentId: AgentId;
      profiles: Readonly<{ bootstrap: string; mind: string; reaction: string }>;
      resumeFromRevision?: number;
    }
  | { kind: "external"; agentId: AgentId; participantId: ParticipantId }
  | { kind: "idle"; agentId: AgentId; reason: "timeout" | "released" | "explicit" }
  | { kind: "replay"; agentId: AgentId; sourceExecutionId: string };

export interface ExternalActionInput {
  submissionId: string;
  agentId: AgentId;
  rawText: string;
  goal: string;
  means: string | null;
  targetIds: string[];
}

export type ExternalReactionInput =
  | {
      submissionId: string;
      requestId: string;
      agentId: AgentId;
      kind: "keep";
    }
  | {
      submissionId: string;
      requestId: string;
      agentId: AgentId;
      kind: "replace";
      rawText: string;
      goal: string;
      means: string | null;
      targetIds: string[];
    };

export interface WorldAdvanceRequest {
  expectedRevision: number;
  trigger: "manual" | "batch" | "realtime" | "participant_action";
  externalActions: readonly ExternalActionInput[];
}

export function decisionEligibleAgentIds(
  state: Readonly<SimulationState>,
  forcedAgentIds: readonly AgentId[] = [],
): AgentId[] {
  const decisionAgents = new Set(state.history.at(-1)?.decisionPoints.map((point) => point.agentId) ?? []);
  forcedAgentIds.forEach((agentId) => decisionAgents.add(agentId));
  const busyAgents = new Set(Object.values(state.truth.activities)
    .filter((activity) => activity.status === "active" || activity.status === "paused" ||
      activity.status === "queued" || activity.status === "ready")
    .flatMap((activity) => activity.participantAgentIds));
  return Object.keys(state.agents)
    .filter((agentId) => !busyAgents.has(agentId) || decisionAgents.has(agentId))
    .sort();
}

export interface WorldResolutionCandidate {
  proposal: TransitionProposal;
  initialActions: AgentActionProposal[];
  actions: AgentActionProposal[];
  reactionRequests: ReactionRequest[];
  reactionDecisions: ReactionDecision[];
  stimulusObservations: ObservationPacket[];
  requests: D20CheckRequest[];
  checks: D20CheckResult[];
  randomRequests: DiscreteRandomRequest[];
  randomResults: DiscreteRandomResult[];
  commitmentRounds: CommitmentRound[];
  resolutionPlans: ResolutionPlan[];
  resolutionReceipts: ResolutionReceipt[];
  rng: SeededRngState;
  mechanicResults: MechanicResult[];
  causalAssertionResults: CausalAssertionResult[];
  causalVerification: CausalVerification;
}

export function resolutionObservations(
  resolution: Readonly<WorldResolutionCandidate>,
): ObservationPacket[] {
  return [
    ...structuredClone(resolution.stimulusObservations),
    ...structuredClone(resolution.proposal.observations),
  ];
}

export interface AlgorithmCandidateDiagnostics {
  activatedAgentIds: AgentId[];
  reusedAgentIds: AgentId[];
  mindFallbackAgentIds: AgentId[];
}

export interface WorldStepDiagnostics extends AlgorithmCandidateDiagnostics {
  dependencyComponents: string[][];
  globalReadjudication: boolean;
  /** Deterministic summary of the ephemeral canonical conflict graph. */
  dependencyGraph?: {
    mode: "canonical";
    nodeCount: number;
    edgeCount: number;
    componentCount: number;
    maxComponentSize: number;
    globalFallbackNodeIds: string[];
    contentHash: string;
  };
}

export interface WorldStepCandidate {
  schemaVersion: typeof WORLD_STEP_CANDIDATE_SCHEMA_VERSION;
  sourceStateHash: string;
  resolution: WorldResolutionCandidate;
  mindCommits: Array<AgentMindOutput & { agentId: string }>;
  modelAudits: ModelExecutionAudit[];
  interactionDependencies: InteractionDependency[];
  diagnostics: WorldStepDiagnostics;
  temporalPlans: TemporalPlan[];
  temporalBoundary: TemporalBoundary;
  temporalState: TemporalStateSnapshot;
  activityTransitions: ActivityTransition[];
  activityDispositions: ActivityDisposition[];
  sharedResourceAdmissions: SharedResourceAdmission[];
  decisionPoints: DecisionPoint[];
}

export interface WorldStepPreparation {
  schemaVersion: typeof WORLD_STEP_PREPARATION_SCHEMA_VERSION;
  id: string;
  sourceStateHash: string;
  algorithmManifestHash: string;
  policyRosterHash: string;
  requestHash: string;
  pendingReactionRequests: ReactionRequest[];
  preparedReactionDecisions: ReactionDecision[];
  modelAudits: ModelExecutionAudit[];
  payload: JsonObject;
}

export type FootprintRef =
  | { kind: "entity"; id: string }
  | { kind: "fact"; id: string }
  | { kind: "placement"; id: string }
  | { kind: "meter"; id: string }
  | { kind: "quantity"; id: string }
  | { kind: "rating"; id: string }
  | { kind: "condition"; id: string }
  | { kind: "shared_resource_pool"; id: string }
  | { kind: "global"; id: "world" };

export interface InteractionDependency {
  kind: "action" | "activity" | "timer" | "condition";
  id: string;
  actorId: AgentId | null;
  reads: FootprintRef[];
  writes: FootprintRef[];
  audienceAgentIds: AgentId[];
  sharedResourceClaims: SharedActivityResourceClaim[];
  globalFallback: boolean;
}

export type InteractionDependencyDraft = Omit<InteractionDependency, "kind" | "id" | "actorId" | "sharedResourceClaims"> & {
  sharedResourceClaims: SharedActivityResourceClaimDraft[];
};

/** Model-facing dependency vocabulary. It is resolved into InteractionDependency
 * only after candidate handles have been checked against the request catalog. */
export interface ActionGroundingModelOutput {
  stateDependencies: {
    requiredExistingRefs: ExistingReferenceHandle[];
    potentiallyAffectedExistingRefs: ExistingReferenceHandle[];
  };
  audienceAgentHandles: ExistingReferenceHandle[];
  sharedResourceClaims: ActionSharedResourceClaimModel[];
  requiresWorldWideArbitration: boolean;
}

export interface ActionSharedResourceClaimModel {
  resourcePoolHandle: ExistingReferenceHandle;
  basis:
    | { kind: "default" }
    | { kind: "explicit_quantity"; amount: number; unit: string; sourceText: string };
}

export interface ActionCompilationDraft {
  temporalPlan: Omit<TemporalPlanDraft, "profileId" | "causes" | "continuationAssertions"> & {
    profileRef: ModelReference;
    causes: ModelCausalRef[];
    continuationAssertions: ModelCausalAssertion[];
  };
  interactionDependency: ActionGroundingModelOutput;
}

export interface WorldExecutionAlgorithm {
  readonly manifest: AlgorithmManifest;

  bootstrap(
    input: Readonly<BootstrapInput>,
    context: ExecutionContext,
  ): Promise<BootstrapCandidate>;

  prepareStep(
    input: Readonly<WorldStepInput>,
    context: ExecutionContext,
  ): Promise<WorldStepPreparation>;

  completeStep(
    input: Readonly<WorldStepInput>,
    preparation: Readonly<WorldStepPreparation>,
    reactions: readonly ExternalReactionInput[],
    context: ExecutionContext,
  ): Promise<WorldStepCandidate>;
}

export interface WorldExecutionAlgorithmServices {
  provider: StructuredModelProvider;
  rulePackages?: RulePackageRegistry;
}

export type WorldExecutionAlgorithmFactory = (
  services: Readonly<WorldExecutionAlgorithmServices>,
) => WorldExecutionAlgorithm;

export interface WorldExecutionAlgorithmDefinition {
  id: string;
  version: string;
  manifest(config: JsonObject): AlgorithmManifest;
  create(
    config: JsonObject,
    services: Readonly<WorldExecutionAlgorithmServices>,
  ): WorldExecutionAlgorithm;
}

export class WorldExecutionAlgorithmRegistry {
  private readonly definitions = new Map<string, WorldExecutionAlgorithmDefinition>();
  private readonly instances = new WeakSet<WorldExecutionAlgorithm>();

  register(manifest: AlgorithmManifest, factory: WorldExecutionAlgorithmFactory): void {
    validateExecutionProducerManifest(manifest);
    this.registerDefinition({
      id: manifest.id,
      version: manifest.version,
      manifest: (config) => {
        if (contentHash(config) !== contentHash(manifest.config)) {
          throw new Error(`execution algorithm config is not registered: ${manifest.id}@${manifest.version}`);
        }
        return manifest;
      },
      create: (_config, services) => factory(services),
    });
  }

  registerDefinition(definition: WorldExecutionAlgorithmDefinition): void {
    requireManifestText(definition.id, "execution algorithm definition id");
    requireManifestText(definition.version, "execution algorithm definition version");
    if (typeof definition.manifest !== "function" || typeof definition.create !== "function") {
      throw new Error("execution algorithm definition requires manifest and create functions");
    }
    const key = `${definition.id}@${definition.version}`;
    if (this.definitions.has(key)) throw new Error(`execution algorithm is already registered: ${key}`);
    this.definitions.set(key, definition);
  }

  has(ref: AlgorithmRef): boolean {
    validateAlgorithmRef(ref);
    const definition = this.definitions.get(`${ref.id}@${ref.version}`);
    if (!definition) return false;
    try {
      const manifest = definition.manifest(ref.config);
      validateExecutionProducerManifest(manifest);
      return manifest.id === ref.id && manifest.version === ref.version &&
        manifest.contractVersion === ref.contractVersion && manifest.hash === ref.manifestHash &&
        contentHash(manifest.config) === contentHash(ref.config);
    } catch {
      return false;
    }
  }

  create(ref: AlgorithmRef, services: Readonly<WorldExecutionAlgorithmServices>): WorldExecutionAlgorithm {
    validateAlgorithmRef(ref);
    const key = `${ref.id}@${ref.version}`;
    const definition = this.definitions.get(key);
    if (!definition) throw new Error(`execution algorithm is not registered: ${key}`);
    let manifest: AlgorithmManifest;
    try {
      manifest = definition.manifest(ref.config);
      validateExecutionProducerManifest(manifest);
    } catch (error) {
      throw new Error(`execution algorithm config is not registered: ${key}`, { cause: error });
    }
    if (manifest.id !== ref.id || manifest.version !== ref.version ||
      manifest.contractVersion !== ref.contractVersion || manifest.hash !== ref.manifestHash ||
      contentHash(manifest.config) !== contentHash(ref.config)) {
      throw new Error(`execution algorithm manifest is not registered: ${key}#${ref.manifestHash}`);
    }
    const algorithm = definition.create(ref.config, services);
    if (!algorithm || typeof algorithm !== "object") {
      throw new Error(`execution algorithm factory did not return an algorithm instance: ${key}`);
    }
    if (typeof algorithm.bootstrap !== "function" || typeof algorithm.prepareStep !== "function" ||
      typeof algorithm.completeStep !== "function") {
      throw new Error(`execution algorithm factory returned an incomplete algorithm contract: ${key}`);
    }
    if (algorithm.manifest.id !== ref.id || algorithm.manifest.version !== ref.version ||
      algorithm.manifest.contractVersion !== ref.contractVersion ||
      algorithm.manifest.hash !== manifest.hash ||
      algorithm.manifest.hash !== ref.manifestHash) {
      throw new Error(`execution algorithm factory returned the wrong manifest: ${key}`);
    }
    validateExecutionProducerManifest(algorithm.manifest);
    if (this.instances.has(algorithm)) {
      throw new Error(`execution algorithm factory reused an algorithm instance: ${key}`);
    }
    this.instances.add(algorithm);
    return algorithm;
  }
}
