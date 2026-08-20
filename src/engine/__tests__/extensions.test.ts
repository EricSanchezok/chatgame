// Engine Extension v2 tests use temporary runtime-code entries over the
// independent core definition. No product script supplies generic behavior.
import path from "node:path";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { applyEffects } from "../effect";
import { evalCondition } from "../condition";
import { generateWorld } from "../worldgen";
import { roundTrip, SAVE_SCHEMA_VERSION } from "../save";
import { loadScriptExtensions, type DefinitionWithoutExtensions } from "../../script/runtime-code";
import { previewAction, resolveAction } from "../actions";
import { runLifecycle, type LifecyclePhase } from "../extensions";
import type { WorldDefinition, WorldState } from "../types";
import { loadCoreTestDefinition } from "./core-test-fixture";

type EngineExtensionDeclaration = NonNullable<WorldDefinition["script"]["engine_extension"]>;

interface RuntimeFixture {
  definition: WorldDefinition;
  dispose(): void;
}

function runtimeFixture(
  source: string,
  declaration: EngineExtensionDeclaration,
  scriptId = "runtime-extension-probe",
): RuntimeFixture {
  const scriptDir = mkdtempSync(path.join(tmpdir(), "cg-runtime-extension-"));
  try {
    mkdirSync(path.join(scriptDir, "engine"));
    writeFileSync(path.join(scriptDir, "engine", "index.ts"), source, "utf8");
    const base = loadCoreTestDefinition();
    const { extensions: _baseExtensions, ...baseWithoutExtensions } = base;
    void _baseExtensions;
    const withoutExtensions: DefinitionWithoutExtensions = {
      ...baseWithoutExtensions,
      sourceDir: scriptDir,
      script: { ...base.script, id: scriptId, engine_extension: declaration },
    };
    const extensions = loadScriptExtensions(withoutExtensions);
    return {
      definition: { ...withoutExtensions, extensions },
      dispose: () => rmSync(scriptDir, { recursive: true, force: true }),
    };
  } catch (error) {
    rmSync(scriptDir, { recursive: true, force: true });
    throw error;
  }
}

const EMPTY_DECLARATION: EngineExtensionDeclaration = {
  api_version: 2,
  effects: [],
  conditions: [],
  action_handlers: [],
  rule_mechanisms: [],
  lifecycle: [],
};

