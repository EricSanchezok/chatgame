import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { contentHash } from "../../../models/model-audit";

export const MULTILINGUAL_E5_SMALL_MODEL_ID = "intfloat/multilingual-e5-small" as const;
export const TRANSFORMERS_LIBRARY_PACKAGE = "@huggingface/transformers" as const;
export const LOCAL_ENCODER_MAX_BATCH_SIZE = 128 as const;
export const LOCAL_ENCODER_MAX_TOKENS = 128 as const;
export const LOCAL_ENCODER_QUERY_PREFIX = "query: " as const;
export const LOCAL_ENCODER_PASSAGE_PREFIX = "passage: " as const;

export function livingWorldCacheRoot(env: NodeJS.ProcessEnv = process.env): string {
  return path.resolve(env.LIVINGWORLD_CACHE_ROOT ?? ".livingworld-cache");
}

export function discoverLocalEncoderModelDirectory(cacheRoot = livingWorldCacheRoot()): string {
  const root = path.join(path.resolve(cacheRoot), "models", "multilingual-e5-small");
  if (!existsSync(root) || !statSync(root).isDirectory()) throw new Error(`local encoder model root is missing: ${root}`);
  const candidates = readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^[a-f0-9]{64}$/u.test(entry.name))
    .map((entry) => path.join(root, entry.name))
    .sort();
  if (candidates.length !== 1) throw new Error(`local encoder model root must contain exactly one hashed asset directory: ${root}`);
  const selected = candidates[0]!;
  const actual = hashLocalModelDirectory(selected).slice("sha256:".length);
  if (path.basename(selected) !== actual) throw new Error(`local encoder asset directory name does not match its content hash: ${selected}`);
  return selected;
}

export interface LocalEncoderRuntime {
  readonly modelId: string;
  readonly modelHash: string;
  readonly dimensions: number;
  readonly libraryVersion?: string;
  readonly libraryHash?: string;
  encodeBatch(texts: readonly string[]): Promise<readonly (readonly number[])[]>;
}

export interface LocalEncoderAssetOptions {
  modelDirectory: string;
  modelId?: string;
  expectedHash?: string;
}

export interface QueryEncodingResult {
  vector: readonly number[];
  cacheHit: boolean;
}

/** Process-local bounded cache for dynamic slot queries. */
export class CachedQueryEncoder {
  private readonly values = new Map<string, readonly number[]>();
  private readonly pending = new Map<string, Promise<readonly number[]>>();

  constructor(
    readonly encoder: LocalEncoderRuntime,
    private readonly maxEntries = 256,
  ) {
    if (!Number.isSafeInteger(maxEntries) || maxEntries < 1) throw new Error("query cache maxEntries must be a positive integer");
  }

  private key(query: string): string {
    return createHash("sha256").update(`${LOCAL_ENCODER_QUERY_PREFIX}${query}`, "utf8").digest("hex");
  }

  async encode(query: string): Promise<QueryEncodingResult> {
    const key = this.key(query);
    const existing = this.values.get(key);
    if (existing) {
      this.values.delete(key);
      this.values.set(key, existing);
      return { vector: existing, cacheHit: true };
    }
    const inflight = this.pending.get(key);
    if (inflight) return { vector: await inflight, cacheHit: true };
    const pending = this.encoder.encodeBatch([`${LOCAL_ENCODER_QUERY_PREFIX}${query}`]).then((vectors) => {
      const vector = vectors[0];
      if (!vector || vector.length !== this.encoder.dimensions) throw new Error("encoder omitted the query embedding");
      this.values.set(key, vector);
      while (this.values.size > this.maxEntries) this.values.delete(this.values.keys().next().value!);
      return vector;
    });
    this.pending.set(key, pending);
    try {
      return { vector: await pending, cacheHit: false };
    } finally {
      this.pending.delete(key);
    }
  }

  get size(): number {
    return this.values.size;
  }
}

interface TensorLike {
  data: ArrayLike<number>;
  dims: readonly number[];
}

interface FeatureExtractor {
  (texts: string | string[], options?: { pooling?: "mean"; normalize?: boolean; truncation?: boolean; max_length?: number }): Promise<TensorLike>;
}

function files(root: string): string[] {
  const output: string[] = [];
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === ".cache") continue;
        visit(absolute);
      } else if (entry.isFile()) output.push(path.relative(root, absolute));
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

function configuredDimensions(modelDirectory: string): number {
  const config = JSON.parse(readFileSync(path.join(modelDirectory, "config.json"), "utf8")) as {
    hidden_size?: unknown;
    d_model?: unknown;
  };
  const value = config.hidden_size ?? config.d_model;
  if (!Number.isSafeInteger(value) || Number(value) < 1) {
    throw new Error("local encoder config does not declare a positive embedding dimension");
  }
  return Number(value);
}

export function hashLocalModelDirectory(modelDirectory: string): string {
  const root = path.resolve(modelDirectory);
  if (!existsSync(root) || !statSync(root).isDirectory()) throw new Error(`local encoder model directory is missing: ${root}`);
  return hashDirectory(root);
}

export function localEncoderFingerprint(encoder: LocalEncoderRuntime, passageSchemaVersion: number): string {
  if (!Number.isSafeInteger(passageSchemaVersion) || passageSchemaVersion < 1) {
    throw new Error("passage schema version must be a positive integer");
  }
  return `sha256:${contentHash({
    modelId: encoder.modelId,
    modelHash: encoder.modelHash,
    dimensions: encoder.dimensions,
    libraryVersion: encoder.libraryVersion ?? null,
    libraryHash: encoder.libraryHash ?? null,
    queryPrefix: LOCAL_ENCODER_QUERY_PREFIX,
    passagePrefix: LOCAL_ENCODER_PASSAGE_PREFIX,
    pooling: "mean",
    normalize: true,
    truncation: true,
    maxTokens: LOCAL_ENCODER_MAX_TOKENS,
    passageSchemaVersion,
  })}`;
}

function vectors(output: TensorLike, count: number, expectedDimensions: number): readonly (readonly number[])[] {
  if (!Array.isArray(output.dims) || output.dims.length < 2) throw new Error("encoder output must have batch and embedding dimensions");
  const dimensions = output.dims[output.dims.length - 1];
  if (dimensions !== expectedDimensions) {
    throw new Error(`encoder output dimension mismatch: expected ${expectedDimensions}, got ${String(dimensions)}`);
  }
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
  const dimensions = configuredDimensions(modelDirectory);
  const library = libraryMetadata();
  const transformers = await import("@huggingface/transformers");
  transformers.env.allowRemoteModels = false;
  transformers.env.allowLocalModels = true;
  const extractor = await transformers.pipeline("feature-extraction", modelDirectory, {
    device: "cpu",
    dtype: "fp32",
    local_files_only: true,
  }) as unknown as FeatureExtractor;
  return {
    modelId,
    modelHash,
    dimensions,
    libraryVersion: library.version,
    libraryHash: library.hash,
    async encodeBatch(texts: readonly string[]): Promise<readonly (readonly number[])[]> {
      if (texts.length === 0) return [];
      const result: Array<readonly number[]> = [];
      for (let offset = 0; offset < texts.length; offset += LOCAL_ENCODER_MAX_BATCH_SIZE) {
        const batch = texts.slice(offset, offset + LOCAL_ENCODER_MAX_BATCH_SIZE);
        result.push(...vectors(await extractor([...batch], {
          pooling: "mean",
          normalize: true,
          truncation: true,
          max_length: LOCAL_ENCODER_MAX_TOKENS,
        }), batch.length, dimensions));
      }
      return result;
    },
  };
}
