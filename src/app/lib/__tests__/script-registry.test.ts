// Script UI registry tests: slot registration semantics + graceful bundle
// load failure. The node test env cannot resolve the browser-served bundle
// URL (dynamic import throws), which exercises loadScriptUi's catch path
// directly; the success path needs a real browser + dev server and is
// covered by the ui-bundle route tests once Phase 3 wires the launcher.
import { describe, expect, it } from "vitest";
import {
  clearSlots,
  getSlot,
  hasSlot,
  loadScriptUi,
  registerSlot,
  type SlotDef,
} from "../script-registry";

const def: SlotDef = { component: () => null, position: "top", order: 1 };

describe("slot registry", () => {
  it("registers, reads, and clears slots", () => {
    registerSlot("hud", def);
    expect(hasSlot("hud")).toBe(true);
    expect(getSlot("hud")).toBe(def);
    clearSlots();
    expect(hasSlot("hud")).toBe(false);
    expect(getSlot("hud")).toBeUndefined();
  });

  it("overwrites a slot on duplicate registration", () => {
    registerSlot("toolbar", def);
    const second: SlotDef = { component: () => null, position: "bottom", order: 2 };
    registerSlot("toolbar", second);
    expect(getSlot("toolbar")).toBe(second);
    clearSlots();
  });
});

describe("loadScriptUi", () => {
  it("clears slots before loading and returns { ok: false } when the bundle cannot load", async () => {
    registerSlot("hud", def);
    const result = await loadScriptUi("no-such-script");
    expect(result.ok).toBe(false);
    expect(result.error).toBeDefined();
    // A failed load must not leave stale slots behind.
    expect(hasSlot("hud")).toBe(false);
    clearSlots();
  });
});
