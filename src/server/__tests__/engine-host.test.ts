// Server layer tests: script library scanning, zip/dir import (valid,
// invalid, zip-slip, duplicate-id), asset path traversal protection, and
// session lifecycle (create/turn/save/load/destroy + serialization).
import {
  mkdirSync,
  rmSync,
  writeFileSync,
  readFileSync,
  cpSync,
  readdirSync,
  existsSync,
} from "node:fs";
import { crc32 } from "node:zlib";
import { tmpdir } from "node:os";
import path from "node:path";
import AdmZip from "adm-zip";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EngineHost, HostError } from "../engine-host";
import { ScriptImportError, importScriptFromZip, MAX_UNPACKED_BYTES } from "../script-import";
import { createFsSaveStore, metaPathForScript, type SaveStore } from "../../engine/save-store";
import { MockProvider } from "../../engine/narrative/mock";
import type { GenerateTextOptions } from "../../engine/narrative/provider";
import {
  copyCoreTestScript,
  coreTestScriptZip,
  fixtureProvenance,
  TEST_ALT_ORIGIN_ID,
  TEST_ORIGIN_ID,
  TEST_SCRIPT_ID,
} from "./fixtures/core-script";

let root: string;
let scriptsRoot: string;
let dataRoot: string;
let fixtureSource: string;
let host: EngineHost;

