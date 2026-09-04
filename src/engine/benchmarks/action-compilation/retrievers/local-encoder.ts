import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import type { LocalEncoderRuntime } from "./advanced";

export const MULTILINGUAL_E5_SMALL_MODEL_ID = "intfloat/multilingual-e5-small" as const;
export const TRANSFORMERS_LIBRARY_PACKAGE = "@huggingface/transformers" as const;

export interface LocalEncoderAssetOptions {
  modelDirectory: string;
  modelId?: string;
  expectedHash?: string;
}

interface TensorLike {
  data: ArrayLike<number>;
  dims: readonly number[];
}

interface FeatureExtractor {
  (texts: string | string[], options?: { pooling?: "mean"; normalize?: boolean }): Promise<TensorLike>;
}

function files(root: string): string[] {
  const output: string[] = [];
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(absolute);
      else if (entry.isFile()) output.push(path.relative(root, absolute));
    }
  };
  visit(root);
  return output;
}

function packageRoot(): string {
  const require = createRequire(import.meta.url);
  const entry = require.resolve(TRANSFORMERS_LIBRARY_PACKAGE) as string;
  let directory = path.dirname(entry);
  while (path.basename(directory) !== "transformers" || path.basename(path.dirname(directory)) !== "@huggingface") {
    const parent = path.dirname(directory);
    if (parent === directory) throw new Error(`cannot locate ${TRANSFORMERS_LIBRARY_PACKAGE} package root`);
    directory = parent;
  }
  return directory;
}

function hashDirectory(root: string): string {
  const hash = createHash("sha256");
  for (const relative of files(root)) {
    hash.update(relative);
    hash.update("\0");
    hash.update(readFileSync(path.join(root, relative)));
    hash.update("\0");
  }
  return `sha256:${hash.digest("hex")}`;
}

function libraryMetadata(): { version: string; hash: string } {
  const root = packageRoot();
  const packageJson = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")) as { version?: unknown };
  if (typeof packageJson.version !== "string" || packageJson.version.length === 0) {
    throw new Error(`${TRANSFORMERS_LIBRARY_PACKAGE} package version is missing`);
  }
  return { version: packageJson.version, hash: hashDirectory(root) };
}

export function hashLocalModelDirectory(modelDirectory: string): string {
  const root = path.resolve(modelDirectory);
  if (!existsSync(root) || !statSync(root).isDirectory()) throw new Error(`local encoder model directory is missing: ${root}`);
  return hashDirectory(root);
}

function vectors(output: TensorLike, count: number): readonly (readonly number[])[] {
  if (!Array.isArray(output.dims) || output.dims.length < 2) throw new Error("encoder output must have batch and embedding dimensions");
  const dimensions = output.dims[output.dims.length - 1];
  if (!Number.isSafeInteger(dimensions) || dimensions < 1) throw new Error("encoder output dimensions are invalid");
  if (output.data.length < count * dimensions) throw new Error("encoder output data is shorter than expected");
  return Array.from({ length: count }, (_, row) => Array.from({ length: dimensions }, (_, column) => Number(output.data[row * dimensions + column])));
}

export async function loadLocalMultilingualE5Small(options: LocalEncoderAssetOptions): Promise<LocalEncoderRuntime> {
  const modelDirectory = path.resolve(options.modelDirectory);
  const modelId = options.modelId ?? MULTILINGUAL_E5_SMALL_MODEL_ID;
  const modelHash = hashLocalModelDirectory(modelDirectory);
  if (options.expectedHash && options.expectedHash !== modelHash) {
    throw new Error(`local encoder model hash mismatch: expected ${options.expectedHash}, got ${modelHash}`);
  }
  const library = libraryMetadata();
  // Dynamic import keeps the benchmark-only dependency out of the normal web bundle.
  const transformers = await import("@huggingface/transformers");
  transformers.env.allowRemoteModels = false;
  transformers.env.allowLocalModels = true;
  const extractor = await transformers.pipeline("feature-extraction", modelDirectory, {
    device: "cpu",
    dtype: "fp32",
    local_files_only: true,
  }) as unknown as FeatureExtractor;
  let dimensions = 0;
  return {
    modelId,
    modelHash,
    get dimensions() { return dimensions; },
    libraryVersion: library.version,
    libraryHash: library.hash,
    async encodeBatch(texts: readonly string[]): Promise<readonly (readonly number[])[]> {
      if (texts.length === 0) return [];
      const result = vectors(await extractor([...texts], { pooling: "mean", normalize: true }), texts.length);
      dimensions = result[0]?.length ?? dimensions;
      return result;
    },
  };
}
