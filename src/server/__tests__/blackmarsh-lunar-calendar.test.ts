import path from "node:path";
import { describe, expect, it } from "vitest";
import { AgentMind } from "../../engine/agent-mind";
import type {
  AgentActionProposal,
  DiscreteRandomResult,
  SimulationState,
  TransitionProposal,
} from "../../engine/model";
import { SimulationEngine } from "../../engine/simulation";
import { ScriptedModelProvider, createTestModelCatalog } from "../../engine/testing/model-provider";
import { validateSimulationState } from "../../engine/transaction";
import { TruthEngine } from "../../engine/truth-engine";
import { toWorldRuntimeContract } from "../../engine/world-definition";
import { loadWorldScript } from "../../script/world-loader";
import type { WorldSessionDocument } from "../world-run-types";
import { MemoryWorldSessionStore } from "../world-session-store";
import { settleBlackmarshOpeningDeadlines } from "./blackmarsh-test-support";

const worldRoot = path.resolve("worlds/blackmarsh/world");
const firstFullMoonSeconds = 518_400;

function randomAmount(results: readonly DiscreteRandomResult[]): number {
  const step = results[0]?.steps.find((candidate) => candidate.stepId === "amount");
  if (!step || step.skipped || typeof step.aggregate !== "number") {
    throw new Error("missing committed moon-shell amount");
  }
  return step.aggregate;
}

function remainingSecondsToFirstFullMoon(state: SimulationState): number {
  const remaining = firstFullMoonSeconds - state.truth.elapsedSeconds;
  if (remaining <= 0) throw new Error("source state has already reached or passed the first full moon");
  return remaining;
}

function completeObservations(observerIds: string[], step: number) {
  return ["player", ...observerIds].map((observerId) => ({
    id: `observation:lunar:${observerId}:${step}`,
    observerId,
    step,
    kind: "outcome" as const,
    summary: "你感知到时间推进，以及自己所在地能够观察到的局部变化。",
    introductions: [],
    apparentClaims: [],
    sourceEventIds: [],
  }));
}

function emptyMindOutput(agentId: string, revision: number) {
  return {
    beliefPatch: { agentId, baseRevision: revision, operations: [] },
    characterPatch: { agentId, baseRevision: revision, operations: [] },
    nextAction: {
      id: `next:${agentId}:${revision}`,
      actorId: agentId,
      baseRevision: revision,
      rawText: "继续处理自己能够观察和抵达的事务。",
      goal: "根据本地证据继续履行职责",
      means: null,
      targetIds: [],
    },
  };
}

function crossingOnly(
  state: SimulationState,
  actions: AgentActionProposal[],
  observerIds: string[],
  results: readonly DiscreteRandomResult[],
): TransitionProposal {
  const amount = randomAmount(results);
  const nextStep = state.step + 1;
  return {
    baseRevision: state.revision,
    outcomes: actions.map((action) => ({
      proposalId: action.id,
      status: "continuing",
      summary: "时间达到满月节点，但世界周期现象没有结算。",
      causeRefs: [{ kind: "action", id: action.id }],
      assertions: [{
        kind: "elapsed_seconds_compare",
        operator: "gte",
        value: state.truth.elapsedSeconds,
      }],
      knownAlternatives: [],
    })),
    mechanicInvocations: [],
    operations: [{
      kind: "advance_time",
      seconds: remainingSecondsToFirstFullMoon(state),
      causes: [{ kind: "law", id: "positive-time" }],
      assertions: [{
        kind: "elapsed_seconds_compare",
        operator: "eq",
        value: state.truth.elapsedSeconds,
      }],
    }],
    events: [{
      id: "event:unsettled-first-full-moon",
      step: nextStep,
      description: `时间恰好达到首次满月，随机承诺了 ${amount} 份月贝 Viz，但没有提交周期结算。`,
      impact: "significant",
      causes: [
        { kind: "law", id: "positive-time" },
        { kind: "random", id: "first-full-moon-shell-yield" },
      ],
      assertions: [{
        kind: "elapsed_seconds_compare",
        operator: "gte",
        value: firstFullMoonSeconds,
      }, {
        kind: "random_result",
        requestId: "first-full-moon-shell-yield",
        stepId: "amount",
        expected: amount,
      }],
    }],
    observations: completeObservations(observerIds, nextStep),
    intentStatus: "active",
    requiresPlayerDecision: false,
  };
}

