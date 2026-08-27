import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadWorldScript } from "../../script/world-loader";
import { EagerReferenceAlgorithm } from "../eager-reference";
import type { AgentActionProposal } from "../model";
import { SimulationEngine } from "../simulation";
import { replaySimulationState } from "../transaction";
import {
  createTestModelCatalog,
  deterministicModelOutput,
  ScriptedModelProvider,
} from "../testing/model-provider";

function statusFor(outcome: string | null) {
  if (outcome === "exceptional" || outcome === "full") return "succeeded";
  if (outcome === "mixed") return "partial";
  if (outcome === "miss") return "failed";
  return "blocked";
}

describe("resolution pipeline", () => {
  it("commits a semantic plan before RNG, derives effects, atomically commits, and replays the receipt", async () => {
    const catalog = createTestModelCatalog();
    const provider = new ScriptedModelProvider(({ role, profileId, context }) => {
      if (role === "action-grounding") {
        const action = (context as { action: AgentActionProposal }).action;
        return {
          reads: [{ kind: "global", id: "world" }],
          writes: [{ kind: "global", id: "world" }],
          audienceAgentIds: [action.actorId],
          globalFallback: true,
        };
      }
      if (role === "truth-perception") return { kind: "done" };
      if (role === "truth-reaction-routing") return { requests: [] };
      if (role === "truth-resolution") {
        const input = context as {
          jointActions: AgentActionProposal[];
          actors: Record<string, { entityId: string }>;
          committedResolutionPlans: unknown[];
        };
        if (input.committedResolutionPlans.length > 0) return { kind: "done" };
        return {
          kind: "commit_plans",
          plans: input.jointActions.map((action, index) => action.actorId === "player" ? {
            id: `plan-${index}`,
            actionId: action.id,
            actorId: input.actors[action.actorId].entityId,
            targetIds: ["keeper", "player"],
            goal: action.goal,
            means: [
              { description: "the carried copper key as an improvised edge", source: { kind: "entity", id: "key" } },
              { description: "loose sand from the courtyard ground", source: { kind: "fact", id: "courtyard-sandy-ground" } },
            ],
            mode: "check",
            difficulty: {
              kind: "opposed",
              targetId: "keeper",
              ratingId: "resolve:keeper",
              source: { kind: "rating", id: "resolve:keeper" },
            },
            actorRatingId: "resolve:player",
            factors: [{
              source: { kind: "fact", id: "courtyard-sandy-ground" },
              role: "secondary",
              direction: "neutral",
              steps: 0,
              authority: "semantic",
              channel: null,
              explanation: "The grounded sand can obscure vision after the strike.",
            }],
            risk: "risky",
            baseEffect: "standard",
            primaryEffect: {
              kind: "meter",
              id: "improvised-harm",
              targetId: "keeper",
              channel: "physical-harm",
              label: "harm",
              description: "The improvised edge wounds the keeper.",
              sourceRefs: [{ kind: "entity", id: "key" }],
              meterId: "health:keeper",
              impactProfileId: "harm",
              magnitude: "standard",
            },
            secondaryEffect: {
              kind: "condition",
              id: "sand-obscures-vision",
              targetId: "keeper",
              channel: "vision",
              label: "sand in eyes",
              description: "Loose sand obscures the keeper's vision.",
              sourceRefs: [{ kind: "fact", id: "courtyard-sandy-ground" }],
              conditionId: "keeper-sand-in-eyes",
              conditionProfileId: "obscured-vision",
              durationProfileId: "brief",
              access: { kind: "public" },
              magnitude: "minor",
            },
            threatenedEffect: {
              kind: "condition",
              id: "counter-opening",
              targetId: "player",
              channel: "position",
              label: "off balance",
              description: "The attempt may leave the traveler off balance.",
              sourceRefs: [{ kind: "action", id: action.id }],
              conditionId: "player-off-balance",
              conditionProfileId: null,
              durationProfileId: "brief",
              access: { kind: "public" },
            },
            visibility: "full",
            causes: [
              { kind: "action", id: action.id },
              { kind: "fact", id: "courtyard-sandy-ground" },
            ],
          } : {
            id: `plan-${index}`,
            actionId: action.id,
            actorId: input.actors[action.actorId].entityId,
            targetIds: [input.actors[action.actorId].entityId],
            goal: action.goal,
            means: [],
            mode: "automatic",
            difficulty: null,
            actorRatingId: null,
            factors: [],
            risk: "safe",
            baseEffect: "none",
            primaryEffect: null,
            secondaryEffect: null,
            threatenedEffect: null,
            visibility: "full",
            causes: [{ kind: "action", id: action.id }],
          }),
        };
      }
      if (role === "truth-transition") {
        const input = context as {
          jointActions: AgentActionProposal[];
          resolutionReceipts: Array<{
            plan: { actionId: string };
            outcome: string | null;
            checkRequestId: string | null;
          }>;
          checkResults: Array<{ requestId: string; succeeded: boolean }>;
        };
        return {
          outcomes: input.jointActions.map((action) => {
            const receipt = input.resolutionReceipts.find((candidate) => candidate.plan.actionId === action.id)!;
            const check = receipt.checkRequestId
              ? input.checkResults.find((candidate) => candidate.requestId === receipt.checkRequestId)
              : null;
            return {
              proposalId: action.id,
              status: statusFor(receipt.outcome),
              summary: `Resolved as ${receipt.outcome ?? "blocked"}.`,
              causeRefs: [{ kind: "action", id: action.id }],
              assertions: check ? [{
                kind: "check_result",
                checkId: check.requestId,
                expected: check.succeeded ? "succeeded" : "failed",
              }] : [{ kind: "entity_lifecycle", entityId: action.actorId, expected: "active" }],
              knownAlternatives: [],
            };
          }),
          mechanicInvocations: [],
          operations: [],
          events: [],
          decisionRequests: [],
        };
      }
      if (role === "causal-verifier") return { verdict: "accept", findings: [] };
      return deterministicModelOutput(profileId, context);
    }, catalog, false);
    const definition = loadWorldScript(path.resolve("test/fixtures/open-world-script"), {
      seed: 2,
      modelCatalog: catalog,
    });
    const engine = new SimulationEngine(definition, new EagerReferenceAlgorithm(provider));
    await engine.bootstrapAgents();
    const source = engine.snapshot;
    const result = await engine.step({
      player: { kind: "external", agentId: "player", participantId: "test-player" },
      keeper: { kind: "idle", agentId: "keeper", reason: "explicit" },
    }, {
      expectedRevision: source.revision,
      trigger: "participant_action",
      simulatedSeconds: 60,
      externalActions: [{
        submissionId: "sand-strike",
        agentId: "player",
        rawText: "我用铜钥匙划向守门人，同时抓起庭院边的沙土撒向他的眼睛。",
        goal: "伤到守门人并遮蔽他的视线",
        means: "铜钥匙和脚下已有的松散沙土",
        targetIds: [],
      }],
    });

    const committed = result.committed;
    expect(committed.resolutionPlans).toHaveLength(2);
    expect(committed.resolutionReceipts).toHaveLength(2);
    const receipt = committed.resolutionReceipts.find((candidate) => candidate.plan.actorId === "player")!;
    expect(receipt.outcome).toBe("full");
    expect(receipt.checkRequestId).toBe(committed.checks.find((check) => check.requestId === receipt.checkRequestId)?.requestId);
    expect(committed.commitmentRounds).toContainEqual(expect.objectContaining({ kind: "check", phase: "resolution" }));
    expect(receipt.plan.difficulty).toMatchObject({ kind: "opposed", ratingId: "resolve:keeper" });
    expect(receipt.operations).toEqual(committed.mechanicResults
      .find((mechanic) => (mechanic.data as { receiptId?: string }).receiptId === receipt.id)?.operations);
    expect(committed.operations).toEqual(expect.arrayContaining(receipt.operations));

    const meterOperation = receipt.operations.find((operation) => operation.kind === "adjust_meter");
    const expectedVitality = 15 + (meterOperation?.kind === "adjust_meter" ? meterOperation.amount : 0);
    expect(result.state.truth.meters["health:keeper"].current).toBe(expectedVitality);
    expect(result.state.truth.conditions["keeper-sand-in-eyes"]).toMatchObject({
      subjectId: "keeper",
      label: "sand in eyes",
      magnitude: "minor",
    });
    expect(replaySimulationState(result.state)).toEqual(result.state);
  });
});
