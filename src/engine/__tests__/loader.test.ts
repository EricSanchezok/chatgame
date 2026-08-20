// Loader tests cover generic errors plus real built-in content integration.
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadScript, ScriptLoadError } from "../loader";
import { generateWorld } from "../worldgen";

const REPO_ROOT = path.resolve(__dirname, "../../..");

describe("loadScript", () => {
  it("throws ScriptLoadError for an invalid script", () => {
    const tmp = path.join(REPO_ROOT, "scripts");
    expect(() => loadScript(path.join(tmp, "nonexistent"))).toThrow(ScriptLoadError);
  });
});

describe("Built-in script loader content regression", () => {
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

  it("builds authored NPC relations with deterministic stances", () => {
    const def = loadScript(path.join(REPO_ROOT, "scripts/starlight"));
    const first = generateWorld(def, "crew-member", { seed: 7 }).state.npcs["chief-engineer"];
    const second = generateWorld(def, "crew-member", { seed: 7 }).state.npcs["chief-engineer"];

    expect(first.relations).toEqual(expect.arrayContaining([
      expect.objectContaining({ npcId: "doctor-vera", value: 34, stance: "friendly" }),
      expect.objectContaining({ npcId: "night-cat", value: -8, stance: "neutral" }),
    ]));
    expect(second.relations).toEqual(first.relations);
  });
});

describe("ScriptLoadError", () => {
  it("is an Error subclass", () => {
    const err = new ScriptLoadError("boom");
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe("boom");
  });
});
