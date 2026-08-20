// API layer tests: direct handler invocation (no HTTP server needed).
// Asserts JSON bodies, status codes, and error mapping across the
// scripts/sessions/assets routes.
import { mkdirSync, rmSync, cpSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(__dirname, "../../../..");
let scriptsRoot: string;
let sessionId: string;

beforeAll(() => {
  // Point EngineHost at a temp scripts root + temp data root (avoids
  // mutating the repo). The singleton caches by env, so both must be set
  // before the first import.
  scriptsRoot = path.join(tmpdir(), `cg-api-${Date.now()}`);
  mkdirSync(scriptsRoot, { recursive: true });
  cpSync(path.join(REPO_ROOT, "scripts", "starlight"), path.join(scriptsRoot, "starlight"), { recursive: true });
  process.env.CHATGAME_SCRIPTS_ROOT = scriptsRoot;
  process.env.CHATGAME_DATA_ROOT = path.join(scriptsRoot, ".data");
});

afterAll(() => {
  delete process.env.CHATGAME_SCRIPTS_ROOT;
  delete process.env.CHATGAME_DATA_ROOT;
  rmSync(scriptsRoot, { recursive: true, force: true });
});

describe("scripts API", () => {
  it("GET /api/scripts lists installed scripts with themes", async () => {
    const { GET } = await import("../scripts/route");
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.scripts).toHaveLength(1);
    expect(body.scripts[0].id).toBe("starlight");
    expect(body.scripts[0]).toMatchObject({ schemaVersion: "1.1", source: { kind: "built-in", label: "内置" } });
    expect(body.scripts[0].defaultThemeId).toBe("default");
    expect(body.scripts[0].theme.palette.background).toBe("#0b0e14");
  });

  it("GET /api/scripts/:id returns presentation + origins", async () => {
    const { GET } = await import("../scripts/[scriptId]/route");
    const res = await GET(new Request("http://x/api/scripts/starlight"), {
      params: Promise.resolve({ scriptId: "starlight" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.origins.map((o: { id: string }) => o.id)).toContain("crew-member");
    expect(body.presentation.themes.length).toBeGreaterThanOrEqual(3);
    expect(body.presentation.defaultThemeId).toBe("default");
    expect(body.safety.age_rating).toBe("16+");
    expect(body.safety.content_classes.length).toBeGreaterThan(0);
    expect(body.safety.content_classes).toContain("violence");
  });

  it("serves immutable versioned UI bundles with ETag revalidation", async () => {
    const detailMod = await import("../scripts/[scriptId]/route");
    const detailRes = await detailMod.GET(new Request("http://x/api/scripts/starlight"), {
      params: Promise.resolve({ scriptId: "starlight" }),
    });
    const detail = await detailRes.json();
    const bundleUrl = detail.presentation.uiBundle.url as string;
    const { GET } = await import("../scripts/[scriptId]/ui-bundle/route");
    const first = await GET(new Request(`http://x${bundleUrl}`), {
      params: Promise.resolve({ scriptId: "starlight" }),
    });
    expect(first.status).toBe(200);
    expect(first.headers.get("cache-control")).toContain("immutable");
    const etag = first.headers.get("etag");
    expect(etag).toMatch(/^"[0-9a-f]{20}"$/);

    const cached = await GET(new Request(`http://x${bundleUrl}`, { headers: { "if-none-match": etag! } }), {
      params: Promise.resolve({ scriptId: "starlight" }),
    });
    expect(cached.status).toBe(304);
  });

  it("GET /api/scripts/:id 404s unknown scripts", async () => {
    const { GET } = await import("../scripts/[scriptId]/route");
    const res = await GET(new Request("http://x/api/scripts/nope"), {
      params: Promise.resolve({ scriptId: "nope" }),
    });
    expect(res.status).toBe(404);
  });

  it("DELETE /api/scripts/:id never deletes an application-owned built-in", async () => {
    const { DELETE } = await import("../scripts/[scriptId]/route");
    const res = await DELETE(new Request("http://x/api/scripts/starlight", { method: "DELETE" }), {
      params: Promise.resolve({ scriptId: "starlight" }),
    });
    expect(res.status).toBe(403);
    expect(existsSync(path.join(scriptsRoot, "starlight", "script.yaml"))).toBe(true);
  });
});

describe("assets API", () => {
  it("serves a real asset file with the right content type", async () => {
    // starlight assets.yaml has no real files; add one to the temp copy.
    mkdirSync(path.join(scriptsRoot, "starlight", "assets", "icons"), { recursive: true });
    writeFileSync(path.join(scriptsRoot, "starlight", "assets", "icons", "probe.svg"), "<svg/>");
    const { GET } = await import("../scripts/[scriptId]/assets/[...path]/route");
    const res = await GET(new Request("http://x/api/scripts/starlight/assets/icons/probe.svg"), {
      params: Promise.resolve({ scriptId: "starlight", path: ["icons", "probe.svg"] }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/svg+xml");
    expect(await res.text()).toContain("<svg/>");
  });

  it("rejects path traversal with 400", async () => {
    const { GET } = await import("../scripts/[scriptId]/assets/[...path]/route");
    const res = await GET(new Request("http://x/api/scripts/starlight/assets/../../secret"), {
      params: Promise.resolve({ scriptId: "starlight", path: ["..", "..", "secret"] }),
    });
    expect(res.status).toBe(400);
  });
});

describe("sessions API", () => {
  it("POST /api/sessions creates a session with opening transcript", async () => {
    const { POST } = await import("../sessions/route");
    const res = await POST(
      new Request("http://x/api/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ scriptId: "starlight", originId: "crew-member", seed: 11 }),
      }),
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    sessionId = body.id;
    expect(body.state.transcript.length).toBeGreaterThan(0);
    expect(body.presentation.currentTheme.palette.background).toBe("#0b0e14");
  });

  it("POST /api/sessions rejects missing fields", async () => {
    const { POST } = await import("../sessions/route");
    const res = await POST(
      new Request("http://x/api/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ scriptId: "starlight" }),
      }),
    );
    expect(res.status).toBe(400);
  });

  it("POST /api/sessions/:id/turn runs a turn with mediaCues", async () => {
    const { POST } = await import("../sessions/[id]/turn/route");
    const res = await POST(
      new Request("http://x/api/sessions/turn", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: "你好，黑猫" }),
      }),
      { params: Promise.resolve({ id: sessionId }) },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.narrative.length).toBeGreaterThan(0);
    expect(Array.isArray(body.mediaCues)).toBe(true);
  });

  it("GET /api/sessions/:id/state includes transcript history", async () => {
    const { GET } = await import("../sessions/[id]/state/route");
    const res = await GET(new Request("http://x/api/sessions/state"), {
      params: Promise.resolve({ id: sessionId }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.state.transcript.length).toBeGreaterThanOrEqual(3); // opening + turn pair
  });

  it("POST /api/sessions/:id/descriptor edits a descriptor and returns state", async () => {
    const { POST } = await import("../sessions/[id]/descriptor/route");
    const stateMod = await import("../sessions/[id]/state/route");
    const beforeRes = await stateMod.GET(new Request("http://x/api/sessions/state"), {
      params: Promise.resolve({ id: sessionId }),
    });
    const before = (await beforeRes.json()).state.player.needs.oxygen.value;
    const res = await POST(
      new Request("http://x/api/sessions/descriptor", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ path: "player.needs.oxygen", text: "呼吸顺畅" }),
      }),
      { params: Promise.resolve({ id: sessionId }) },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.state.player.needs.oxygen.descriptor.description).toBe("呼吸顺畅");
    expect(body.state.player.needs.oxygen.descriptor.userEdited).toBe(true);
    // Dual-track rule: the edit never touches the numeric value.
    expect(body.state.player.needs.oxygen.value).toBe(before);
  });

  it("POST /api/sessions/:id/descriptor handles reputation paths safely (empty initial state)", async () => {
    const { POST } = await import("../sessions/[id]/descriptor/route");
    const res = await POST(
      new Request("http://x/api/sessions/descriptor", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ path: "player.reputation.deck-gang", text: "船帮眼里的无名之辈" }),
      }),
      { params: Promise.resolve({ id: sessionId }) },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    // Fresh starlight sessions start with no reputation entries; the edit
    // is a safe no-op that must not crash or mutate the list.
    expect(Array.isArray(body.state.player.reputation)).toBe(true);
    expect(body.state.player.reputation.length).toBe(0);
  });

  it("POST /api/sessions/:id/advance advances the clock and returns state", async () => {
    const { POST } = await import("../sessions/[id]/advance/route");
    const res = await POST(
      new Request("http://x/api/sessions/advance", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ hours: 24 }),
      }),
      { params: Promise.resolve({ id: sessionId }) },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.state.clock.totalHours).toBeGreaterThanOrEqual(24);
  });

  it("save -> list -> load round-trips via the API", async () => {
    const saveMod = await import("../sessions/[id]/save/route");
    const saveRes = await saveMod.POST(
      new Request("http://x/api/sessions/save", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ runId: "api-test" }),
      }),
      { params: Promise.resolve({ id: sessionId }) },
    );
    expect(saveRes.status).toBe(201);

    const listMod = await import("../sessions/[id]/saves/route");
    const listRes = await listMod.GET(new Request("http://x/api/sessions/saves"), {
      params: Promise.resolve({ id: sessionId }),
    });
    const listBody = await listRes.json();
    expect(listBody.saves.map((s: { runId: string }) => s.runId)).toContain("api-test.json");

    const loadMod = await import("../sessions/[id]/load/route");
    const loadRes = await loadMod.POST(
      new Request("http://x/api/sessions/load", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ runId: "api-test.json" }),
      }),
      { params: Promise.resolve({ id: sessionId }) },
    );
    expect(loadRes.status).toBe(200);
  });

  it("DELETE /api/sessions/:id destroys the session", async () => {
    const { DELETE } = await import("../sessions/[id]/route");
    const res = await DELETE(new Request("http://x/api/sessions/del", { method: "DELETE" }), {
      params: Promise.resolve({ id: sessionId }),
    });
    expect(res.status).toBe(200);

    const { GET } = await import("../sessions/[id]/state/route");
    const after = await GET(new Request("http://x/api/sessions/state"), {
      params: Promise.resolve({ id: sessionId }),
    });
    expect(after.status).toBe(404);
  });
});

