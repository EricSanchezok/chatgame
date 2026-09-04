import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  allVisibleCandidateRetriever,
  encodedShard,
  evaluateActionCompilationRecall,
  loadActionCompilationReferenceDataset,
  type ActionCompilationReferenceDatasetManifest,
} from "./stabilized-behavior";
import {
  loadActionCompilationGenerationCheckpoints,
  writeActionCompilationGenerationCheckpoint,
  type ActionCompilationGenerationCheckpointCounters,
  type ActionCompilationGenerationCheckpointSource,
} from "./generation-checkpoint";
import { contentHash } from "../../models/model-audit";

const temporaryRoots: string[] = [];

function sha256(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function writeShard(root: string, file: string, records: readonly unknown[]) {
  const encoded = encodedShard(records);
  writeFileSync(path.join(root, file), encoded.buffer);
  return {
    file,
    sha256: sha256(encoded.buffer),
    records: records.length,
    rawBytes: encoded.rawBytes,
    compressedBytes: encoded.buffer.byteLength,
  };
}

function fixtureDataset() {
  const root = mkdtempSync(path.join(os.tmpdir(), "lwe-ac-benchmark-"));
  temporaryRoots.push(root);
  const shared = {
    candidateKey: "candidate_aaaaaaaaaaaa",
    kind: "entity",
    label: "shared",
    meaning: "shared candidate",
    allowedUses: ["target"],
    scope: { kind: "shared" },
    details: {},
  };
  const slot0 = {
    candidateKey: "candidate_bbbbbbbbbbbb",
    kind: "entity",
    label: "slot zero",
    meaning: "slot-local candidate",
    allowedUses: ["target"],
    scope: { kind: "slot", slot: 0 },
    details: {},
  };
  const slot1 = {
    candidateKey: "candidate_cccccccccccc",
    kind: "entity",
    label: "slot one",
    meaning: "slot-local candidate",
    allowedUses: ["target"],
    scope: { kind: "slot", slot: 1 },
    details: {},
  };
  const context = {
    referenceCatalog: { version: 2, hash: "catalog-hash", candidates: [shared, slot0, slot1] },
    state: { slots: [{ slot: 0 }, { slot: 1 }] },
    task: { action: "test" },
  };
  const actualContextHash = contentHash(context);
  mkdirSync(root, { recursive: true });
  const contextRecords = [{ contextHash: actualContextHash, context }];
  const cases = [
    {
      caseId: "ac-c3-v1-000001",
      contextHash: actualContextHash,
      slotIndex: 0,
      batchSize: 2,
      category: "shared",
      requiredCandidateKeys: [shared.candidateKey, slot0.candidateKey].sort(),
      source: { catalogHash: "catalog-hash", worldHash: "world-hash", algorithmManifestHash: "algorithm-hash" },
    },
    {
      caseId: "ac-c3-v1-000002",
      contextHash: actualContextHash,
      slotIndex: 1,
      batchSize: 2,
      category: "private",
      requiredCandidateKeys: [shared.candidateKey, slot1.candidateKey].sort(),
      source: { catalogHash: "catalog-hash", worldHash: "world-hash", algorithmManifestHash: "algorithm-hash" },
    },
  ];
  const seeds = [{ seed: 1, actionId: "action-1" }];
  const manifest: ActionCompilationReferenceDatasetManifest = {
    schemaVersion: 1,
    kind: "action-compilation-fullcatalog-stabilized",
    datasetId: "action-compilation/fullcatalog-stabilized",
    version: 1,
    status: "frozen",
    organization: "上海创智学院",
    project: "Living World Engine",
    purpose: "candidate-retrieval-recall",
    referenceSemantics: "behavioral-reference",
    semanticGroundTruth: false,
    source: {
      baseline: "C3",
      worldId: "blackmarsh",
      worldHash: "world-hash",
      initialStateHash: "initial-hash",
      modelCatalogHash: "model-hash",
      registrySnapshotHash: "registry-hash",
      profileId: "truth-deepseek",
      modelId: "deepseek-v4-flash",
      algorithmManifestHash: "algorithm-hash",
      promptVersion: "action-compilation@test",
      candidateKeyVersion: "candidate-key-v3",
      symbolRepairPolicyVersion: "symbol-repair-v1",
      semanticRepairAttempts: 2,
    },
    generation: {
      seed: 1,
      targetCases: 2,
      maxProviderRequests: 10,
      providerRequests: 2,
      logicalInvocations: 2,
      transportAttempts: 2,
      repairCalls: 0,
      acceptedSlots: 2,
      rejectedSlots: 0,
      startedAt: "2026-01-01T00:00:00.000Z",
      completedAt: "2026-01-01T00:00:01.000Z",
    },
    counts: { cases: 2, contexts: 1, nonEmptyRequiredCases: 2, emptyRequiredCases: 0 },
    artifacts: {
      seeds: [],
      contexts: [],
      cases: [],
    },
    distributions: {
      batchSizes: { "2": 2 },
      categories: { private: 1, shared: 1 },
      requiredKeyCardinality: { "2": 2 },
      repairCounts: { "0": 2 },
    },
  };
  manifest.artifacts.seeds = [writeShard(root, "seeds-000.jsonl.gz", seeds)];
  manifest.artifacts.contexts = [writeShard(root, "contexts-000.jsonl.gz", contextRecords)];
  manifest.artifacts.cases = [writeShard(root, "cases-000.jsonl.gz", cases)];
  writeFileSync(path.join(root, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  return { root, context, cases };
}

afterEach(() => {
  // Test directories are intentionally left to the OS temp cleaner. No
  // repository data is removed by these tests.
  temporaryRoots.length = 0;
});

describe("FullCatalog stabilized behavior benchmark", () => {
  it("loads a deduplicated context and gives FullCatalog recall 1", () => {
    const fixture = fixtureDataset();
    const dataset = loadActionCompilationReferenceDataset(fixture.root);
    const report = evaluateActionCompilationRecall(dataset, allVisibleCandidateRetriever, "FullCatalog");
    expect(dataset.contexts.size).toBe(1);
    expect(report.microRecall).toBe(1);
    expect(report.macroRecall).toBe(1);
    expect(report.invalidOutputKeys).toBe(0);
    expect(Object.values(report.byBatchUnion)[0]?.recall).toBe(1);
  });

  it("reports missing and private keys without mutating the context", () => {
    const fixture = fixtureDataset();
    const dataset = loadActionCompilationReferenceDataset(fixture.root);
    const before = JSON.stringify(fixture.context);
    const report = evaluateActionCompilationRecall(dataset, ({ context, slotIndex }) => {
      const candidates = (context.referenceCatalog as { candidates: Array<{ candidateKey: string; scope?: { kind?: string; slot?: number } }> }).candidates;
      const first = candidates.find((candidate) => candidate.scope?.kind === "shared")?.candidateKey;
      const privateKey = candidates.find((candidate) => candidate.scope?.kind === "slot" && candidate.scope.slot !== slotIndex)?.candidateKey;
      return [first!, privateKey!, "candidate_ffffffffffff"];
    });
    expect(report.microRecall).toBe(0.5);
    expect(report.invalidOutputKeys).toBe(4);
    expect(report.caseResults.every((result) => result.privateKeys.length === 1 && result.invalidKeys.length === 1)).toBe(true);
    expect(JSON.stringify(fixture.context)).toBe(before);
  });

  it("rejects an invalid required key during loading", () => {
    const fixture = fixtureDataset();
    const broken = fixture.cases.map((item, index) => index === 0
      ? { ...item, requiredCandidateKeys: ["candidate_ffffffffffff"] }
      : item);
    const encoded = encodedShard(broken);
    writeFileSync(path.join(fixture.root, "cases-000.jsonl.gz"), encoded.buffer);
    const manifest = JSON.parse(readFileSync(path.join(fixture.root, "manifest.json"), "utf8")) as ActionCompilationReferenceDatasetManifest;
    manifest.artifacts.cases[0] = {
      file: "cases-000.jsonl.gz",
      sha256: sha256(encoded.buffer),
      records: broken.length,
      rawBytes: encoded.rawBytes,
      compressedBytes: encoded.buffer.byteLength,
    };
    writeFileSync(path.join(fixture.root, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
    expect(() => loadActionCompilationReferenceDataset(fixture.root)).toThrow(/absent from catalog/u);
  });

  it("rejects a slot-private key used by another slot and an out-of-range slot", () => {
    const fixture = fixtureDataset();
    const broken = fixture.cases.map((item, index) => index === 0
      ? { ...item, slotIndex: 1, requiredCandidateKeys: ["candidate_aaaaaaaaaaaa", "candidate_bbbbbbbbbbbb"] }
      : item);
    const encoded = encodedShard(broken);
    writeFileSync(path.join(fixture.root, "cases-000.jsonl.gz"), encoded.buffer);
    const manifest = JSON.parse(readFileSync(path.join(fixture.root, "manifest.json"), "utf8")) as ActionCompilationReferenceDatasetManifest;
    manifest.artifacts.cases[0] = {
      file: "cases-000.jsonl.gz",
      sha256: sha256(encoded.buffer),
      records: broken.length,
      rawBytes: encoded.rawBytes,
      compressedBytes: encoded.buffer.byteLength,
    };
    writeFileSync(path.join(fixture.root, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
    expect(() => loadActionCompilationReferenceDataset(fixture.root)).toThrow(/private to another slot/u);
  });

  it("persists per-batch deltas and resumes from the latest cumulative counters", () => {
    const staging = mkdtempSync(path.join(os.tmpdir(), "lwe-ac-checkpoint-"));
    temporaryRoots.push(staging);
    const hash = (character: string): string => character.repeat(64);
    const source: ActionCompilationGenerationCheckpointSource = {
      worldHash: hash("a"),
      initialStateHash: hash("b"),
      modelCatalogHash: hash("c"),
      registrySnapshotHash: hash("d"),
      algorithmManifestHash: hash("e"),
      promptVersion: "action-compilation@test",
      profileId: "truth-deepseek",
      modelId: "deepseek-v4-flash",
      seed: 20260904,
      seedCorpusHash: hash("f"),
    };
    const counters = (batchIndex: number, providerRequests: number): ActionCompilationGenerationCheckpointCounters => ({
      providerRequests,
      logicalInvocations: providerRequests,
      transportAttempts: providerRequests,
      repairCalls: 0,
      rejectedSlots: 0,
      seedIndex: batchIndex,
      batchIndex,
      batchAttempts: batchIndex,
    });
    writeActionCompilationGenerationCheckpoint(staging, {
      schemaVersion: 1,
      batchIndex: 1,
      source,
      counters: counters(1, 2),
      captured: [{ caseId: "first" }],
    });
    writeActionCompilationGenerationCheckpoint(staging, {
      schemaVersion: 1,
      batchIndex: 2,
      source,
      counters: counters(2, 3),
      captured: [{ caseId: "second" }],
    });
    const loaded = loadActionCompilationGenerationCheckpoints<{ caseId: string }>(staging, source);
    expect(loaded.checkpointCount).toBe(2);
    expect(loaded.lastBatchIndex).toBe(2);
    expect(loaded.counters.providerRequests).toBe(3);
    expect(loaded.captured.map((item) => item.caseId)).toEqual(["first", "second"]);
  });

  it("rejects checkpoint source drift and duplicate batch files", () => {
    const staging = mkdtempSync(path.join(os.tmpdir(), "lwe-ac-checkpoint-"));
    temporaryRoots.push(staging);
    const hash = "a".repeat(64);
    const source: ActionCompilationGenerationCheckpointSource = {
      worldHash: hash,
      initialStateHash: hash,
      modelCatalogHash: hash,
      registrySnapshotHash: hash,
      algorithmManifestHash: hash,
      promptVersion: "action-compilation@test",
      profileId: "truth-deepseek",
      modelId: "deepseek-v4-flash",
      seed: 1,
      seedCorpusHash: hash,
    };
    const counters: ActionCompilationGenerationCheckpointCounters = {
      providerRequests: 0,
      logicalInvocations: 0,
      transportAttempts: 0,
      repairCalls: 0,
      rejectedSlots: 0,
      seedIndex: 0,
      batchIndex: 1,
      batchAttempts: 1,
    };
    writeActionCompilationGenerationCheckpoint(staging, {
      schemaVersion: 1,
      batchIndex: 1,
      source,
      counters,
      captured: [],
    });
    expect(() => writeActionCompilationGenerationCheckpoint(staging, {
      schemaVersion: 1,
      batchIndex: 1,
      source,
      counters,
      captured: [],
    })).toThrow(/already exists/u);
    expect(() => loadActionCompilationGenerationCheckpoints(staging, { ...source, seed: 2 })).toThrow(/source does not match/u);
  });
});
