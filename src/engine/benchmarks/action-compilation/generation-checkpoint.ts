import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import {
  contentHash,
  isSha256,
} from "../../models/model-audit";
import {
  decodeJsonlGzip,
  encodeJsonlGzip,
} from "./stabilized-behavior";

export const ACTION_COMPILATION_GENERATION_CHECKPOINT_SCHEMA_VERSION = 1 as const;

export interface ActionCompilationGenerationCheckpointSource {
  worldHash: string;
  initialStateHash: string;
  modelCatalogHash: string;
  registrySnapshotHash: string;
  algorithmManifestHash: string;
  promptVersion: string;
  profileId: string;
  modelId: string;
  seed: number;
  seedCorpusHash: string;
}

export interface ActionCompilationGenerationCheckpointCounters {
  providerRequests: number;
  logicalInvocations: number;
  transportAttempts: number;
  repairCalls: number;
  rejectedSlots: number;
  seedIndex: number;
  batchIndex: number;
  batchAttempts: number;
}

export interface ActionCompilationGenerationCheckpoint<TCaptured> {
  schemaVersion: typeof ACTION_COMPILATION_GENERATION_CHECKPOINT_SCHEMA_VERSION;
  batchIndex: number;
  source: ActionCompilationGenerationCheckpointSource;
  counters: ActionCompilationGenerationCheckpointCounters;
  captured: TCaptured[];
}

export interface LoadedActionCompilationGenerationCheckpoint<TCaptured> {
  checkpointCount: number;
  lastBatchIndex: number;
  counters: ActionCompilationGenerationCheckpointCounters;
  captured: TCaptured[];
}

function checkpointDirectory(staging: string): string {
  return path.join(path.resolve(staging), "checkpoints");
}

function checkpointFilename(batchIndex: number): string {
  return `batch-${String(batchIndex).padStart(6, "0")}.jsonl.gz`;
}

function nonNegativeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new Error(`${label} must be a non-negative integer`);
  }
  return Number(value);
}

function validateSource(source: unknown, label: string): ActionCompilationGenerationCheckpointSource {
  if (!source || typeof source !== "object" || Array.isArray(source)) throw new Error(`${label} must be an object`);
  const value = source as Record<string, unknown>;
  const stringFields = [
    "worldHash",
    "initialStateHash",
    "modelCatalogHash",
    "registrySnapshotHash",
    "algorithmManifestHash",
    "promptVersion",
    "profileId",
    "modelId",
    "seedCorpusHash",
  ] as const;
  for (const field of stringFields) {
    if (typeof value[field] !== "string" || value[field].length === 0) {
      throw new Error(`${label}.${field} is invalid`);
    }
  }
  for (const field of ["worldHash", "initialStateHash", "modelCatalogHash", "registrySnapshotHash", "algorithmManifestHash", "seedCorpusHash"] as const) {
    if (!isSha256(value[field] as string)) throw new Error(`${label}.${field} must be a SHA-256 hash`);
  }
  return {
    worldHash: value.worldHash as string,
    initialStateHash: value.initialStateHash as string,
    modelCatalogHash: value.modelCatalogHash as string,
    registrySnapshotHash: value.registrySnapshotHash as string,
    algorithmManifestHash: value.algorithmManifestHash as string,
    promptVersion: value.promptVersion as string,
    profileId: value.profileId as string,
    modelId: value.modelId as string,
    seed: nonNegativeInteger(value.seed, `${label}.seed`),
    seedCorpusHash: value.seedCorpusHash as string,
  };
}

function validateCounters(value: unknown, label: string): ActionCompilationGenerationCheckpointCounters {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  const counters = value as Record<string, unknown>;
  return {
    providerRequests: nonNegativeInteger(counters.providerRequests, `${label}.providerRequests`),
    logicalInvocations: nonNegativeInteger(counters.logicalInvocations, `${label}.logicalInvocations`),
    transportAttempts: nonNegativeInteger(counters.transportAttempts, `${label}.transportAttempts`),
    repairCalls: nonNegativeInteger(counters.repairCalls, `${label}.repairCalls`),
    rejectedSlots: nonNegativeInteger(counters.rejectedSlots, `${label}.rejectedSlots`),
    seedIndex: nonNegativeInteger(counters.seedIndex, `${label}.seedIndex`),
    batchIndex: nonNegativeInteger(counters.batchIndex, `${label}.batchIndex`),
    batchAttempts: nonNegativeInteger(counters.batchAttempts, `${label}.batchAttempts`),
  };
}