describe("input ceilings", () => {
  let id: string;
  beforeAll(async () => {
    // The shared sessionId was destroyed by the DELETE test; create a
    // dedicated session for the ceiling checks.
    const { POST } = await import("../sessions/route");
    const res = await POST(
      new Request("http://x/api/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ scriptId: "starlight", originId: "crew-member", seed: 3 }),
      }),
    );
    const body = await res.json();
    id = body.id;
  });

  it("rejects turn input longer than 2000 chars with 400", async () => {
    const { POST } = await import("../sessions/[id]/turn/route");
    const res = await POST(
      new Request("http://x/api/sessions/turn", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: "x".repeat(2001) }),
      }),
      { params: Promise.resolve({ id }) },
    );
    expect(res.status).toBe(400);
  });

  it("accepts a 2000-char input", async () => {
    const { POST } = await import("../sessions/[id]/turn/route");
    const res = await POST(
      new Request("http://x/api/sessions/turn", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: "你好".repeat(1000) }),
      }),
      { params: Promise.resolve({ id }) },
    );
    expect(res.status).toBe(200);
  });

  it("rejects advance hours over 1000 with 400", async () => {
    const { POST } = await import("../sessions/[id]/advance/route");
    const res = await POST(
      new Request("http://x/api/sessions/advance", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ hours: 1001 }),
      }),
      { params: Promise.resolve({ id }) },
    );
    expect(res.status).toBe(400);
  });

  it("rejects non-integer advance hours with 400", async () => {
    const { POST } = await import("../sessions/[id]/advance/route");
    const res = await POST(
      new Request("http://x/api/sessions/advance", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ hours: 3.5 }),
      }),
      { params: Promise.resolve({ id }) },
    );
    expect(res.status).toBe(400);
  });
});

describe("meta API", () => {
  it("GET /api/scripts/:id/meta returns unlocks + lockable set", async () => {
    const { GET } = await import("../scripts/[scriptId]/meta/route");
    const res = await GET(new Request("http://x/api/scripts/starlight/meta"), {
      params: Promise.resolve({ scriptId: "starlight" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.unlockedOrigins)).toBe(true);
    // starlight run.yaml: returned_visitor -> [station-merchant].
    expect(body.lockableOrigins).toContain("station-merchant");
    // The meta file may or may not exist yet (earlier turns write it on
    // autosave); either state is valid.
    expect(body.updatedAt === null || typeof body.updatedAt === "string").toBe(true);
  });

  it("GET /api/scripts/:id/meta 404s unknown scripts", async () => {
    const { GET } = await import("../scripts/[scriptId]/meta/route");
    const res = await GET(new Request("http://x/api/scripts/nope/meta"), {
      params: Promise.resolve({ scriptId: "nope" }),
    });
    expect(res.status).toBe(404);
  });
});
