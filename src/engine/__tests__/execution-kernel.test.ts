import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadWorldScript } from "../../script/world-loader";
import {
  algorithmRef,
  defineAlgorithmManifest,
  WorldExecutionAlgorithmRegistry,
  type AlgorithmManifest,
  type BootstrapCandidate,
  type BootstrapInput,
  type ExecutionContext,
  type WorldExecutionAlgorithm,
  type WorldStepCandidate,
  type WorldStepInput,
} from "../execution";
import { contentHash } from "../model-audit";
import { SimulationEngine } from "../simulation";
import { createTestModelCatalog } from "../testing/model-provider";

const fixture = path.resolve("test/fixtures/open-world-script");

function algorithmManifest(id = "mutation-probe"): AlgorithmManifest {
  return defineAlgorithmManifest({ id, version: "1", config: {}, components: [] });
}

class MutatingAlgorithm implements WorldExecutionAlgorithm {
  constructor(readonly manifest = algorithmManifest()) {}

  async bootstrap(input: Readonly<BootstrapInput>, context: ExecutionContext): Promise<BootstrapCandidate> {
    void context;
    (input.state as { truth: { elapsedSeconds: number } }).truth.elapsedSeconds = 999;
    throw new Error("candidate generation failed");
  }

  async step(input: Readonly<WorldStepInput>, context: ExecutionContext): Promise<WorldStepCandidate> {
    void input;
    void context;
    throw new Error("unused");
  }
}

describe("execution kernel boundary", () => {
  it("does not expose canonical state write capability to an algorithm", async () => {
    const definition = loadWorldScript(fixture, { modelCatalog: createTestModelCatalog() });
    const engine = new SimulationEngine(definition, new MutatingAlgorithm());
    const before = contentHash(engine.snapshot);

    await expect(engine.bootstrapAgents()).rejects.toThrow("candidate generation failed");
    expect(contentHash(engine.snapshot)).toBe(before);
    expect(engine.snapshot.truth.elapsedSeconds).toBe(0);
  });

  it("pins a factory to the registered manifest hash", () => {
    const registry = new WorldExecutionAlgorithmRegistry();
    const registered = algorithmManifest("registered");
    registry.register(registered, () => new MutatingAlgorithm(registered));
    expect(registry.create(algorithmRef(registered), { provider: {} as never }).manifest.hash).toBe(registered.hash);

    const invalid = { ...registered, hash: "0".repeat(64) };
    expect(() => new WorldExecutionAlgorithmRegistry().register(invalid, () => new MutatingAlgorithm()))
      .toThrow("manifest hash mismatch");
  });

  it("rejects malformed manifest configuration and component identities", () => {
    expect(() => defineAlgorithmManifest({
      id: "invalid-json",
      version: "1",
      config: { callback: (() => undefined) as never },
      components: [],
    })).toThrow("JSON-safe");
    expect(() => defineAlgorithmManifest({
      id: "duplicate-components",
      version: "1",
      config: {},
      components: [
        { id: "same", version: "1", config: {} },
        { id: "same", version: "2", config: {} },
      ],
    })).toThrow("duplicate component id");
  });

  it("rejects unsupported contracts, unknown hashes, and wrong factory manifests", () => {
    const registered = algorithmManifest("registered");
    const unsupported = { ...registered, contractVersion: 1 } as unknown as AlgorithmManifest;
    expect(() => new WorldExecutionAlgorithmRegistry().register(unsupported, () => new MutatingAlgorithm()))
      .toThrow("unsupported execution algorithm contract version");

    const registry = new WorldExecutionAlgorithmRegistry();
    registry.register(registered, () => new MutatingAlgorithm(algorithmManifest("different")));
    expect(() => registry.create(algorithmRef(registered), { provider: {} as never }))
      .toThrow("factory returned the wrong manifest");
    expect(() => registry.create({
      ...algorithmRef(registered),
      manifestHash: "sha256:unknown",
    }, { provider: {} as never })).toThrow("manifest is not registered");
  });
});