function validateCheckpoint<TCaptured>(value: unknown, label: string): ActionCompilationGenerationCheckpoint<TCaptured> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  const checkpoint = value as Record<string, unknown>;
  if (checkpoint.schemaVersion !== ACTION_COMPILATION_GENERATION_CHECKPOINT_SCHEMA_VERSION) {
    throw new Error(`${label}.schemaVersion is invalid`);
  }
  const batchIndex = nonNegativeInteger(checkpoint.batchIndex, `${label}.batchIndex`);
  if (!Array.isArray(checkpoint.captured)) throw new Error(`${label}.captured must be an array`);
  const source = validateSource(checkpoint.source, `${label}.source`);
  const counters = validateCounters(checkpoint.counters, `${label}.counters`);
  if (counters.batchIndex !== batchIndex) throw new Error(`${label}.batchIndex does not match counters.batchIndex`);
  return {
    schemaVersion: ACTION_COMPILATION_GENERATION_CHECKPOINT_SCHEMA_VERSION,
    batchIndex,
    source,
    counters,
    captured: checkpoint.captured as TCaptured[],
  };
}

function assertSourceMatches(
  actual: ActionCompilationGenerationCheckpointSource,
  expected: ActionCompilationGenerationCheckpointSource,
): void {
  if (contentHash(actual) !== contentHash(expected)) {
    throw new Error("generation checkpoint source does not match the current world/catalog/algorithm/prompt/seed snapshot");
  }
}

function assertMonotonic(
  previous: ActionCompilationGenerationCheckpointCounters | undefined,
  current: ActionCompilationGenerationCheckpointCounters,
): void {
  if (!previous) return;
  for (const key of Object.keys(current) as Array<keyof ActionCompilationGenerationCheckpointCounters>) {
    if (current[key] < previous[key]) throw new Error(`generation checkpoint counter regressed: ${key}`);
  }
}

export function writeActionCompilationGenerationCheckpoint<TCaptured>(
  staging: string,
  checkpoint: ActionCompilationGenerationCheckpoint<TCaptured>,
): void {
  const directory = checkpointDirectory(staging);
  mkdirSync(directory, { recursive: true });
  const validated = validateCheckpoint(checkpoint, "checkpoint");
  const output = path.join(directory, checkpointFilename(validated.batchIndex));
  if (existsSync(output)) throw new Error(`generation checkpoint already exists: ${output}`);
  const encoded = encodeJsonlGzip([validated]);
  const temporary = path.join(directory, `.${path.basename(output)}.${process.pid}.${randomUUID()}.tmp`);
  writeFileSync(temporary, encoded.buffer);
  renameSync(temporary, output);
}

export function loadActionCompilationGenerationCheckpoints<TCaptured>(
  staging: string,
  expectedSource: ActionCompilationGenerationCheckpointSource,
): LoadedActionCompilationGenerationCheckpoint<TCaptured> {
  const directory = checkpointDirectory(staging);
  if (!existsSync(directory)) throw new Error(`generation checkpoint directory is missing: ${directory}`);
  const files = readdirSync(directory)
    .filter((file) => /^batch-\d{6}\.jsonl\.gz$/u.test(file))
    .sort();
  if (files.length === 0) throw new Error(`generation checkpoint directory is empty: ${directory}`);
  const captured: TCaptured[] = [];
  let previousBatchIndex = 0;
  let previousCounters: ActionCompilationGenerationCheckpointCounters | undefined;
  let last: ActionCompilationGenerationCheckpoint<TCaptured> | undefined;
  for (const file of files) {
    const records = decodeJsonlGzip<ActionCompilationGenerationCheckpoint<TCaptured>>(
      readFileSync(path.join(directory, file)),
      `generation checkpoint ${file}`,
    );
    if (records.length !== 1) throw new Error(`generation checkpoint ${file} must contain exactly one record`);
    const checkpoint = validateCheckpoint<TCaptured>(records[0], `generation checkpoint ${file}`);
    if (checkpoint.batchIndex <= previousBatchIndex) {
      throw new Error(`generation checkpoints are not strictly ordered: ${file}`);
    }
    assertSourceMatches(checkpoint.source, expectedSource);
    assertMonotonic(previousCounters, checkpoint.counters);
    captured.push(...checkpoint.captured);
    previousBatchIndex = checkpoint.batchIndex;
    previousCounters = checkpoint.counters;
    last = checkpoint;
  }
  if (!last || !previousCounters) throw new Error("generation checkpoints did not contain a final state");
  return {
    checkpointCount: files.length,
    lastBatchIndex: last.batchIndex,
    counters: previousCounters,
    captured,
  };
}

export function countActionCompilationGenerationCheckpoints(staging: string): number {
  const directory = checkpointDirectory(staging);
  if (!existsSync(directory)) return 0;
  return readdirSync(directory).filter((file) => /^batch-\d{6}\.jsonl\.gz$/u.test(file)).length;
}
