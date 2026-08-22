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
  return { apiVersion: 6, dependencyHash: hash, url: `/bundle/${hash}.mjs` };
}

function moduleWith(register: (context: ScriptUiContext) => void) {
  return { apiVersion: 6, default: register };
}

beforeEach(clearSlots);

describe("slot registry", () => {
  it("publishes immutable direct registration snapshots", () => {
    const before = getScriptRegistrySnapshot();
    registerSlot("scene", def);
    expect(hasSlot("scene")).toBe(true);
    expect(getSlot("scene")).toBe(def);
    expect(getScriptRegistrySnapshot()).not.toBe(before);
    expect(before.slots.has("scene")).toBe(false);
  });

  it("commits a complete bundle in one registry snapshot", async () => {
    const observed: number[] = [];
    const unsubscribe = subscribeScriptRegistry(() => observed.push(getScriptRegistrySnapshot().slots.size));
    const result = await loadScriptUi("script-a", bundle("a"), {
      importer: async () => moduleWith((context) => {
        context.register("scene", def);
        context.register("launcher", another);
      }),
    });
    unsubscribe();

    expect(result.ok).toBe(true);
    expect(getScriptRegistrySnapshot()).toMatchObject({ scriptId: "script-a", dependencyHash: "a", status: "active" });
    expect(observed).toEqual([0, 2]);
  });

  it("rejects duplicate slot registrations without replacing the active version", async () => {
    await loadScriptUi("script-a", bundle("good"), {
      importer: async () => moduleWith((context) => context.register("scene", def)),
    });
    const previousSlots = getScriptRegistrySnapshot().slots;
    const result = await loadScriptUi("script-a", bundle("bad"), {
      importer: async () => moduleWith((context) => {
        context.register("scene", def);
        context.register("scene", another);
      }),
    });

    expect(result.ok).toBe(false);
    expect(result.error).toContain("more than once");
    expect(getScriptRegistrySnapshot().slots).toBe(previousSlots);
    expect(getScriptRegistrySnapshot()).toMatchObject({ scriptId: "script-a", dependencyHash: "good", status: "active" });
  });

  it("rejects a v5 bundle without a compatibility path", async () => {
    const legacy = { apiVersion: 5, dependencyHash: "legacy", url: "/bundle/legacy.mjs" } as unknown as ScriptUiBundleDescriptor;
    const result = await loadScriptUi("script-a", legacy, {
      importer: async () => ({ apiVersion: 5, default: () => {} }),
    });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("宿主需要 6");
    expect(getScriptRegistrySnapshot().slots.size).toBe(0);
  });

  it("keeps the prior same-script version on an import failure", async () => {
    await loadScriptUi("script-a", bundle("good"), {
      importer: async () => moduleWith((context) => context.register("scene", def)),
    });
    const before = getScriptRegistrySnapshot();
    const result = await loadScriptUi("script-a", bundle("broken"), {
      importer: async () => { throw new Error("network unavailable"); },
    });

    expect(result).toMatchObject({ ok: false, error: "network unavailable" });
    expect(getScriptRegistrySnapshot().slots).toBe(before.slots);
    expect(getScriptRegistrySnapshot()).toMatchObject({ scriptId: "script-a", dependencyHash: "good", error: "network unavailable" });
  });

  it("keeps the last complete same-script version when overlapping activation fails", async () => {
    await loadScriptUi("script-a", bundle("good"), {
      importer: async () => moduleWith((context) => context.register("scene", def)),
    });
    const previousSlots = getScriptRegistrySnapshot().slots;
    let finishFirst!: (value: ReturnType<typeof moduleWith>) => void;
    const pendingFirst = new Promise<ReturnType<typeof moduleWith>>((resolve) => { finishFirst = resolve; });

    const first = loadScriptUi("script-a", bundle("next"), { importer: async () => pendingFirst });
    const second = await loadScriptUi("script-a", bundle("broken"), {
      importer: async () => { throw new Error("overlapping activation failed"); },
    });
    finishFirst(moduleWith((context) => context.register("launcher", another)));
    const staleFirst = await first;

    expect(second).toMatchObject({ ok: false, error: "overlapping activation failed" });
    expect(staleFirst.stale).toBe(true);
    expect(getScriptRegistrySnapshot().slots).toBe(previousSlots);
    expect(getScriptRegistrySnapshot()).toMatchObject({
      scriptId: "script-a",
      dependencyHash: "good",
      status: "active",
      error: "overlapping activation failed",
    });
  });

  it("uses target-script host fallbacks after a cross-script failure", async () => {
    await loadScriptUi("script-a", bundle("a"), {
      importer: async () => moduleWith((context) => context.register("scene", def)),
    });
    await loadScriptUi("script-b", bundle("b"), {
      importer: async () => { throw new Error("broken script-b bundle"); },
    });

    expect(getScriptRegistrySnapshot()).toMatchObject({ scriptId: "script-b", dependencyHash: "b", status: "error" });
    expect(getScriptRegistrySnapshot().slots.size).toBe(0);
  });

  it("ignores a late A completion after B has activated", async () => {
    let resolveA!: (value: ReturnType<typeof moduleWith>) => void;
    const pendingA = new Promise<ReturnType<typeof moduleWith>>((resolve) => { resolveA = resolve; });
    const a = loadScriptUi("script-a", bundle("a"), { importer: async () => pendingA });
    const b = await loadScriptUi("script-b", bundle("b"), {
      importer: async () => moduleWith((context) => context.register("launcher", another)),
    });
    resolveA(moduleWith((context) => context.register("scene", def)));
    const lateA = await a;

    expect(b.ok).toBe(true);
    expect(lateA.stale).toBe(true);
    expect(getScriptRegistrySnapshot()).toMatchObject({ scriptId: "script-b", dependencyHash: "b" });
    expect(hasSlot("launcher")).toBe(true);
    expect(hasSlot("scene")).toBe(false);
  });

  it("activates an absent bundle as an empty host registry", async () => {
    registerSlot("scene", def);
    const result = await loadScriptUi("declarative-only");
    expect(result.ok).toBe(true);
    expect(getScriptRegistrySnapshot()).toMatchObject({ scriptId: "declarative-only", status: "active" });
    expect(getScriptRegistrySnapshot().slots.size).toBe(0);
  });

  it("registers one game presentation and rejects duplicate configuration", async () => {
    const presentation = { objective: () => null, suggestions: () => [] };
    const good = await loadScriptUi("script-a", bundle("presentation"), {
      importer: async () => moduleWith((context) => context.configureGame(presentation)),
    });
    expect(good.ok).toBe(true);
    expect(getScriptRegistrySnapshot().gamePresentation).toBe(presentation);

    const duplicate = await loadScriptUi("script-b", bundle("duplicate"), {
      importer: async () => moduleWith((context) => {
        context.configureGame(presentation);
        context.configureGame(presentation);
      }),
    });
    expect(duplicate.ok).toBe(false);
    expect(duplicate.error).toContain("more than once");
    expect(getScriptRegistrySnapshot().gamePresentation).toBeNull();
  });
});
