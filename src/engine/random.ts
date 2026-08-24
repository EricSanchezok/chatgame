import type {
  D20CheckRequest,
  D20CheckResult,
  DiscreteRandomDefinition,
  DiscreteRandomRequest,
  DiscreteRandomResult,
  DiscreteRandomValue,
  SeededRngState,
} from "./model";
import {
  MAX_RANDOM_CATALOG_UTF8_BYTES,
  MAX_RANDOM_DISTRIBUTION_UTF8_BYTES,
  MAX_RANDOM_DISTRIBUTIONS_PER_WORLD,
  MAX_RANDOM_DRAWS_PER_DISTRIBUTION,
  MAX_RANDOM_DRAWS_PER_STEP,
  MAX_RANDOM_OUTCOME_UTF8_BYTES,
  MAX_RANDOM_REQUESTS_PER_STEP,
  MAX_RANDOM_RESULT_UTF8_BYTES_PER_STEP,
  MAX_RANDOM_RNG_WORDS_PER_STEP,
  MAX_RANDOM_SNAPSHOT_UTF8_BYTES_PER_STEP,
  stableRandomUtf8Bytes,
} from "./random-limits";

export function createSeededRng(seed: number): SeededRngState {
  if (!Number.isSafeInteger(seed) || seed < 0 || seed > 0xffffffff) {
    throw new TypeError("RNG seed must be a uint32");
  }
  return {
    seed,
    state: seed,
    draws: 0,
  };
}

function permuteUint32(input: number): number {
  // Each xor-right-shift is invertible from high bits to low bits, and both
  // multipliers are odd, so this composition is a permutation modulo 2^32.
  let value = input >>> 0;
  value ^= value >>> 16;
  value = Math.imul(value, 0x7feb352d);
  value ^= value >>> 15;
  value = Math.imul(value, 0x846ca68b);
  value ^= value >>> 16;
  return value >>> 0;
}

function drawUint32(rng: SeededRngState): [number, SeededRngState] {
  const state = (rng.state + 0x6d2b79f5) >>> 0;
  const result = permuteUint32(state);
  return [result, { ...rng, state, draws: rng.draws + 1 }];
}

function drawUint32SlotOffset(
  initialRng: SeededRngState,
  slotCount: number,
): [number, SeededRngState] {
  const uint32Cardinality = 4294967296;
  if (!Number.isSafeInteger(slotCount) || slotCount < 1 || slotCount > uint32Cardinality) {
    throw new TypeError("slot count must be between 1 and 2^32");
  }
  const acceptanceLimit = Math.floor(uint32Cardinality / slotCount) * slotCount;
  let rng = initialRng;
  while (true) {
    const [value, next] = drawUint32(rng);
    rng = next;
    if (value < acceptanceLimit) return [value % slotCount, rng];
  }
}

function drawEqualSlotIndex(
  initialRng: SeededRngState,
  slotCount: number,
): [number, SeededRngState] {
  if (!Number.isSafeInteger(slotCount) || slotCount < 2 || slotCount > 100) {
    throw new TypeError("drawEqualSlotIndex requires between 2 and 100 slots");
  }
  return drawUint32SlotOffset(initialRng, slotCount);
}

export function drawInteger(
  rng: SeededRngState,
  min: number,
  max: number,
): [number, SeededRngState] {
  if (!Number.isSafeInteger(min) || !Number.isSafeInteger(max) || max < min) {
    throw new TypeError("drawInteger requires safe integer bounds with max >= min");
  }
  const span = max - min + 1;
  if (!Number.isSafeInteger(span) || span > 4294967296) {
    throw new RangeError("drawInteger span cannot exceed 2^32 outcomes");
  }
  const [offset, next] = drawUint32SlotOffset(rng, span);
  return [min + offset, next];
}

export function resolveD20Checks(
  initialRng: SeededRngState,
  requests: readonly D20CheckRequest[],
): { rng: SeededRngState; results: D20CheckResult[] } {
  const seen = new Set<string>();
  let rng = { ...initialRng };
  const results = requests.map((request) => {
    if (seen.has(request.id)) throw new Error(`duplicate check id: ${request.id}`);
    seen.add(request.id);
    if (!Number.isSafeInteger(request.dc) || request.dc < 0 || request.dc > 100) {
      throw new Error(`invalid DC for check ${request.id}`);
    }
    if (!Number.isSafeInteger(request.modifier)) {
      throw new Error(`invalid modifier for check ${request.id}`);
    }

    const count = request.mode === "normal" ? 1 : 2;
    const dice: number[] = [];
    for (let index = 0; index < count; index += 1) {
      const [die, next] = drawInteger(rng, 1, 20);
      dice.push(die);
      rng = next;
    }
    const kept = request.mode === "disadvantage" ? Math.min(...dice) : Math.max(...dice);
    const total = kept + request.modifier;
    return {
      requestId: request.id,
      dice,
      kept,
      modifier: request.modifier,
      total,
      dc: request.dc,
      succeeded: total >= request.dc,
      margin: total - request.dc,
      visibility: request.visibility,
    };
  });

  return { rng, results };
}

