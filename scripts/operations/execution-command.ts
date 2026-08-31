import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { registerBuiltinAlgorithms } from "../../src/engine/algorithms/registry";
import { aggregateMetricPoints, deriveExecutionWork, EXECUTION_METRICS } from "../../src/engine/runtime/execution-metrics";
import {
  algorithmRef,
  resolutionObservations,
  BootstrapCandidate,
  PolicyBinding,
  type WorldExecutionAlgorithmRegistry,
  WorldAdvanceRequest,
  WorldStepCandidate,
} from "../../src/engine/runtime/execution";
import { ModelCatalog, type ModelCatalogDocument, type ModelRole } from "../../src/engine/models/model-catalog";
import type { ModelExecutionAudit, ModelInvocationAudit, SimulationState } from "../../src/engine/contracts/model";
import { contentHash } from "../../src/engine/models/model-audit";
import type { RuntimeEvent } from "../../src/engine/runtime/observability";
import { ModelOutputError, type StructuredModelProvider, type StructuredModelRequest, type StructuredModelResult } from
  "../../src/engine/models/model-provider";
import { SimulationEngine } from "../../src/engine/runtime/simulation";
import type { WorldDefinition } from "../../src/engine/runtime/world-definition";
import { LocalDatabase } from "../../src/server/local-database";
import { runtimeCodeIdentity } from "../../src/server/code-identity";

function argumentsFor(argv: readonly string[]): { executionIds: string[]; database: string; output?: string } {
  const executionIds: string[] = [];
  let database = path.resolve(process.env.LIVINGWORLD_DATA_ROOT ?? ".livingworld-v20", "livingworld.sqlite");
  let output: string | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--database") database = path.resolve(argv[++index] ?? "");
    else if (value === "--output") output = path.resolve(argv[++index] ?? "");
    else if (value.startsWith("--")) throw new Error(`unknown argument: ${value}`);
    else executionIds.push(value);
  }
  if (executionIds.length === 0) throw new Error("at least one execution id is required");
  return { executionIds, database, output };
}

function event(events: readonly RuntimeEvent[], name: string, phase?: string): RuntimeEvent {
  const found = events.find((candidate) => candidate.event === name &&
    (phase === undefined || candidate.attributes?.phase === phase));
  if (!found) throw new Error(`recorded execution is missing ${name}${phase ? ` (${phase})` : ""}`);
  return found;
}

interface RecordedOutput {
  event: RuntimeEvent;
  value: unknown;
  audit: ModelExecutionAudit;
}

function recordedCatalog(audits: readonly ModelExecutionAudit[]): ModelCatalog {
  const accounts: ModelCatalogDocument["accounts"] = {};
  const profiles: ModelCatalogDocument["profiles"] = {};
  for (const audit of audits) {
    accounts[audit.accountId] ??= {
      channel: audit.accountChannel,
      region: "replay",
      protocol: audit.protocol,
      dialect: audit.dialect,
      models_dev_provider_id: audit.providerId,
      base_url: "https://recorded.invalid",
      api_key_env: "RECORDED_REPLAY_API_KEY",
      max_concurrency: 1024,
    };
    const current = profiles[audit.profileId];
    const roles = new Set<ModelRole>(current?.allowed_roles ?? []);
    roles.add(audit.role);
    profiles[audit.profileId] = {
      account_id: audit.accountId,
      selector: { kind: "exact", model_id: audit.modelId },
      description: "Recorded execution replay",
      allowed_roles: [...roles],
      request_timeout_ms: 1_000,
      max_output_tokens: 1,
      max_input_bytes: 128 * 1024 * 1024,
      inference: structuredClone(audit.requestedInference),
    };
  }
  return new ModelCatalog({
    schema_version: 3,
    scheduler: { global_concurrency: 1024, max_queued_requests: 4096, queue_timeout_ms: 1_000 },
    registry: {
      refresh_interval_ms: 3_600_000,
      request_timeout_ms: 10_000,
      stale_after_ms: 86_400_000,
    },
    accounts,
    profiles,
    model_overrides: {},
  });
}

class RecordedModelProvider implements StructuredModelProvider {
  readonly catalog: ModelCatalog;
  private readonly outputs = new Map<string, RecordedOutput>();
  private readonly consumed = new Set<string>();

