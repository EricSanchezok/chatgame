import { describe, expect, it } from "vitest";
import { selectActionCompilationLiveVariant } from "./live-selection";

const passingCandidate = {
  runs: 36,
  successfulRuns: 36,
  runSuccessRate: 1,
  profileAccuracy: 1,
  requestBytesP95: 865_563,
  perSlotInputTokensP95: 195_720,
};

describe("Action Compilation live selection", () => {
  it("promotes a fully correct candidate even when the baseline has a failure", () => {
    const result = selectActionCompilationLiveVariant({
      c2: {
        runs: 36,
        successfulRuns: 35,
        runSuccessRate: 35 / 36,
        profileAccuracy: 213 / 215,
        requestBytesP95: 896_051,
        perSlotInputTokensP95: 228_338,
      },
      c3: passingCandidate,
      modelIdentity: true,
      repeatedInvalidFingerprintSecondRepair: true,
      completePairedDesign: true,
    });

    expect(result.correctnessGates.c3NoFailedRuns).toBe(true);
    expect(result.selected).toBe("C3");
  });

  it("keeps the safe baseline when the candidate has any correctness failure", () => {
    const result = selectActionCompilationLiveVariant({
      c2: { ...passingCandidate },
      c3: { ...passingCandidate, successfulRuns: 35, runSuccessRate: 35 / 36 },
      modelIdentity: true,
      repeatedInvalidFingerprintSecondRepair: true,
      completePairedDesign: true,
    });

    expect(result.correctnessGates.c3NoFailedRuns).toBe(false);
    expect(result.selected).toBe("C2");
  });
});