function validateDiscreteRandomDefinition(definition: DiscreteRandomDefinition): void {
  if (!definition.id.trim() || !definition.description.trim()) {
    throw new Error("random distribution identity and description are required");
  }
  if (definition.steps.length === 0 || definition.steps.length > 100) {
    throw new Error(`random distribution ${definition.id} requires between 1 and 100 steps`);
  }
  const priorSteps = new Map<string, DiscreteRandomDefinition["steps"][number]>();
  let maximumDraws = 0;
  for (const step of definition.steps) {
    if (!step.id.trim() || priorSteps.has(step.id)) {
      throw new Error(`random distribution ${definition.id} has duplicate or empty step ${step.id}`);
    }
    if (!Number.isSafeInteger(step.count) || step.count < 1 || step.count > 100) {
      throw new Error(`random step ${definition.id}/${step.id} has invalid count`);
    }
    maximumDraws += step.count;
    if (step.outcomes.length < 2 || step.outcomes.length > 100) {
      throw new Error(`random step ${definition.id}/${step.id} requires between 2 and 100 outcomes`);
    }
    for (const outcome of step.outcomes) {
      if (typeof outcome === "number" && (!Number.isSafeInteger(outcome) || Object.is(outcome, -0))) {
        throw new Error(`random step ${definition.id}/${step.id} has an invalid numeric outcome`);
      }
      if (typeof outcome === "string" && outcome.length === 0) {
        throw new Error(`random step ${definition.id}/${step.id} has an empty outcome`);
      }
      if (stableRandomUtf8Bytes(outcome) > MAX_RANDOM_OUTCOME_UTF8_BYTES) {
        throw new Error(`random step ${definition.id}/${step.id} outcome exceeds byte limit`);
      }
    }
    if (step.aggregate === "first" && step.count !== 1) {
      throw new Error(`random step ${definition.id}/${step.id} uses first with count ${step.count}`);
    }
    if (step.aggregate === "sum") {
      if (step.outcomes.some((outcome) => typeof outcome !== "number")) {
        throw new Error(`random step ${definition.id}/${step.id} sum requires numeric outcomes`);
      }
      const maximumAbsoluteOutcome = Math.max(...step.outcomes.map((outcome) => Math.abs(outcome as number)));
      if (!Number.isSafeInteger(maximumAbsoluteOutcome * step.count)) {
        throw new Error(`random step ${definition.id}/${step.id} can exceed safe integer range`);
      }
    }
    if (step.when) {
      if (typeof step.when.equals === "number" &&
        (!Number.isSafeInteger(step.when.equals) || Object.is(step.when.equals, -0))) {
        throw new Error(`random step ${definition.id}/${step.id} has an invalid condition value`);
      }
      if (typeof step.when.equals === "string" && step.when.equals.length === 0) {
        throw new Error(`random step ${definition.id}/${step.id} has an empty condition value`);
      }
      const source = priorSteps.get(step.when.stepId);
      if (!source) {
        throw new Error(`random step ${definition.id}/${step.id} condition must reference a prior step`);
      }
      if (source.aggregate === "values") {
        throw new Error(`random step ${definition.id}/${step.id} cannot branch on a values aggregate`);
      }
    }
    priorSteps.set(step.id, step);
  }
  if (maximumDraws > MAX_RANDOM_DRAWS_PER_DISTRIBUTION) {
    throw new Error(`random distribution ${definition.id} exceeds draw limit`);
  }
  if (stableRandomUtf8Bytes(definition) > MAX_RANDOM_DISTRIBUTION_UTF8_BYTES) {
    throw new Error(`random distribution ${definition.id} exceeds byte limit`);
  }
}

export function validateDiscreteRandomDefinitions(
  definitions: readonly DiscreteRandomDefinition[],
): void {
  if (definitions.length > MAX_RANDOM_DISTRIBUTIONS_PER_WORLD) {
    throw new Error("world random catalog exceeds distribution limit");
  }
  if (stableRandomUtf8Bytes(definitions) > MAX_RANDOM_CATALOG_UTF8_BYTES) {
    throw new Error("world random catalog exceeds byte limit");
  }
  const ids = new Set<string>();
  for (const definition of definitions) {
    if (ids.has(definition.id)) throw new Error(`duplicate random distribution ${definition.id}`);
    ids.add(definition.id);
    validateDiscreteRandomDefinition(definition);
  }
}

