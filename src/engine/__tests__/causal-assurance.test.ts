import path from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { loadWorldScript } from "../../script/world-loader";
import { AgentMind } from "../agent-mind";
import { evaluateProposalCausality } from "../causality";
import type {
  D20CheckRequest,
  D20CheckResult,
  SimulationState,
  TransitionProposal,
  WorldDeltaOperation,
} from "../model";
import { createCoreRulePackageRegistry, RulePackageRegistry } from "../rule-package";
import { SimulationEngine } from "../simulation";
import { ScriptedModelProvider, createTestModelCatalog } from "../testing/model-provider";
import { TruthEngine } from "../truth-engine";
import { summarizeModelExecutionAudit } from "../model-provider";

const fixture = path.resolve("test/fixtures/open-world-script");

function loadedWorld() {
  const catalog = createTestModelCatalog(["truth-deepseek", "agent-deepseek"]);
  return { catalog, definition: loadWorldScript(fixture, { seed: 7, modelCatalog: catalog }) };
}

function resolutionCheck(state: SimulationState): { request: D20CheckRequest; result: D20CheckResult } {
  const request: D20CheckRequest = {
    id: "impact-check",
    actorId: state.player.entityId,
    targetId: "keeper",
    ratingId: null,
    modifier: 0,
    modifierSources: [],
    dc: 10,
    mode: "normal",
    stakes: "成功会对守门人的生命 Meter 产生影响。",
    visibility: "full",
    phase: "resolution",
    causes: [{ kind: "law", id: "time-passes" }],
  };
  return {
    request,
    result: {
      requestId: request.id,
      dice: [15],
      kept: 15,
      modifier: 0,
      total: 15,
      dc: 10,
      succeeded: true,
      margin: 5,
      visibility: "full",
    },
  };
}

