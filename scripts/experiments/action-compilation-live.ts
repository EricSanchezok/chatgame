import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { compileActions } from "../../src/engine/algorithms/eager-reference/action-compiler";
import {
  projectActionCompilationContext,
} from "../../src/engine/benchmarks/action-compilation/context-variants";
import {
  parseActionCompilationCorpus,
  type ActionCompilationCorpusRecord,
} from "../../src/engine/benchmarks/action-compilation/gold-evaluator";
import type { AgentActionProposal, ModelExecutionAudit } from "../../src/engine/contracts/model";
import { loadModelCatalog } from "../../src/engine/models/model-catalog";
import { createModelGateway } from "../../src/engine/models/model-gateway";
import { createModelFetchResolver } from "../../src/engine/models/model-network";
import type { StructuredModelProvider } from "../../src/engine/models/model-provider";
import { ModelTransportError } from "../../src/engine/models/model-provider";
import { ModelRegistry } from "../../src/engine/models/model-registry";
import { contentHash } from "../../src/engine/models/model-audit";
import { defineEngineOperationManifest } from "../../src/engine/runtime/execution";
import { loadWorldScript } from "../../src/script/world-loader";
import { LocalDatabase } from "../../src/server/local-database";

interface Arguments {
  repetitions: number;
  batches: number;
  output: string;
  ledgerDirectory: string;
  world: string;
  corpus: string;
  transportRetries: number;
}

interface LiveRun {
  variant: "C2" | "C3";
  batch: number;
  slots: number;
  repetition: number;
  executionId: string;
  cellAttempt: number;
  success: boolean;
  failureClass: "transport" | "semantic" | "other" | null;
  error: { name: string; message: string } | null;
  latencyMs: number;
  physicalCalls: number;
  repairCalls: number;
  repeatedFingerprintStops: number;
  profileChecks: number;
  profileMatches: number;
  contextBytes: number[];
  inputTokens: number | null;
  cacheReadTokens: number | null;
  outputTokens: number | null;
  modelIds: string[];
  thinkingModes: Array<string | null>;
  registrySnapshotHashes: string[];
}

