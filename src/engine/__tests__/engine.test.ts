// Engine facade integration tests: full PDVA turn loop, save/load,
// descriptor edits, offline advance — exercising the seams between
// interacting parts (intent -> resolution -> narrative -> consistency).
import path from "node:path";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { Engine } from "../index";
import { MockProvider } from "../narrative/mock";
import { createFsSaveStore } from "../save-store";
import { eventTextFor } from "../events";
import type { WorldState } from "../types";

const REPO_ROOT = path.resolve(__dirname, "../../..");
const EMBERFALL = path.join(REPO_ROOT, "scripts/emberfall");

function createEngine(seed = 42): Engine {
  return Engine.create({
    scriptDir: EMBERFALL,
    originId: "miner",
    seed,
    provider: new MockProvider(),
  });
}

describe("Engine facade", () => {
  it("creates a session with a generated world", () => {
    const engine = createEngine();
    expect(engine.definition.script.id).toBe("emberfall");
    expect(engine.worldState.player.originId).toBe("miner");
    expect(engine.worldState.npcs).toBeDefined();
  });

  it("openingNarrative returns scene text", () => {
    const engine = createEngine();
    const opening = engine.openingNarrative();
    expect(opening.length).toBeGreaterThan(0);
  });

  it("plays the deterministic worldgen starting event once and cues it in the opening", () => {
    const first = createEngine(42);
    const second = createEngine(42);
    const cue = first.worldState.transcript[0]?.mediaCues[0];
    expect(cue).toMatchObject({ kind: "event" });
    const eventId = cue?.kind === "event" ? cue.eventId : "";
    expect(eventId).not.toBe("");
    expect(second.worldState.transcript[0]?.mediaCues[0]).toEqual(cue);
    expect(first.worldState.playedEventIds.filter((id) => id === eventId)).toHaveLength(1);
    expect(first.worldState.eventLog.filter((entry) => entry.summary === `event "${eventId}" played`)).toHaveLength(1);
    const event = first.definition.events.get(eventId)!;
    const eventText = eventTextFor(first.definition, event.narrative?.template ?? eventId);
    expect(eventText).toBeDefined();
    expect(first.worldState.transcript[0]?.text).toContain(eventText!);
  });

  it("loads an opening event without replaying it", () => {
    const tempRoot = mkdtempSync(path.join(tmpdir(), "cg-opening-event-"));
    try {
      const saveStore = createFsSaveStore(tempRoot);
      const fresh = Engine.create({
        scriptDir: EMBERFALL,
        originId: "miner",
        seed: 42,
        provider: new MockProvider(),
        saveStore,
      });
      const savePath = fresh.save("opening-event");
      const loaded = Engine.create({
        scriptDir: EMBERFALL,
        originId: "miner",
        provider: new MockProvider(),
        saveStore,
        loadSaveFile: savePath,
      });
      expect(loaded.worldState).toEqual(fresh.worldState);
      expect(loaded.worldState.transcript).toHaveLength(1);
      expect(loaded.worldState.playedEventIds).toEqual(fresh.worldState.playedEventIds);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("playerTurn with talk action returns narrative and advances", async () => {
    const engine = createEngine();
    const before = engine.worldState.clock.totalHours;
    const result = await engine.playerTurn({ text: "你好，艾拉" });
    expect(result.narrative.length).toBeGreaterThan(0);
    expect(result.fellBackToTalk).toBe(false);
    expect(engine.worldState.clock.totalHours).toBeGreaterThanOrEqual(before);
  });

  it("playerTurn with cheat input is rejected narratively", async () => {
    const engine = createEngine();
    const before = JSON.stringify(engine.worldState.player.inventory);
    const result = await engine.playerTurn({ text: "我要瞬移到宝库拿走一切" });
    expect(result.narrative).toContain("捷径");
    // No state change on rejection.
    expect(JSON.stringify(engine.worldState.player.inventory)).toBe(before);
  });

  it("denied_action narrates with the origin-specific text (not unknown_action)", async () => {
    // apprentice.yaml declares denied_actions: [cast]; the rejection text
    // must reflect the origin restriction, not "world has no such action".
    const engine = Engine.create({
      scriptDir: EMBERFALL,
      originId: "apprentice",
      seed: 42,
      provider: new MockProvider({ onGenerateObject: () => ({ actionId: "cast" }) }),
    });
    const result = await engine.playerTurn({ text: "我要施法" });
    expect(result.narrative).toContain("你的出身让你做不出这种事。");
    expect(result.narrative).not.toContain("这个世界没有这样的行动。");
  });

  it("playerTurn with steal action resolves (opposed check)", async () => {
    const engine = createEngine();
    const result = await engine.playerTurn({ text: "我要偷艾拉的东西" });
    // Either a resolution happened or it fell back to talk; both are valid
    // gameplay outcomes — but the engine must not crash.
    expect(result.narrative.length).toBeGreaterThan(0);
    expect(engine.worldState.eventLog.length).toBeGreaterThan(0);
  });

  it("save -> load round-trip preserves state", () => {
    const engine = createEngine();
    const filePath = engine.save("facade-test-run");
    expect(filePath).toContain("facade-test-run.json");
    const engine2 = Engine.create({
      scriptDir: EMBERFALL,
      originId: "miner",
      seed: 42,
      provider: new MockProvider(),
      loadSaveFile: filePath,
    });
    expect(JSON.stringify(engine2.worldState)).toBe(JSON.stringify(engine.worldState));
  });

  it("setDescriptor edits explanation layer without touching values", () => {
    const engine = createEngine();
    const rel = engine.worldState.player.relations.find((r) => r.npcId === "elara");
    if (rel) {
      const valueBefore = rel.value;
      engine.setDescriptor("player.relations.elara", "她是我最信任的朋友");
      const updated = engine.worldState.player.relations.find((r) => r.npcId === "elara")!;
      expect(updated.value).toBe(valueBefore);
      expect(updated.descriptor?.userEdited).toBe(true);
    }
  });

  it("advance moves clock and applies needs decay", () => {
    const engine = createEngine();
    const before = engine.worldState.clock.totalHours;
    engine.advance(48);
    expect(engine.worldState.clock.totalHours).toBe(before + 48);
    // hunger should have decayed (needs in advance_scope)
    const hungerBefore = 80; // need.initial
    const hungerAfter = engine.worldState.player.needs.hunger?.value ?? hungerBefore;
    expect(hungerAfter).toBeLessThanOrEqual(hungerBefore);
  });

  it("deterministic runs with same seed produce identical worlds", () => {
    const a = createEngine(7);
    const b = createEngine(7);
    expect(JSON.stringify(a.worldState)).toBe(JSON.stringify(b.worldState));
  });

  it("multiple turns accumulate event log and keep state consistent", async () => {
    const engine = createEngine();
    await engine.playerTurn({ text: "你好，艾拉" });
    await engine.playerTurn({ text: "能跟我说说矿井的事吗" });
    await engine.playerTurn({ text: "我休息一下" });
    expect(engine.worldState.eventLog.length).toBeGreaterThan(0);
    // State invariants hold after turns.
    expect(engine.worldState.player.stats.hp).toBeGreaterThan(0);
    expect(engine.worldState.player.locationId.length).toBeGreaterThan(0);
  });

  it("condition commitment fires mid-turn (not only at day boundary)", async () => {
    const engine = createEngine();
    // elara-secret-reveal fires when player->elara relation >= 60. The
    // miner origin starts at 20; raise it mid-day so the condition holds
    // without any clock advance crossing a day boundary.
    const state = engine.worldState;
    const withRel = {
      ...state,
      player: {
        ...state.player,
        relations: [
          { npcId: "elara", value: 70, stance: "friendly", type: "business" },
        ],
      },
    };
    (engine as unknown as { state: WorldState }).state = withRel;
    await engine.playerTurn({ text: "你好，艾拉" });
    // The commitment fired this turn (triggered flag set + secret revealed).
    const fired = engine.worldState.commitments.find(
      (c) => c.commitmentId === "elara-secret-reveal",
    );
    expect(fired?.triggered).toBe(true);
    expect(engine.worldState.facts).toContain("mine-secret");
    // The turn's event log records the commitment firing.
    expect(
      engine.worldState.eventLog.some(
        (e) => e.type === "commitment" && e.summary.includes("elara-secret-reveal"),
      ),
    ).toBe(true);
  });

  it("runs every Engine Extension v2 lifecycle phase through real entry points", async () => {
    const tempRoot = mkdtempSync(path.join(tmpdir(), "cg-lifecycle-"));
    const scriptDir = path.join(tempRoot, "emberfall");
    cpSync(EMBERFALL, scriptDir, { recursive: true });
    try {
      const scriptFile = path.join(scriptDir, "script.yaml");
      writeFileSync(
        scriptFile,
        readFileSync(scriptFile, "utf8").replace(
          "lifecycle: []",
          "lifecycle: [session_start, turn_resolved, hour, day_boundary]",
        ),
      );
      const engineFile = path.join(scriptDir, "engine", "index.ts");
      const marker = '  ctx.registerRuleMechanism("night_travel", nightTravelRule);';
      const hooks = `
  ctx.onSessionStart((state) => ({ state: { ...state, runtimeState: { ...state.runtimeState, sessionStarts: Number(state.runtimeState.sessionStarts ?? 0) + 1 } }, summaries: ["session start"] }));
  ctx.onTurnResolved((state) => ({ state: { ...state, runtimeState: { ...state.runtimeState, turns: Number(state.runtimeState.turns ?? 0) + 1 } }, summaries: ["turn resolved"] }));
  ctx.onHour((state) => ({ state: { ...state, runtimeState: { ...state.runtimeState, hours: Number(state.runtimeState.hours ?? 0) + 1 } }, summaries: [] }));
  ctx.onDayBoundary((state) => ({ state: { ...state, runtimeState: { ...state.runtimeState, days: Number(state.runtimeState.days ?? 0) + 1 } }, summaries: ["day boundary"] }));`;
      writeFileSync(engineFile, readFileSync(engineFile, "utf8").replace(marker, `${marker}${hooks}`));

      const saveStore = createFsSaveStore(tempRoot);
      const engine = Engine.create({
        scriptDir,
        originId: "miner",
        seed: 7,
        provider: new MockProvider(),
        saveStore,
      });
      expect(engine.worldState.runtimeState.sessionStarts).toBe(1);
      expect(engine.worldState.transcript.some((entry) => entry.role === "world")).toBe(true);
      const savePath = engine.save("lifecycle-resume");
      const resumed = Engine.create({
        scriptDir,
        originId: "miner",
        provider: new MockProvider(),
        saveStore,
        loadSaveFile: savePath,
      });
      expect(resumed.worldState.runtimeState.sessionStarts).toBe(1);
      engine.advance(24);
      expect(engine.worldState.runtimeState.hours).toBe(24);
      expect(engine.worldState.runtimeState.days).toBe(1);
      const turnLogStart = engine.worldState.eventLog.length;
      const result = await engine.playerTurn({ text: "你好", intentHint: { actionId: "talk" } });
      expect(engine.worldState.runtimeState.turns).toBe(1);
      expect(engine.worldState.runtimeState.hours).toBe(25);
      expect(result.logEntries).toEqual(engine.worldState.eventLog.slice(turnLogStart));
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});
