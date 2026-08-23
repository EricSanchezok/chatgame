import path from "node:path";
import { describe, expect, it } from "vitest";
import { ScriptedModelProvider, type ScriptedModelHandler } from "../../engine/testing/model-provider";
import type { TransitionProposal } from "../../engine/model";
import { loadWorldScript } from "../../script/world-loader";
import { MemoryWorldRepository } from "../../script/world-repository";
import { WorldHost } from "../world-host";
import { MemoryWorldSessionStore, type StoredWorldSession } from "../world-session-store";

const fixtureRoot = path.resolve("test/fixtures/open-world-script");

class TransientFailureStore extends MemoryWorldSessionStore {
  failNextWrite = false;

  override compareAndSwap(
    sessionId: string,
    expectedGeneration: number,
    document: Parameters<MemoryWorldSessionStore["compareAndSwap"]>[2],
  ): StoredWorldSession {
    if (this.failNextWrite) {
      this.failNextWrite = false;
      throw new Error("simulated persistence outage");
    }
    return super.compareAndSwap(sessionId, expectedGeneration, document);
  }
}

function mindOutput(agentId: string, revision: number) {
  return {
    beliefPatch: { agentId, baseRevision: revision, operations: [] },
    characterPatch: { agentId, baseRevision: revision, operations: [] },
    nextAction: {
      id: `agent-action:${agentId}:${revision}`,
      actorId: agentId,
      baseRevision: revision,
      rawText: "继续根据自己的认知看守石门",
      goal: "守住石门",
      means: null,
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
      proposalId: action.id,
      status: "succeeded",
      summary: "联合行动已被裁决。",
      causeRefs: [{ kind: "action", id: action.id }],
      assertions: [{ kind: "elapsed_seconds_compare", operator: "gte", value: 0 }],
      knownAlternatives: [],
    })),
    mechanicInvocations: [],
    operations: [
      {
        kind: "advance_time",
        seconds: 10,
        causes: [{ kind: "law", id: "time-passes" }],
        assertions: [{ kind: "elapsed_seconds_compare", operator: "gte", value: 0 }],
      },
    ],
    events: [
      {
        id: eventId,
        step: nextStep,
        description: "石门前过去了十秒。",
        impact: "ordinary",
        causes: [{ kind: "law", id: "time-passes" }],
        assertions: [{ kind: "elapsed_seconds_compare", operator: "gte", value: 0 }],
      },
    ],
    observations: [
      {
        id: `observation:player:${nextStep}`,
        observerId: "player",
        step: nextStep,
        kind: "outcome",
        summary: "你看见守门人仍站在石门前。",
        introductions: nextStep === 1 ? [
          {
            localEntity: {
              id: "gatekeeper",
              name: "守门人",
              description: "站在石门前的守卫。",
              status: "observed",
            },
            canonicalEntityId: "keeper",
          },
        ] : [],
        apparentClaims: [],
        sourceEventIds: [eventId],
      },
      {
        id: `observation:keeper:${nextStep}`,
        observerId: "keeper",
        step: nextStep,
        kind: "outcome",
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
    if (profileId === "truth-deepseek") return { kind: "transition", proposal: transition(context) };
    return mindOutput(context.agent.id, context.revision);
  };
}

function createHost(
  provider: ScriptedModelProvider,
  store = new MemoryWorldSessionStore(),
  maxStepsPerRun = 4,
): { host: WorldHost; store: MemoryWorldSessionStore } {
  let id = 0;
  const definition = loadWorldScript(fixtureRoot, { modelCatalog: provider.catalog });
  return {
    host: new WorldHost({
      repository: new MemoryWorldRepository({ [definition.id]: definition }),
      store,
      provider,
      idFactory: () => `test-${++id}`,
      now: () => new Date("2026-08-23T00:00:00.000Z"),
      maxStepsPerRun,
    }),
    store,
  };
}

