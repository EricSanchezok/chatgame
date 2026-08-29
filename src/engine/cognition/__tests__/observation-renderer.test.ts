import path from "node:path";
import { describe, expect, it } from "vitest";
import type { AgentActionProposal, TransitionProposal } from "../../contracts/model";
import { ObservationRenderer, normalizeObservationLocalReferences } from "../observation-renderer";
import { ScriptedModelProvider, createTestModelCatalog } from "../../testing/model-provider";
import { loadWorldScript } from "../../../script/world-loader";

describe("ObservationRenderer", () => {
  it("reuses an observer's existing local alias for a known canonical Entity", () => {
    const catalog = createTestModelCatalog();
    const definition = loadWorldScript(path.resolve("test/fixtures/open-world-script"), {
      seed: 4,
      modelCatalog: catalog,
    });
    const normalized = normalizeObservationLocalReferences(definition.initialState, ["player"], [{
      summary: "门锁仍在原处。",
      introductions: [{
        localEntity: { id: "fresh-key-alias", name: "铜钥匙", description: "同一把铜钥匙", status: "observed" },
        canonicalEntityId: "key",
      }],
      apparentClaims: [{
        subjectId: "fresh-key-alias",
        predicate: "存在",
        value: { kind: "text", value: "铜钥匙" },
        description: "门锁存在",
      }],
      sourceEventIds: [],
    }]);
    expect(normalized.drafts[0]?.introductions).toEqual([]);
    expect(normalized.drafts[0]?.apparentClaims[0]?.subjectId).toBe("copper-key");
    expect(normalized.droppedIntroductions).toBe(1);
  });

  it("repairs a batch that copies protected canonical truth", async () => {
    let calls = 0;
    const catalog = createTestModelCatalog();
    const provider = new ScriptedModelProvider(() => ({
      observations: [{
        summary: calls++ === 0 ? "钥匙是仿制品，无法打开石门。" : "你仍只能依据商人的说法判断这把钥匙。",
        introductions: [],
        apparentClaims: [],
        sourceEventIds: [],
      }],
    }), catalog, false);
    const definition = loadWorldScript(path.resolve("test/fixtures/open-world-script"), {
      seed: 1,
      modelCatalog: catalog,
    });
    const state = definition.initialState;
    const action: AgentActionProposal = {
      id: "action-player",
      actorId: "player",
      baseRevision: state.revision,
      rawText: "观察钥匙",
      goal: "了解眼前物品",
      means: null,
      targetIds: ["copper-key"],
    };
    const proposal: TransitionProposal = {
      baseRevision: state.revision,
      outcomes: [],
      mechanicInvocations: [],
      operations: [{
        kind: "advance_time",
        seconds: 1,
        causes: [{ kind: "action", id: action.id }],
        assertions: [{ kind: "elapsed_seconds_compare", operator: "eq", value: state.truth.elapsedSeconds }],
      }],
      events: [],
      observations: [],
      decisionRequests: [],
    };

    const rendered = await new ObservationRenderer(provider).render({
      definition,
      state,
      proposal,
      actions: [action],
      observerIds: ["player"],
      identityOwner: "component-player:transition-0",
    }, {
      workloadId: "instance-test",
      batchId: "advance-test",
      runtimeIdentity: { worldHash: state.worldHash, revision: state.revision },
    });

    expect(rendered.packets[0].summary).toBe("你仍只能依据商人的说法判断这把钥匙。");
    expect(provider.requests).toHaveLength(2);
    expect(provider.requests[1].context).toMatchObject({
      validationIssues: [expect.stringContaining("protected information")],
    });
    const context = provider.requests[0].context as {
      candidateWorld: { publicFacts: unknown[] };
      observationSlots: Array<{ observer: Record<string, unknown> }>;
    };
    expect(context.candidateWorld.publicFacts).toBeInstanceOf(Array);
    expect(context.observationSlots[0]?.observer).toMatchObject({
      agentId: "player",
      entityId: "player",
      placementEntityId: "courtyard",
      localEntities: expect.arrayContaining([
        expect.objectContaining({ id: "copper-key" }),
      ]),
      knownBindings: expect.arrayContaining([
        { localEntityId: "copper-key", canonicalEntityIds: ["key"] },
      ]),
      privateFacts: [],
    });
    expect(context.observationSlots[0]?.observer).not.toHaveProperty("perspective");
    expect(context.observationSlots[0]?.observer).not.toHaveProperty("history");
    expect(context.observationSlots[0]?.observer).not.toHaveProperty("character");
  });

  it("splits a batch whose output never covers all preallocated slots", async () => {
    const catalog = createTestModelCatalog();
    const provider = new ScriptedModelProvider(({ context }) => ({
      observations: (context as { observationSlots: unknown[] }).observationSlots.slice(0, 1).map(() => ({
        summary: "你观察到世界仍在变化。",
        introductions: [],
        apparentClaims: [],
        sourceEventIds: [],
      })),
    }), catalog, false);
    const definition = loadWorldScript(path.resolve("test/fixtures/open-world-script"), {
      seed: 2,
      modelCatalog: catalog,
    });
    const state = definition.initialState;
    const actions = ["player", "keeper"].map((actorId): AgentActionProposal => ({
      id: `action-${actorId}`,
      actorId,
      baseRevision: state.revision,
      rawText: "观察",
      goal: "了解当前情况",
      means: null,
      targetIds: [],
    }));
    const proposal: TransitionProposal = {
      baseRevision: state.revision,
      outcomes: [],
      mechanicInvocations: [],
      operations: [{
        kind: "advance_time",
        seconds: 1,
        causes: actions.map((action) => ({ kind: "action" as const, id: action.id })),
        assertions: [{ kind: "elapsed_seconds_compare", operator: "eq", value: state.truth.elapsedSeconds }],
      }],
      events: [],
      observations: [],
      decisionRequests: [],
    };

    const rendered = await new ObservationRenderer(provider).render({
      definition,
      state,
      proposal,
      actions,
      observerIds: ["player", "keeper"],
      identityOwner: "component-two:transition-0",
    }, {
      workloadId: "instance-test",
      batchId: "advance-test",
      runtimeIdentity: { worldHash: state.worldHash, revision: state.revision },
    });

    expect(rendered.packets.map((packet) => packet.observerId).sort()).toEqual(["keeper", "player"]);
    expect(rendered.batchCount).toBe(3);
    expect(provider.requests).toHaveLength(5);
    const invocationIds = rendered.modelAudits.flatMap((audit) => audit.invocations.map((invocation) => invocation.id));
    expect(new Set(invocationIds).size).toBe(invocationIds.length);
  });

  it("uses a typed uncertainty observation after singleton repair exhaustion", async () => {
    const catalog = createTestModelCatalog();
    const provider = new ScriptedModelProvider(() => ({ observations: [] }), catalog, false);
    const definition = loadWorldScript(path.resolve("test/fixtures/open-world-script"), {
      seed: 3,
      modelCatalog: catalog,
    });
    const state = definition.initialState;
    const action: AgentActionProposal = {
      id: "action-player",
      actorId: "player",
      baseRevision: state.revision,
      rawText: "等待",
      goal: "保持安全",
      means: null,
      targetIds: [],
    };
    const proposal: TransitionProposal = {
      baseRevision: state.revision,
      outcomes: [],
      mechanicInvocations: [],
      operations: [{
        kind: "advance_time",
        seconds: 1,
        causes: [{ kind: "action", id: action.id }],
        assertions: [{ kind: "elapsed_seconds_compare", operator: "eq", value: state.truth.elapsedSeconds }],
      }],
      events: [],
      observations: [],
      decisionRequests: [],
    };

    const rendered = await new ObservationRenderer(provider).render({
      definition,
      state,
      proposal,
      actions: [action],
      observerIds: ["player"],
      identityOwner: "component-player:transition-0",
    }, {
      workloadId: "instance-test",
      batchId: "advance-test",
      runtimeIdentity: { worldHash: state.worldHash, revision: state.revision },
    });

    expect(rendered.packets[0].summary).toContain("没有形成其他可确认的观察");
    expect(rendered.modelAudits[0].invocations).toHaveLength(3);
    expect(provider.requests).toHaveLength(3);
  });
});
