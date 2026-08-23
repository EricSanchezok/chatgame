import { describe, expect, it } from "vitest";
import { resolutionDirectiveSchema } from "../llm-schemas";
import type {
  DiscreteRandomDefinition,
  DiscreteRandomRequest,
  DiscreteRandomResult,
} from "../model";
import {
  MAX_RANDOM_CATALOG_UTF8_BYTES,
  MAX_RANDOM_DISTRIBUTION_UTF8_BYTES,
  MAX_RANDOM_DISTRIBUTIONS_PER_WORLD,
  MAX_RANDOM_DRAWS_PER_DISTRIBUTION,
  MAX_RANDOM_DRAWS_PER_STEP,
  MAX_RANDOM_OUTCOME_UTF8_BYTES,
  MAX_RANDOM_REQUESTS_PER_ROUND,
  MAX_RANDOM_REQUESTS_PER_STEP,
  MAX_RANDOM_RESULT_UTF8_BYTES_PER_STEP,
  MAX_RANDOM_RNG_WORDS_PER_STEP,
  MAX_RANDOM_SNAPSHOT_UTF8_BYTES_PER_STEP,
  stableRandomUtf8Bytes,
} from "../random-limits";
import {
  createSeededRng,
  drawInteger,
  validateDiscreteRandomCommitmentBudget,
  validateDiscreteRandomDefinitions,
} from "../random";

function simpleDefinition(id: string, description = "x"): DiscreteRandomDefinition {
  return {
    id,
    description,
    steps: [{
      id: "value",
      count: 1,
      outcomes: [0, 1],
      aggregate: "first",
      when: null,
    }],
  };
}

function definitionWithBytes(id: string, targetBytes: number): DiscreteRandomDefinition {
  const definition = simpleDefinition(id);
  const missingBytes = targetBytes - stableRandomUtf8Bytes(definition);
  if (missingBytes < 0) throw new Error(`target ${targetBytes} is too small for ${id}`);
  definition.description += "x".repeat(missingBytes);
  expect(stableRandomUtf8Bytes(definition)).toBe(targetBytes);
  return definition;
}

function definitionWithDraws(id: string, draws: number): DiscreteRandomDefinition {
  let remaining = draws;
  let ordinal = 0;
  const steps: DiscreteRandomDefinition["steps"] = [];
  while (remaining > 0) {
    const count = Math.min(100, remaining);
    steps.push({
      id: `draw-${ordinal}`,
      count,
      outcomes: [0, 1],
      aggregate: "sum",
      when: null,
    });
    remaining -= count;
    ordinal += 1;
  }
  return { id, description: "bounded draw fixture", steps };
}

function request(id: string, distribution: DiscreteRandomDefinition): DiscreteRandomRequest {
  return {
    id,
    distributionId: distribution.id,
    distribution,
    causes: [{ kind: "law", id: "time-passes" }],
  };
}

function exactResultBudgetFixture(): DiscreteRandomResult[] {
  const results: DiscreteRandomResult[] = [0, 1].map((part) => ({
    requestId: `result-request-${part}`,
    distributionId: `result-distribution-${part}`,
    steps: [{
      stepId: "draws",
      skipped: false,
      draws: Array.from({ length: 1024 }, () => ({ outcomeIndex: 0, value: "x".repeat(200) })),
      aggregate: 0,
    }],
  }));
  let remaining = MAX_RANDOM_RESULT_UTF8_BYTES_PER_STEP - stableRandomUtf8Bytes(results);
  expect(remaining).toBeGreaterThanOrEqual(0);
  for (const result of results) {
    for (const draw of result.steps[0].draws) {
      const added = Math.min(54, remaining);
      draw.value = `${String(draw.value)}${"x".repeat(added)}`;
      remaining -= added;
      if (remaining === 0) return results;
    }
  }
  throw new Error(`could not fill ${remaining} result bytes`);
}

