import path from "node:path";
import { describe, expect, it } from "vitest";
import type { AgentActionProposal, TransitionProposal } from "../../contracts/model";
import { ObservationRenderer, normalizeObservationLocalReferences } from "../observation-renderer";
import { ScriptedModelProvider, createTestModelCatalog } from "../../testing/model-provider";
import { loadWorldScript } from "../../../script/world-loader";
import { validateAlgorithmTelemetryEvent, type RuntimeEventInput, type RuntimeObserver } from "../../runtime/observability";

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

  it("repairs one observer that copies protected canonical truth", async () => {
    let calls = 0;
    const catalog = createTestModelCatalog();
    const provider = new ScriptedModelProvider(() => ({
      summary: calls++ === 0 ? "钥匙是仿制品，无法打开石门。" : "你仍只能依据商人的说法判断这把钥匙。",
      introductions: [],
      apparentClaims: [],
      sourceEventRefs: [],
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
      repair: { issues: [{ reason: expect.stringContaining("protected information") }] },
    });
    const context = provider.requests[0].context as {
      state: {
        canonicalTruth: { entities: Record<string, unknown>; facts: Record<string, unknown> };
        observationSlots: Array<{ observer: Record<string, unknown> }>;
      };
    };
    expect(Object.keys(context.state.canonicalTruth.entities)).toEqual(expect.arrayContaining([
      "ref:entity:courtyard",
      "ref:entity:key",
      "ref:entity:player",
    ]));
    expect(Object.keys(context.state.canonicalTruth.facts)).toEqual(expect.arrayContaining([
      "ref:fact:courtyard-sandy-ground",
      "ref:fact:gate-lock",
    ]));
    expect(context.state.observationSlots[0]?.observer).toMatchObject({
      agentRef: "ref:agent:player",
      selfEntityRef: "ref:entity:player",
      placementRef: "ref:placement:player",
      localEntities: expect.arrayContaining([
        expect.objectContaining({ ref: "ref:local_entity:player::copper-key", name: "铜钥匙" }),
      ]),
      privateFacts: [],
    });
    expect(context.state.observationSlots[0]?.observer).not.toHaveProperty("perspective");
    expect(context.state.observationSlots[0]?.observer).not.toHaveProperty("history");
    expect(context.state.observationSlots[0]?.observer).not.toHaveProperty("character");
  });

  it("repairs and falls back one observer without replaying another observer", async () => {
    const catalog = createTestModelCatalog();
    const calls = new Map<string, number>();
    const provider = new ScriptedModelProvider(({ context }) => {
      const observerRef = (context as {
        state: { observationSlots: Array<{ observer: { agentRef: string } }> };
      }).state.observationSlots[0]!.observer.agentRef;
      const observerId = observerRef.replace(/^ref:agent:/u, "");
      calls.set(observerId, (calls.get(observerId) ?? 0) + 1);
      if (observerId === "keeper") {
        return {
          summary: "缺少结构字段的观察。",
          introductions: [],
          sourceEventRefs: [],
        };
      }
      return {
        summary: "你观察到世界仍在变化。",
        introductions: [],
        apparentClaims: [],
        sourceEventRefs: [],
      };
    }, catalog, false);
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
    expect(rendered.packets.find((packet) => packet.observerId === "player")?.summary)
      .toBe("你观察到世界仍在变化。");
    expect(rendered.packets.find((packet) => packet.observerId === "keeper")?.summary)
      .toContain("没有形成其他可确认的观察");
    expect(calls).toEqual(new Map([["player", 1], ["keeper", 3]]));
    expect(rendered.batchCount).toBe(4);
    expect(provider.requests).toHaveLength(4);
    const invocationIds = rendered.modelAudits.flatMap((audit) => audit.invocations.map((invocation) => invocation.id));
    expect(new Set(invocationIds).size).toBe(invocationIds.length);
  });

  it("uses a typed uncertainty observation after singleton repair exhaustion", async () => {
    const catalog = createTestModelCatalog();
    const provider = new ScriptedModelProvider(() => ({}), catalog, false);
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

    const algorithmEvents: RuntimeEventInput[] = [];
    const observer: RuntimeObserver = {
      mode: "metrics",
      degraded: false,
      emit(input) {
        if (input.event.startsWith("algorithm.")) validateAlgorithmTelemetryEvent(input);
        algorithmEvents.push(input);
        return undefined;
      },
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
      observer,
    });

    expect(rendered.packets[0].summary).toContain("没有形成其他可确认的观察");
    expect(rendered.modelAudits[0].invocations).toHaveLength(3);
    expect(provider.requests).toHaveLength(3);
    expect(algorithmEvents).toContainEqual(expect.objectContaining({
      event: "algorithm.observation.repair_fallback",
      attributes: {
        phase: "observation",
        batch: "advance-test",
        policy: "typed-uncertainty-observation",
      },
      counts: { observationFallbacks: 1 },
    }));
  });
});
