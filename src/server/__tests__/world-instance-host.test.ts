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
  return { database, host, provider };
}

const observerStart = {
  worldId: "open-world-fixture",
  start: { kind: "observer" as const },
};

const originStart = {
  worldId: "open-world-fixture",
  start: {
    kind: "origin" as const,
    originId: "courtyard-wanderer",
    displayName: "小明",
    appearance: "背着旧旅行包。",
    motivation: "找到石门后的道路。",
  },
};

describe("World Instance host", () => {
  it("runs ten headless eager steps through the same Ledger", async () => {
    const { database, host } = harness();
    try {
      const created = await host.createInstance(observerStart);
      const advanced = await host.advance(created.summary.id, {
        expectedRevision: created.summary.revision,
        trigger: "batch",
        steps: 10,
      });
      expect(advanced.summary).toMatchObject({ revision: 10, step: 10, participantCount: 0 });
      const stored = database.readInstance(created.summary.id).document;
      expect(stored.state.history).toHaveLength(10);
      expect(Object.values(stored.advances)).toHaveLength(10);
      expect(Object.values(stored.policyBindings).every((binding) => binding.kind === "model")).toBe(true);
      expect(database.executions({ instanceId: created.summary.id })).toHaveLength(11);
    } finally {
      database.close();
    }
  }, 30_000);

  it("creates Origin admission and Arrival with the instance and no orphan shell", async () => {
    const { database, host, provider } = harness();
    try {
      const created = await host.createInstance(originStart);
      expect(created.summary).toMatchObject({ revision: 1, participantCount: 1 });
      expect(created.controlledView).toMatchObject({
        agentId: "courtyard-wanderer-1",
        self: { name: "小明", location: { name: "石门前庭" } },
      });
      expect(created.conversation?.turns).toHaveLength(1);
      expect(created.conversation?.turns[0]).toMatchObject({
        status: "committed",
        response: { suggestions: expect.any(Array) },
      });
      const stored = database.readInstance(created.summary.id).document;
      expect(stored.schemaVersion).toBe(14);
      expect(stored.state.admissions).toHaveLength(1);
      expect(Object.values(stored.state.truth.meters)).toContainEqual(expect.objectContaining({
        entityId: "courtyard-wanderer-1",
        definitionId: "health",
        current: 20,
      }));
      expect(Object.values(stored.state.truth.ratings)).toContainEqual(expect.objectContaining({
        entityId: "courtyard-wanderer-1",
        definitionId: "resolve",
        value: 1,
      }));
      expect(Object.values(stored.state.truth.quantities)).toContainEqual(expect.objectContaining({
        holderId: "courtyard-wanderer-1",
        definitionId: "spirit-stone",
        amount: 1,
      }));
      expect(stored.participants[created.participants[0].id].arrival.scene).toBeTruthy();
      expect(stored.policyBindings["courtyard-wanderer-1"]).toMatchObject({ kind: "external" });
      const arrivalRequest = provider.requests.find((request) => request.role === "arrival-generator");
      expect(arrivalRequest).toMatchObject({
        promptVersion: "arrival-v2",
        context: {
          contractVersion: 10,
          perspective: { agentId: "courtyard-wanderer-1" },
        },
      });
    } finally {
      database.close();
    }
  }, 30_000);

  it("turns one player message into exactly one advance and projects the durable conversation", async () => {
    const { database, host } = harness();
    try {
      const created = await host.createInstance(originStart);
      const participant = created.participants[0];
      const committed = await host.submitAction(created.summary.id, participant.id, {
        submissionId: "message-1",
        expectedRevision: created.summary.revision,
        text: "我观察石门和守门人。",
      });
      expect(committed.summary.revision).toBe(created.summary.revision + 1);
      expect(committed.actionWindow).toBeNull();
      expect(committed.conversation?.turns).toHaveLength(2);
      expect(committed.conversation?.turns[1]).toMatchObject({
        status: "committed",
        action: { submissionId: "message-1", text: "我观察石门和守门人。" },
        response: { text: expect.any(String) },
      });
      const duplicate = await host.submitAction(created.summary.id, participant.id, {
        submissionId: "message-1",
        expectedRevision: created.summary.revision,
        text: "我观察石门和守门人。",
      });
      expect(duplicate.summary.revision).toBe(committed.summary.revision);
      expect(database.readInstance(created.summary.id).document.participantIntents).toHaveLength(1);
    } finally {
      database.close();
    }
  }, 30_000);

  it("collects two external policies in one ActionWindow", async () => {
    const { database, host } = harness({ maxParticipants: 2 });
    try {
      const firstView = await host.createInstance(originStart, "principal-a");
      const secondView = await host.transferControl(firstView.summary.id, {
        expectedRevision: firstView.summary.revision,
        target: { kind: "agent", agentId: "keeper" },
      }, "principal-b");
      const first = firstView.participants[0];
      const second = secondView.participants.find((participant) => participant.agentId === "keeper")!;

      const waiting = await host.submitAction(firstView.summary.id, first.id, {
        submissionId: "submission-a",
        expectedRevision: firstView.summary.revision,
        text: "观察石门。",
      }, "principal-a");
      expect(waiting.summary.revision).toBe(firstView.summary.revision);
      expect(waiting.actionWindow?.submittedAgentIds).toEqual(["courtyard-wanderer-1"]);

      const committed = await host.submitAction(firstView.summary.id, second.id, {
        submissionId: "submission-b",
        expectedRevision: firstView.summary.revision,
        text: "继续看守石门。",
      }, "principal-b");
      expect(committed.summary.revision).toBe(firstView.summary.revision + 1);
      expect(committed.actionWindow).toBeNull();
      const stored = database.readInstance(firstView.summary.id).document;
      expect(stored.participantIntents).toHaveLength(2);
      expect(Object.values(stored.advances)).toHaveLength(1);
    } finally {
      database.close();
    }
  }, 30_000);

  it("atomically detaches and takes over any free living Agent", async () => {
    const { database, host } = harness();
    try {
      const created = await host.createInstance(originStart);
      const detached = await host.transferControl(created.summary.id, {
        expectedRevision: created.summary.revision,
        target: { kind: "observer" },
      });
      expect(detached.controlledView).toBeUndefined();
      const releasedPerspective = host.observer(created.summary.id, "courtyard-wanderer-1");
      expect(releasedPerspective.agents.map((agent) => agent.id)).toContain("keeper");
      expect(releasedPerspective.selected?.perspective).toEqual(created.controlledView);
      expect(database.readInstance(created.summary.id).document.policyBindings["courtyard-wanderer-1"])
        .toMatchObject({ kind: "model", resumeFromRevision: created.summary.revision });

      const keeperPerspective = host.observer(created.summary.id, "keeper").selected?.perspective;
      const taken = await host.transferControl(created.summary.id, {
        expectedRevision: detached.summary.revision,
        target: { kind: "agent", agentId: "keeper" },
      });
      expect(taken.controlledView?.agentId).toBe("keeper");
      expect(taken.controlledView).toEqual(keeperPerspective);
      expect(taken.conversation?.turns[0].response?.text).toBeTruthy();
      const stored = database.readInstance(created.summary.id).document;
      expect(Object.values(stored.participants).filter((participant) => participant.status === "active")).toHaveLength(1);
      expect(stored.policyBindings.keeper).toMatchObject({ kind: "external" });
    } finally {
      database.close();
    }
  }, 30_000);

  it("fences stale realtime callbacks and schedules only after commit", async () => {
    let now = new Date("2026-08-27T00:00:00.000Z");
    let timerId = 0;
    const timers = new Map<number, () => void | Promise<void>>();
    const { database, host } = harness({
      now: () => now,
      setTimer: (callback) => {
        const id = ++timerId;
        timers.set(id, async () => { timers.delete(id); await callback(); });
        return id as unknown as ReturnType<typeof setTimeout>;
      },
      clearTimer: (timer) => { timers.delete(timer as unknown as number); },
    });
    try {
      const created = await host.createInstance(observerStart);
      await host.setRealtime(created.summary.id, true);
      const stale = timers.get(timerId)!;
      await host.setRealtime(created.summary.id, false);
      await host.setRealtime(created.summary.id, true);
      const active = timers.get(timerId)!;
      await stale();
      expect(database.readInstance(created.summary.id).document.state.revision).toBe(0);
      now = new Date("2026-08-27T00:01:00.000Z");
      await active();
      expect(database.readInstance(created.summary.id).document.state.revision).toBe(1);
    } finally {
      database.close();
    }
  }, 30_000);

  it("rejects corrupt schema, policy and window data", async () => {
    const { database, host } = harness();
    try {
      const created = await host.createInstance(observerStart);
      const source = database.readInstance(created.summary.id).document;
      const legacy = structuredClone(source);
      (legacy as unknown as { schemaVersion: number }).schemaVersion = 13;
      expect(() => validateWorldInstanceDocument(legacy)).toThrow("world instance schema v14 required");

      const invalidPolicy = structuredClone(source);
      (invalidPolicy.policyBindings.player as { kind: string }).kind = "unknown";
      expect(() => validateWorldInstanceDocument(invalidPolicy)).toThrow("unknown kind");

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
    } finally {
      database.close();
    }
  });
});
