import path from "node:path";
import { AgentMind } from "../src/engine/agent-mind";
import type { ModelProviderAdapter } from "../src/engine/model-adapter";
import type { ModelCatalog } from "../src/engine/model-catalog";
import { ModelGateway } from "../src/engine/model-gateway";
import type {
  AgentState,
  ModelExecutionAudit,
  ModelInvocationAudit,
} from "../src/engine/model";
import { summarizeModelExecutionAudit } from "../src/engine/model-provider";
import { RecordingRuntimeObserver } from "../src/engine/observability";
import { SimulationEngine } from "../src/engine/simulation";
import {
  createTestModelCatalog,
  deterministicModelOutput,
} from "../src/engine/testing/model-provider";
import { TruthEngine } from "../src/engine/truth-engine";
import { toWorldRuntimeContract, type WorldDefinition } from "../src/engine/world-definition";
import { loadWorldScript } from "../src/script/world-loader";
import { MemoryWorldSessionStore } from "../src/server/world-session-store";
import type { WorldSessionDocument } from "../src/server/world-run-types";

export interface RuntimeDiagnosticOptions {
  agents: number[];
  steps: number[];
  write?: (record: DiagnosticRecord) => void;
}

export interface DiagnosticRecord {
  schemaVersion: 1;
  sequence: number;
  event: string;
  [key: string]: unknown;
}

export interface RuntimeDiagnosticResult {
  records: DiagnosticRecord[];
  scenarios: Array<{
    agents: number;
    steps: number;
    cumulativeInputBytes: number;
    modelInvocations: number;
    archiveBytes: number;
  }>;
}

const deterministicAdapter: ModelProviderAdapter = {
  kind: "deepseek",
  structuredOutputMode: "deterministic-test",
  async generate(profile, request, contextJson) {
    const context = JSON.parse(contextJson);
    let value: unknown;
    if (request.role === "causal-verifier") {
      value = { verdict: "accept", findings: [] };
    } else if (request.role === "truth-perception" || request.role === "truth-resolution") {
      value = { kind: "done" };
    } else if (request.role === "truth-reaction-routing") {
      value = { requests: [] };
    } else if (request.role === "truth-transition") {
      const generated = deterministicModelOutput(request.profileId, context) as {
        kind: "transition";
        proposal: unknown;
      };
      value = generated.proposal;
    } else {
      value = deterministicModelOutput(request.profileId, context);
    }
    return {
      value,
      responseId: request.modelInvocationId ?? "diagnostic-model-invocation",
      responseModelId: profile.model,
      finishReason: "stop",
      tokenUsage: {
        input: null,
        output: null,
        reasoning: null,
        cacheRead: null,
        cacheWrite: null,
      },
    };
  },
};

function diagnosticCredentials(catalog: ModelCatalog): Record<string, string> {
  return Object.fromEntries(Object.values(catalog.providers).map((provider) => [
    provider.api_key_env,
    "deterministic-diagnostic-boundary",
  ]));
}

function positiveMatrix(values: readonly number[], label: string): number[] {
  const unique = [...new Set(values)];
  if (unique.length === 0 || unique.some((value) =>
    !Number.isSafeInteger(value) || value <= 0)) {
    throw new Error(`${label} must contain positive safe integers`);
  }
  return unique.sort((left, right) => left - right);
}

