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
  statSync,
  existsSync,
} from "node:fs";
import { crc32 } from "node:zlib";
import { tmpdir } from "node:os";
import path from "node:path";
import AdmZip from "adm-zip";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EngineHost, HostError } from "../engine-host";
import { ScriptImportError, importScriptFromZip, MAX_UNPACKED_BYTES } from "../script-import";
import { createFsSaveStore, metaPathForScript } from "../../engine/save-store";

const REPO_ROOT = path.resolve(__dirname, "../../..");
const FIXTURES = path.join(REPO_ROOT, "scripts");


let scriptsRoot: string;
let dataRoot: string;
let host: EngineHost;

beforeEach(() => {
  scriptsRoot = path.join(tmpdir(), `cg-host-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  dataRoot = path.join(scriptsRoot, ".data");
  mkdirSync(scriptsRoot, { recursive: true });
  host = new EngineHost({
    scriptsRoot,
    saveStore: createFsSaveStore(dataRoot),
  });
});

afterEach(() => {
  rmSync(scriptsRoot, { recursive: true, force: true });
});

/** Copies the starlight fixture into the temp scripts root (for scan tests). */
function installStarlight(): void {
  cpSync(path.join(FIXTURES, "starlight"), path.join(scriptsRoot, "starlight"), {
    recursive: true,
  });
}

/** Collects all .yaml paths (relative) under a directory tree. */
function walkYaml(dir: string, base = ""): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const abs = path.join(dir, entry);
    const rel = base ? `${base}/${entry}` : entry;
    if (statSync(abs).isDirectory()) {
      out.push(...walkYaml(abs, rel));
    } else if (entry.endsWith(".yaml")) {
      out.push(rel);
    }
  }
  return out;
}

/** Builds a minimal valid zip script (renamed starlight copy). */
function buildTestZip(scriptId: string): Buffer {
  const zip = new AdmZip();
  const srcDir = path.join(FIXTURES, "starlight");
  for (const rel of walkYaml(srcDir)) {
    const content = readFileSync(path.join(srcDir, rel), "utf8");
    zip.addFile(
      `${scriptId}-dir/${rel}`,
      Buffer.from(rel.endsWith("script.yaml") ? content.replace("id: starlight", `id: ${scriptId}`) : content),
    );
  }
  const coverPath = "assets/backgrounds/bridge.svg";
  zip.addFile(
    `${scriptId}-dir/${coverPath}`,
    readFileSync(path.join(srcDir, coverPath)),
  );
  return zip.toBuffer();
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
    installStarlight();
    const scripts = host.listScripts();
    expect(scripts).toHaveLength(1);
    const s = scripts[0];
    expect(s.id).toBe("starlight");
    expect(s.name).toBe("星港");
    expect(s.author).toBe("chatgame-team");
    expect(s.theme?.palette.background).toBe("#0b0e14"); // from theme.yaml
    expect(s.hasAssets).toBe(true);
  });

  it("ignores directories without script.yaml", () => {
    mkdirSync(path.join(scriptsRoot, "junk"), { recursive: true });
    writeFileSync(path.join(scriptsRoot, "junk", "notes.txt"), "not a script");
    expect(host.listScripts()).toHaveLength(0);
  });

  it("exposes the script safety surface", () => {
    installStarlight();
    const safety = host.scriptSafety("starlight");
    expect(safety.age_rating).toBe("16+");
    expect(safety.content_classes).toContain("violence");
    expect(safety.content_classes).toContain("crime");
  });
  it("exposes catalog with skill descriptions and factions", () => {
    installStarlight();
    const catalog = host.scriptCatalog("starlight");
    // skills.description passes through from mechanics.skills (R5).
    expect(catalog.skills).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "hacking", min: 0, max: 20, description: "入侵系统" }),
      ]),
    );
    // factions id/name feed the reputation panel (R5).
    expect(catalog.factions.map((f) => f.name)).toEqual(
      expect.arrayContaining(["甲板帮", "站务委员会"]),
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
    cpSync(path.join(FIXTURES, "starlight"), path.join(src, "starlight"), { recursive: true });
    const result = host.importDir(path.join(src, "starlight"));
    expect(result.scriptId).toBe("starlight");
    rmSync(src, { recursive: true, force: true });
  });
});

describe("asset serving", () => {
  it("reads a whitelisted asset with the right content type", () => {
    installStarlight();
    mkdirSync(path.join(scriptsRoot, "starlight", "assets", "icons"), { recursive: true });
    writeFileSync(path.join(scriptsRoot, "starlight", "assets", "icons", "x.svg"), "<svg/>");
    const { data, mimeType } = host.readAsset("starlight", "icons/x.svg");
    expect(mimeType).toBe("image/svg+xml");
    expect(data.toString()).toContain("<svg/>");
  });

  it("rejects path traversal", () => {
    installStarlight();
    expect(() => host.readAsset("starlight", "../../secret.txt")).toThrow(HostError);
    expect(() => host.readAsset("starlight", "..\\..\\secret.txt")).toThrow(HostError);
  });

  it("rejects disallowed extensions", () => {
    installStarlight();
    expect(() => host.readAsset("starlight", "x.exe")).toThrow(HostError);
  });

  it("404s unknown scripts and assets", () => {
    expect(() => host.readAsset("no-such-script", "a.svg")).toThrow(HostError);
    installStarlight();
    expect(() => host.readAsset("starlight", "missing.svg")).toThrow(HostError);
  });
});

describe("session lifecycle", () => {
  it("creates a session from an installed script and runs a turn", async () => {
    installStarlight();
    const session = host.createSession({ scriptId: "starlight", originId: "crew-member", seed: 7 });
    expect(session.state.transcript.length).toBeGreaterThan(0); // opening entry
    const result = await host.turn(session.id, { text: "你好，黑猫" });
    expect(result.narrative.length).toBeGreaterThan(0);
    expect(host.state(session.id).transcript.length).toBeGreaterThan(session.state.transcript.length);
    host.destroySession(session.id);
    expect(() => host.state(session.id)).toThrow(HostError);
  });

  it("save/load round-trips through the host", async () => {
    installStarlight();
    const session = host.createSession({ scriptId: "starlight", originId: "crew-member", seed: 7 });
    await host.turn(session.id, { text: "我去舰桥" });
    const filePath = await host.save(session.id, "host-test");
    expect(filePath).toContain("host-test.json");
    expect(host.listSaves(session.id)).toContain("host-test.json");
    const before = JSON.stringify(host.state(session.id));
    // load() takes a basename run id (traversal-proof), not a full path.
    host.load(session.id, "host-test.json");
    expect(JSON.stringify(host.state(session.id))).toBe(before);
    host.destroySession(session.id);
  });

  it("serializes concurrent turns per session", async () => {
    installStarlight();
    const session = host.createSession({ scriptId: "starlight", originId: "crew-member", seed: 7 });
    const results = await Promise.all([
      host.turn(session.id, { text: "你好" }),
      host.turn(session.id, { text: "休息" }),
      host.turn(session.id, { text: "再见" }),
    ]);
    expect(results).toHaveLength(3);
    expect(results.every((r) => r.narrative.length > 0)).toBe(true);
    host.destroySession(session.id);
  });

  it("reports session presentation with theme fallback", () => {
    installStarlight();
    const session = host.createSession({ scriptId: "starlight", originId: "crew-member", seed: 7 });
    const presentation = host.sessionPresentation(session.id);
    expect(presentation.currentTheme.palette.background).toBe("#0b0e14");
    expect(presentation.themes.map((t) => t.id)).toContain("framework-dark");
    expect(presentation.themes.map((t) => t.id)).toContain("starlight-bridge");
    host.destroySession(session.id);
  });

  it("rejects unknown sessions and scripts", () => {
    expect(() => host.state("no-such-session")).toThrow(HostError);
    expect(() => host.createSession({ scriptId: "no-such-script", originId: "x" })).toThrow(HostError);
  });
});

describe("persistence & autosave", () => {
  it("auto-saves to the fixed autosave slot after every turn", async () => {
    installStarlight();
    const session = host.createSession({ scriptId: "starlight", originId: "crew-member", seed: 7 });
    await host.turn(session.id, { text: "我去舰桥" });
    const autosavePath = path.join(dataRoot, "saves", "starlight", "autosave.json");
    expect(existsSync(autosavePath)).toBe(true);
    const raw = JSON.parse(readFileSync(autosavePath, "utf8")) as {
      worldState: { transcript: unknown[] };
    };
    expect(raw.worldState.transcript.length).toBeGreaterThan(0);
    // Atomic write: no .tmp residue next to the slot.
    const dir = path.join(dataRoot, "saves", "starlight");
    expect(readdirSync(dir).some((f) => f.endsWith(".tmp"))).toBe(false);
    host.destroySession(session.id);
  });

  it("serializes advance behind turns on the same session", async () => {
    installStarlight();
    const session = host.createSession({ scriptId: "starlight", originId: "crew-member", seed: 7 });
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
    host.destroySession(session.id);
  });

  it("resumes a destroyed session from the autosave slot (refresh recovery)", async () => {
    installStarlight();
    const session = host.createSession({ scriptId: "starlight", originId: "crew-member", seed: 7 });
    await host.turn(session.id, { text: "我去舰桥" });
    const transcriptBefore = JSON.stringify(host.state(session.id).transcript);
    host.destroySession(session.id); // the in-memory session is gone

    // A fresh host (server restart / reaped session) rebuilds from disk —
    // the same path the launcher's "继续上次游戏" takes via
    // createSession({ loadRunId: "autosave.json" }).
    const host2 = new EngineHost({ scriptsRoot, saveStore: createFsSaveStore(dataRoot) });
    const resumed = host2.createSession({ scriptId: "starlight", loadRunId: "autosave.json" });
    expect(JSON.stringify(resumed.state.transcript)).toBe(transcriptBefore);
    host2.destroySession(resumed.id);
  });
});

describe("meta-progression persistence", () => {
  it("writeMeta unions existing unlocks with the session's granted origins", async () => {
    installStarlight();
    const session = host.createSession({ scriptId: "starlight", originId: "crew-member", seed: 7 });
    // Seed a meta file as if a previous run had unlocked station-merchant.
    const metaPath = metaPathForScript("starlight", dataRoot);
    mkdirSync(path.dirname(metaPath), { recursive: true });
    writeFileSync(
      metaPath,
      JSON.stringify({ unlockedOrigins: ["station-merchant"], updatedAt: "2026-01-01T00:00:00.000Z" }),
    );

    // Give the session the unlock flag by editing a save and reloading it.
    const savePath = await host.save(session.id, "meta-test");
    const save = JSON.parse(readFileSync(savePath, "utf8")) as {
      worldState: { player: { flags: string[] } };
    };
    save.worldState.player.flags.push("returned_visitor");
    writeFileSync(savePath, JSON.stringify(save));
    host.load(session.id, "meta-test.json");

    const merged = host.writeMeta(session.id);
    expect(merged).toContain("station-merchant");
    const meta = host.readMeta("starlight");
    expect(meta.unlockedOrigins).toContain("station-merchant");
    expect(meta.lockableOrigins).toContain("station-merchant");
    host.destroySession(session.id);
  });

  it("readMeta tolerates a corrupt meta file", async () => {
    installStarlight();
    const metaPath = metaPathForScript("starlight", dataRoot);
    mkdirSync(path.dirname(metaPath), { recursive: true });
    writeFileSync(metaPath, "{ not json");
    const meta = host.readMeta("starlight");
    expect(meta.unlockedOrigins).toEqual([]);
    expect(meta.lockableOrigins).toContain("station-merchant");
  });
});

describe("advance death policy", () => {
  it("runs hard_reset on hp 0 and appends a system transcript entry", async () => {
    installStarlight();
    const session = host.createSession({ scriptId: "starlight", originId: "crew-member", seed: 7 });
    // Inject hp = 0 through a save/load round-trip (deterministic trigger).
    const savePath = await host.save(session.id, "dead-test");
    const save = JSON.parse(readFileSync(savePath, "utf8")) as {
      worldState: { player: { stats: Record<string, number> } };
    };
    save.worldState.player.stats.hp = 0;
    writeFileSync(savePath, JSON.stringify(save));
    host.load(session.id, "dead-test.json");
    expect(host.state(session.id).player.stats.hp).toBe(0);

    await host.advance(session.id, 1);
    const state = host.state(session.id);
    const systemEntries = state.transcript.filter((t) => t.role === "system");
    expect(systemEntries.length).toBeGreaterThan(0);
    expect(systemEntries.at(-1)?.text).toContain("世界重置");
    // hard_reset rerolls worldgen: the player is rebuilt (hp restored).
    expect((state.player.stats.hp ?? 0)).toBeGreaterThan(0);
    host.destroySession(session.id);
  });
});
