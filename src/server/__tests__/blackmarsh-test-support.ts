import type { ModelCatalog } from "../../engine/model-catalog";
import type {
  AgentActionDraft,
  AgentActionProposal,
  CausalAssertion,
  TransitionProposal,
  TransitionProposalDraft,
} from "../../engine/model";
import { MonolithicCurrentAlgorithm } from "../../engine/monolithic-current";
import { SimulationEngine } from "../../engine/simulation";
import { ScriptedModelProvider } from "../../engine/testing/model-provider";
import { applyTransitionProposal, validateSimulationState } from "../../engine/transaction";
import type { WorldDefinition } from "../../engine/world-definition";

export const openingDeadlineSettlementSeconds = 108_000;

function nextAgentAction(agentId: string, revision: number): AgentActionDraft {
  if (revision === 0 && agentId === "sigrun-the-boneless") {
    return {
      rawText: "前哨回报补给车无法继续，我命令纵队停止本轮进军并保存骨干。",
      goal: "取消无法维持的本轮进军",
      means: "向两级指挥链发布停止命令",
      targetIds: ["column"],
    };
  }
  if (revision === 0 && agentId === "rinisar-anothil") {
    return {
      rawText: "撤离条件未成立，我取消本轮 Hydra 诱导并命令小队撤回营地。",
      goal: "取消缺少安全撤离条件的诱导行动",
      means: "通过分段信号召回十五人小队",
      targetIds: ["field-cell", "hydra"],
    };
  }
  if (revision === 0 && agentId === "lord-travvarn") {
    return {
      rawText: "依照航迹和海况继续航行，完成进入沿岸观察范围的航段。",
      goal: "完成搜索远征的当前抵达航段",
      means: "按既定航线航行并由瞭望确认海岸",
      targetIds: ["expedition", "region"],
    };
  }
  return {
    rawText: "继续处理自己能够观察和抵达的事务。",
    goal: "根据本地证据继续履行职责",
    means: null,
    targetIds: [],
  };
}

function mindOutput(agentId: string, revision: number) {
  return {
    beliefPatch: { operations: [] },
    characterPatch: { operations: [] },
    nextAction: nextAgentAction(agentId, revision),
  };
}

function outcomeObservations(agentIds: string[], step: number) {
  return ["player", ...agentIds].map((observerId) => ({
    id: `observation:deadline:${observerId}:${step}`,
    observerId,
    step,
    kind: "outcome" as const,
    summary: "你感知到时间推进，以及自己所在地能够观察到的行动结果。",
    introductions: [],
    apparentClaims: [],
    sourceEventIds: [],
  }));
}