export function parseDiagnosticMatrix(
  argv: readonly string[],
  defaults: { agents: number[]; steps: number[] } = { agents: [1, 10, 50], steps: [1, 10, 100] },
): { agents: number[]; steps: number[] } {
  const values: { agents?: string; steps?: string } = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const match = /^--(agents|steps)(?:=(.*))?$/.exec(argument);
    if (!match) throw new Error(`unknown diagnostic argument: ${argument}`);
    const key = match[1] as "agents" | "steps";
    if (values[key] !== undefined) throw new Error(`duplicate diagnostic argument: --${key}`);
    const inline = match[2];
    const value = inline ?? argv[++index];
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
  const template = definition.initialState.agents.keeper;
  const templateEntity = definition.initialState.truth.entities[template.entityId];
  const templatePlacement = definition.initialState.truth.placements[template.entityId] ?? null;
  if (!template || !templateEntity) throw new Error("diagnostic fixture requires the keeper Agent");
  for (let index = 1; index < agentCount; index += 1) {
    const id = `diagnostic-agent-${String(index + 1).padStart(3, "0")}`;
    const agent: AgentState = structuredClone(template);
    agent.id = id;
    agent.entityId = id;
    agent.nextAction = null;
    agent.bindings.self = { localEntityId: "self", canonicalEntityIds: [id] };
    definition.initialState.agents[id] = agent;
    definition.initialState.truth.entities[id] = {
      ...structuredClone(templateEntity),
      id,
      name: `诊断 Agent ${index + 1}`,
      description: "用于可重复运行时诊断的确定性 Agent。",
    };
    definition.initialState.truth.placements[id] = templatePlacement;
  }
  return definition;
}

function percentile(values: readonly number[], ratio: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)];
}

function stageDurations(observer: RecordingRuntimeObserver): Record<string, {
  samples: number;
  p50Ms: number;
  p95Ms: number;
  maxMs: number;
}> {
  const groups = new Map<string, number[]>();
  for (const event of observer.events) {
    if (event.durationMs === undefined) continue;
    const values = groups.get(event.event) ?? [];
    values.push(event.durationMs);
    groups.set(event.event, values);
  }
  return Object.fromEntries([...groups.entries()].sort(([left], [right]) => left.localeCompare(right))
    .map(([event, values]) => [event, {
      samples: values.length,
      p50Ms: percentile(values, 0.5),
      p95Ms: percentile(values, 0.95),
      maxMs: Math.max(...values),
    }]));
}

function roleContext(invocations: readonly ModelInvocationAudit[]): {
  totalUtf8Bytes: number;
  sections: Record<string, number>;
  counts: ModelInvocationAudit["context"]["counts"];
} {
  const counts: ModelInvocationAudit["context"]["counts"] = {
    history: 0,
    events: 0,
    agents: 0,
    entities: 0,
    facts: 0,
    beliefs: 0,
    evidence: 0,
    observations: 0,
  };
  const sections: Record<string, number> = {};
  for (const invocation of invocations) {
    for (const [name, section] of Object.entries(invocation.context.sections)) {
      sections[name] = (sections[name] ?? 0) + section.utf8Bytes;
    }
    for (const key of Object.keys(counts) as Array<keyof typeof counts>) {
      counts[key] += invocation.context.counts[key];
    }
  }
  return {
    totalUtf8Bytes: invocations.reduce((sum, invocation) => sum + invocation.context.utf8Bytes, 0),
    sections: Object.fromEntries(Object.entries(sections).sort(([left], [right]) => left.localeCompare(right))),
    counts,
  };
}

function archiveMeasurement(observer: RecordingRuntimeObserver): {
  bytes: number;
  writeMs: number;
} {
  const serialized = observer.events.filter((event) => event.event === "persistence.document.serialized").at(-1);
  const write = observer.events.filter((event) => event.event === "persistence.write.completed").at(-1);
  return {
    bytes: serialized?.measurements?.envelopeUtf8Bytes ?? 0,
    writeMs: write?.durationMs ?? 0,
  };
}

