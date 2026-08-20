// API layer tests: direct handler invocation (no HTTP server needed).
// Asserts JSON bodies, status codes, and error mapping across the
// scripts/sessions/assets routes.
import { mkdirSync, rmSync, cpSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { EngineHost } from "../../../server/engine-host";
import {
  applyAdvancePresentationOverlay,
  copyCoreTestScript,
  coreTestScriptZip,
} from "../../../server/__tests__/fixtures/core-script";

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const CORE_SCRIPT_ID = "core-test-script";
const CORE_ORIGIN_ID = "observer";
let scriptsRoot: string;
let sessionId: string;

beforeAll(() => {
  // Point EngineHost at a temp scripts root + temp data root (avoids
  // mutating the repo). The singleton caches by env, so both must be set
  // before the first import.
  scriptsRoot = mkdtempSync(path.join(tmpdir(), "cg-api-"));
  const scriptDir = path.join(scriptsRoot, CORE_SCRIPT_ID);
  cpSync(
    path.join(REPO_ROOT, "test", "fixtures", "core-test-library", CORE_SCRIPT_ID),
    scriptDir,
    { recursive: true },
  );
  applyAdvancePresentationOverlay(scriptDir);
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
    expect(body.scripts[0].id).toBe(CORE_SCRIPT_ID);
    expect(body.scripts[0]).toMatchObject({ schemaVersion: "1.1", source: { kind: "built-in", label: "内置" } });
    expect(body.scripts[0].defaultThemeId).toBe("default");
    expect(body.scripts[0].theme.palette.background).toBe("#0d1113");
  });

  it("GET /api/scripts/:id returns presentation + origins", async () => {
    const { GET } = await import("../scripts/[scriptId]/route");
    const res = await GET(new Request(`http://x/api/scripts/${CORE_SCRIPT_ID}`), {
      params: Promise.resolve({ scriptId: CORE_SCRIPT_ID }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.origins.map((o: { id: string }) => o.id)).toContain(CORE_ORIGIN_ID);
    expect(body.presentation.themes.length).toBeGreaterThanOrEqual(3);
    expect(body.presentation.defaultThemeId).toBe("default");
    expect(body.safety.age_rating).toBe("全年龄");
    expect(body.safety.content_classes.length).toBeGreaterThan(0);
    expect(body.safety.content_classes).toContain("violence");
  });

  it("serves immutable versioned UI bundles with ETag revalidation", async () => {
    const detailMod = await import("../scripts/[scriptId]/route");
    const detailRes = await detailMod.GET(new Request(`http://x/api/scripts/${CORE_SCRIPT_ID}`), {
      params: Promise.resolve({ scriptId: CORE_SCRIPT_ID }),
    });
    const detail = await detailRes.json();
    const bundleUrl = detail.presentation.uiBundle.url as string;
    const { GET } = await import("../scripts/[scriptId]/ui-bundle/route");
    const first = await GET(new Request(`http://x${bundleUrl}`), {
      params: Promise.resolve({ scriptId: CORE_SCRIPT_ID }),
    });
    expect(first.status).toBe(200);
    expect(first.headers.get("cache-control")).toContain("immutable");
    const etag = first.headers.get("etag");
    expect(etag).toMatch(/^"[0-9a-f]{20}"$/);

    const cached = await GET(new Request(`http://x${bundleUrl}`, { headers: { "if-none-match": etag! } }), {
      params: Promise.resolve({ scriptId: CORE_SCRIPT_ID }),
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
    const res = await DELETE(new Request(`http://x/api/scripts/${CORE_SCRIPT_ID}`, { method: "DELETE" }), {
      params: Promise.resolve({ scriptId: CORE_SCRIPT_ID }),
    });
    expect(res.status).toBe(403);
    expect(existsSync(path.join(scriptsRoot, CORE_SCRIPT_ID, "script.yaml"))).toBe(true);
  });
});

describe("script import API", () => {
  it("rejects an active v1 replacement and requires a fresh preview after the session ends", async () => {
    const scriptId = "route-import-fixture";
    const sourceRoot = mkdtempSync(path.join(tmpdir(), "cg-api-import-"));
    const v1Source = path.join(sourceRoot, "v1");
    const v2Source = path.join(sourceRoot, "v2");
    copyCoreTestScript(v1Source, scriptId);
    copyCoreTestScript(v2Source, scriptId);
    const v2ActionsPath = path.join(v2Source, "actions.yaml");
    writeFileSync(
      v2ActionsPath,
      readFileSync(v2ActionsPath, "utf8").replace("time: 24", "time: 7"),
    );
    const previewRoute = await import("../scripts/import/preview/route");
    const commitRoute = await import("../scripts/import/commit/route");
    const preview = async (source: string, name: string): Promise<Record<string, unknown>> => {
      const form = new FormData();
      form.set(
        "file",
        new File([new Uint8Array(coreTestScriptZip(source, scriptId))], name, {
          type: "application/zip",
        }),
      );
      const response = await previewRoute.POST(new Request("http://x/api/scripts/import/preview", {
        method: "POST",
        body: form,
      }));
      expect(response.status).toBe(201);
      return response.json() as Promise<Record<string, unknown>>;
    };
    const commit = (token: unknown): Promise<Response> => commitRoute.POST(new Request(
      "http://x/api/scripts/import/commit",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, replace: true }),
      },
    ));

    try {
      const firstPreview = await preview(v1Source, "route-v1.zip");
      const firstCommit = await commitRoute.POST(new Request("http://x/api/scripts/import/commit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: firstPreview.token, replace: false }),
      }));
      expect(firstCommit.status).toBe(201);

      const host = EngineHost.get();
      const installedDir = path.join(scriptsRoot, scriptId);
      const receiptBefore = readFileSync(path.join(installedDir, ".chatgame-source.json"), "utf8");
      const actionsBefore = readFileSync(path.join(installedDir, "actions.yaml"), "utf8");
      const session = host.createSession({ scriptId, originId: CORE_ORIGIN_ID, seed: 5 });
      const hint = { actionId: "investigate" } as const;
      const previewBefore = await host.previewAction(session.id, hint);

      const replacementPreview = await preview(v2Source, "route-v2.zip");
      expect(replacementPreview.conflicts).toEqual({ installed: true, replaceAllowed: true });
      const rejected = await commit(replacementPreview.token);
      expect(rejected.status).toBe(409);
      await expect(rejected.json()).resolves.toEqual({
        error: expect.stringMatching(/active sessions.*preview the replacement again/),
      });

      expect(readFileSync(path.join(installedDir, ".chatgame-source.json"), "utf8")).toBe(receiptBefore);
      expect(readFileSync(path.join(installedDir, "actions.yaml"), "utf8")).toBe(actionsBefore);
      await expect(host.previewAction(session.id, hint)).resolves.toEqual(previewBefore);
      const beforeHours = host.state(session.id).clock.totalHours;
      await host.turn(session.id, { text: "活跃会话仍执行第一版", intentHint: hint });
      expect(host.state(session.id).clock.totalHours).toBe(beforeHours + 24);

      const consumed = await commit(replacementPreview.token);
      expect(consumed.status).toBe(404);
      await host.destroySession(session.id);

      const freshPreview = await preview(v2Source, "route-v2.zip");
      const replaced = await commit(freshPreview.token);
      expect(replaced.status).toBe(201);
      expect(readFileSync(path.join(installedDir, ".chatgame-source.json"), "utf8")).not.toBe(receiptBefore);
      expect(readFileSync(path.join(installedDir, "actions.yaml"), "utf8")).toContain("time: 7");

      const v2Session = host.createSession({ scriptId, originId: CORE_ORIGIN_ID, seed: 5 });
      await expect(host.previewAction(v2Session.id, hint)).resolves.toMatchObject({ timeCost: 7 });
      await host.destroySession(v2Session.id);
      host.removeScript(scriptId);
    } finally {
      rmSync(sourceRoot, { recursive: true, force: true });
    }
  });
});