export function validateDiscreteRandomCommitmentBudget(
  requests: readonly DiscreteRandomRequest[],
  results?: readonly DiscreteRandomResult[],
  rngWords?: number,
): void {
  if (requests.length > MAX_RANDOM_REQUESTS_PER_STEP) {
    throw new Error("discrete random step exceeds request limit");
  }
  if (results && results.length > MAX_RANDOM_REQUESTS_PER_STEP) {
    throw new Error("discrete random step results exceed request limit");
  }
  let maximumDraws = 0;
  for (const request of requests) {
    validateDiscreteRandomDefinition(request.distribution);
    maximumDraws += request.distribution.steps.reduce((total, step) => total + step.count, 0);
  }
  if (maximumDraws > MAX_RANDOM_DRAWS_PER_STEP) {
    throw new Error("discrete random step exceeds draw limit");
  }
  if (stableRandomUtf8Bytes(requests.map((request) => request.distribution)) >
    MAX_RANDOM_SNAPSHOT_UTF8_BYTES_PER_STEP) {
    throw new Error("discrete random step exceeds snapshot byte limit");
  }
  if (results) {
    const resultDraws = results.reduce((resultTotal, result) => resultTotal +
      result.steps.reduce((stepTotal, step) => stepTotal + step.draws.length, 0), 0);
    if (resultDraws > MAX_RANDOM_DRAWS_PER_STEP) {
      throw new Error("discrete random step results exceed draw limit");
    }
    if (stableRandomUtf8Bytes(results) > MAX_RANDOM_RESULT_UTF8_BYTES_PER_STEP) {
      throw new Error("discrete random step exceeds result byte limit");
    }
  }
  if (rngWords !== undefined &&
    (!Number.isSafeInteger(rngWords) || rngWords < 0 || rngWords > MAX_RANDOM_RNG_WORDS_PER_STEP)) {
    throw new Error("discrete random step exceeds RNG word limit");
  }
}

function aggregateValues(
  definition: DiscreteRandomDefinition,
  step: DiscreteRandomDefinition["steps"][number],
  values: DiscreteRandomValue[],
): DiscreteRandomResult["steps"][number]["aggregate"] {
  if (step.aggregate === "first") return values[0] ?? null;
  if (step.aggregate === "values") return structuredClone(values);
  const total = values.reduce<number>((sum, value) => sum + (value as number), 0);
  if (!Number.isSafeInteger(total)) {
    throw new Error(`random step ${definition.id}/${step.id} produced an unsafe sum`);
  }
  return total;
}

export function resolveDiscreteRandomRequests(
  initialRng: SeededRngState,
  requests: readonly DiscreteRandomRequest[],
): { rng: SeededRngState; results: DiscreteRandomResult[] } {
  validateDiscreteRandomCommitmentBudget(requests);
  const seen = new Set<string>();
  let rng = structuredClone(initialRng);
  const results = requests.map((request) => {
    if (seen.has(request.id)) throw new Error(`duplicate random request id: ${request.id}`);
    seen.add(request.id);
    if (request.distributionId !== request.distribution.id) {
      throw new Error(`random request ${request.id} has a mismatched distribution`);
    }
    validateDiscreteRandomDefinition(request.distribution);
    const steps: DiscreteRandomResult["steps"] = [];
    for (const step of request.distribution.steps) {
      const condition = step.when;
      const source = condition ? steps.find((candidate) => candidate.stepId === condition.stepId) : undefined;
      const skipped = Boolean(condition && (!source || source.skipped || Array.isArray(source.aggregate) ||
        !Object.is(source.aggregate, condition.equals)));
      if (skipped) {
        steps.push({ stepId: step.id, skipped: true, draws: [], aggregate: null });
        continue;
      }
      const draws: DiscreteRandomResult["steps"][number]["draws"] = [];
      for (let index = 0; index < step.count; index += 1) {
        const [outcomeIndex, next] = drawEqualSlotIndex(rng, step.outcomes.length);
        rng = next;
        draws.push({ outcomeIndex, value: structuredClone(step.outcomes[outcomeIndex]) });
      }
      const values = draws.map((draw) => draw.value);
      steps.push({
        stepId: step.id,
        skipped: false,
        draws,
        aggregate: aggregateValues(request.distribution, step, values),
      });
    }
    return {
      requestId: request.id,
      distributionId: request.distributionId,
      steps,
    };
  });
  validateDiscreteRandomCommitmentBudget(requests, results, rng.draws - initialRng.draws);
  return { rng, results };
}
