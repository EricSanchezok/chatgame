import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DeterministicModelProvider } from "../../engine/testing/model-provider";
import { loadWorldScript } from "../../script/world-loader";
import { MemoryWorldRepository } from "../../script/world-repository";
import { LocalDatabase } from "../local-database";
import { WorldHost } from "../world-host";
import { validateWorldInstanceDocument } from "../world-instance-store";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function harness(input: {
  now?: () => Date;
  maxParticipants?: number;
  setTimer?: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  clearTimer?: (timer: ReturnType<typeof setTimeout>) => void;
} = {}) {
  const provider = new DeterministicModelProvider();
  const definition = loadWorldScript(path.resolve("test/fixtures/open-world-script"), {
    seed: 47,
    modelCatalog: provider.catalog,
  });
  definition.participation = {
    claimableAgentIds: ["player", "keeper"],
    origins: [{
      id: "courtyard-wanderer",
      title: "庭院旅人",
      fantasy: "从石门前开始自己的故事。",
      description: "一个刚抵达庭院的旅人。",
      entityKind: "person",
      spawnEntityId: "courtyard",
      persona: "谨慎但好奇的旅人。",
      defaultGoal: "弄清庭院里正在发生什么。",
      relationshipHooks: ["守门人可能知道石门的秘密。"],
      risks: ["错误判断可能引来守卫。"],
      resources: [{ definitionId: "spirit-stone", amount: 1 }],
      modelProfiles: structuredClone(definition.modelProfiles.dynamicAgent),
      fallbackArrival: "你站在石门内侧的庭院中。",
    }],
  };
  const root = mkdtempSync(path.join(tmpdir(), "lwe-instance-host-"));
  roots.push(root);
  const database = new LocalDatabase(path.join(root, "livingworld.sqlite"), { heartbeat: false });
  let ordinal = 0;
  const host = new WorldHost({
    repository: new MemoryWorldRepository({ [definition.id]: definition }),
    store: database,
    ledger: database,
    provider,
    now: input.now,
    idFactory: () => `id-${++ordinal}`,
    maxActiveParticipants: input.maxParticipants ?? 1,
    setTimer: input.setTimer,
    clearTimer: input.clearTimer,
  });
  return { database, definition, host, provider };
}

