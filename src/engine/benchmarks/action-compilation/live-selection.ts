export interface ActionCompilationLiveVariantMetrics {
  runs: number;
  successfulRuns: number;
  runSuccessRate: number;
  profileAccuracy: number;
  requestBytesP95: number | null;
  perSlotInputTokensP95: number | null;
}

export function selectActionCompilationLiveVariant(input: {
  c2: ActionCompilationLiveVariantMetrics;
  c3: ActionCompilationLiveVariantMetrics;
  modelIdentity: boolean;
  repeatedInvalidFingerprintSecondRepair: boolean;
  completePairedDesign: boolean;
}) {
  const correctnessGates = {
    modelIdentity: input.modelIdentity,
    c3NoFailedRuns: input.c3.successfulRuns === input.c3.runs,
    c3CommitNonInferior: input.c3.runSuccessRate >= input.c2.runSuccessRate,
    c3ProfileAccuracyNonInferior: input.c3.profileAccuracy >= input.c2.profileAccuracy,
    repeatedInvalidFingerprintSecondRepair: input.repeatedInvalidFingerprintSecondRepair,
  };
  const experimentGates = {
    completePairedDesign: input.completePairedDesign,
    c3PerSlotInputP95Lower: input.c2.perSlotInputTokensP95 !== null &&
      input.c3.perSlotInputTokensP95 !== null &&
      input.c3.perSlotInputTokensP95 < input.c2.perSlotInputTokensP95,
  };
  const comparison = {
    c3PerSlotInputP95Reduction: input.c2.perSlotInputTokensP95 === null ||
      input.c3.perSlotInputTokensP95 === null
      ? null
      : 1 - input.c3.perSlotInputTokensP95 / input.c2.perSlotInputTokensP95,
    c3RequestBytesP95Reduction: input.c2.requestBytesP95 === null || input.c3.requestBytesP95 === null
      ? null
      : 1 - input.c3.requestBytesP95 / input.c2.requestBytesP95,
  };
  const selected = Object.values(correctnessGates).every(Boolean) &&
    Object.values(experimentGates).every(Boolean)
    ? "C3" as const
    : "C2" as const;
  return { correctnessGates, experimentGates, comparison, selected };
}
