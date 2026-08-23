import { describe, expect, it } from "vitest";
import { applyBeliefPatch } from "../belief";
import type {
  AgentState,
  BeliefPatch,
  D20CheckRequest,
  SimulationState,
  TransitionProposal,
} from "../model";
import { createSeededRng, resolveD20Checks } from "../random";
import {
  applyTransitionProposal,
  createEmptyBelief,
  TransitionValidationError,
  validateSimulationState,
} from "../transaction";

function worldState(): SimulationState {
  return {
    schemaVersion: 1,
    worldId: "test-world",
    lawIds: ["worldgen", "time-passes", "necromancy"],
    revision: 0,
    step: 0,
    truth: {
      elapsedSeconds: 0,
      rng: createSeededRng(42),
      events: [],
      entities: {
        player: {
          id: "player",
          kind: "person",
          name: "旅人",
          description: "一名旅人。",
          lifecycle: "active",
          createdAtStep: 0,
        },
        keeper: {
          id: "keeper",
          kind: "person",
          name: "守门人",
          description: "守门人。",
          lifecycle: "active",
          createdAtStep: 0,
        },
        gate: {
          id: "gate",
          kind: "door",
          name: "石门",
          description: "封闭的石门。",
          lifecycle: "active",
          createdAtStep: 0,
        },
        key: {
          id: "key",
          kind: "key",
          name: "铜钥匙",
          description: "仿制的铜钥匙。",
          lifecycle: "active",
          createdAtStep: 0,
        },
      },
      placements: { player: null, keeper: null, gate: null, key: "player" },
      facts: {
        "key-authenticity": {
          id: "key-authenticity",
          subjectId: "key",
          predicate: "authenticity",
          value: { kind: "text", value: "fake" },
          description: "这把钥匙是仿制品。",
          access: { kind: "private" },
          provenance: [{ kind: "law", id: "worldgen" }],
        },
      },
      mechanics: {
        meters: {
          health: {
            id: "health",
            name: "生命",
            min: 0,
            max: 20,
            thresholds: [
              {
                id: "death-at-zero",
                when: { operator: "lte", value: 0 },
                effects: [
                  { kind: "set_lifecycle", lifecycle: "retired" },
                  {
                    kind: "set_fact",
                    predicate: "condition",
                    value: { kind: "text", value: "dead" },
                    description: "生命已经终结。",
                  },
                ],
              },
            ],
          },
        },
        quantities: {
          spirit_stone: {
            id: "spirit_stone",
            name: "灵石",
            unit: "枚",
            allowProduction: false,
            allowConsumption: true,
          },
        },
        ratings: {
          force: { id: "force", name: "力量", min: -5, max: 10 },
        },
      },
      meters: {
        "health:keeper": {
          id: "health:keeper",
          definitionId: "health",
          entityId: "keeper",
          current: 10,
          firedThresholdIds: [],
        },
      },
      quantities: {
        "spirit_stone:player": {
          id: "spirit_stone:player",
          definitionId: "spirit_stone",
          holderId: "player",
          amount: 3,
        },
        "spirit_stone:keeper": {
          id: "spirit_stone:keeper",
          definitionId: "spirit_stone",
          holderId: "keeper",
          amount: 7,
        },
      },
      ratings: {
        "force:player": {
          id: "force:player",
          definitionId: "force",
          entityId: "player",
          value: 2,
        },
      },
    },
    agents: {
      keeper: {
        id: "keeper",
        entityId: "keeper",
        modelProfileId: "agent-default",
        persona: "谨慎的守门人",
        goals: ["守住石门"],
        belief: createEmptyBelief(),
        bindings: {},
        nextAction: {
          id: "keeper-action-0",
          actorId: "keeper",
          baseRevision: 0,
          rawText: "继续看守石门",
          goal: "不让陌生人通过",
          targetIds: [],
        },
      },
    },
    player: {
      entityId: "player",
      knowledge: { localEntities: {}, claims: {}, evidence: {}, observationIds: [] },
      bindings: {},
    },
    history: [],
    bootstrapModelAudits: [],
  };
}

function proposal(operations: TransitionProposal["operations"]): TransitionProposal {
  return {
    baseRevision: 0,
    outcomes: [],
    operations,
    events: [],
    observations: [],
    intentStatus: "active",
    requiresPlayerDecision: false,
  };
}

const causalAction = [{ kind: "action" as const, id: "player-action" }];

