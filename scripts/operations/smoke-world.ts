import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { z } from "zod";
import {
  DEFAULT_EAGER_REFERENCE_CONFIG,
  EagerReferenceAlgorithm,
} from "../../src/engine/algorithms/eager-reference/eager-reference";
import { loadModelCatalog } from "../../src/engine/models/model-catalog";
import { createModelGateway } from "../../src/engine/models/model-gateway";
import { ModelRegistry } from "../../src/engine/models/model-registry";
import { RecordingRuntimeObserver } from "../../src/engine/runtime/observability";
import { SimulationEngine } from "../../src/engine/runtime/simulation";
import { loadWorldScript } from "../../src/script/world-loader";
import { MemoryWorldRepository } from "../../src/script/world-repository";
import { LocalDatabase } from "../../src/server/local-database";
import { WorldHost } from "../../src/server/world-host";

type SmokeProfileSet = "glm" | "deepseek";

function profileSetArgument(argv: readonly string[]): SmokeProfileSet {
  const index = argv.indexOf("--profile-set");
  const value = index >= 0 ? argv[index + 1]?.trim() : undefined;
  if (value && value !== "glm" && value !== "deepseek") {
    throw new Error("profile set must be glm or deepseek");
  }
  return (value as SmokeProfileSet | undefined) ?? "glm";
}

function yamlFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) return yamlFiles(absolute);
    return entry.name.endsWith(".yaml") || entry.name.endsWith(".yml") ? [absolute] : [];
  });
}

function smokeWorldDirectory(root: string, profileSet: SmokeProfileSet): string {
  const source = path.resolve("worlds/blackmarsh/world");
  if (profileSet === "glm") return source;
  const copy = path.join(root, "world-deepseek");
  cpSync(source, copy, { recursive: true });
  for (const file of yamlFiles(copy)) {
    const contents = readFileSync(file, "utf8");
    writeFileSync(file, contents
      .replaceAll("truth-zhipu-coding", "truth-deepseek")
      .replaceAll("agent-zhipu-coding", "agent-deepseek"), "utf8");
  }
  return copy;
}

function failedAdvanceDiagnostic(database: LocalDatabase, instanceId: string): string {
  const document = database.readInstance(instanceId).document;
  const advance = Object.values(document.runs).at(-1);
  const execution = database.executions({ instanceId }).at(-1);
  const terminal = execution ? database.executionEvents(execution.id).at(-1) : undefined;
  return [
    advance?.error,
    terminal?.error?.message,
    ...(terminal?.error?.errors ?? []).map((error) => error.message),
  ].filter((value): value is string => Boolean(value)).join(" | ") || "no durable failure diagnostic";
}

function diagnosticLines(error: unknown, depth = 0): string[] {
  if (depth > 4) return ["cause depth limit reached"];
  if (error instanceof AggregateError) {
    return [
      `${error.name}: ${error.message}`,
      ...error.errors.slice(0, 8).flatMap((member, index) =>
        diagnosticLines(member, depth + 1).map((line) => `member[${index}]: ${line}`)),
    ];
  }
  if (error instanceof z.ZodError) {
    return error.issues.slice(0, 16).map((issue) =>
      `ZodError ${issue.path.join(".") || "<root>"} ${issue.code}`);
  }
  if (!(error instanceof Error)) return [`NonError: ${typeof error}`];
  const safeMessage = error.name === "ModelSemanticRepairError"
    ? "structured model output was rejected after repairs"
    : error.message;
  const lines = [`${error.name}: ${safeMessage}`];
  const cause = (error as Error & { cause?: unknown }).cause;
  if (cause !== undefined) lines.push(...diagnosticLines(cause, depth + 1).map((line) => `cause: ${line}`));
  return lines;
}

async function runBatchingSmoke(
  definition: ReturnType<typeof loadWorldScript>,
  provider: ReturnType<typeof createModelGateway>,
  profileSet: SmokeProfileSet,
): Promise<void> {
  const observer = new RecordingRuntimeObserver({ mode: "metrics" });
  const engine = new SimulationEngine(definition, new EagerReferenceAlgorithm(provider));
  const scope = (phase: string) => ({
    workloadId: `${profileSet}-batching-smoke:${definition.id}`,
    batchId: `${profileSet}-batching-smoke:${phase}`,
    correlation: { instanceId: `${profileSet}-batching-smoke`, revision: 0, step: phase === "bootstrap" ? 0 : 1 },
    observer,
  });
  await engine.bootstrapAgents(scope("bootstrap"));
  const state = engine.snapshot;
  const roster = Object.fromEntries(Object.values(state.agents).map((agent) => [agent.id, {
    kind: "model" as const,
    agentId: agent.id,
    profiles: structuredClone(agent.modelProfiles),
  }]));
  const preparation = await engine.prepareStep(roster, {
    expectedRevision: state.revision,
    trigger: "manual",
    externalActions: [],
  }, scope("prepare"));
  const batches = observer.events.filter((event) =>
    event.event === "algorithm.eager_reference.slot_batch_completed");
  const batch = (phase: string) => batches.find((event) => event.attributes?.phase === phase);
  const bootstrap = batch("agent-bootstrap");
  const compilation = batch("action-compilation");
  if (!bootstrap || !compilation) throw new Error("batching smoke did not emit both required batch metrics");
  if (bootstrap.counts?.logicalSlots !== Object.keys(state.agents).length ||
    bootstrap.counts?.configuredMaxSlots !== DEFAULT_EAGER_REFERENCE_CONFIG.agentMindMaxSlots ||
    bootstrap.counts?.singletonFailures !== 0) {
    throw new Error("AgentMind batching smoke metrics are invalid");
  }
  if (compilation.counts?.logicalSlots !== Object.keys(state.agents).length ||
    compilation.counts?.configuredMaxSlots !== DEFAULT_EAGER_REFERENCE_CONFIG.actionCompilationMaxSlots ||
    compilation.counts?.singletonFailures !== 0) {
    throw new Error("Action Compilation batching smoke metrics are invalid");
  }
  const invocationIds = [
    ...engine.bootstrapModelAudits,
    ...preparation.modelAudits,
  ].flatMap((audit) => audit.invocations.map((invocation) => invocation.id));
  if (new Set(invocationIds).size !== invocationIds.length) {
    throw new Error("batching smoke observed duplicate model invocation IDs");
  }
  process.stdout.write([
    `${profileSet.toUpperCase()} eager-reference batching smoke passed`,
    `world=${definition.id}`,
    `agents=${Object.keys(state.agents).length}`,
    `agentBootstrapCalls=${bootstrap.counts.physicalCalls}`,
    `agentBootstrapRepairs=${bootstrap.counts.repairCalls}`,
    `actionCompilationCalls=${compilation.counts.physicalCalls}`,
    `actionCompilationRepairs=${compilation.counts.repairCalls}`,
    `actionCompilationSplits=${compilation.counts.batchSplits}`,
  ].join(" ") + "\n");
}