describe("causal assurance", () => {
  it("requires a check-result assertion wherever a check is cited", () => {
    const { definition } = loadedWorld();
    const { result } = resolutionCheck(definition.initialState);
    const proposal: TransitionProposal = {
      baseRevision: 0,
      outcomes: [{
        proposalId: "attempt",
        status: "succeeded",
        summary: "尝试成功。",
        causeRefs: [{ kind: "action", id: "attempt" }, { kind: "check", id: result.requestId }],
        assertions: [{ kind: "elapsed_seconds_compare", operator: "gte", value: 0 }],
        knownAlternatives: [],
      }],
      mechanicInvocations: [],
      operations: [{
        kind: "advance_time",
        seconds: 1,
        causes: [{ kind: "law", id: "time-passes" }],
        assertions: [{ kind: "elapsed_seconds_compare", operator: "eq", value: 0 }],
      }],
      events: [{
        id: "event:attempt",
        step: 1,
        description: "时间推进。",
        impact: "ordinary",
        causes: [{ kind: "law", id: "time-passes" }],
        assertions: [{ kind: "elapsed_seconds_compare", operator: "eq", value: 1 }],
      }],
      observations: [],
      intentStatus: "completed",
      requiresPlayerDecision: false,
    };

    expect(() => evaluateProposalCausality(definition.initialState, [result], proposal))
      .toThrow("without asserting its result");
  });

  it("derives check-driven Meter changes through the trusted hook and blocks direct bypass", () => {
    const { definition } = loadedWorld();
    const { request, result } = resolutionCheck(definition.initialState);
    const registry = createCoreRulePackageRegistry();
    const context = {
      state: definition.initialState,
      actions: [],
      checkRequests: [request],
      checkResults: [result],
    };
    const assertions = [{
      kind: "check_result" as const,
      checkId: request.id,
      expected: "succeeded" as const,
    }];

    expect(() => registry.resolve(definition.rulePackages, context, [], [{
      kind: "adjust_meter",
      meterId: "health:keeper",
      amount: -3,
      causes: [{ kind: "check", id: request.id }],
      assertions,
    }])).toThrow("must use core-d20/apply-meter-impact");

    const resolved = registry.resolve(definition.rulePackages, context, [{
      id: "impact:keeper",
      packageId: "core-d20",
      ruleId: "apply-meter-impact",
      input: {
        checkId: request.id,
        expected: "succeeded",
        recipient: "target",
        meterId: "health:keeper",
        amount: -3,
      },
      causes: [{ kind: "check", id: request.id }],
      assertions,
    }], []);

    expect(resolved.results).toHaveLength(1);
    expect(resolved.operations[0]).toMatchObject({
      kind: "adjust_meter",
      meterId: "health:keeper",
      amount: -3,
      causes: expect.arrayContaining([{ kind: "mechanic", id: "impact:keeper" }]),
    });
  });

  it("isolates rule execution and validates every derived operation", () => {
    const { definition } = loadedWorld();
    const registry = new RulePackageRegistry([{
      id: "test-rules",
      version: "1.0.0",
      configSchema: z.strictObject({}),
      adjudication: "测试规则隔离。",
      rules: [{
        id: "mutate-and-return",
        description: "尝试污染输入并返回由测试选择的 operation。",
        inputSchema: z.strictObject({ invalid: z.boolean() }),
        resolve: (context, _config, input) => {
          context.state.truth.elapsedSeconds = 999;
          const invalid = (input as { invalid: boolean }).invalid;
          return {
            code: "tested",
            data: null,
            operations: [{
              kind: "advance_time",
              seconds: invalid ? 0 : 1,
              causes: [{ kind: "law", id: "time-passes" }],
              assertions: [{ kind: "elapsed_seconds_compare", operator: "eq", value: 0 }],
            } as WorldDeltaOperation],
          };
        },
      }],
    }]);
    const references = registry.validate([{ id: "test-rules", version: "1.0.0", config: {} }]);
    const invocation = (invalid: boolean) => ({
      id: `test:${invalid}`,
      packageId: "test-rules",
      ruleId: "mutate-and-return",
      input: { invalid },
      causes: [{ kind: "law" as const, id: "time-passes" }],
      assertions: [{ kind: "elapsed_seconds_compare" as const, operator: "eq" as const, value: 0 }],
    });
    const context = {
      state: definition.initialState,
      actions: [],
      checkRequests: [],
      checkResults: [],
    };

    expect(registry.resolve(references, context, [invocation(false)], []).operations[0])
      .toMatchObject({ kind: "advance_time", seconds: 1 });
    expect(definition.initialState.truth.elapsedSeconds).toBe(0);
    expect(() => registry.resolve(references, context, [invocation(true)], [])).toThrow();
    expect(definition.initialState.truth.elapsedSeconds).toBe(0);
  });

  it("routes every stage to its profile and repairs a transition rejected by the independent verifier", async () => {
    const { catalog, definition } = loadedWorld();
    let transitionCalls = 0;
    let verifierCalls = 0;
    const provider = new ScriptedModelProvider(({ role, prompt }) => {
      const context = JSON.parse(prompt) as {
        revision: number;
        baseRevision: number;
        step: number;
        agent?: { id: string };
        jointActions: Array<{ id: string }>;
        agentEpistemics: Record<string, unknown>;
        validationIssues: Array<{ message: string }>;
        candidate?: TransitionProposal;
      };
      if (role === "agent-bootstrap" || role === "agent-mind") {
        const agentId = context.agent!.id;
        return {
          beliefPatch: { agentId, baseRevision: context.revision, operations: [] },
          characterPatch: { agentId, baseRevision: context.revision, operations: [] },
          nextAction: {
            id: `next:${agentId}:${context.revision}`,
            actorId: agentId,
            baseRevision: context.revision,
            rawText: "继续守门",
            goal: "履行职责",
            means: null,
            targetIds: [],
          },
        };
      }
      if (role === "truth-perception" || role === "truth-resolution") return { kind: "done" };
      if (role === "truth-reaction-routing") return { requests: [] };
      if (role === "truth-transition") {
        transitionCalls += 1;
        if (transitionCalls === 2) {
          expect(context.validationIssues[0].message).toContain("causal verifier rejected");
        }
        const nextStep = context.step + 1;
        const eventId = `event:${nextStep}`;
        return {
          baseRevision: context.baseRevision,
          outcomes: context.jointActions.map((action) => ({
            proposalId: action.id,
            status: "succeeded",
            summary: "联合行动得到合理结算。",
            causeRefs: [{ kind: "action", id: action.id }],
            assertions: [{ kind: "elapsed_seconds_compare", operator: "gte", value: 0 }],
            knownAlternatives: [],
          })),
          mechanicInvocations: [],
          operations: [{
            kind: "advance_time",
            seconds: 1,
            causes: [{ kind: "law", id: "time-passes" }],
            assertions: [{ kind: "elapsed_seconds_compare", operator: "gte", value: 0 }],
          }],
          events: [{
            id: eventId,
            step: nextStep,
            description: "世界推进一秒。",
            impact: "ordinary",
            causes: [{ kind: "law", id: "time-passes" }],
            assertions: [{ kind: "elapsed_seconds_compare", operator: "gte", value: 1 }],
          }],
          observations: ["player", ...Object.keys(context.agentEpistemics)].map((observerId) => ({
            id: `observation:${observerId}:${nextStep}`,
            observerId,
            step: nextStep,
            kind: "outcome",
            summary: "你感知到时间流逝。",
            introductions: [],
            apparentClaims: [],
            sourceEventIds: [eventId],
          })),
          intentStatus: "completed",
          requiresPlayerDecision: false,
        };
      }
      if (role === "causal-verifier") {
        verifierCalls += 1;
        if (verifierCalls === 1) {
          return {
            verdict: "reject",
            findings: [{
              target: { kind: "outcome", id: context.candidate!.outcomes[0].proposalId },
              code: "missing-precondition",
              message: "结果摘要缺少一个开放语义前提。",
              repairHint: "在下一候选中补足语义依据。",
            }],
          };
        }
        return { verdict: "accept", findings: [] };
      }
      throw new Error(`unexpected role ${role}`);
    }, catalog, false);
    const engine = new SimulationEngine(definition, new TruthEngine(provider), new AgentMind(provider));
    await engine.bootstrapAgents();
    engine.beginPlayerIntent("在原地等待一秒");
    const result = await engine.step();

    expect(transitionCalls).toBe(2);
    expect(verifierCalls).toBe(2);
    expect(result.committed.causalVerification).toEqual({ verdict: "accept", findings: [] });
    expect(result.committed.modelAudits.filter((audit) => audit.role.startsWith("truth-") ||
      audit.role === "causal-verifier").map((audit) => audit.profileId)).toEqual([
      "truth-deepseek",
      "truth-deepseek",
      "truth-deepseek",
      "truth-deepseek",
      "truth-deepseek",
    ]);
    expect(summarizeModelExecutionAudit(
      result.committed.modelAudits.find((audit) => audit.role === "truth-transition")!,
    ))
      .toMatchObject({ invocations: 2, repairAttempts: 1 });
  });
});