describe("committed random resource limits", () => {
  it("keeps uint32 seeds distinct and uses a bijective full-span output stream", () => {
    expect(createSeededRng(0)).toEqual({ seed: 0, state: 0, draws: 0 });
    expect(createSeededRng(0x9e3779b9)).toEqual({
      seed: 0x9e3779b9,
      state: 0x9e3779b9,
      draws: 0,
    });
    expect(() => createSeededRng(-1)).toThrow("seed must be a uint32");
    expect(() => createSeededRng(0x100000000)).toThrow("seed must be a uint32");
    expect(() => createSeededRng(1.5)).toThrow("seed must be a uint32");

    let vectorState = createSeededRng(7);
    const vector: number[] = [];
    for (let index = 0; index < 4; index += 1) {
      const [word, next] = drawInteger(vectorState, 0, 0xffffffff);
      vector.push(word);
      vectorState = next;
    }
    expect(vector).toEqual([148464224, 3620262368, 2932535966, 2664503653]);
    expect(vectorState).toEqual({ seed: 7, state: 3031295963, draws: 4 });

    const [formerCollisionLeft] = drawInteger(
      { seed: 1, state: 2463419610, draws: 0 },
      0,
      0xffffffff,
    );
    const [formerCollisionRight] = drawInteger(
      { seed: 1, state: 2463464986, draws: 0 },
      0,
      0xffffffff,
    );
    expect([formerCollisionLeft, formerCollisionRight]).toEqual([2060674734, 4218528845]);

    const sampledOutputs = new Set<number>();
    for (let state = 0; state < 0x10000; state += 1) {
      sampledOutputs.add(drawInteger({ seed: 0, state, draws: 0 }, 0, 0xffffffff)[0]);
    }
    expect(sampledOutputs.size).toBe(0x10000);
  });

  it("accepts exact per-outcome and per-distribution byte boundaries and rejects one byte more", () => {
    const exactOutcome = "x".repeat(MAX_RANDOM_OUTCOME_UTF8_BYTES - 2);
    expect(stableRandomUtf8Bytes(exactOutcome)).toBe(MAX_RANDOM_OUTCOME_UTF8_BYTES);
    expect(() => validateDiscreteRandomDefinitions([{
      ...simpleDefinition("exact-outcome"),
      steps: [{
        id: "value",
        count: 1,
        outcomes: [exactOutcome, "fallback"],
        aggregate: "first",
        when: null,
      }],
    }])).not.toThrow();
    expect(() => validateDiscreteRandomDefinitions([{
      ...simpleDefinition("oversized-outcome"),
      steps: [{
        id: "value",
        count: 1,
        outcomes: [`${exactOutcome}x`, "fallback"],
        aggregate: "first",
        when: null,
      }],
    }])).toThrow("outcome exceeds byte limit");

    const exactDistribution = definitionWithBytes(
      "exact-distribution",
      MAX_RANDOM_DISTRIBUTION_UTF8_BYTES,
    );
    expect(() => validateDiscreteRandomDefinitions([exactDistribution])).not.toThrow();
    exactDistribution.description += "x";
    expect(() => validateDiscreteRandomDefinitions([exactDistribution])).toThrow("exceeds byte limit");
  });

  it("caps the world random catalog by exact count and canonical UTF-8 bytes", () => {
    const exactCount = Array.from({ length: MAX_RANDOM_DISTRIBUTIONS_PER_WORLD }, (_, index) =>
      simpleDefinition(`catalog-count-${index}`));
    expect(() => validateDiscreteRandomDefinitions(exactCount)).not.toThrow();
    expect(() => validateDiscreteRandomDefinitions([
      ...exactCount,
      simpleDefinition("catalog-count-over"),
    ])).toThrow("catalog exceeds distribution limit");

    const exactBytes = [
      ...Array.from({ length: 15 }, (_, index) =>
        definitionWithBytes(`catalog-bytes-${index}`, MAX_RANDOM_DISTRIBUTION_UTF8_BYTES)),
      definitionWithBytes("catalog-bytes-final", MAX_RANDOM_DISTRIBUTION_UTF8_BYTES - 17),
    ];
    expect(stableRandomUtf8Bytes(exactBytes)).toBe(MAX_RANDOM_CATALOG_UTF8_BYTES);
    expect(() => validateDiscreteRandomDefinitions(exactBytes)).not.toThrow();
    exactBytes.at(-1)!.description += "x";
    expect(() => validateDiscreteRandomDefinitions(exactBytes)).toThrow("catalog exceeds byte limit");
  });

  it("accepts exact distribution and committed-step draw boundaries and rejects one draw more", () => {
    const exactDistribution = definitionWithDraws(
      "exact-distribution-draws",
      MAX_RANDOM_DRAWS_PER_DISTRIBUTION,
    );
    expect(() => validateDiscreteRandomDefinitions([exactDistribution])).not.toThrow();
    expect(() => validateDiscreteRandomDefinitions([
      definitionWithDraws("oversized-distribution-draws", MAX_RANDOM_DRAWS_PER_DISTRIBUTION + 1),
    ])).toThrow("exceeds draw limit");

    const first = request("first", definitionWithDraws("first-definition", 1024));
    const second = request("second", definitionWithDraws("second-definition", 1024));
    expect(MAX_RANDOM_DRAWS_PER_STEP).toBe(2048);
    expect(() => validateDiscreteRandomCommitmentBudget([first, second])).not.toThrow();
    expect(() => validateDiscreteRandomCommitmentBudget([
      first,
      second,
      request("over", simpleDefinition("over-definition")),
    ])).toThrow("step exceeds draw limit");
  });

  it("enforces request limits at both model-round and committed-step boundaries", () => {
    const proposals = Array.from({ length: MAX_RANDOM_REQUESTS_PER_ROUND }, (_, index) => ({
      id: `round-${index}`,
      distributionId: "world-distribution",
      causes: [{ kind: "law" as const, id: "time-passes" }],
    }));
    expect(resolutionDirectiveSchema.safeParse({ kind: "request_random", requests: proposals }).success).toBe(true);
    expect(resolutionDirectiveSchema.safeParse({
      kind: "request_random",
      requests: [...proposals, { ...proposals[0], id: "round-over" }],
    }).success).toBe(false);

    const distribution = simpleDefinition("step-requests");
    const requests = Array.from({ length: MAX_RANDOM_REQUESTS_PER_STEP }, (_, index) =>
      request(`step-${index}`, distribution));
    expect(() => validateDiscreteRandomCommitmentBudget(requests)).not.toThrow();
    expect(() => validateDiscreteRandomCommitmentBudget([
      ...requests,
      request("step-over", distribution),
    ])).toThrow("step exceeds request limit");
    const results: DiscreteRandomResult[] = requests.map((candidate) => ({
      requestId: candidate.id,
      distributionId: candidate.distributionId,
      steps: [{
        stepId: "value",
        skipped: false,
        draws: [{ outcomeIndex: 0, value: 0 }],
        aggregate: 0,
      }],
    }));
    expect(() => validateDiscreteRandomCommitmentBudget(requests, results)).not.toThrow();
    expect(() => validateDiscreteRandomCommitmentBudget(requests, [
      ...results,
      { ...results[0], requestId: "result-over" },
    ])).toThrow("results exceed request limit");
  });

  it("uses exact stable UTF-8 snapshot and result budgets", () => {
    const snapshots = [
      ...Array.from({ length: 7 }, (_, index) =>
        definitionWithBytes(`snapshot-${index}`, MAX_RANDOM_DISTRIBUTION_UTF8_BYTES - 1)),
      definitionWithBytes("snapshot-final", MAX_RANDOM_DISTRIBUTION_UTF8_BYTES - 2),
    ];
    expect(stableRandomUtf8Bytes(snapshots)).toBe(MAX_RANDOM_SNAPSHOT_UTF8_BYTES_PER_STEP);
    const requests = snapshots.map((definition, index) => request(`snapshot-request-${index}`, definition));
    expect(() => validateDiscreteRandomCommitmentBudget(requests)).not.toThrow();
    snapshots.at(-1)!.description += "x";
    expect(() => validateDiscreteRandomCommitmentBudget(requests)).toThrow("snapshot byte limit");

    const resultRequests = [
      request("result-request-0", definitionWithDraws("result-distribution-0", 1024)),
      request("result-request-1", definitionWithDraws("result-distribution-1", 1024)),
    ];
    const exactResults = exactResultBudgetFixture();
    expect(stableRandomUtf8Bytes(exactResults)).toBe(MAX_RANDOM_RESULT_UTF8_BYTES_PER_STEP);
    expect(() => validateDiscreteRandomCommitmentBudget(resultRequests, exactResults)).not.toThrow();
    const tooManyResultDraws = structuredClone(exactResults);
    tooManyResultDraws[1].steps[0].draws.push({ outcomeIndex: 0, value: "x" });
    expect(() => validateDiscreteRandomCommitmentBudget(resultRequests, tooManyResultDraws))
      .toThrow("results exceed draw limit");
    const lastValue = exactResults[1].steps[0].draws.at(-1)!;
    lastValue.value = `${String(lastValue.value)}x`;
    expect(() => validateDiscreteRandomCommitmentBudget(resultRequests, exactResults))
      .toThrow("result byte limit");
  });

  it("caps actual RNG words and the unbiased integer span at their exact boundaries", () => {
    const requests = [request("rng-budget", simpleDefinition("rng-budget-definition"))];
    expect(() => validateDiscreteRandomCommitmentBudget(
      requests,
      undefined,
      MAX_RANDOM_RNG_WORDS_PER_STEP,
    )).not.toThrow();
    expect(() => validateDiscreteRandomCommitmentBudget(
      requests,
      undefined,
      MAX_RANDOM_RNG_WORDS_PER_STEP + 1,
    )).toThrow("RNG word limit");

    const [maximum, next] = drawInteger(createSeededRng(7), 0, 4294967295);
    expect(maximum).toBeGreaterThanOrEqual(0);
    expect(maximum).toBeLessThanOrEqual(4294967295);
    expect(next.draws).toBe(1);
    expect(() => drawInteger(createSeededRng(7), 0, 4294967296))
      .toThrow("span cannot exceed 2^32");
  });
});
