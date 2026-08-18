// Task system tests: auto-activation (giver present + conditions),
// state-driven objective progress for all seven objective types,
// completion rewards + "task" progression, time-limit failure, and
// idempotence (one transition per task per check).
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadScript } from "../loader";
import { generateWorld } from "../worldgen";
import { checkTasks } from "../tasks";
import { advanceClock } from "../time";
import type { WorldDefinition, WorldState } from "../types";
import type { Task } from "../../script/schemas/task";

const REPO_ROOT = path.resolve(__dirname, "../../..");

function emberfall(): WorldDefinition {
  return loadScript(path.join(REPO_ROOT, "scripts/emberfall"));
}

function freshState(def: WorldDefinition, seed = 42): WorldState {
  return generateWorld(def, "miner", { seed }).state;
}

describe("task auto-activation", () => {
  it("activates a task when the giver is co-located and conditions hold", () => {
    const def = emberfall();
    const state = freshState(def);
    // gather-herbs giver = shen-jiugu; condition location = forest-edge.
    // Put the player at forest-edge (shen-jiugu is at herbalist-hut by home —
    // but her schedule is not applied in a fresh world; force co-location).
    const coLocated = {
      ...state,
      player: { ...state.player, locationId: "forest-edge" },
      npcs: {
        ...state.npcs,
        "shen-jiugu": { ...state.npcs["shen-jiugu"], currentLocationId: "forest-edge" },
      },
    };
    const out = checkTasks(coLocated, def);
    const active = out.state.tasks.find(
      (t): t is Extract<typeof t, { status: "active" }> =>
        t.taskId === "gather-herbs" && t.status === "active",
    );
    expect(active).toBeDefined();
  });

  it("does not activate when the giver is absent", () => {
    const def = emberfall();
    const state = freshState(def);
    // Player at mine-entrance; shen-jiugu not present -> no activation.
    const out = checkTasks(state, def);
    expect(out.state.tasks.some((t) => t.taskId === "gather-herbs")).toBe(false);
  });
});

describe("task objective progress", () => {
  it("gather completes when the player holds the target quantity", () => {
    const def = emberfall();
    const state = freshState(def);
    const coLocated = {
      ...state,
      player: {
        ...state.player,
        locationId: "forest-edge",
        inventory: { ...state.player.inventory, stacks: [{ itemId: "herb", quantity: 3 }] },
      },
      npcs: {
        ...state.npcs,
        "shen-jiugu": { ...state.npcs["shen-jiugu"], currentLocationId: "forest-edge" },
      },
    };
    const out = checkTasks(coLocated, def);
    const completed = out.state.tasks.find(
      (t): t is Extract<typeof t, { status: "complete" }> =>
        t.taskId === "gather-herbs" && t.status === "complete",
    );
    expect(completed).toBeDefined();
    // Rewards applied: currency +15, relation +5.
    expect(out.state.player.inventory.currency).toBeGreaterThan(
      coLocated.player.inventory.currency,
    );
  });

});

describe("task time limits", () => {
  it("fails an active task past its time limit", () => {
    const def = emberfall();
    const state = freshState(def);
    // Manually inject an active gather-herbs task accepted 10 days ago
    // (time_limit 3 days).
    const withActive = {
      ...state,
      tasks: [{ taskId: "gather-herbs", status: "active" as const, acceptedDay: 1, progress: 0 }],
      clock: advanceClock(state.clock, def, 24 * 20),
    };
    const out = checkTasks(withActive, def);
    const failed = out.state.tasks.find(
      (t): t is Extract<typeof t, { status: "failed" }> =>
        t.taskId === "gather-herbs" && t.status === "failed",
    );
    expect(failed).toBeDefined();
    expect(out.completions.some((c) => c.taskId === "gather-herbs" && c.status === "fail")).toBe(true);
  });
});

