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
import { validateObservations } from "../observation";
import {
  applyTransitionProposal,
  createEmptyCharacter,
  createEmptyBelief,
  TransitionValidationError,
  validateSimulationState,
} from "../transaction";
import { TEST_WORLD_HASH } from "../testing/world";

function worldState(): SimulationState {
  return {
    schemaVersion: 5,
    worldId: "test-world",
    worldHash: TEST_WORLD_HASH,
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
            productionLawIds: [],
            consumptionLawIds: ["necromancy"],
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
        modelProfiles: { bootstrap: "agent-default", mind: "agent-default", reaction: "agent-default" },
        character: createEmptyCharacter("谨慎的守门人"),
        belief: {
          localEntities: {
            self: { id: "self", name: "我", description: "守门人自己", status: "observed" },
          },
          claims: {},
          evidence: {},
        },
        bindings: { self: { localEntityId: "self", canonicalEntityIds: ["keeper"] } },
        nextAction: {
          id: "keeper-action-0",
          actorId: "keeper",
          baseRevision: 0,
          rawText: "继续看守石门",
          goal: "不让陌生人通过",
          means: null,
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
    mechanicInvocations: [],
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
            sourceId: null,
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
        assignments: [{ claimId: "identity", subjectId: "masked-tall", valueId: null }],
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
      modifierSources: [{ kind: "rating", id: "force:player", amount: 2 }],
      dc: 15,
      mode: "advantage",
      stakes: "推开石门，失败则发出巨响",
      visibility: "full",
      phase: "resolution",
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
          assertions: [{ kind: "quantity_compare", definitionId: "spirit_stone", holderId: "keeper", operator: "gte", value: 5 }],
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
            assertions: [{ kind: "elapsed_seconds_compare", operator: "gte", value: 0 }],
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
          assertions: [{ kind: "elapsed_seconds_compare", operator: "gte", value: 0 }],
        },
      ]),
    );

    expect(next.truth.entities.keeper.lifecycle).toBe("retired");
    expect(next.truth.facts["threshold:health:keeper:death-at-zero:condition"].value).toEqual({
      kind: "text",
      value: "dead",
    });
  });

  it("rejects prototype-polluting record identifiers before state mutation", () => {
    const source = worldState();
    expect(() => applyTransitionProposal(
      source,
      proposal([{
        kind: "set_fact",
        fact: {
          id: "__proto__",
          subjectId: "player",
          predicate: "unsafe",
          value: { kind: "text", value: "must-not-be-written" },
          description: "恶意对象键不得进入状态字典。",
          access: { kind: "public" },
          provenance: [{ kind: "law", id: "worldgen" }],
        },
        causes: [{ kind: "law", id: "worldgen" }],
        assertions: [{ kind: "elapsed_seconds_compare", operator: "gte", value: 0 }],
      }]),
    )).toThrow("reserved object key");
    expect(Object.getPrototypeOf(source.truth.facts)).toBe(Object.prototype);
    expect(Object.hasOwn(source.truth.facts, "__proto__")).toBe(false);
  });

  it("rejects identifiers inherited from Object.prototype before state mutation", () => {
    const source = worldState();
    expect(() => applyTransitionProposal(
      source,
      proposal([{
        kind: "set_fact",
        fact: {
          id: "toString",
          subjectId: "player",
          predicate: "unsafe",
          value: { kind: "boolean", value: true },
          description: "不得覆盖对象原型成员。",
          access: { kind: "public" },
          provenance: [{ kind: "law", id: "worldgen" }],
        },
        causes: [{ kind: "law", id: "worldgen" }],
        assertions: [{ kind: "elapsed_seconds_compare", operator: "gte", value: 0 }],
      }]),
    )).toThrow("reserved object key");
    expect(Object.hasOwn(source.truth.facts, "toString")).toBe(false);
  });

  it("rejects observation introductions that overwrite an existing private identity", () => {
    const source = worldState();
    expect(() => validateObservations(source, [{
      id: "observation:rebind-self",
      observerId: "keeper",
      step: 1,
      kind: "outcome",
      summary: "试图用 introduction 重写既有 self。",
      introductions: [{
        localEntity: { id: "self", name: "伪造身份", description: "覆盖既有局部身份", status: "observed" },
        canonicalEntityId: "player",
      }],
      apparentClaims: [],
      sourceEventIds: [],
    }])).toThrow("reintroduces local entity self");
  });

  it("creates a dynamic autonomous entity without special-case code", () => {
    const skeleton: AgentState = {
      id: "skeleton-agent",
      entityId: "skeleton",
      modelProfiles: { bootstrap: "agent-default", mind: "agent-default", reaction: "agent-default" },
      character: createEmptyCharacter("受召唤者命令的骷髅"),
      belief: {
        localEntities: {
          self: { id: "self", name: "我", description: "骷髅自己", status: "observed" },
        },
        claims: {},
        evidence: {},
      },
      bindings: { self: { localEntityId: "self", canonicalEntityIds: ["skeleton"] } },
      nextAction: null,
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
          assertions: [{ kind: "entity_absent", entityId: "skeleton" }],
        },
        {
          kind: "create_agent",
          agent: skeleton,
          causes: [{ kind: "law", id: "necromancy" }],
          assertions: [{ kind: "entity_lifecycle", entityId: "skeleton", expected: "active" }],
        },
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
