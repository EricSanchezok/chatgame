import {
  ActivityFootprintIndex,
  affectedActivityIdsExhaustive,
  interactionDependencyComponents,
} from "./action-dependency";
import type { InteractionDependency } from "./execution";
import type { AgentActionProposal } from "./model";
import { contentHash } from "./model-audit";
import type { ActivityState, TemporalPlan } from "./temporal";

export const CAUSAL_ACTIVITY_BENCHMARK_SCHEMA_VERSION = 1 as const;

export type CausalConflictDensity = "zero" | "sparse" | "dense" | "global_fallback";
export type CausalActivityType = "short" | "long" | "staged" | "conditional" | "ongoing";

export interface CausalActivityBenchmarkScenario {
  agents: number;
  conflictDensity: CausalConflictDensity;
  activityType: CausalActivityType;
  semantic: {
    scenarioPassRate: number;
    affectedActivityRecall: number;
    falseActivationRate: number;
    causalOrderViolations: number;
    replayHashConsistent: boolean;
  };
  modelCost: {
    invocations: number;
    inputTokens: number | null;
    outputTokens: number | null;
    estimatedCost: number | null;
    repairs: number;
  };
  computation: {
    p50Ms: number;
    p95Ms: number;
    peakHeapUsedBytes: number;
    artifactBytes: number;
    footprintQueries: number;
    maxInteractionComponent: number;
  };
  playerWaitMs: null;
}

export interface CausalActivityBenchmarkReport {
  schemaVersion: typeof CAUSAL_ACTIVITY_BENCHMARK_SCHEMA_VERSION;
  generatedAt: string;
  samplesPerScenario: number;
  scenarios: CausalActivityBenchmarkScenario[];
}

const densities: readonly CausalConflictDensity[] = ["zero", "sparse", "dense", "global_fallback"];
const activityTypes: readonly CausalActivityType[] = ["short", "long", "staged", "conditional", "ongoing"];

function percentile(values: readonly number[], fraction: number): number {
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[Math.min(ordered.length - 1, Math.ceil(ordered.length * fraction) - 1)] ?? 0;
}

function planFor(type: CausalActivityType, index: number): TemporalPlan {
  const startsAtSeconds = 0;
  const completionAtSeconds = type === "ongoing" || type === "conditional"
    ? null
    : type === "short" ? 2 : type === "long" ? 21_600 : 600;
  const checkpointSeconds = type === "short" ? 2 : type === "long" ? 3_600 : 60;
  const profileId = `benchmark-${type}`;
  return {
    id: `plan-${index}`,
    actionId: `source-action-${index}`,
    actorId: `agent-${index}`,
    profileId,
    mode: type === "short" || type === "long" ? "fixed" : type,
    description: `${type} benchmark Activity`,
    basis: { kind: "profile", profileId },
    startsAtSeconds,
    completionAtSeconds,
    checkpointSeconds,
    progress: null,
    stages: type === "staged" ? [{
      id: "stage-1",
      name: "benchmark stage",
      startsAtSeconds,
      endsAtSeconds: completionAtSeconds!,
      checkpointSeconds,
    }] : [],
    continuationAssertions: [],
    interruptible: true,
    resourceClaims: [],
    causes: [{ kind: "action", id: `source-action-${index}` }],
  };
}

function footprintRef(density: CausalConflictDensity, index: number, side: "activity" | "incoming") {
  if (density === "dense") return { kind: "fact" as const, id: "shared-benchmark-fact" };
  if (density === "sparse" && index % 10 === 0) return { kind: "fact" as const, id: `sparse-${index}` };
  return { kind: "fact" as const, id: `${side}-${index}` };
}

function activityFor(type: CausalActivityType, density: CausalConflictDensity, index: number): ActivityState {
  const plan = planFor(type, index);
  const sourceAction: AgentActionProposal = {
    id: plan.actionId,
    actorId: plan.actorId,
    baseRevision: 0,
    rawText: plan.description,
    goal: plan.description,
    means: null,
    targetIds: [],
  };
  const globalFallback = density === "global_fallback";
  const interactionFootprint: InteractionDependency = {
    kind: "activity",
    id: `activity-${index}`,
    actorId: plan.actorId,
    reads: [globalFallback
      ? { kind: "global", id: "world" }
      : footprintRef(density, index, "activity")],
    writes: [],
    audienceAgentIds: [plan.actorId],
    sharedResourceClaims: [],
    globalFallback,
  };
  return {
    id: interactionFootprint.id,
    sourceActionId: sourceAction.id,
    sourceAction,
    actorId: sourceAction.actorId,
    participantAgentIds: [sourceAction.actorId],
    plan,
    status: "active",
    stageIndex: 0,
    startedAtSeconds: 0,
    updatedAtSeconds: 0,
    nextBoundaryAtSeconds: plan.checkpointSeconds,
    completionAtSeconds: plan.completionAtSeconds,
    progress: null,
    resourceClaims: [],
    sharedResourceClaims: [],
    interactionFootprint,
  };
}

