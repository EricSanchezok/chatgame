// Task system (tasks/ radiant quest templates): auto-activation when a
// giver is present and conditions hold, state-driven objective progress
// (no per-action hooks), completion rewards + "task" progression, and
// time-limit failure. One pure check function shared by the turn loop and
// the world-step daily boundary — idempotent by task status.
import type { WorldState, WorldDefinition, EventLogEntry, TaskCompletion } from "./types";
import type { Task } from "../script/schemas/task";
import { evalCondition, hasMarker, type ConditionContext } from "./condition";
import { applyEffects } from "./effect";
import { applyProgression } from "./mechanics/progression";
import { absoluteDay } from "./time";
import { itemCount, removeItem } from "./mechanics/inventory";


export interface TaskCheckResult {
  state: WorldState;
  completions: TaskCompletion[];
  logEntries: EventLogEntry[];
}

/** Whether the player is co-located with any NPC from the pool. */
function giverPresent(state: WorldState, giverPool: string[]): boolean {
  return giverPool.some((id) => state.npcs[id]?.currentLocationId === state.player.locationId);
}


/** Progress value for an active task (objective quantity satisfied so far). */
function objectiveProgress(
  task: Task,
  state: WorldState,
  definition: WorldDefinition,
): number {
  const objective = task.objective;
  const target = objective.target;
  const player = state.player;
  switch (objective.type) {
    case "gather": {
      if (target.pool && target.pool.length > 0) {
        return Math.min(
          objective.quantity,
          target.pool.reduce((sum, id) => sum + itemCount(player.inventory, id), 0),
        );
      }
      if (target.of_type) {
        return Math.min(
          objective.quantity,
          [...definition.items.values()]
            .filter((i) => i.type === target.of_type)
            .reduce((sum, i) => sum + itemCount(player.inventory, i.id), 0),
        );
      }
      return 0;
    }
    case "deliver":
    case "escort": {
      // Escort: target NPC co-located. Deliver: target NPC co-located AND
      // the player holds the item (completion removes it). Both return the
      // full quantity when satisfied so `progress >= quantity` completes.
      const npcId = target.pool?.[0];
      if (!npcId) return 0;
      const coLocated = state.npcs[npcId]?.currentLocationId === player.locationId;
      if (objective.type === "escort") return coLocated ? objective.quantity : 0;
      if (!coLocated) return 0;
      const itemId = target.pool?.[1];
      return itemId && itemCount(player.inventory, itemId) >= objective.quantity
        ? objective.quantity
        : 0;
    }
    case "hunt": {
      // Hunt: the target NPC was defeated (a `defeated:<npc>` fact exists).
      const npcId = target.pool?.[0];
      return npcId && state.facts.includes(`defeated:${npcId}`) ? objective.quantity : 0;
    }
    case "investigate": {
      const key = target.pool?.[0];
      return key && hasMarker(state, key) ? objective.quantity : 0;
    }
    case "persuade": {
      const npcId = target.pool?.[0];
      if (!npcId) return 0;
      const rel = player.relations.find((r) => r.npcId === npcId);
      return rel && rel.value >= objective.quantity ? objective.quantity : 0;
    }
    case "travel": {
      const locId = target.pool?.[0];
      return locId && player.locationId === locId ? objective.quantity : 0;
    }
    default:
      return 0;
  }
}

/**
 * Checks all tasks: auto-activates eligible ones, completes active ones
 * whose objective is met, and fails active ones past their time limit.
 * Idempotent — each task transitions at most once per call.
 */
