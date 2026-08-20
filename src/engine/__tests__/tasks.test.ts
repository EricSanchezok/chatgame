// Task system tests: auto-activation (giver present + conditions),
// state-driven objective progress for all seven objective types,
// completion rewards + "task" progression, time-limit failure, and
// idempotence (one transition per task per check).
import { describe, expect, it } from "vitest";
import { generateWorld } from "../worldgen";
import { checkTasks } from "../tasks";
import { advanceClock } from "../time";
import type { WorldDefinition, WorldState } from "../types";
import type { Task } from "../../script/schemas/task";
import { loadCoreTestDefinition } from "./core-test-fixture";

const GATHER_TASK: Task = {
  id: "gather-components",
  name: "收集校准组件",
  objective: { type: "gather", target: { items: ["component"] }, quantity: 3 },
  giver: { pool: ["operator"] },
  conditions: { all: [{ source: "location", key: "current", op: "eq", value: "relay-room" }] },
  rewards: [{ kind: "currency", direction: "add", target: "player", value: 15 }],
  repeatable: false,
  time_limit: { days: 3 },
  narrative: { offer: "offer", complete: "complete", fail: "fail" },
  ext: {},
};

function taskDefinition(tasks: Task[] = [GATHER_TASK]): WorldDefinition {
  const base = loadCoreTestDefinition();
  return {
    ...base,
    tasks: new Map(tasks.map((task) => [task.id, task])),
    mechanics: {
      ...base.mechanics,
      progression: [
        ...(base.mechanics.progression ?? []),
        { source: "task", target: "focus", amount: 1, cap: 10 },
      ],
    },
  };
}

function freshState(def: WorldDefinition, seed = 42): WorldState {
  return generateWorld(def, "observer", { seed }).state;
}

describe("task auto-activation", () => {
  it("activates a task when the giver is co-located and conditions hold", () => {
    const def = taskDefinition();
    const state = freshState(def);
    // The test task requires the operator to be present in the relay room.
    const coLocated = {
      ...state,
      player: { ...state.player, locationId: "relay-room" },
      npcs: {
        ...state.npcs,
        operator: { ...state.npcs.operator, currentLocationId: "relay-room" },
      },
    };
    const out = checkTasks(coLocated, def);
    const active = out.state.tasks.find(
      (t): t is Extract<typeof t, { status: "active" }> =>
        t.taskId === GATHER_TASK.id && t.status === "active",
    );
    expect(active).toBeDefined();
  });

  it("does not activate when the giver is absent", () => {
    const def = taskDefinition();
    const state = freshState(def);
    const giverAbsent = {
      ...state,
      npcs: { ...state.npcs, operator: { ...state.npcs.operator, currentLocationId: "service-corridor" } },
    };
    const out = checkTasks(giverAbsent, def);
    expect(out.state.tasks.some((task) => task.taskId === GATHER_TASK.id)).toBe(false);
  });
});

describe("task objective progress", () => {
  it("gather completes when the player holds the target quantity", () => {
    const def = taskDefinition();
    const state = freshState(def);
    const coLocated = {
      ...state,
      player: {
        ...state.player,
        locationId: "relay-room",
        inventory: { ...state.player.inventory, stacks: [{ itemId: "component", quantity: 3 }] },
      },
      npcs: {
        ...state.npcs,
        operator: { ...state.npcs.operator, currentLocationId: "relay-room" },
      },
    };
    const out = checkTasks(coLocated, def);
    const completed = out.state.tasks.find(
      (t): t is Extract<typeof t, { status: "complete" }> =>
        t.taskId === GATHER_TASK.id && t.status === "complete",
    );
    expect(completed).toBeDefined();
    // Rewards applied: currency +15, relation +5.
    expect(out.state.player.inventory.currency).toBeGreaterThan(
      coLocated.player.inventory.currency,
    );
    expect(out.logEntries.map((entry) => entry.id)).toEqual(["log-1", "log-2"]);
    expect(out.state.eventLog).toEqual(out.logEntries);
    expect(out.logEntries.map((entry) => entry.summary)).toEqual([
      `task "${GATHER_TASK.id}" activated`,
      `task "${GATHER_TASK.id}" completed`,
    ]);
  });

});

