import { canonicalize } from "./model-audit";

export const MAX_RANDOM_OUTCOME_UTF8_BYTES = 256;
export const MAX_RANDOM_DISTRIBUTION_UTF8_BYTES = 32 * 1024;
export const MAX_RANDOM_DRAWS_PER_DISTRIBUTION = 1024;
export const MAX_RANDOM_DISTRIBUTIONS_PER_WORLD = 256;
export const MAX_RANDOM_CATALOG_UTF8_BYTES = 512 * 1024;
export const MAX_RANDOM_REQUESTS_PER_ROUND = 16;
export const MAX_RANDOM_REQUESTS_PER_STEP = 32;
export const MAX_RANDOM_DRAWS_PER_STEP = 2048;
export const MAX_RANDOM_RNG_WORDS_PER_STEP = 4096;
export const MAX_RANDOM_SNAPSHOT_UTF8_BYTES_PER_STEP = 256 * 1024;
export const MAX_RANDOM_RESULT_UTF8_BYTES_PER_STEP = 512 * 1024;

export function stableRandomUtf8Bytes(value: unknown): number {
  const serialized = JSON.stringify(canonicalize(value));
  if (serialized === undefined) throw new TypeError("random value is not serializable");
  return Buffer.byteLength(serialized, "utf8");
}