function invocationSummary(audits: readonly ModelExecutionAudit[]): {
  invocations: number;
  repairs: number;
  transportRetries: number;
  inputBytes: number;
} {
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

export async function runDeterministicRuntimeDiagnostic(
  options: RuntimeDiagnosticOptions,
): Promise<RuntimeDiagnosticResult> {
  const agents = positiveMatrix(options.agents, "agents");
  const steps = positiveMatrix(options.steps, "steps");
  const records: DiagnosticRecord[] = [];
  let sequence = 0;
  const write = (record: Omit<DiagnosticRecord, "schemaVersion" | "sequence">): void => {
    const complete = { schemaVersion: 1 as const, sequence: ++sequence, ...record } as DiagnosticRecord;
    records.push(complete);
    options.write?.(complete);
  };
  const catalog = createTestModelCatalog();
  const fixture = loadWorldScript(path.resolve("test/fixtures/open-world-script"), {
    seed: 20260823,
    modelCatalog: catalog,
  });
  const scenarios: RuntimeDiagnosticResult["scenarios"] = [];

  for (const agentCount of agents) {
    for (const stepCount of steps) {
      const observer = new RecordingRuntimeObserver({ mode: "metrics" });
      const provider = new ModelGateway(catalog, diagnosticCredentials(catalog), {
        observer,
        maxTransportAttempts: 1,
        adapters: new Map([["scripted-test", deterministicAdapter]]),
      });
      const definition = scaledDefinition(fixture, agentCount);
      const engine = new SimulationEngine(
        definition,
        new TruthEngine(provider),
        new AgentMind(provider),
      );
      const sessionId = `diagnostic-${agentCount}-${stepCount}`;
      const store = new MemoryWorldSessionStore(observer);
      write({ event: "diagnostic.scenario.started", agents: agentCount, steps: stepCount });
      await engine.bootstrapAgents({
        workloadId: sessionId,
        batchId: `bootstrap:${sessionId}`,
        correlation: { sessionId, revision: 0, step: 0 },
        observer,
      });
      const now = "2026-08-23T00:00:00.000Z";
      const document: WorldSessionDocument = {
        schemaVersion: 8,
        id: sessionId,
        world: toWorldRuntimeContract(definition),
        title: definition.name,
        createdAt: now,
        updatedAt: now,
        state: engine.snapshot,
        runs: {},
      };
      let stored = store.create(document, { sessionId, revision: 0, step: 0 });
      const bootstrapSummary = invocationSummary(document.state.bootstrapModelAudits);
      let cumulativeInputBytes = bootstrapSummary.inputBytes;
      let modelInvocations = bootstrapSummary.invocations;
      let previousArchiveBytes = archiveMeasurement(observer).bytes;
      const previousByRole = new Map<string, number>();
      write({
        event: "diagnostic.bootstrap",
        agents: agentCount,
        targetSteps: stepCount,
        modelInvocations: bootstrapSummary.invocations,
        repairs: bootstrapSummary.repairs,
        transportRetries: bootstrapSummary.transportRetries,
        inputUtf8Bytes: bootstrapSummary.inputBytes,
        cumulativeInputUtf8Bytes: cumulativeInputBytes,
        archiveBytes: previousArchiveBytes,
      });
      const bootstrapByRole = new Map<string, ModelInvocationAudit[]>();
      for (const audit of document.state.bootstrapModelAudits) {
        const values = bootstrapByRole.get(audit.role) ?? [];
        values.push(...audit.invocations);
        bootstrapByRole.set(audit.role, values);
      }
      for (const [role, invocations] of bootstrapByRole) {
        const context = roleContext(invocations);
        write({
          event: "diagnostic.context",
          phase: "bootstrap",
          agents: agentCount,
          targetSteps: stepCount,
          step: 0,
          role,
          invocations: invocations.length,
          totalUtf8Bytes: context.totalUtf8Bytes,
          growthUtf8Bytes: context.totalUtf8Bytes,
          sections: context.sections,
          counts: context.counts,
        });
        previousByRole.set(role, context.totalUtf8Bytes);
      }

      for (let stepIndex = 0; stepIndex < stepCount; stepIndex += 1) {
        const runId = `run:${sessionId}:${stepIndex + 1}`;
        const inputId = `input:${sessionId}:${stepIndex + 1}`;
        const inputText = `诊断步骤 ${stepIndex + 1}：观察世界并等待一秒。`;
        engine.beginPlayerIntent(inputText, inputId);
        const base = engine.snapshot;
        const stepStartedAt = performance.now();
        const result = await engine.step({
          workloadId: sessionId,
          batchId: runId,
          correlation: {
            sessionId,
            runId,
            runAttempt: 1,
            stepAttemptId: `run:${sessionId}:1:${base.revision + 1}`,
            revision: base.revision,
            step: base.step + 1,
          },
          observer,
        });
        const stepWallMs = performance.now() - stepStartedAt;
        document.state = result.state;
        const stepAt = new Date(Date.parse(now) + (stepIndex + 1) * 1_000).toISOString();
        document.updatedAt = stepAt;
        const intent = result.state.player.intent;
        if (!intent || intent.status !== "completed") {
          throw new Error("deterministic diagnostic step did not complete its player intent");
        }
        document.runs[runId] = {
          id: runId,
          sessionId,
          intentId: intent.id,
          status: "completed",
          createdAt: stepAt,
          updatedAt: stepAt,
          cancelRequested: false,
          events: [
            { sequence: 1, at: stepAt, type: "player.input", payload: { id: inputId, kind: "goal", text: inputText } },
            {
              sequence: 2,
              at: stepAt,
              type: "run.execution_started",
              payload: { runId, inputId, reason: "initial" },
            },
            {
              sequence: 3,
              at: stepAt,
              type: "step.committed",
              payload: {
                revision: result.state.revision,
                step: result.state.step,
                elapsedSeconds: result.state.truth.elapsedSeconds,
              },
            },
            {
              sequence: 4,
              at: stepAt,
              type: "run.completed",
              payload: { runId, revision: result.state.revision, step: result.state.step },
            },
          ],
        };
        const persistenceStartedAt = performance.now();
        stored = store.compareAndSwap(sessionId, stored.generation, document, {
          sessionId,
          runId,
          runAttempt: 1,
          revision: result.state.revision,
          step: result.state.step,
        });
        const persistenceWallMs = performance.now() - persistenceStartedAt;
        const summary = invocationSummary(result.committed.modelAudits);
        const archive = archiveMeasurement(observer);
        cumulativeInputBytes += summary.inputBytes;
        modelInvocations += summary.invocations;
        write({
          event: "diagnostic.step",
          agents: agentCount,
          targetSteps: stepCount,
          step: result.state.step,
          modelInvocations: summary.invocations,
          repairs: summary.repairs,
          transportRetries: summary.transportRetries,
          inputUtf8Bytes: summary.inputBytes,
          cumulativeInputUtf8Bytes: cumulativeInputBytes,
          stepWallMs: Number(stepWallMs.toFixed(3)),
          archiveWriteWallMs: Number(persistenceWallMs.toFixed(3)),
          archiveBytes: archive.bytes,
          archiveGrowthBytes: archive.bytes - previousArchiveBytes,
          archiveWriteMs: archive.writeMs,
        });
        previousArchiveBytes = archive.bytes;
        const byRole = new Map<string, ModelInvocationAudit[]>();
        for (const audit of result.committed.modelAudits) {
          const values = byRole.get(audit.role) ?? [];
          values.push(...audit.invocations);
          byRole.set(audit.role, values);
        }
        for (const [role, invocations] of [...byRole].sort(([left], [right]) => left.localeCompare(right))) {
          const context = roleContext(invocations);
          const prior = previousByRole.get(role) ?? 0;
          write({
            event: "diagnostic.context",
            phase: "step",
            agents: agentCount,
            targetSteps: stepCount,
            step: result.state.step,
            role,
            invocations: invocations.length,
            totalUtf8Bytes: context.totalUtf8Bytes,
            growthUtf8Bytes: context.totalUtf8Bytes - prior,
            sections: context.sections,
            counts: context.counts,
          });
          previousByRole.set(role, context.totalUtf8Bytes);
        }
      }

      const archive = archiveMeasurement(observer);
      const scenario = {
        agents: agentCount,
        steps: stepCount,
        cumulativeInputBytes,
        modelInvocations,
        archiveBytes: archive.bytes,
      };
      scenarios.push(scenario);
      write({
        event: "diagnostic.scenario.completed",
        ...scenario,
        archiveWriteMs: archive.writeMs,
        stageDurations: stageDurations(observer),
        observabilityEventCount: observer.events.length,
        observabilityUtf8Bytes: observer.serializedUtf8Bytes,
        observabilitySerializationMs: Number(observer.serializationMs.toFixed(3)),
      });
    }
  }
  write({
    event: "diagnostic.summary",
    kind: "deterministic-runtime",
    scenarios,
  });
  return { records, scenarios };
}
