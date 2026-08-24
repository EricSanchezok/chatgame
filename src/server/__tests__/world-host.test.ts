import path from "node:path";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { describe, expect, it, vi } from "vitest";
import { ScriptedModelProvider, type ScriptedModelHandler } from "../../engine/testing/model-provider";
import type { TransitionProposalDraft } from "../../engine/model";
import { ModelConfigurationError } from "../../engine/model-provider";
import { RecordingRuntimeObserver, type RuntimeObserver } from "../../engine/observability";
import { loadWorldScript } from "../../script/world-loader";
import { MemoryWorldRepository } from "../../script/world-repository";
import { LocalDatabase } from "../local-database";
import { WorldHost } from "../world-host";
import { MemoryWorldSessionStore, type StoredWorldSession } from "../world-session-store";

const fixtureRoot = path.resolve("test/fixtures/open-world-script");

class TransientFailureStore extends MemoryWorldSessionStore {
  failNextWrite = false;

  override create(
    document: Parameters<MemoryWorldSessionStore["create"]>[0],
  ): StoredWorldSession {
    if (this.failNextWrite) {
      this.failNextWrite = false;
      throw new Error("simulated persistence outage");
    }
    return super.create(document);
  }

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

class FailedBoundaryWriteStore extends MemoryWorldSessionStore {
  rejectedPermanentBoundary = false;

  override compareAndSwap(
    sessionId: string,
    expectedGeneration: number,
    document: Parameters<MemoryWorldSessionStore["compareAndSwap"]>[2],
  ): StoredWorldSession {
    const boundary = Object.values(document.runs).find((run) => run.status === "failed")
      ?.events.at(-1);
    if (!this.rejectedPermanentBoundary && boundary?.type === "run.failed" &&
      !boundary.payload.retriable) {
      this.rejectedPermanentBoundary = true;
      throw new Error("simulated failed-boundary persistence outage");
    }
    return super.compareAndSwap(sessionId, expectedGeneration, document);
  }
}

class CancelledBoundaryWriteStore extends MemoryWorldSessionStore {
  rejectedCancelledBoundary = false;

  override compareAndSwap(
    sessionId: string,
    expectedGeneration: number,
    document: Parameters<MemoryWorldSessionStore["compareAndSwap"]>[2],
  ): StoredWorldSession {
    const boundary = Object.values(document.runs).find((run) => run.status === "cancelled")
      ?.events.at(-1);
    if (!this.rejectedCancelledBoundary && boundary?.type === "run.cancelled") {
      this.rejectedCancelledBoundary = true;
      throw new Error("simulated cancelled-boundary persistence outage");
    }
    return super.compareAndSwap(sessionId, expectedGeneration, document);
  }
}

function mindOutput(agentId: string, revision: number) {
  if (!agentId || !Number.isSafeInteger(revision)) throw new Error("invalid AgentMind fixture context");
  return {
    beliefPatch: { operations: [] },
    characterPatch: { operations: [] },
    nextAction: {
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
}): TransitionProposalDraft {
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
  observer?: RuntimeObserver,
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
      observer,
    }),
    store,
  };
}

