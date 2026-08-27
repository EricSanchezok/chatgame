import { randomUUID } from "node:crypto";
import path from "node:path";
import { EagerReferenceAlgorithm, EAGER_REFERENCE_MANIFEST } from "../src/engine/eager-reference";
import { historyReplayBaseHash } from "../src/engine/history-replay";
import type { ModelProviderAdapter } from "../src/engine/model-adapter";
import type { ModelCatalog } from "../src/engine/model-catalog";
import { ModelGateway } from "../src/engine/model-gateway";
import type { AgentState, ModelExecutionAudit, ModelInvocationAudit } from "../src/engine/model";
import { contentHash } from "../src/engine/model-audit";
import { summarizeModelExecutionAudit } from "../src/engine/model-provider";
import {
  RecordingRuntimeObserver,
  type RuntimeEvent,
  type RuntimeEventInput,
  type RuntimeObserver,
} from "../src/engine/observability";
import { SimulationEngine } from "../src/engine/simulation";
import { createTestModelCatalog, deterministicModelOutput } from "../src/engine/testing/model-provider";
import type { WorldDefinition } from "../src/engine/world-definition";
import { loadWorldScript } from "../src/script/world-loader";
import { runtimeCodeIdentity } from "../src/server/code-identity";
import type { ExecutionLedger } from "../src/server/execution-ledger";

export interface ExperimentOptions {
  agents: number[];
  steps: number[];
  write?: (record: ExperimentRecord) => void;
  ledger?: ExecutionLedger;
  parentExecutionId?: string;
}

export interface ExperimentRecord {
  schemaVersion: 2;
  sequence: number;
  event: string;
  [key: string]: unknown;
}

export interface ExperimentResult {
  records: ExperimentRecord[];
  scenarios: Array<{
    agents: number;
    steps: number;
    cumulativeInputBytes: number;
    modelInvocations: number;
    instanceDocumentBytes: number;
    ledgerEventCount: number;
    ledgerArtifactRawBytes: number;
    ledgerArtifactStoredBytes: number;
    ledgerSqliteWriteMs: number;
  }>;
}

const deterministicAdapter: ModelProviderAdapter = {
  kind: "deepseek",
  structuredOutputMode: "deterministic-test",
  async generate(profile, request, contextJson) {
    const context = JSON.parse(contextJson);
    let value: unknown;
    if (request.role === "causal-verifier") value = { verdict: "accept", findings: [] };
    else if (request.role === "truth-perception") value = { kind: "done" };
    else if (request.role === "truth-resolution") value = deterministicModelOutput(request.profileId, context);
    else if (request.role === "truth-reaction-routing") value = { requests: [] };
    else if (request.role === "truth-transition") {
      const generated = deterministicModelOutput(request.profileId, context) as { kind: "transition"; proposal: unknown };
      value = generated.proposal;
    } else value = deterministicModelOutput(request.profileId, context);
    return {
      value,
      responseId: request.modelInvocationId ?? "experiment-model-invocation",
      responseModelId: profile.model,
      finishReason: "stop",
      tokenUsage: { input: null, output: null, reasoning: null, cacheRead: null, cacheWrite: null },
    };
  },
};

class ExperimentObserver implements RuntimeObserver {
  readonly mode = "full" as const;
  readonly degraded = false;
  readonly critical = true;

  constructor(
    private readonly durable: RuntimeObserver,
    private readonly recording: RecordingRuntimeObserver,
  ) {}

  emit(input: RuntimeEventInput): RuntimeEvent | undefined {
    const persisted = this.durable.emit(input);
    this.recording.emit(input);
    return persisted;
  }

  flush(): void {
    this.durable.flush?.();
  }
}

function experimentCredentials(catalog: ModelCatalog): Record<string, string> {
  return Object.fromEntries(Object.values(catalog.providers).map((provider) => [
    provider.api_key_env,
    "deterministic-experiment-boundary",
  ]));
}

function positiveMatrix(values: readonly number[], label: string): number[] {
  const unique = [...new Set(values)];
  if (unique.length === 0 || unique.some((value) => !Number.isSafeInteger(value) || value <= 0)) {
    throw new Error(`${label} must contain positive safe integers`);
  }
  return unique.sort((left, right) => left - right);
}

export function parseExperimentMatrix(
  argv: readonly string[],
  defaults: { agents: number[]; steps: number[] } = { agents: [1, 10, 50], steps: [1, 10, 100] },
): { agents: number[]; steps: number[] } {
  const values: { agents?: string; steps?: string } = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const match = /^--(agents|steps)(?:=(.*))?$/.exec(argument);
    if (!match) throw new Error(`unknown experiment argument: ${argument}`);
    const key = match[1] as "agents" | "steps";
    if (values[key] !== undefined) throw new Error(`duplicate experiment argument: --${key}`);
    const value = match[2] ?? argv[++index];
    if (!value || value.startsWith("--")) throw new Error(`--${key} requires a comma-separated value`);
    values[key] = value;
  }
  const parse = (raw: string | undefined, fallback: number[], label: string): number[] =>
    positiveMatrix(raw === undefined ? fallback : raw.split(",").map(Number), label);
  return {
    agents: parse(values.agents, defaults.agents, "agents"),
    steps: parse(values.steps, defaults.steps, "steps"),
  };
}

