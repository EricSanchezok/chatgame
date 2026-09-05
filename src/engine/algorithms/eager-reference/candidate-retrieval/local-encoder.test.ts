import { describe, expect, it } from "vitest";
import { CachedQueryEncoder, type LocalEncoderRuntime } from "./local-encoder";

describe("dynamic query encoder cache", () => {
  it("single-flights exact queries and evicts least-recently-used entries", async () => {
    let calls = 0;
    const encoder: LocalEncoderRuntime = {
      modelId: "fixture",
      modelHash: `sha256:${"1".repeat(64)}`,
      dimensions: 2,
      async encodeBatch(texts) {
        calls += 1;
        return texts.map((text) => [text.length, calls]);
      },
    };
    const cache = new CachedQueryEncoder(encoder, 2);
    const [first, concurrent] = await Promise.all([cache.encode("one"), cache.encode("one")]);
    expect(first.vector).toEqual(concurrent.vector);
    expect(first.cacheHit).toBe(false);
    expect(concurrent.cacheHit).toBe(true);
    expect(calls).toBe(1);

    expect((await cache.encode("one")).cacheHit).toBe(true);
    await cache.encode("two");
    await cache.encode("three");
    expect(cache.size).toBe(2);
    expect((await cache.encode("one")).cacheHit).toBe(false);
    expect(calls).toBe(4);
  });

  it("rejects non-finite query vectors", async () => {
    const encoder: LocalEncoderRuntime = {
      modelId: "fixture",
      modelHash: `sha256:${"1".repeat(64)}`,
      dimensions: 2,
      async encodeBatch() { return [[Number.NaN, 1]]; },
    };
    await expect(new CachedQueryEncoder(encoder).encode("bad")).rejects.toThrow("non-finite");
  });
});
