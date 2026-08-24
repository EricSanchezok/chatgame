import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { RecordingRuntimeObserver } from "../../../engine/observability";
import { DeterministicModelProvider } from "../../../engine/testing/model-provider";
import { loadWorldScript } from "../../../script/world-loader";
import { MemoryWorldRepository } from "../../../script/world-repository";
import { WorldHost, type WorldHostOptions } from "../../../server/world-host";
import { MemoryWorldSessionStore } from "../../../server/world-session-store";
import { GET as streamEvents } from "../sessions/[id]/runs/[runId]/events/route";
import { POST as continueRun } from "../sessions/[id]/runs/[runId]/inputs/route";
import { GET as getRun } from "../sessions/[id]/runs/[runId]/route";
import { POST as startRun } from "../sessions/[id]/runs/route";
import {
  DELETE as deleteSession,
  GET as getSession,
  PATCH as renameSession,
} from "../sessions/[id]/route";
import { GET as listSessions, POST as createSession } from "../sessions/route";
import { GET as listWorlds } from "../worlds/route";
import { DELETE as deleteWorld } from "../worlds/[id]/route";
import { errorResponse } from "../h";

const fixtureRoot = path.resolve("test/fixtures/open-world-script");

function installHost(
  observer?: RecordingRuntimeObserver,
  catalogManager?: WorldHostOptions["catalogManager"],
): WorldHost {
  let id = 0;
  const provider = new DeterministicModelProvider();
  const definition = loadWorldScript(fixtureRoot, { modelCatalog: provider.catalog });
  const host = new WorldHost({
    repository: new MemoryWorldRepository({ [definition.id]: definition }),
    store: new MemoryWorldSessionStore(observer),
    catalogManager,
    provider,
    idFactory: () => `route-${++id}`,
    now: () => new Date("2026-08-23T00:00:00.000Z"),
    observer,
  });
  WorldHost.setForTests(host);
  return host;
}

afterEach(() => WorldHost.setForTests(undefined));

