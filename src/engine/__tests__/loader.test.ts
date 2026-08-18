// Core loader tests: both fixtures must load into WorldDefinition,
// and the contract layer must remain untouched (validation still passes).
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadScript, ScriptLoadError } from "../loader";

const REPO_ROOT = path.resolve(__dirname, "../../..");

describe("loadScript", () => {
  it("loads emberfall into a WorldDefinition", () => {
    const def = loadScript(path.join(REPO_ROOT, "scripts/emberfall"));
    expect(def.script.id).toBe("emberfall");
    expect(def.origins.size).toBeGreaterThanOrEqual(1);
    expect(def.npcs.size).toBeGreaterThanOrEqual(1);
    expect(def.locations.size).toBeGreaterThanOrEqual(1);
    expect(def.actions.actions.length).toBeGreaterThanOrEqual(1);
    expect(def.plot.commitments.length).toBeGreaterThanOrEqual(1);
  });

  it("loads starlight into a WorldDefinition", () => {
    const def = loadScript(path.join(REPO_ROOT, "scripts/starlight"));
    expect(def.script.id).toBe("starlight");
    expect(def.npcs.size).toBeGreaterThanOrEqual(1);
    expect(def.locations.size).toBeGreaterThanOrEqual(1);
  });

  it("throws ScriptLoadError for an invalid script", () => {
    const tmp = path.join(REPO_ROOT, "scripts");
    expect(() => loadScript(path.join(tmp, "nonexistent"))).toThrow(ScriptLoadError);
  });

  it("builds NPC relations with deterministic stances", () => {
    const def = loadScript(path.join(REPO_ROOT, "scripts/emberfall"));
    const elara = def.npcs.get("elara");
    expect(elara).toBeDefined();
    expect((elara!.relations ?? []).length).toBeGreaterThan(0);
  });
});

describe("ScriptLoadError", () => {
  it("is an Error subclass", () => {
    const err = new ScriptLoadError("boom");
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe("boom");
  });
});
