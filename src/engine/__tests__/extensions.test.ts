// Script engine extension seam tests: scripts/<id>/engine/index.ts is
// compiled and loaded by runtime-code.ts; custom effects / condition
// sources / action handlers execute through the normal engine path and
// persist via runtimeState (save v5). The built-in emberfall script ships
// an engine extension (ember / ember_level / forge) — the real fixture.
import path from "node:path";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { loadScript } from "../loader";
import { applyEffects } from "../effect";
import { evalCondition } from "../condition";
import { generateWorld } from "../worldgen";
import { roundTrip, SAVE_SCHEMA_VERSION } from "../save";
import { loadScriptExtensions, type DefinitionWithoutExtensions } from "../../script/runtime-code";

const REPO_ROOT = path.resolve(__dirname, "../../..");
const emberfall = path.join(REPO_ROOT, "scripts/emberfall");

describe("script engine extension seam (emberfall)", () => {
  it("loads the engine extension and registers custom handlers", () => {
    const def = loadScript(emberfall);
    expect(def.extensions.effects["ember"]).toBeTypeOf("function");
    expect(def.extensions.conditions["ember_level"]).toBeTypeOf("function");
    expect(def.extensions.actionHandlers["forge"]).toBeTypeOf("function");
    expect(def.extensions.ruleMechanisms["night_travel"]).toBeTypeOf("function");
  });

  it("rejects registrations that differ from the static v2 declaration", () => {
    const scriptDir = mkdtempSync(path.join(tmpdir(), "cg-engine-extension-"));
    try {
      mkdirSync(path.join(scriptDir, "engine"));
      writeFileSync(
        path.join(scriptDir, "engine", "index.ts"),
        `export default function register(ctx: any) {
          ctx.registerEffect("actual", (state: any) => ({ state, summaries: [] }));
        }`,
        "utf8",
      );
      const definition = {
        sourceDir: scriptDir,
        script: {
          id: "mismatch",
          engine_extension: {
            api_version: 2,
            effects: ["declared"],
            conditions: [],
            action_handlers: [],
            rule_mechanisms: [],
            lifecycle: [],
          },
        },
      } as unknown as DefinitionWithoutExtensions;

      expect(() => loadScriptExtensions(definition)).toThrow(/declaration does not match registrations/);
    } finally {
      rmSync(scriptDir, { recursive: true, force: true });
    }
  });

  it("rejects duplicate registrations instead of silently replacing a handler", () => {
    const scriptDir = mkdtempSync(path.join(tmpdir(), "cg-engine-extension-"));
    try {
      mkdirSync(path.join(scriptDir, "engine"));
      writeFileSync(
        path.join(scriptDir, "engine", "index.ts"),
        `export default function register(ctx: any) {
          const handler = (state: any) => ({ state, summaries: [] });
          ctx.registerEffect("duplicate", handler);
          ctx.registerEffect("duplicate", handler);
        }`,
        "utf8",
      );
      const definition = {
        sourceDir: scriptDir,
        script: {
          id: "duplicate",
          engine_extension: {
            api_version: 2,
            effects: ["duplicate"],
            conditions: [],
            action_handlers: [],
            rule_mechanisms: [],
            lifecycle: [],
          },
        },
      } as unknown as DefinitionWithoutExtensions;

      expect(() => loadScriptExtensions(definition)).toThrow(/duplicate effect registration/);
    } finally {
      rmSync(scriptDir, { recursive: true, force: true });
    }
  });

  it("executes a custom effect kind through applyEffects", () => {
    const def = loadScript(emberfall);
    const { state } = generateWorld(def, "miner", { seed: 1 });
    const out = applyEffects(
      state,
      [{ kind: "ember", value: 10 }],
      { definition: def, day: 1 },
    );
    expect(out.state.runtimeState?.ember).toBe(10);
    expect(out.summaries.some((s) => s.includes("ember heat"))).toBe(true);
  });

  it("evaluates a custom condition source from runtimeState", () => {
    const def = loadScript(emberfall);
    const { state } = generateWorld(def, "miner", { seed: 1 });
    const withEmber = {
      ...state,
      runtimeState: { ...state.runtimeState, ember: 40 },
    };
    const met = evalCondition(
      { source: "ember_level", op: "gte", value: 40 },
      { definition: def, state: withEmber },
    );
    const unmet = evalCondition(
      { source: "ember_level", op: "gte", value: 60 },
      { definition: def, state: withEmber },
    );
    expect(met).toBe(true);
    expect(unmet).toBe(false);
  });

  it("custom action handler is callable and returns a valid outcome", () => {
    const def = loadScript(emberfall);
    const { state } = generateWorld(def, "miner", { seed: 1 });
    const handler = def.extensions.actionHandlers["forge"];
    // Cold forge (no ember) rejects deterministically.
    const cold = handler({
      definition: def,
      state,
      grade: "success",
      targetNpcId: undefined,
      params: { item: "lantern" },
    });
    expect(cold.rejected).toBe(true);
    expect(cold.rejectReason).toBe("forge_cold");
    // Stoked forge forges the lantern.
    const hot = handler({
      definition: def,
      state: { ...state, runtimeState: { ...state.runtimeState, ember: 20 } },
      grade: "success",
      targetNpcId: undefined,
      params: { item: "lantern" },
    });
    expect(hot.rejected).toBeFalsy();
    expect(hot.summaries.some((s) => s.includes("forged"))).toBe(true);
    expect(hot.state.player.inventory.stacks.some((s) => s.itemId === "lantern")).toBe(true);
  });

  it("round-trips runtimeState through save v5", () => {
    const def = loadScript(emberfall);
    const { state } = generateWorld(def, "miner", { seed: 1 });
    const withState = {
      ...state,
      runtimeState: { ...state.runtimeState, ember: 7, forged: true },
    };
    const restored = roundTrip(withState, def);
    expect(restored.runtimeState).toEqual({ ember: 7, forged: true });
    expect(SAVE_SCHEMA_VERSION).toBe(5);
  });
});
