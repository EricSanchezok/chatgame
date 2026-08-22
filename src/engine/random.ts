import type { D20CheckRequest, D20CheckResult, SeededRngState } from "./model";

export function createSeededRng(seed: number): SeededRngState {
  const normalized = seed >>> 0;
  return {
    seed: normalized,
    state: normalized || 0x9e3779b9,
    draws: 0,
  };
}

function drawFloat(rng: SeededRngState): [number, SeededRngState] {
  const state = (rng.state + 0x6d2b79f5) >>> 0;
  let value = state;
  value = Math.imul(value ^ (value >>> 15), value | 1);
  value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
  const result = ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  return [result, { ...rng, state, draws: rng.draws + 1 }];
}

export function drawInteger(
  rng: SeededRngState,
  min: number,
  max: number,
): [number, SeededRngState] {
  if (!Number.isSafeInteger(min) || !Number.isSafeInteger(max) || max < min) {
    throw new TypeError("drawInteger requires safe integer bounds with max >= min");
  }
  const [value, next] = drawFloat(rng);
  return [min + Math.floor(value * (max - min + 1)), next];
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
