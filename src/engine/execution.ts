import type { AgentMindOutput } from "./llm-schemas";
import { contentHash } from "./model-audit";
import { runtimeId } from "./runtime-id";
import type {
  AgentActionProposal,
  AgentId,
  ModelExecutionAudit,
  ObservationPacket,
  SimulationState,
} from "./model";
import type { ModelExecutionScope } from "./model-provider";
import type { StructuredModelProvider } from "./model-provider";
import type { RuntimeObserver } from "./observability";
import type { RulePackageRegistry } from "./rule-package";
import type { TruthResolution } from "./truth-engine";
import type { WorldDefinition } from "./world-definition";
import type {
  ActivityTransition,
  DecisionPoint,
  TemporalBoundary,
  TemporalPlan,
  TemporalStateSnapshot,
} from "./temporal";

export type ExecutionKind = "interactive" | "diagnostic" | "benchmark" | "replay";

export const WORLD_EXECUTION_CONTRACT_VERSION = 2 as const;
export const ENGINE_OPERATION_CONTRACT_VERSION = 1 as const;

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
    for (let index = 0; index < value.length; index += 1) {
      if (!(index in value)) throw new Error(`${label} must not contain sparse arrays`);
      assertJsonValue(value[index], `${label}[${index}]`, seen);
    }
  } else {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new Error(`${label} must contain only plain objects`);
    }
    for (const [key, entry] of Object.entries(value)) {
      if (!key.trim()) throw new Error(`${label} keys must be non-empty`);
      assertJsonValue(entry, `${label}.${key}`, seen);
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
    manifestHash: manifest.hash,
  });
}

export function validateAlgorithmRef(ref: AlgorithmRef): void {
  if (!ref || typeof ref !== "object") throw new Error("execution algorithm reference is required");
  requireManifestText(ref.id, "execution algorithm reference id");
  requireManifestText(ref.version, "execution algorithm reference version");
  requireManifestText(ref.manifestHash, "execution algorithm reference manifest hash");
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
  executionId: string;
  abortSignal?: AbortSignal;
  modelScope: ModelExecutionScope;
  random: () => number;
  trace: ExecutionTraceWriter;
}

export interface BootstrapInput {
  definition: WorldDefinition;
  state: SimulationState;
}

export interface BootstrapCandidate {
  sourceStateHash: string;
  agentCommits: Array<AgentMindOutput & { agentId: string }>;
  modelAudits: ModelExecutionAudit[];
}

export interface WorldStepInput {
  definition: WorldDefinition;
  state: SimulationState;
  policyRoster: Readonly<Record<AgentId, PolicyBinding>>;
  request: Readonly<WorldAdvanceRequest>;
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

export interface WorldAdvanceRequest {
  expectedRevision: number;
  trigger: "manual" | "batch" | "realtime" | "participant_action";
  externalActions: readonly ExternalActionInput[];
}

export function noopAction(
  state: Readonly<SimulationState>,
  agentId: AgentId,
  reason: "timeout" | "released" | "explicit",
): AgentActionProposal {
  return {
    id: runtimeId({
      worldHash: state.worldHash,
      revision: state.revision,
      kind: "action",
      stage: "idle",
      owner: agentId,
      round: 0,
      ordinal: 0,
    }),
    actorId: agentId,
    baseRevision: state.revision,
    rawText: `保持空闲（${reason}）`,
    goal: "本步骤不采取主动行动",
    means: null,
    targetIds: [],
  };
}

export interface WorldStepCandidate {
  sourceStateHash: string;
  resolution: TruthResolution;
  observations: ObservationPacket[];
  mindCommits: Array<AgentMindOutput & { agentId: string }>;
  modelAudits: ModelExecutionAudit[];
  groundings: ActionGrounding[];
  components: AgentId[][];
  temporalPlans: TemporalPlan[];
  temporalBoundary: TemporalBoundary;
  temporalState: TemporalStateSnapshot;
  activityTransitions: ActivityTransition[];
  decisionPoints: DecisionPoint[];
}

export type FootprintRef =
  | { kind: "entity"; id: string }
  | { kind: "fact"; id: string }
  | { kind: "placement"; id: string }
  | { kind: "meter"; id: string }
  | { kind: "quantity"; id: string }
  | { kind: "rating"; id: string }
  | { kind: "condition"; id: string }
  | { kind: "global"; id: "world" };

export interface ActionGrounding {
  actionId: string;
  actorId: AgentId;
  reads: FootprintRef[];
  writes: FootprintRef[];
  audienceAgentIds: AgentId[];
  globalFallback: boolean;
}

export type ActionGroundingDraft = Omit<ActionGrounding, "actionId" | "actorId">;

export interface WorldExecutionAlgorithm {
  readonly manifest: AlgorithmManifest;

  bootstrap(
    input: Readonly<BootstrapInput>,
    context: ExecutionContext,
  ): Promise<BootstrapCandidate>;

  step(
    input: Readonly<WorldStepInput>,
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

export class WorldExecutionAlgorithmRegistry {
  private readonly factories = new Map<string, {
    manifestHash: string;
    factory: WorldExecutionAlgorithmFactory;
  }>();

  register(manifest: AlgorithmManifest, factory: WorldExecutionAlgorithmFactory): void {
    const key = `${manifest.id}@${manifest.version}`;
    validateExecutionProducerManifest(manifest);
    if (this.factories.has(key)) throw new Error(`execution algorithm is already registered: ${key}`);
    this.factories.set(key, { manifestHash: manifest.hash, factory });
  }

  has(ref: AlgorithmRef): boolean {
    validateAlgorithmRef(ref);
    const registered = this.factories.get(`${ref.id}@${ref.version}`);
    return registered?.manifestHash === ref.manifestHash;
  }

  create(ref: AlgorithmRef, services: Readonly<WorldExecutionAlgorithmServices>): WorldExecutionAlgorithm {
    validateAlgorithmRef(ref);
    const key = `${ref.id}@${ref.version}`;
    const registered = this.factories.get(key);
    if (!registered) throw new Error(`execution algorithm is not registered: ${key}`);
    if (registered.manifestHash !== ref.manifestHash) {
      throw new Error(`execution algorithm manifest is not registered: ${key}#${ref.manifestHash}`);
    }
    const algorithm = registered.factory(services);
    if (algorithm.manifest.id !== ref.id || algorithm.manifest.version !== ref.version ||
      algorithm.manifest.contractVersion !== ref.contractVersion ||
      algorithm.manifest.hash !== registered.manifestHash ||
      algorithm.manifest.hash !== ref.manifestHash) {
      throw new Error(`execution algorithm factory returned the wrong manifest: ${key}`);
    }
    validateExecutionProducerManifest(algorithm.manifest);
    return algorithm;
  }
}
