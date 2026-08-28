import { describe, expect, it } from "vitest";
import { runCausalActivityBenchmark } from "../causal-activity-benchmark";

describe("causal Activity benchmark", () => {
  it("keeps the indexed affected set exact across the conflict and Activity matrix", () => {
    const report = runCausalActivityBenchmark({
      agents: [1, 10, 50],
      samplesPerScenario: 2,
    });
    expect(report.scenarios).toHaveLength(3 * 4 * 5);
    for (const scenario of report.scenarios) {
      expect(scenario.semantic).toMatchObject({
        scenarioPassRate: 1,
        affectedActivityRecall: 1,
        falseActivationRate: 0,
        causalOrderViolations: 0,
        replayHashConsistent: true,
      });
      expect(scenario.modelCost.invocations).toBe(0);
      expect(scenario.computation.footprintQueries).toBe(4);
      expect(scenario.playerWaitMs).toBeNull();
    }
  });
});
