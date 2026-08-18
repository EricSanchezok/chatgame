// Deterministic seeded RNG (mulberry32). All randomness in the engine
// (worldgen, director, d20 rolls) flows through this — saves carry the
// RNG state so runs continue deterministically after load.
import type { RngState } from "./types";

export function createRng(seed: number): RngState {
  return { seed: seed >>> 0, state: (seed >>> 0) || 0x9e3779b9 };
}

function nextRaw(state: number): number {
  // mulberry32 core
  let t = (state += 0x6d2b79f5);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** Advances the RNG and returns a float in [0, 1). */
export function nextFloat(rng: RngState): number {
  rng.state = (rng.state + 0x6d2b79f5) >>> 0;
  return nextRaw(rng.state);
}

/** Returns an integer in [min, max] inclusive. */
export function nextInt(rng: RngState, min: number, max: number): number {
  if (max < min) throw new Error("nextInt: max must be >= min");
  const span = max - min + 1;
  return min + Math.floor(nextFloat(rng) * span);
}

/** Returns true with probability p (0..1). */
export function chance(rng: RngState, p: number): boolean {
  return nextFloat(rng) < p;
}

/**
 * Weighted pick: returns the index of the chosen entry, or -1 when
 * weights sum to zero or the array is empty.
 */
export function weightedPick(rng: RngState, weights: number[]): number {
  const total = weights.reduce((a, b) => a + b, 0);
  if (total <= 0 || weights.length === 0) return -1;
  let roll = nextFloat(rng) * total;
  for (let i = 0; i < weights.length; i++) {
    roll -= weights[i];
    if (roll < 0) return i;
  }
  return weights.length - 1;
}

/** Pick one element uniformly; returns undefined when empty. */
export function pickOne<T>(rng: RngState, items: readonly T[]): T | undefined {
  if (items.length === 0) return undefined;
  return items[nextInt(rng, 0, items.length - 1)];
}

/** d20 roll (1..20). */
export function rollD20(rng: RngState): number {
  return nextInt(rng, 1, 20);
}
