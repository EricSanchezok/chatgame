import {
  CachedPassageEncoder,
} from "../engine/algorithms/eager-reference/candidate-retrieval/embedding-cache";
import { createRuntimeGraphSlotRetriever } from "../engine/algorithms/eager-reference/candidate-retrieval/graph-aware";
import {
  discoverLocalEncoderModelDirectory,
  livingWorldCacheRoot,
  loadLocalMultilingualE5Small,
  localEncoderFingerprint,
  type LocalEncoderRuntime,
} from "../engine/algorithms/eager-reference/candidate-retrieval/local-encoder";
import {
  ACTION_COMPILATION_RETRIEVAL_RUNTIME_VERSION,
  createActionCompilationRetrievalRuntime,
  type ActionCompilationRetrievalRuntime,
} from "../engine/algorithms/eager-reference/candidate-retrieval/runtime";
import { ACTION_COMPILATION_PASSAGE_SCHEMA_VERSION } from "../engine/algorithms/eager-reference/candidate-retrieval/graph-aware";
import { actionCompilationPassagesForState } from "../engine/algorithms/eager-reference/candidate-retrieval/warmup";
import type { SimulationState } from "../engine/contracts/model";
import type { AlgorithmRef } from "../engine/runtime/execution";
import type { AlgorithmExperimentRegistry } from "../engine/runtime/experiments";

const modelLoads = new Map<string, Promise<LocalEncoderRuntime>>();

function loadEncoderOnce(modelDirectory: string): Promise<LocalEncoderRuntime> {
  const existing = modelLoads.get(modelDirectory);
  if (existing) return existing;
  const pending = loadLocalMultilingualE5Small({ modelDirectory });
  modelLoads.set(modelDirectory, pending);
  pending.catch(() => modelLoads.delete(modelDirectory));
  return pending;
}

function retrievalConfig(ref: AlgorithmRef): {
  runtimeVersion: string;
  encoderFingerprint: string;
  budgetRatio: 0.2;
  maxPathDepth: 3;
} | undefined {
  const selection = ref.children.actionCompilation?.children.candidateSelection;
  if (!selection || selection.id === "full-catalog") return undefined;
  if (selection.role !== "candidate-selection" || selection.id !== "graph-hybrid-e5" ||
    typeof selection.config.encoderFingerprint !== "string" || selection.config.budgetRatio !== 0.2 ||
    selection.config.maxPathDepth !== 3) {
    throw new Error(`candidate selection config is invalid for ${selection.role}/${selection.id}@${selection.version}`);
  }
  return {
    runtimeVersion: ACTION_COMPILATION_RETRIEVAL_RUNTIME_VERSION,
    encoderFingerprint: selection.config.encoderFingerprint,
    budgetRatio: 0.2,
    maxPathDepth: 3,
  };
}

interface VariantRuntime {
  runtime: ActionCompilationRetrievalRuntime;
  preflight(input: { worldContentHash: string; state: Readonly<SimulationState> }): Promise<void>;
}

export interface ActionCompilationRetrievalExperimentSupport {
  runtimes: ReadonlyMap<string, ActionCompilationRetrievalRuntime>;
  preflights: ReadonlyMap<string, VariantRuntime["preflight"]>;
}

function lazyVariantRuntime(input: {
  config: NonNullable<ReturnType<typeof retrievalConfig>>;
  cacheRoot: string;
  loadEncoder: () => Promise<LocalEncoderRuntime>;
  onSafetyViolation: (reason: string) => void;
}): VariantRuntime {
  let delegate: Promise<{
    runtime: ActionCompilationRetrievalRuntime;
    passageEncoder: CachedPassageEncoder;
  }> | undefined;
  const load = () => {
    delegate ??= input.loadEncoder().then((encoder) => {
      const fingerprint = localEncoderFingerprint(encoder, ACTION_COMPILATION_PASSAGE_SCHEMA_VERSION);
      if (fingerprint !== input.config.encoderFingerprint) {
        throw new Error(`candidate retrieval encoder fingerprint drift: expected ${input.config.encoderFingerprint}, got ${fingerprint}`);
      }
      const passageEncoder = new CachedPassageEncoder(encoder, fingerprint, input.cacheRoot, true);
      return {
        passageEncoder,
        runtime: createActionCompilationRetrievalRuntime({
          version: input.config.runtimeVersion,
          budgetRatio: input.config.budgetRatio,
          retrieveSlot: createRuntimeGraphSlotRetriever({
            strategy: "graph-hybrid",
            encoder,
            passageEncoder,
            maxPathDepth: input.config.maxPathDepth,
          }),
        }),
      };
    });
    return delegate;
  };
  const withSafetyBoundary = async <T>(task: () => Promise<T>): Promise<T> => {
    try {
      return await task();
    } catch (error) {
      input.onSafetyViolation(error instanceof Error ? error.message : String(error));
      throw error;
    }
  };
  return {
    runtime: {
      version: input.config.runtimeVersion,
      role: "candidate-selection",
      async retrieveBatch(request) {
        return withSafetyBoundary(async () => (await load()).runtime.retrieveBatch(request));
      },
    },
    async preflight(request) {
      return withSafetyBoundary(async () => {
        if (request.state.worldHash !== request.worldContentHash) {
          throw new Error("candidate retrieval preflight world hash does not match state");
        }
        const passages = actionCompilationPassagesForState(request.state);
        const prepared = await load();
        const result = await prepared.passageEncoder.encodePassages({
          worldContentHash: request.worldContentHash,
          passages,
          allowWrite: false,
        });
        if (result.misses !== 0 || result.hits !== new Set(passages).size) {
          throw new Error("candidate retrieval preflight did not verify every world passage");
        }
      });
    },
  };
}

export function actionCompilationRetrievalSupportForExperiment(
  experiments: AlgorithmExperimentRegistry,
  options: { cacheRoot?: string; modelDirectory?: string; encoder?: LocalEncoderRuntime } = {},
): ActionCompilationRetrievalExperimentSupport {
  const manifest = experiments.active();
  if (!manifest) return { runtimes: new Map(), preflights: new Map() };
  const cacheRoot = options.cacheRoot ?? livingWorldCacheRoot();
  const refs = manifest.variants.map((variant) => variant.algorithmRef);
  const runtimeRefs = refs.flatMap((ref) => retrievalConfig(ref) ? [ref] : []);
  if (runtimeRefs.length === 0) return { runtimes: new Map(), preflights: new Map() };
  const modelDirectory = options.encoder ? undefined : options.modelDirectory ?? discoverLocalEncoderModelDirectory(cacheRoot);
  const variants = runtimeRefs.map((ref) => {
    const config = retrievalConfig(ref)!;
    const support = lazyVariantRuntime({
      config,
      cacheRoot,
      loadEncoder: options.encoder
        ? async () => options.encoder!
        : () => loadEncoderOnce(modelDirectory!),
      onSafetyViolation: (reason) => experiments.stopNewEnrollment(`candidate retrieval runtime failure: ${reason}`),
    });
    return { manifestHash: ref.manifestHash, support };
  });
  return {
    runtimes: new Map(variants.map(({ manifestHash, support }) => [manifestHash, support.runtime])),
    preflights: new Map(variants.map(({ manifestHash, support }) => [manifestHash, support.preflight])),
  };
}

export function clearActionCompilationEncoderSingletonsForTests(): void {
  modelLoads.clear();
}
