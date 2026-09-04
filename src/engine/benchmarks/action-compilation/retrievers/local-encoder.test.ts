import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { hashLocalModelDirectory, loadLocalMultilingualE5Small } from "./local-encoder";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("local multilingual-e5-small asset handling", () => {
  it("hashes model files deterministically and detects content changes", () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), "lwe-e5-fixture-"));
    temporaryDirectories.push(directory);
    writeFileSync(path.join(directory, "tokenizer.json"), "tokenizer-v1\n", "utf8");
    writeFileSync(path.join(directory, "model.onnx"), "weights-v1\n", "utf8");
    const first = hashLocalModelDirectory(directory);
    expect(first).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(hashLocalModelDirectory(directory)).toBe(first);
    writeFileSync(path.join(directory, "model.onnx"), "weights-v2\n", "utf8");
    expect(hashLocalModelDirectory(directory)).not.toBe(first);
  });

  it("fails closed when the local model directory is missing", async () => {
    await expect(loadLocalMultilingualE5Small({ modelDirectory: "/tmp/lwe-model-does-not-exist" }))
      .rejects.toThrow(/model directory is missing/u);
  });
});