describe("task time limits", () => {
  it("keeps the exact deadline day playable and fails the following day", () => {
    const def = taskDefinition();
    const state = freshState(def);
    const active = {
      ...state,
      tasks: [{
        taskId: GATHER_TASK.id,
        status: "active" as const,
        acceptedDay: 1,
        acceptedEventCount: 0,
        progress: 0,
      }],
      clock: advanceClock(state.clock, def, 24 * 4),
    };
    const atDeadline = checkTasks(active, def);
    expect(atDeadline.state.tasks.find((task) => task.taskId === GATHER_TASK.id)?.status).toBe("active");
    const afterDeadline = checkTasks({
      ...atDeadline.state,
      clock: advanceClock(atDeadline.state.clock, def, 24),
    }, def);
    expect(afterDeadline.state.tasks.find((task) => task.taskId === GATHER_TASK.id)?.status).toBe("failed");
    expect(afterDeadline.state.eventLog.at(-1)?.summary).toContain("failed (time limit)");
  });

  it("fails an active task past its time limit", () => {
    const def = taskDefinition();
    const state = freshState(def);
    // Manually inject an active task accepted well before its three-day limit.
    const withActive = {
      ...state,
      tasks: [{
        taskId: GATHER_TASK.id,
        status: "active" as const,
        acceptedDay: 1,
        acceptedEventCount: 0,
        progress: 0,
      }],
      clock: advanceClock(state.clock, def, 24 * 20),
    };
    const out = checkTasks(withActive, def);
    const failed = out.state.tasks.find(
      (t): t is Extract<typeof t, { status: "failed" }> =>
        t.taskId === GATHER_TASK.id && t.status === "failed",
    );
    expect(failed).toBeDefined();
    expect(out.completions.some((completion) => completion.taskId === GATHER_TASK.id && completion.status === "fail")).toBe(true);
  });
});

describe("task idempotence", () => {
  it("does not complete a task twice", () => {
    const def = taskDefinition();
    const state = freshState(def);
    const coLocated = {
      ...state,
      player: {
        ...state.player,
        locationId: "relay-room",
        inventory: { ...state.player.inventory, stacks: [{ itemId: "component", quantity: 3 }] },
      },
      npcs: {
        ...state.npcs,
        operator: { ...state.npcs.operator, currentLocationId: "relay-room" },
      },
    };
    const first = checkTasks(coLocated, def);
    const completed = first.state.tasks.find(
      (task): task is Extract<typeof task, { status: "complete" }> => task.taskId === GATHER_TASK.id,
    );
    expect(completed).toBeDefined();
    // Second check on the completed state must not re-complete.
    const second = checkTasks(first.state, def);
    const completions = second.completions.filter((completion) => completion.taskId === GATHER_TASK.id);
    expect(completions.filter((c) => c.status === "complete")).toHaveLength(0);
  });
});