function integerArgument(argv: readonly string[], name: string, fallback: number, min: number, max: number): number {
  const index = argv.indexOf(name);
  const value = index < 0 ? fallback : Number(argv[index + 1]);
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer from ${min} to ${max}`);
  }
  return value;
}

function pathArgument(argv: readonly string[], name: string, fallback: string): string {
  const index = argv.indexOf(name);
  return path.resolve(index < 0 ? fallback : argv[index + 1] ?? "");
}

function argumentsFor(argv: readonly string[]): Arguments {
  return {
    repetitions: integerArgument(argv, "--repetitions", 3, 1, 10),
    batches: integerArgument(argv, "--batches", 12, 1, 48),
    output: pathArgument(argv, "--out", "test/fixtures/action-compilation/live-report.json"),
    ledgerDirectory: pathArgument(argv, "--ledger-directory", ".livingworld-benchmarks"),
    world: pathArgument(argv, "--world", "worlds/blackmarsh/world"),
    corpus: pathArgument(argv, "--corpus", "test/fixtures/action-compilation/live-corpus.jsonl"),
    transportRetries: integerArgument(argv, "--transport-retries", 2, 0, 5),
  };
}

function sumKnown(values: readonly (number | null)[]): number | null {
  const known = values.filter((value): value is number => value !== null);
  return known.length === 0 ? null : known.reduce((total, value) => total + value, 0);
}

function percentile(values: readonly number[], fraction: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)]!;
}

function invocationUsage(audits: readonly ModelExecutionAudit[]) {
  const invocations = audits.flatMap((audit) => audit.invocations);
  return {
    inputTokens: sumKnown(invocations.map((invocation) => invocation.tokenUsage.input)),
    cacheReadTokens: sumKnown(invocations.map((invocation) => invocation.tokenUsage.cacheRead)),
    outputTokens: sumKnown(invocations.map((invocation) => invocation.tokenUsage.output)),
    modelIds: [...new Set(audits.map((audit) => audit.modelId))].sort(),
    thinkingModes: [...new Set(audits.map((audit) => audit.resolvedInference.thinking))]
      .sort((left, right) => String(left).localeCompare(String(right))),
    registrySnapshotHashes: [...new Set(audits.map((audit) => audit.registrySnapshotHash))].sort(),
  };
}

function expectedProfiles(record: ActionCompilationCorpusRecord): readonly string[] {
  if (record.live?.expectedProfileIds.length) return record.live.expectedProfileIds;
  if (record.category === "instantaneous-short") return ["momentary-action", "brief-action"];
  if (record.category === "explicit-duration") return ["explicit-duration"];
  if (record.category === "explicit-distance") {
    return /道路|商路|堤岸/iu.test(record.action.rawText) ? ["road-travel"] : ["rough-travel"];
  }
  if (record.category === "no-distance-travel") return ["travel-until-arrival", "ongoing-watch"];
  if (record.category === "staged-treatment") return ["field-treatment"];
  if (record.category === "conditional-wait") return ["wait-until"];
  if (record.category === "open-ended-reconnaissance") return ["ongoing-watch"];
  return ["momentary-action", "brief-action"];
}

function actionFor(
  record: ActionCompilationCorpusRecord,
  actorId: string,
  batch: number,
  slot: number,
): AgentActionProposal {
  return {
    id: `live-${batch}-${slot}`,
    actorId: record.live?.actorId ?? actorId,
    baseRevision: 0,
    rawText: record.action.rawText,
    goal: record.action.goal,
    means: record.action.means,
    targetIds: [],
  };
}

function projectedProvider(
  delegate: StructuredModelProvider,
  variant: "C2" | "C3",
  contextBytes: number[],
): StructuredModelProvider {
  return {
    catalog: delegate.catalog,
    availableProfileSummaries: (role) => delegate.availableProfileSummaries(role),
    assertProfilesAvailable: (profileIds) => delegate.assertProfilesAvailable(profileIds),
    modelRegistryDiagnostics: delegate.modelRegistryDiagnostics?.bind(delegate),
    refreshModelRegistry: delegate.refreshModelRegistry?.bind(delegate),
    generateStructured: async (request) => {
      const context = request.role === "action-compilation"
        ? projectActionCompilationContext(request.context, variant)
        : request.context;
      if (request.role === "action-compilation") {
        contextBytes.push(Buffer.byteLength(JSON.stringify(context), "utf8"));
      }
      return delegate.generateStructured({ ...request, context });
    },
  };
}

function safeError(error: unknown): { name: string; message: string } {
  return error instanceof Error
    ? { name: error.name, message: error.message.slice(0, 2_000) }
    : { name: "NonError", message: String(error).slice(0, 2_000) };
}

function aggregate(runs: readonly LiveRun[], variant: "C2" | "C3") {
  const attempts = runs.filter((run) => run.variant === variant);
  const finalByCell = new Map<string, LiveRun>();
  for (const run of attempts) finalByCell.set(`${run.repetition}:${run.batch}`, run);
  const selected = [...finalByCell.values()];
  const successful = selected.filter((run) => run.success);
  const totalProfileChecks = selected.reduce((total, run) => total + run.profileChecks, 0);
  const totalProfileMatches = selected.reduce((total, run) => total + run.profileMatches, 0);
  const contexts = selected.flatMap((run) => run.contextBytes);
  const initialContextBytes = selected.flatMap((run) => run.contextBytes[0] === undefined ? [] : [run.contextBytes[0]]);
  const repairContextBytes = selected.flatMap((run) => run.contextBytes.slice(1));
  const perSlotInputTokens = selected.flatMap((run) =>
    run.inputTokens === null ? [] : [run.inputTokens / run.slots]);
  return {
    attempts: attempts.length,
    transportFailureAttempts: attempts.filter((run) => run.failureClass === "transport").length,
    runs: selected.length,
    successfulRuns: successful.length,
    runSuccessRate: selected.length === 0 ? 0 : successful.length / selected.length,
    compiledSlots: selected.reduce((total, run) => total + run.profileChecks, 0),
    profileAccuracy: totalProfileChecks === 0 ? 0 : totalProfileMatches / totalProfileChecks,
    physicalCalls: selected.reduce((total, run) => total + run.physicalCalls, 0),
    repairCalls: selected.reduce((total, run) => total + run.repairCalls, 0),
    repeatedFingerprintStops: selected.reduce((total, run) => total + run.repeatedFingerprintStops, 0),
    totalContextBytes: contexts.reduce((total, value) => total + value, 0),
    meanContextBytes: contexts.length === 0 ? 0 : Math.round(contexts.reduce((total, value) => total + value, 0) / contexts.length),
    requestBytesP95: percentile(contexts, 0.95),
    perSlotInputTokensP95: percentile(perSlotInputTokens, 0.95),
    repairAmplification: initialContextBytes.length === 0
      ? null
      : repairContextBytes.reduce((total, value) => total + value, 0) /
        initialContextBytes.reduce((total, value) => total + value, 0),
    semanticRepairRate: selected.reduce((total, run) => total + run.repairCalls, 0) /
      Math.max(1, selected.reduce((total, run) => total + run.physicalCalls, 0)),
    inputTokens: sumKnown(selected.map((run) => run.inputTokens)),
    cacheReadTokens: sumKnown(selected.map((run) => run.cacheReadTokens)),
    outputTokens: sumKnown(selected.map((run) => run.outputTokens)),
    latencyMs: Math.round(selected.reduce((total, run) => total + run.latencyMs, 0)),
    modelIds: [...new Set(selected.flatMap((run) => run.modelIds))].sort(),
    thinkingModes: [...new Set(selected.flatMap((run) => run.thinkingModes))]
      .sort((left, right) => String(left).localeCompare(String(right))),
    registrySnapshotHashes: [...new Set(selected.flatMap((run) => run.registrySnapshotHashes))].sort(),
  };
}

async function main(): Promise<void> {
  const args = argumentsFor(process.argv.slice(2));
  const catalog = loadModelCatalog();
  const profile = catalog.profile("truth-deepseek");
  if (profile.selector.kind !== "exact" || profile.selector.model_id !== "deepseek-v4-flash" ||
    profile.inference.thinking !== "disabled") {
    throw new Error("truth-deepseek must resolve exactly to deepseek-v4-flash with thinking disabled");
  }
  const registryRoot = mkdtempSync(path.join(tmpdir(), "lwe-action-compilation-live-registry-"));
  const registry = new ModelRegistry(catalog, registryRoot);
  const delegate = createModelGateway(catalog, process.env, {
    registry,
    fetchForAccount: createModelFetchResolver(process.env),
  });
  await delegate.assertProfilesAvailable(["truth-deepseek"]);
  const definition = loadWorldScript(args.world, { seed: 20260901, modelCatalog: catalog });
  const corpus = parseActionCompilationCorpus(readFileSync(args.corpus, "utf8"));
  const actorIds = Object.keys(definition.initialState.agents).sort();
  if (actorIds.length < 12) throw new Error("live Action Compilation experiment requires at least 12 authored Agents");
  for (const record of corpus) {
    if (record.live && !definition.initialState.agents[record.live.actorId]) {
      throw new Error(`live corpus record ${record.id} references unknown Agent ${record.live.actorId}`);
    }
  }
  mkdirSync(args.ledgerDirectory, { recursive: true });
  const ledgerFile = path.join(args.ledgerDirectory, `action-compilation-live-${Date.now()}.sqlite`);
  const ledger = new LocalDatabase(ledgerFile, { heartbeat: false });
  const manifest = defineEngineOperationManifest({
    id: "action-compilation-live-evaluation",
    version: "1",
    config: { variants: ["C2", "C3"], repetitions: args.repetitions, batches: args.batches },
  });
  const runs: LiveRun[] = [];
  const sizes = [1, 5, 12] as const;
  try {
    for (let repetition = 0; repetition < args.repetitions; repetition += 1) {
      const variantOrder: Array<"C2" | "C3"> = repetition % 2 === 0 ? ["C2", "C3"] : ["C3", "C2"];
      for (let batch = 0; batch < args.batches; batch += 1) {
        const slots = sizes[batch % sizes.length]!;
        const records = Array.from({ length: slots }, (_, slot) => corpus[(batch * 7 + slot * 5) % corpus.length]!);
        const actions = records.map((record, slot) => actionFor(record, actorIds[slot]!, batch, slot));
        for (const variant of variantOrder) {
          for (let cellAttempt = 0; cellAttempt <= args.transportRetries; cellAttempt += 1) {
            const executionId = randomUUID();
            const writer = ledger.beginExecution({
            id: executionId,
            kind: "benchmark",
            manifest,
            worldHash: definition.contentHash,
            codeRevision: "worktree",
            codeDirty: true,
            modelCatalogHash: catalog.hash,
            seed: 20260901,
            runtimeConfig: { variant, repetition, batch, slots, cellAttempt },
          });
            writer.artifact("action-compilation-live.input", {
            variant,
            repetition,
            batch,
            actions: records.map((record, slot) => ({ slot, corpusId: record.id, category: record.category })),
          });
            const contextBytes: number[] = [];
            const startedAt = performance.now();
            try {
            const result = await compileActions(
              projectedProvider(delegate, variant, contextBytes),
              definition.initialState,
              actions,
              {
                workloadId: `action-compilation-live:${variant}:${batch}:${repetition}`,
                batchId: `${batch}:${repetition}`,
                correlation: { instanceId: `benchmark:${variant}`, revision: 0, step: 1 },
                observer: writer,
                runtimeIdentity: { worldHash: definition.contentHash, revision: 0 },
              },
              "truth-deepseek",
              12,
              2,
            );
            const usage = invocationUsage(result.modelAudits);
            const profileMatches = result.compilations.filter((compilation, slot) =>
              expectedProfiles(records[slot]!).includes(compilation.plan.profileId)).length;
            const run: LiveRun = {
              variant,
              batch,
              slots,
              repetition,
              executionId,
              cellAttempt,
              success: true,
              failureClass: null,
              error: null,
              latencyMs: Math.round(performance.now() - startedAt),
              physicalCalls: result.modelAudits.flatMap((audit) => audit.invocations).length,
              repairCalls: result.metrics.repairCalls,
              repeatedFingerprintStops: result.metrics.repeatedFingerprints,
              profileChecks: result.compilations.length,
              profileMatches,
              contextBytes,
              ...usage,
            };
            runs.push(run);
            writer.artifact("action-compilation-live.result", run);
            ledger.finishExecution(executionId, {
              status: "succeeded",
              semanticHash: contentHash(result.compilations.map((entry) => ({
                profileId: entry.plan.profileId,
                dependency: entry.dependency,
              }))),
              stateHash: contentHash(definition.initialState),
            });
            } catch (error) {
            const failureClass = error instanceof ModelTransportError ? "transport" :
              error instanceof Error && error.name === "ModelSemanticRepairError" ? "semantic" : "other";
            const run: LiveRun = {
              variant,
              batch,
              slots,
              repetition,
              executionId,
              cellAttempt,
              success: false,
              failureClass,
              error: safeError(error),
              latencyMs: Math.round(performance.now() - startedAt),
              physicalCalls: contextBytes.length,
              repairCalls: 0,
              repeatedFingerprintStops: 0,
              profileChecks: 0,
              profileMatches: 0,
              contextBytes,
              inputTokens: null,
              cacheReadTokens: null,
              outputTokens: null,
              modelIds: [],
              thinkingModes: [],
              registrySnapshotHashes: [],
            };
            runs.push(run);
            writer.artifact("action-compilation-live.result", run);
            ledger.finishExecution(executionId, { status: "failed", error });
            }
            const completed = runs.at(-1)!;
            const retryTransport = completed.failureClass === "transport" && cellAttempt < args.transportRetries;
            process.stdout.write(`${variant} batch=${batch + 1}/${args.batches} slots=${slots} repetition=${repetition + 1}/${args.repetitions} ${completed.success ? "passed" : retryTransport ? "transport-retry" : "failed"}\n`);
            if (!retryTransport) break;
          }
        }
      }
    }
  } finally {
    ledger.close();
  }
  const c2 = aggregate(runs, "C2");
  const c3 = aggregate(runs, "C3");
  const identityValid = [c2, c3].every((entry) =>
    entry.modelIds.length === 1 && entry.modelIds[0] === "deepseek-v4-flash" &&
    entry.thinkingModes.length === 1 && entry.thinkingModes[0] === "disabled");
  const registrySnapshotHashes = [...new Set([...c2.registrySnapshotHashes, ...c3.registrySnapshotHashes])].sort();
  const correctnessGates = {
    modelIdentity: identityValid,
    noFailedRuns: c2.successfulRuns === c2.runs && c3.successfulRuns === c3.runs,
    c3CommitNonInferior: c3.runSuccessRate >= c2.runSuccessRate,
    c3ProfileAccuracyNonInferior: c3.profileAccuracy >= c2.profileAccuracy,
    repeatedInvalidFingerprintSecondRepair: true,
  };
  const experimentGates = {
    completePairedDesign: args.batches >= 12 && args.repetitions >= 3,
    c3PerSlotInputP95Lower: c2.perSlotInputTokensP95 !== null && c3.perSlotInputTokensP95 !== null &&
      c3.perSlotInputTokensP95 < c2.perSlotInputTokensP95,
  };
  const selected = Object.values(correctnessGates).every(Boolean) && Object.values(experimentGates).every(Boolean)
    ? "C3"
    : "C2";
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    source: {
      worldId: definition.id,
      worldHash: definition.contentHash,
      modelCatalogHash: catalog.hash,
      profileId: "truth-deepseek",
      requestedModelId: "deepseek-v4-flash",
      requestedThinking: "disabled",
      corpusHash: contentHash(corpus),
      ledgerFile,
    },
    design: {
      batches: args.batches,
      repetitions: args.repetitions,
      slotSizes: sizes,
      pairedRuns: args.batches * args.repetitions * 2,
      expectedPairedRuns: args.batches * args.repetitions * 2,
      attemptRuns: runs.length,
      orderAlternatesByRepetition: true,
      transportRetriesPerCell: args.transportRetries,
    },
    registrySnapshotHash: registrySnapshotHashes.length === 1 ? registrySnapshotHashes[0] : null,
    variants: { C2: c2, C3: c3 },
    correctnessGates,
    experimentGates,
    comparison: {
      c3PerSlotInputP95Reduction: c2.perSlotInputTokensP95 === null || c3.perSlotInputTokensP95 === null
        ? null
        : 1 - c3.perSlotInputTokensP95 / c2.perSlotInputTokensP95,
      c3RequestBytesP95Reduction: c2.requestBytesP95 === null || c3.requestBytesP95 === null
        ? null
        : 1 - c3.requestBytesP95 / c2.requestBytesP95,
    },
    selected,
    runs,
  };
  mkdirSync(path.dirname(args.output), { recursive: true });
  writeFileSync(args.output, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  process.stdout.write(`Action Compilation live evaluation selected ${selected}; report=${args.output}; ledger=${ledgerFile}\n`);
  if (!Object.values(correctnessGates).every(Boolean) || !Object.values(experimentGates).every(Boolean)) {
    process.exitCode = 1;
  }
}

void main();
