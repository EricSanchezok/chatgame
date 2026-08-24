import { describe, expect, it } from "vitest";
import {
  parseDiagnosticMatrix,
  runDeterministicRuntimeDiagnostic,
} from "../../../scripts/runtime-diagnostic-core";

describe("runtime diagnostic core", () => {
  it("runs the small deterministic CI scenario without a remote model", async () => {
    const result = await runDeterministicRuntimeDiagnostic({ agents: [1], steps: [1] });
    expect(result.scenarios).toEqual([expect.objectContaining({
      agents: 1,
      steps: 1,
      modelInvocations: 7,
      archiveBytes: expect.any(Number),
    })]);
    expect(result.scenarios[0].archiveBytes).toBeGreaterThan(0);
    expect(result.records.at(-1)).toMatchObject({
      schemaVersion: 1,
      event: "diagnostic.summary",
      kind: "deterministic-runtime",
    });
    expect(result.records.some((record) => record.event === "diagnostic.context")).toBe(true);
    expect(result.records.some((record) => record.event === "diagnostic.bootstrap")).toBe(true);
    expect(result.records.some((record) => record.event === "diagnostic.step")).toBe(true);
  });

  it("re-pins the replay base when the diagnostic fixture adds Agents", async () => {
    const result = await runDeterministicRuntimeDiagnostic({ agents: [2], steps: [1] });
    expect(result.scenarios).toEqual([expect.objectContaining({
      agents: 2,
      steps: 1,
      modelInvocations: 9,
    })]);
  });

  it("parses comma-separated matrices and rejects non-positive values", () => {
    expect(parseDiagnosticMatrix(["--agents", "50,1,10", "--steps=10,1"]))
      .toEqual({ agents: [1, 10, 50], steps: [1, 10] });
    expect(() => parseDiagnosticMatrix(["--steps", "0"])).toThrow("positive safe integers");
    expect(() => parseDiagnosticMatrix(["--steps"])).toThrow("requires a comma-separated value");
    expect(() => parseDiagnosticMatrix(["--unknown", "1"])).toThrow("unknown diagnostic argument");
  });
});