function scaledDefinition(base: WorldDefinition, agentCount: number): WorldDefinition {
  const definition = structuredClone(base);
  definition.participation = null;
  const template = Object.values(definition.initialState.agents)[0];
  if (!template) throw new Error("experiment fixture requires one Agent template");
  const templateEntity = definition.initialState.truth.entities[template.entityId];
  const templatePlacement = definition.initialState.truth.placements[template.entityId] ?? null;
  for (const agent of Object.values(definition.initialState.agents)) {
    if (agent.id !== template.id) {
      delete definition.initialState.agents[agent.id];
    }
  }
  for (let index = 1; index < agentCount; index += 1) {
    const id = `experiment-agent-${String(index + 1).padStart(4, "0")}`;
    const agent: AgentState = structuredClone(template);
    agent.id = id;
    agent.entityId = id;
    agent.nextAction = null;
    agent.bindings = Object.fromEntries(Object.entries(agent.bindings).map(([localId, binding]) => [localId, {
      ...binding,
      canonicalEntityIds: binding.canonicalEntityIds.map((entityId) =>
        entityId === template.entityId ? id : entityId),
    }]));
    definition.initialState.agents[id] = agent;
    definition.initialState.truth.entities[id] = {
      ...structuredClone(templateEntity),
      id,
      name: `实验 Agent ${index + 1}`,
      description: "用于可重复执行实验的确定性 Agent。",
    };
    definition.initialState.truth.placements[id] = templatePlacement;
  }
  definition.historyBaseHash = historyReplayBaseHash(definition.initialState);
  return definition;
}

function invocationSummary(audits: readonly ModelExecutionAudit[]) {
  const invocations = audits.flatMap((audit) => audit.invocations);
  return {
    invocations: invocations.length,
    repairs: audits.reduce((sum, audit) => sum + summarizeModelExecutionAudit(audit).repairAttempts, 0),
    transportRetries: audits.reduce((sum, audit) => {
      const summary = summarizeModelExecutionAudit(audit);
      return sum + Math.max(0, summary.transportAttempts - summary.invocations);
    }, 0),
    inputBytes: invocations.reduce((sum, invocation) => sum + invocation.requestUtf8Bytes, 0),
  };
}

function roleContext(invocations: readonly ModelInvocationAudit[]) {
  return {
    totalUtf8Bytes: invocations.reduce((sum, invocation) => sum + invocation.context.utf8Bytes, 0),
    counts: invocations.reduce((totals, invocation) => {
      for (const key of Object.keys(totals) as Array<keyof typeof totals>) totals[key] += invocation.context.counts[key];
      return totals;
    }, { history: 0, events: 0, agents: 0, entities: 0, facts: 0, beliefs: 0, evidence: 0, observations: 0 }),
  };
}

function ledgerMeasurement(ledger: ExecutionLedger | undefined, executionId: string | undefined) {
  const events = ledger && executionId ? ledger.executionEvents(executionId) : [];
  return {
    eventCount: events.length,
    artifactRawBytes: events.reduce((sum, event) => sum + (event.measurements?.ledgerArtifactRawBytes ?? 0), 0),
    artifactStoredBytes: events.reduce((sum, event) => sum + (event.measurements?.ledgerArtifactStoredBytes ?? 0), 0),
    sqliteWriteMs: Number(events.reduce(
      (sum, event) => sum + (event.measurements?.ledgerSqliteWriteMs ?? 0),
      0,
    ).toFixed(3)),
  };
}

