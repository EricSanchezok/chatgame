import { randomUUID, createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import {
  ACTION_COMPILATION_PROJECTION,
  ACTION_COMPILATION_CANDIDATE_KEY_VERSION,
} from "../../src/engine/contracts/model-context";
import type { AgentActionProposal, ActionCompilationReferenceAudit, ModelExecutionAudit } from "../../src/engine/contracts/model";
import { DEFAULT_SYMBOL_REPAIR_POLICY } from "../../src/engine/contracts/symbol-repair";
import {
  compileActions,
} from "../../src/engine/algorithms/eager-reference/action-compiler";
import {
  createEagerReferenceManifest,
  DEFAULT_EAGER_REFERENCE_CONFIG,
} from "../../src/engine/algorithms/eager-reference/eager-reference";
import { loadModelCatalog } from "../../src/engine/models/model-catalog";
import { ModelGateway } from "../../src/engine/models/model-gateway";
import { ModelRegistry } from "../../src/engine/models/model-registry";
import { contentHash } from "../../src/engine/models/model-audit";
import { promptBundle } from "../../src/engine/prompts";
import type { RuntimeEvent } from "../../src/engine/runtime/observability";
import { LocalDatabase } from "../../src/server/local-database";
import { runtimeCodeIdentity } from "../../src/server/code-identity";
import { loadWorldScript } from "../../src/script/world-loader";
import {
  ACTION_COMPILATION_REFERENCE_DATASET_KIND,
  ACTION_COMPILATION_REFERENCE_DATASET_SCHEMA_VERSION,
  encodedShard,
  loadActionCompilationReferenceDataset,
  shardRecords,
  type ActionCompilationReferenceCase,
  type ActionCompilationReferenceContextRecord,
  type ActionCompilationReferenceDatasetManifest,
} from "../../src/engine/benchmarks/action-compilation/stabilized-behavior";

interface SeedRecord {
  id: string;
  category: string;
  action: { rawText: string; goal: string; means: string | null };
  actorId: string;
  targetIds?: string[];
}

interface GeneratorOptions {
  live: boolean;
  target: number;
  maxProviderRequests: number;
  seed: number;
  output: string;
  dataRoot: string;
  scratchRoot: string;
}

interface CapturedCase {
  context: Record<string, unknown>;
  case: ActionCompilationReferenceCase;
  seed: SeedRecord;
}

function parsePositive(value: string, label: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new Error(`${label} must be a positive integer`);
  return parsed;
}

function parseOptions(argv: readonly string[]): GeneratorOptions {
  let live = false;
  let target = 480;
  let maxProviderRequests = 1_000;
  let seed = 20260904;
  let output = path.resolve("benchmarks/action-compilation/fullcatalog-stabilized/v1");
  let dataRoot = path.resolve(".livingworld-benchmarks");
  let scratchRoot = path.resolve(".livingworld-benchmarks/action-compilation-reference-v1");
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--live") live = true;
    else if (argument === "--target") target = parsePositive(argv[++index] ?? "", "--target");
    else if (argument === "--max-provider-requests") maxProviderRequests = parsePositive(argv[++index] ?? "", "--max-provider-requests");
    else if (argument === "--seed") seed = parsePositive(argv[++index] ?? "", "--seed");
    else if (argument === "--output") output = path.resolve(argv[++index] ?? "");
    else if (argument === "--data-root") dataRoot = path.resolve(argv[++index] ?? "");
    else if (argument === "--scratch-root") scratchRoot = path.resolve(argv[++index] ?? "");
    else if (argument === "--help" || argument === "-h") {
      process.stdout.write("usage: npm run benchmark:generate:action-compilation-reference -- --live [--target 480] [--max-provider-requests 1000]\n");
      process.exit(0);
    } else throw new Error(`unknown argument: ${argument}`);
  }
  return { live, target, maxProviderRequests, seed, output, dataRoot, scratchRoot };
}