describe("World Instance host", () => {
  it("runs ten headless eager steps through the same Ledger and replayable state", async () => {
    const { database, host } = harness();
    try {
      const created = await host.createInstance({ worldId: "open-world-fixture" });
      const advanced = await host.advance(created.summary.id, {
        expectedRevision: created.summary.revision,
        trigger: "batch",
        steps: 10,
      });
      expect(advanced.summary).toMatchObject({ revision: 10, step: 10, participantCount: 0 });
      const stored = database.readInstance(created.summary.id).document;
      expect(stored.state.history).toHaveLength(10);
      expect(Object.values(stored.advances)).toHaveLength(10);
      expect(Object.values(stored.advances).every((advance) =>
        advance.status === "committed" && advance.committedRevisions.length === 1)).toBe(true);
      expect(Object.values(stored.policyBindings).every((binding) => binding.kind === "model")).toBe(true);
      expect(database.executions({ instanceId: created.summary.id })).toHaveLength(11);
      expect(database.instanceEvents(created.summary.id).some((event) =>
        event.event === "algorithm.candidate.completed" && event.counts?.persistentAgents === 2)).toBe(true);
    } finally {
      database.close();
    }
  }, 30_000);

  it("collects two external policies in one ActionWindow and resumes AgentMind after release", async () => {
    const { database, host } = harness({ maxParticipants: 2 });
    try {
      const created = await host.createInstance({ worldId: "open-world-fixture" });
      const first = await host.createParticipant(created.summary.id, {
        expectedRevision: created.summary.revision,
        claimAgentId: "player",
        displayName: "旅人",
        appearance: "披着斗篷。",
        motivation: "观察庭院。",
      }, "principal-a");
      const second = await host.createParticipant(created.summary.id, {
        expectedRevision: first.instance.summary.revision,
        claimAgentId: "keeper",
        displayName: "守门人",
        appearance: "握着长杖。",
        motivation: "守住石门。",
      }, "principal-b");
      const opened = await host.advance(created.summary.id, {
        expectedRevision: second.instance.summary.revision,
        trigger: "manual",
      });
      expect(opened.actionWindow?.requiredAgentIds).toEqual(["keeper", "player"]);

      const one = await host.submitAction(created.summary.id, first.participantId, {
        submissionId: "submission-a",
        expectedRevision: opened.summary.revision,
        text: "观察石门。",
      }, "principal-a");
      expect(one.summary.revision).toBe(opened.summary.revision);
      const duplicate = await host.submitAction(created.summary.id, first.participantId, {
        submissionId: "submission-a",
        expectedRevision: opened.summary.revision,
        text: "观察石门。",
      }, "principal-a");
      expect(duplicate.actionWindow?.submittedAgentIds).toEqual(["player"]);

      const committed = await host.submitAction(created.summary.id, second.participantId, {
        submissionId: "submission-b",
        expectedRevision: opened.summary.revision,
        text: "继续看守石门。",
      }, "principal-b");
      expect(committed.summary.revision).toBe(opened.summary.revision + 1);
      expect(committed.actionWindow).toBeNull();
      let stored = database.readInstance(created.summary.id).document;
      expect(stored.state.agents.player.nextAction).toBeNull();
      expect(stored.state.agents.keeper.nextAction).toBeNull();

      await host.releaseParticipant(created.summary.id, first.participantId, {
        expectedRevision: committed.summary.revision,
        disposition: "model",
      }, "principal-a");
      const released = await host.releaseParticipant(created.summary.id, second.participantId, {
        expectedRevision: committed.summary.revision,
        disposition: "idle",
      }, "principal-b");
      const resumed = await host.advance(created.summary.id, {
        expectedRevision: released.summary.revision,
        trigger: "manual",
      });
      expect(resumed.summary.revision).toBe(committed.summary.revision + 1);
      stored = database.readInstance(created.summary.id).document;
      expect(stored.policyBindings.player.kind).toBe("model");
      expect(stored.state.agents.player.nextAction).not.toBeNull();
      expect(stored.policyBindings.keeper).toMatchObject({ kind: "idle", reason: "released" });
      expect(stored.state.agents.keeper.nextAction).toBeNull();
    } finally {
      database.close();
    }
  }, 30_000);

  it("admits an Origin Agent at a revision boundary and records admission without rewriting history", async () => {
    const { database, host } = harness();
    try {
      const created = await host.createInstance({ worldId: "open-world-fixture" });
      const evolved = await host.advance(created.summary.id, {
        expectedRevision: created.summary.revision,
        trigger: "manual",
      });
      const joined = await host.createParticipant(created.summary.id, {
        expectedRevision: evolved.summary.revision,
        originId: "courtyard-wanderer",
        displayName: "小明",
        appearance: "背着旧旅行包。",
        motivation: "找到石门后的道路。",
      });
      expect(joined.instance.summary.revision).toBe(evolved.summary.revision + 1);
      expect(joined.arrival.suggestions).toHaveLength(3);
      const stored = database.readInstance(created.summary.id).document;
      const participant = stored.participants[joined.participantId];
      expect(participant.agentId).toBe("courtyard-wanderer-1");
      expect(stored.state.truth.placements[participant.agentId]).toBe("courtyard");
      expect(stored.state.agents[participant.agentId].character.goals)
        .toHaveProperty("courtyard-wanderer-1-motivation");
      expect(stored.state.admissions).toHaveLength(1);
      expect(stored.state.history).toHaveLength(1);
      expect(stored.policyBindings[participant.agentId]).toMatchObject({ kind: "external" });
      expect(database.execution(participant.admissionExecutionId!)).toMatchObject({ status: "succeeded" });

      const released = await host.releaseParticipant(created.summary.id, joined.participantId, {
        expectedRevision: joined.instance.summary.revision,
        disposition: "idle",
      });
      expect(released.claimableAgents.some((agent) => agent.id === participant.agentId && agent.claimable)).toBe(true);
      const reclaimed = await host.createParticipant(created.summary.id, {
        expectedRevision: released.summary.revision,
        claimAgentId: participant.agentId,
        displayName: "小明",
        appearance: "背着旧旅行包。",
        motivation: "继续寻找道路。",
      });
      expect(reclaimed.instance.controlledView?.agentId).toBe(participant.agentId);
    } finally {
      database.close();
    }
  }, 30_000);

  it("turns an expired external slot into an engine-owned noop", async () => {
    let now = new Date("2026-08-27T00:00:00.000Z");
    const { database, host } = harness({ now: () => now });
    try {
      const created = await host.createInstance({ worldId: "open-world-fixture" });
      const joined = await host.createParticipant(created.summary.id, {
        expectedRevision: created.summary.revision,
        claimAgentId: "player",
        displayName: "旅人",
        appearance: "披着斗篷。",
        motivation: "暂时等待。",
      });
      const opened = await host.advance(created.summary.id, {
        expectedRevision: joined.instance.summary.revision,
        trigger: "manual",
      });
      now = new Date(Date.parse(opened.actionWindow!.deadlineAt!) + 1);
      const resolved = await host.advance(created.summary.id, {
        expectedRevision: opened.summary.revision,
        trigger: "manual",
      });
      expect(resolved.summary.revision).toBe(opened.summary.revision + 1);
      const events = database.instanceEvents(created.summary.id);
      expect(events.findLast((event) => event.event === "action_window.resolved")?.counts)
        .toMatchObject({ timeoutNoops: 1, submittedExternalActions: 0 });
      const execution = database.executions({ instanceId: created.summary.id })
        .find((candidate) => candidate.commitRevision === resolved.summary.revision);
      expect(execution?.runtimeConfig).toMatchObject({ externalAgents: 0, idleAgents: 1 });
    } finally {
      database.close();
    }
  }, 30_000);

  it("fences stale realtime callbacks and schedules the next tick only after commit", async () => {
    let now = new Date("2026-08-27T00:00:00.000Z");
    let timerId = 0;
    const timers = new Map<number, () => void | Promise<void>>();
    const { database, host } = harness({
      now: () => now,
      setTimer: (callback) => {
        const id = ++timerId;
        timers.set(id, async () => {
          timers.delete(id);
          await callback();
        });
        return id as unknown as ReturnType<typeof setTimeout>;
      },
      clearTimer: (timer) => { timers.delete(timer as unknown as number); },
    });
    try {
      const created = await host.createInstance({ worldId: "open-world-fixture" });
      await host.setRealtime(created.summary.id, true);
      const stale = timers.get(timerId)!;
      await host.setRealtime(created.summary.id, false);
      await host.setRealtime(created.summary.id, true);
      const active = timers.get(timerId)!;

      await stale();
      expect(database.readInstance(created.summary.id).document.state.revision).toBe(0);

      now = new Date("2026-08-27T00:01:00.000Z");
      await active();
      const stored = database.readInstance(created.summary.id).document;
      expect(stored.state.revision).toBe(1);
      expect(stored.scheduler.mode).toBe("realtime");
      expect(stored.scheduler.nextTickAt).toBe("2026-08-27T00:02:00.000Z");
      expect(timers.size).toBe(1);
    } finally {
      database.close();
    }
  }, 30_000);

  it("rejects corrupt persisted policy, window, scheduler, and advance data", async () => {
    const { database, host } = harness();
    try {
      const created = await host.createInstance({ worldId: "open-world-fixture" });
      const source = database.readInstance(created.summary.id).document;
      const invalidPolicy = structuredClone(source);
      (invalidPolicy.policyBindings.player as { kind: string }).kind = "unknown";
      expect(() => validateWorldInstanceDocument(invalidPolicy)).toThrow("unknown kind");

      const invalidScheduler = structuredClone(source);
      invalidScheduler.scheduler.nextTickAt = "2026-08-27T00:01:00.000Z";
      expect(() => validateWorldInstanceDocument(invalidScheduler)).toThrow("paused scheduler");

      const invalidWindow = structuredClone(source);
      invalidWindow.actionWindow = {
        id: "window",
        generation: 1,
        baseRevision: source.state.revision,
        requiredAgentIds: ["player", "player"],
        submissions: {},
        deadlineAt: null,
        status: "open",
      };
      expect(() => validateWorldInstanceDocument(invalidWindow)).toThrow("duplicate required Agents");

      const invalidAdvance = structuredClone(source);
      invalidAdvance.advances.corrupt = {
        id: "corrupt",
        request: {
          expectedRevision: 0,
          trigger: "manual",
          simulatedSeconds: 60,
          externalActions: [{
            submissionId: "submission",
            agentId: "missing-agent",
            rawText: "前进",
            goal: "探索",
            means: null,
            targetIds: [],
          }],
        },
        status: "queued",
        createdAt: "2026-08-27T00:00:00.000Z",
        updatedAt: "2026-08-27T00:00:00.000Z",
        executionIds: [],
        committedRevisions: [],
      };
      expect(() => validateWorldInstanceDocument(invalidAdvance)).toThrow("unknown Agent");
    } finally {
      database.close();
    }
  });
});