export async function runDeterministicExperiment(options: ExperimentOptions): Promise<ExperimentResult> {
  const records: ExperimentRecord[] = [];
  const scenarios: ExperimentResult["scenarios"] = [];
  let sequence = 0;
  const write = (record: Omit<ExperimentRecord, "schemaVersion" | "sequence">): void => {
    const complete = { schemaVersion: 2 as const, sequence: ++sequence, ...record } as ExperimentRecord;
    records.push(complete);
    options.write?.(complete);
  };
  const catalog = createTestModelCatalog(undefined, { maxInputBytes: 4 * 1024 * 1024 });
  const fixture = loadWorldScript(path.resolve("test/fixtures/open-world-script"), {
    seed: 20260823,
    modelCatalog: catalog,
  });

  for (const agentCount of positiveMatrix(options.agents, "agents")) {
    for (const stepCount of positiveMatrix(options.steps, "steps")) {
      const definition = scaledDefinition(fixture, agentCount);
      const instanceId = `experiment-${agentCount}-${stepCount}`;
      const trialId = options.ledger ? randomUUID() : undefined;
      const recording = new RecordingRuntimeObserver({ mode: options.ledger ? "full" : "metrics" });
      const code = runtimeCodeIdentity();
      const durable = trialId ? options.ledger!.beginExecution({
        id: trialId,
        kind: "benchmark",
        parentExecutionId: options.parentExecutionId,
        instanceId,
        step: 0,
        manifest: EAGER_REFERENCE_MANIFEST,
        worldHash: definition.initialState.worldHash,
        codeRevision: code.revision,
        codeDirty: code.dirty,
        modelCatalogHash: catalog.hash,
        seed: definition.initialState.truth.rng.seed,
        runtimeConfig: { agents: agentCount, steps: stepCount, deterministic: true, participants: 0 },
      }) : undefined;
      const observer: RuntimeObserver = durable ? new ExperimentObserver(durable, recording) : recording;
      const provider = new ModelGateway(catalog, experimentCredentials(catalog), {
        observer,
        maxTransportAttempts: 1,
        adapters: new Map([["scripted-test", deterministicAdapter]]),
      });
      const engine = new SimulationEngine(definition, new EagerReferenceAlgorithm(provider));
      const semanticHashes: string[] = [];
      try {
        write({ event: "experiment.scenario.started", agents: agentCount, steps: stepCount });
        await engine.bootstrapAgents({
          workloadId: instanceId,
          batchId: `bootstrap:${instanceId}`,
          correlation: { instanceId, revision: 0, step: 0, executionId: trialId },
          observer,
        });
        let cumulativeInputBytes = invocationSummary(engine.bootstrapModelAudits).inputBytes;
        let modelInvocations = invocationSummary(engine.bootstrapModelAudits).invocations;
        write({
          event: "experiment.bootstrap",
          agents: agentCount,
          targetSteps: stepCount,
          ...invocationSummary(engine.bootstrapModelAudits),
          cumulativeInputUtf8Bytes: cumulativeInputBytes,
        });

        for (let index = 0; index < stepCount; index += 1) {
          const source = engine.snapshot;
          const advanceId = `advance:${instanceId}:${index + 1}`;
          const roster = Object.fromEntries(Object.values(source.agents).map((agent) => [agent.id, {
            kind: "model" as const,
            agentId: agent.id,
            profiles: structuredClone(agent.modelProfiles),
          }]));
          const startedAt = performance.now();
          const result = await engine.step(roster, {
            expectedRevision: source.revision,
            trigger: "batch",
            simulatedSeconds: definition.runtimeDefaults.simulatedSeconds,
            externalActions: [],
          }, {
            workloadId: instanceId,
            batchId: advanceId,
            correlation: {
              instanceId,
              advanceId,
              advanceAttempt: 1,
              revision: source.revision,
              step: source.step + 1,
              executionId: trialId,
            },
            observer,
          });
          semanticHashes.push(result.committed.semanticHash);
          const summary = invocationSummary(result.modelAudits);
          cumulativeInputBytes += summary.inputBytes;
          modelInvocations += summary.invocations;
          write({
            event: "experiment.step",
            agents: agentCount,
            targetSteps: stepCount,
            step: result.state.step,
            ...summary,
            cumulativeInputUtf8Bytes: cumulativeInputBytes,
            stepWallMs: Number((performance.now() - startedAt).toFixed(3)),
            instanceDocumentBytes: Buffer.byteLength(JSON.stringify(result.state), "utf8"),
          });
          const byRole = new Map<string, ModelInvocationAudit[]>();
          for (const audit of result.modelAudits) {
            const values = byRole.get(audit.role) ?? [];
            values.push(...audit.invocations);
            byRole.set(audit.role, values);
          }
          for (const [role, invocations] of byRole) {
            write({
              event: "experiment.context",
              phase: "step",
              agents: agentCount,
              step: result.state.step,
              role,
              ...roleContext(invocations),
            });
          }
        }

        const finalState = engine.snapshot;
        if (trialId) options.ledger!.finishExecution(trialId, {
          status: "succeeded",
          semanticHash: contentHash(semanticHashes),
          stateHash: contentHash(finalState),
          commitRevision: finalState.revision,
        });
        const ledger = ledgerMeasurement(options.ledger, trialId);
        const scenario = {
          agents: agentCount,
          steps: stepCount,
          cumulativeInputBytes,
          modelInvocations,
          instanceDocumentBytes: Buffer.byteLength(JSON.stringify(finalState), "utf8"),
          ledgerEventCount: ledger.eventCount,
          ledgerArtifactRawBytes: ledger.artifactRawBytes,
          ledgerArtifactStoredBytes: ledger.artifactStoredBytes,
          ledgerSqliteWriteMs: ledger.sqliteWriteMs,
        };
        scenarios.push(scenario);
        write({ event: "experiment.scenario.completed", ...scenario, observabilityEventCount: recording.events.length });
      } catch (error) {
        if (trialId && options.ledger!.execution(trialId)?.status === "running") {
          options.ledger!.finishExecution(trialId, { status: "failed", error });
        }
        throw error;
      }
    }
  }
  write({ event: "experiment.summary", kind: "deterministic-eager-reference", scenarios });
  return { records, scenarios };
}