function readSeeds(definitionAgents: Readonly<Record<string, unknown>>): SeedRecord[] {
  const seeds: SeedRecord[] = [];
  const add = (file: string, live: boolean): void => {
    const lines = readFileSync(file, "utf8").split(/\r?\n/u).filter((line) => line.trim().length > 0);
    for (const [index, line] of lines.entries()) {
      const value = JSON.parse(line) as Record<string, unknown>;
      const action = value.action as Record<string, unknown> | undefined;
      if (!action || typeof action.rawText !== "string" || typeof action.goal !== "string") continue;
      const liveValue = value.live as Record<string, unknown> | undefined;
      const actorId = live && typeof liveValue?.actorId === "string"
        ? liveValue.actorId
        : Object.keys(definitionAgents)[(seeds.length + index) % Math.max(1, Object.keys(definitionAgents).length)];
      if (!actorId || !definitionAgents[actorId]) continue;
      seeds.push({
        id: typeof value.id === "string" ? value.id : `${path.basename(file)}-${index}`,
        category: typeof value.category === "string" ? value.category : "uncategorized",
        actorId,
        action: {
          rawText: action.rawText,
          goal: action.goal,
          means: typeof action.means === "string" ? action.means : null,
        },
      });
    }
  };
  add(path.resolve("test/fixtures/action-compilation/live-corpus.jsonl"), true);
  add(path.resolve("test/fixtures/action-compilation/corpus.jsonl"), false);
  if (seeds.length === 0) throw new Error("reviewed Action Compilation seed corpus is empty");
  return seeds;
}

