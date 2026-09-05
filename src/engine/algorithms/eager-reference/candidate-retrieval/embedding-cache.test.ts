import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import {
  CachedPassageEncoder,
  EmbeddingCacheIntegrityError,
  PersistentEmbeddingCache,
  embeddingCacheDatabasePath,
  passageHash,
} from "./embedding-cache";
import type { LocalEncoderRuntime } from "./local-encoder";

const roots: string[] = [];

function root(): string {
  const value = mkdtempSync(path.join(tmpdir(), "lwe-embedding-cache-"));
  roots.push(value);
  return value;
}

function identity() {
  return {
    worldContentHash: `sha256:${"1".repeat(64)}`,
    encoderFingerprint: `sha256:${"2".repeat(64)}`,
    dimensions: 3,
  };
}

afterEach(() => {
  for (const value of roots.splice(0)) rmSync(value, { recursive: true, force: true });
});

describe("persistent embedding cache", () => {
  it("reuses checksummed float vectors across cache instances", () => {
    const directory = root();
    const hash = passageHash("passage: marsh road");
    const first = new PersistentEmbeddingCache(directory, identity());
    expect(first.write([{ hash, vector: [0.25, -0.5, 1] }])).toBe(1);
    first.close();

    const second = new PersistentEmbeddingCache(directory, identity());
    expect(second.read([hash]).get(hash)).toEqual([0.25, -0.5, 1]);
    expect(second.verify()).toEqual({ entries: 1, dimensions: 3 });
    second.close();
  });

  it("rejects cache identity drift", () => {
    const directory = root();
    new PersistentEmbeddingCache(directory, identity()).close();
    expect(() => new PersistentEmbeddingCache(directory, {
      ...identity(),
      dimensions: 4,
    })).toThrow(EmbeddingCacheIntegrityError);
  });

  it("opens a warm cache read-only without creating a cold database", () => {
    const directory = root();
    expect(() => new PersistentEmbeddingCache(directory, identity(), { readOnly: true })).toThrow();
    expect(existsSync(embeddingCacheDatabasePath(directory, identity()))).toBe(false);
    const writable = new PersistentEmbeddingCache(directory, identity());
    writable.write([{ hash: passageHash("passage: warm"), vector: [0.1, 0.2, 0.3] }]);
    writable.close();
    const readOnly = new PersistentEmbeddingCache(directory, identity(), { readOnly: true });
    expect(readOnly.verify()).toEqual({ entries: 1, dimensions: 3 });
    expect(() => readOnly.write([])).toThrow(/read-only/u);
    readOnly.close();
  });

  it("rejects a corrupted vector checksum", () => {
    const directory = root();
    const hash = passageHash("passage: corrupted");
    const cache = new PersistentEmbeddingCache(directory, identity());
    cache.write([{ hash, vector: [1, 2, 3] }]);
    cache.close();
    const database = new Database(embeddingCacheDatabasePath(directory, identity()));
    database.prepare("UPDATE passage_embeddings SET vector_bytes = ? WHERE passage_hash = ?").run(Buffer.alloc(12), hash);
    database.close();
    const reopened = new PersistentEmbeddingCache(directory, identity());
    expect(() => reopened.read([hash])).toThrow(/checksum/u);
    reopened.close();
  });

  it("single-flights passage encoding and fails closed when writes are forbidden", async () => {
    const directory = root();
    let calls = 0;
    const encoder: LocalEncoderRuntime = {
      modelId: "fixture",
      modelHash: `sha256:${"3".repeat(64)}`,
      dimensions: 3,
      async encodeBatch(texts) {
        calls += 1;
        return texts.map((_, index) => [index + 1, 0, 0]);
      },
    };
    const cached = new CachedPassageEncoder(encoder, identity().encoderFingerprint, directory);
    const [left, right] = await Promise.all([
      cached.encodePassages({ worldContentHash: identity().worldContentHash, passages: ["passage: one"], allowWrite: true }),
      cached.encodePassages({ worldContentHash: identity().worldContentHash, passages: ["passage: one"], allowWrite: true }),
    ]);
    expect(calls).toBe(1);
    expect(left.vectors).toEqual(right.vectors);
    cached.close();

    const readOnly = new CachedPassageEncoder(encoder, identity().encoderFingerprint, directory, true);
    await expect(readOnly.encodePassages({
      worldContentHash: identity().worldContentHash,
      passages: ["passage: missing"],
      allowWrite: false,
    })).rejects.toThrow(/not ready/u);
    readOnly.close();

    const cold = new CachedPassageEncoder(encoder, identity().encoderFingerprint, directory);
    await expect(cold.encodePassages({
      worldContentHash: identity().worldContentHash,
      passages: ["passage: missing"],
      allowWrite: false,
    })).rejects.toThrow(/not ready/u);
    cold.close();
    expect(embeddingCacheDatabasePath(directory, identity())).toContain(path.join("embeddings", "action-compilation"));
  });
});