function incomingFor(density: CausalConflictDensity, index: number): InteractionDependency {
  const globalFallback = density === "global_fallback";
  return {
    kind: "action",
    id: `incoming-${index}`,
    actorId: `trigger-${index}`,
    reads: [],
    writes: [globalFallback
      ? { kind: "global", id: "world" }
      : footprintRef(density, index, "incoming")],
    audienceAgentIds: [`trigger-${index}`],
    sharedResourceClaims: [],
    globalFallback,
  };
}

function scenario(
  agents: number,
  conflictDensity: CausalConflictDensity,
  activityType: CausalActivityType,
  samples: number,
): CausalActivityBenchmarkScenario {
  const activities = Object.fromEntries(Array.from({ length: agents }, (_, index) => {
    const activity = activityFor(activityType, conflictDensity, index);
    return [activity.id, activity];
  }));
  const incoming = Array.from({ length: agents }, (_, index) => incomingFor(conflictDensity, index));
  const oracle = affectedActivityIdsExhaustive(activities, incoming);
  const durations: number[] = [];
  let indexed: string[] = [];
  let peakHeapUsedBytes = process.memoryUsage().heapUsed;
  for (let sample = 0; sample < samples; sample += 1) {
    const startedAt = performance.now();
    indexed = new ActivityFootprintIndex(activities).affectedBy(incoming);
    durations.push(performance.now() - startedAt);
    peakHeapUsedBytes = Math.max(peakHeapUsedBytes, process.memoryUsage().heapUsed);
  }
  const oracleSet = new Set(oracle);
  const truePositive = indexed.filter((id) => oracleSet.has(id)).length;
  const falsePositive = indexed.filter((id) => !oracleSet.has(id)).length;
  const recall = oracle.length === 0 ? 1 : truePositive / oracle.length;
  const falseActivationRate = indexed.length === 0 ? 0 : falsePositive / indexed.length;
  const replayHashConsistent = contentHash(indexed) === contentHash(
    new ActivityFootprintIndex(activities).affectedBy(incoming),
  );
  const components = interactionDependencyComponents([
    ...Object.values(activities).map((activity) => activity.interactionFootprint),
    ...incoming,
  ]);
  const passed = recall === 1 && falseActivationRate === 0 && replayHashConsistent;
  return {
    agents,
    conflictDensity,
    activityType,
    semantic: {
      scenarioPassRate: passed ? 1 : 0,
      affectedActivityRecall: recall,
      falseActivationRate,
      causalOrderViolations: 0,
      replayHashConsistent,
    },
    modelCost: {
      invocations: 0,
      inputTokens: null,
      outputTokens: null,
      estimatedCost: null,
      repairs: 0,
    },
    computation: {
      p50Ms: Number(percentile(durations, 0.5).toFixed(3)),
      p95Ms: Number(percentile(durations, 0.95).toFixed(3)),
      peakHeapUsedBytes,
      artifactBytes: Buffer.byteLength(JSON.stringify({ activities, incoming, oracle, indexed }), "utf8"),
      footprintQueries: samples + 2,
      maxInteractionComponent: Math.max(0, ...components.map((component) => component.length)),
    },
    playerWaitMs: null,
  };
}

export function runCausalActivityBenchmark(input: {
  agents?: readonly number[];
  conflictDensities?: readonly CausalConflictDensity[];
  activityTypes?: readonly CausalActivityType[];
  samplesPerScenario?: number;
} = {}): CausalActivityBenchmarkReport {
  const agents = [...new Set(input.agents ?? [1, 10, 50, 1000])];
  if (agents.length === 0 || agents.some((value) => !Number.isSafeInteger(value) || value <= 0)) {
    throw new Error("causal benchmark Agent counts must be positive safe integers");
  }
  const selectedDensities = [...new Set(input.conflictDensities ?? densities)];
  const selectedTypes = [...new Set(input.activityTypes ?? activityTypes)];
  const samplesPerScenario = input.samplesPerScenario ?? 5;
  if (!Number.isSafeInteger(samplesPerScenario) || samplesPerScenario <= 0) {
    throw new Error("causal benchmark samples must be a positive safe integer");
  }
  return {
    schemaVersion: CAUSAL_ACTIVITY_BENCHMARK_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    samplesPerScenario,
    scenarios: agents.flatMap((agentCount) => selectedDensities.flatMap((density) =>
      selectedTypes.map((activityType) => scenario(agentCount, density, activityType, samplesPerScenario)))),
  };
}
