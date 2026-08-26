import type { AgentMindOutput } from "./llm-schemas";
import { contentHash } from "./model-audit";
import type {
  ModelExecutionAudit,
  ObservationPacket,
  SimulationState,
} from "./model";
import type { ModelExecutionScope } from "./model-provider";
import type { RuntimeObserver } from "./observability";
import type { TruthResolution } from "./truth-engine";
import type { WorldDefinition } from "./world-definition";

export type ExecutionKind = "interactive" | "diagnostic" | "benchmark" | "replay";

export interface AlgorithmComponentManifest {
  id: string;
  version: string;
  config: Readonly<Record<string, unknown>>;
  hash: string;
}

export interface AlgorithmManifest {
  id: string;
  version: string;
  config: Readonly<Record<string, unknown>>;
  components: readonly AlgorithmComponentManifest[];
  hash: string;
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
}

export interface WorldStepCandidate {
  sourceStateHash: string;
  resolution: TruthResolution;
  observations: ObservationPacket[];
  mindCommits: Array<AgentMindOutput & { agentId: string }>;
  modelAudits: ModelExecutionAudit[];
}

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

export type WorldExecutionAlgorithmFactory = () => WorldExecutionAlgorithm;

export class WorldExecutionAlgorithmRegistry {
  private readonly factories = new Map<string, {
    manifestHash: string;
    factory: WorldExecutionAlgorithmFactory;
  }>();

  register(manifest: AlgorithmManifest, factory: WorldExecutionAlgorithmFactory): void {
    const key = `${manifest.id}@${manifest.version}`;
    const { hash, ...body } = manifest;
    if (contentHash(body) !== hash) throw new Error(`execution algorithm manifest hash mismatch: ${key}`);
    for (const component of manifest.components) {
      const { hash: componentHash, ...componentBody } = component;
      if (contentHash(componentBody) !== componentHash) {
        throw new Error(`execution algorithm component hash mismatch: ${component.id}`);
      }
    }
    if (this.factories.has(key)) throw new Error(`execution algorithm is already registered: ${key}`);
    this.factories.set(key, { manifestHash: manifest.hash, factory });
  }

  create(id: string, version: string): WorldExecutionAlgorithm {
    const key = `${id}@${version}`;
    const registered = this.factories.get(key);
    if (!registered) throw new Error(`execution algorithm is not registered: ${key}`);
    const algorithm = registered.factory();
    if (algorithm.manifest.id !== id || algorithm.manifest.version !== version ||
      algorithm.manifest.hash !== registered.manifestHash ||
      algorithm.manifest.hash !== contentHash({
        id: algorithm.manifest.id,
        version: algorithm.manifest.version,
        config: algorithm.manifest.config,
        components: algorithm.manifest.components,
      })) {
      throw new Error(`execution algorithm factory returned the wrong manifest: ${key}`);
    }
    return algorithm;
  }
}