describe("WorldHost", () => {
  it("validates the model catalog before acquiring the database lease", () => {
    const dataRoot = mkdtempSync(path.join(tmpdir(), "living-world-host-bootstrap-"));
    vi.stubEnv("LIVINGWORLD_DATA_ROOT", dataRoot);
    vi.stubEnv("LIVINGWORLD_MODEL_CATALOG_PATH", path.join(dataRoot, "missing-model-catalog.yaml"));
    WorldHost.setForTests(undefined);

    try {
      expect(() => WorldHost.get()).toThrow("cannot read model catalog");
      expect(() => WorldHost.get()).toThrow("cannot read model catalog");
      expect(existsSync(path.join(dataRoot, "livingworld.sqlite"))).toBe(false);
    } finally {
      WorldHost.setForTests(undefined);
      vi.unstubAllEnvs();
      rmSync(dataRoot, { recursive: true, force: true });
    }
  });

  it("preflights every world profile before Agent bootstrap or persistence", async () => {
    const provider = new ScriptedModelProvider(normalHandler());
    const check = vi.spyOn(provider, "assertProfilesAvailable").mockImplementation(() => {
      throw new ModelConfigurationError("model provider deepseek requires DEEPSEEK_API_KEY");
    });
    const { host, store } = createHost(provider);

    await expect(host.createSession({ worldId: "open-world-fixture" }))
      .rejects.toThrow("model provider deepseek requires DEEPSEEK_API_KEY");
    expect(check).toHaveBeenCalledWith(["agent-deepseek", "truth-deepseek"]);
    expect(provider.requests).toEqual([]);
    expect(store.listSessions()).toEqual([]);
  });

  it("logs and discards a bootstrapped session when its first persistence fails", async () => {
    const observer = new RecordingRuntimeObserver({ mode: "metrics" });
    const store = new TransientFailureStore(observer);
    store.failNextWrite = true;
    const { host } = createHost(
      new ScriptedModelProvider(normalHandler()),
      store,
      4,
      observer,
    );

    await expect(host.createSession({ worldId: "open-world-fixture" }))
      .rejects.toThrow("simulated persistence outage");
    expect(store.listSessions()).toEqual([]);
    expect(observer.events.some((event) =>
      event.event === "session.bootstrap.persistence_rolled_back")).toBe(true);
  });

  it("persists session titles and protects only actively executing sessions from deletion", async () => {
    let releaseTruth!: () => void;
    const truthGate = new Promise<void>((resolve) => { releaseTruth = resolve; });
    let markEntered!: () => void;
    const entered = new Promise<void>((resolve) => { markEntered = resolve; });
    const provider = new ScriptedModelProvider(async ({ profileId, prompt }) => {
      const context = JSON.parse(prompt) as {
        baseRevision: number;
        step: number;
        jointActions: Array<{ id: string }>;
        revision: number;
        agent: { id: string };
      };
      if (profileId !== "truth-deepseek") return mindOutput(context.agent.id, context.revision);
      markEntered();
      await truthGate;
      return { kind: "transition", proposal: transition(context) };
    });
    const { host, store } = createHost(provider);
    const created = await host.createSession({ worldId: "open-world-fixture" });
    const sessionId = created.summary.id;

    expect(host.renameSession(sessionId, " 石门之外 ").summary.title).toBe("石门之外");
    expect(host.session(sessionId).summary.title).toBe("石门之外");

    const run = host.startRun(sessionId, "执行一个持续中的行动");
    await entered;
    expect(() => host.deleteSession(sessionId)).toThrow("active run");
    releaseTruth();
    await host.waitForRun(sessionId, run.runId);

    host.deleteSession(sessionId);
    expect(store.listSessions()).toEqual([]);
    expect(() => host.session(sessionId)).toThrow("not found");
  });

  it("rejects a persisted world contract that differs from its trusted content-addressed version", async () => {
    const provider = new ScriptedModelProvider(normalHandler());
    const store = new MemoryWorldSessionStore();
    const { host } = createHost(provider, store);
    const session = await host.createSession({ worldId: "open-world-fixture" });
    const stored = store.read(session.summary.id);
    const tampered = stored.document;
    tampered.world.laws[0].text = "被篡改但沿用原 contentHash 的世界法则。";
    store.compareAndSwap(session.summary.id, stored.generation, tampered);

    expect(() => host.session(session.summary.id)).toThrow("does not match pinned version");
    expect(() => host.listSessions()).toThrow("does not match pinned version");
  });

  it("bounds pinned world contracts with LRU promotion and eviction", async () => {
    const provider = new ScriptedModelProvider(normalHandler());
    const definition = loadWorldScript(fixtureRoot, { modelCatalog: provider.catalog });
    const repository = new MemoryWorldRepository({ [definition.id]: definition });
    const loadVersion = vi.spyOn(repository, "loadVersion");
    let nextId = 0;
    const host = new WorldHost({
      repository,
      store: new MemoryWorldSessionStore(),
      provider,
      idFactory: () => `pinned-cache-${++nextId}`,
      now: () => new Date("2026-08-23T00:00:00.000Z"),
    });
    const sessions = [];
    for (let seed = 1; seed <= 9; seed += 1) {
      sessions.push(await host.createSession({ worldId: definition.id, seed }));
    }
    loadVersion.mockClear();

    for (const session of sessions.slice(0, 8)) host.session(session.summary.id);
    expect(loadVersion).toHaveBeenCalledTimes(8);
    host.session(sessions[0].summary.id);
    expect(loadVersion).toHaveBeenCalledTimes(8);

    host.session(sessions[8].summary.id);
    expect(loadVersion).toHaveBeenCalledTimes(9);
    host.session(sessions[0].summary.id);
    expect(loadVersion).toHaveBeenCalledTimes(9);
    host.session(sessions[1].summary.id);
    expect(loadVersion).toHaveBeenCalledTimes(10);
    expect(loadVersion.mock.calls.at(-1)?.[2]).toBe(2);

    loadVersion.mockClear();
    expect(host.listSessions()).toHaveLength(9);
    expect(loadVersion).toHaveBeenCalledTimes(1);
    expect(host.listSessions()).toHaveLength(9);
    expect(loadVersion).toHaveBeenCalledTimes(2);
  });

  it("persists every committed step and emits only player-safe observations", async () => {
    const provider = new ScriptedModelProvider(normalHandler());
    const { host, store } = createHost(provider);
    const session = await host.createSession({ worldId: "open-world-fixture", seed: 8 });
    const run = host.startRun(session.summary.id, "我尝试打开石门");

    const completed = await host.waitForRun(session.summary.id, run.runId);

    expect(completed.run.status).toBe("completed");
    expect(host.session(session.summary.id).state).toMatchObject({ revision: 1, step: 1, elapsedSeconds: 10 });
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
    const storedStep = store.read(session.summary.id).document.state.history[0];
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
    expect(reloaded.session(session.summary.id).state).toMatchObject({ revision: 1, step: 1, elapsedSeconds: 10 });
  });

  it("round-trips a WorldHost observation with surrounding whitespace through SQLite", async () => {
    const paddedSummary = "  你看见守门人仍站在石门前。 \n";
    const provider = new ScriptedModelProvider(({ profileId, prompt }) => {
      const context = JSON.parse(prompt) as {
        baseRevision: number;
        step: number;
        jointActions: Array<{ id: string }>;
        revision: number;
        agent: { id: string };
      };
      if (profileId !== "truth-deepseek") return mindOutput(context.agent.id, context.revision);
      const proposal = transition(context);
      const playerObservation = proposal.observations.find((observation) => observation.observerId === "player");
      if (!playerObservation) throw new Error("fixture has no player observation");
      playerObservation.summary = paddedSummary;
      return { kind: "transition", proposal };
    });
    const dataRoot = mkdtempSync(path.join(tmpdir(), "living-world-observation-roundtrip-"));
    const databaseFile = path.join(dataRoot, "livingworld.sqlite");
    const definition = loadWorldScript(fixtureRoot, { modelCatalog: provider.catalog });
    const repository = new MemoryWorldRepository({ [definition.id]: definition });
    let database = new LocalDatabase(databaseFile, { heartbeat: false });
    let nextId = 0;
    const hostFor = () => new WorldHost({
      repository,
      store: database,
      provider,
      idFactory: () => `whitespace-${++nextId}`,
      now: () => new Date("2026-08-23T00:00:00.000Z"),
      maxStepsPerRun: 4,
    });

    try {
      const host = hostFor();
      const session = await host.createSession({ worldId: definition.id });
      const started = host.startRun(session.summary.id, "观察石门");
      const completed = await host.waitForRun(session.summary.id, started.runId);
      expect(completed.run.status).toBe("completed");

      database.close();
      database = new LocalDatabase(databaseFile, { heartbeat: false });
      const restored = hostFor().run(session.summary.id, started.runId);
      const observation = restored.run.events.find((event) => event.type === "player.observation");
      expect(observation?.payload.summary).toBe(paddedSummary);
    } finally {
      database.close();
      rmSync(dataRoot, { recursive: true, force: true });
    }
  });

  it("derives public outcome text only from player outcome observations", async () => {
    const internalSummary = "keeper-internal-outcome-secret";
    const internalAlternative = "keeper-internal-alternative-secret";
    const provider = new ScriptedModelProvider(({ profileId, prompt }) => {
      const context = JSON.parse(prompt) as {
        baseRevision: number;
        step: number;
        jointActions: Array<{ id: string; actorId: string }>;
        revision: number;
        agent: { id: string };
      };
      if (profileId !== "truth-deepseek") return mindOutput(context.agent.id, context.revision);
      const proposal = transition(context);
      const playerAction = context.jointActions.find((action) => action.actorId === "player")!;
      const playerOutcome = proposal.outcomes.find((outcome) => outcome.proposalId === playerAction.id)!;
      playerOutcome.summary = internalSummary;
      playerOutcome.knownAlternatives = [{
        description: internalAlternative,
        basis: { kind: "observation", observationId: `observation:player:${context.step + 1}` },
      }];
      proposal.observations.push({
        id: `observation:player:${context.step + 1}:second`,
        observerId: "player",
        step: context.step + 1,
        kind: "outcome",
        summary: "石门本身没有移动。",
        introductions: [],
        apparentClaims: [],
        sourceEventIds: [`event:${context.step + 1}`],
      });
      return { kind: "transition", proposal };
    });
    const { host, store } = createHost(provider);
    const session = await host.createSession({ worldId: "open-world-fixture" });
    const started = host.startRun(session.summary.id, "观察石门与守门人");

    const completed = await host.waitForRun(session.summary.id, started.runId);

    const publicOutcome = completed.run.events.find((event) => event.type === "player.outcome");
    expect(publicOutcome?.payload).toEqual({
      status: "succeeded",
      summary: "你看见守门人仍站在石门前。\n石门本身没有移动。",
    });
    expect(JSON.stringify(completed)).not.toContain(internalSummary);
    expect(JSON.stringify(completed)).not.toContain(internalAlternative);
    const storedStep = store.read(session.summary.id).document.state.history[0];
    const storedPlayerAction = storedStep.actions.find((action) => action.actorId === "player")!;
    const storedOutcome = storedStep.outcomes.find((outcome) =>
      outcome.proposalId === storedPlayerAction.id)!;
    expect(storedOutcome.summary).toBe(internalSummary);
    expect(storedOutcome.knownAlternatives[0].description).toBe(internalAlternative);
  });

  it("persists the exact public check projection and rejects check ledger tampering", async () => {
    const provider = new ScriptedModelProvider(({ role, prompt }) => {
      const context = JSON.parse(prompt) as {
        baseRevision: number;
        step: number;
        jointActions?: Array<{ id: string; actorId: string }>;
        checkResults?: Array<{ requestId: string }>;
        revision: number;
        agent?: { id: string };
      };
      if (role === "agent-bootstrap" || role === "agent-mind") {
        return mindOutput(context.agent!.id, context.revision);
      }
      if (role === "truth-perception") return { kind: "done" };
      if (role === "truth-reaction-routing") return { requests: [] };
      if (role === "truth-resolution") {
        if (context.checkResults?.length) return { kind: "done" };
        const playerAction = context.jointActions!.find((action) => action.actorId === "player")!;
        return {
          kind: "request_checks",
          requests: (["full", "hidden", "result_only"] as const).map((visibility, index) => ({
            id: `public-ledger-check-${index + 1}`,
            actorId: "player",
            targetId: null,
            ratingId: null,
            modifier: 0,
            modifierSources: [],
            dc: 10,
            mode: "normal" as const,
            stakes: "验证公开检定投影。",
            visibility,
            phase: "resolution" as const,
            causes: [{ kind: "action" as const, id: playerAction.id }],
          })),
        };
      }
      if (role === "truth-transition") {
        return transition({
          baseRevision: context.baseRevision,
          step: context.step,
          jointActions: context.jointActions!,
        });
      }
      if (role === "causal-verifier") return { verdict: "accept", findings: [] };
      throw new Error(`unexpected role ${role}`);
    });
    const store = new MemoryWorldSessionStore();
    const { host } = createHost(provider, store);
    const session = await host.createSession({ worldId: "open-world-fixture", seed: 8 });
    const started = host.startRun(session.summary.id, "进行一次公开检定");
    const completed = await host.waitForRun(session.summary.id, started.runId);
    const publicCheck = completed.run.events.find((event) => event.type === "check.resolved");
    const canonicalCheck = store.read(session.summary.id).document.state.history[0].checks[0];

    expect(publicCheck).toMatchObject({
      type: "check.resolved",
      payload: {
        requestId: "check:1:1",
        visibility: "full",
        dice: canonicalCheck.dice,
        kept: canonicalCheck.kept,
        modifier: canonicalCheck.modifier,
        total: canonicalCheck.total,
        dc: canonicalCheck.dc,
        succeeded: canonicalCheck.succeeded,
        margin: canonicalCheck.margin,
      },
    });
    expect(completed.run.events.filter((event) => event.type === "check.resolved")).toEqual([
      expect.objectContaining({ type: "check.resolved", payload: expect.objectContaining({
        requestId: "check:1:1",
        visibility: "full",
      }) }),
      {
        sequence: expect.any(Number),
        at: expect.any(String),
        type: "check.resolved",
        payload: {
          requestId: "check:1:3",
          visibility: "result_only",
          succeeded: store.read(session.summary.id).document.state.history[0].checks[2].succeeded,
        },
      },
    ]);
    const stored = store.read(session.summary.id);
    const mutations: Array<(events: typeof stored.document.runs[string]["events"]) => void> = [
      (events) => {
        const check = events.find((event) => event.type === "check.resolved");
        if (!check || check.type !== "check.resolved") throw new Error("fixture has no public check");
        check.payload.succeeded = !check.payload.succeeded;
      },
      (events) => {
        const index = events.findIndex((event) => event.type === "check.resolved");
        if (index < 0) throw new Error("fixture has no public check");
        events.splice(index, 1);
        events.forEach((event, eventIndex) => { event.sequence = eventIndex + 1; });
      },
      (events) => {
        const index = events.findIndex((event) => event.type === "check.resolved");
        if (index < 0) throw new Error("fixture has no public check");
        events.splice(index, 0, structuredClone(events[index]));
        events.forEach((event, eventIndex) => { event.sequence = eventIndex + 1; });
      },
      (events) => {
        const checkIndex = events.findIndex((event) => event.type === "check.resolved");
        const outcomeIndex = events.findIndex((event) => event.type === "player.outcome");
        if (checkIndex < 0 || outcomeIndex < 0) throw new Error("fixture has no public check sequence");
        [events[checkIndex], events[outcomeIndex]] = [events[outcomeIndex], events[checkIndex]];
        events.forEach((event, eventIndex) => { event.sequence = eventIndex + 1; });
      },
    ];
    for (const mutate of mutations) {
      const document = structuredClone(stored.document);
      mutate(document.runs[started.runId].events);
      expect(() => store.compareAndSwap(document.id, stored.generation, document))
        .toThrow("public step events do not match canonical history step");
    }
  });

  it("persists a retriable failure without committing the invalid step", async () => {
    const observer = new RecordingRuntimeObserver({ mode: "full" });
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
    const store = new MemoryWorldSessionStore(observer);
    const { host } = createHost(provider, store, 4, observer);
    const session = await host.createSession({ worldId: "open-world-fixture" });
    const run = host.startRun(
      session.summary.id,
      "提出一个导致非法 delta 的目标",
      { requestId: "request-failure" },
    );

    const failed = await host.waitForRun(session.summary.id, run.runId);

    expect(failed.run.status).toBe("failed");
    expect(failed.run.error).not.toContain("time advance");
    expect(store.read(session.summary.id).document.runs[run.runId].internalError).toContain("time advance");
    expect(host.session(session.summary.id).state).toMatchObject({ revision: 0, step: 0, elapsedSeconds: 0 });
    expect(failed.run.events.at(-1)?.type).toBe("run.failed");
    expect(store.read(session.summary.id).document.state.history).toHaveLength(0);
    const failedChain = observer.events.filter((event) =>
      event.correlation?.requestId === "request-failure" &&
      event.correlation?.runId === run.runId);
    expect(failedChain.some((event) => event.event === "model.semantic.rejected")).toBe(true);
    expect(failedChain.some((event) => event.event === "step.rolled_back")).toBe(true);
    expect(failedChain.some((event) => event.event === "run.failed")).toBe(true);
    expect(failedChain.find((event) => event.event === "step.rolled_back")?.correlation)
      .toMatchObject({
        sessionId: session.summary.id,
        runId: run.runId,
        runAttempt: 1,
        revision: 0,
        step: 1,
      });
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
    const started = host.startRun(session.summary.id, "触发包含内部标识符的验证错误");

    const failed = await host.waitForRun(session.summary.id, started.runId);

    expect(JSON.stringify(failed)).not.toContain("canonical-secret-entity");
    expect(store.read(session.summary.id).document.runs[started.runId].internalError).toContain("canonical-secret-entity");
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
    const run = host.startRun(session.summary.id, "持续观察石门");
    await entered;

    host.cancelRun(session.summary.id, run.runId);
    releaseTruth();
    const cancelled = await host.waitForRun(session.summary.id, run.runId);

    expect(cancelled.run.status).toBe("cancelled");
    expect(host.session(session.summary.id).state).toMatchObject({ revision: 0, step: 0, elapsedSeconds: 0 });
    expect(cancelled.run.events.map((event) => event.type)).not.toContain("step.committed");
    expect(cancelled.run.events.at(-1)?.type).toBe("run.cancelled");
  });

  it("recovers an Abort cancellation after the first cancelled boundary write fails", async () => {
    const store = new CancelledBoundaryWriteStore();
    const provider = new ScriptedModelProvider(({ profileId, prompt }) => {
      const context = JSON.parse(prompt) as { revision: number; agent: { id: string } };
      if (profileId === "truth-deepseek") {
        const error = new Error("model request aborted before a step was committed");
        error.name = "AbortError";
        throw error;
      }
      return mindOutput(context.agent.id, context.revision);
    });
    const { host } = createHost(provider, store);
    const session = await host.createSession({ worldId: "open-world-fixture" });
    const started = host.startRun(session.summary.id, "触发一次中止并恢复取消终态");

    const cancelled = await host.waitForRun(session.summary.id, started.runId);

    expect(store.rejectedCancelledBoundary).toBe(true);
    expect(cancelled).toMatchObject({
      run: { status: "cancelled", cancelRequested: false },
      state: { revision: 0, step: 0, activeIntent: { status: "cancelled" } },
    });
    expect(cancelled.run.events.map((event) => event.type)).toEqual([
      "player.input",
      "run.execution_started",
      "run.cancelled",
    ]);
  });

  it("recovers a paused cancellation after the first cancelled boundary write fails", async () => {
    const store = new CancelledBoundaryWriteStore();
    const provider = new ScriptedModelProvider(({ profileId, prompt }) => {
      const context = JSON.parse(prompt) as {
        baseRevision: number;
        step: number;
        jointActions: Array<{ id: string }>;
        revision: number;
        agent: { id: string };
      };
      if (profileId !== "truth-deepseek") return mindOutput(context.agent.id, context.revision);
      const proposal = transition(context);
      proposal.intentStatus = "active";
      proposal.requiresPlayerDecision = true;
      return { kind: "transition", proposal };
    });
    const { host } = createHost(provider, store);
    const session = await host.createSession({ worldId: "open-world-fixture" });
    const started = host.startRun(session.summary.id, "暂停后取消");
    expect((await host.waitForRun(session.summary.id, started.runId)).run.status).toBe("awaiting_player");

    expect(() => host.cancelRun(session.summary.id, started.runId))
      .toThrow("simulated cancelled-boundary persistence outage");
    expect(host.session(session.summary.id).state.activeIntent?.status).toBe("cancelled");
    expect(host.run(session.summary.id, started.runId).run.events.at(-1)?.type).toBe("run.cancelled");
  });

  it("rolls back an otherwise valid step and treats an unclassified persistence error as permanent", async () => {
    const observer = new RecordingRuntimeObserver({ mode: "metrics" });
    const store = new TransientFailureStore(observer);
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
    const { host } = createHost(provider, store, 4, observer);
    const session = await host.createSession({ worldId: "open-world-fixture" });
    const run = host.startRun(session.summary.id, "执行一个会成功但无法持久化的步骤");

    const failed = await host.waitForRun(session.summary.id, run.runId);

    expect(failed.run.status).toBe("failed");
    expect(failed.run.error).not.toContain("simulated persistence outage");
    expect(failed.run.events.at(-1)).toMatchObject({
      type: "run.failed",
      payload: { retriable: false },
    });
    expect(() => host.retryRun(session.summary.id, run.runId)).toThrow("is not retriable");
    expect(store.read(session.summary.id).document.runs[run.runId].internalError).toContain("simulated persistence outage");
    expect(failed.run.events.map((event) => event.type)).toEqual([
      "player.input",
      "run.execution_started",
      "run.failed",
    ]);
    expect(host.session(session.summary.id).state).toMatchObject({ revision: 0, step: 0, elapsedSeconds: 0 });
    expect(observer.events.find((event) => event.event === "step.persistence_rolled_back"))
      .toMatchObject({
        correlation: { sessionId: session.summary.id, runId: run.runId, revision: 0, step: 1 },
        attributes: { result: "rolled_back", revisionUnchanged: true },
      });
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
    const started = host.startRun(session.summary.id, "持续观察一百个世界步骤");

    const result = await host.waitForRun(session.summary.id, started.runId);

    expect(result.run.status).toBe("step_limit");
    expect(result.state).toMatchObject({ revision: 100, step: 100, elapsedSeconds: 1000 });
    expect(store.read(session.summary.id).document.state.history).toHaveLength(100);
    expect(result.run.events.filter((event) => event.type === "step.committed")).toHaveLength(100);
    expect(result.run.events.at(-1)?.type).toBe("run.step_limit");
  }, 90_000);

  it("queues and executes a retry from the persisted step-limit boundary", async () => {
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
    const { host } = createHost(provider, new MemoryWorldSessionStore(), 1);
    const session = await host.createSession({ worldId: "open-world-fixture" });
    const started = host.startRun(session.summary.id, "跨过一次步骤上限后继续");
    const firstBoundary = await host.waitForRun(session.summary.id, started.runId);
    expect(firstBoundary).toMatchObject({ run: { status: "step_limit" }, state: { revision: 1, step: 1 } });

    expect(host.retryRun(session.summary.id, started.runId).run.status).toBe("queued");
    const secondBoundary = await host.waitForRun(session.summary.id, started.runId);

    expect(secondBoundary).toMatchObject({ run: { status: "step_limit" }, state: { revision: 2, step: 2 } });
    expect(secondBoundary.run.events.filter((event) => event.type === "run.execution_started")
      .map((event) => event.type === "run.execution_started" ? event.payload.reason : undefined))
      .toEqual(["initial", "retry"]);
  });

  it("recovers a queued retry whose prior boundary was a retriable failure", async () => {
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
      invalid.operations = [];
      return { kind: "transition", proposal: invalid };
    });
    const { host, store } = createHost(provider);
    const session = await host.createSession({ worldId: "open-world-fixture" });
    const started = host.startRun(session.summary.id, "失败后排队重试，但在执行前中断");
    const failed = await host.waitForRun(session.summary.id, started.runId);
    expect(failed.run.events.at(-1)).toMatchObject({
      type: "run.failed",
      payload: { retriable: true },
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    const stored = store.read(session.summary.id);
    const document = stored.document;
    document.runs[started.runId].status = "queued";
    document.runs[started.runId].error = undefined;
    document.runs[started.runId].internalError = undefined;
    store.compareAndSwap(session.summary.id, stored.generation, document);

    const recovered = createHost(provider, store).host.run(session.summary.id, started.runId);

    expect(recovered).toMatchObject({
      run: { status: "failed" },
      state: { revision: 0, step: 0 },
    });
    expect(recovered.run.events.slice(-2).map((event) => event.type)).toEqual([
      "run.failed",
      "run.failed",
    ]);
    expect(recovered.run.events.at(-1)).toMatchObject({
      type: "run.failed",
      payload: { retriable: true },
    });
  });

  it("recovers a queued retry whose prior boundary was the step limit", async () => {
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
    const { host, store } = createHost(provider, new MemoryWorldSessionStore(), 1);
    const session = await host.createSession({ worldId: "open-world-fixture" });
    const started = host.startRun(session.summary.id, "达到上限后排队继续，但在执行前中断");
    const limited = await host.waitForRun(session.summary.id, started.runId);
    expect(limited).toMatchObject({ run: { status: "step_limit" }, state: { revision: 1, step: 1 } });
    await new Promise<void>((resolve) => setImmediate(resolve));
    const stored = store.read(session.summary.id);
    const document = stored.document;
    document.runs[started.runId].status = "queued";
    store.compareAndSwap(session.summary.id, stored.generation, document);

    const recovered = createHost(provider, store).host.run(session.summary.id, started.runId);

    expect(recovered).toMatchObject({
      run: { status: "failed" },
      state: { revision: 1, step: 1 },
    });
    expect(recovered.run.events.slice(-2).map((event) => event.type)).toEqual([
      "run.step_limit",
      "run.failed",
    ]);
    expect(recovered.run.events.at(-1)).toMatchObject({
      type: "run.failed",
      payload: { retriable: true },
    });
  });

  it("recovers a persisted running process as retriable failure without changing committed history", async () => {
    const provider = new ScriptedModelProvider(normalHandler());
    const store = new MemoryWorldSessionStore();
    const first = createHost(provider, store).host;
    const session = await first.createSession({ worldId: "open-world-fixture" });
    const stored = store.read(session.summary.id);
    const document = stored.document;
    document.state.player.intent = {
      id: "intent:interrupted",
      goal: "尚未完成的长程目标",
      inputs: [{
        id: "input:interrupted:1",
        text: "尚未完成的长程目标",
        kind: "goal",
        submittedAtStep: document.state.step,
      }],
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
      sessionId: session.summary.id,
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
    store.compareAndSwap(session.summary.id, stored.generation, document);
    const definition = loadWorldScript(fixtureRoot, { modelCatalog: provider.catalog });
    const unavailableProvider = new ScriptedModelProvider(normalHandler());
    const availabilityCheck = vi.spyOn(unavailableProvider, "assertProfilesAvailable")
      .mockImplementation(() => {
        throw new ModelConfigurationError("model provider deepseek requires DEEPSEEK_API_KEY");
      });
    const blocked = new WorldHost({
      repository: new MemoryWorldRepository({ [definition.id]: definition }),
      store,
      provider: unavailableProvider,
      idFactory: () => "unused",
    });
    const writeCountBeforePreflight = store.writeCount;

    expect(() => blocked.run(session.summary.id, "interrupted"))
      .toThrow("model provider deepseek requires DEEPSEEK_API_KEY");
    expect(availabilityCheck).toHaveBeenCalledWith(["agent-deepseek", "truth-deepseek"]);
    expect(unavailableProvider.requests).toEqual([]);
    expect(store.writeCount).toBe(writeCountBeforePreflight);
    expect(store.read(session.summary.id).document.runs.interrupted.status).toBe("running");

    const recovered = new WorldHost({
      repository: new MemoryWorldRepository({ [definition.id]: definition }),
      store,
      provider,
      idFactory: () => "unused",
    });

    const snapshot = recovered.run(session.summary.id, "interrupted");

    expect(snapshot.run.status).toBe("failed");
    expect(snapshot.run.error).toContain("安全重试");
    expect(snapshot.state).toMatchObject({ revision: 0, step: 0 });
    expect(store.read(session.summary.id).document.runs.interrupted.internalError).toContain("process interrupted");
  });

  it("atomically recovers a persisted cancellation request as cancelled", async () => {
    const provider = new ScriptedModelProvider(normalHandler());
    const store = new MemoryWorldSessionStore();
    const first = createHost(provider, store).host;
    const session = await first.createSession({ worldId: "open-world-fixture" });
    const stored = store.read(session.summary.id);
    const document = stored.document;
    document.state.player.intent = {
      id: "intent:cancel-interrupted",
      goal: "取消尚未完成的目标",
      inputs: [{
        id: "input:cancel-interrupted:1",
        text: "取消尚未完成的目标",
        kind: "goal",
        submittedAtStep: document.state.step,
      }],
      latestInput: {
        id: "input:cancel-interrupted:1",
        text: "取消尚未完成的目标",
        kind: "goal",
        submittedAtStep: document.state.step,
      },
      status: "active",
      startedAtStep: document.state.step,
    };
    document.runs["cancel-interrupted"] = {
      id: "cancel-interrupted",
      sessionId: session.summary.id,
      intentId: "intent:cancel-interrupted",
      status: "running",
      createdAt: "2026-08-23T00:00:00.000Z",
      updatedAt: "2026-08-23T00:00:00.000Z",
      cancelRequested: true,
      events: [
        {
          sequence: 1,
          type: "player.input",
          at: "2026-08-23T00:00:00.000Z",
          payload: {
            id: "input:cancel-interrupted:1",
            kind: "goal",
            text: "取消尚未完成的目标",
          },
        },
        {
          sequence: 2,
          type: "run.execution_started",
          at: "2026-08-23T00:00:00.000Z",
          payload: {
            runId: "cancel-interrupted",
            inputId: "input:cancel-interrupted:1",
            reason: "initial",
          },
        },
      ],
    };
    store.compareAndSwap(session.summary.id, stored.generation, document);
    const definition = loadWorldScript(fixtureRoot, { modelCatalog: provider.catalog });
    const recovered = new WorldHost({
      repository: new MemoryWorldRepository({ [definition.id]: definition }),
      store,
      provider,
      idFactory: () => "unused",
      now: () => new Date("2026-08-23T00:00:01.000Z"),
    });

    const snapshot = recovered.run(session.summary.id, "cancel-interrupted");

    expect(snapshot).toMatchObject({
      run: { status: "cancelled", cancelRequested: false },
      state: { revision: 0, step: 0, activeIntent: { status: "cancelled" } },
    });
    expect(snapshot.run.events.at(-1)?.type).toBe("run.cancelled");
    expect(store.read(session.summary.id).document.state.history).toHaveLength(0);
  });

  it("persists configuration failures as non-retriable and still allows abandonment", async () => {
    const provider = new ScriptedModelProvider(({ profileId, prompt }) => {
      const context = JSON.parse(prompt) as { revision: number; agent: { id: string } };
      if (profileId === "truth-deepseek") {
        throw new ModelConfigurationError("provider credential is invalid");
      }
      return mindOutput(context.agent.id, context.revision);
    });
    const { host } = createHost(provider);
    const session = await host.createSession({ worldId: "open-world-fixture" });
    const started = host.startRun(session.summary.id, "尝试使用错误的模型配置");

    const failed = await host.waitForRun(session.summary.id, started.runId);

    expect(failed.run.events.at(-1)).toMatchObject({
      type: "run.failed",
      payload: { retriable: false },
    });
    expect(failed.run.error).not.toContain("credential");
    expect(() => host.retryRun(session.summary.id, started.runId)).toThrow("is not retriable");
    expect(host.cancelRun(session.summary.id, started.runId).run.status).toBe("cancelled");
  });

  it("preserves a permanent classification when persisting run.failed is temporarily interrupted", async () => {
    const provider = new ScriptedModelProvider(({ profileId, prompt }) => {
      const context = JSON.parse(prompt) as { revision: number; agent: { id: string } };
      if (profileId === "truth-deepseek") {
        throw new ModelConfigurationError("provider credential is invalid");
      }
      return mindOutput(context.agent.id, context.revision);
    });
    const store = new FailedBoundaryWriteStore();
    const { host } = createHost(provider, store);
    const session = await host.createSession({ worldId: "open-world-fixture" });
    const started = host.startRun(session.summary.id, "触发永久错误并中断首次失败写盘");

    const failed = await host.waitForRun(session.summary.id, started.runId);

    expect(store.rejectedPermanentBoundary).toBe(true);
    expect(failed.run.events.at(-1)).toMatchObject({
      type: "run.failed",
      payload: { retriable: false },
    });
    expect(failed.run.events.filter((event) => event.type === "run.failed")).toHaveLength(1);
    expect(() => host.retryRun(session.summary.id, started.runId)).toThrow("is not retriable");
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
    const started = host.startRun(session.summary.id, "失败后从同一状态继续");
    const failed = await host.waitForRun(session.summary.id, started.runId);
    expect(failed).toMatchObject({ run: { status: "failed" }, state: { revision: 0, step: 0 } });

    valid = true;
    expect(host.retryRun(session.summary.id, started.runId).run.status).toBe("queued");
    const completed = await host.waitForRun(session.summary.id, started.runId);

    expect(completed).toMatchObject({ run: { status: "completed" }, state: { revision: 1, step: 1 } });
    expect(completed.run.events.filter((event) => event.type === "run.execution_started")).toHaveLength(2);
  });

  it("ends an existing event generator immediately after yielding an attempt boundary", async () => {
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
    const started = host.startRun(session.summary.id, "先失败再重试");
    await host.waitForRun(session.summary.id, started.runId);
    const events = host.subscribeRunEvents(session.summary.id, started.runId);
    let boundary: Awaited<ReturnType<typeof events.next>>;
    do {
      boundary = await events.next();
    } while (!boundary.done && boundary.value.type !== "run.failed");
    expect(boundary).toMatchObject({ done: false, value: { type: "run.failed" } });

    valid = true;
    host.retryRun(session.summary.id, started.runId);
    expect(await events.next()).toEqual({ done: true, value: undefined });
    expect((await host.waitForRun(session.summary.id, started.runId)).run.status).toBe("completed");
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
    const { host, store } = createHost(provider);
    const session = await host.createSession({ worldId: "open-world-fixture" });
    const started = host.startRun(session.summary.id, "打开石门并进入里面");

    const paused = await host.waitForRun(session.summary.id, started.runId);
    expect(paused.run.status).toBe("awaiting_player");

    const resumed = host.continueRun(session.summary.id, started.runId, {
      id: "decision-1",
      text: "使用我携带的铜钥匙",
    });
    expect(resumed.run.id).toBe(started.runId);
    const completed = await host.waitForRun(session.summary.id, started.runId);

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
    expect(host.continueRun(session.summary.id, started.runId, {
      id: "decision-1",
      text: "使用我携带的铜钥匙",
    }).run.status).toBe("completed");
    const stored = store.read(session.summary.id);
    const tampered = stored.document;
    const firstInput = tampered.runs[started.runId].events.find((event) => event.type === "player.input");
    if (!firstInput || firstInput.type !== "player.input") throw new Error("fixture has no goal input");
    firstInput.payload.text = "被篡改的首次目标";
    expect(() => store.compareAndSwap(tampered.id, stored.generation, tampered))
      .toThrow("input history does not match canonical history revision 1");
    expect(() => host.continueRun(session.summary.id, started.runId, {
      id: "decision-1",
      text: "改用另一种办法",
    })).toThrow("different text");
  });

  it("starts a new intent immediately after a completed run", async () => {
    const provider = new ScriptedModelProvider(normalHandler());
    const { host } = createHost(provider);
    const session = await host.createSession({ worldId: "open-world-fixture" });
    const first = host.startRun(session.summary.id, "完成第一个目标");
    expect((await host.waitForRun(session.summary.id, first.runId)).run.status).toBe("completed");

    const second = host.startRun(session.summary.id, "立即开始第二个目标");
    expect(host.run(session.summary.id, second.runId).run.status).toBe("queued");
    expect(await host.waitForRun(session.summary.id, second.runId)).toMatchObject({
      run: { status: "completed" },
      state: { revision: 2, step: 2 },
    });
  });

  it("binds every historical run input prefix to its canonical committed intent", async () => {
    const provider = new ScriptedModelProvider(({ profileId, prompt }) => {
      const context = JSON.parse(prompt) as {
        baseRevision: number;
        step: number;
        jointActions: Array<{ id: string }>;
        revision: number;
        agent: { id: string };
      };
      if (profileId !== "truth-deepseek") return mindOutput(context.agent.id, context.revision);
      const proposal = transition(context);
      if (context.step === 0) {
        proposal.intentStatus = "active";
        proposal.requiresPlayerDecision = true;
      }
      return { kind: "transition", proposal };
    });
    const { host, store } = createHost(provider);
    const session = await host.createSession({ worldId: "open-world-fixture" });
    const first = host.startRun(session.summary.id, "调查石门后再决定");
    expect((await host.waitForRun(session.summary.id, first.runId)).run.status).toBe("awaiting_player");
    host.continueRun(session.summary.id, first.runId, {
      id: "historical-clarification",
      text: "确认守门人身份后进入",
    });
    expect((await host.waitForRun(session.summary.id, first.runId)).run.status).toBe("completed");

    const second = host.startRun(session.summary.id, "继续调查庭院");
    expect((await host.waitForRun(session.summary.id, second.runId)).run.status).toBe("completed");

    const expectHistoricalTamperRejected = (
      mutate: (run: StoredWorldSession["document"]["runs"][string]) => void,
      message: string,
    ) => {
      const stored = store.read(session.summary.id);
      mutate(stored.document.runs[first.runId]);
      expect(() => store.compareAndSwap(stored.document.id, stored.generation, stored.document)).toThrow(message);
    };

    expectHistoricalTamperRejected((run) => {
      const goal = run.events.find((event) => event.type === "player.input" && event.payload.kind === "goal");
      if (!goal || goal.type !== "player.input") throw new Error("fixture has no historical goal");
      goal.payload.text = "被篡改的旧目标";
    }, "input history does not match canonical history revision 1");
    expectHistoricalTamperRejected((run) => {
      const clarification = run.events.find((event) =>
        event.type === "player.input" && event.payload.kind === "clarification");
      if (!clarification || clarification.type !== "player.input") {
        throw new Error("fixture has no historical clarification");
      }
      clarification.payload.text = "被篡改的旧澄清";
    }, "input history does not match canonical history revision 2");
    expectHistoricalTamperRejected((run) => {
      const clarificationIndex = run.events.findIndex((event) =>
        event.type === "player.input" && event.payload.kind === "clarification");
      const clarification = run.events[clarificationIndex];
      const execution = run.events.slice(clarificationIndex + 1).find((event) =>
        event.type === "run.execution_started" && event.payload.reason === "player_input");
      if (!clarification || clarification.type !== "player.input" ||
        !execution || execution.type !== "run.execution_started") {
        throw new Error("fixture has no historical clarification execution");
      }
      clarification.payload.id = "tampered-historical-input";
      execution.payload.inputId = clarification.payload.id;
    }, "input history does not match canonical history revision 2");
    expectHistoricalTamperRejected((run) => {
      const clarification = run.events.find((event) =>
        event.type === "player.input" && event.payload.kind === "clarification");
      if (!clarification || clarification.type !== "player.input") {
        throw new Error("fixture has no historical clarification");
      }
      clarification.payload.kind = "goal";
    }, "repeats its goal input");
    expectHistoricalTamperRejected((run) => {
      run.intentId = "tampered-historical-intent";
    }, "intent id does not match canonical history revision 1");
  });

  it("does not bind a historical zero-step terminal run to a later committed intent", async () => {
    let failFirstGoal = true;
    const provider = new ScriptedModelProvider(({ profileId, prompt }) => {
      const context = JSON.parse(prompt) as {
        baseRevision: number;
        step: number;
        jointActions: Array<{ id: string }>;
        revision: number;
        agent: { id: string };
      };
      if (profileId !== "truth-deepseek") return mindOutput(context.agent.id, context.revision);
      if (failFirstGoal) throw new ModelConfigurationError("simulated permanent model configuration failure");
      return { kind: "transition", proposal: transition(context) };
    });
    const { host, store } = createHost(provider);
    const session = await host.createSession({ worldId: "open-world-fixture" });
    const first = host.startRun(session.summary.id, "在提交任何步骤前终止");
    expect((await host.waitForRun(session.summary.id, first.runId)).run.status).toBe("failed");
    expect(host.cancelRun(session.summary.id, first.runId).run.status).toBe("cancelled");

    failFirstGoal = false;
    const second = host.startRun(session.summary.id, "开始可提交的新目标");
    expect((await host.waitForRun(session.summary.id, second.runId)).run.status).toBe("completed");
    const stored = store.read(session.summary.id);
    expect(stored.document.runs[first.runId].events.some((event) => event.type === "step.committed")).toBe(false);
    expect(stored.document.runs[second.runId].events.some((event) => event.type === "step.committed")).toBe(true);
    expect(() => store.compareAndSwap(stored.document.id, stored.generation, stored.document)).not.toThrow();
  });

  it("starts and binds a new goal after cancelling a persisted clarification", async () => {
    let releaseSecondStep!: () => void;
    const secondStepGate = new Promise<void>((resolve) => { releaseSecondStep = resolve; });
    let markSecondStepEntered!: () => void;
    const secondStepEntered = new Promise<void>((resolve) => { markSecondStepEntered = resolve; });
    const provider = new ScriptedModelProvider(async ({ profileId, prompt }) => {
      const context = JSON.parse(prompt) as {
        baseRevision: number;
        step: number;
        jointActions: Array<{ id: string }>;
        revision: number;
        agent: { id: string };
      };
      if (profileId !== "truth-deepseek") return mindOutput(context.agent.id, context.revision);
      const proposal = transition(context);
      if (context.step === 0) {
        proposal.intentStatus = "active";
        proposal.requiresPlayerDecision = true;
      } else {
        markSecondStepEntered();
        await secondStepGate;
      }
      return { kind: "transition", proposal };
    });
    const { host, store } = createHost(provider);
    const session = await host.createSession({ worldId: "open-world-fixture" });
    const first = host.startRun(session.summary.id, "先观察石门再决定");
    expect((await host.waitForRun(session.summary.id, first.runId)).run.status).toBe("awaiting_player");

    host.continueRun(session.summary.id, first.runId, {
      id: "cancelled-clarification",
      text: "尝试使用铜钥匙",
    });
    await secondStepEntered;
    host.cancelRun(session.summary.id, first.runId);
    releaseSecondStep();
    const cancelled = await host.waitForRun(session.summary.id, first.runId);
    expect(cancelled.run.status).toBe("cancelled");
    expect(cancelled.run.inputs).toHaveLength(2);

    const definition = loadWorldScript(fixtureRoot, { modelCatalog: provider.catalog });
    const recovered = new WorldHost({
      repository: new MemoryWorldRepository({ [definition.id]: definition }),
      store,
      provider,
      idFactory: () => "new-goal-after-cancel",
      now: () => new Date("2026-08-23T00:00:01.000Z"),
    });
    expect(recovered.session(session.summary.id).state.activeIntent?.status).toBe("cancelled");
    const second = recovered.startRun(session.summary.id, "取消后开始全新目标");
    const secondResult = await recovered.waitForRun(session.summary.id, second.runId);
    expect(
      secondResult.run.status,
      store.read(session.summary.id).document.runs[second.runId].internalError,
    ).toBe("completed");

    const stored = store.read(session.summary.id);
    const tampered = stored.document;
    const newGoal = tampered.runs[second.runId].events.find((event) =>
      event.type === "player.input" && event.payload.kind === "goal");
    if (!newGoal || newGoal.type !== "player.input") throw new Error("fixture has no new goal input");
    newGoal.payload.text = "被篡改的新目标";
    expect(() => store.compareAndSwap(tampered.id, stored.generation, tampered))
      .toThrow("input history does not match canonical history revision 2");
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
    const oldRun = host.startRun(session.summary.id, "先产生失败运行");
    expect((await host.waitForRun(session.summary.id, oldRun.runId)).run.status).toBe("failed");
    expect(() => host.startRun(session.summary.id, "新的活动运行")).toThrow("already has active run");

    expect(host.cancelRun(session.summary.id, oldRun.runId).run.status).toBe("cancelled");
    valid = true;
    const nextRun = host.startRun(session.summary.id, "新的活动运行");
    expect((await host.waitForRun(session.summary.id, nextRun.runId)).run.status).toBe("completed");
  });
});
