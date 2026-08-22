import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadScript } from "@/engine/loader";
import { validateScriptDir } from "@/script/validate";
import type { ScriptUiContext, SlotDef, SlotId } from "@/shared/ui-api";
import registerCoreTestUi, {
  apiVersion,
} from "../fixtures/core-test-library/core-test-script/ui/index";

const scriptDir = path.resolve("test/fixtures/core-test-library/core-test-script");
const expectedSlots = [
  "launcher",
  "game-shell",
  "scene",
  "panel:inventory",
  "bubble:world",
  "bubble:player",
  "bubble:system",
  "message-card:event",
  "message-card:location_enter",
  "message-card:item_reveal",
  "settings:fixture",
] satisfies SlotId[];

describe("core test script library", () => {
  it("loads strict YAML with its declared Engine API v2 extension", () => {
    expect(validateScriptDir(scriptDir)).toEqual({ ok: true, issues: [], scriptId: "core-test-script" });
    const definition = loadScript(scriptDir);
    expect(definition.script.id).toBe("core-test-script");
    expect(definition.script.engine_extension?.api_version).toBe(2);
    expect(definition.extensions.lifecycle.sessionStart).toHaveLength(1);
  });

  it("registers a reachable representative of every public UI API v6 slot family", () => {
    const slots = new Map<SlotId, SlotDef>();
    let configured = false;
    const context: ScriptUiContext = {
      apiVersion: 6,
      register<K extends SlotId>(slot: K, definition: SlotDef<K>) {
        slots.set(slot, definition as SlotDef);
      },
      configureGame() { configured = true; },
    };
    registerCoreTestUi(context);

    expect(apiVersion).toBe(6);
    expect(configured).toBe(true);
    expect([...slots.keys()]).toEqual(expectedSlots);
    for (const slot of expectedSlots) expect(slots.get(slot)?.component).toBeTypeOf("function");
  });
});