describe("world API routes", () => {
  it("does not expose unexpected server diagnostics in a 500 response", async () => {
    const response = errorResponse(new Error("canonical-secret-id at /private/server/path"));

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "服务器无法完成请求。" });
  });

  it("rejects session seeds outside the uint32 contract", async () => {
    const response = await createSession(new Request("http://local/api/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ worldId: "open-world-fixture", seed: 0x100000000 }),
    }));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "seed must be a uint32" });
  });

  it("lists schema v6 worlds and rejects empty run text", async () => {
    installHost();
    const worlds = await listWorlds();
    expect(await worlds.json()).toMatchObject({
      worlds: [{ id: "open-world-fixture" }],
    });

    const sessionResponse = await createSession(new Request("http://local/api/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ worldId: "open-world-fixture", seed: 12 }),
    }));
    const session = await sessionResponse.json() as { summary: { id: string } };
    const response = await startRun(
      new Request(`http://local/api/sessions/${session.summary.id}/runs`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: "   " }),
      }),
      { params: Promise.resolve({ id: session.summary.id }) },
    );
    expect(response.status).toBe(400);
  });

  it("deletes an explicitly addressed installed world", async () => {
    const deleted: string[] = [];
    installHost(undefined, {
      importWorld: () => { throw new Error("unused"); },
      deleteWorld: (worldId) => { deleted.push(worldId); },
    });

    const response = await deleteWorld(
      new Request("http://local/api/worlds/open-world-fixture", { method: "DELETE" }),
      { params: Promise.resolve({ id: "open-world-fixture" }) },
    );

    expect(response.status).toBe(204);
    expect(deleted).toEqual(["open-world-fixture"]);
  });

  it("lists, renames, reads, and deletes an explicitly addressed session", async () => {
    installHost();
    const createdResponse = await createSession(new Request("http://local/api/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ worldId: "open-world-fixture" }),
    }));
    const created = await createdResponse.json() as { summary: { id: string; title: string } };

    expect(await (await listSessions()).json()).toMatchObject({
      sessions: [{ id: created.summary.id, title: created.summary.title }],
    });
    const renamedResponse = await renameSession(
      new Request(`http://local/api/sessions/${created.summary.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: " 石门之外 " }),
      }),
      { params: Promise.resolve({ id: created.summary.id }) },
    );
    expect(await renamedResponse.json()).toMatchObject({ summary: { title: "石门之外" } });
    expect(await (await getSession(
      new Request(`http://local/api/sessions/${created.summary.id}`),
      { params: Promise.resolve({ id: created.summary.id }) },
    )).json()).toMatchObject({ summary: { title: "石门之外" }, runs: [] });

    expect((await deleteSession(
      new Request(`http://local/api/sessions/${created.summary.id}`, { method: "DELETE" }),
      { params: Promise.resolve({ id: created.summary.id }) },
    )).status).toBe(204);
    expect(await (await listSessions()).json()).toEqual({ sessions: [] });
  });

  it("runs arbitrary text and exposes replayable SSE without canonical bindings", async () => {
    const host = installHost();
    const sessionResponse = await createSession(new Request("http://local/api/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ worldId: "open-world-fixture", seed: 33 }),
    }));
    const session = await sessionResponse.json() as { summary: { id: string } };
    const runResponse = await startRun(
      new Request(`http://local/api/sessions/${session.summary.id}/runs`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: "我希望凭空获得一万灵石" }),
      }),
      { params: Promise.resolve({ id: session.summary.id }) },
    );
    expect(runResponse.status).toBe(202);
    const run = await runResponse.json() as { runId: string };
    expect(Object.keys(run)).toEqual(["runId"]);
    await host.waitForRun(session.summary.id, run.runId);

    const response = await getRun(
      new Request(`http://local/api/sessions/${session.summary.id}/runs/${run.runId}`),
      { params: Promise.resolve({ id: session.summary.id, runId: run.runId }) },
    );
    expect(await response.json()).toMatchObject({
      run: {
        status: "completed",
        inputs: [{ kind: "goal", text: "我希望凭空获得一万灵石" }],
      },
      state: { revision: 1, step: 1 },
    });

    const invalidContinuation = await continueRun(
      new Request(`http://local/api/sessions/${session.summary.id}/runs/${run.runId}/inputs`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: "input-after-completion", text: "继续" }),
      }),
      { params: Promise.resolve({ id: session.summary.id, runId: run.runId }) },
    );
    expect(invalidContinuation.status).toBe(409);

    const eventResponse = await streamEvents(
      new Request(`http://local/api/sessions/${session.summary.id}/runs/${run.runId}/events?after=0`),
      { params: Promise.resolve({ id: session.summary.id, runId: run.runId }) },
    );
    const eventStream = await eventResponse.text();
    expect(eventResponse.headers.get("content-type")).toContain("text/event-stream");
    expect(eventStream).toContain("event: player.input");
    expect(eventStream).toContain("event: run.execution_started");
    expect(eventStream).toContain("event: player.observation");
    expect(eventStream).toContain("event: player.outcome");
    expect(eventStream).toContain("event: run.completed");
    expect(eventStream).not.toContain("canonicalEntityIds");

    const replayAfterTwo = await streamEvents(
      new Request(`http://local/api/sessions/${session.summary.id}/runs/${run.runId}/events?after=2`),
      { params: Promise.resolve({ id: session.summary.id, runId: run.runId }) },
    );
    const replayed = await replayAfterTwo.text();
    expect(replayed).not.toContain("id: 1\n");
    expect(replayed).not.toContain("id: 2\n");
    expect(replayed).toContain("id: 3\n");

    const replayFromHeader = await streamEvents(
      new Request(`http://local/api/sessions/${session.summary.id}/runs/${run.runId}/events`, {
        headers: { "Last-Event-ID": "3" },
      }),
      { params: Promise.resolve({ id: session.summary.id, runId: run.runId }) },
    );
    const headerReplay = await replayFromHeader.text();
    expect(headerReplay).not.toContain("id: 3\n");
    expect(headerReplay).toContain("id: 4\n");

    const tail = host.run(session.summary.id, run.runId).run.events.at(-1)!.sequence;
    const boundaryAtTail = await streamEvents(
      new Request(`http://local/api/sessions/${session.summary.id}/runs/${run.runId}/events?after=${tail}`),
      { params: Promise.resolve({ id: session.summary.id, runId: run.runId }) },
    );
    expect(boundaryAtTail.status).toBe(204);
    expect(await boundaryAtTail.text()).toBe("");

    const ahead = await streamEvents(
      new Request(`http://local/api/sessions/${session.summary.id}/runs/${run.runId}/events?after=${tail + 1}`),
      { params: Promise.resolve({ id: session.summary.id, runId: run.runId }) },
    );
    expect(ahead.status).toBe(409);

    const invalid = await streamEvents(
      new Request(`http://local/api/sessions/${session.summary.id}/runs/${run.runId}/events?after=-1`),
      { params: Promise.resolve({ id: session.summary.id, runId: run.runId }) },
    );
    expect(invalid.status).toBe(400);

    const invalidHeader = await streamEvents(
      new Request(`http://local/api/sessions/${session.summary.id}/runs/${run.runId}/events?after=0`, {
        headers: { "Last-Event-ID": "not-a-cursor" },
      }),
      { params: Promise.resolve({ id: session.summary.id, runId: run.runId }) },
    );
    expect(invalidHeader.status).toBe(400);
  });

  it("correlates HTTP, run, step, model, persistence, and SSE without changing public payloads", async () => {
    const observer = new RecordingRuntimeObserver({ mode: "full" });
    const host = installHost(observer);
    const sessionResponse = await createSession(new Request("http://local/api/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ worldId: "open-world-fixture", seed: 44 }),
    }));
    const session = await sessionResponse.json() as { summary: { id: string } };
    const input = "验证端到端关联";
    const runResponse = await startRun(
      new Request(`http://local/api/sessions/${session.summary.id}/runs`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: input, apiKey: "must-not-be-logged" }),
      }),
      { params: Promise.resolve({ id: session.summary.id }) },
    );
    const run = await runResponse.json() as { runId: string };
    await host.waitForRun(session.summary.id, run.runId);

    const runChain = observer.events.filter((event) => event.correlation?.runId === run.runId);
    const runRequestId = runChain.find((event) => event.event === "run.queued")?.correlation?.requestId;
    expect(runRequestId).toBeTruthy();
    expect(runChain.filter((event) => event.correlation?.requestId === runRequestId)
      .map((event) => event.event)).toEqual(expect.arrayContaining([
      "run.queued",
      "run.started",
      "step.started",
      "model.context.built",
      "model.semantic.accepted",
      "persistence.write.completed",
      "step.committed",
      "run.finished",
    ]));
    expect(observer.events.find((event) =>
      event.event === "http.request.body" && event.correlation?.requestId === runRequestId)?.payload)
      .toEqual({ text: input, apiKey: "[REDACTED]" });
    expect(runChain.find((event) => event.event === "model.semantic.accepted")?.correlation)
      .toMatchObject({
        sessionId: session.summary.id,
        runId: run.runId,
        runAttempt: 1,
        revision: 0,
        step: 1,
      });
    expect(runChain.find((event) => event.event === "model.semantic.accepted")
      ?.correlation?.modelInvocationId).toBeTruthy();

    const eventResponse = await streamEvents(
      new Request(`http://local/api/sessions/${session.summary.id}/runs/${run.runId}/events?after=0`),
      { params: Promise.resolve({ id: session.summary.id, runId: run.runId }) },
    );
    await eventResponse.text();
    expect(observer.events.filter((event) =>
      event.event.startsWith("sse.") && event.correlation?.runId === run.runId)
      .map((event) => event.event)).toEqual(expect.arrayContaining([
      "sse.connection.opened",
      "sse.event.sent",
      "sse.connection.closed",
    ]));

    const aborted = new AbortController();
    aborted.abort();
    const cancelledResponse = await streamEvents(
      new Request(`http://local/api/sessions/${session.summary.id}/runs/${run.runId}/events`, {
        signal: aborted.signal,
      }),
      { params: Promise.resolve({ id: session.summary.id, runId: run.runId }) },
    );
    await cancelledResponse.text();
    expect(observer.events.some((event) =>
      event.event === "sse.connection.cancelled" && event.correlation?.runId === run.runId)).toBe(true);
    expect(JSON.stringify(host.run(session.summary.id, run.runId))).not.toContain("modelAudits");
  });
});
