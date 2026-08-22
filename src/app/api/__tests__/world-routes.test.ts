import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DeterministicModelProvider } from "../../../engine/model-provider";
import { FileWorldRepository } from "../../../script/world-repository";
import { WorldHost } from "../../../server/world-host";
import { MemoryWorldSessionStore } from "../../../server/world-session-store";
import { GET as streamEvents } from "../sessions/[id]/runs/[runId]/events/route";
import { GET as getRun } from "../sessions/[id]/runs/[runId]/route";
import { POST as startRun } from "../sessions/[id]/runs/route";
import { POST as createSession } from "../sessions/route";
import { GET as listWorlds } from "../worlds/route";

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
  it("lists schema v2 worlds and rejects empty run text", async () => {
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
    const run = await runResponse.json() as { id: string };
    await host.waitForRun(session.id, run.id);

    const response = await getRun(
      new Request(`http://local/api/sessions/${session.id}/runs/${run.id}`),
      { params: Promise.resolve({ id: session.id, runId: run.id }) },
    );
    expect(await response.json()).toMatchObject({ status: "completed", text: "我希望凭空获得一万灵石" });

    const eventResponse = await streamEvents(
      new Request(`http://local/api/sessions/${session.id}/runs/${run.id}/events?after=0`),
      { params: Promise.resolve({ id: session.id, runId: run.id }) },
    );
    const eventStream = await eventResponse.text();
    expect(eventResponse.headers.get("content-type")).toContain("text/event-stream");
    expect(eventStream).toContain("event: run.started");
    expect(eventStream).toContain("event: player.observation");
    expect(eventStream).toContain("event: run.completed");
    expect(eventStream).not.toContain("canonicalEntityIds");
  });
});
