import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DeterministicModelProvider } from "../../../engine/testing/model-provider";
import { FileWorldRepository } from "../../../script/world-repository";
import { WorldHost } from "../../../server/world-host";
import { MemoryWorldSessionStore } from "../../../server/world-session-store";
import { GET as streamEvents } from "../sessions/[id]/runs/[runId]/events/route";
import { GET as getRun } from "../sessions/[id]/runs/[runId]/route";
import { POST as startRun } from "../sessions/[id]/runs/route";
import { POST as createSession } from "../sessions/route";
import { GET as listWorlds } from "../worlds/route";
import { errorResponse } from "../h";

const fixtureRoot = path.resolve("test/fixtures");

function installHost(): WorldHost {
  let id = 0;
  const host = new WorldHost({
    repository: new FileWorldRepository(fixtureRoot),
    store: new MemoryWorldSessionStore(),
    provider: new DeterministicModelProvider(),
    idFactory: () => `route-${++id}`,
    now: () => new Date("2026-08-23T00:00:00.000Z"),
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

  it("lists schema v4 worlds and rejects empty run text", async () => {
    installHost();
    const worlds = await listWorlds();
    expect(await worlds.json()).toMatchObject({
      worlds: [{ id: "open-world-fixture" }],
    });

    const sessionResponse = await createSession(new Request("http://local/api/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ scriptId: "open-world-fixture", seed: 12 }),
    }));
    const session = await sessionResponse.json() as { id: string };
    const response = await startRun(
      new Request(`http://local/api/sessions/${session.id}/runs`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: "   " }),
      }),
      { params: Promise.resolve({ id: session.id }) },
    );
    expect(response.status).toBe(400);
  });

  it("runs arbitrary text and exposes replayable SSE without canonical bindings", async () => {
    const host = installHost();
    const sessionResponse = await createSession(new Request("http://local/api/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ scriptId: "open-world-fixture", seed: 33 }),
    }));
    const session = await sessionResponse.json() as { id: string };
    const runResponse = await startRun(
      new Request(`http://local/api/sessions/${session.id}/runs`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: "我希望凭空获得一万灵石" }),
      }),
      { params: Promise.resolve({ id: session.id }) },
    );
    expect(runResponse.status).toBe(202);
    const run = await runResponse.json() as { runId: string };
    expect(Object.keys(run)).toEqual(["runId"]);
    await host.waitForRun(session.id, run.runId);

    const response = await getRun(
      new Request(`http://local/api/sessions/${session.id}/runs/${run.runId}`),
      { params: Promise.resolve({ id: session.id, runId: run.runId }) },
    );
    expect(await response.json()).toMatchObject({
      run: { status: "completed", text: "我希望凭空获得一万灵石" },
      state: { revision: 1, step: 1 },
    });

    const eventResponse = await streamEvents(
      new Request(`http://local/api/sessions/${session.id}/runs/${run.runId}/events?after=0`),
      { params: Promise.resolve({ id: session.id, runId: run.runId }) },
    );
    const eventStream = await eventResponse.text();
    expect(eventResponse.headers.get("content-type")).toContain("text/event-stream");
    expect(eventStream).toContain("event: run.started");
    expect(eventStream).toContain("event: player.observation");
    expect(eventStream).toContain("event: player.outcome");
    expect(eventStream).toContain("event: run.completed");
    expect(eventStream).not.toContain("canonicalEntityIds");

    const replayAfterTwo = await streamEvents(
      new Request(`http://local/api/sessions/${session.id}/runs/${run.runId}/events?after=2`),
      { params: Promise.resolve({ id: session.id, runId: run.runId }) },
    );
    const replayed = await replayAfterTwo.text();
    expect(replayed).not.toContain("id: 1\n");
    expect(replayed).not.toContain("id: 2\n");
    expect(replayed).toContain("id: 3\n");

    const replayFromHeader = await streamEvents(
      new Request(`http://local/api/sessions/${session.id}/runs/${run.runId}/events`, {
        headers: { "Last-Event-ID": "3" },
      }),
      { params: Promise.resolve({ id: session.id, runId: run.runId }) },
    );
    const headerReplay = await replayFromHeader.text();
    expect(headerReplay).not.toContain("id: 3\n");
    expect(headerReplay).toContain("id: 4\n");
  });
});
