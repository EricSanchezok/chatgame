import {
  createEagerReferenceManifest,
  EagerReferenceAlgorithm,
  EAGER_REFERENCE_MANIFEST,
  parseEagerReferenceAlgorithmConfig,
  type EagerReferenceAlgorithmConfig,
} from "./eager-reference/eager-reference";
import {
  algorithmRef,
  WorldExecutionAlgorithmRegistry,
  type AlgorithmRef,
} from "../runtime/execution";

export const DEFAULT_ALGORITHM_REF: AlgorithmRef = algorithmRef(EAGER_REFERENCE_MANIFEST);

export function eagerReferenceAlgorithmRef(
  config: Readonly<EagerReferenceAlgorithmConfig>,
): AlgorithmRef {
  return algorithmRef(createEagerReferenceManifest(config));
}

export function registerBuiltinAlgorithms(
  registry: WorldExecutionAlgorithmRegistry = new WorldExecutionAlgorithmRegistry(),
): WorldExecutionAlgorithmRegistry {
  if (!registry.has(DEFAULT_ALGORITHM_REF)) {
    registry.registerDefinition({
      id: EAGER_REFERENCE_MANIFEST.id,
      version: EAGER_REFERENCE_MANIFEST.version,
      manifest: (config) => createEagerReferenceManifest(config),
      create: (config, services) => new EagerReferenceAlgorithm(
        services.provider,
        services.rulePackages,
        parseEagerReferenceAlgorithmConfig(config),
        services.actionCompilationRetrieval,
      ),
    });
  }
  return registry;
}