async function main(): Promise<void> {
  const profileSet = profileSetArgument(process.argv.slice(2));
  const catalog = loadModelCatalog(path.resolve(process.env.LIVINGWORLD_MODEL_CATALOG_PATH ?? "config/models.yaml"));
  const root = mkdtempSync(path.join(tmpdir(), `lwe-${profileSet}-smoke-`));
  const registry = new ModelRegistry(catalog, root);
  const provider = createModelGateway(catalog, process.env, { registry });
  const definition = loadWorldScript(smokeWorldDirectory(root, profileSet), {
    seed: 20260827,
    modelCatalog: catalog,
  });
  if (process.argv.includes("--batching-only")) {
    try {
      await runBatchingSmoke(definition, provider, profileSet);
    } catch (error) {
      process.stderr.write(`${profileSet.toUpperCase()} eager-reference batching smoke failed:\n${diagnosticLines(error)
        .map((line) => `- ${line}`)
        .join("\n")}\n`);
      process.exitCode = 1;
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
    return;
  }
  const database = new LocalDatabase(path.join(root, "livingworld.sqlite"), { heartbeat: false });
  const host = new WorldHost({
    repository: new MemoryWorldRepository({ [definition.id]: definition }),
    store: database,
    ledger: database,
    provider,
    idFactory: randomUUID,
  });

  try {
    let headless = await host.createInstance({
      worldId: definition.id,
      seed: 20260827,
      title: `${profileSet.toUpperCase()} 无人烟测`,
      start: { kind: "observer" },
    });
    headless = await host.advance(headless.summary.id, {
      expectedRevision: headless.summary.revision,
      trigger: "manual",
      steps: 1,
    });
    if (headless.summary.revision < 1) {
      throw new Error(`headless step did not commit: ${failedAdvanceDiagnostic(database, headless.summary.id)}`);
    }
    const headlessRevision = headless.summary.revision;

    let instance = await host.createInstance({
      worldId: definition.id,
      seed: 20260827,
      title: `${profileSet.toUpperCase()} 角色烟测`,
      start: {
        kind: "origin",
        originId: "harbor-wayfarer",
        displayName: "远行者",
        appearance: "披着被海风打湿的深色斗篷。",
        motivation: "弄清自己身在何处，并寻找今晚可以落脚的地方。",
      },
    });
    const participant = instance.participants[0];
    if (!participant || !instance.conversation?.turns[0]?.response) {
      throw new Error("Origin admission did not persist the Arrival conversation");
    }
    const beforeAction = instance.summary.revision;
    instance = await host.submitAction(instance.summary.id, participant.id, {
      submissionId: randomUUID(),
      expectedRevision: instance.summary.revision,
      text: "我现在在哪里？我先观察周围的地标、人群和天气。",
    });
    if (instance.summary.revision <= beforeAction) {
      throw new Error(
        `participant action did not commit: ${failedAdvanceDiagnostic(database, instance.summary.id)}`,
      );
    }
    process.stdout.write([
      `${profileSet.toUpperCase()} eager-reference smoke passed`,
      `world=${definition.id}`,
      `agents=${Object.keys(database.readInstance(instance.summary.id).document.state.agents).length}`,
      `headlessRevision=${headlessRevision}`,
      `participantRevision=${instance.summary.revision}`,
      `executions=${database.executions({ instanceId: instance.summary.id }).length}`,
    ].join(" ") + "\n");
  } catch (error) {
    process.stderr.write(`${profileSet.toUpperCase()} eager-reference smoke failed:\n${diagnosticLines(error)
      .map((line) => `- ${line}`)
      .join("\n")}\n`);
    process.exitCode = 1;
  } finally {
    database.close();
    if (process.env.LIVINGWORLD_KEEP_SMOKE_DATA === "1") {
      process.stderr.write(`${profileSet.toUpperCase()} smoke data retained at ${root}\n`);
    } else {
      rmSync(root, { recursive: true, force: true });
    }
  }
}

void main();