  constructor(events: readonly RuntimeEvent[], candidates: readonly (BootstrapCandidate | WorldStepCandidate)[]) {
    const audits = candidates.flatMap((candidate) => candidate.modelAudits);
    this.catalog = recordedCatalog(audits);
    const auditByInvocation = new Map<string, { audit: ModelExecutionAudit; invocation: ModelInvocationAudit }>();
    for (const audit of audits) {
      for (const invocation of audit.invocations) auditByInvocation.set(invocation.id, { audit, invocation });
    }
    for (const event of events) {
      if (event.event !== "model.structured_output.parsed" && event.event !== "model.structured_output.rejected") continue;
      const invocationId = event.correlation?.modelInvocationId;
      if (!invocationId || event.payload === undefined) continue;
      const recorded = auditByInvocation.get(invocationId);
      if (!recorded) continue;
      this.outputs.set(invocationId, {
        event,
        value: structuredClone(event.payload),
        audit: { ...structuredClone(recorded.audit), invocations: [structuredClone(recorded.invocation)] },
      });
    }
  }

  availableProfileSummaries(role?: ModelRole) {
    return this.catalog.profileSummaries(role);
  }

  async assertProfilesAvailable(profileIds: readonly string[]): Promise<void> {
    for (const profileId of profileIds) this.catalog.assertProfile(profileId);
  }

  async generateStructured<T>(request: StructuredModelRequest<T>): Promise<StructuredModelResult<T>> {
    const invocationId = request.modelInvocationId;
    if (!invocationId) throw new Error("recorded replay requires canonical model invocation identity");
    const output = this.outputs.get(invocationId);
    if (!output) throw new Error(`recorded model output not found: ${invocationId}`);
    if (this.consumed.has(invocationId)) throw new Error(`recorded model output was consumed twice: ${invocationId}`);
    if (output.audit.role !== request.role || output.audit.subjectId !== request.subjectId ||
      output.audit.profileId !== request.profileId) {
      throw new Error(`recorded model output identity mismatch: ${invocationId}`);
    }
    this.consumed.add(invocationId);
    request.observer?.emit({
      event: "model.replay_output.consumed",
      correlation: { ...request.correlation, modelInvocationId: invocationId },
      links: output.event.traceId && output.event.spanId
        ? [{ traceId: output.event.traceId, spanId: output.event.spanId }]
        : [],
      hashes: { response: output.audit.invocations[0].responseHash ?? contentHash(output.value) },
      payload: output.value,
    });
    const parsed = request.schema.safeParse(output.value);
    if (!parsed.success) throw new ModelOutputError(parsed.error.message, output.audit);
    return { value: parsed.data, audit: structuredClone(output.audit) };
  }

  assertFullyConsumed(): void {
    const missing = [...this.outputs.keys()].filter((id) => !this.consumed.has(id));
    if (missing.length > 0) throw new Error(`recorded replay left ${missing.length} model outputs unused`);
  }
}

