import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_EAGER_REFERENCE_CONFIG } from "../../engine/algorithms/eager-reference/eager-reference";
import { CachedPassageEncoder } from "../../engine/algorithms/eager-reference/candidate-retrieval/embedding-cache";
import { ACTION_COMPILATION_PASSAGE_SCHEMA_VERSION } from "../../engine/algorithms/eager-reference/candidate-retrieval/graph-aware";
import { localEncoderFingerprint, type LocalEncoderRuntime } from "../../engine/algorithms/eager-reference/candidate-retrieval/local-encoder";
import { actionCompilationPassagesForState } from "../../engine/algorithms/eager-reference/candidate-retrieval/warmup";
import { DEFAULT_ALGORITHM_REF, eagerReferenceAlgorithmRef, registerBuiltinAlgorithms } from "../../engine/algorithms/registry";
import { AlgorithmExperimentRegistry, defineAlgorithmExperimentManifest } from "../../engine/runtime/experiments";
import { WorldExecutionAlgorithmRegistry } from "../../engine/runtime/execution";
import { createTestModelCatalog, DeterministicModelProvider } from "../../engine/testing/model-provider";
import { loadWorldScript } from "../../script/world-loader";
import { actionCompilationRetrievalSupportForExperiment } from "../action-compilation-retrieval-runtime";

const roots: string[] = [];

afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));

function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), "lwe-retrieval-runtime-"));
  roots.push(root);
  const encoder: LocalEncoderRuntime = {
    modelId: "fixture-encoder",
    modelHash: `sha256:${"1".repeat(64)}`,
    dimensions: 2,
    async encodeBatch(texts) {
      return texts.map((text) => [text.length % 7, 1]);
    },
  };
  const fingerprint = localEncoderFingerprint(encoder, ACTION_COMPILATION_PASSAGE_SCHEMA_VERSION);
  const treatment = eagerReferenceAlgorithmRef({
    ...DEFAULT_EAGER_REFERENCE_CONFIG,
    candidateRetrieval: {
      mode: "runtime",
      runtimeVersion: "action-compilation-retrieval-runtime-v4",
      encoderFingerprint: fingerprint,
      budgetRatio: 0.2,
    },
  });
  const algorithms = registerBuiltinAlgorithms(new WorldExecutionAlgorithmRegistry());
  const experiments = new AlgorithmExperimentRegistry(algorithms);
  const provider = new DeterministicModelProvider(createTestModelCatalog());
  const definition = loadWorldScript(path.resolve("test/fixtures/open-world-script"), { seed: 47, modelCatalog: provider.catalog });
  const manifest = defineAlgorithmExperimentManifest({
    id: "retrieval-fixture",
    version: "1",
    salt: "fixture",
    eligibility: { worldContentHashes: [definition.contentHash] },
    variants: [
      { id: "control", allocationBasisPoints: 7_000, algorithmRef: DEFAULT_ALGORITHM_REF },
      { id: "treatment", allocationBasisPoints: 3_000, algorithmRef: treatment },
    ],
    activationEvidence: { artifactHash: `sha256:${"2".repeat(64)}`, verifier: "fixture" },
  });
  experiments.register(manifest);
  experiments.activate(manifest.id, manifest.version);
  return { root, encoder, fingerprint, treatment, experiments, definition };
}

describe("Action Compilation experiment runtime support", () => {
  it("does not inspect encoder assets when no experiment is active", () => {
    const algorithms = registerBuiltinAlgorithms(new WorldExecutionAlgorithmRegistry());
    const experiments = new AlgorithmExperimentRegistry(algorithms);
    const support = actionCompilationRetrievalSupportForExperiment(experiments, {
      cacheRoot: path.join("does-not-exist", "cache"),
    });
    expect(support.runtimes.size).toBe(0);
    expect(support.preflights.size).toBe(0);
  });

  it("fails treatment creation preflight on a cold cache and stops future enrollment", async () => {
    const input = fixture();
    const support = actionCompilationRetrievalSupportForExperiment(input.experiments, {
      cacheRoot: input.root,
      encoder: input.encoder,
    });
    const preflight = support.preflights.get(input.treatment.manifestHash)!;
    await expect(preflight({
      worldContentHash: input.definition.contentHash,
      state: input.definition.initialState,
    })).rejects.toThrow();
    expect(input.experiments.enrollmentStatus()).toMatchObject({ stopped: true });
  });

  it("verifies every current world passage before treatment instance creation", async () => {
    const input = fixture();
    const passages = actionCompilationPassagesForState(input.definition.initialState);
    const writer = new CachedPassageEncoder(input.encoder, input.fingerprint, input.root);
    await writer.encodePassages({
      worldContentHash: input.definition.contentHash,
      passages,
      allowWrite: true,
    });
    writer.close();
    const support = actionCompilationRetrievalSupportForExperiment(input.experiments, {
      cacheRoot: input.root,
      encoder: input.encoder,
    });
    await expect(support.preflights.get(input.treatment.manifestHash)!({
      worldContentHash: input.definition.contentHash,
      state: input.definition.initialState,
    })).resolves.toBeUndefined();
    expect(input.experiments.enrollmentStatus()).toEqual({ stopped: false });
  });
});
