import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadWorldScript } from "../../script/world-loader";
import type {
  AlgorithmManifest,
  BootstrapCandidate,
  BootstrapInput,
  ExecutionContext,
  WorldExecutionAlgorithm,
  WorldStepCandidate,
  WorldStepInput,
} from "../execution";
import { WorldExecutionAlgorithmRegistry } from "../execution";
import { contentHash } from "../model-audit";
import { SimulationEngine } from "../simulation";
import { createTestModelCatalog } from "../testing/model-provider";

const fixture = path.resolve("test/fixtures/open-world-script");

function algorithmManifest(id = "mutation-probe"): AlgorithmManifest {
  const body = { id, version: "1", config: {}, components: [] };
  return { ...body, hash: contentHash(body) };
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
    expect(registry.create("registered", "1").manifest.hash).toBe(registered.hash);

    const invalid = { ...registered, hash: "0".repeat(64) };
    expect(() => new WorldExecutionAlgorithmRegistry().register(invalid, () => new MutatingAlgorithm()))
      .toThrow("manifest hash mismatch");
  });
});