export function checkTasks(
  state: WorldState,
  definition: WorldDefinition,
): TaskCheckResult {
  let current = state;
  const completions: TaskCompletion[] = [];
  const logEntries: EventLogEntry[] = [];
  const day = absoluteDay(definition, state.clock);

  for (const taskDef of definition.tasks.values()) {
    const existing = current.tasks.find((t) => t.taskId === taskDef.id);
    const ctx: ConditionContext = { definition, state: current };

    // Auto-activation: giver present + conditions + repeatable/never-completed + cooldown.
    if (!existing) {
      const neverCompleted = !current.tasks.some(
        (t) => t.taskId === taskDef.id && t.status === "complete",
      );
      const lastComplete = current.tasks.find(
        (t): t is Extract<typeof t, { status: "complete" }> =>
          t.taskId === taskDef.id && t.status === "complete",
      );
      const cooldown = taskDef.cooldown ?? 0;
      const cooldownOk =
        !lastComplete || cooldown <= 0 || day - lastComplete.completedDay >= cooldown;
      const conditionsOk = taskDef.conditions ? evalCondition(taskDef.conditions, ctx) : true;
      const giverOk = taskDef.giver.condition ? evalCondition(taskDef.giver.condition, ctx) : true;
      if (
        (taskDef.repeatable || neverCompleted) &&
        cooldownOk &&
        conditionsOk &&
        giverOk &&
        giverPresent(current, taskDef.giver.pool)
      ) {
        current = {
          ...current,
          tasks: [...current.tasks, { taskId: taskDef.id, status: "active", acceptedDay: day, progress: 0 }],
        };
        logEntries.push({
          id: `log-${current.eventLog.length + 1}`,
          day,
          hour: current.clock.hour,
          type: "world",
          actor: "system",
          summary: `task "${taskDef.id}" activated`,
        });
      }
    }

    const active = current.tasks.find(
      (t): t is Extract<typeof t, { status: "active" }> =>
        t.taskId === taskDef.id && t.status === "active",
    );
    if (!active) continue;

    const progress = objectiveProgress(taskDef, current, definition);

    // Time-limit failure.
    if (taskDef.time_limit) {
      const deadlineDay = active.acceptedDay + taskDef.time_limit.days;
      if (day > deadlineDay) {
        current = {
          ...current,
          tasks: current.tasks.map((t) =>
            t.taskId === taskDef.id ? { ...t, status: "failed", failedDay: day } : t,
          ),
        };
        completions.push({ taskId: taskDef.id, status: "fail", narrative: taskDef.narrative.fail });
        logEntries.push({
          id: `log-${current.eventLog.length + 1}`,
          day,
          hour: current.clock.hour,
          type: "world",
          actor: "system",
          summary: `task "${taskDef.id}" failed (time limit)`,
        });
        continue;
      }
    }

    // Completion when the objective is fully met.
    if (progress >= taskDef.objective.quantity) {
      // Deliver tasks consume the delivered item(s).
      if (taskDef.objective.type === "deliver") {
        const itemId = taskDef.objective.target.pool?.[1];
        if (itemId) {
          const removed = removeItem(current.player.inventory, itemId, taskDef.objective.quantity);
          if (removed.ok) {
            current = { ...current, player: { ...current.player, inventory: removed.inv } };
          }
        }
      }
      const rewardOut = applyEffects(current, taskDef.rewards, { definition, day });
      current = rewardOut.state;
      current = applyProgression(current, definition, "task").state;
      current = {
        ...current,
        tasks: current.tasks.map((t) =>
          t.taskId === taskDef.id ? { ...t, status: "complete", completedDay: day } : t,
        ),
      };
      completions.push({ taskId: taskDef.id, status: "complete", narrative: taskDef.narrative.complete });
      logEntries.push({
        id: `log-${current.eventLog.length + 1}`,
        day,
        hour: current.clock.hour,
        type: "world",
        actor: "system",
        summary: `task "${taskDef.id}" completed`,
      });
    } else if (progress !== active.progress) {
      current = {
        ...current,
        tasks: current.tasks.map((t) =>
          t.taskId === taskDef.id ? { ...t, progress } : t,
        ),
      };
    }
  }

  return { state: current, completions, logEntries };
}
