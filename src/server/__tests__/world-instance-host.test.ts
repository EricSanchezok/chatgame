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
  runLeaseMaxCommits?: number;
  runLeaseMaxWallTimeMs?: number;
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
  const repository = new MemoryWorldRepository({ [definition.id]: definition });
  const host = new WorldHost({
    repository,
    store: database,
    ledger: database,
    provider,
    now: input.now,
    idFactory: () => `id-${++ordinal}`,
    maxActiveParticipants: input.maxParticipants ?? 1,
    setTimer: input.setTimer,
    clearTimer: input.clearTimer,
    runLeaseMaxCommits: input.runLeaseMaxCommits,
    runLeaseMaxWallTimeMs: input.runLeaseMaxWallTimeMs,
  });
  return { database, definition, host, provider, repository };
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

async function waitForRevision(host: WorldHost, instanceId: string, revision: number) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const detail = host.instance(instanceId);
    if (detail.summary.revision >= revision) return detail;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`instance ${instanceId} did not reach revision ${revision}`);
}

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
      expect(Object.values(stored.runs)).toHaveLength(1);
      expect(Object.values(stored.policyBindings).every((binding) => binding.kind === "model")).toBe(true);
      expect(database.executions({ instanceId: created.summary.id })).toHaveLength(11);
    } finally {
      database.close();
    }
  }, 30_000);

  it("creates Origin admission and Arrival with the instance and no orphan shell", async () => {
    const { database, host } = harness();
    try {
      const created = await host.createInstance(originStart);
      expect(created.summary).toMatchObject({ revision: 1, participantCount: 1 });
      expect(created.controlledView).toMatchObject({
        agentId: "courtyard-wanderer-1",
        entity: { name: "小明", location: "石门前庭" },
      });
      expect(created.conversation?.turns).toHaveLength(1);
      expect(created.conversation?.turns[0]).toMatchObject({
        status: "committed",
        response: { suggestions: expect.any(Array) },
      });
      const stored = database.readInstance(created.summary.id).document;
      expect(stored.schemaVersion).toBe(15);
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
    } finally {
      database.close();
    }
  }, 30_000);

  it("turns one player message into exactly one advance and projects the durable conversation", async () => {
    const { database, host } = harness();
    try {
      const created = await host.createInstance(originStart);
      const participant = created.participants[0];
      const accepted = await host.submitAction(created.summary.id, participant.id, {
        submissionId: "message-1",
        expectedRevision: created.summary.revision,
        text: "我观察石门和守门人。",
      });
      expect(accepted.summary.revision).toBe(created.summary.revision);
      expect(accepted.summary.runStatus).toBe("queued");
      const committed = await waitForRevision(host, created.summary.id, created.summary.revision + 1);
      expect(committed.actionWindow).not.toBeNull();
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

      const accepted = await host.submitAction(firstView.summary.id, second.id, {
        submissionId: "submission-b",
        expectedRevision: firstView.summary.revision,
        text: "继续看守石门。",
      }, "principal-b");
      expect(accepted.summary.revision).toBe(firstView.summary.revision);
      const committed = await waitForRevision(host, firstView.summary.id, firstView.summary.revision + 1);
      expect(committed.actionWindow).not.toBeNull();
      const stored = database.readInstance(firstView.summary.id).document;
      expect(stored.participantIntents).toHaveLength(2);
      expect(Object.values(stored.runs)).toHaveLength(2);
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
      expect(host.observer(created.summary.id).agents.map((agent) => agent.id)).toContain("keeper");
      expect(database.readInstance(created.summary.id).document.policyBindings["courtyard-wanderer-1"])
        .toMatchObject({ kind: "model", resumeFromRevision: created.summary.revision });

      const taken = await host.transferControl(created.summary.id, {
        expectedRevision: detached.summary.revision,
        target: { kind: "agent", agentId: "keeper" },
      });
      expect(taken.controlledView?.agentId).toBe("keeper");
      expect(taken.conversation?.turns[0].response?.text).toBeTruthy();
      const stored = database.readInstance(created.summary.id).document;
      expect(Object.values(stored.participants).filter((participant) => participant.status === "active")).toHaveLength(1);
      expect(stored.policyBindings.keeper).toMatchObject({ kind: "external" });
    } finally {
      database.close();
    }
  }, 30_000);

  it("detaches at an open external decision boundary without mutating world time", async () => {
    const { database, host } = harness();
    try {
      const created = await host.createInstance(originStart);
      const participant = created.participants[0];
      await host.submitAction(created.summary.id, participant.id, {
        submissionId: "act-before-detach",
        expectedRevision: created.summary.revision,
        text: "我确认当前位置。",
      });
      const committed = await waitForRevision(host, created.summary.id, created.summary.revision + 1);
      expect(committed.actionWindow).not.toBeNull();
      expect(committed.run).toMatchObject({ status: "awaiting-decision" });
      const elapsedSeconds = committed.summary.elapsedSeconds;

      const detached = await host.transferControl(committed.summary.id, {
        expectedRevision: committed.summary.revision,
        target: { kind: "observer" },
      });

      expect(detached.controlledView).toBeUndefined();
      expect(detached.actionWindow).toBeNull();
      expect(detached.summary).toMatchObject({
        revision: committed.summary.revision,
        elapsedSeconds,
      });
      expect(detached.run).toMatchObject({ status: "completed", stopReason: "control-transferred" });
      expect(host.observer(created.summary.id).agents.map((agent) => agent.id)).toContain("keeper");
      validateWorldInstanceDocument(database.readInstance(created.summary.id).document);
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

  it("pauses a queued run, fences its stale callback, and resumes with a new generation", async () => {
    let timerId = 0;
    const timers = new Map<number, () => void | Promise<void>>();
    const { database, host } = harness({
      setTimer: (callback) => {
        const id = ++timerId;
        timers.set(id, async () => { timers.delete(id); await callback(); });
        return id as unknown as ReturnType<typeof setTimeout>;
      },
      clearTimer: (timer) => { timers.delete(timer as unknown as number); },
    });
    try {
      const created = await host.createInstance(originStart);
      const participant = created.participants[0];
      const accepted = await host.submitAction(created.summary.id, participant.id, {
        submissionId: "pause-me",
        expectedRevision: created.summary.revision,
        text: "观察石门。",
      });
      const stale = timers.get(timerId)!;
      const paused = await host.pauseRun(created.summary.id, {
        runId: accepted.run!.id,
        generation: accepted.run!.generation,
      });
      expect(paused.run).toMatchObject({ status: "paused", stopReason: "user-paused" });
      expect(paused.summary.revision).toBe(created.summary.revision);

      await stale();
      expect(host.instance(created.summary.id).summary.revision).toBe(created.summary.revision);
      const resumed = await host.resumeRun(created.summary.id, {
        runId: paused.run!.id,
        generation: paused.run!.generation,
      });
      expect(resumed.run).toMatchObject({ status: "queued" });
      const active = timers.get(timerId)!;
      await active();
      const committed = host.instance(created.summary.id);
      expect(committed.summary.revision).toBe(created.summary.revision + 1);
      expect(database.readInstance(created.summary.id).document.state.revision).toBe(committed.summary.revision);
    } finally {
      database.close();
    }
  }, 30_000);

  it("pauses at the dual-budget boundary and resumes with a fresh lease", async () => {
    const { database, host } = harness({ runLeaseMaxCommits: 1 });
    try {
      const created = await host.createInstance(observerStart);
      const first = await host.advance(created.summary.id, {
        expectedRevision: created.summary.revision,
        trigger: "batch",
        steps: 10,
      });
      expect(first.summary.revision).toBe(1);
      expect(first.run).toMatchObject({ status: "budget-paused", stopReason: "commit-budget-exhausted" });
      const firstLeaseStartedAt = first.run!.lease!.startedAt;
      const resumed = await host.resumeRun(created.summary.id, {
        runId: first.run!.id,
        generation: first.run!.generation,
      });
      expect(resumed.run).toMatchObject({ status: "queued", lease: null });
      const second = await waitForRevision(host, created.summary.id, 2);
      expect(second.run).toMatchObject({ status: "budget-paused" });
      expect(second.run!.lease!.startedAt).not.toBeUndefined();
      expect(second.run!.lease!.commitCount).toBe(1);
      expect(database.readInstance(created.summary.id).document.runs[first.run!.id].committedRevisions)
        .toEqual([1, 2]);
      expect(firstLeaseStartedAt).toBeTruthy();
    } finally {
      database.close();
    }
  }, 30_000);

  it("turns an inherited running lease into process-recovered pause without a model call", async () => {
    const timers = new Map<number, () => void | Promise<void>>();
    let timerId = 0;
    const { database, host, provider, repository } = harness({
      setTimer: (callback) => {
        const id = ++timerId;
        timers.set(id, callback);
        return id as unknown as ReturnType<typeof setTimeout>;
      },
      clearTimer: (timer) => { timers.delete(timer as unknown as number); },
    });
    try {
      const created = await host.createInstance(originStart);
      const participant = created.participants[0];
      const accepted = await host.submitAction(created.summary.id, participant.id, {
        submissionId: "recover-me",
        expectedRevision: created.summary.revision,
        text: "观察石门。",
      });
      const stored = database.readInstance(created.summary.id);
      const running = structuredClone(stored.document);
      const run = running.runs[accepted.run!.id];
      run.status = "running";
      run.lease = {
        id: "inherited-lease",
        generation: run.generation,
        startedAt: "2026-08-27T00:00:00.000Z",
        maxCommits: 100,
        maxWallTimeMs: 900_000,
        commitCount: 0,
      };
      if (running.actionWindow) running.actionWindow.status = "resolving";
      database.compareAndSwapInstance(created.summary.id, stored.generation, running);
      const executionsBefore = database.executions({ instanceId: created.summary.id }).length;

      const recoveredHost = new WorldHost({ repository, store: database, ledger: database, provider });
      const recovered = recoveredHost.instance(created.summary.id);
      expect(recovered.run).toMatchObject({ status: "paused", stopReason: "process-recovered", lease: null });
      expect(recovered.summary.revision).toBe(created.summary.revision);
      expect(database.executions({ instanceId: created.summary.id })).toHaveLength(executionsBefore);
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
      expect(() => validateWorldInstanceDocument(legacy)).toThrow("world instance schema v15 required");

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