export async function replayThroughAlgorithm(
  database: LocalDatabase,
  original: NonNullable<ReturnType<LocalDatabase["execution"]>>,
  events: readonly RuntimeEvent[],
  algorithmRegistry?: WorldExecutionAlgorithmRegistry,
): Promise<{
  replayExecutionId: string;
  semanticHash: string;
  stateHash: string;
  revision: number;
}> {
  if (original.manifest.kind !== "algorithm") {
    throw new Error(`recorded replay requires an algorithm producer; found ${original.manifest.kind}`);
  }
  const definitionEvent = event(events, "execution.world_definition.persisted");
  const definition = definitionEvent.payload as WorldDefinition;
  const stepInputs = events.filter((candidate) => candidate.event === "step.started")
    .map((candidate) => candidate.payload as {
      state: SimulationState;
      policyRoster: Record<string, PolicyBinding>;
      request: WorldAdvanceRequest;
    });
  const candidateEvents = events.filter((candidate) => candidate.event === "execution.candidate.persisted");
  const candidates = candidateEvents
    .filter((candidate) => candidate.attributes?.phase === (stepInputs.length > 0 ? "step" : "bootstrap"))
    .map((candidate) => candidate.payload as BootstrapCandidate | WorldStepCandidate);
  const provider = new RecordedModelProvider(events, candidates);
  const registry = registerBuiltinAlgorithms(algorithmRegistry);
  const recordedRef = algorithmRef(original.manifest);
  const createAlgorithm = () => registry.create(recordedRef, {
    provider,
    rulePackages: database.rulePackages,
  });
  const code = runtimeCodeIdentity();
  const replayExecutionId = randomUUID();
  const trace = database.beginExecution({
    id: replayExecutionId,
    kind: "replay",
    parentExecutionId: original.id,
    instanceId: original.instanceId,
    advanceId: original.advanceId,
    step: original.step,
    manifest: original.manifest,
    worldHash: original.worldHash,
    codeRevision: code.revision,
    codeDirty: code.dirty,
    modelCatalogHash: original.modelCatalogHash,
    seed: original.seed,
    runtimeConfig: { sourceExecutionId: original.id, recordedModelOutputs: true, networkAccessed: false },
  });
  try {
    const semanticHashes: string[] = [];
    let finalState: SimulationState | undefined;
    if (stepInputs.length > 0) {
      for (const [index, input] of stepInputs.entries()) {
        const engine = new SimulationEngine(definition, createAlgorithm(), input.state);
        const result = await engine.step(input.policyRoster, input.request, {
          workloadId: `replay:${original.id}`,
          batchId: `replay:${original.id}:${index + 1}`,
          correlation: {
            executionId: replayExecutionId,
            instanceId: original.instanceId,
            advanceId: original.advanceId,
            revision: input.state.revision,
            step: input.state.step + 1,
          },
          observer: trace,
        });
        semanticHashes.push(result.committed.semanticHash);
        finalState = result.state;
      }
    } else {
      const source = (event(events, "instance.bootstrap.started").payload as { state: SimulationState }).state;
      const engine = new SimulationEngine(definition, createAlgorithm(), source);
      finalState = await engine.bootstrapAgents({
        workloadId: `replay:${original.id}`,
        batchId: `replay:${original.id}:bootstrap`,
        correlation: { executionId: replayExecutionId, revision: source.revision, step: source.step },
        observer: trace,
      });
    }
    if (!finalState) throw new Error("recorded replay produced no state");
    provider.assertFullyConsumed();
    const semanticHash = semanticHashes.length > 0
      ? original.kind === "benchmark" ? contentHash(semanticHashes) : semanticHashes.at(-1)!
      : contentHash({ bootstrapAgentCommits: finalState.bootstrapAgentCommits });
    const stateHash = contentHash(finalState);
    database.finishExecution(replayExecutionId, {
      status: "succeeded",
      semanticHash,
      stateHash,
      commitRevision: finalState.revision,
    });
    return { replayExecutionId, semanticHash, stateHash, revision: finalState.revision };
  } catch (error) {
    if (database.execution(replayExecutionId)?.status === "running") {
      database.finishExecution(replayExecutionId, { status: "failed", error });
    }
    throw error;
  }
}

export function candidatePartitions(events: readonly RuntimeEvent[]) {
  const recorded = events.filter((candidate) => candidate.event === "execution.candidate.persisted");
  const selected = recorded.findLast((candidate) => candidate.attributes?.phase === "step") ?? recorded.at(-1);
  if (!selected) throw new Error("recorded execution is missing execution.candidate.persisted");
  const candidate = selected.payload as WorldStepCandidate | BootstrapCandidate;
  if (!("resolution" in candidate)) {
    return { bootstrap: candidate.agentCommits };
  }
  return {
    resolution: {
      plans: candidate.resolution.resolutionPlans,
      receipts: candidate.resolution.resolutionReceipts,
      checkRequests: candidate.resolution.requests,
      checks: candidate.resolution.checks,
      randomRequests: candidate.resolution.randomRequests,
      randomResults: candidate.resolution.randomResults,
      mechanicInvocations: candidate.resolution.proposal.mechanicInvocations,
      mechanicResults: candidate.resolution.mechanicResults,
      causalAssertionResults: candidate.resolution.causalAssertionResults,
      causalVerification: candidate.resolution.causalVerification,
    },
    temporal: {
      plans: candidate.temporalPlans,
      boundary: candidate.temporalBoundary,
      state: candidate.temporalState,
      activityTransitions: candidate.activityTransitions,
      decisionPoints: candidate.decisionPoints,
    },
    transition: {
      actions: candidate.resolution.actions,
      outcomes: candidate.resolution.proposal.outcomes,
      operations: candidate.resolution.proposal.operations,
      events: candidate.resolution.proposal.events,
    },
    observation: resolutionObservations(candidate.resolution),
    mind: candidate.mindCommits,
  };
}

