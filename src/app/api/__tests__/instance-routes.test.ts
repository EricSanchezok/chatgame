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
import { GET as getInstance } from "../instances/[id]/route";
import { POST as createParticipant } from "../instances/[id]/participants/route";
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
  it("uses the production headless and Participant entry path without exposing canonical bindings", async () => {
    const createdResponse = await createInstance(jsonRequest("http://local/api/instances", {
      worldId: "open-world-fixture",
      seed: 71,
    }));
    expect(createdResponse.status).toBe(201);
    const created = await createdResponse.json();

    const advancedResponse = await advanceInstance(jsonRequest(
      `http://local/api/instances/${created.summary.id}/advance`,
      { expectedRevision: 0, trigger: "manual" },
    ), { params: Promise.resolve({ id: created.summary.id }) });
    expect(advancedResponse.status).toBe(200);
    const advanced = await advancedResponse.json();
    expect(advanced.summary).toMatchObject({ revision: 1, step: 1, participantCount: 0 });

    const joinedResponse = await createParticipant(jsonRequest(
      `http://local/api/instances/${created.summary.id}/participants`,
      {
        expectedRevision: 1,
        originId: "courtyard-wanderer",
        displayName: "小明",
        appearance: "背着旧旅行包。",
        motivation: "找到石门后的道路。",
      },
    ), { params: Promise.resolve({ id: created.summary.id }) });
    expect(joinedResponse.status).toBe(201);
    const joined = await joinedResponse.json();
    expect(joined.arrival.suggestions).toHaveLength(3);
    expect(joined.instance.controlledView.entity).toMatchObject({ name: "小明", location: "石门前庭" });
    expect(JSON.stringify(joined)).not.toContain("canonicalEntityIds");

    const readResponse = await getInstance(
      new Request(`http://local/api/instances/${created.summary.id}`),
      { params: Promise.resolve({ id: created.summary.id }) },
    );
    expect(readResponse.status).toBe(200);
    expect(await readResponse.json()).toMatchObject({ summary: { revision: 2, participantCount: 1 } });
  }, 30_000);

  it("rejects malformed requests before they reach the host", async () => {
    const response = await createInstance(jsonRequest("http://local/api/instances", { worldId: "" }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "worldId is required" });
  });
});
