// Task system (tasks/ radiant quest templates): auto-activation when a
// giver is present and conditions hold, state-driven objective progress
// (no per-action hooks), completion rewards + "task" progression, and
// time-limit failure. One pure check function shared by the turn loop and
// the world-step daily boundary — idempotent by task status.
import type { WorldState, WorldDefinition, EventLogEntry, TaskCompletion } from "./types";
import type { Task } from "../script/schemas/task";
import { evalCondition, type ConditionContext } from "./condition";
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
  active: Extract<WorldState["tasks"][number], { status: "active" }>,
): number {
  const objective = task.objective;
  const player = state.player;
  switch (objective.type) {
    case "gather": {
      const target = objective.target;
      if (target.items && target.items.length > 0) {
        return Math.min(
          objective.quantity,
          target.items.reduce((sum, id) => sum + itemCount(player.inventory, id), 0),
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
    case "deliver": {
      const target = objective.target;
      const coLocated = state.npcs[target.recipient]?.currentLocationId === player.locationId;
      return coLocated && itemCount(player.inventory, target.item) >= objective.quantity
        ? objective.quantity
        : 0;
    }
    case "escort": {
      const target = objective.target;
      if (target.any) return actionCountSince(state, active.acceptedEventCount, "escort");
      const coLocated = target.npc ? state.npcs[target.npc]?.currentLocationId === player.locationId : false;
      const atDestination = target.destination === undefined || player.locationId === target.destination;
      return coLocated && atDestination ? objective.quantity : 0;
    }
    case "hunt": {
      const target = objective.target;
      return state.facts.includes(`defeated:${target.npc}`) ? objective.quantity : 0;
    }
    case "investigate": {
      const target = objective.target;
      if ("any" in target) return actionCountSince(state, active.acceptedEventCount, "investigate");
      const present = target.marker.source === "fact"
        ? state.facts.includes(target.marker.key)
        : state.player.flags.includes(target.marker.key) || state.flags.includes(target.marker.key);
      return present ? objective.quantity : 0;
    }
    case "persuade": {
      const target = objective.target;
      const rel = player.relations.find((r) => r.npcId === target.npc);
      return rel && rel.value >= objective.quantity ? objective.quantity : 0;
    }
    case "travel": {
      const target = objective.target;
      return player.locationId === target.location ? objective.quantity : 0;
    }
    default:
      return 0;
  }
}

function actionCountSince(state: WorldState, acceptedEventCount: number, actionId: string): number {
  return state.eventLog.slice(acceptedEventCount).filter((entry) => {
    if (entry.type !== "resolution") return false;
    const detail = entry.detail as { actionId?: unknown } | undefined;
    return detail?.actionId === actionId;
  }).length;
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
  const appendLog = (summary: string): void => {
    const entry: EventLogEntry = {
      id: `log-${current.eventLog.length + 1}`,
      day,
      hour: current.clock.hour,
      type: "world",
      actor: "system",
      summary,
    };
    current = { ...current, eventLog: [...current.eventLog, entry] };
    logEntries.push(entry);
  };

  for (const taskDef of definition.tasks.values()) {
    const activeExisting = current.tasks.find((t) => t.taskId === taskDef.id && t.status === "active");
    const terminal = [...current.tasks].reverse().find((t) => t.taskId === taskDef.id && t.status !== "active");
    const ctx: ConditionContext = { definition, state: current };

    // Auto-activation: giver present + conditions + repeatable/never-completed + cooldown.
    if (!activeExisting) {
      const lastFinishedDay = terminal?.status === "complete"
        ? terminal.completedDay
        : terminal?.status === "failed"
          ? terminal.failedDay
          : undefined;
      const cooldown = taskDef.cooldown ?? 0;
      const cooldownOk =
        lastFinishedDay === undefined || cooldown <= 0 || day - lastFinishedDay >= cooldown;
      const conditionsOk = taskDef.conditions ? evalCondition(taskDef.conditions, ctx) : true;
      const giverOk = taskDef.giver.condition ? evalCondition(taskDef.giver.condition, ctx) : true;
      if (
        (!terminal || taskDef.repeatable) &&
        cooldownOk &&
        conditionsOk &&
        giverOk &&
        giverPresent(current, taskDef.giver.pool)
      ) {
        appendLog(`task "${taskDef.id}" activated`);
        current = {
          ...current,
          tasks: [
            ...current.tasks.filter((task) => task.taskId !== taskDef.id),
            {
              taskId: taskDef.id,
              status: "active",
              acceptedDay: day,
              acceptedEventCount: current.eventLog.length,
              progress: 0,
            },
          ],
        };
      }
    }

    const active = current.tasks.find(
      (t): t is Extract<typeof t, { status: "active" }> =>
        t.taskId === taskDef.id && t.status === "active",
    );
    if (!active) continue;

    const progress = objectiveProgress(taskDef, current, definition, active);

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
        appendLog(`task "${taskDef.id}" failed (time limit)`);
        continue;
      }
    }

    // Completion when the objective is fully met.
    if (progress >= taskDef.objective.quantity) {
      // Deliver tasks consume the delivered item(s).
      if (taskDef.objective.type === "deliver") {
        const itemId = taskDef.objective.target.item;
        const removed = removeItem(current.player.inventory, itemId, taskDef.objective.quantity);
        if (removed.ok) {
          current = { ...current, player: { ...current.player, inventory: removed.inv } };
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
      appendLog(`task "${taskDef.id}" completed`);
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