function comparePartitions(left: ReturnType<typeof candidatePartitions>, right: ReturnType<typeof candidatePartitions>) {
  const names = [...new Set([...Object.keys(left), ...Object.keys(right)])].sort();
  return Object.fromEntries(names.map((name) => {
    const leftValue = left[name as keyof typeof left] ?? null;
    const rightValue = right[name as keyof typeof right] ?? null;
    return [name, {
      equal: contentHash(leftValue) === contentHash(rightValue),
      leftHash: contentHash(leftValue),
      rightHash: contentHash(rightValue),
      ...(contentHash(leftValue) === contentHash(rightValue) ? {} : { left: leftValue, right: rightValue }),
    }];
  }));
}

async function main(): Promise<void> {
  const command = process.argv[2];
  const parsed = argumentsFor(process.argv.slice(3));
  const database = new LocalDatabase(parsed.database);
  try {
    if (command === "replay") {
      if (parsed.executionIds.length !== 1) throw new Error("replay accepts exactly one execution id");
      const execution = database.execution(parsed.executionIds[0]);
      if (!execution) throw new Error(`execution not found: ${parsed.executionIds[0]}`);
      const events = database.executionEvents(execution.id);
      const result = await replayThroughAlgorithm(database, execution, events);
      const output = {
        executionId: execution.id,
        recordedSemanticHash: execution.semanticHash,
        recordedStateHash: execution.stateHash,
        ...result,
        semanticMatch: execution.semanticHash === result.semanticHash,
        stateMatch: execution.stateHash === result.stateHash,
        networkAccessed: false,
      };
      process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
      if (!output.semanticMatch || !output.stateMatch) process.exitCode = 2;
      return;
    }
    if (command === "compare") {
      if (parsed.executionIds.length !== 2) throw new Error("compare requires exactly two execution ids");
      const [leftId, rightId] = parsed.executionIds;
      const left = database.execution(leftId);
      const right = database.execution(rightId);
      if (!left || !right) throw new Error("one or both executions do not exist");
      process.stdout.write(`${JSON.stringify({
        left: { id: left.id, semanticHash: left.semanticHash },
        right: { id: right.id, semanticHash: right.semanticHash },
        semanticEqual: left.semanticHash === right.semanticHash,
        partitions: comparePartitions(
          candidatePartitions(database.executionEvents(left.id)),
          candidatePartitions(database.executionEvents(right.id)),
        ),
      }, null, 2)}\n`);
      return;
    }
    if (command === "export") {
      if (parsed.executionIds.length !== 1) throw new Error("export accepts exactly one execution id");
      const execution = database.execution(parsed.executionIds[0]);
      if (!execution) throw new Error(`execution not found: ${parsed.executionIds[0]}`);
      const events = database.executionEvents(execution.id);
      const artifactHashes = [...new Set(events.flatMap((candidate) =>
        candidate.payload === undefined ? [] : [contentHash(candidate.payload)]))];
      const output = {
        schemaVersion: 1,
        execution,
        events,
        artifacts: artifactHashes.map((hash) => {
          const artifact = database.artifact(hash);
          if (!artifact) throw new Error(`execution artifact is missing: ${hash}`);
          return {
            hash: artifact.hash,
            executionId: artifact.executionId,
            kind: artifact.kind,
            mediaType: artifact.mediaType,
            encoding: artifact.encoding,
            rawBytes: artifact.rawBytes,
            storedBytes: artifact.storedBytes,
            createdAt: artifact.createdAt,
          };
        }),
        metrics: aggregateMetricPoints(EXECUTION_METRICS.derive(events)),
        work: deriveExecutionWork(events),
      };
      const serialized = `${JSON.stringify(output, null, 2)}\n`;
      if (parsed.output) writeFileSync(parsed.output, serialized, "utf8");
      else process.stdout.write(serialized);
      return;
    }
    throw new Error(`unknown execution command: ${command}`);
  } finally {
    database.close();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void main().catch((error) => {
    process.stderr.write(`execution command failed: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