beforeEach(() => {
  root = path.join(tmpdir(), `cg-host-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  scriptsRoot = path.join(root, "scripts");
  dataRoot = path.join(root, "data");
  fixtureSource = path.join(root, "fixture-source");
  mkdirSync(scriptsRoot, { recursive: true });
  copyCoreTestScript(fixtureSource);
  host = new EngineHost({
    scriptsRoot,
    saveStore: createFsSaveStore(dataRoot),
  });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/** Installs an application-owned copy of the generic core fixture. */
function installFixture(): void {
  cpSync(fixtureSource, path.join(scriptsRoot, TEST_SCRIPT_ID), {
    recursive: true,
  });
}

class PausingSummaryProvider extends MockProvider {
  private pauseSummary = false;
  private release!: () => void;
  private markStarted!: () => void;
  summaryStarted = new Promise<void>((resolve) => { this.markStarted = resolve; });

  pauseNextSummary(): void {
    this.pauseSummary = true;
  }

  releaseSummary(): void {
    this.release?.();
  }

  override async generateText(options: GenerateTextOptions): Promise<string> {
    if (this.pauseSummary && options.system.includes("剧情摘要器")) {
      this.pauseSummary = false;
      this.markStarted();
      await new Promise<void>((resolve) => { this.release = resolve; });
    }
    return super.generateText(options);
  }
}

/** Builds a valid zip from a renamed copy of the generic core fixture. */
function buildTestZip(scriptId: string): Buffer {
  return coreTestScriptZip(fixtureSource, scriptId);
}

/**
 * Hand-crafts a raw zip with the exact entry names given (no
 * normalization). adm-zip's addFile() sanitizes names, so the only way to
 * exercise the zip-slip guard is to build the bytes ourselves.
 */
function rawZip(entries: Array<{ name: string; content: string }>): Buffer {
  const chunks: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, "utf8");
    const data = Buffer.from(entry.content, "utf8");
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0, 6); // flags
    local.writeUInt16LE(0, 8); // method: store
    local.writeUInt16LE(0, 10); // time
    local.writeUInt16LE(0x21, 12); // date
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    chunks.push(local, nameBuf, data);

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(0, 8);
    cd.writeUInt16LE(0, 10);
    cd.writeUInt16LE(0x21, 12);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(data.length, 20);
    cd.writeUInt32LE(data.length, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt32LE(offset, 42);
    central.push(cd, nameBuf);
    offset += local.length + nameBuf.length + data.length;
  }
  const centralStart = offset;
  const centralBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(centralStart, 16);
  return Buffer.concat([...chunks, centralBuf, eocd]);
}

describe("script library scanning", () => {
  it("lists installed scripts with meta + theme palette", () => {
    installFixture();
    const scripts = host.listScripts();
    expect(scripts).toHaveLength(1);
    const s = scripts[0];
    expect(s.id).toBe(TEST_SCRIPT_ID);
    expect(s.name).toBe("核心工作台");
    expect(s.author).toBe("chatgame-test");
    expect(s.theme?.palette.background).toBe("#0d1113"); // from theme.yaml
    expect(s.hasAssets).toBe(true);
  });

  it("ignores directories without script.yaml", () => {
    mkdirSync(path.join(scriptsRoot, "junk"), { recursive: true });
    writeFileSync(path.join(scriptsRoot, "junk", "notes.txt"), "not a script");
    expect(host.listScripts()).toHaveLength(0);
  });

  it("exposes the script safety surface", () => {
    installFixture();
    const safety = host.scriptSafety(TEST_SCRIPT_ID);
    expect(safety.age_rating).toBe("全年龄");
    expect(safety.content_classes).toContain("violence");
    expect(safety.content_classes).toContain("crime");
  });
  it("exposes catalog with skill descriptions and factions", () => {
    installFixture();
    const catalog = host.scriptCatalog(TEST_SCRIPT_ID);
    // skills.description passes through from mechanics.skills (R5).
    expect(catalog.skills).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "focus", min: 0, max: 10, description: "校准专注度" }),
      ]),
    );
    // factions id/name feed the reputation panel (R5).
    expect(catalog.factions.map((f) => f.name)).toEqual(
      expect.arrayContaining(["中继值班组"]),
    );
  });
});

describe("script import", () => {
  it("imports a valid zip and lists it afterward", () => {
    const result = host.importZip(buildTestZip("testzip"));
    expect(result.scriptId).toBe("testzip");
    expect(host.listScripts().map((s) => s.id)).toContain("testzip");
  });

  it("rejects a duplicate id without replace", () => {
    host.importZip(buildTestZip("testzip"));
    expect(() => host.importZip(buildTestZip("testzip"))).toThrow(ScriptImportError);
  });

  it("replaces a duplicate id with replace=true", () => {
    host.importZip(buildTestZip("testzip"));
    expect(() => host.importZip(buildTestZip("testzip"), true)).not.toThrow();
  });

  it("keeps an active imported script stable until its session ends", async () => {
    const scriptId = "testzip";
    host.importZip(buildTestZip(scriptId));
    const installedDir = path.join(scriptsRoot, scriptId);
    const receiptBefore = readFileSync(path.join(installedDir, ".chatgame-source.json"), "utf8");
    const actionsBefore = readFileSync(path.join(installedDir, "actions.yaml"), "utf8");
    const session = host.createSession({ scriptId, originId: TEST_ORIGIN_ID, seed: 1 });
    const hint = { actionId: "investigate" } as const;
    const previewBefore = await host.previewAction(session.id, hint);

    const v2ActionsPath = path.join(fixtureSource, "actions.yaml");
    writeFileSync(
      v2ActionsPath,
      readFileSync(v2ActionsPath, "utf8").replace("time: 24", "time: 7"),
    );
    const replacement = buildTestZip(scriptId);
    const directoryReplacement = path.join(root, "directory-replacement", scriptId);
    copyCoreTestScript(directoryReplacement, scriptId);
    writeFileSync(
      path.join(directoryReplacement, "assets", "provenance.yaml"),
      fixtureProvenance(directoryReplacement),
    );
    const directoryActionsPath = path.join(directoryReplacement, "actions.yaml");
    writeFileSync(
      directoryActionsPath,
      readFileSync(directoryActionsPath, "utf8").replace("time: 24", "time: 7"),
    );

    expect(() => host.importZip(replacement, true)).toThrow(
      expect.objectContaining({ status: 409 }),
    );
    expect(() => host.importDir(directoryReplacement, true)).toThrow(
      expect.objectContaining({ status: 409 }),
    );
    expect(readFileSync(path.join(installedDir, ".chatgame-source.json"), "utf8")).toBe(receiptBefore);
    expect(readFileSync(path.join(installedDir, "actions.yaml"), "utf8")).toBe(actionsBefore);
    await expect(host.previewAction(session.id, hint)).resolves.toEqual(previewBefore);

    const beforeHours = host.state(session.id).clock.totalHours;
    await host.turn(session.id, { text: "仍按第一版校验线路", intentHint: hint });
    expect(host.state(session.id).clock.totalHours).toBe(beforeHours + 24);

    await host.destroySession(session.id);
    expect(() => host.importZip(replacement, true)).not.toThrow();
    expect(readFileSync(path.join(installedDir, "actions.yaml"), "utf8")).toContain("time: 7");
    const replacementSession = host.createSession({ scriptId, originId: TEST_ORIGIN_ID, seed: 1 });
    await expect(host.previewAction(replacementSession.id, hint)).resolves.toMatchObject({ timeCost: 7 });
    await host.destroySession(replacementSession.id);
  });

  it("refuses to replace or remove application-owned built-ins", () => {
    installFixture();
    expect(() => host.importZip(buildTestZip(TEST_SCRIPT_ID), true)).toThrow(/cannot be replaced/);
    expect(() => host.removeScript(TEST_SCRIPT_ID)).toThrow(/cannot be deleted/);
    expect(existsSync(path.join(scriptsRoot, TEST_SCRIPT_ID, "script.yaml"))).toBe(true);
  });

  it("refuses to remove an imported script while a session uses it", async () => {
    host.importZip(buildTestZip("testzip"));
    const session = host.createSession({ scriptId: "testzip", originId: TEST_ORIGIN_ID, seed: 1 });
    expect(() => host.removeScript("testzip")).toThrow(/active sessions/);
    await host.destroySession(session.id);
    expect(() => host.removeScript("testzip")).not.toThrow();
  });

  it("rejects zip-slip entries (raw zip bytes)", () => {
    const zip = rawZip([{ name: "../evil.yaml", content: "id: evil" }]);
    expect(() => host.importZip(zip)).toThrow(/unsafe entry/);
  });

  it("rejects zips whose unpacked size exceeds the cap", () => {
    expect(MAX_UNPACKED_BYTES).toBe(100 * 1024 * 1024);
    const zip = rawZip([{ name: "big-script/script.yaml", content: "id: big-script" }]);
    expect(() =>
      importScriptFromZip(zip, { scriptsRoot, maxUnpackedBytes: 8 }),
    ).toThrow(ScriptImportError);
    expect(() =>
      importScriptFromZip(zip, { scriptsRoot, maxUnpackedBytes: 8 }),
    ).toThrow(/unpacks too large/);
  });

  it("rejects invalid script content and keeps the library clean", () => {
    const zip = new AdmZip();
    zip.addFile(
      "bad-script/script.yaml",
      Buffer.from('id: bad-script\nname: x\ndescription: d\nschema_version: "1.0"\nlanguage: zh\ntone: [x]\nauthor: a\n'),
    );
    expect(() => host.importZip(zip.toBuffer())).toThrow(ScriptImportError);
    expect(host.listScripts()).toHaveLength(0); // rolled back
  });

  it("imports from a directory", () => {
    const src = path.join(tmpdir(), `cg-dir-${Date.now()}`);
    mkdirSync(src, { recursive: true });
    const importSource = path.join(src, TEST_SCRIPT_ID);
    cpSync(fixtureSource, importSource, { recursive: true });
    writeFileSync(path.join(importSource, "assets", "provenance.yaml"), fixtureProvenance(importSource));
    const result = host.importDir(importSource);
    expect(result.scriptId).toBe(TEST_SCRIPT_ID);
    rmSync(src, { recursive: true, force: true });
  });
});

describe("asset serving", () => {
  it("reads a whitelisted asset with the right content type", () => {
    installFixture();
    mkdirSync(path.join(scriptsRoot, TEST_SCRIPT_ID, "assets", "icons"), { recursive: true });
    writeFileSync(path.join(scriptsRoot, TEST_SCRIPT_ID, "assets", "icons", "x.svg"), "<svg/>");
    const { data, mimeType } = host.readAsset(TEST_SCRIPT_ID, "icons/x.svg");
    expect(mimeType).toBe("image/svg+xml");
    expect(data.toString()).toContain("<svg/>");
  });

  it("rejects path traversal", () => {
    installFixture();
    expect(() => host.readAsset(TEST_SCRIPT_ID, "../../secret.txt")).toThrow(HostError);
    expect(() => host.readAsset(TEST_SCRIPT_ID, "..\\..\\secret.txt")).toThrow(HostError);
  });

  it("rejects disallowed extensions", () => {
    installFixture();
    expect(() => host.readAsset(TEST_SCRIPT_ID, "x.exe")).toThrow(HostError);
  });

  it("404s unknown scripts and assets", () => {
    expect(() => host.readAsset("no-such-script", "a.svg")).toThrow(HostError);
    installFixture();
    expect(() => host.readAsset(TEST_SCRIPT_ID, "missing.svg")).toThrow(HostError);
  });
});

describe("session lifecycle", () => {
  it("creates a session from an installed script and runs a turn", async () => {
    installFixture();
    const session = host.createSession({ scriptId: TEST_SCRIPT_ID, originId: TEST_ORIGIN_ID, seed: 7 });
    expect(session.state.transcript.length).toBeGreaterThan(0); // opening entry
    const result = await host.turn(session.id, { text: "你好，黑猫" });
    expect(result.narrative.length).toBeGreaterThan(0);
    expect(host.state(session.id).transcript.length).toBeGreaterThan(session.state.transcript.length);
    await host.destroySession(session.id);
    expect(() => host.state(session.id)).toThrow(HostError);
  });

  it("save/load round-trips through the host", async () => {
    installFixture();
    const session = host.createSession({ scriptId: TEST_SCRIPT_ID, originId: TEST_ORIGIN_ID, seed: 7 });
    await host.turn(session.id, { text: "我去维护走廊" });
    const filePath = await host.save(session.id, "host-test");
    expect(filePath).toContain("host-test.json");
    expect(host.listSaves(session.id)).toContain("host-test.json");
    const before = JSON.stringify(host.state(session.id));
    // load() takes a basename run id (traversal-proof), not a full path.
    await host.load(session.id, "host-test.json");
    expect(JSON.stringify(host.state(session.id))).toBe(before);
    await host.destroySession(session.id);
  });

  it("serializes concurrent turns per session", async () => {
    installFixture();
    const session = host.createSession({ scriptId: TEST_SCRIPT_ID, originId: TEST_ORIGIN_ID, seed: 7 });
    const results = await Promise.all([
      host.turn(session.id, { text: "你好" }),
      host.turn(session.id, { text: "休息" }),
      host.turn(session.id, { text: "再见" }),
    ]);
    expect(results).toHaveLength(3);
    expect(results.every((r) => r.narrative.length > 0)).toBe(true);
    await host.destroySession(session.id);
  });

  it("publishes only complete turn snapshots and queues previews behind the turn", async () => {
    installFixture();
    const provider = new PausingSummaryProvider();
    const gatedHost = new EngineHost({
      scriptsRoot,
      saveStore: createFsSaveStore(dataRoot),
      provider,
    });
    const session = gatedHost.createSession({ scriptId: TEST_SCRIPT_ID, originId: TEST_ORIGIN_ID, seed: 7 });
    for (let turn = 1; turn < 8; turn += 1) {
      await gatedHost.turn(session.id, { text: `准备记录 ${turn}` });
    }
    const committedBefore = JSON.stringify(gatedHost.state(session.id));
    provider.pauseNextSummary();
    const turn = gatedHost.turn(session.id, { text: "触发第八次摘要" });
    await provider.summaryStarted;

    expect(JSON.stringify(gatedHost.state(session.id))).toBe(committedBefore);
    let previewResolved = false;
    const preview = gatedHost.previewAction(session.id, { actionId: "talk" }).then((result) => {
      previewResolved = true;
      return result;
    });
    await Promise.resolve();
    expect(previewResolved).toBe(false);

    provider.releaseSummary();
    await turn;
    await expect(preview).resolves.toMatchObject({ actionId: "talk" });
    expect(gatedHost.state(session.id).transcript.length).toBeGreaterThan(JSON.parse(committedBefore).transcript.length);
    await gatedHost.destroySession(session.id);
  });

  it("reports session presentation with theme fallback", async () => {
    installFixture();
    const session = host.createSession({ scriptId: TEST_SCRIPT_ID, originId: TEST_ORIGIN_ID, seed: 7 });
    const presentation = host.sessionPresentation(session.id);
    expect(presentation.currentTheme.palette.background).toBe("#0d1113");
    expect(presentation.themes.map((t) => t.id)).toContain("framework-dark");
    expect(presentation.themes.map((t) => t.id)).toContain("default");
    await host.destroySession(session.id);
  });

  it("returns advance state and location theme from the same committed snapshot", async () => {
    installFixture();
    const session = host.createSession({ scriptId: TEST_SCRIPT_ID, originId: TEST_ORIGIN_ID, seed: 7 });
    expect(session.state.player.locationId).toBe("relay-room");
    expect(session.presentation.currentTheme.id).toBe("default");

    const advanced = await host.advance(session.id, 24);

    expect(advanced.state.player.locationId).toBe("service-corridor");
    expect(advanced.presentation.currentTheme.id).toBe("service-corridor");
    expect(advanced.presentation.currentTheme.effects.scene_tint).toBe("#172033");
    expect(host.sessionSnapshot(session.id)).toEqual(advanced);
    await host.destroySession(session.id);
  });

  it("rejects unknown sessions and scripts", () => {
    expect(() => host.state("no-such-session")).toThrow(HostError);
    expect(() => host.createSession({ scriptId: "no-such-script", originId: "x" })).toThrow(HostError);
  });
});

describe("persistence & autosave", () => {
  it("auto-saves to the fixed autosave slot after every turn", async () => {
    installFixture();
    const session = host.createSession({ scriptId: TEST_SCRIPT_ID, originId: TEST_ORIGIN_ID, seed: 7 });
    await host.turn(session.id, { text: "我去维护走廊" });
    const autosavePath = path.join(dataRoot, "saves", TEST_SCRIPT_ID, "autosave.json");
    expect(existsSync(autosavePath)).toBe(true);
    const raw = JSON.parse(readFileSync(autosavePath, "utf8")) as {
      worldState: { transcript: unknown[] };
    };
    expect(raw.worldState.transcript.length).toBeGreaterThan(0);
    // Atomic write: no .tmp residue next to the slot.
    const dir = path.join(dataRoot, "saves", TEST_SCRIPT_ID);
    expect(readdirSync(dir).some((f) => f.endsWith(".tmp"))).toBe(false);
    await host.destroySession(session.id);
  });

  it("publishes the committed state only after autosave succeeds", async () => {
    installFixture();
    const delegate = createFsSaveStore(dataRoot);
    let sessionId = "";
    let visibleDuringWrite = "";
    const observingStore: SaveStore = {
      root: delegate.root,
      read: (scriptId, runId) => delegate.read(scriptId, runId),
      list: (scriptId) => delegate.list(scriptId),
      write: (scriptId, runId, json) => {
        if (runId === "autosave.json") {
          visibleDuringWrite = JSON.stringify(host.state(sessionId));
        }
        delegate.write(scriptId, runId, json);
      },
    };
    host = new EngineHost({ scriptsRoot, saveStore: observingStore });
    const session = host.createSession({ scriptId: TEST_SCRIPT_ID, originId: TEST_ORIGIN_ID, seed: 7 });
    sessionId = session.id;
    const before = JSON.stringify(host.state(session.id));

    await host.turn(session.id, {
      text: "提交后才能看见这一回合",
      intentHint: { actionId: "talk" },
    });

    const after = JSON.stringify(host.state(session.id));
    expect(visibleDuringWrite).toBe(before);
    expect(after).not.toBe(before);
    const autosave = JSON.parse(delegate.read(TEST_SCRIPT_ID, "autosave.json")) as {
      worldState: unknown;
    };
    expect(JSON.stringify(autosave.worldState)).toBe(after);
  });

  it("keeps the prior engine and committed transcript when autosave write fails", async () => {
    installFixture();
    const delegate = createFsSaveStore(dataRoot);
    let failAutosave = true;
    const failingStore: SaveStore = {
      root: delegate.root,
      read: (scriptId, runId) => delegate.read(scriptId, runId),
      list: (scriptId) => delegate.list(scriptId),
      write: (scriptId, runId, json) => {
        if (failAutosave && runId === "autosave.json") {
          throw new Error("injected autosave failure");
        }
        delegate.write(scriptId, runId, json);
      },
    };
    host = new EngineHost({ scriptsRoot, saveStore: failingStore });
    const session = host.createSession({ scriptId: TEST_SCRIPT_ID, originId: TEST_ORIGIN_ID, seed: 7 });
    const input = "这一回合不得泄漏或重复";
    const hint = { actionId: "investigate" } as const;
    const metaPath = metaPathForScript(TEST_SCRIPT_ID, dataRoot);
    const previousMeta = '{"unlockedOrigins":[],"updatedAt":"stable"}';
    mkdirSync(path.dirname(metaPath), { recursive: true });
    writeFileSync(metaPath, previousMeta);
    const before = JSON.stringify(host.state(session.id));
    const beforeHours = host.state(session.id).clock.totalHours;
    const previewBefore = await host.previewAction(session.id, hint);

    await expect(host.turn(session.id, { text: input, intentHint: hint }))
      .rejects.toThrow("injected autosave failure");

    expect(JSON.stringify(host.state(session.id))).toBe(before);
    expect(host.state(session.id).transcript.some((entry) => entry.text === input)).toBe(false);
    await expect(host.previewAction(session.id, hint)).resolves.toEqual(previewBefore);
    expect(readFileSync(metaPath, "utf8")).toBe(previousMeta);
    expect(() => delegate.read(TEST_SCRIPT_ID, "autosave.json")).toThrow(/not found/);

    failAutosave = false;
    await host.turn(session.id, { text: input, intentHint: hint });
    expect(host.state(session.id).transcript.filter((entry) => entry.text === input)).toHaveLength(1);
    expect(host.state(session.id).clock.totalHours).toBe(beforeHours + 24);
  });

  it("serializes advance behind turns on the same session", async () => {
    installFixture();
    const session = host.createSession({ scriptId: TEST_SCRIPT_ID, originId: TEST_ORIGIN_ID, seed: 7 });
    const beforeHours = host.state(session.id).clock.totalHours;
    const [turnResult] = await Promise.all([
      host.turn(session.id, { text: "你好" }),
      host.advance(session.id, 6),
    ]);
    expect(turnResult.narrative.length).toBeGreaterThan(0);
    // The per-session queue ran both; the final clock reflects the advance
    // (plus the turn's own time cost) and no turn state was lost to a
    // mid-flight mutation.
    expect(host.state(session.id).clock.totalHours).toBeGreaterThanOrEqual(beforeHours + 6);
    await host.destroySession(session.id);
  });

  it("serializes descriptor edits and teardown behind an in-flight turn", async () => {
    installFixture();
    const session = host.createSession({ scriptId: TEST_SCRIPT_ID, originId: TEST_ORIGIN_ID, seed: 7 });
    const relation = host.state(session.id).player.relations[0];
    expect(relation).toBeDefined();

    const turn = host.turn(session.id, { text: "检查线路" });
    const descriptor = host.setDescriptor(
      session.id,
      `player.relations.${relation.npcId}`,
      "回合结束后仍保留的描述",
    );
    await Promise.all([turn, descriptor]);
    expect(host.state(session.id).player.relations.find((item) => item.npcId === relation.npcId)?.descriptor?.description)
      .toBe("回合结束后仍保留的描述");

    const finalTurn = host.turn(session.id, { text: "最后检查一次" });
    const teardown = host.destroySession(session.id);
    expect(() => host.advance(session.id, 1)).toThrow(/closing/);
    await Promise.all([finalTurn, teardown]);
    expect(() => host.state(session.id)).toThrow(HostError);
  });

  it("resumes a destroyed session from the autosave slot (refresh recovery)", async () => {
    installFixture();
    const session = host.createSession({ scriptId: TEST_SCRIPT_ID, originId: TEST_ORIGIN_ID, seed: 7 });
    await host.turn(session.id, { text: "我去维护走廊" });
    const transcriptBefore = JSON.stringify(host.state(session.id).transcript);
    await host.destroySession(session.id); // the in-memory session is gone

    // A fresh host (server restart / reaped session) rebuilds from disk —
    // the same path the launcher's current-script "继续游戏" takes via
    // createSession({ loadRunId: "autosave.json" }).
    const host2 = new EngineHost({ scriptsRoot, saveStore: createFsSaveStore(dataRoot) });
    const resumed = host2.createSession({ scriptId: TEST_SCRIPT_ID, loadRunId: "autosave.json" });
    expect(JSON.stringify(resumed.state.transcript)).toBe(transcriptBefore);
    await host2.destroySession(resumed.id);
  });
});

describe("meta-progression persistence", () => {
  it("writeMeta unions existing unlocks with the session's granted origins", async () => {
    installFixture();
    const session = host.createSession({ scriptId: TEST_SCRIPT_ID, originId: TEST_ORIGIN_ID, seed: 7 });
    // Seed a meta file as if a previous run had recorded an independent unlock.
    const metaPath = metaPathForScript(TEST_SCRIPT_ID, dataRoot);
    mkdirSync(path.dirname(metaPath), { recursive: true });
    writeFileSync(
      metaPath,
      JSON.stringify({ unlockedOrigins: ["legacy-observer"], updatedAt: "2026-01-01T00:00:00.000Z" }),
    );

    // Give the session the unlock flag by editing a save and reloading it.
    const savePath = await host.save(session.id, "meta-test");
    const save = JSON.parse(readFileSync(savePath, "utf8")) as {
      worldState: { player: { flags: string[] } };
    };
    save.worldState.player.flags.push("returned_visitor");
    writeFileSync(savePath, JSON.stringify(save));
    await host.load(session.id, "meta-test.json");

    const merged = host.writeMeta(session.id);
    expect(merged).toEqual(expect.arrayContaining(["legacy-observer", TEST_ALT_ORIGIN_ID]));
    const meta = host.readMeta(TEST_SCRIPT_ID);
    expect(meta.unlockedOrigins).toEqual(expect.arrayContaining(["legacy-observer", TEST_ALT_ORIGIN_ID]));
    expect(meta.lockableOrigins).toContain(TEST_ALT_ORIGIN_ID);
    await host.destroySession(session.id);
  });

  it("readMeta tolerates a corrupt meta file", async () => {
    installFixture();
    const metaPath = metaPathForScript(TEST_SCRIPT_ID, dataRoot);
    mkdirSync(path.dirname(metaPath), { recursive: true });
    writeFileSync(metaPath, "{ not json");
    const meta = host.readMeta(TEST_SCRIPT_ID);
    expect(meta.unlockedOrigins).toEqual([]);
    expect(meta.lockableOrigins).toContain(TEST_ALT_ORIGIN_ID);
  });
});

describe("advance death policy", () => {
  it("runs hard_reset on hp 0 and appends a system transcript entry", async () => {
    installFixture();
    const session = host.createSession({ scriptId: TEST_SCRIPT_ID, originId: TEST_ORIGIN_ID, seed: 7 });
    // Inject hp = 0 through a save/load round-trip (deterministic trigger).
    const savePath = await host.save(session.id, "dead-test");
    const save = JSON.parse(readFileSync(savePath, "utf8")) as {
      worldState: { player: { stats: Record<string, number> } };
    };
    save.worldState.player.stats.hp = 0;
    writeFileSync(savePath, JSON.stringify(save));
    await host.load(session.id, "dead-test.json");
    expect(host.state(session.id).player.stats.hp).toBe(0);

    await host.advance(session.id, 1);
    const state = host.state(session.id);
    const systemEntries = state.transcript.filter((t) => t.role === "system");
    expect(systemEntries.length).toBeGreaterThan(0);
    expect(systemEntries.at(-1)?.text).toContain("世界重置");
    // hard_reset rerolls worldgen: the player is rebuilt (hp restored).
    expect((state.player.stats.hp ?? 0)).toBeGreaterThan(0);
    await host.destroySession(session.id);
  });
});
