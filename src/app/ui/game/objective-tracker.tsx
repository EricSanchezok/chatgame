"use client";

import type { ObjectiveTrackerSlotProps } from "../../lib/script-registry";
import { SlotRenderer } from "./slots";

function DefaultObjectiveTracker({ state, catalog, trackedTaskId, openTasks }: ObjectiveTrackerSlotProps) {
  const active = state.tasks.filter((task) => task.status === "active");
  const taskState = active.find((task) => task.taskId === trackedTaskId) ?? active[0];
  if (!taskState) return null;
  const task = catalog.tasks.find((candidate) => candidate.id === taskState.taskId);
  const progress = "progress" in taskState ? taskState.progress : 0;
  const total = task?.quantity ?? 1;
  return (
    <button type="button" className="cg-objective-tracker" onClick={openTasks} aria-label={`查看任务：${task?.name ?? taskState.taskId}`}>
      <span className="cg-objective-tracker__label">当前目标</span>
      <strong>{task?.name ?? taskState.taskId}</strong>
      <span>{task?.objectiveText ?? "继续推进任务"}</span>
      <span className="cg-objective-tracker__progress">{Math.min(progress, total)} / {total}</span>
    </button>
  );
}

export function ObjectiveTracker(props: ObjectiveTrackerSlotProps) {
  return <SlotRenderer slot="objective-tracker" fallback={DefaultObjectiveTracker} slotProps={props} />;
}