function settledFullMoon(
  state: SimulationState,
  actions: AgentActionProposal[],
  observerIds: string[],
  results: readonly DiscreteRandomResult[],
): TransitionProposal {
  const amount = randomAmount(results);
  const cycleFact = state.truth.facts["blackmarsh-last-settled-full-moon-node"];
  const taveFact = state.truth.facts["tave-weretiger-circle-last-gathered-full-moon-node"];
  const castleFact = state.truth.facts["hex-2201-last-evaluated-full-moon-node"];
  if (!cycleFact || !taveFact || !castleFact) throw new Error("missing lunar settlement facts");
  const nextStep = state.step + 1;
  const randomAssertion = {
    kind: "random_result" as const,
    requestId: "first-full-moon-shell-yield",
    stepId: "amount",
    expected: amount,
  };
  const afterFullMoon = {
    kind: "elapsed_seconds_compare" as const,
    operator: "gte" as const,
    value: firstFullMoonSeconds,
  };
  const eventIds = [
    "event:first-full-moon-shells",
    "event:first-full-moon-tave",
    "event:first-full-moon-black-castle",
  ];

  return {
    baseRevision: state.revision,
    outcomes: actions.map((action) => ({
      proposalId: action.id,
      status: action.actorId === "player" ? "succeeded" : "continuing",
      summary: action.actorId === "player"
        ? "等待期间，满月节点的无人现场现象仍由世界统一结算。"
        : "该主体的本地行动与无人现场的满月现象一同接受联合裁决。",
      causeRefs: [
        { kind: "action" as const, id: action.id },
        ...(action.actorId === "player"
          ? eventIds.map((id) => ({ kind: "event" as const, id }))
          : []),
      ],
      assertions: [afterFullMoon],
      knownAlternatives: [],
    })),
    mechanicInvocations: [],
    operations: [{
      kind: "advance_time",
      seconds: remainingSecondsToFirstFullMoon(state),
      causes: [{ kind: "law", id: "positive-time" }],
      assertions: [{
        kind: "elapsed_seconds_compare",
        operator: "eq",
        value: state.truth.elapsedSeconds,
      }],
    }, {
      kind: "produce_quantity",
      definitionId: "viz",
      holderId: "moon-shell-mermaids",
      amount,
      lawId: "viz-cycle",
      causes: [
        { kind: "random", id: "first-full-moon-shell-yield" },
        { kind: "law", id: "lunar-calendar" },
        { kind: "law", id: "viz-cycle" },
      ],
      assertions: [
        randomAssertion,
        afterFullMoon,
        { kind: "fact_matches", factId: cycleFact.id, expected: cycleFact.value },
      ],
    }, {
      kind: "set_fact",
      fact: {
        ...structuredClone(taveFact),
        value: { kind: "number", value: 0 },
        description: "Tave 仪式圈已完成首次运行时满月集会，成员随后仍分散于 Tave Marshes。",
      },
      causes: [
        { kind: "law", id: "lunar-calendar" },
        { kind: "fact", id: "tave-weretiger-circle-cycle" },
      ],
      assertions: [
        afterFullMoon,
        {
          kind: "fact_matches",
          factId: "tave-weretiger-circle-cycle",
          expected: { kind: "text", value: "gathers-at-black-monolith-every-full-moon" },
        },
        { kind: "fact_matches", factId: taveFact.id, expected: taveFact.value },
      ],
    }, {
      kind: "set_fact",
      fact: {
        ...structuredClone(cycleFact),
        value: { kind: "number", value: 0 },
        description: "首次运行时满月节点已原子结算。",
      },
      causes: [
        { kind: "law", id: "lunar-calendar" },
        { kind: "fact", id: cycleFact.id },
      ],
      assertions: [
        afterFullMoon,
        { kind: "fact_matches", factId: cycleFact.id, expected: cycleFact.value },
      ],
    }, {
      kind: "set_fact",
      fact: {
        ...structuredClone(castleFact),
        value: { kind: "number", value: 0 },
        description: "黑堡已完成首次运行时满月条件检查；没有占据者，因此没有凭空产生伤亡。",
      },
      causes: [
        { kind: "law", id: "lunar-calendar" },
        { kind: "fact", id: "hex-2201-full-moon-curse" },
      ],
      assertions: [
        afterFullMoon,
        { kind: "fact_matches", factId: castleFact.id, expected: castleFact.value },
        {
          kind: "fact_matches",
          factId: "hex-2201-full-moon-curse",
          expected: { kind: "text", value: "occupants-die-after-full-moon" },
        },
      ],
    }],
    events: [{
      id: eventIds[0],
      step: nextStep,
      description: `月贝完成首次满月转化，采集共同体得到 ${amount} 份待运 Viz。`,
      impact: "significant",
      causes: [
        { kind: "random", id: "first-full-moon-shell-yield" },
        { kind: "law", id: "lunar-calendar" },
      ],
      assertions: [
        randomAssertion,
        {
          kind: "quantity_compare",
          definitionId: "viz",
          holderId: "moon-shell-mermaids",
          operator: "eq",
          value: amount,
        },
      ],
    }, {
      id: eventIds[1],
      step: nextStep,
      description: "Tave weretiger 仪式圈在首次满月完成 1709 黑色独石集会。",
      impact: "significant",
      causes: [
        { kind: "law", id: "lunar-calendar" },
        { kind: "fact", id: "tave-weretiger-circle-cycle" },
      ],
      assertions: [
        afterFullMoon,
        { kind: "fact_matches", factId: taveFact.id, expected: { kind: "number", value: 0 } },
        { kind: "placement_equals", entityId: "tave-weretiger-circle", placementId: "tave-marshes" },
      ],
    }, {
      id: eventIds[2],
      step: nextStep,
      description: "黑堡完成首次满月条件检查；当时没有占据者，因此没有生成受害者。",
      impact: "significant",
      causes: [
        { kind: "law", id: "lunar-calendar" },
        { kind: "fact", id: "hex-2201-full-moon-curse" },
      ],
      assertions: [
        afterFullMoon,
        { kind: "fact_matches", factId: castleFact.id, expected: { kind: "number", value: 0 } },
      ],
    }],
    observations: completeObservations(observerIds, nextStep),
    intentStatus: "completed",
    requiresPlayerDecision: false,
  };
}