describe("assets API", () => {
  it("serves a real asset file with the right content type", async () => {
    // The core fixture has no real assets; add one only to the temp copy.
    mkdirSync(path.join(scriptsRoot, CORE_SCRIPT_ID, "assets", "icons"), { recursive: true });
    writeFileSync(path.join(scriptsRoot, CORE_SCRIPT_ID, "assets", "icons", "probe.svg"), "<svg/>");
    const { GET } = await import("../scripts/[scriptId]/assets/[...path]/route");
    const res = await GET(new Request(`http://x/api/scripts/${CORE_SCRIPT_ID}/assets/icons/probe.svg`), {
      params: Promise.resolve({ scriptId: CORE_SCRIPT_ID, path: ["icons", "probe.svg"] }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/svg+xml");
    expect(await res.text()).toContain("<svg/>");
  });

  it("rejects path traversal with 400", async () => {
    const { GET } = await import("../scripts/[scriptId]/assets/[...path]/route");
    const res = await GET(new Request(`http://x/api/scripts/${CORE_SCRIPT_ID}/assets/../../secret`), {
      params: Promise.resolve({ scriptId: CORE_SCRIPT_ID, path: ["..", "..", "secret"] }),
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
        body: JSON.stringify({ scriptId: CORE_SCRIPT_ID, originId: CORE_ORIGIN_ID, seed: 11 }),
      }),
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    sessionId = body.id;
    expect(body.state.transcript.length).toBeGreaterThan(0);
    expect(body.presentation.currentTheme.palette.background).toBe("#0d1113");
  });

  it("POST /api/sessions rejects missing fields", async () => {
    const { POST } = await import("../sessions/route");
    const res = await POST(
      new Request("http://x/api/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ scriptId: CORE_SCRIPT_ID }),
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
    const beforeState = (await beforeRes.json()).state;
    const before = beforeState.player.relations.find(
      (relation: { npcId: string }) => relation.npcId === "operator",
    ).value;
    const res = await POST(
      new Request("http://x/api/sessions/descriptor", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ path: "player.relations.operator", text: "交班记录可信" }),
      }),
      { params: Promise.resolve({ id: sessionId }) },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    const relation = body.state.player.relations.find(
      (item: { npcId: string }) => item.npcId === "operator",
    );
    expect(relation.descriptor.description).toBe("交班记录可信");
    expect(relation.descriptor.userEdited).toBe(true);
    // Dual-track rule: the edit never touches the numeric value.
    expect(relation.value).toBe(before);
  });

  it("POST /api/sessions/:id/descriptor handles reputation paths safely (empty initial state)", async () => {
    const { POST } = await import("../sessions/[id]/descriptor/route");
    const res = await POST(
      new Request("http://x/api/sessions/descriptor", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ path: "player.reputation.calibration-team", text: "校准组眼里的无名之辈" }),
      }),
      { params: Promise.resolve({ id: sessionId }) },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    // Fresh core-test-script sessions start with no reputation entries; the edit
    // is a safe no-op that must not crash or mutate the list.
    expect(Array.isArray(body.state.player.reputation)).toBe(true);
    expect(body.state.player.reputation.length).toBe(0);
  });

  it("POST /api/sessions/:id/advance returns one location/theme snapshot", async () => {
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
    expect(body.state.player.locationId).toBe("service-corridor");
    expect(body.presentation.currentTheme.id).toBe("service-corridor");
    expect(body.presentation.currentTheme.effects.scene_tint).toBe("#172033");
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
        body: JSON.stringify({ scriptId: CORE_SCRIPT_ID, originId: CORE_ORIGIN_ID, seed: 3 }),
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
    const res = await GET(new Request(`http://x/api/scripts/${CORE_SCRIPT_ID}/meta`), {
      params: Promise.resolve({ scriptId: CORE_SCRIPT_ID }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.unlockedOrigins)).toBe(true);
    expect(body.lockableOrigins).toEqual([]);
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
