import path from "node:path";
import { describe, expect, it } from "vitest";
import { ScriptedModelProvider, type ScriptedModelHandler } from "../../engine/model-provider";
import type { TransitionProposal } from "../../engine/model";
import { FileWorldRepository } from "../../script/world-repository";
import { WorldHost } from "../world-host";
import { MemoryWorldSessionStore } from "../world-session-store";

const fixtureRoot = path.resolve("test/fixtures");

function mindOutput(agentId: string, revision: number) {
  return {
    beliefPatch: { agentId, baseRevision: revision, operations: [] },
    nextAction: {
      id: `agent-action:${agentId}:${revision}`,
      actorId: agentId,
      baseRevision: revision,
      rawText: "继续根据自己的认知看守石门",
      goal: "守住石门",
      targetIds: [],
    },
  };
}

function transition(context: {
  baseRevision: number;
  step: number;
  jointActions: Array<{ id: string }>;
}): TransitionProposal {
  const nextStep = context.step + 1;
  const eventId = `event:${nextStep}`;
  return {
    baseRevision: context.baseRevision,
    outcomes: context.jointActions.map((action) => ({
      actionId: action.id,
      status: "succeeded",
      summary: "联合行动已被裁决。",
      causeRefs: [{ kind: "action", id: action.id }],
      knownAlternatives: [],
    })),
    operations: [
      {
        kind: "advance_time",
        seconds: 10,
        causes: [{ kind: "law", id: "time-passes" }],
      },
    ],
    events: [
      {
        id: eventId,
        step: nextStep,
        description: "石门前过去了十秒。",
        causes: [{ kind: "law", id: "time-passes" }],
      },
    ],
    observations: [
      {
        id: `observation:player:${nextStep}`,
        observerId: "player",
        step: nextStep,
        summary: "你看见守门人仍站在石门前。",
        introductions: [
          {
            localEntity: {
              id: "gatekeeper",
              name: "守门人",
              description: "站在石门前的守卫。",
              status: "observed",
            },
            canonicalEntityId: "keeper",
          },
        ],
        apparentClaims: [],
        sourceEventIds: [eventId],
      },
      {
        id: `observation:keeper:${nextStep}`,
        observerId: "keeper",
        step: nextStep,
        summary: "旅人仍在门前。",
        introductions: [],
        apparentClaims: [],
        sourceEventIds: [eventId],
      },
    ],
    intentStatus: "completed",
    requiresPlayerDecision: false,
  };
}

function normalHandler(): ScriptedModelHandler {
  return ({ profileId, prompt }) => {
    const context = JSON.parse(prompt) as {
      baseRevision: number;
      step: number;
      jointActions: Array<{ id: string }>;
      revision: number;
      agent: { id: string };
    };
    if (profileId === "truth-engine") return { kind: "transition", proposal: transition(context) };
    return mindOutput(context.agent.id, context.revision);
  };
}

function createHost(
  provider: ScriptedModelProvider,
  store = new MemoryWorldSessionStore(),
): { host: WorldHost; store: MemoryWorldSessionStore } {
  let id = 0;
  return {
    host: new WorldHost({
      repository: new FileWorldRepository(fixtureRoot),
      store,
      provider,
      idFactory: () => `test-${++id}`,
      now: () => new Date("2026-08-23T00:00:00.000Z"),
      maxStepsPerRun: 4,
    }),
    store,
  };
}

describe("WorldHost", () => {
  it("persists every committed step and emits only player-safe observations", async () => {
    const provider = new ScriptedModelProvider(normalHandler());
    const { host, store } = createHost(provider);
    const session = await host.createSession({ scriptId: "open-world-fixture", seed: 8 });
    const run = host.startRun(session.id, "我尝试打开石门");

    const completed = await host.waitForRun(session.id, run.id);

    expect(completed.status).toBe("completed");
    expect(host.session(session.id)).toMatchObject({ revision: 1, step: 1, elapsedSeconds: 10 });
    expect(store.writeCount).toBeGreaterThanOrEqual(4);
    expect(completed.events.map((event) => event.type)).toEqual([
      "run.started",
      "player.observation",
      "step.committed",
      "run.completed",
    ]);
    const observation = completed.events.find((event) => event.type === "player.observation");
    expect(JSON.stringify(observation)).not.toContain("canonicalEntityId");
    expect(JSON.stringify(observation)).not.toContain('"keeper"');

    const reloaded = new WorldHost({
      repository: new FileWorldRepository(fixtureRoot),
      store,
      provider,
      idFactory: () => "unused",
    });
    expect(reloaded.session(session.id)).toMatchObject({ revision: 1, step: 1, elapsedSeconds: 10 });
  });

  it("persists a retriable failure without committing the invalid step", async () => {
    const provider = new ScriptedModelProvider(({ profileId, prompt }) => {
      const context = JSON.parse(prompt) as {
        baseRevision: number;
        jointActions: Array<{ id: string }>;
        revision: number;
        agent: { id: string };
      };
      if (profileId !== "truth-engine") return mindOutput(context.agent.id, context.revision);
      const invalid = transition({ baseRevision: context.baseRevision, step: 0, jointActions: context.jointActions });
      invalid.operations = [];
      return { kind: "transition", proposal: invalid };
    });
    const { host } = createHost(provider);
    const session = await host.createSession({ scriptId: "open-world-fixture" });
    const run = host.startRun(session.id, "提出一个导致非法 delta 的目标");

    const failed = await host.waitForRun(session.id, run.id);

    expect(failed.status).toBe("failed");
    expect(failed.error).toContain("time advance");
    expect(host.session(session.id)).toMatchObject({ revision: 0, step: 0, elapsedSeconds: 0 });
    expect(failed.events.at(-1)?.type).toBe("run.failed");
  });

  it("cancels at the first safe boundary and preserves the committed step", async () => {
    let releaseTruth!: () => void;
    const truthGate = new Promise<void>((resolve) => { releaseTruth = resolve; });
    let truthEntered!: () => void;
    const entered = new Promise<void>((resolve) => { truthEntered = resolve; });
    const provider = new ScriptedModelProvider(async ({ profileId, prompt }) => {
      const context = JSON.parse(prompt) as {
        baseRevision: number;
        step: number;
        jointActions: Array<{ id: string }>;
        revision: number;
        agent: { id: string };
      };
      if (profileId !== "truth-engine") return mindOutput(context.agent.id, context.revision);
      truthEntered();
      await truthGate;
      const result = transition(context);
      result.intentStatus = "active";
      return { kind: "transition", proposal: result };
    });
    const { host } = createHost(provider);
    const session = await host.createSession({ scriptId: "open-world-fixture" });
    const run = host.startRun(session.id, "持续观察石门");
    await entered;

    host.cancelRun(session.id, run.id);
    releaseTruth();
    const cancelled = await host.waitForRun(session.id, run.id);

    expect(cancelled.status).toBe("cancelled");
    expect(host.session(session.id)).toMatchObject({ revision: 1, step: 1, elapsedSeconds: 10 });
    expect(cancelled.events.map((event) => event.type)).toContain("step.committed");
    expect(cancelled.events.at(-1)?.type).toBe("run.cancelled");
  });
});