describe("task objective completions (synthetic tasks)", () => {
  /** Injects a synthetic task into the definition's task pool. */
  function withTask(def: WorldDefinition, task: Task): WorldDefinition {
    return { ...def, tasks: new Map([[task.id, task]]) };
  }

  /** Moves the player + the given NPCs to one location. */
  function coLocated(state: WorldState, npcIds: string[], loc: string): WorldState {
    const npcs = { ...state.npcs };
    for (const id of npcIds) npcs[id] = { ...npcs[id], currentLocationId: loc };
    return { ...state, player: { ...state.player, locationId: loc }, npcs };
  }

  const baseTask = {
    giver: { pool: ["operator"] },
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
    const def = taskDefinition([]);
    const t = task("deliver-test", "交付测试", {
      type: "deliver",
      target: { recipient: "operator", item: "component" },
      quantity: 1,
    });
    const state = coLocated(freshState(def), ["operator"], "relay-room");
    const withItem = {
      ...state,
      player: {
        ...state.player,
        inventory: { ...state.player.inventory, stacks: [{ itemId: "component", quantity: 1 }] },
      },
    };
    const out = checkTasks(withItem, withTask(def, t));
    const done = out.completions.find((c) => c.taskId === t.id);
    expect(done?.status).toBe("complete");
    // The delivered item is consumed on completion.
    expect(out.state.player.inventory.stacks.find((stack) => stack.itemId === "component")?.quantity ?? 0).toBe(0);
  });

  it("escort completes when the target NPC is co-located", () => {
    const def = taskDefinition([]);
    const escort = task("escort-test", "护送测试", {
      type: "escort",
      target: { npc: "operator", destination: "service-corridor" },
      quantity: 1,
    });
    const state = coLocated(freshState(def), ["operator"], "service-corridor");
    const definition = withTask(def, escort);
    const out = checkTasks(state, definition);
    const done = out.completions.find((completion) => completion.taskId === escort.id);
    expect(done?.status).toBe("complete");
    expect(out.state.tasks.find((entry) => entry.taskId === escort.id)?.status).toBe("complete");
  });

  it("investigate completes when the marker is present", () => {
    const def = taskDefinition([]);
    const t = task("investigate-test", "调查测试", {
      type: "investigate",
      target: { marker: { source: "flag", key: "cond-marker" } },
      quantity: 1,
    });
    const state = coLocated(freshState(def), ["operator"], "relay-room");
    const withMarker = {
      ...state,
      player: { ...state.player, flags: [...state.player.flags, "cond-marker"] },
    };
    const out = checkTasks(withMarker, withTask(def, t));
    expect(out.completions.some((c) => c.taskId === t.id && c.status === "complete")).toBe(true);
  });

  it("investigate reads the declared fact marker source", () => {
    const def = taskDefinition([]);
    const t = task("investigate-fact", "事实调查", {
      type: "investigate",
      target: { marker: { source: "fact", key: "collapse-evidence" } },
      quantity: 1,
    });
    const state = coLocated(freshState(def), ["operator"], "relay-room");
    const out = checkTasks({ ...state, facts: [...state.facts, "collapse-evidence"] }, withTask(def, t));
    expect(out.completions.some((entry) => entry.taskId === t.id && entry.status === "complete")).toBe(true);
  });

  it("counts any-action objectives only after the task was accepted", () => {
    const def = taskDefinition([]);
    const t = task("investigate-any", "任意调查", {
      type: "investigate",
      target: { any: true },
      quantity: 1,
    });
    const state = coLocated(freshState(def), ["operator"], "relay-room");
    const beforeAcceptance = {
      ...state,
      eventLog: [{
        id: "log-1",
        day: 0,
        hour: 9,
        type: "resolution" as const,
        actor: "player",
        summary: "old investigate",
        detail: { actionId: "investigate" },
      }],
    };

    const activated = checkTasks(beforeAcceptance, withTask(def, t));
    expect(activated.completions.some((entry) => entry.taskId === t.id)).toBe(false);
    const active = activated.state.tasks.find((entry) => entry.taskId === t.id);
    expect(active?.status).toBe("active");
    expect(active?.status === "active" ? active.acceptedEventCount : -1).toBe(activated.state.eventLog.length);

    const afterAcceptance = {
      ...activated.state,
      eventLog: [...activated.state.eventLog, {
        id: `log-${activated.state.eventLog.length + 1}`,
        day: 0,
        hour: 10,
        type: "resolution" as const,
        actor: "player",
        summary: "new investigate",
        detail: { actionId: "investigate" },
      }],
    };
    const completed = checkTasks(afterAcceptance, withTask(def, t));
    expect(completed.completions.some((entry) => entry.taskId === t.id)).toBe(true);
  });

  it("hunt completes when a defeated:<npc> fact exists", () => {
    const def = taskDefinition([]);
    const t = task("hunt-test", "猎杀测试", {
      type: "hunt",
      target: { npc: "operator" },
      quantity: 1,
    });
    const state = coLocated(freshState(def), ["operator"], "relay-room");
    // No defeated fact -> not complete (but the task activates).
    const notDone = checkTasks(state, withTask(def, t));
    expect(notDone.completions.some((c) => c.taskId === t.id && c.status === "complete")).toBe(false);
    // With the defeated fact -> complete (task already active).
    const withFact = { ...notDone.state, facts: [...notDone.state.facts, "defeated:operator"] };
    const done = checkTasks(withFact, withTask(def, t));
    expect(done.completions.some((c) => c.taskId === t.id && c.status === "complete")).toBe(true);
  });

  it("travel completes when the player is at the target location", () => {
    const def = taskDefinition([]);
    const t = task("travel-test", "旅行测试", {
      type: "travel",
      target: { location: "service-corridor" },
      quantity: 1,
    });
    const state = coLocated(freshState(def), ["operator"], "relay-room");
    // Wrong location -> not complete (but the task activates).
    const notDone = checkTasks(state, withTask(def, t));
    expect(notDone.completions.some((c) => c.taskId === t.id && c.status === "complete")).toBe(false);
    // At the target location -> complete (task already active).
    const atTarget = { ...notDone.state, player: { ...notDone.state.player, locationId: "service-corridor" } };
    const done = checkTasks(atTarget, withTask(def, t));
    expect(done.completions.some((c) => c.taskId === t.id && c.status === "complete")).toBe(true);
  });


  it("persuade completes when the relation meets the threshold", () => {
    const def = taskDefinition([]);
    const t = task("persuade-test", "说服测试", {
      type: "persuade",
      target: { npc: "operator" },
      quantity: 50,
    });
    const state = coLocated(freshState(def), ["operator"], "relay-room");
    const withRel = {
      ...state,
      player: {
        ...state.player,
        relations: [{ npcId: "operator", value: 60, stance: "friendly", type: "colleague" }],
      },
    };
    const out = checkTasks(withRel, withTask(def, t));
    expect(out.completions.some((c) => c.taskId === t.id && c.status === "complete")).toBe(true);
  });

  it("applies rewards effects and task-source progression on completion", () => {
    const def = taskDefinition([]);
    const t = task(
      "reward-test",
      "奖励测试",
      { type: "gather", target: { items: ["component"] }, quantity: 1 },
      [
        { kind: "currency", direction: "add", target: "player", value: 7 },
        { kind: "stat", direction: "add", target: "player", stat: "hp", value: 1 },
      ],
    );
    const state = coLocated(freshState(def), ["operator"], "relay-room");
    const ready = {
      ...state,
      player: {
        ...state.player,
        inventory: { ...state.player.inventory, stacks: [{ itemId: "component", quantity: 1 }] },
      },
    };
    const before = ready.player.inventory.currency;
    const out = checkTasks(ready, withTask(def, t));
    const done = out.completions.find((c) => c.taskId === t.id && c.status === "complete");
    expect(done).toBeDefined();
    expect(done?.narrative).toBe("complete");
    // Rewards apply currency and hp; task-source progression grows focus.
    expect(out.state.player.inventory.currency).toBe(before + 7);
    expect(out.state.player.stats.hp).toBe(ready.player.stats.hp + 1);
    expect(out.state.player.skills.focus).toBe(ready.player.skills.focus + 1);
  });

  it("reactivates repeatable tasks only after their cooldown", () => {
    const def = taskDefinition([]);
    const repeat = {
      ...task("repeat-test", "重复测试", {
        type: "gather",
        target: { items: ["component"] },
        quantity: 1,
      }),
      cooldown: 2,
    };
    const definition = withTask(def, repeat);
    const state = coLocated(freshState(def), ["operator"], "relay-room");
    const ready = {
      ...state,
      player: {
        ...state.player,
        inventory: { ...state.player.inventory, stacks: [{ itemId: "component", quantity: 1 }] },
      },
    };
    const first = checkTasks(ready, definition);
    expect(first.completions.some((entry) => entry.taskId === repeat.id)).toBe(true);
    const tooSoon = checkTasks(first.state, definition);
    expect(tooSoon.completions.some((entry) => entry.taskId === repeat.id)).toBe(false);
    const afterCooldown = {
      ...tooSoon.state,
      clock: advanceClock(tooSoon.state.clock, definition, definition.time.day_length_hours * 2),
    };
    const repeated = checkTasks(afterCooldown, definition);
    expect(repeated.completions.some((entry) => entry.taskId === repeat.id)).toBe(true);
  });
});