describe("script engine extension seam", () => {
  it("loads a temporary extension and registers every handler family", () => {
    const fixture = runtimeFixture(
      `export default function register(ctx: any) {
        ctx.registerEffect("charge", (state: any) => ({ state, summaries: [] }));
        ctx.registerConditionSource("charge-level", () => true);
        ctx.registerActionHandler("assemble", () => ({ execute: (state: any) => ({ state, summaries: [] }) }));
        ctx.registerRuleMechanism("quiet-window", () => null);
      }`,
      {
        ...EMPTY_DECLARATION,
        effects: ["charge"],
        conditions: ["charge-level"],
        action_handlers: ["assemble"],
        rule_mechanisms: ["quiet-window"],
      },
    );
    try {
      expect(fixture.definition.extensions.effects.charge).toBeTypeOf("function");
      expect(fixture.definition.extensions.conditions["charge-level"]).toBeTypeOf("function");
      expect(fixture.definition.extensions.actionHandlers.assemble).toBeTypeOf("function");
      expect(fixture.definition.extensions.ruleMechanisms["quiet-window"]).toBeTypeOf("function");
    } finally {
      fixture.dispose();
    }
  });

  it("rejects registrations that differ from the static v2 declaration", () => {
    expect(() => runtimeFixture(
      `export default function register(ctx: any) {
        ctx.registerEffect("actual", (state: any) => ({ state, summaries: [] }));
      }`,
      { ...EMPTY_DECLARATION, effects: ["declared"] },
    )).toThrow(/declaration does not match registrations/);
  });

  it("rejects duplicate registrations instead of replacing a handler", () => {
    expect(() => runtimeFixture(
      `export default function register(ctx: any) {
        const handler = (state: any) => ({ state, summaries: [] });
        ctx.registerEffect("duplicate", handler);
        ctx.registerEffect("duplicate", handler);
      }`,
      { ...EMPTY_DECLARATION, effects: ["duplicate"] },
    )).toThrow(/duplicate effect registration/);
  });

  it("executes a custom effect kind through applyEffects", () => {
    const fixture = runtimeFixture(
      `export default function register(ctx: any) {
        ctx.registerEffect("charge", (state: any, effect: any) => ({
          state: { ...state, runtimeState: { ...state.runtimeState, charge: Number(state.runtimeState.charge ?? 0) + effect.value } },
          summaries: ["charge increased"],
        }));
      }`,
      { ...EMPTY_DECLARATION, effects: ["charge"] },
    );
    try {
      const state = generateWorld(fixture.definition, "observer", { seed: 1 }).state;
      const out = applyEffects(
        state,
        [{ kind: "charge", value: 10 }],
        { definition: fixture.definition, day: 1 },
      );
      expect(out.state.runtimeState.charge).toBe(10);
      expect(out.summaries).toContain("charge increased");
    } finally {
      fixture.dispose();
    }
  });

  it("evaluates a custom condition source from runtimeState", () => {
    const fixture = runtimeFixture(
      `export default function register(ctx: any) {
        ctx.registerConditionSource("charge-level", (state: any, leaf: any) =>
          Number(state.runtimeState.charge ?? 0) >= Number(leaf.value));
      }`,
      { ...EMPTY_DECLARATION, conditions: ["charge-level"] },
    );
    try {
      const state = generateWorld(fixture.definition, "observer", { seed: 1 }).state;
      const charged = { ...state, runtimeState: { ...state.runtimeState, charge: 40 } };
      expect(evalCondition(
        { source: "charge-level", op: "gte", value: 40 },
        { definition: fixture.definition, state: charged },
      )).toBe(true);
      expect(evalCondition(
        { source: "charge-level", op: "gte", value: 60 },
        { definition: fixture.definition, state: charged },
      )).toBe(false);
    } finally {
      fixture.dispose();
    }
  });

  it("calls a custom action handler and applies its outcome", () => {
    const fixture = runtimeFixture(
      `export default function register(ctx: any) {
        ctx.registerActionHandler("assemble", ({ state }: any) => {
          if (Number(state.runtimeState.charge ?? 0) < 10) {
            return { rejected: true, rejectReason: "charge-low", execute: (next: any) => ({ state: next, summaries: [] }) };
          }
          return { execute: (next: any) => ({
            state: { ...next, runtimeState: { ...next.runtimeState, assembled: true } },
            summaries: ["assembly completed"],
          }) };
        });
      }`,
      { ...EMPTY_DECLARATION, action_handlers: ["assemble"] },
    );
    try {
      const state = generateWorld(fixture.definition, "observer", { seed: 1 }).state;
      const handler = fixture.definition.extensions.actionHandlers.assemble;
      expect(handler({ definition: fixture.definition, state }).rejected).toBe(true);

      const charged = { ...state, runtimeState: { ...state.runtimeState, charge: 20 } };
      const plan = handler({ definition: fixture.definition, state: charged });
      const outcome = plan.execute(charged, "success");
      expect(outcome.state.runtimeState.assembled).toBe(true);
      expect(outcome.summaries).toContain("assembly completed");
    } finally {
      fixture.dispose();
    }
  });

  it("round-trips extension-owned runtimeState through save v5", () => {
    const definition = loadCoreTestDefinition();
    const state = generateWorld(definition, "observer", { seed: 1 }).state;
    const extended = {
      ...state,
      runtimeState: { ...state.runtimeState, charge: 7, assembled: true },
    };
    expect(roundTrip(extended, definition).runtimeState).toEqual({ charge: 7, assembled: true });
    expect(SAVE_SCHEMA_VERSION).toBe(5);
  });

  it("enforces every extension purity boundary through the compiled CJS entry", () => {
    const fixture = runtimeFixture(
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
      {
        api_version: 2,
        effects: ["purity-effect"],
        conditions: ["purity-condition"],
        action_handlers: ["purity-probe"],
        rule_mechanisms: ["purity-rule"],
        lifecycle: ["session_start", "turn_resolved", "hour", "day_boundary"],
      },
      "runtime-purity-probe",
    );
    try {
      const action = {
        id: "purity-probe-action",
        enabled: true,
        resolve: { type: "auto" as const },
        llm_freedom: "narration" as const,
        handler: "purity-probe",
      };
      const definition: WorldDefinition = {
        ...fixture.definition,
        actions: {
          ...fixture.definition.actions,
          actions: [...fixture.definition.actions.actions, action],
        },
        world: {
          ...fixture.definition.world,
          rules: [{ id: "purity-rule", text: "probe purity", mechanism: "purity-rule" }],
        },
      };
      const state = generateWorld(definition, "observer", { seed: 7 }).state;
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
      expect(previewAction(definition, state, {
        actionId: action.id,
        params: { timeMode: "zero" },
      }).timeCost).toBe(1);
      expect(resolveAction({
        definition,
        state,
        actionId: action.id,
        params: { timeMode: "zero" },
      }).effectiveTimeCost).toBe(1);

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
      fixture.dispose();
    }
  });
});
