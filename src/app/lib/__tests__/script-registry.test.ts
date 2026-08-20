import { beforeEach, describe, expect, it } from "vitest";
import type { ScriptUiBundleDescriptor } from "../../../shared/client-dto";
import {
  clearSlots,
  getScriptRegistrySnapshot,
  getSlot,
  hasSlot,
  loadScriptUi,
  registerSlot,
  subscribeScriptRegistry,
  type ScriptUiContext,
  type SlotDef,
} from "../script-registry";

const def: SlotDef = { component: () => null };
const another: SlotDef = { component: () => null };

function bundle(hash: string): ScriptUiBundleDescriptor {
  return { apiVersion: 3, dependencyHash: hash, url: `/bundle/${hash}.mjs` };
}

function moduleWith(register: (context: ScriptUiContext) => void) {
  return { apiVersion: 3, default: register };
}

beforeEach(clearSlots);

describe("slot registry", () => {
  it("publishes immutable direct registration snapshots", () => {
    const before = getScriptRegistrySnapshot();
    registerSlot("hud", def);
    expect(hasSlot("hud")).toBe(true);
    expect(getSlot("hud")).toBe(def);
    expect(getScriptRegistrySnapshot()).not.toBe(before);
    expect(before.slots.has("hud")).toBe(false);
  });

  it("commits a complete bundle in one registry snapshot", async () => {
    const observed: number[] = [];
    const unsubscribe = subscribeScriptRegistry(() => observed.push(getScriptRegistrySnapshot().slots.size));
    const result = await loadScriptUi("emberfall", bundle("a"), {
      importer: async () => moduleWith((context) => {
        context.register("hud", def);
        context.register("toolbar", another);
      }),
    });
    unsubscribe();

    expect(result.ok).toBe(true);
    expect(getScriptRegistrySnapshot()).toMatchObject({ scriptId: "emberfall", dependencyHash: "a", status: "active" });
    expect(observed).toEqual([0, 2]);
  });

  it("rejects duplicate slot registrations without replacing the active version", async () => {
    await loadScriptUi("emberfall", bundle("good"), {
      importer: async () => moduleWith((context) => context.register("hud", def)),
    });
    const previousSlots = getScriptRegistrySnapshot().slots;
    const result = await loadScriptUi("emberfall", bundle("bad"), {
      importer: async () => moduleWith((context) => {
        context.register("hud", def);
        context.register("hud", another);
      }),
    });

    expect(result.ok).toBe(false);
    expect(result.error).toContain("more than once");
    expect(getScriptRegistrySnapshot().slots).toBe(previousSlots);
    expect(getScriptRegistrySnapshot()).toMatchObject({ scriptId: "emberfall", dependencyHash: "good", status: "active" });
  });

  it("keeps the prior same-script version on an import failure", async () => {
    await loadScriptUi("emberfall", bundle("good"), {
      importer: async () => moduleWith((context) => context.register("hud", def)),
    });
    const before = getScriptRegistrySnapshot();
    const result = await loadScriptUi("emberfall", bundle("broken"), {
      importer: async () => { throw new Error("network unavailable"); },
    });

    expect(result).toMatchObject({ ok: false, error: "network unavailable" });
    expect(getScriptRegistrySnapshot().slots).toBe(before.slots);
    expect(getScriptRegistrySnapshot()).toMatchObject({ scriptId: "emberfall", dependencyHash: "good", error: "network unavailable" });
  });

  it("uses target-script host fallbacks after a cross-script failure", async () => {
    await loadScriptUi("emberfall", bundle("a"), {
      importer: async () => moduleWith((context) => context.register("hud", def)),
    });
    await loadScriptUi("starlight", bundle("b"), {
      importer: async () => { throw new Error("broken starlight bundle"); },
    });

    expect(getScriptRegistrySnapshot()).toMatchObject({ scriptId: "starlight", dependencyHash: "b", status: "error" });
    expect(getScriptRegistrySnapshot().slots.size).toBe(0);
  });

  it("ignores a late A completion after B has activated", async () => {
    let resolveA!: (value: ReturnType<typeof moduleWith>) => void;
    const pendingA = new Promise<ReturnType<typeof moduleWith>>((resolve) => { resolveA = resolve; });
    const a = loadScriptUi("emberfall", bundle("a"), { importer: async () => pendingA });
    const b = await loadScriptUi("starlight", bundle("b"), {
      importer: async () => moduleWith((context) => context.register("toolbar", another)),
    });
    resolveA(moduleWith((context) => context.register("hud", def)));
    const lateA = await a;

    expect(b.ok).toBe(true);
    expect(lateA.stale).toBe(true);
    expect(getScriptRegistrySnapshot()).toMatchObject({ scriptId: "starlight", dependencyHash: "b" });
    expect(hasSlot("toolbar")).toBe(true);
    expect(hasSlot("hud")).toBe(false);
  });

  it("activates an absent bundle as an empty host registry", async () => {
    registerSlot("hud", def);
    const result = await loadScriptUi("declarative-only");
    expect(result.ok).toBe(true);
    expect(getScriptRegistrySnapshot()).toMatchObject({ scriptId: "declarative-only", status: "active" });
    expect(getScriptRegistrySnapshot().slots.size).toBe(0);
  });
});