export async function settleBlackmarshOpeningDeadlines(
  definition: WorldDefinition,
  catalog: ModelCatalog,
) {
  const source = definition.initialState;
  const settlements = [{
    actorId: "sigrun-the-boneless",
    stateFactId: "sigrun-column-operation-state",
    deadlineFactId: "sigrun-column-march-deadline",
    terminalState: "cancelled",
    eventId: "event:sigrun-march-cancelled",
    eventDescription: "Sigrun 的停止命令经两级指挥链执行，本轮 Blackoak 进军被取消。",
    causeFactId: "sigrun-column-readiness",
    evidence: {
      kind: "fact_matches",
      factId: "sigrun-column-readiness",
      expected: { kind: "text", value: "marching-with-scouts-forward-and-limited-supplies" },
    } satisfies CausalAssertion,
  }, {
    actorId: "rinisar-anothil",
    stateFactId: "rinisar-raven-cell-operation-state",
    deadlineFactId: "rinisar-raven-cell-operation-deadline",
    terminalState: "cancelled",
    eventId: "event:rinisar-lure-cancelled",
    eventDescription: "Rinisar 的撤回信号被小队执行，本轮 Hydra 诱导在没有伪报成功的情况下取消。",
    causeFactId: "eight-headed-hydra-lair",
    evidence: {
      kind: "placement_equals",
      entityId: "eight-headed-hydra",
      placementId: "hex-1701-hydra-cave",
    } satisfies CausalAssertion,
  }, {
    actorId: "lord-travvarn",
    stateFactId: "ochre-expedition-operation-state",
    deadlineFactId: "ochre-expedition-arrival-deadline",
    terminalState: "implemented",
    eventId: "event:ochre-observation-range-reached",
    eventDescription: "Ochre 船完成实际航行并进入 Sheltered Bay 外海的稳定观察范围。",
    causeFactId: "ochre-expedition-observed-profile",
    evidence: {
      kind: "placement_equals",
      entityId: "ochre-search-expedition",
      placementId: "sheltered-bay",
    } satisfies CausalAssertion,
  }] as const;

  let transitionCalls = 0;
  let verifierCalls = 0;
  const provider = new ScriptedModelProvider(({ role, prompt }) => {
    const context = JSON.parse(prompt) as {
      revision: number;
      baseRevision: number;
      step: number;
      agent?: { id: string };
      jointActions?: AgentActionProposal[];
      validationIssues?: Array<{ message: string }>;
      candidate?: TransitionProposal;
      agentEpistemics?: Record<string, unknown>;
    };
    if (role === "agent-bootstrap" || role === "agent-mind") {
      return mindOutput(context.agent!.id, context.revision);
    }
    if (role === "truth-perception" || role === "truth-resolution") return { kind: "done" };
    if (role === "truth-reaction-routing") return { requests: [] };
    if (role === "truth-transition") {
      transitionCalls += 1;
      if (transitionCalls === 2 &&
        !context.validationIssues?.[0]?.message.includes("causal verifier rejected")) {
        throw new Error("deadline repair did not receive the causal rejection");
      }
      const actions = context.jointActions!;
      const nextStep = context.step + 1;
      if (transitionCalls === 1) {
        return {
          baseRevision: context.baseRevision,
          outcomes: actions.map((action) => ({
            proposalId: action.id,
            status: "continuing",
            summary: "时间经过，但行动尚未依据现场结果结算。",
            causeRefs: [{ kind: "action", id: action.id }],
            assertions: [{ kind: "elapsed_seconds_compare", operator: "gte", value: 0 }],
            knownAlternatives: [],
          })),
          mechanicInvocations: [],
          operations: [{
            kind: "advance_time",
            seconds: openingDeadlineSettlementSeconds,
            causes: [{ kind: "law", id: "positive-time" }],
            assertions: [{ kind: "elapsed_seconds_compare", operator: "eq", value: 0 }],
          }],
          events: [{
            id: "event:unsettled-deadline-crossing",
            step: nextStep,
            description: "时间越过三个开局截止，但没有产生任何现场结算。",
            impact: "significant",
            causes: [{ kind: "law", id: "positive-time" }],
            assertions: [{
              kind: "elapsed_seconds_compare",
              operator: "gte",
              value: openingDeadlineSettlementSeconds,
            }],
          }],
          observations: outcomeObservations(
            Object.keys(context.agentEpistemics ?? {}),
            nextStep,
          ),
          intentStatus: "active",
          requiresPlayerDecision: false,
        } satisfies TransitionProposalDraft;
      }

      const operations: TransitionProposalDraft["operations"] = [{
        kind: "place_entity",
        entityId: "ochre-search-expedition",
        placementId: "sheltered-bay",
        causes: [
          { kind: "action", id: actions.find((action) => action.actorId === "lord-travvarn")!.id },
          { kind: "law", id: "situated-causality" },
        ],
        assertions: [{
          kind: "placement_equals",
          entityId: "ochre-search-expedition",
          placementId: "hex-2618-ochre-scout-ship",
        }],
      }, ...settlements.flatMap((item) => {
        const stateFact = source.truth.facts[item.stateFactId];
        const deadlineFact = source.truth.facts[item.deadlineFactId];
        if (!stateFact || !deadlineFact) {
          throw new Error(`missing deadline contract for ${item.stateFactId}`);
        }
        return [{
          kind: "set_fact" as const,
          fact: {
            ...structuredClone(stateFact),
            value: { kind: "text" as const, value: item.terminalState },
            description: `行动依据 ${item.eventId} 结算为 ${item.terminalState}。`,
          },
          causes: [{ kind: "event" as const, id: item.eventId }],
          assertions: [
            { kind: "fact_matches" as const, factId: item.stateFactId, expected: stateFact.value },
            structuredClone(item.evidence),
          ],
        }, {
          kind: "remove_fact" as const,
          factId: item.deadlineFactId,
          causes: [{ kind: "event" as const, id: item.eventId }],
          assertions: [
            { kind: "fact_matches" as const, factId: item.deadlineFactId, expected: deadlineFact.value },
            structuredClone(item.evidence),
          ],
        }];
      })];
      operations.push({
        kind: "advance_time",
        seconds: openingDeadlineSettlementSeconds,
        causes: [{ kind: "law", id: "positive-time" }],
        assertions: [{ kind: "elapsed_seconds_compare", operator: "eq", value: 0 }],
      });
      return {
        baseRevision: context.baseRevision,
        outcomes: actions.map((action) => {
          const ownSettlement = settlements.find((item) => item.actorId === action.actorId);
          return {
            proposalId: action.id,
            status: ownSettlement || action.actorId === "player" ? "succeeded" : "continuing",
            summary: ownSettlement
              ? ownSettlement.eventDescription
              : action.actorId === "player"
                ? "等待动作完成；这本身没有让玩家自动得知远方现场结果。"
                : "该行动与三个截止的独立现场结算一同接受联合裁决。",
            causeRefs: [
              { kind: "action" as const, id: action.id },
              ...(ownSettlement ? [{ kind: "event" as const, id: ownSettlement.eventId }] : []),
            ],
            assertions: [{
              kind: "elapsed_seconds_compare" as const,
              operator: "gte" as const,
              value: openingDeadlineSettlementSeconds,
            }],
            knownAlternatives: [],
          };
        }),
        mechanicInvocations: [],
        operations,
        events: settlements.map((item) => ({
          id: item.eventId,
          step: nextStep,
          description: item.eventDescription,
          impact: "significant" as const,
          causes: [
            {
              kind: "action" as const,
              id: actions.find((action) => action.actorId === item.actorId)!.id,
            },
            { kind: "fact" as const, id: item.causeFactId },
            { kind: "law" as const, id: "deadline-integrity" },
          ],
          assertions: [
            structuredClone(item.evidence),
            {
              kind: "elapsed_seconds_compare" as const,
              operator: "gte" as const,
              value: openingDeadlineSettlementSeconds,
            },
          ],
        })),
        observations: outcomeObservations(
          Object.keys(context.agentEpistemics ?? {}),
          nextStep,
        ),
        intentStatus: "completed",
        requiresPlayerDecision: false,
      } satisfies TransitionProposalDraft;
    }
    if (role === "causal-verifier") {
      verifierCalls += 1;
      if (verifierCalls === 1) {
        const invalidCandidate = applyTransitionProposal(source, context.candidate!);
        for (const item of settlements) {
          if (!invalidCandidate.truth.facts[item.deadlineFactId] ||
            JSON.stringify(invalidCandidate.truth.facts[item.stateFactId].value) ===
              JSON.stringify({ kind: "text", value: item.terminalState })) {
            throw new Error(`crossing-only candidate unexpectedly settled ${item.stateFactId}`);
          }
        }
        return {
          verdict: "reject",
          findings: [{
            target: { kind: "operation", id: "0:advance_time" },
            code: "law-violation",
            message: "达到或越过绝对截止却保留 preparing/in-progress 与过期 deadline。",
            repairHint: "依据独立现场结果原子写入 terminal state 并移除 deadline。",
          }],
        };
      }
      return { verdict: "accept", findings: [] };
    }
    throw new Error(`unexpected role ${role}`);
  }, catalog, false);

  const engine = new SimulationEngine(
    definition,
    new MonolithicCurrentAlgorithm(provider),
  );
  await engine.bootstrapAgents();
  engine.beginPlayerIntent("在港区原地等待到第 108000 秒，不假设知晓远方行动结果。", "deadline-audit");
  const result = await engine.step({
    workloadId: "blackmarsh-deadline-audit",
    batchId: "blackmarsh-deadline-audit-run",
  });
  validateSimulationState(result.state, true, true);

  return {
    engine,
    result,
    source,
    state: result.state,
    transitionCalls,
    verifierCalls,
  };
}