describe("open world kernel", () => {
  it("keeps a false belief independent from canonical truth", () => {
    const source = createEmptyBelief();
    const patch: BeliefPatch = {
      agentId: "keeper",
      baseRevision: 0,
      operations: [
        {
          kind: "upsert_local_entity",
          entity: { id: "local-key", name: "铜钥匙", description: "真正的门钥匙", status: "observed" },
        },
        {
          kind: "upsert_evidence",
          evidence: {
            id: "merchant-claim",
            kind: "testimony",
            description: "商人声称钥匙是真的。",
            step: 0,
          },
        },
        {
          kind: "upsert_claim",
          claim: {
            id: "key-is-real",
            subjectId: "local-key",
            predicate: "authenticity",
            value: { kind: "text", value: "real" },
            description: "我相信这是真钥匙。",
            stance: "believed",
            confidence: 0.9,
            evidenceIds: ["merchant-claim"],
          },
        },
      ],
    };

    const belief = applyBeliefPatch(source, patch);
    const truth = worldState();
    expect(belief.claims["key-is-real"].value).toEqual({ kind: "text", value: "real" });
    expect(truth.truth.facts["key-authenticity"].value).toEqual({ kind: "text", value: "fake" });
  });

  it("splits one uncertain local identity without creating canonical entities", () => {
    const source = createEmptyBelief();
    source.localEntities.masked = {
      id: "masked",
      name: "蒙面人",
      description: "可能是两个人中的任意一个。",
      status: "observed",
    };
    source.localEntities.letter = {
      id: "letter",
      name: "信件",
      description: "署名不清的信件。",
      status: "observed",
    };
    source.claims.identity = {
      id: "identity",
      subjectId: "masked",
      predicate: "carried",
      value: { kind: "local_entity", localEntityId: "letter" },
      description: "蒙面人携带信件。",
      stance: "suspected",
      confidence: 0.5,
      evidenceIds: [],
    };
    const patch: BeliefPatch = {
      agentId: "keeper",
      baseRevision: 0,
      operations: [{
        kind: "split_local_entity",
        fromId: "masked",
        entities: [
          { id: "masked-tall", name: "高个蒙面人", description: "较高的身影。", status: "hypothesized" },
          { id: "masked-short", name: "矮个蒙面人", description: "较矮的身影。", status: "hypothesized" },
        ],
        assignments: [{ claimId: "identity", subjectId: "masked-tall" }],
      }],
    };

    const result = applyBeliefPatch(source, patch);

    expect(result.localEntities.masked).toBeUndefined();
    expect(result.claims.identity.subjectId).toBe("masked-tall");
    expect(result.localEntities["masked-short"]).toBeDefined();
    expect(worldState().truth.entities["masked-tall"]).toBeUndefined();
  });

  it("produces reproducible d20 results and applies advantage", () => {
    const request: D20CheckRequest = {
      id: "open-gate",
      actorId: "player",
      targetId: "gate",
      ratingId: "force:player",
      modifier: 2,
      modifierSources: [{ id: "force:player", amount: 2 }],
      dc: 15,
      mode: "advantage",
      stakes: "推开石门，失败则发出巨响",
      visibility: "full",
      causes: causalAction,
    };

    const first = resolveD20Checks(createSeededRng(7), [request]);
    const second = resolveD20Checks(createSeededRng(7), [request]);
    expect(first).toEqual(second);
    expect(first.results[0].dice).toHaveLength(2);
    expect(first.results[0].kept).toBe(Math.max(...first.results[0].dice));
    expect(first.rng.draws).toBe(2);
  });

  it("transfers quantities conservatively without mutating the source", () => {
    const source = worldState();
    const next = applyTransitionProposal(
      source,
      proposal([
        {
          kind: "transfer_quantity",
          definitionId: "spirit_stone",
          fromHolderId: "keeper",
          toHolderId: "player",
          amount: 5,
          causes: causalAction,
        },
      ]),
    );

    expect(source.truth.quantities["spirit_stone:keeper"].amount).toBe(7);
    expect(next.truth.quantities["spirit_stone:keeper"].amount).toBe(2);
    expect(next.truth.quantities["spirit_stone:player"].amount).toBe(8);
  });

  it("rejects unsupported matter creation atomically", () => {
    const source = worldState();
    expect(() =>
      applyTransitionProposal(
        source,
        proposal([
          {
            kind: "produce_quantity",
            definitionId: "spirit_stone",
            holderId: "player",
            amount: 10_000,
            lawId: "wish",
            causes: causalAction,
          },
        ]),
      ),
    ).toThrow(TransitionValidationError);
    expect(source.truth.quantities["spirit_stone:player"].amount).toBe(3);
    expect(source.revision).toBe(0);
  });

  it("fires declared meter thresholds deterministically", () => {
    const next = applyTransitionProposal(
      worldState(),
      proposal([
        {
          kind: "adjust_meter",
          meterId: "health:keeper",
          amount: -10,
          causes: [{ kind: "check", id: "attack-roll" }],
        },
      ]),
    );

    expect(next.truth.entities.keeper.lifecycle).toBe("retired");
    expect(next.truth.facts["threshold:health:keeper:death-at-zero:condition"].value).toEqual({
      kind: "text",
      value: "dead",
    });
  });

  it("creates a dynamic autonomous entity without special-case code", () => {
    const skeleton: AgentState = {
      id: "skeleton-agent",
      entityId: "skeleton",
      modelProfileId: "agent-default",
      persona: "受召唤者命令的骷髅",
      goals: ["服从召唤者"],
      belief: createEmptyBelief(),
      bindings: {},
    };
    const next = applyTransitionProposal(
      worldState(),
      proposal([
        {
          kind: "create_entity",
          entity: {
            id: "skeleton",
            kind: "undead",
            name: "新生骷髅",
            description: "刚被唤起的骷髅。",
            lifecycle: "active",
            createdAtStep: 1,
          },
          placementId: "keeper",
          causes: [{ kind: "law", id: "necromancy" }],
        },
        { kind: "create_agent", agent: skeleton, causes: [{ kind: "law", id: "necromancy" }] },
      ]),
    );

    expect(next.truth.entities.skeleton.kind).toBe("undead");
    expect(next.agents["skeleton-agent"].entityId).toBe("skeleton");
  });

  it("rejects containment cycles", () => {
    const state = worldState();
    state.truth.placements.player = "key";
    expect(() => validateSimulationState(state)).toThrow("placement cycle");
  });
});
