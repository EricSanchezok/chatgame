// SaveStore + save.ts tests: atomic writes (temp + rename, no residue,
// crash mid-write keeps the old save), stat-based listing, and read
// robustness (corrupt JSON / missing files / unsafe run ids).
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadScript } from "../loader";
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

const REPO_ROOT = path.resolve(__dirname, "../../..");

let root: string;
let store: SaveStore;
let def: WorldDefinition;
let state: WorldState;

beforeEach(() => {
  root = path.join(tmpdir(), `cg-save-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  store = createFsSaveStore(root);
  def = loadScript(path.join(REPO_ROOT, "scripts/emberfall"));
  ({ state } = generateWorld(def, "miner", { seed: 42 }));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("fsSaveStore atomic writes", () => {
  it("writes via temp + rename with no .tmp residue", () => {
    const filePath = writeSave(def, state, "run-1", store);
    expect(filePath).toContain("run-1.json");
    expect(filePath.startsWith(saveDirForScript("emberfall", root))).toBe(true);
    const files = readdirSync(saveDirForScript("emberfall", root));
    expect(files).toContain("run-1.json");
    expect(files.some((f) => f.endsWith(".tmp"))).toBe(false);
    const restored = readSave(filePath, "emberfall", store);
    expect(JSON.stringify(restored.worldState)).toBe(JSON.stringify(state));
  });

  it("overwrites an existing save atomically", () => {
    const filePath = writeSave(def, state, "run-1", store);
    const next = { ...state, player: { ...state.player, name: "changed" } };
    writeSave(def, next, "run-1", store);
    const restored = readSave(filePath, "emberfall", store);
    expect(restored.worldState.player.name).toBe("changed");
    const leftovers = readdirSync(saveDirForScript("emberfall", root)).filter((f) => f.endsWith(".tmp"));
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
    expect(() => store.read("emberfall", "../evil.json")).toThrow(/invalid save id/);
  });
});

describe("save listing via stat.mtime", () => {
  it("returns runId + mtime without parsing file contents", () => {
    writeSave(def, state, "a-run", store);
    writeSave(def, state, "b-run", store);
    const list = store.list("emberfall");
    expect(list.map((s) => s.runId).sort()).toEqual(["a-run.json", "b-run.json"]);
    for (const entry of list) {
      expect(Number.isNaN(Date.parse(entry.updatedAt))).toBe(false);
    }
    // saveSummaries is the same view (no per-file JSON.parse).
    expect(saveSummaries("emberfall", store)).toEqual(list);
    expect(listSaves("emberfall", store)).toEqual(list.map((s) => s.runId));
  });

  it("returns [] for scripts with no saves", () => {
    expect(store.list("ghost-script")).toEqual([]);
  });
});

describe("save read robustness", () => {
  it("throws SaveError on corrupted JSON", () => {
    const dir = saveDirForScript("emberfall", root);
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "bad.json"), "{ not json");
    const filePath = path.join(dir, "bad.json");
    expect(() => readSave(filePath, "emberfall", store)).toThrow(SaveError);
    expect(() => readSave(filePath, "emberfall", store)).toThrow(/not valid JSON/);
  });

  it("throws SaveError on missing files", () => {
    const missing = path.join(saveDirForScript("emberfall", root), "missing.json");
    expect(() => readSave(missing, "emberfall", store)).toThrow(/not found/);
  });
});

describe("meta path layout", () => {
  it("lives under <root>/meta/<scriptId>.json", () => {
    expect(metaPathForScript("emberfall", root)).toBe(path.join(root, "meta", "emberfall.json"));
    expect(existsSync(metaPathForScript("emberfall", root))).toBe(false);
  });
});
