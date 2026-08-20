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
import { previewAction, resolveAction } from "../actions";
import { runLifecycle, type LifecyclePhase } from "../extensions";
import type { WorldDefinition, WorldState } from "../types";

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
      targetNpcId: undefined,
      params: { item: "lantern" },
    });
    expect(cold.rejected).toBe(true);
    expect(cold.rejectReason).toBe("forge_cold");
    // Stoked forge forges the lantern.
    const hotState = { ...state, runtimeState: { ...state.runtimeState, ember: 20 } };
    const hot = handler({
      definition: def,
      state: hotState,
      targetNpcId: undefined,
      params: { item: "lantern" },
    });
    expect(hot.rejected).toBeFalsy();
    const outcome = hot.execute(hotState, "success");
    expect(outcome.summaries.some((s) => s.includes("forged"))).toBe(true);
    expect(outcome.state.player.inventory.stacks.some((s) => s.itemId === "lantern")).toBe(true);
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

  it("enforces every extension purity boundary through the compiled CJS entry", () => {
    const scriptDir = mkdtempSync(path.join(tmpdir(), "cg-runtime-purity-"));
    try {
      mkdirSync(path.join(scriptDir, "engine"));
      writeFileSync(
        path.join(scriptDir, "engine", "index.ts"),
        `export default function register(ctx: any) {
          ctx.registerConditionSource("purity-condition", (state: any, leaf: any, context: any) => {
            if (leaf.key === "state") state.clock.hour = 99;
            if (leaf.key === "definition") context.definition.world.background = "polluted";
            if (leaf.key === "leaf") leaf.key = "polluted";
            return true;
          });
          ctx.registerEffect("purity-effect", (state: any, effect: any, context: any) => {
            if (effect.mutation === "state") state.scriptId = "forged";
            if (effect.mutation === "definition") context.definition.world.background = "polluted";
            if (effect.mutation === "effect") effect.mutation = "polluted";
            if (effect.mutation === "output-script-id") {
              return { state: { ...state, scriptId: "forged" }, summaries: [] };
            }
            return {
              state: { ...state, runtimeState: { ...state.runtimeState, effectApplied: true } },
              summaries: ["purity effect applied"],
            };
          });
          ctx.registerActionHandler("purity-probe", ({ definition, state, params }: any) => {
            if (params?.actionMutation === "state") state.clock.hour = 99;
            if (params?.actionMutation === "definition") definition.world.background = "polluted";
            if (params?.actionMutation === "params") params.actionMutation = "polluted";
            const timeCost = params?.timeMode === "nan" ? Number.NaN
              : params?.timeMode === "infinity" ? Number.POSITIVE_INFINITY
              : params?.timeMode === "negative" ? -1
              : params?.timeMode === "zero" ? 0
              : 1;
            return { timeCost, execute: (nextState: any) => ({ state: nextState, summaries: [] }) };
          });
          ctx.registerRuleMechanism("purity-rule", ({ definition, state, params }: any) => {
            if (params?.ruleMutation === "state") state.flags.push("polluted");
            if (params?.ruleMutation === "definition") definition.world.background = "polluted";
            if (params?.ruleMutation === "params") params.ruleMutation = "polluted";
            return null;
          });
          ctx.onSessionStart((state: any) => {
            if (state.runtimeState.lifecycleProbe === "output-script-id") {
              return { state: { ...state, scriptId: "forged" }, summaries: [] };
            }
            state.scriptId = "forged";
            return { state, summaries: [] };
          });
          ctx.onTurnResolved((state: any) => {
            state.flags.push("polluted");
            return { state, summaries: [] };
          });
          ctx.onHour((state: any, context: any) => {
            context.definition.world.background = "polluted";
            return { state, summaries: [] };
          });
          ctx.onDayBoundary((state: any, context: any) => {
            context.previousState.clock.hour = 99;
            return { state, summaries: [] };
          });
        }`,
        "utf8",
      );
      const base = loadScript(emberfall);
      const engineExtension: NonNullable<typeof base.script.engine_extension> = {
        api_version: 2,
        effects: ["purity-effect"],
        conditions: ["purity-condition"],
        action_handlers: ["purity-probe"],
        rule_mechanisms: ["purity-rule"],
        lifecycle: ["session_start", "turn_resolved", "hour", "day_boundary"],
      };
      const script = {
        ...base.script,
        id: "runtime-purity-probe",
        engine_extension: engineExtension,
      };
      const { extensions: _baseExtensions, ...baseWithoutExtensions } = base;
      void _baseExtensions;
      const withoutExtensions: DefinitionWithoutExtensions = {
        ...baseWithoutExtensions,
        sourceDir: scriptDir,
        script,
      };
      const extensions = loadScriptExtensions(withoutExtensions);
      const action = {
        id: "purity-probe-action",
        enabled: true,
        resolve: { type: "auto" as const },
        llm_freedom: "narration" as const,
        handler: "purity-probe",
      };
      const definition: WorldDefinition = {
        ...withoutExtensions,
        actions: { ...base.actions, actions: [...base.actions.actions, action] },
        world: {
          ...base.world,
          rules: [{ id: "purity-rule", text: "probe purity", mechanism: "purity-rule" }],
        },
        extensions,
      };
      const state = generateWorld(definition, "miner", { seed: 7 }).state;
      const stateBefore = structuredClone(state);
      const backgroundBefore = definition.world.background;

      for (const conditionMutation of ["state", "definition", "leaf"]) {
        const condition = { source: "purity-condition", key: conditionMutation, op: "eq" };
        expect(() => evalCondition(condition as never, { definition, state })).toThrow(TypeError);
        expect(condition).toEqual({ source: "purity-condition", key: conditionMutation, op: "eq" });
        expect(state).toEqual(stateBefore);
        expect(definition.world.background).toBe(backgroundBefore);
      }

      for (const effectMutation of ["state", "definition", "effect"]) {
        const effect = { kind: "purity-effect", mutation: effectMutation };
        expect(() => applyEffects(state, [effect as never], { definition, day: 0 })).toThrow(TypeError);
        expect(effect).toEqual({ kind: "purity-effect", mutation: effectMutation });
        expect(state).toEqual(stateBefore);
        expect(definition.world.background).toBe(backgroundBefore);
      }
      expect(() => applyEffects(
        state,
        [{ kind: "purity-effect", mutation: "output-script-id" } as never],
        { definition, day: 0 },
      )).toThrow(/custom effect "purity-effect" cannot change the active script id/);
      const effectOut = applyEffects(
        state,
        [{ kind: "purity-effect", mutation: "success" } as never],
        { definition, day: 0 },
      );
      expect(effectOut.state.runtimeState.effectApplied).toBe(true);
      expect(() => effectOut.state.flags.push("detached-output")).not.toThrow();
      expect(state).toEqual(stateBefore);

      for (const timeMode of ["nan", "infinity", "negative"]) {
        const params = { timeMode };
        expect(() => previewAction(definition, state, { actionId: action.id, params }))
          .toThrow(/timeCost.*non-negative finite/);
        expect(() => resolveAction({ definition, state, actionId: action.id, params }))
          .toThrow(/timeCost.*non-negative finite/);
        expect(state).toEqual(stateBefore);
      }
      const zeroPreview = previewAction(definition, state, {
        actionId: action.id,
        params: { timeMode: "zero" },
      });
      const zeroResolution = resolveAction({
        definition,
        state,
        actionId: action.id,
        params: { timeMode: "zero" },
      });
      expect(zeroPreview.timeCost).toBe(1);
      expect(zeroResolution.effectiveTimeCost).toBe(1);

      for (const actionMutation of ["state", "definition", "params"]) {
        const params = { actionMutation };
        expect(() => previewAction(definition, state, { actionId: action.id, params })).toThrow(TypeError);
        expect(() => resolveAction({ definition, state, actionId: action.id, params })).toThrow(TypeError);
        expect(params).toEqual({ actionMutation });
        expect(state).toEqual(stateBefore);
        expect(definition.world.background).toBe(backgroundBefore);
      }

      for (const ruleMutation of ["state", "definition", "params"]) {
        const params = { ruleMutation };
        expect(() => previewAction(definition, state, { actionId: action.id, params })).toThrow(TypeError);
        expect(() => resolveAction({ definition, state, actionId: action.id, params })).toThrow(TypeError);
        expect(params).toEqual({ ruleMutation });
        expect(state).toEqual(stateBefore);
        expect(definition.world.background).toBe(backgroundBefore);
      }

      const lifecycleCases: LifecyclePhase[] = ["sessionStart", "turnResolved", "hour", "dayBoundary"];
      for (const phase of lifecycleCases) {
        expect(() => runLifecycle(phase, state, { definition, previousState: state })).toThrow(TypeError);
        expect(state).toEqual(stateBefore);
        expect(definition.world.background).toBe(backgroundBefore);
      }
      const forgedOutputState: WorldState = {
        ...state,
        runtimeState: { ...state.runtimeState, lifecycleProbe: "output-script-id" },
      };
      expect(() => runLifecycle("sessionStart", forgedOutputState, { definition }))
        .toThrow(/cannot change the active script id/);
      expect(forgedOutputState.scriptId).toBe("runtime-purity-probe");
    } finally {
      rmSync(scriptDir, { recursive: true, force: true });
    }
  });
});