function sha256(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function writeShards(root: string, prefix: string, records: readonly unknown[], size = 50) {
  return shardRecords(records, size).map((shard, index) => {
    const file = `${prefix}-${String(index).padStart(3, "0")}.jsonl.gz`;
    const encoded = encodedShard(shard);
    writeFileSync(path.join(root, file), encoded.buffer);
    return {
      file,
      sha256: sha256(encoded.buffer),
      records: shard.length,
      rawBytes: encoded.rawBytes,
      compressedBytes: encoded.buffer.byteLength,
    };
  });
}

function eventPayload<T>(event: RuntimeEvent | undefined): T | undefined {
  return event?.payload as T | undefined;
}

function contextForEvent(event: RuntimeEvent | undefined): Record<string, unknown> | undefined {
  const payload = eventPayload<{ context?: unknown }>(event);
  return payload?.context && typeof payload.context === "object" && !Array.isArray(payload.context)
    ? payload.context as Record<string, unknown>
    : undefined;
}

function referencesForEvent(event: RuntimeEvent | undefined): ActionCompilationReferenceAudit | undefined {
  const payload = eventPayload<ActionCompilationReferenceAudit>(event);
  return payload?.projection === ACTION_COMPILATION_PROJECTION && Array.isArray(payload.slots)
    ? payload
    : undefined;
}

function rootContext(events: readonly RuntimeEvent[], logicalInvocationId: string): RuntimeEvent | undefined {
  return events.find((event) => event.event === "model.context.serialized" &&
    event.correlation?.modelRole === "action-compilation" &&
    event.correlation.logicalInvocationId === logicalInvocationId &&
    (event.correlation.semanticRepairAttempt ?? 0) === 0);
}

function finalReferenceAudit(events: readonly RuntimeEvent[], invocationId: string): ActionCompilationReferenceAudit | undefined {
  const matching = events.filter((event) => event.event === "model.action_compilation.references" &&
    event.correlation?.modelInvocationId === invocationId);
  return referencesForEvent(matching.at(-1));
}

function invocationCounts(audits: readonly ModelExecutionAudit[]) {
  const invocations = audits.flatMap((audit) => audit.invocations);
  return {
    logicalInvocations: audits.length,
    transportAttempts: invocations.reduce((sum, invocation) => sum + invocation.transports.length, 0),
    repairCalls: invocations.filter((invocation) => invocation.ordinal > 1).length,
  };
}

function extractCapturedCases(
  events: readonly RuntimeEvent[],
  audits: readonly ModelExecutionAudit[],
  acceptedActionIds: ReadonlySet<string>,
  executionId: string,
  worldHash: string,
  algorithmManifestHash: string,
  sourceSeeds: readonly SeedRecord[],
): CapturedCase[] {
  const cases: CapturedCase[] = [];
  const seedByActionId = new Map(sourceSeeds.map((seed) => [seed.id, seed]));
  for (const audit of audits) {
    const invocation = audit.invocations.at(-1);
    if (!invocation) continue;
    const correlationEvent = events.find((event) => event.event === "model.structured_output.parsed" &&
      event.correlation?.modelInvocationId === invocation.id);
    const logicalInvocationId = correlationEvent?.correlation?.logicalInvocationId;
    if (!logicalInvocationId) continue;
    const contextEvent = rootContext(events, logicalInvocationId);
    const context = contextForEvent(contextEvent);
    const referenceAudit = finalReferenceAudit(events, invocation.id);
    if (!context || !referenceAudit) continue;
    const contextHash = contentHash(context);
    for (const slot of referenceAudit.slots) {
      if (!acceptedActionIds.has(slot.actionId)) continue;
      const requiredCandidateKeys = [...new Set(slot.selections
        .filter((selection) => selection.status === "resolved")
        .map((selection) => selection.candidateKey))].sort();
      const seed = seedByActionId.get(slot.actionId);
      if (!seed) continue;
      cases.push({
        context,
        seed,
        case: {
          caseId: "",
          contextHash,
          slotIndex: slot.slot,
          batchSize: referenceAudit.slots.length,
          category: seed.category,
          requiredCandidateKeys,
          source: {
            catalogHash: typeof (context.referenceCatalog as { hash?: unknown } | undefined)?.hash === "string"
              ? (context.referenceCatalog as { hash: string }).hash
              : "",
            worldHash,
            algorithmManifestHash,
          },
          provenance: {
            sourceExecutionId: executionId,
            sourceInvocationId: invocation.id,
            repairCount: correlationEvent?.correlation?.semanticRepairAttempt ?? 0,
            rawOutputHash: invocation.rawOutputHash ?? undefined,
            normalizedOutputHash: invocation.normalizedOutputHash ?? undefined,
          },
        },
      });
    }
  }
  return cases;
}

function distribution(values: readonly string[]): Record<string, number> {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return Object.fromEntries([...counts].sort(([left], [right]) => left.localeCompare(right)));
}

function ensureNoSecrets(value: unknown): void {
  const text = JSON.stringify(value);
  if (/authorization|api[_-]?key|cookie|bearer\s/iu.test(text)) {
    throw new Error("benchmark payload contains a credential-like field");
  }
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  if (!options.live) throw new Error("live provider generation is opt-in; pass --live");
  if (existsSync(path.join(options.output, "manifest.json"))) {
    throw new Error(`refusing to overwrite existing benchmark: ${options.output}`);
  }
  const catalog = loadModelCatalog();
  const registry = new ModelRegistry(catalog, options.dataRoot);
  const registrySnapshot = await registry.capture();
  const definition = loadWorldScript(path.resolve("worlds/blackmarsh/world"), {
    seed: options.seed,
    modelCatalog: catalog,
  });
  const algorithmManifest = createEagerReferenceManifest(DEFAULT_EAGER_REFERENCE_CONFIG);
  const code = runtimeCodeIdentity();
  const prompt = promptBundle("action-compilation");
  const seeds = readSeeds(definition.initialState.agents);
  const staging = path.join(options.scratchRoot, `run-${Date.now()}-${randomUUID()}`);
  mkdirSync(staging, { recursive: true });
  const databaseFile = path.join(staging, "generation.sqlite");
  const ledger = new LocalDatabase(databaseFile, { heartbeat: false });
  const executionId = randomUUID();
  const trace = ledger.beginExecution({
    id: executionId,
    kind: "benchmark",
    manifest: algorithmManifest,
    worldHash: definition.initialState.worldHash,
    codeRevision: code.revision,
    codeDirty: code.dirty,
    modelCatalogHash: catalog.hash,
    seed: options.seed,
    runtimeConfig: {
      benchmark: ACTION_COMPILATION_REFERENCE_DATASET_KIND,
      targetCases: options.target,
      maxProviderRequests: options.maxProviderRequests,
      baseline: "C3",
    },
  });
  const provider = new ModelGateway(catalog, process.env, {
    registry,
    observer: trace,
    // A retry still counts as a provider request. Keep the production retry
    // policy, while measuring every transport attempt from the audit.
    maxTransportAttempts: 3,
  });
  const captured: CapturedCase[] = [];
  let providerRequests = 0;
  let logicalInvocations = 0;
  let transportAttempts = 0;
  let repairCalls = 0;
  let rejectedSlots = 0;
  let seedIndex = 0;
  let batchIndex = 0;
  let batchAttempts = 0;
  // Keep explicit coverage for the production 1/5/12 shapes, then use the
  // smallest shape for the remainder. A one-slot request lets the production
  // compiler retain a successful case even when a neighboring multi-slot
  // response would contain a failed slot.
  const batchShapes = [1, 5, 12] as const;
  const startedAt = new Date().toISOString();
  let completed = false;
  let failureMessage: string | undefined;
  try {
    while (
      captured.length < options.target &&
      providerRequests < options.maxProviderRequests &&
      batchAttempts < options.maxProviderRequests * 4
    ) {
      batchAttempts += 1;
      const batchSize = batchIndex < batchShapes.length
        ? batchShapes[batchIndex]!
        : 1;
      const batchSeeds = Array.from({ length: batchSize }, (_, offset) => seeds[(seedIndex + offset) % seeds.length]!);
      seedIndex += batchSize;
      batchIndex += 1;
      const actions: AgentActionProposal[] = batchSeeds.map((seed, offset) => ({
        id: `ac-c3-reference-${batchIndex}-${offset}`,
        actorId: seed.actorId,
        baseRevision: definition.initialState.revision,
        rawText: seed.action.rawText,
        goal: seed.action.goal,
        means: seed.action.means,
        targetIds: seed.targetIds ?? [],
      }));
      const sourceSeeds = batchSeeds.map((seed, offset) => ({ ...seed, id: actions[offset]!.id }));
      const beforeEvents = ledger.executionEvents(executionId).length;
      try {
        const result = await compileActions(provider, definition.initialState, actions, {
          workloadId: `benchmark:${executionId}`,
          batchId: `batch:${batchIndex}`,
          correlation: { executionId, revision: definition.initialState.revision, step: definition.initialState.step },
          observer: trace,
          runtimeIdentity: { worldHash: definition.initialState.worldHash, revision: definition.initialState.revision },
          modelRegistrySnapshotHash: registrySnapshot.hash,
        }, "truth-deepseek", DEFAULT_EAGER_REFERENCE_CONFIG.actionCompilationMaxSlots, 2);
        const events = ledger.executionEvents(executionId);
        const newEvents = events.slice(beforeEvents);
        const calls = invocationCounts(result.modelAudits);
        logicalInvocations += calls.logicalInvocations;
        const observedTransportAttempts = newEvents
          .filter((event) => event.event === "model.audit.persisted" && event.correlation?.modelRole === "action-compilation")
          .reduce((sum, event) => sum + (eventPayload<ModelExecutionAudit>(event)?.invocations.at(-1)?.transports.length ?? 0), 0);
        transportAttempts += observedTransportAttempts || calls.transportAttempts;
        providerRequests += observedTransportAttempts || calls.transportAttempts;
        repairCalls += calls.repairCalls;
        if (providerRequests > options.maxProviderRequests) break;
        const acceptedActionIds = new Set(result.compilations.map((_, index) => actions[index]?.id).filter((id): id is string => typeof id === "string"));
        captured.push(...extractCapturedCases(
          newEvents,
          result.modelAudits,
          acceptedActionIds,
          executionId,
          definition.initialState.worldHash,
          algorithmManifest.hash,
          sourceSeeds,
        ));
      } catch (error) {
        const events = ledger.executionEvents(executionId).slice(beforeEvents);
        const actionAudits = events.filter((event) => event.event === "model.audit.persisted" && event.correlation?.modelRole === "action-compilation");
        const failedTransportAttempts = actionAudits.reduce((sum, event) =>
          sum + (eventPayload<ModelExecutionAudit>(event)?.invocations.at(-1)?.transports.length ?? 0), 0);
        logicalInvocations += actionAudits.length;
        providerRequests += failedTransportAttempts;
        transportAttempts += failedTransportAttempts;
        repairCalls += events.filter((event) => event.event === "model.context.serialized" &&
          event.correlation?.modelRole === "action-compilation" &&
          (event.correlation.semanticRepairAttempt ?? 0) > 0).length;
        rejectedSlots += batchSeeds.length;
        trace.emit({
          event: "benchmark.action_compilation.batch_rejected",
          level: "warn",
          correlation: { executionId, component: "benchmark-generator" },
          counts: { slots: batchSeeds.length },
          error: { name: error instanceof Error ? error.name : "Error", message: error instanceof Error ? error.message : String(error) },
        });
      }
    }
    if (captured.length < options.target) {
      throw new Error(`provider request budget exhausted with ${captured.length}/${options.target} accepted slots`);
    }
    const selectedCaptured = captured
      .sort((left, right) => left.seed.category.localeCompare(right.seed.category) || left.case.contextHash.localeCompare(right.case.contextHash) || left.case.slotIndex - right.case.slotIndex)
      .slice(0, options.target);
    const selected = selectedCaptured.map((item, index) => ({
      ...item.case,
      caseId: `ac-c3-v1-${String(index + 1).padStart(6, "0")}`,
    }));
    const uniqueContexts = new Map<string, ActionCompilationReferenceContextRecord>();
    for (const item of selectedCaptured) {
      if (!uniqueContexts.has(item.case.contextHash)) uniqueContexts.set(item.case.contextHash, {
        contextHash: item.case.contextHash,
        context: item.context,
        source: {
          executionId,
          invocationId: item.case.provenance?.sourceInvocationId,
          catalogHash: item.case.source.catalogHash,
        },
      });
    }
    const seedsOutput = selected.map((item) => ({
      caseId: item.caseId,
      sourceExecutionId: item.provenance?.sourceExecutionId ?? executionId,
      sourceInvocationId: item.provenance?.sourceInvocationId ?? null,
      category: item.category ?? "uncategorized",
      slotIndex: item.slotIndex,
      batchSize: item.batchSize,
    }));
    mkdirSync(path.dirname(options.output), { recursive: true });
    const publishStaging = path.join(staging, "dataset");
    mkdirSync(publishStaging, { recursive: true });
    const contextRecords = [...uniqueContexts.values()].sort((left, right) => left.contextHash.localeCompare(right.contextHash));
    const contextShards = writeShards(publishStaging, "contexts", contextRecords);
    const caseShards = writeShards(publishStaging, "cases", selected);
    const seedShards = writeShards(publishStaging, "seeds", seedsOutput);
    const manifest: ActionCompilationReferenceDatasetManifest = {
      schemaVersion: ACTION_COMPILATION_REFERENCE_DATASET_SCHEMA_VERSION,
      kind: ACTION_COMPILATION_REFERENCE_DATASET_KIND,
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
        worldId: definition.id,
        worldHash: definition.contentHash,
        initialStateHash: contentHash(definition.initialState),
        modelCatalogHash: catalog.hash,
        registrySnapshotHash: registrySnapshot.hash,
        profileId: "truth-deepseek",
        modelId: "deepseek-v4-flash",
        algorithmManifestHash: algorithmManifest.hash,
        promptVersion: prompt.version,
        candidateKeyVersion: `${ACTION_COMPILATION_PROJECTION}@${ACTION_COMPILATION_CANDIDATE_KEY_VERSION}`,
        symbolRepairPolicyVersion: DEFAULT_SYMBOL_REPAIR_POLICY.version,
        semanticRepairAttempts: 2,
      },
      generation: {
        seed: options.seed,
        targetCases: options.target,
        maxProviderRequests: options.maxProviderRequests,
        providerRequests,
        logicalInvocations,
        transportAttempts,
        repairCalls,
        acceptedSlots: selected.length,
        rejectedSlots,
        startedAt,
        completedAt: new Date().toISOString(),
      },
      counts: {
        cases: selected.length,
        contexts: contextRecords.length,
        nonEmptyRequiredCases: selected.filter((item) => item.requiredCandidateKeys.length > 0).length,
        emptyRequiredCases: selected.filter((item) => item.requiredCandidateKeys.length === 0).length,
      },
      artifacts: { seeds: seedShards, contexts: contextShards, cases: caseShards },
      distributions: {
        batchSizes: distribution(selected.map((item) => String(item.batchSize))),
        categories: distribution(selected.map((item) => item.category ?? "uncategorized")),
        requiredKeyCardinality: distribution(selected.map((item) => String(item.requiredCandidateKeys.length))),
        repairCounts: distribution(selected.map((item) => String(item.provenance?.repairCount ?? 0))),
      },
    };
    ensureNoSecrets({ manifest, contextRecords, selected, seedsOutput });
    writeFileSync(path.join(publishStaging, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
    const verified = loadActionCompilationReferenceDataset(publishStaging);
    if (verified.cases.length !== options.target) throw new Error("post-generation case count verification failed");
    if (existsSync(options.output)) throw new Error(`benchmark output appeared while generating: ${options.output}`);
    renameSync(publishStaging, options.output);
    completed = true;
    process.stdout.write(`${JSON.stringify({ dataset: options.output, cases: selected.length, contexts: contextRecords.length, providerRequests }, null, 2)}\n`);
  } catch (error) {
    failureMessage = error instanceof Error ? error.message : String(error);
    throw error;
  } finally {
    if (ledger.execution(executionId)?.status === "running") {
      ledger.finishExecution(executionId, {
        status: completed ? "succeeded" : "failed",
        semanticHash: contentHash(captured.map((item) => item.case)),
      });
    }
    trace.flush();
    ledger.close();
    if (completed) {
      rmSync(staging, { recursive: true, force: true });
    } else {
      writeFileSync(path.join(staging, "failure.json"), `${JSON.stringify({
        schemaVersion: 1,
        datasetId: "action-compilation/fullcatalog-stabilized",
        targetCases: options.target,
        maxProviderRequests: options.maxProviderRequests,
        failure: failureMessage ?? "generation interrupted before completion",
        capturedCases: captured.length,
        providerRequests,
        generatedAt: new Date().toISOString(),
      }, null, 2)}\n`);
    }
  }
}

void main().catch((error) => {
  process.stderr.write(`benchmark generation failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