describe("WorldHost", () => {
  it("persists every committed step and emits only player-safe observations", async () => {
    const provider = new ScriptedModelProvider(normalHandler());
    const { host, store } = createHost(provider);
    const session = await host.createSession({ worldId: "open-world-fixture", seed: 8 });
    const run = host.startRun(session.id, "我尝试打开石门");

    const completed = await host.waitForRun(session.id, run.runId);

    expect(completed.run.status).toBe("completed");
    expect(host.session(session.id)).toMatchObject({ revision: 1, step: 1, elapsedSeconds: 10 });
    expect(store.writeCount).toBeGreaterThanOrEqual(4);
    expect(completed.run.events.map((event) => event.type)).toEqual([
      "player.input",
      "run.execution_started",
      "player.outcome",
      "player.observation",
      "step.committed",
      "run.completed",
    ]);
    const observation = completed.run.events.find((event) => event.type === "player.observation");
    expect(JSON.stringify(observation)).not.toContain("canonicalEntityId");
    expect(JSON.stringify(observation)).not.toContain('"keeper"');
    expect(JSON.stringify(observation)).not.toContain('"kind":"outcome"');
    expect(JSON.stringify(completed)).not.toContain("characterPatches");
    expect(JSON.stringify(completed)).not.toContain("reactionRequests");
    expect(JSON.stringify(completed)).not.toContain("modelAudits");
    const storedStep = store.read(session.id).document.state.history[0];
    expect(storedStep.contentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(storedStep.modelAudits.map((audit) => audit.role)).toEqual([
      "truth-perception",
      "truth-reaction-routing",
      "truth-resolution",
      "truth-transition",
      "causal-verifier",
      "agent-mind",
    ]);
    expect(storedStep.checkRequests).toEqual([]);

    const reloaded = new WorldHost({
      repository: new MemoryWorldRepository({
        "open-world-fixture": loadWorldScript(fixtureRoot, { modelCatalog: provider.catalog }),
      }),
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
      if (profileId !== "truth-deepseek") return mindOutput(context.agent.id, context.revision);
      const invalid = transition({ baseRevision: context.baseRevision, step: 0, jointActions: context.jointActions });
      invalid.operations = [];
      return { kind: "transition", proposal: invalid };
    });
    const { host, store } = createHost(provider);
    const session = await host.createSession({ worldId: "open-world-fixture" });
    const run = host.startRun(session.id, "提出一个导致非法 delta 的目标");

    const failed = await host.waitForRun(session.id, run.runId);

    expect(failed.run.status).toBe("failed");
    expect(failed.run.error).not.toContain("time advance");
    expect(store.read(session.id).document.runs[run.runId].internalError).toContain("time advance");
    expect(host.session(session.id)).toMatchObject({ revision: 0, step: 0, elapsedSeconds: 0 });
    expect(failed.run.events.at(-1)?.type).toBe("run.failed");
  });

  it("keeps canonical identifiers in internal diagnostics only", async () => {
    const provider = new ScriptedModelProvider(({ profileId, prompt }) => {
      const context = JSON.parse(prompt) as {
        baseRevision: number;
        step: number;
        jointActions: Array<{ id: string }>;
        revision: number;
        agent: { id: string };
      };
      if (profileId !== "truth-deepseek") return mindOutput(context.agent.id, context.revision);
      const invalid = transition(context);
      invalid.operations.unshift({
        kind: "place_entity",
        entityId: "canonical-secret-entity",
        placementId: null,
        causes: [{ kind: "action", id: context.jointActions[0].id }],
        assertions: [{ kind: "entity_absent", entityId: "canonical-secret-entity" }],
      });
      return { kind: "transition", proposal: invalid };
    });
    const { host, store } = createHost(provider);
    const session = await host.createSession({ worldId: "open-world-fixture" });
    const started = host.startRun(session.id, "触发包含内部标识符的验证错误");

    const failed = await host.waitForRun(session.id, started.runId);

    expect(JSON.stringify(failed)).not.toContain("canonical-secret-entity");
    expect(store.read(session.id).document.runs[started.runId].internalError).toContain("canonical-secret-entity");
  });

  it("aborts an in-flight model batch without committing a partial step", async () => {
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
      if (profileId !== "truth-deepseek") return mindOutput(context.agent.id, context.revision);
      truthEntered();
      await truthGate;
      const result = transition(context);
      result.intentStatus = "active";
      return { kind: "transition", proposal: result };
    });
    const { host } = createHost(provider);
    const session = await host.createSession({ worldId: "open-world-fixture" });
    const run = host.startRun(session.id, "持续观察石门");
    await entered;

    host.cancelRun(session.id, run.runId);
    releaseTruth();
    const cancelled = await host.waitForRun(session.id, run.runId);

    expect(cancelled.run.status).toBe("cancelled");
    expect(host.session(session.id)).toMatchObject({ revision: 0, step: 0, elapsedSeconds: 0 });
    expect(cancelled.run.events.map((event) => event.type)).not.toContain("step.committed");
    expect(cancelled.run.events.at(-1)?.type).toBe("run.cancelled");
  });

  it("rolls back an otherwise valid step when its atomic persistence fails", async () => {
    const store = new TransientFailureStore();
    const provider = new ScriptedModelProvider(({ profileId, prompt }) => {
      const context = JSON.parse(prompt) as {
        baseRevision: number;
        step: number;
        jointActions: Array<{ id: string }>;
        revision: number;
        agent: { id: string };
      };
      if (profileId !== "truth-deepseek") return mindOutput(context.agent.id, context.revision);
      store.failNextWrite = true;
      return { kind: "transition", proposal: transition(context) };
    });
    const { host } = createHost(provider, store);
    const session = await host.createSession({ worldId: "open-world-fixture" });
    const run = host.startRun(session.id, "执行一个会成功但无法持久化的步骤");

    const failed = await host.waitForRun(session.id, run.runId);

    expect(failed.run.status).toBe("failed");
    expect(failed.run.error).not.toContain("simulated persistence outage");
    expect(store.read(session.id).document.runs[run.runId].internalError).toContain("simulated persistence outage");
    expect(failed.run.events.map((event) => event.type)).toEqual([
      "player.input",
      "run.execution_started",
      "run.failed",
    ]);
    expect(host.session(session.id)).toMatchObject({ revision: 0, step: 0, elapsedSeconds: 0 });
  });

  it("stops exactly at the 100-step safety boundary and preserves every committed step", async () => {
    const provider = new ScriptedModelProvider(({ profileId, prompt }) => {
      const context = JSON.parse(prompt) as {
        baseRevision: number;
        step: number;
        jointActions: Array<{ id: string }>;
        revision: number;
        agent: { id: string };
      };
      if (profileId !== "truth-deepseek") return mindOutput(context.agent.id, context.revision);
      const result = transition(context);
      result.intentStatus = "active";
      return { kind: "transition", proposal: result };
    });
    const { host, store } = createHost(provider, new MemoryWorldSessionStore(), 100);
    const session = await host.createSession({ worldId: "open-world-fixture" });
    const started = host.startRun(session.id, "持续观察一百个世界步骤");

    const result = await host.waitForRun(session.id, started.runId);

    expect(result.run.status).toBe("step_limit");
    expect(result.state).toMatchObject({ revision: 100, step: 100, elapsedSeconds: 1000 });
    expect(store.read(session.id).document.state.history).toHaveLength(100);
    expect(result.run.events.filter((event) => event.type === "step.committed")).toHaveLength(100);
    expect(result.run.events.at(-1)?.type).toBe("run.step_limit");
  }, 30_000);

  it("recovers a persisted running process as retriable failure without changing committed history", async () => {
    const provider = new ScriptedModelProvider(normalHandler());
    const store = new MemoryWorldSessionStore();
    const first = createHost(provider, store).host;
    const session = await first.createSession({ worldId: "open-world-fixture" });
    const stored = store.read(session.id);
    const document = stored.document;
    document.state.player.intent = {
      id: "intent:interrupted",
      goal: "尚未完成的长程目标",
      latestInput: {
        id: "input:interrupted:1",
        text: "尚未完成的长程目标",
        kind: "goal",
        submittedAtStep: document.state.step,
      },
      status: "active",
      startedAtStep: document.state.step,
    };
    document.runs.interrupted = {
      id: "interrupted",
      sessionId: session.id,
      intentId: "intent:interrupted",
      status: "running",
      createdAt: "2026-08-23T00:00:00.000Z",
      updatedAt: "2026-08-23T00:00:00.000Z",
      cancelRequested: false,
      events: [
        {
          sequence: 1,
          type: "player.input",
          at: "2026-08-23T00:00:00.000Z",
          payload: { id: "input:interrupted:1", kind: "goal", text: "尚未完成的长程目标" },
        },
        {
          sequence: 2,
          type: "run.execution_started",
          at: "2026-08-23T00:00:00.000Z",
          payload: { runId: "interrupted", inputId: "input:interrupted:1", reason: "initial" },
        },
      ],
    };
    store.compareAndSwap(session.id, stored.generation, document);
    const definition = loadWorldScript(fixtureRoot, { modelCatalog: provider.catalog });
    const recovered = new WorldHost({
      repository: new MemoryWorldRepository({ [definition.id]: definition }),
      store,
      provider,
      idFactory: () => "unused",
    });

    const snapshot = recovered.run(session.id, "interrupted");

    expect(snapshot.run.status).toBe("failed");
    expect(snapshot.run.error).toContain("安全重试");
    expect(snapshot.state).toMatchObject({ revision: 0, step: 0 });
    expect(store.read(session.id).document.runs.interrupted.internalError).toContain("process interrupted");
  });

  it("retries a failed run from its unchanged revision even while the prior execution is finalizing", async () => {
    let valid = false;
    const provider = new ScriptedModelProvider(({ profileId, prompt }) => {
      const context = JSON.parse(prompt) as {
        baseRevision: number;
        step: number;
        jointActions: Array<{ id: string }>;
        revision: number;
        agent: { id: string };
      };
      if (profileId !== "truth-deepseek") return mindOutput(context.agent.id, context.revision);
      const result = transition(context);
      if (!valid) result.operations = [];
      return { kind: "transition", proposal: result };
    });
    const { host } = createHost(provider);
    const session = await host.createSession({ worldId: "open-world-fixture" });
    const started = host.startRun(session.id, "失败后从同一状态继续");
    const failed = await host.waitForRun(session.id, started.runId);
    expect(failed).toMatchObject({ run: { status: "failed" }, state: { revision: 0, step: 0 } });

    valid = true;
    expect(host.retryRun(session.id, started.runId).run.status).toBe("queued");
    const completed = await host.waitForRun(session.id, started.runId);

    expect(completed).toMatchObject({ run: { status: "completed" }, state: { revision: 1, step: 1 } });
    expect(completed.run.events.filter((event) => event.type === "run.execution_started")).toHaveLength(2);
  });

  it("continues an awaiting player goal in the same run with idempotent input", async () => {
    const playerIntents: Array<{ goal: string; latestInput: { id: string; text: string } }> = [];
    const provider = new ScriptedModelProvider(({ profileId, prompt }) => {
      const context = JSON.parse(prompt) as {
        baseRevision: number;
        step: number;
        jointActions: Array<{ id: string }>;
        revision: number;
        agent: { id: string };
        playerIntent: { goal: string; latestInput: { id: string; text: string } };
      };
      if (profileId !== "truth-deepseek") return mindOutput(context.agent.id, context.revision);
      playerIntents.push(context.playerIntent);
      const result = transition(context);
      if (context.step === 0) {
        result.intentStatus = "active";
        result.requiresPlayerDecision = true;
      }
      return { kind: "transition", proposal: result };
    });
    const { host } = createHost(provider);
    const session = await host.createSession({ worldId: "open-world-fixture" });
    const started = host.startRun(session.id, "打开石门并进入里面");

    const paused = await host.waitForRun(session.id, started.runId);
    expect(paused.run.status).toBe("awaiting_player");

    const resumed = host.continueRun(session.id, started.runId, {
      id: "decision-1",
      text: "使用我携带的铜钥匙",
    });
    expect(resumed.run.id).toBe(started.runId);
    const completed = await host.waitForRun(session.id, started.runId);

    expect(completed).toMatchObject({ run: { status: "completed" }, state: { revision: 2, step: 2 } });
    expect(completed.run.inputs).toEqual([
      expect.objectContaining({ kind: "goal", text: "打开石门并进入里面" }),
      expect.objectContaining({ id: "decision-1", kind: "clarification", text: "使用我携带的铜钥匙" }),
    ]);
    expect(playerIntents.map((intent) => intent.goal)).toEqual([
      "打开石门并进入里面",
      "打开石门并进入里面",
    ]);
    expect(playerIntents[1].latestInput).toMatchObject({ id: "decision-1", text: "使用我携带的铜钥匙" });
    expect(host.continueRun(session.id, started.runId, {
      id: "decision-1",
      text: "使用我携带的铜钥匙",
    }).run.status).toBe("completed");
    expect(() => host.continueRun(session.id, started.runId, {
      id: "decision-1",
      text: "改用另一种办法",
    })).toThrow("different text");
  });

  it("requires an unfinished failed intent to be retried or abandoned before a new run", async () => {
    let valid = false;
    const provider = new ScriptedModelProvider(({ profileId, prompt }) => {
      const context = JSON.parse(prompt) as {
        baseRevision: number;
        step: number;
        jointActions: Array<{ id: string }>;
        revision: number;
        agent: { id: string };
      };
      if (profileId !== "truth-deepseek") return mindOutput(context.agent.id, context.revision);
      if (!valid) {
        const invalid = transition(context);
        invalid.operations = [];
        return { kind: "transition", proposal: invalid };
      }
      return { kind: "transition", proposal: transition(context) };
    });
    const { host } = createHost(provider);
    const session = await host.createSession({ worldId: "open-world-fixture" });
    const oldRun = host.startRun(session.id, "先产生失败运行");
    expect((await host.waitForRun(session.id, oldRun.runId)).run.status).toBe("failed");
    expect(() => host.startRun(session.id, "新的活动运行")).toThrow("already has active run");

    expect(host.cancelRun(session.id, oldRun.runId).run.status).toBe("cancelled");
    valid = true;
    const nextRun = host.startRun(session.id, "新的活动运行");
    expect((await host.waitForRun(session.id, nextRun.runId)).run.status).toBe("completed");
  });
});
