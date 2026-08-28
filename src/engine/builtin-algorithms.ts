import { EagerReferenceAlgorithm, EAGER_REFERENCE_MANIFEST } from "./eager-reference";
import {
  algorithmRef,
  WorldExecutionAlgorithmRegistry,
  type AlgorithmRef,
} from "./execution";

export const DEFAULT_ALGORITHM_REF: AlgorithmRef = algorithmRef(EAGER_REFERENCE_MANIFEST);

export function registerBuiltinAlgorithms(
  registry: WorldExecutionAlgorithmRegistry = new WorldExecutionAlgorithmRegistry(),
): WorldExecutionAlgorithmRegistry {
  if (!registry.has(DEFAULT_ALGORITHM_REF)) {
    registry.register(EAGER_REFERENCE_MANIFEST, (services) =>
      new EagerReferenceAlgorithm(services.provider, services.rulePackages));
  }
  return registry;
}
