// SaveStore + save.ts tests: atomic writes (temp + rename, no residue,
// crash mid-write keeps the old save), stat-based listing, and read
// robustness (corrupt JSON / missing files / unsafe run ids).
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { generateWorld } from "../worldgen";
import {
  writeSave,
  readSave,
  listSaves,
  saveSummaries,
  SaveError,
} from "../save";
import {
  createFsSaveStore,
  saveDirForScript,
  metaPathForScript,
  type SaveStore,
} from "../save-store";
import type { WorldState, WorldDefinition } from "../types";
import { loadCoreTestDefinition } from "./core-test-fixture";

const SCRIPT_ID = "core-test-script";

let root: string;
let store: SaveStore;
let def: WorldDefinition;
let state: WorldState;

beforeEach(() => {
  root = path.join(tmpdir(), `cg-save-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  store = createFsSaveStore(root);
  def = loadCoreTestDefinition();
  ({ state } = generateWorld(def, "observer", { seed: 42 }));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("fsSaveStore atomic writes", () => {
  it("writes via temp + rename with no .tmp residue", () => {
    const filePath = writeSave(def, state, "run-1", store);
    expect(filePath).toContain("run-1.json");
    expect(filePath.startsWith(saveDirForScript(SCRIPT_ID, root))).toBe(true);
    const files = readdirSync(saveDirForScript(SCRIPT_ID, root));
    expect(files).toContain("run-1.json");
    expect(files.some((f) => f.endsWith(".tmp"))).toBe(false);
    const restored = readSave(filePath, SCRIPT_ID, store);
    expect(JSON.stringify(restored.worldState)).toBe(JSON.stringify(state));
  });

  it("overwrites an existing save atomically", () => {
    const filePath = writeSave(def, state, "run-1", store);
    const next = { ...state, player: { ...state.player, name: "changed" } };
    writeSave(def, next, "run-1", store);
    const restored = readSave(filePath, SCRIPT_ID, store);
    expect(restored.worldState.player.name).toBe("changed");
    const leftovers = readdirSync(saveDirForScript(SCRIPT_ID, root)).filter((f) => f.endsWith(".tmp"));
    expect(leftovers).toEqual([]);
  });

  it("keeps the previous save intact when a write fails mid-flight", () => {
    const filePath = writeSave(def, state, "run-1", store);
    const before = readFileSync(filePath, "utf8");
    const failing: SaveStore = {
      write() {
        throw new Error("disk full");
      },
      read: store.read,
      list: store.list,
    };
    expect(() =>
      writeSave(def, { ...state, player: { ...state.player, name: "x" } }, "run-1", failing),
    ).toThrow("disk full");
    expect(readFileSync(filePath, "utf8")).toBe(before);
  });

  it("rejects unsafe run ids (traversal)", () => {
    expect(() => writeSave(def, state, "../evil", store)).toThrow(/invalid save id/);
    expect(() => store.read(SCRIPT_ID, "../evil.json")).toThrow(/invalid save id/);
  });
});

describe("save listing via stat.mtime", () => {
  it("returns runId + mtime without parsing file contents", () => {
    writeSave(def, state, "a-run", store);
    writeSave(def, state, "b-run", store);
    const list = store.list(SCRIPT_ID);
    expect(list.map((s) => s.runId).sort()).toEqual(["a-run.json", "b-run.json"]);
    for (const entry of list) {
      expect(Number.isNaN(Date.parse(entry.updatedAt))).toBe(false);
    }
    // saveSummaries is the same view (no per-file JSON.parse).
    expect(saveSummaries(SCRIPT_ID, store)).toEqual(list);
    expect(listSaves(SCRIPT_ID, store)).toEqual(list.map((s) => s.runId));
  });

  it("returns [] for scripts with no saves", () => {
    expect(store.list("ghost-script")).toEqual([]);
  });
});

describe("save read robustness", () => {
  it("throws SaveError on corrupted JSON", () => {
    const dir = saveDirForScript(SCRIPT_ID, root);
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "bad.json"), "{ not json");
    const filePath = path.join(dir, "bad.json");
    expect(() => readSave(filePath, SCRIPT_ID, store)).toThrow(SaveError);
    expect(() => readSave(filePath, SCRIPT_ID, store)).toThrow(/not valid JSON/);
  });

  it("throws SaveError on missing files", () => {
    const missing = path.join(saveDirForScript(SCRIPT_ID, root), "missing.json");
    expect(() => readSave(missing, SCRIPT_ID, store)).toThrow(/not found/);
  });
});

describe("meta path layout", () => {
  it("lives under <root>/meta/<scriptId>.json", () => {
    expect(metaPathForScript(SCRIPT_ID, root)).toBe(path.join(root, "meta", `${SCRIPT_ID}.json`));
    expect(existsSync(metaPathForScript(SCRIPT_ID, root))).toBe(false);
  });
});
