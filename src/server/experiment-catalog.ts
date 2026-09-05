import { readFileSync } from "node:fs";
import path from "node:path";
import {
  AlgorithmExperimentRegistry,
  validateAlgorithmExperimentManifest,
  type AlgorithmExperimentManifest,
  type ExperimentEnrollmentSafetyStore,
} from "../engine/runtime/experiments";
import type { WorldExecutionAlgorithmRegistry } from "../engine/runtime/execution";
import { verifyExperimentActivationEvidence } from "./experiment-activation";

interface ExperimentCatalogDocument {
  schemaVersion: 1;
  manifests: AlgorithmExperimentManifest[];
  active: Array<{ layer: "world-execution"; experimentId: string; version: string }>;
}

function parseDocument(value: unknown): ExperimentCatalogDocument {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("experiment catalog must be an object");
  const document = value as Partial<ExperimentCatalogDocument>;
  if (document.schemaVersion !== 1 || !Array.isArray(document.manifests) || !Array.isArray(document.active)) {
    throw new Error("experiment catalog schema v1 required");
  }
  document.manifests.forEach(validateAlgorithmExperimentManifest);
  for (const active of document.active) {
    if (active.layer !== "world-execution" || typeof active.experimentId !== "string" || typeof active.version !== "string") {
      throw new Error("experiment catalog active entry is invalid");
    }
  }
  if (document.active.length > 1) throw new Error("only one world-execution experiment may be active");
  return document as ExperimentCatalogDocument;
}

export function loadAlgorithmExperimentRegistry(
  algorithms: WorldExecutionAlgorithmRegistry,
  file = path.resolve(/* turbopackIgnore: true */ process.env.LIVINGWORLD_EXPERIMENT_CATALOG_PATH ?? "config/experiments.json"),
  safetyStore?: ExperimentEnrollmentSafetyStore,
): AlgorithmExperimentRegistry {
  const document = parseDocument(JSON.parse(readFileSync(/* turbopackIgnore: true */ file, "utf8")) as unknown);
  const registry = new AlgorithmExperimentRegistry(algorithms, safetyStore);
  document.manifests.forEach((manifest) => registry.register(manifest));
  document.active.forEach((entry) => {
    const manifest = registry.manifest(entry.experimentId, entry.version);
    if (!manifest) throw new Error(`active experiment is not registered: ${entry.experimentId}@${entry.version}`);
    verifyExperimentActivationEvidence(manifest);
    registry.activate(entry.experimentId, entry.version);
  });
  return registry;
}