describe("task idempotence", () => {
  it("does not complete a task twice", () => {
    const def = emberfall();
    const state = freshState(def);
    const coLocated = {
      ...state,
      player: {
        ...state.player,
        locationId: "forest-edge",
        inventory: { ...state.player.inventory, stacks: [{ itemId: "herb", quantity: 3 }] },
      },
      npcs: {
        ...state.npcs,
        "shen-jiugu": { ...state.npcs["shen-jiugu"], currentLocationId: "forest-edge" },
      },
    };
    const first = checkTasks(coLocated, def);
    const completed = first.state.tasks.find(
      (t): t is Extract<typeof t, { status: "complete" }> => t.taskId === "gather-herbs",
    );
    expect(completed).toBeDefined();
    // Second check on the completed state must not re-complete.
    const second = checkTasks(first.state, def);
    const completions = second.completions.filter((c) => c.taskId === "gather-herbs");
    expect(completions.filter((c) => c.status === "complete")).toHaveLength(0);
  });
});

describe("task objective completions (synthetic tasks)", () => {
  /** Injects a synthetic task into the definition's task pool. */
  function withTask(def: WorldDefinition, task: Task): WorldDefinition {
    return { ...def, tasks: new Map(def.tasks).set(task.id, task) };
  }

  /** Moves the player + the given NPCs to one location. */
  function coLocated(state: WorldState, npcIds: string[], loc: string): WorldState {
    const npcs = { ...state.npcs };
    for (const id of npcIds) npcs[id] = { ...npcs[id], currentLocationId: loc };
    return { ...state, player: { ...state.player, locationId: loc }, npcs };
  }

  const baseTask = {
    giver: { pool: ["shen-jiugu"] },
    repeatable: true,
    cooldown: 0,
    ext: {},
  };

  function task(id: string, name: string, objective: Task["objective"], rewards: Task["rewards"] = []): Task {
    return {
      ...baseTask,
      id,
      name,
      objective,
      rewards,
      narrative: { offer: "offer", complete: "complete", fail: "fail" },
    };
  }

  it("deliver completes and removes the delivered item", () => {
    const def = emberfall();
    const t = task("deliver-test", "交付测试", {
      type: "deliver",
      target: { pool: ["elara", "tonic"] },
      quantity: 1,
    });
    const state = coLocated(freshState(def), ["shen-jiugu", "elara"], "forest-edge");
    const withItem = {
      ...state,
      player: {
        ...state.player,
        inventory: { ...state.player.inventory, stacks: [{ itemId: "tonic", quantity: 1 }] },
      },
    };
    const out = checkTasks(withItem, withTask(def, t));
    const done = out.completions.find((c) => c.taskId === t.id);
    expect(done?.status).toBe("complete");
    // The delivered item is consumed on completion.
    expect(out.state.player.inventory.stacks.find((s) => s.itemId === "tonic")?.quantity ?? 0).toBe(0);
  });

  it("escort completes when the target NPC is co-located", () => {
    const def = emberfall();
    // escort-caravan: giver mayor-shen, target caravan-boss, needs town-office rep >= 20.
    const state = coLocated(freshState(def), ["mayor-shen", "caravan-boss"], "town-hall");
    const withRep = {
      ...state,
      player: { ...state.player, reputation: [{ factionId: "town-office", value: 25 }] },
    };
    const out = checkTasks(withRep, def);
    const done = out.completions.find((c) => c.taskId === "escort-caravan");
    expect(done?.status).toBe("complete");
    expect(out.state.tasks.find((t) => t.taskId === "escort-caravan")?.status).toBe("complete");
  });

  it("investigate completes when the marker is present", () => {
    const def = emberfall();
    const t = task("investigate-test", "调查测试", {
      type: "investigate",
      target: { pool: ["cond-marker"] },
      quantity: 1,
    });
    const state = coLocated(freshState(def), ["shen-jiugu"], "forest-edge");
    const withMarker = {
      ...state,
      player: { ...state.player, flags: [...state.player.flags, "cond-marker"] },
    };
    const out = checkTasks(withMarker, withTask(def, t));
    expect(out.completions.some((c) => c.taskId === t.id && c.status === "complete")).toBe(true);
  });

  it("hunt completes when a defeated:<npc> fact exists", () => {
    const def = emberfall();
    const t = task("hunt-test", "猎杀测试", {
      type: "hunt",
      target: { pool: ["caravan-boss"] },
      quantity: 1,
    });
    const state = coLocated(freshState(def), ["shen-jiugu"], "forest-edge");
    // No defeated fact -> not complete (but the task activates).
    const notDone = checkTasks(state, withTask(def, t));
    expect(notDone.completions.some((c) => c.taskId === t.id && c.status === "complete")).toBe(false);
    // With the defeated fact -> complete (task already active).
    const withFact = { ...notDone.state, facts: [...notDone.state.facts, "defeated:caravan-boss"] };
    const done = checkTasks(withFact, withTask(def, t));
    expect(done.completions.some((c) => c.taskId === t.id && c.status === "complete")).toBe(true);
  });

  it("travel completes when the player is at the target location", () => {
    const def = emberfall();
    const t = task("travel-test", "旅行测试", {
      type: "travel",
      target: { pool: ["tavern"] },
      quantity: 1,
    });
    const state = coLocated(freshState(def), ["shen-jiugu"], "forest-edge");
    // Wrong location -> not complete (but the task activates).
    const notDone = checkTasks(state, withTask(def, t));
    expect(notDone.completions.some((c) => c.taskId === t.id && c.status === "complete")).toBe(false);
    // At the target location -> complete (task already active).
    const atTarget = { ...notDone.state, player: { ...notDone.state.player, locationId: "tavern" } };
    const done = checkTasks(atTarget, withTask(def, t));
    expect(done.completions.some((c) => c.taskId === t.id && c.status === "complete")).toBe(true);
  });


  it("persuade completes when the relation meets the threshold", () => {
    const def = emberfall();
    const t = task("persuade-test", "说服测试", {
      type: "persuade",
      target: { pool: ["elara"] },
      quantity: 50,
    });
    // giver = shen-jiugu must be co-located; the persuade target elara's
    // relation is read from the player's relation list (player -> elara).
    const state = coLocated(freshState(def), ["shen-jiugu", "elara"], "forest-edge");
    const withRel = {
      ...state,
      player: {
        ...state.player,
        relations: [{ npcId: "elara", value: 60, stance: "friendly", type: "friend" }],
      },
    };
    const out = checkTasks(withRel, withTask(def, t));
    expect(out.completions.some((c) => c.taskId === t.id && c.status === "complete")).toBe(true);
  });

  it("applies rewards effects and task-source progression on completion", () => {
    const def = emberfall();
    const t = task(
      "reward-test",
      "奖励测试",
      { type: "gather", target: { pool: ["herb"] }, quantity: 1 },
      [
        { kind: "currency", direction: "add", target: "player", value: 7 },
        { kind: "stat", direction: "add", target: "player", stat: "strength", value: 1 },
      ],
    );
    const state = coLocated(freshState(def), ["shen-jiugu"], "forest-edge");
    const ready = {
      ...state,
      player: {
        ...state.player,
        inventory: { ...state.player.inventory, stacks: [{ itemId: "herb", quantity: 1 }] },
        skills: { ...state.player.skills, crafting: 3 },
      },
    };
    const before = ready.player.inventory.currency;
    const out = checkTasks(ready, withTask(def, t));
    const done = out.completions.find((c) => c.taskId === t.id && c.status === "complete");
    expect(done).toBeDefined();
    expect(done?.narrative).toBe("complete");
    // Rewards applied: currency +7 and strength +1.
    expect(out.state.player.inventory.currency).toBe(before + 7);
    expect(out.state.player.stats.strength).toBe(ready.player.stats.strength + 1);
    // Task-source progression: crafting skill grows by 1 (mechanics.yaml).
    expect(out.state.player.skills.crafting).toBe(4);
  });
});