describe("Blackmarsh lunar calendar", () => {
  it("commits an unattended full moon once after settling earlier deadlines", async () => {
    const catalog = createTestModelCatalog(["truth-deepseek", "agent-deepseek"]);
    const definition = loadWorldScript(worldRoot, { seed: 47, modelCatalog: catalog });
    const deadline = await settleBlackmarshOpeningDeadlines(definition, catalog);
    const source = deadline.state;
    let transitionCalls = 0;
    let verifierCalls = 0;
    const provider = new ScriptedModelProvider(({ role, prompt }) => {
      const context = JSON.parse(prompt) as {
        revision: number;
        baseRevision: number;
        step: number;
        agent?: { id: string };
        jointActions?: AgentActionProposal[];
        agentEpistemics?: Record<string, unknown>;
        randomResults?: DiscreteRandomResult[];
        validationIssues?: Array<{ message: string }>;
        candidate?: TransitionProposal;
        canonicalTruth?: SimulationState["truth"];
        world?: { laws?: Array<{ id: string; severity: string }> };
      };
      if (role === "agent-bootstrap" || role === "agent-mind") {
        return emptyMindOutput(context.agent!.id, context.revision);
      }
      if (role === "truth-perception") return { kind: "done" };
      if (role === "truth-reaction-routing") return { requests: [] };
      if (role === "truth-resolution") {
        if (context.randomResults?.length) return { kind: "done" };
        return {
          kind: "request_random",
          requests: [{
            id: "first-full-moon-shell-yield",
            distributionId: "moon-shell-viz-yield",
            causes: [
              { kind: "fact", id: "moon-shell-mermaids-viz-yield-distribution" },
              { kind: "law", id: "lunar-calendar" },
            ],
          }],
        };
      }
      if (role === "truth-transition") {
        transitionCalls += 1;
        if (transitionCalls === 2 &&
          !context.validationIssues?.[0]?.message.includes("causal verifier rejected")) {
          throw new Error("lunar repair did not receive the causal rejection");
        }
        const actions = context.jointActions!;
        const observers = Object.keys(context.agentEpistemics ?? {});
        return transitionCalls === 1
          ? crossingOnly(source, actions, observers, context.randomResults ?? [])
          : settledFullMoon(source, actions, observers, context.randomResults ?? []);
      }
      if (role === "causal-verifier") {
        expect(context.world?.laws).toContainEqual(expect.objectContaining({
          id: "lunar-calendar",
          severity: "hard",
        }));
        verifierCalls += 1;
        if (verifierCalls === 1) {
          expect(context.candidate?.operations.some((operation) => operation.kind === "produce_quantity"))
            .toBe(false);
          return {
            verdict: "reject",
            findings: [{
              target: { kind: "operation", id: "0:advance_time" },
              code: "law-violation",
              message: "达到满月节点却漏掉月贝、Tave、黑堡与节点凭据的原子结算。",
              repairHint: "使用已提交随机结果并结算三个现象，然后推进唯一节点。",
            }],
          };
        }
        return { verdict: "accept", findings: [] };
      }
      throw new Error(`unexpected role ${role}`);
    }, catalog, false);

    const engine = new SimulationEngine(
      definition,
      new TruthEngine(provider),
      new AgentMind(provider),
      source,
    );
    engine.beginPlayerIntent("在原地等待到首次满月，不前往月贝岛、Tave 沼泽或黑石废堡。", "full-moon");
    const result = await engine.step({
      workloadId: "blackmarsh-lunar-audit",
      batchId: "blackmarsh-first-full-moon",
    });
    const state = result.state;
    const amount = randomAmount(result.committed.randomResults);

    expect(transitionCalls).toBe(2);
    expect(verifierCalls).toBe(2);
    expect(state.revision).toBe(2);
    expect(state.history).toHaveLength(2);
    expect(result.committed.randomRequests).toHaveLength(1);
    expect(result.committed.randomRequests[0].distributionId).toBe("moon-shell-viz-yield");
    expect(state.truth.elapsedSeconds).toBe(firstFullMoonSeconds);
    expect(Object.values(state.truth.facts).filter((fact) => fact.predicate === "deadline-seconds"))
      .toHaveLength(0);
    expect(state.truth.quantities["viz:moon-shell-mermaids"].amount).toBe(amount);
    expect(state.truth.placements["tave-weretiger-circle"]).toBe("tave-marshes");
    expect(state.truth.facts["tave-weretiger-circle-last-gathered-full-moon-node"].value)
      .toEqual({ kind: "number", value: 0 });
    expect(state.truth.facts["blackmarsh-last-settled-full-moon-node"].value)
      .toEqual({ kind: "number", value: 0 });
    expect(state.truth.facts["hex-2201-last-evaluated-full-moon-node"].value)
      .toEqual({ kind: "number", value: 0 });
    expect(() => validateSimulationState(state, true, true)).not.toThrow();

    const store = new MemoryWorldSessionStore();
    const deadlineIntent = deadline.state.player.intent!;
    const intent = state.player.intent!;
    const document: WorldSessionDocument = {
      schemaVersion: 8,
      id: "blackmarsh-lunar-session",
      world: toWorldRuntimeContract(definition),
      title: definition.name,
      createdAt: "2026-08-24T00:00:00.000Z",
      updatedAt: "2026-08-24T00:00:02.000Z",
      state,
      runs: {
        "deadline-run": {
          id: "deadline-run",
          sessionId: "blackmarsh-lunar-session",
          intentId: deadlineIntent.id,
          status: "completed",
          createdAt: "2026-08-24T00:00:00.000Z",
          updatedAt: "2026-08-24T00:00:01.000Z",
          cancelRequested: false,
          events: [{
            sequence: 1,
            type: "player.input",
            at: "2026-08-24T00:00:00.000Z",
            payload: {
              id: deadlineIntent.latestInput.id,
              kind: deadlineIntent.latestInput.kind,
              text: deadlineIntent.latestInput.text,
            },
          }, {
            sequence: 2,
            type: "run.execution_started",
            at: "2026-08-24T00:00:00.000Z",
            payload: {
              runId: "deadline-run",
              inputId: deadlineIntent.latestInput.id,
              reason: "initial",
            },
          }, {
            sequence: 3,
            type: "step.committed",
            at: "2026-08-24T00:00:01.000Z",
            payload: {
              revision: deadline.state.revision,
              step: deadline.state.step,
              elapsedSeconds: deadline.state.truth.elapsedSeconds,
            },
          }, {
            sequence: 4,
            type: "run.completed",
            at: "2026-08-24T00:00:01.000Z",
            payload: {
              runId: "deadline-run",
              revision: deadline.state.revision,
              step: deadline.state.step,
            },
          }],
        },
        "lunar-run": {
          id: "lunar-run",
          sessionId: "blackmarsh-lunar-session",
          intentId: intent.id,
          status: "completed",
          createdAt: "2026-08-24T00:00:01.000Z",
          updatedAt: "2026-08-24T00:00:02.000Z",
          cancelRequested: false,
          events: [{
            sequence: 1,
            type: "player.input",
            at: "2026-08-24T00:00:01.000Z",
            payload: {
              id: intent.latestInput.id,
              kind: intent.latestInput.kind,
              text: intent.latestInput.text,
            },
          }, {
            sequence: 2,
            type: "run.execution_started",
            at: "2026-08-24T00:00:01.000Z",
            payload: {
              runId: "lunar-run",
              inputId: intent.latestInput.id,
              reason: "initial",
            },
          }, {
            sequence: 3,
            type: "step.committed",
            at: "2026-08-24T00:00:02.000Z",
            payload: {
              revision: state.revision,
              step: state.step,
              elapsedSeconds: state.truth.elapsedSeconds,
            },
          }, {
            sequence: 4,
            type: "run.completed",
            at: "2026-08-24T00:00:02.000Z",
            payload: {
              runId: "lunar-run",
              revision: state.revision,
              step: state.step,
            },
          }],
        },
      },
    };
    expect(store.create(document).document.state).toEqual(state);

    const snapshot = structuredClone(state);
    const repeatProvider = new ScriptedModelProvider(({ role, prompt }) => {
      const context = JSON.parse(prompt) as {
        revision: number;
        baseRevision: number;
        step: number;
        agent?: { id: string };
        jointActions?: AgentActionProposal[];
        agentEpistemics?: Record<string, unknown>;
        randomResults?: DiscreteRandomResult[];
        candidate?: TransitionProposal;
        canonicalTruth?: SimulationState["truth"];
      };
      if (role === "agent-bootstrap" || role === "agent-mind") {
        return emptyMindOutput(context.agent!.id, context.revision);
      }
      if (role === "truth-perception") return { kind: "done" };
      if (role === "truth-reaction-routing") return { requests: [] };
      if (role === "truth-resolution") {
        if (context.randomResults?.length) return { kind: "done" };
        return {
          kind: "request_random",
          requests: [{
            id: "repeat-first-full-moon-shell-yield",
            distributionId: "moon-shell-viz-yield",
            causes: [{ kind: "law", id: "lunar-calendar" }],
          }],
        };
      }
      if (role === "truth-transition") {
        const repeatAmount = randomAmount(context.randomResults ?? []);
        const actions = context.jointActions!;
        const nextStep = context.step + 1;
        const eventId = "event:invalid-repeat-first-full-moon";
        return {
          baseRevision: context.baseRevision,
          outcomes: actions.map((action) => ({
            proposalId: action.id,
            status: action.actorId === "player" ? "succeeded" : "continuing",
            summary: "错误地重复结算同一满月节点。",
            causeRefs: [{ kind: "action", id: action.id }],
            assertions: [{
              kind: "random_result",
              requestId: "repeat-first-full-moon-shell-yield",
              stepId: "amount",
              expected: repeatAmount,
            }],
            knownAlternatives: [],
          })),
          mechanicInvocations: [],
          operations: [{
            kind: "advance_time",
            seconds: 1,
            causes: [{ kind: "law", id: "positive-time" }],
            assertions: [{
              kind: "elapsed_seconds_compare",
              operator: "eq",
              value: state.truth.elapsedSeconds,
            }],
          }, {
            kind: "produce_quantity",
            definitionId: "viz",
            holderId: "moon-shell-mermaids",
            amount: repeatAmount,
            lawId: "viz-cycle",
            causes: [
              { kind: "random", id: "repeat-first-full-moon-shell-yield" },
              { kind: "law", id: "lunar-calendar" },
              { kind: "law", id: "viz-cycle" },
            ],
            assertions: [{
              kind: "random_result",
              requestId: "repeat-first-full-moon-shell-yield",
              stepId: "amount",
              expected: repeatAmount,
            }, {
              kind: "fact_matches",
              factId: "blackmarsh-last-settled-full-moon-node",
              expected: { kind: "number", value: 0 },
            }],
          }],
          events: [{
            id: eventId,
            step: nextStep,
            description: "错误地重复生成同一满月的月贝产量。",
            impact: "significant",
            causes: [{ kind: "random", id: "repeat-first-full-moon-shell-yield" }],
            assertions: [{
              kind: "random_result",
              requestId: "repeat-first-full-moon-shell-yield",
              stepId: "amount",
              expected: repeatAmount,
            }],
          }],
          observations: completeObservations(
            Object.keys(context.agentEpistemics ?? {}),
            nextStep,
          ),
          intentStatus: "completed",
          requiresPlayerDecision: false,
        } satisfies TransitionProposal;
      }
      if (role === "causal-verifier") {
        expect(context.canonicalTruth?.facts["blackmarsh-last-settled-full-moon-node"].value)
          .toEqual({ kind: "number", value: 0 });
        expect(context.candidate?.operations[1]?.kind).toBe("produce_quantity");
        return {
          verdict: "reject",
          findings: [{
            target: { kind: "operation", id: "1:produce_quantity" },
            code: "law-violation",
            message: "满月节点 0 已结算，重复产出违反 lunar-calendar 幂等约束。",
            repairHint: "回滚本步骤并等待下一个满月节点。",
          }],
        };
      }
      throw new Error(`unexpected role ${role}`);
    }, catalog, false);
    const repeatEngine = new SimulationEngine(
      definition,
      new TruthEngine(repeatProvider, { repairAttempts: 0 }),
      new AgentMind(repeatProvider),
      state,
    );
    repeatEngine.beginPlayerIntent("在同一满月节点再等一秒。", "repeat-full-moon");
    await expect(repeatEngine.step({
      workloadId: "blackmarsh-lunar-audit",
      batchId: "blackmarsh-repeat-full-moon",
    })).rejects.toThrow("causal verifier rejected transition");
    expect(repeatEngine.snapshot).toEqual({
      ...snapshot,
      player: {
        ...snapshot.player,
        intent: repeatEngine.snapshot.player.intent,
      },
    });
    expect(repeatEngine.snapshot.revision).toBe(snapshot.revision);
    expect(repeatEngine.snapshot.history).toEqual(snapshot.history);
    expect(repeatEngine.snapshot.truth).toEqual(snapshot.truth);
  });
});
