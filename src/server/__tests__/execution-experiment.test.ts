import { describe, expect, it } from "vitest";
import {
  parseExperimentMatrix,
  runDeterministicExperiment,
} from "../../../scripts/experiment-core";

describe("execution experiment core", () => {
  it("runs the small deterministic CI scenario without a remote model", async () => {
    const result = await runDeterministicExperiment({ agents: [1], steps: [1] });
    expect(result.scenarios).toEqual([expect.objectContaining({
      agents: 1,
      steps: 1,
      modelInvocations: 10,
      instanceDocumentBytes: expect.any(Number),
      ledgerEventCount: 0,
    })]);
    expect(result.scenarios[0].instanceDocumentBytes).toBeGreaterThan(0);
    expect(result.records.at(-1)).toMatchObject({
      schemaVersion: 2,
      event: "experiment.summary",
      kind: "deterministic-eager-reference",
    });
    expect(result.records.some((record) => record.event === "experiment.context")).toBe(true);
    expect(result.records.some((record) => record.event === "experiment.bootstrap")).toBe(true);
    expect(result.records.some((record) => record.event === "experiment.step")).toBe(true);
  });

  it("re-pins the replay base when the experiment fixture adds Agents", async () => {
    const result = await runDeterministicExperiment({ agents: [2], steps: [1] });
    expect(result.scenarios).toEqual([expect.objectContaining({
      agents: 2,
      steps: 1,
      modelInvocations: 13,
    })]);
  });

  it("parses comma-separated matrices and rejects non-positive values", () => {
    expect(parseExperimentMatrix(["--agents", "50,1,10", "--steps=10,1"]))
      .toEqual({ agents: [1, 10, 50], steps: [1, 10] });
    expect(() => parseExperimentMatrix(["--steps", "0"])).toThrow("positive safe integers");
    expect(() => parseExperimentMatrix(["--steps"])).toThrow("requires a comma-separated value");
    expect(() => parseExperimentMatrix(["--unknown", "1"])).toThrow("unknown experiment argument");
  });
});
