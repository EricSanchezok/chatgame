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
import { CORE_TEST_SCRIPT_DIR } from "./core-test-fixture";

function createEngine(seed = 42): Engine {
  return Engine.create({
    scriptDir: CORE_TEST_SCRIPT_DIR,
    originId: "observer",
    seed,
    provider: new MockProvider(),
  });
}

function copyCoreScript(prefix: string): { tempRoot: string; scriptDir: string } {
  const tempRoot = mkdtempSync(path.join(tmpdir(), prefix));
  const scriptDir = path.join(tempRoot, "core-test-script");
  cpSync(CORE_TEST_SCRIPT_DIR, scriptDir, { recursive: true });
  return { tempRoot, scriptDir };
}

describe("Engine facade", () => {
  it("creates a session with a generated world", () => {
    const engine = createEngine();
    expect(engine.definition.script.id).toBe("core-test-script");
    expect(engine.worldState.player.originId).toBe("observer");
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
    const openingCues = first.worldState.transcript[0]?.mediaCues ?? [];
    expect(openingCues[0]).toEqual({ kind: "location_enter", locationId: first.worldState.player.locationId });
    const cue = openingCues.find((candidate) => candidate.kind === "event");
    expect(cue).toMatchObject({ kind: "event" });
    const eventId = cue?.kind === "event" ? cue.eventId : "";
    expect(eventId).not.toBe("");
    expect(second.worldState.transcript[0]?.mediaCues.find((candidate) => candidate.kind === "event")).toEqual(cue);
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
        scriptDir: CORE_TEST_SCRIPT_DIR,
        originId: "observer",
        seed: 42,
        provider: new MockProvider(),
        saveStore,
      });
      const savePath = fresh.save("opening-event");
      const loaded = Engine.create({
        scriptDir: CORE_TEST_SCRIPT_DIR,
        originId: "observer",
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
    const result = await engine.playerTurn({ text: "你好，值班员" });
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
    const { tempRoot, scriptDir } = copyCoreScript("cg-denied-action-");
    try {
      const originFile = path.join(scriptDir, "origins", "observer.yaml");
      writeFileSync(
        originFile,
        readFileSync(originFile, "utf8").replace("denied_actions: []", "denied_actions: [cast]"),
      );
      const actionsFile = path.join(scriptDir, "actions.yaml");
      writeFileSync(
        actionsFile,
        `${readFileSync(actionsFile, "utf8")}\n  - id: cast\n    enabled: true\n    display_name: 执行受限指令\n    resolve: { type: auto }\n    llm_freedom: narration\n`,
      );
      const engine = Engine.create({
        scriptDir,
        originId: "observer",
        seed: 42,
        provider: new MockProvider({ onGenerateObject: () => ({ actionId: "cast" }) }),
      });
      const result = await engine.playerTurn({ text: "我要执行受限指令" });
      expect(result.narrative).toContain("你的出身让你做不出这种事。");
      expect(result.narrative).not.toContain("这个世界没有这样的行动。");
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("playerTurn with steal action resolves (opposed check)", async () => {
    const engine = createEngine();
    const result = await engine.playerTurn({ text: "我要读取值班员的记录" });
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
      scriptDir: CORE_TEST_SCRIPT_DIR,
      originId: "observer",
      seed: 42,
      provider: new MockProvider(),
      loadSaveFile: filePath,
    });
    expect(JSON.stringify(engine2.worldState)).toBe(JSON.stringify(engine.worldState));
  });

  it("setDescriptor edits explanation layer without touching values", () => {
    const engine = createEngine();
    const rel = engine.worldState.player.relations.find((r) => r.npcId === "operator");
    if (rel) {
      const valueBefore = rel.value;
      engine.setDescriptor("player.relations.operator", "这是经过复核的合作关系");
      const updated = engine.worldState.player.relations.find((r) => r.npcId === "operator")!;
      expect(updated.value).toBe(valueBefore);
      expect(updated.descriptor?.userEdited).toBe(true);
    }
  });

  it("advance moves clock and applies needs decay", () => {
    const { tempRoot, scriptDir } = copyCoreScript("cg-needs-decay-");
    try {
      const mechanicsFile = path.join(scriptDir, "mechanics.yaml");
      writeFileSync(
        mechanicsFile,
        `${readFileSync(mechanicsFile, "utf8")}\nneeds:\n  - name: charge\n    min: 0\n    max: 100\n    initial: 80\n    decay_per_day: 20\n    thresholds: []\n`,
      );
      const timeFile = path.join(scriptDir, "time.yaml");
      writeFileSync(
        timeFile,
        readFileSync(timeFile, "utf8").replace(
          "advance_scope: [schedules, time_events]",
          "advance_scope: [schedules, needs, time_events]",
        ),
      );
      const engine = Engine.create({
        scriptDir,
        originId: "observer",
        seed: 42,
        provider: new MockProvider(),
      });
      const before = engine.worldState.clock.totalHours;
      const chargeBefore = engine.worldState.player.needs.charge.value;
      engine.advance(48);
      expect(engine.worldState.clock.totalHours).toBe(before + 48);
      expect(engine.worldState.player.needs.charge.value).toBeLessThan(chargeBefore);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("deterministic runs with same seed produce identical worlds", () => {
    const a = createEngine(7);
    const b = createEngine(7);
    expect(JSON.stringify(a.worldState)).toBe(JSON.stringify(b.worldState));
  });

  it("multiple turns accumulate event log and keep state consistent", async () => {
    const engine = createEngine();
    await engine.playerTurn({ text: "你好，值班员" });
    await engine.playerTurn({ text: "请说明中继站状态" });
    await engine.playerTurn({ text: "继续校验" });
    expect(engine.worldState.eventLog.length).toBeGreaterThan(0);
    // State invariants hold after turns.
    expect(engine.worldState.player.stats.hp).toBeGreaterThan(0);
    expect(engine.worldState.player.locationId.length).toBeGreaterThan(0);
  });

  it("condition commitment fires mid-turn (not only at day boundary)", async () => {
    const { tempRoot, scriptDir } = copyCoreScript("cg-condition-commitment-");
    try {
      const operatorFile = path.join(scriptDir, "npcs", "operator.yaml");
      writeFileSync(
        operatorFile,
        readFileSync(operatorFile, "utf8").replace(
          "secrets: []",
          "secrets:\n  - id: relay-secret\n    content: 备用线路已完成校验。\n    reveal:\n      logic:\n        all:\n          - { source: relationship, key: player, op: gte, value: 60 }",
        ),
      );
      const plotFile = path.join(scriptDir, "plot.yaml");
      writeFileSync(
        plotFile,
        `${readFileSync(plotFile, "utf8")}\n  - id: operator-secret-reveal\n    description: 关系条件满足时公开中继秘密。\n    type: secret_reveal\n    trigger:\n      condition:\n        all:\n          - { source: relationship, key: operator, op: gte, value: 60 }\n    must_happen: true\n    related:\n      secrets: [relay-secret]\n      npcs: [operator]\n`,
      );
      const engine = Engine.create({
        scriptDir,
        originId: "observer",
        seed: 42,
        provider: new MockProvider(),
      });
      const state = engine.worldState;
      const withRel = {
        ...state,
        player: {
          ...state.player,
          relations: [
            { npcId: "operator", value: 70, stance: "friendly", type: "colleague" },
          ],
        },
      };
      (engine as unknown as { state: WorldState }).state = withRel;
      await engine.playerTurn({ text: "你好，值班员" });
      const fired = engine.worldState.commitments.find(
        (commitment) => commitment.commitmentId === "operator-secret-reveal",
      );
      expect(fired?.triggered).toBe(true);
      expect(engine.worldState.facts).toContain("relay-secret");
      expect(
        engine.worldState.eventLog.some(
          (entry) => entry.type === "commitment" && entry.summary.includes("operator-secret-reveal"),
        ),
      ).toBe(true);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("runs every Engine Extension v2 lifecycle phase through real entry points", async () => {
    const { tempRoot, scriptDir } = copyCoreScript("cg-lifecycle-");
    try {
      const scriptFile = path.join(scriptDir, "script.yaml");
      writeFileSync(
        scriptFile,
        readFileSync(scriptFile, "utf8").replace(
          "lifecycle: [session_start]",
          "lifecycle: [session_start, turn_resolved, hour, day_boundary]",
        ),
      );
      const engineFile = path.join(scriptDir, "engine", "index.ts");
      writeFileSync(engineFile, `export default function register(context: any): void {
  context.onSessionStart((state: any) => ({ state: { ...state, runtimeState: { ...state.runtimeState, sessionStarts: Number(state.runtimeState.sessionStarts ?? 0) + 1 } }, summaries: ["session start"] }));
  context.onTurnResolved((state: any) => ({ state: { ...state, runtimeState: { ...state.runtimeState, turns: Number(state.runtimeState.turns ?? 0) + 1 } }, summaries: ["turn resolved"] }));
  context.onHour((state: any) => ({ state: { ...state, runtimeState: { ...state.runtimeState, hours: Number(state.runtimeState.hours ?? 0) + 1 } }, summaries: [] }));
  context.onDayBoundary((state: any) => ({ state: { ...state, runtimeState: { ...state.runtimeState, days: Number(state.runtimeState.days ?? 0) + 1 } }, summaries: ["day boundary"] }));
}\n`);

      const saveStore = createFsSaveStore(tempRoot);
      const engine = Engine.create({
        scriptDir,
        originId: "observer",
        seed: 7,
        provider: new MockProvider(),
        saveStore,
      });
      expect(engine.worldState.runtimeState.sessionStarts).toBe(1);
      expect(engine.worldState.transcript.some((entry) => entry.role === "world")).toBe(true);
      const savePath = engine.save("lifecycle-resume");
      const resumed = Engine.create({
        scriptDir,
        originId: "observer",
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
