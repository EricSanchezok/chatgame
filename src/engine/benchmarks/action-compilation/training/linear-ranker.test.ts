import { describe, expect, it } from "vitest";
import { scoreLinearRanker, trainPairwiseLinearRanker } from "./linear-ranker";

describe("deterministic pairwise linear ranker", () => {
  it("learns a positive margin and is byte-stable", () => {
    const examples = [
      { id: "case-2", positive: [1, 0], negative: [0, 1] },
      { id: "case-1", positive: [1, 0], negative: [0, 1] },
    ];
    const first = trainPairwiseLinearRanker(examples, { maxEpochs: 20 });
    const second = trainPairwiseLinearRanker([...examples].reverse(), { maxEpochs: 20 });
    expect(first).toEqual(second);
    expect(scoreLinearRanker(first.ranker, [1, 0])).toBeGreaterThan(scoreLinearRanker(first.ranker, [0, 1]));
    expect(first.ranker.modelHash).toMatch(/^sha256:[0-9a-f]{64}$/u);
  });

  it("retains the fixed training configuration in the artifact", () => {
    const artifact = trainPairwiseLinearRanker([], {}, [], false);
    expect(artifact.config).toMatchObject({ seed: 20260904, learningRate: 0.05, l2: 0.0001, maxEpochs: 100 });
    expect(artifact.promotable).toBe(false);
    expect(artifact.featureSchemaHash).toMatch(/^sha256:[0-9a-f]{64}$/u);
  });
});
