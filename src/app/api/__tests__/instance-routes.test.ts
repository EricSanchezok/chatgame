import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DeterministicModelProvider } from "../../../engine/testing/model-provider";
import { loadWorldScript } from "../../../script/world-loader";
import { MemoryWorldRepository } from "../../../script/world-repository";
import { LocalDatabase } from "../../../server/local-database";
import { WorldHost } from "../../../server/world-host";
import { POST as advanceInstance } from "../instances/[id]/advance/route";
import { GET as getInstanceEvents } from "../instances/[id]/events/route";
import { POST as submitAction } from "../instances/[id]/participants/[participantId]/actions/route";
import { GET as getInstance } from "../instances/[id]/route";
import { GET as getObserver } from "../instances/[id]/observer/route";
import { POST as createInstance } from "../instances/route";

let root: string;
let database: LocalDatabase;

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "lwe-instance-routes-"));
  const provider = new DeterministicModelProvider();
  const definition = loadWorldScript(path.resolve("test/fixtures/open-world-script"), {
    seed: 71,
    modelCatalog: provider.catalog,
  });
  database = new LocalDatabase(path.join(root, "livingworld.sqlite"), { heartbeat: false });
  WorldHost.setForTests(new WorldHost({
    repository: new MemoryWorldRepository({ [definition.id]: definition }),
    store: database,
    ledger: database,
    provider,
  }));
});

afterEach(() => {
  WorldHost.setForTests(undefined);
  database.close();
  rmSync(root, { recursive: true, force: true });
});

function jsonRequest(url: string, value: unknown): Request {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(value),
  });
}

describe("World Instance Route Handlers", () => {
  it("uses the production observer and transactional Origin paths", async () => {
    const headlessResponse = await createInstance(jsonRequest("http://local/api/instances", {
      worldId: "open-world-fixture",
      seed: 71,
      start: { kind: "observer" },
    }));
    expect(headlessResponse.status).toBe(201);
    const headless = await headlessResponse.json();

    const advancedResponse = await advanceInstance(jsonRequest(
      `http://local/api/instances/${headless.summary.id}/advance`,
      { expectedRevision: 0, trigger: "manual" },
    ), { params: Promise.resolve({ id: headless.summary.id }) });
    expect(advancedResponse.status).toBe(200);
    expect(await advancedResponse.json()).toMatchObject({
      summary: { revision: 1, step: 1, participantCount: 0 },
    });

    const observerResponse = await getObserver(
      new Request(`http://local/api/instances/${headless.summary.id}/observer`),
      { params: Promise.resolve({ id: headless.summary.id }) },
    );
    expect(observerResponse.status).toBe(200);
    const observer = await observerResponse.json();
    expect(observer.agents).toHaveLength(2);
    expect(JSON.stringify(observer)).not.toContain("canonicalEntityIds");

    const originResponse = await createInstance(jsonRequest("http://local/api/instances", {
      worldId: "open-world-fixture",
      start: {
        kind: "origin",
        originId: "courtyard-wanderer",
        displayName: "小明",
        appearance: "背着旧旅行包。",
        motivation: "找到石门后的道路。",
      },
    }));
    expect(originResponse.status).toBe(201);
    const origin = await originResponse.json();
    expect(origin.controlledView.self).toMatchObject({ name: "小明", location: { name: "石门前庭" } });
    expect(origin.conversation.turns[0].response.suggestions).toHaveLength(3);
    expect(JSON.stringify(origin)).not.toContain("canonicalEntityIds");

    const participant = origin.participants[0];
    const actionResponse = await submitAction(jsonRequest(
      `http://local/api/instances/${origin.summary.id}/participants/${participant.id}/actions`,
      {
        submissionId: "route-action",
        expectedRevision: origin.summary.revision,
        text: "我观察周围。",
      },
    ), { params: Promise.resolve({ id: origin.summary.id, participantId: participant.id }) });
    expect(actionResponse.status).toBe(200);
    const acted = await actionResponse.json();
    expect(acted.summary).toMatchObject({ revision: origin.summary.revision, runStatus: "queued" });
    expect(acted.conversation.turns).toHaveLength(2);

    let readResponse!: Response;
    let read!: { summary: { revision: number; participantCount: number } };
    for (let attempt = 0; attempt < 100; attempt += 1) {
      readResponse = await getInstance(
        new Request(`http://local/api/instances/${origin.summary.id}`),
        { params: Promise.resolve({ id: origin.summary.id }) },
      );
      read = await readResponse.clone().json();
      if (read.summary.revision >= origin.summary.revision + 1) break;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    expect(readResponse.status).toBe(200);
    expect(read).toMatchObject({
      summary: { revision: origin.summary.revision + 1, participantCount: 1 },
    });
  }, 30_000);

  it("rejects malformed requests before they reach the host", async () => {
    const response = await createInstance(jsonRequest("http://local/api/instances", {
      worldId: "",
      start: { kind: "observer" },
    }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "worldId is required" });

    const missingEvents = await getInstanceEvents(
      new Request("http://local/api/instances/missing/events"),
      { params: Promise.resolve({ id: "missing" }) },
    );
    expect(missingEvents.status).toBe(404);
    expect(await missingEvents.json()).toEqual({ error: "world instance not found: missing" });
  });
});
