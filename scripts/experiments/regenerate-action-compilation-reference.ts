import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  ACTION_COMPILATION_REFERENCE_DATASET_KIND,
  ACTION_COMPILATION_REFERENCE_DATASET_SCHEMA_VERSION,
  encodedShard,
  loadActionCompilationReferenceDataset,
  type ActionCompilationReferenceCase,
  type ActionCompilationReferenceContextRecord,
  type ActionCompilationReferenceDatasetManifest,
  type BenchmarkArtifactShard,
} from "../../src/engine/benchmarks/action-compilation/stabilized-behavior";
import { assertSafeBenchmarkSource, type RawBenchmarkSource, type RegeneratedActionCompilationReference } from "../../src/engine/benchmarks/source-capture";
import { canonicalize, contentHash } from "../../src/engine/models/model-audit";
import { ACTION_COMPILATION_CANDIDATE_KEY_VERSION, ACTION_COMPILATION_PROJECTION } from "../../src/engine/contracts/model-context";
import { DEFAULT_SYMBOL_REPAIR_POLICY } from "../../src/engine/contracts/symbol-repair";

interface Args { source: string; output: string; version: number; providerModule?: string; dryRun: boolean; }
function required(argv: readonly string[], index: number, option: string): string { const value = argv[index]; if (!value || value.startsWith("--")) throw new Error(`${option} requires a value`); return value; }
function parse(argv: readonly string[]): Args {
  const result: Args = { source: path.resolve(".livingworld-benchmarks/source/action-compilation"), output: path.resolve("benchmarks/action-compilation/fullcatalog-stabilized"), version: 2, dryRun: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]!;
    if (argument === "--source") result.source = path.resolve(required(argv, ++index, argument));
    else if (argument === "--output") result.output = path.resolve(required(argv, ++index, argument));
    else if (argument === "--version") { result.version = Number(required(argv, ++index, argument)); if (!Number.isSafeInteger(result.version) || result.version < 1) throw new Error("--version must be a positive integer"); }
    else if (argument === "--provider-module") result.providerModule = path.resolve(required(argv, ++index, argument));
    else if (argument === "--dry-run") result.dryRun = true;
    else if (argument === "--help") throw new Error("usage: --source <capture-dir> --output <dataset-root> --version <n> --provider-module <module> [--dry-run]");
    else throw new Error(`unknown argument: ${argument}`);
  }
  return result;
}
function sha256(value: Uint8Array): string { return createHash("sha256").update(value).digest("hex"); }
function loadSources(directory: string): RawBenchmarkSource[] {
  const file = path.join(directory, "sources-000.jsonl.gz");
  if (!existsSync(file)) throw new Error(`source shard is missing: ${file}`);
  return gunzipSync(readFileSync(file)).toString("utf8").split(/\r?\n/u).filter(Boolean).map((line) => {
    const source = JSON.parse(line) as RawBenchmarkSource;
    assertSafeBenchmarkSource(source);
    if (!source.stateSnapshot || !source.stateHash || contentHash(source.stateSnapshot) !== source.stateHash) throw new Error(`source ${source.sourceInvocationId} is missing an exact verified pre-step state snapshot`);
    return source;
  });
}
interface RegeneratorModule { regenerateFullReference?: (source: RawBenchmarkSource) => Promise<RegeneratedActionCompilationReference>; default?: (source: RawBenchmarkSource) => Promise<RegeneratedActionCompilationReference>; }
function object(value: unknown): Record<string, unknown> | undefined { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined; }
function candidates(context: Record<string, unknown>): Map<string, Record<string, unknown>> {
  const catalog = object(context.referenceCatalog);
  const values = Array.isArray(catalog?.candidates) ? catalog.candidates : [];
  return new Map(values.flatMap((value) => { const candidate = object(value); return typeof candidate?.candidateKey === "string" ? [[candidate.candidateKey, candidate] as const] : []; }));
}
function visible(candidate: Record<string, unknown>, slot: number): boolean { const scope = object(candidate.scope); return !scope || scope.kind === "shared" || scope.kind === "slot" && scope.slot === slot; }
function validateReference(source: RawBenchmarkSource, reference: RegeneratedActionCompilationReference): void {
  if (reference.fullyValidated !== true || reference.fullContextHash !== source.fullContextHash || !Number.isSafeInteger(reference.providerRequests) || reference.providerRequests < 1) throw new Error(`regenerator did not return fully validated FullCatalog evidence for ${source.sourceInvocationId}`);
  const byKey = candidates(source.fullContext);
  const sourceSlots = new Set(source.slotIndices);
  const seen = new Set<number>();
  for (const slot of reference.slots) {
    if (!Number.isSafeInteger(slot.slotIndex) || !sourceSlots.has(slot.slotIndex) || seen.has(slot.slotIndex)) throw new Error(`regenerator returned an invalid/duplicate slot for ${source.sourceInvocationId}`);
    seen.add(slot.slotIndex);
    const stable = [...new Set(slot.requiredCandidateKeys)].sort();
    if (JSON.stringify(stable) !== JSON.stringify(slot.requiredCandidateKeys)) throw new Error(`regenerator keys must be sorted and unique for ${source.sourceInvocationId} slot ${slot.slotIndex}`);
    for (const key of stable) { const candidate = byKey.get(key); if (!candidate || !visible(candidate, slot.slotIndex)) throw new Error(`regenerator returned absent/private key ${key}`); }
    if (!Number.isSafeInteger(slot.repairCount) || slot.repairCount < 0 || !/^[a-f0-9]{64}$/u.test(slot.rawOutputHash) || !/^[a-f0-9]{64}$/u.test(slot.normalizedOutputHash)) throw new Error(`regenerator provenance is incomplete for ${source.sourceInvocationId} slot ${slot.slotIndex}`);
  }
}
function artifact(root: string, name: string, records: readonly unknown[]): BenchmarkArtifactShard {
  const encoded = encodedShard(records);
  writeFileSync(path.join(root, name), encoded.buffer);
  return { file: name, sha256: sha256(encoded.buffer), records: records.length, rawBytes: encoded.rawBytes, compressedBytes: encoded.buffer.byteLength };
}
function sourceFingerprint(source: RawBenchmarkSource): Record<string, unknown> {
  const execution = object(source.fullContext.execution);
  const fingerprint = { worldId: typeof execution?.worldId === "string" ? execution.worldId : "", worldHash: source.worldHash ?? "", initialStateHash: source.stateHash ?? "", modelCatalogHash: source.modelCatalogHash ?? "", registrySnapshotHash: source.registrySnapshotHash ?? "", profileId: source.profileId ?? "", modelId: source.modelId ?? "", algorithmManifestHash: source.algorithmManifestHash ?? "", promptVersion: source.promptVersion ?? "" };
  if (Object.values(fingerprint).some((value) => value === "")) throw new Error(`source ${source.sourceInvocationId} is missing regeneration fingerprints`);
  return fingerprint;
}
export async function main(argv: readonly string[]): Promise<number> {
  let args: Args;
  try { args = parse(argv); } catch (error) { const message = error instanceof Error ? error.message : String(error); if (message.startsWith("usage:")) { process.stdout.write(`${message}\n`); return 0; } process.stderr.write(`${message}\n`); return 2; }
  try {
    const sources = loadSources(args.source);
    if (args.dryRun) { process.stdout.write(`${JSON.stringify({ source: args.source, records: sources.length, providerRequests: 0, dryRun: true }, null, 2)}\n`); return 0; }
    if (!args.providerModule) throw new Error("--provider-module is required for live FullCatalog regeneration");
    const target = path.join(args.output, `v${args.version}`);
    if (existsSync(target)) throw new Error(`frozen dataset output already exists: ${target}`);
    const moduleValue = await import(pathToFileURL(args.providerModule).href) as RegeneratorModule;
    const regenerate = moduleValue.regenerateFullReference ?? moduleValue.default;
    if (typeof regenerate !== "function") throw new Error("provider module must export regenerateFullReference(source) or a default function");
    const fingerprint = sourceFingerprint(sources[0]!);
    for (const source of sources) if (contentHash(sourceFingerprint(source)) !== contentHash(fingerprint)) throw new Error("captured sources have different world/model/algorithm/prompt fingerprints");
    const contexts = new Map<string, ActionCompilationReferenceContextRecord>();
    const provisionalCases: Array<Omit<ActionCompilationReferenceCase, "caseId">> = [];
    let providerRequests = 0;
    for (const source of sources) {
      const reference = await regenerate(source);
      validateReference(source, reference);
      providerRequests += reference.providerRequests;
      contexts.set(source.fullContextHash, { contextHash: source.fullContextHash, context: structuredClone(source.fullContext), source: { executionId: source.sourceExecutionId, invocationId: source.sourceInvocationId, catalogHash: String(object(source.fullContext.referenceCatalog)?.hash ?? "") } });
      for (const slot of reference.slots) provisionalCases.push({ contextHash: source.fullContextHash, slotIndex: slot.slotIndex, batchSize: source.slotIndices.length, category: "runtime-action", requiredCandidateKeys: slot.requiredCandidateKeys, source: { catalogHash: String(object(source.fullContext.referenceCatalog)?.hash ?? ""), worldHash: String(fingerprint.worldHash), algorithmManifestHash: String(fingerprint.algorithmManifestHash) }, provenance: { sourceExecutionId: source.sourceExecutionId, sourceInvocationId: source.sourceInvocationId, repairCount: slot.repairCount, rawOutputHash: slot.rawOutputHash, normalizedOutputHash: slot.normalizedOutputHash } });
    }
    if (provisionalCases.length === 0) throw new Error("FullCatalog regeneration produced no accepted slots; no dataset was published");
    const cases = provisionalCases.sort((left, right) => left.contextHash.localeCompare(right.contextHash) || left.slotIndex - right.slotIndex).map((item, index) => ({ ...item, caseId: `ac-c3-v${args.version}-${String(index + 1).padStart(6, "0")}` }));
    mkdirSync(args.output, { recursive: true });
    const staging = mkdtempSync(path.join(args.output, `.v${args.version}-staging-`));
    const contextRecords = [...contexts.values()].sort((left, right) => left.contextHash.localeCompare(right.contextHash));
    const startedAt = new Date().toISOString();
    const artifacts = { seeds: [artifact(staging, "seeds-000.jsonl.gz", sources.map((source) => ({ sourceExecutionId: source.sourceExecutionId, sourceInvocationId: source.sourceInvocationId, fullContextHash: source.fullContextHash })))], contexts: [artifact(staging, "contexts-000.jsonl.gz", contextRecords)], cases: [artifact(staging, "cases-000.jsonl.gz", cases)] };
    const count = (values: readonly string[]): Record<string, number> => values.reduce<Record<string, number>>((result, value) => { result[value] = (result[value] ?? 0) + 1; return result; }, {});
    const manifest: ActionCompilationReferenceDatasetManifest = {
      schemaVersion: ACTION_COMPILATION_REFERENCE_DATASET_SCHEMA_VERSION,
      kind: ACTION_COMPILATION_REFERENCE_DATASET_KIND,
      datasetId: "action-compilation/fullcatalog-stabilized",
      version: args.version,
      status: "frozen",
      organization: "上海创智学院",
      project: "Living World Engine",
      purpose: "candidate-retrieval-recall",
      referenceSemantics: "behavioral-reference",
      semanticGroundTruth: false,
      source: { baseline: "C3", worldId: String(fingerprint.worldId), worldHash: String(fingerprint.worldHash), initialStateHash: String(fingerprint.initialStateHash), modelCatalogHash: String(fingerprint.modelCatalogHash), registrySnapshotHash: String(fingerprint.registrySnapshotHash), profileId: String(fingerprint.profileId), modelId: String(fingerprint.modelId), algorithmManifestHash: String(fingerprint.algorithmManifestHash), promptVersion: String(fingerprint.promptVersion), candidateKeyVersion: `${ACTION_COMPILATION_PROJECTION}@${ACTION_COMPILATION_CANDIDATE_KEY_VERSION}`, symbolRepairPolicyVersion: DEFAULT_SYMBOL_REPAIR_POLICY.version, semanticRepairAttempts: Math.max(...cases.map((item) => item.provenance?.repairCount ?? 0)) },
      generation: { seed: 0, targetCases: cases.length, maxProviderRequests: providerRequests, providerRequests, logicalInvocations: sources.length, transportAttempts: providerRequests, repairCalls: cases.reduce((sum, item) => sum + (item.provenance?.repairCount ?? 0), 0), acceptedSlots: cases.length, rejectedSlots: sources.reduce((sum, source) => sum + source.slotIndices.length, 0) - cases.length, startedAt, completedAt: new Date().toISOString() },
      counts: { cases: cases.length, contexts: contextRecords.length, nonEmptyRequiredCases: cases.filter((item) => item.requiredCandidateKeys.length > 0).length, emptyRequiredCases: cases.filter((item) => item.requiredCandidateKeys.length === 0).length },
      artifacts,
      distributions: { batchSizes: count(cases.map((item) => String(item.batchSize))), categories: count(cases.map((item) => item.category ?? "uncategorized")), requiredKeyCardinality: count(cases.map((item) => String(item.requiredCandidateKeys.length))), repairCounts: count(cases.map((item) => String(item.provenance?.repairCount ?? 0))) },
    };
    writeFileSync(path.join(staging, "README.md"), `# FullCatalog C3 stabilized behavior v${args.version}\n\nFrozen behavioral reference regenerated from ${sources.length} captured full-context invocation(s). Provider requests: ${providerRequests}. This is not semantic ground truth.\n`, "utf8");
    writeFileSync(path.join(staging, "manifest.json"), `${JSON.stringify(canonicalize(manifest), null, 2)}\n`, "utf8");
    loadActionCompilationReferenceDataset(staging);
    renameSync(staging, target);
    process.stdout.write(`${JSON.stringify({ output: target, sourceRecords: sources.length, providerRequests, acceptedCases: cases.length, contexts: contextRecords.length }, null, 2)}\n`);
    return 0;
  } catch (error) { process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); return 1; }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) void main(process.argv.slice(2)).then((code) => { process.exitCode = code; });
